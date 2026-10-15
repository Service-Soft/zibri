import { randomInt, timingSafeEqual } from 'node:crypto';

import { TwoFactorCodeCleanupCronJob } from './two-factor-code-cleanup.cron-job';
import { TwoFactorCodeCredentials, TwoFactorCodeCredentialsCreateData } from './two-factor-code-credentials.model';
import { TwoFactorCodeOptions } from './two-factor-code-options.model';
import { TwoFactorCode, TwoFactorCodeCreateData } from './two-factor-code.model';
import { TwoFactorCodeRateLimiter } from './two-factor-code.rate-limiter';
import { ZibriApplication } from '../../../../application/application';
import { HttpRequestContext } from '../../../../context/request/http-request.context';
import { WebsocketRequestContext } from '../../../../context/request/websocket-request.context';
import { Where } from '../../../../data-source/models/where/where-filter.model';
import { Repository } from '../../../../data-source/repository/repository';
import { Transaction } from '../../../../data-source/transaction/transaction.model';
import { repositoryTokenFor } from '../../../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../../di/inject.function';
import { Property } from '../../../../entity/decorators/property.decorator';
import { ForbiddenError } from '../../../../error-handling/errors/forbidden.error';
import { TooManyRequestsError } from '../../../../error-handling/errors/too-many-requests.error';
import { UnauthorizedError } from '../../../../error-handling/errors/unauthorized.error';
import { InternalError } from '../../../../error-handling/internal-error.model';
import { $ts } from '../../../../localization/translate.function';
import { RateLimitResult } from '../../../../rate-limiting/rate-limit-result.model';
import { RateLimitStateEntity } from '../../../../rate-limiting/stores/rate-limit-state-entity.model';
import { Newable } from '../../../../types/newable.type';
import { Ms } from '../../../../utilities/ms';
import { validateEntitiesRegistered } from '../../../../utilities/validate-entities-registered.function';
import { BaseUser } from '../../../models/base-user.model';
import { InvalidTwoFactorCodeError } from '../../invalid-two-factor-code.error';
import { TwoFactorMethod } from '../two-factor-method.interface';

/**
 * The data for confirming the enrollment of a method that sends codes.
 */
export class CodeConfirmRegisterData {
    /**
     * The code that was sent.
     */
    @Property.string()
    code!: string;
}

/**
 * The options a code is made with, with every default filled in.
 */
type ResolvedTwoFactorCodeOptions = Required<Omit<TwoFactorCodeOptions, 'resendAfterMs'>>;

/**
 * The base of the two factor methods that send the user a code: it makes the code, keeps it
 * encrypted for a while, and uses it up when it is right.
 *
 * A class extending it names its channel, says how the code is delivered and which header carries
 * it back.
 * @template RequestData - What the user supplies to start enrolling.
 */
export abstract class CodeTwoFactorMethod<RequestData> implements TwoFactorMethod<RequestData, CodeConfirmRegisterData> {

    abstract readonly requestRegisterModel: Newable<RequestData>;

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly confirmRegisterModel: Newable<CodeConfirmRegisterData> = CodeConfirmRegisterData;

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly registrationModel: undefined = undefined;

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly secondFactorStartModel: undefined = undefined;

    /**
     * How the codes of this method are sent, eg. `email`. Credentials and codes of another channel
     * are not touched, so every method names its own.
     */
    protected abstract readonly channel: string;

    /**
     * The name of the method: its channel.
     * @returns The channel.
     */
    get name(): string {
        return this.channel;
    }

    // read when used rather than injected, so that an application without the entities is told to
    // declare them by init, instead of failing on a repository token while this is built
    private get credentialsRepository(): Repository<TwoFactorCodeCredentials, TwoFactorCodeCredentialsCreateData> {
        return inject(repositoryTokenFor(TwoFactorCodeCredentials));
    }

    private get codeRepository(): Repository<TwoFactorCode, TwoFactorCodeCreateData> {
        return inject(repositoryTokenFor(TwoFactorCode));
    }

