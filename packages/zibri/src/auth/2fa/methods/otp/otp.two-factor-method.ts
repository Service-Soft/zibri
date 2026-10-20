import { randomBytes } from 'node:crypto';

import { InvalidTwoFactorCodeError } from '../../invalid-two-factor-code.error.ts';
import { NoRegisterData } from '../no-register-data.model.ts';
import { TwoFactorMethod } from '../two-factor-method.interface.ts';
import { base32Encode } from './base32-encode.function.ts';
import { OtpCodeAlreadyUsedError } from './otp-code-already-used.error.ts';
import { OtpCredentials, OtpCredentialsCreateData } from './otp-credentials.model.ts';
import { OTP_PERIOD_IN_SECONDS, OtpUtilities, type OtpValidationWindowInMs } from './otp.utilities.ts';
import { ZibriApplication } from '../../../../application/application.ts';
import { HttpRequestContext } from '../../../../context/request/http-request.context.ts';
import { WebsocketRequestContext } from '../../../../context/request/websocket-request.context.ts';
import { Repository } from '../../../../data-source/repository/repository.ts';
import { repositoryTokenFor } from '../../../../di/decorators/inject-repository.decorator.ts';
import { Inject } from '../../../../di/decorators/inject.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../../../di/inject.function.ts';
import { Property } from '../../../../entity/decorators/property.decorator.ts';
import { UnauthorizedError } from '../../../../error-handling/errors/unauthorized.error.ts';
import { KnownHeader } from '../../../../http/known-header.enum.ts';
import { type LeaseServiceInterface } from '../../../../leases/lease-service.interface.ts';
import { $ts } from '../../../../localization/translate.function.ts';
import { Newable } from '../../../../types/newable.type.ts';
import { Ms } from '../../../../utilities/ms.ts';
import { optionalPeer } from '../../../../utilities/optional-peer.function.ts';
import { validateEntitiesRegistered } from '../../../../utilities/validate-entities-registered.function.ts';
import { BaseUser } from '../../../models/base-user.model.ts';

/**
 * The data for confirming the registration of the otp two factor method.
 */
export class OtpConfirmRegisterData {
    /**
     * The token to validate.
     */
    @Property.string()
    token!: string;
}

/**
 * What a user needs in order to finish enrolling an authenticator.
 *
 * Both fields are derived from the secret and neither is stored: the url is what a qr code encodes,
 * and the secret is the same thing in the form someone types when they cannot scan one. Handing them
 * back at enrollment time is the only moment either is needed in the clear.
 */
export class OtpRegistration {
    /**
     * The otpauth url to render as a qr code.
     */
    @Property.string()
    qrCodeUrl!: string;

    /**
     * The secret itself, for entering by hand.
     */
    @Property.string()
    secret!: string;
}

/**
 * One Time Password Two Factor Method.
 */
export class OtpTwoFactorMethod implements TwoFactorMethod<void, OtpConfirmRegisterData, OtpRegistration> {
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    readonly name: string = 'otp';

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    readonly requestRegisterModel: Newable<void> = NoRegisterData;

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    readonly confirmRegisterModel: Newable<OtpConfirmRegisterData> = OtpConfirmRegisterData;

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    readonly registrationModel: Newable<OtpRegistration> = OtpRegistration;

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    readonly secondFactorStartModel: undefined = undefined;

    // read when used rather than injected, so that an application without the entity is told to
    // declare it by init, instead of failing on a repository token while this is built
    private get otpCredentialsRepository(): Repository<OtpCredentials, OtpCredentialsCreateData> {
        return inject(repositoryTokenFor(OtpCredentials));
    }

