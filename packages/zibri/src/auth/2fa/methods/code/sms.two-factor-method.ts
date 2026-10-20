import { CodeTwoFactorMethod } from './code.two-factor-method.ts';
import { SmsCodeBudgetRateLimiter } from './sms-code-budget.rate-limiter.ts';
import { type SmsCodeLimits } from './sms-code-limits.model.ts';
import { SmsCodeNumberRateLimiter } from './sms-code-number.rate-limiter.ts';
import { SmsRegisterData } from './sms-register-data.model.ts';
import { ZibriApplication } from '../../../../application/application.ts';
import { ZIBRI_DI_TOKENS } from '../../../../di/default/zibri-di-tokens.default.ts';
import { NoProviderError } from '../../../../di/errors/no-provider.error.ts';
import { inject } from '../../../../di/inject.function.ts';
import { BadRequestError } from '../../../../error-handling/errors/bad-request.error.ts';
import { TooManyRequestsError } from '../../../../error-handling/errors/too-many-requests.error.ts';
import { InternalError } from '../../../../error-handling/internal-error.model.ts';
import { MimeType } from '../../../../http/mime-type.enum.ts';
import { $ts } from '../../../../localization/translate.function.ts';
import { RateLimitResult } from '../../../../rate-limiting/rate-limit-result.model.ts';
import { JsonBodyMetadata, XmlBodyMetadata } from '../../../../routing/decorators/body-metadata.model.ts';
import { resolveStructuredBodyMetadata } from '../../../../routing/resolve-body-metadata.function.ts';
import { type SmsServiceInterface } from '../../../../sms/sms-service.interface.ts';
import { Newable } from '../../../../types/newable.type.ts';
import { Ms } from '../../../../utilities/ms.ts';
import { BaseUser } from '../../../models/base-user.model.ts';

/**
 * A code sent as a text message to a phone number of the user as the second factor.
 *
 * The user enrolls with the number and confirms it with the first code. The `2fa/start` route of
 * `AuthController` asks for a code with `startSecondFactor`, and the user sends it back in the
 * `x-authorization-sms-code` header of the guarded request. Text messages can be redirected to another device, so an
 * authenticator app or a passkey protects better where the users have one.
 *
 * Needs a sender registered under `ZIBRI_DI_TOKENS.SMS_SERVICE`, see `SmsServiceInterface`, and what its
 * text messages may cost under `ZIBRI_DI_TOKENS.SMS_CODE_LIMITS`, see `SmsCodeLimits`.
 */
export class SmsTwoFactorMethod extends CodeTwoFactorMethod<SmsRegisterData> {
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    protected readonly channel: string = 'sms';

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    readonly requestRegisterModel: Newable<SmsRegisterData> = SmsRegisterData;

    override init(app: ZibriApplication): void {
        super.init(app);
        this.resolveSmsService();
        this.resolveLimits();
        // built here for the reason the code limiter is, see CodeTwoFactorMethod.init
        inject(ZIBRI_DI_TOKENS.RATE_LIMITING_SERVICE).addLimiter(inject(SmsCodeBudgetRateLimiter));
        inject(ZIBRI_DI_TOKENS.RATE_LIMITING_SERVICE).addLimiter(inject(SmsCodeNumberRateLimiter));
    }

    override async requestRegisterForUser<Role extends string, UserType extends BaseUser<Role>>(
        user: UserType,
        data: SmsRegisterData
    ): Promise<void> {
        // checked here as well as where it is a request body, since enrolling is also called from code
        const metadata: JsonBodyMetadata | XmlBodyMetadata = resolveStructuredBodyMetadata(
            { type: MimeType.JSON, modelClass: SmsRegisterData },
            0
        );
        await inject(ZIBRI_DI_TOKENS.VALIDATION_SERVICE).validateBody(data, metadata);
        await super.requestRegisterForUser(user, data);
    }

    protected override async claimDelivery(destination: string | undefined): Promise<void> {
        if (destination == undefined) {
            throw new InternalError('Text message credentials without a phone number.');
        }
        // a text message is the one channel where sending costs the application money, and the
        // number is the caller's to choose: without these, every account is a message a minute to a
        // premium rate number its owner is paid for. Checked on every send rather than at enrolling
        // alone, so a country taken off the list stops being texted at once
        const limits: SmsCodeLimits = this.resolveLimits();
        if (!limits.allowedCallingCodes.some(code => destination.startsWith(code))) {
            throw new BadRequestError($ts`Text messages are not sent to this phone number.`);
        }
        // the number before the budget, so that one number asked for again and again is turned away
        // without spending what everybody else is sent from
        const toNumber: RateLimitResult = await inject(SmsCodeNumberRateLimiter).consume(destination, 1);
        if (!toNumber.allowed) {
            throw new TooManyRequestsError($ts`This phone number was sent too many codes today.`, toNumber);
        }
        // one key, because the budget is the whole application's
        const budget: RateLimitResult = await inject(SmsCodeBudgetRateLimiter).consume('all', 1);
        if (!budget.allowed) {
            throw new TooManyRequestsError($ts`No codes are sent by text message right now. Try again later.`, budget);
        }
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    protected async deliver(_user: BaseUser<string>, destination: string | undefined, code: string): Promise<void> {
        if (destination == undefined) {
            throw new InternalError('Text message credentials without a phone number.');
        }
        const minutes: number = Math.round(this.resolveOptions().expiresInMs / Ms.MINUTE);
        await this.resolveSmsService().send({
            to: destination,
            message: $ts`Your verification code is ${code}. It is valid for ${minutes} minutes.`
        });
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    protected resolveDestination(data: SmsRegisterData): string {
        return data.phoneNumber;
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    protected resolveHeader(): string {
        return inject(ZIBRI_DI_TOKENS.SMS_CODE_HEADER);
    }

    private resolveSmsService(): SmsServiceInterface {
        const sms: SmsServiceInterface | undefined = inject(ZIBRI_DI_TOKENS.SMS_SERVICE);
        if (sms == undefined) {
            throw new NoProviderError(ZIBRI_DI_TOKENS.SMS_SERVICE, []);
        }
        return sms;
    }

    /**
     * What the text messages may cost, checked.
     * @returns The limits.
     * @throws {InternalError} When none are provided, or one of them cannot be a limit.
     */
    private resolveLimits(): SmsCodeLimits {
        // no default: what a text message costs and which countries an application serves are its
        // own, and a guess at either is the budget an attacker spends
        const limits: SmsCodeLimits | undefined = inject(ZIBRI_DI_TOKENS.SMS_CODE_LIMITS);
        if (limits == undefined) {
            throw new InternalError([
                'SmsTwoFactorMethod needs ZIBRI_DI_TOKENS.SMS_CODE_LIMITS:',
                'how many codes it may text in an hour and to one number in a day, and to which countries.'
            ]);
        }
        for (const [name, value] of Object.entries({ maxPerHour: limits.maxPerHour, maxPerNumberPerDay: limits.maxPerNumberPerDay })) {
            if (!Number.isInteger(value) || value <= 0) {
                throw new InternalError(`SMS_CODE_LIMITS.${name} must be a whole number above 0, got ${value}.`);
            }
        }
        if (!limits.allowedCallingCodes.length || limits.allowedCallingCodes.some(code => !/^\+\d+$/.test(code))) {
            throw new InternalError('SMS_CODE_LIMITS.allowedCallingCodes must name at least one, each a + followed by digits.');
        }
        return limits;
    }
}