    /**
     * Validates what the application provides while it starts.
     * @param app - The application that starts.
     * @throws {InternalError} When a setting of `TWO_FACTOR_CODE_OPTIONS` is not a whole number above 0.
     */
    init(app: ZibriApplication): void {
        validateEntitiesRegistered(this.constructor.name, app, TwoFactorCodeCredentials, TwoFactorCode, RateLimitStateEntity);
        // built here, by an application that sends codes: its state is in the data source, and an
        // application that sends none has no table for it
        inject(ZIBRI_DI_TOKENS.RATE_LIMITING_SERVICE).addLimiter(inject(TwoFactorCodeRateLimiter));
        const options: TwoFactorCodeOptions = inject(ZIBRI_DI_TOKENS.TWO_FACTOR_CODE_OPTIONS);
        for (const [name, value] of Object.entries(options)) {
            if (value != undefined && (!Number.isInteger(value) || value <= 0)) {
                throw new InternalError(`TWO_FACTOR_CODE_OPTIONS.${name} must be a whole number above 0, got ${value}.`);
            }
        }
        if (!app.options.cronJobs.includes(TwoFactorCodeCleanupCronJob)) {
            app.options.cronJobs.push(TwoFactorCodeCleanupCronJob);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async requestRegisterForUser<Role extends string, UserType extends BaseUser<Role>>(
        user: UserType,
        data: RequestData
    ): Promise<void> {
        // before anything is changed: a request that is turned away must leave the enrollment whose
        // code is on its way to the user exactly as it was
        await this.claimSend(user.id);
        await this.claimDelivery?.(this.resolveDestination(data));
        // asking again gives up on an enrollment that was never confirmed, as the otp method does. A
        // confirmed one stays, so a user setting up a new destination keeps the one that works.
        await this.deleteCredentials({ userId: user.id, channel: this.channel, confirmed: false });
        const credentials: TwoFactorCodeCredentials = await this.credentialsRepository.create({
            userId: user.id,
            channel: this.channel,
            destination: this.resolveDestination(data)
        });
        await this.sendCode(user, credentials);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async confirmRegisterForUser<Role extends string, UserType extends BaseUser<Role>>(
        user: UserType,
        data: CodeConfirmRegisterData
    ): Promise<void> {
        // only the enrollment that is waiting for its code. A code that was sent to a confirmed
        // destination proves nothing about the new one.
        const credentials: TwoFactorCodeCredentials | undefined = await this.credentialsRepository.findOne({
            where: { userId: user.id, channel: this.channel, confirmed: false },
            required: false
        });
        if (credentials == undefined) {
            throw new UnauthorizedError($ts`No code is waiting for this account. Ask for a new one.`);
        }
        await this.useCode(credentials.id, data.code);

        // together, so that a failure in between cannot leave the user without either. The codes of
        // the credentials replaced here can no longer be reached and expire on their own.
        const transaction: Transaction = await this.credentialsRepository.dataSource.startTransaction();
        try {
            await this.credentialsRepository.deleteAll({ userId: user.id, channel: this.channel, confirmed: true }, { transaction });
            await this.credentialsRepository.updateById(credentials.id, { confirmed: true }, { transaction });
            await transaction.commit();
        }
        catch (error) {
            await transaction.rollback();
            throw error;
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async unregisterForUser<Role extends string, UserType extends BaseUser<Role>>(user: UserType): Promise<void> {
        await this.deleteCredentials({ userId: user.id, channel: this.channel });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async isRegisteredForUser<Role extends string, UserType extends BaseUser<Role>>(user: UserType): Promise<boolean> {
        return await this.findConfirmedCredentials(user.id) != undefined;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async validate<Role extends string, UserType extends BaseUser<Role>>(
        user: UserType,
        context: HttpRequestContext | WebsocketRequestContext
    ): Promise<void> {
        const code: string = this.extractCodeFromRequestContext(context);
        const credentials: TwoFactorCodeCredentials | undefined = await this.findConfirmedCredentials(user.id);
        if (credentials == undefined) {
            // not a guess at anybody's code, so it does not make the user wait
            throw new UnauthorizedError($ts`This account has no second factor of this kind.`);
        }
        await this.useCode(credentials.id, code);
    }

    /**
     * Sends a code to the user, to enter as a second factor.
     * @param user - The user to send to.
     * @throws {ForbiddenError} When the user has not enrolled this method.
     * @throws {TooManyRequestsError} When a code was sent to the user a moment ago.
     */
    async startSecondFactor<Role extends string, UserType extends BaseUser<Role>>(user: UserType): Promise<void> {
        const credentials: TwoFactorCodeCredentials | undefined = await this.findConfirmedCredentials(user.id);
        if (credentials == undefined) {
            throw new ForbiddenError($ts`This account has no second factor of this kind.`);
        }
        await this.claimSend(user.id);
        await this.claimDelivery?.(credentials.destination);
        await this.sendCode(user, credentials);
    }

    /**
     * Takes what sending a code to a destination counts against, before anything is changed. What a
     * method's channel costs is the method's to bound, so a method that sends for free leaves it out.
     * @param destination - Where the code would go, if the method sends to something the user supplied.
     * @throws When the code may not be sent there now, with what the caller should be told.
     */
    protected claimDelivery?(destination: string | undefined): Promise<void>;
    /**
     * Sends the code to where the user receives it.
     * @param user - The user the code is for.
     * @param destination - What the user supplied when enrolling, if the method asks for anything.
     * @param code - The code to send.
     */
    protected abstract deliver(user: BaseUser<string>, destination: string | undefined, code: string): Promise<void>;

    /**
     * What is kept as the destination of the codes.
     * @param data - What the user supplied when starting to enroll.
     * @returns The destination, or undefined when the method sends to something the user already has.
     */
    protected abstract resolveDestination(data: RequestData): string | undefined;

    /**
     * The name of the header that carries the code back.
     * @returns The header name.
     */
    protected abstract resolveHeader(): string;

    /**
     * The options a code is made with, with the defaults filled in.
     * @returns How many digits a code has and how long it is valid.
     */
    protected resolveOptions(): ResolvedTwoFactorCodeOptions {
        const options: TwoFactorCodeOptions = inject(ZIBRI_DI_TOKENS.TWO_FACTOR_CODE_OPTIONS);
        return {
            digits: options.digits ?? 6,
            expiresInMs: options.expiresInMs ?? Ms.MINUTE * 10
        };
    }

    private extractCodeFromRequestContext(context: HttpRequestContext | WebsocketRequestContext): string {
        const header: string = this.resolveHeader();
        const code: string | undefined = context.request.headers?.[header];
        if (!code) {
            throw new UnauthorizedError($ts`"${header}" header not found`);
        }
        // refused without being checked, and without counting as a guess: a value that cannot be a
        // code tells nobody anything about which code is right
        const { digits } = this.resolveOptions();
        if (!new RegExp(`^\\d{${digits}}$`).test(code)) {
            throw new UnauthorizedError($ts`The provided two factor code is not ${digits} digits long.`);
        }
        return code;
    }

    private async findConfirmedCredentials(userId: string): Promise<TwoFactorCodeCredentials | undefined> {
        return await this.credentialsRepository.findOne({
            where: { userId, channel: this.channel, confirmed: true },
            required: false
        });
    }

    /**
     * Deletes the credentials that match, and the codes that were sent for them.
     * @param where - Which credentials.
     */
    private async deleteCredentials(where: Where<TwoFactorCodeCredentials>): Promise<void> {
        const credentials: TwoFactorCodeCredentials[] = await this.credentialsRepository.findAll({ where });
        if (!credentials.length) {
            return;
        }
        await this.codeRepository.deleteAll({ credentialsId: { oneOf: credentials.map(c => c.id) } });
        await this.credentialsRepository.deleteAll({ id: { oneOf: credentials.map(c => c.id) } });
    }

    /**
     * Takes the user's turn to be sent a code on this channel.
     * @param userId - The user the code goes to.
     * @throws {TooManyRequestsError} When the user was sent a code within the interval.
     */
    private async claimSend(userId: string): Promise<void> {
        const result: RateLimitResult = await inject(TwoFactorCodeRateLimiter).consume(`${this.channel}:${userId}`, 1);
        if (!result.allowed) {
            throw new TooManyRequestsError($ts`A code was sent a moment ago. Wait before asking for another one.`, result);
        }
    }

    private async sendCode(user: BaseUser<string>, credentials: TwoFactorCodeCredentials): Promise<void> {
        const options: ResolvedTwoFactorCodeOptions = this.resolveOptions();
        // 0 up to 10^digits, padded so a code starting with zeros is as likely as any other
        const code: string = randomInt(0, 10 ** options.digits).toString()
            .padStart(options.digits, '0');
        // one code at a time, so a user who asks again can only use the newest
        await this.codeRepository.deleteAll({ credentialsId: credentials.id });
        await this.codeRepository.create({
            credentialsId: credentials.id,
            value: code,
            expirationDate: new Date(Date.now() + options.expiresInMs)
        });
        await this.deliver(user, credentials.destination, code);
    }

    /**
     * Checks a code against the one that was sent for the credentials, and uses it up when it is right.
     * @param credentialsId - The credentials the code was sent for.
     * @param code - The code to check.
     * @throws {InvalidTwoFactorCodeError} When the code is wrong.
     * @throws {UnauthorizedError} When no code is waiting.
     */
    private async useCode(credentialsId: string, code: string): Promise<void> {
        // no lock and no count of wrong codes of its own. A guarded request reaches this only through
        // TwoFactorService, which checks one code per user at a time and makes the user wait longer
        // after each wrong one - that wait is the limit on guessing. Confirming an enrollment is not
        // limited by it, as for every method: guessing there only confirms a factor the guesser cannot pass.
        const row: TwoFactorCode | undefined = await this.codeRepository.findOne({ where: { credentialsId }, required: false });
        if (row == undefined || new Date(row.expirationDate).getTime() <= Date.now()) {
            throw new UnauthorizedError($ts`No code is waiting. Ask for a new one.`);
        }
        if (!this.isSameCode(row.value, code)) {
            throw new InvalidTwoFactorCodeError();
        }
        await this.codeRepository.deleteById(row.id);
    }

    private isSameCode(sent: string, presented: string): boolean {
        // in constant time, so how long a refusal takes says nothing about how many digits were right
        return sent.length === presented.length && timingSafeEqual(Buffer.from(sent), Buffer.from(presented));
    }
}