    constructor(
        @Inject(ZIBRI_DI_TOKENS.OTP_HEADER)
        private readonly otpHeader: KnownHeader,
        @Inject(ZIBRI_DI_TOKENS.OTP_LENGTH)
        private readonly otpLength: number,
        @Inject(ZIBRI_DI_TOKENS.OTP_VALIDATION_WINDOW_IN_MS)
        private readonly validationWindowInMs: OtpValidationWindowInMs,
        @Inject(ZIBRI_DI_TOKENS.LEASE_SERVICE)
        private readonly leaseService: LeaseServiceInterface
    ) {
        // here rather than where a code is finally generated or checked. This method is registered
        // in an application's options, so constructing it is the moment the deployment says it
        // intends to do two factor - and an application that says so without having installed the
        // package should not get as far as the first person trying to log in with it.
        optionalPeer('otpauth', 'Two factor authentication with an otp');
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    init(app: ZibriApplication): void {
        validateEntitiesRegistered(OtpTwoFactorMethod.name, app, OtpCredentials);
    }

    /**
     * Records that a step has been used, and reports whether this was the first time.
     *
     * A grant that is kept rather than handed back, because it is not protecting work in progress -
     * it *is* the record that these digits have been spent. It lapses on its own once the step can no
     * longer be accepted, so nothing has to clean it up, and it is a lease rather than anything local
     * so that a replay against a different replica is refused just as firmly.
     * @param credentialsId - The credentials the code belongs to. Two users can hold the same digits
     * at the same moment, so the step alone would let one of them spend the other's.
     * @param step - The step the accepted code belongs to.
     * @throws When the step has already been spent.
     */
    private async consumeStep(credentialsId: string, step: number): Promise<void> {
        const first: boolean | undefined = await this.leaseService.withLease(
            {
                key: `otp:${credentialsId}:${step}`,
                // the step's own length plus the skew allowed either side of it, which is exactly how
                // long this step can still be presented for
                leaseInMs: (this.validationWindowInMs * 2) + (OTP_PERIOD_IN_SECONDS * Ms.SECOND),
                mode: 'skip',
                onCompletion: 'retain'
            },
            () => Promise.resolve(true)
        );

        if (first !== true) {
            throw new OtpCodeAlreadyUsedError();
        }
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async requestRegisterForUser<Role extends string, UserType extends BaseUser<Role>>(
        user: UserType
    ): Promise<OtpRegistration> {
        // asking for a new enrollment gives up on any that was never finished. Without this every
        // call left another secret behind, so an abandoned setup accumulated valid-looking rows for
        // as long as the account existed. Confirmed credentials are untouched: a user setting up a
        // new device must not lose the one that currently works before the new one is proven.
        await this.otpCredentialsRepository.deleteAll({ userId: user.id, confirmed: false });

        const secret: string = this.generateSecret();
        await this.otpCredentialsRepository.create({ secret, userId: user.id });

        // derived here rather than stored beside the secret. The url embeds the secret in plaintext,
        // so a column holding it was a second, unprotected copy of exactly what the encrypted one
        // guards - and nothing ever read it back, which is why enrolling had no way to show a user
        // their qr code at all.
        return { qrCodeUrl: OtpUtilities.createQrCodeUrl(secret), secret };
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async startSecondFactor(): Promise<void> {
        // the app shows the code by itself, so there is nothing to start
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async confirmRegisterForUser<Role extends string, UserType extends BaseUser<Role>>(
        user: UserType,
        data: OtpConfirmRegisterData
    ): Promise<void> {
        // only the enrollment that is waiting to be finished. Confirming is the step that proves the
        // authenticator holds this secret, so a code from one that is already confirmed proves
        // nothing about the new one and must not stand in for it.
        const credentials: OtpCredentials[] = await this.otpCredentialsRepository.findAll({
            where: { userId: user.id, confirmed: false }
        });
        for (const c of credentials) {
            const step: number | undefined = OtpUtilities.validate(c.secret, data.token, this.validationWindowInMs);
            if (step != undefined) {
                // spent here too: confirming is a successful validation, so letting the same digits
                // through again afterwards would leave the very first code a user enters open to
                // being used a second time
                await this.consumeStep(c.id, step);
                await this.otpCredentialsRepository.updateById(c.id, { confirmed: true });
                return;
            }
        }

        throw new InvalidTwoFactorCodeError();
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async unregisterForUser<Role extends string, UserType extends BaseUser<Role>>(user: UserType): Promise<void> {
        await this.otpCredentialsRepository.deleteAll({ userId: user.id });
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async isRegisteredForUser<Role extends string, UserType extends BaseUser<Role>>(user: UserType): Promise<boolean> {
        // confirmed only, for the reason validate gives: an unconfirmed secret is one nobody has
        // proven they hold, so a user with nothing but that has no second factor to present
        const credentials: OtpCredentials | undefined = await this.otpCredentialsRepository.findOne({
            where: { userId: user.id, confirmed: true },
            required: false
        });
        return credentials != undefined;
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async validate<Role extends string, UserType extends BaseUser<Role>>(
        user: UserType,
        context: HttpRequestContext | WebsocketRequestContext
    ): Promise<void> {
        // confirmed only. An enrollment that was requested but never finished is a secret nobody has
        // proven they hold - accepting it meant a second factor could be satisfied by enrolling one
        // and simply not completing the step that exists to verify it.
        const credentials: OtpCredentials[] = await this.otpCredentialsRepository.findAll({
            where: { userId: user.id, confirmed: true }
        });
        const token: string = this.extractTokenFromRequestContext(context);
        for (const c of credentials) {
            const step: number | undefined = OtpUtilities.validate(c.secret, token, this.validationWindowInMs);
            if (step != undefined) {
                await this.consumeStep(c.id, step);
                return;
            }
        }
        throw new InvalidTwoFactorCodeError();
    }

    private extractTokenFromRequestContext(context: HttpRequestContext | WebsocketRequestContext): string {
        const code: string | undefined = context.request.headers?.[this.otpHeader];
        if (!code) {
            throw new UnauthorizedError($ts`"${this.otpHeader}" header not found`);
        }
        if (code.length !== this.otpLength) {
            throw new UnauthorizedError($ts`The provided two factor code is not ${this.otpLength} digits long.`);
        }
        return code;
    }

    private generateSecret(): string {
        const buffer: Buffer = randomBytes(15);
        const base32: string = base32Encode(buffer)
            .replaceAll('=', '')
            .substring(0, 24);
        return base32;
    }
}