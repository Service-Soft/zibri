import { InvalidTwoFactorCodeError } from './invalid-two-factor-code.error.ts';
import { ZibriApplication } from '../../application/application.ts';
import { HttpRequestContext } from '../../context/request/http-request.context.ts';
import { WebsocketRequestContext } from '../../context/request/websocket-request.context.ts';
import { Repository } from '../../data-source/repository/repository.ts';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator.ts';
import { Inject } from '../../di/decorators/inject.decorator.ts';
import { Injectable } from '../../di/decorators/injectable.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../di/inject.function.ts';
import { register } from '../../di/register.function.ts';
import { ErrorUtilities } from '../../error-handling/error.utilities.ts';
import { UnauthorizedError } from '../../error-handling/errors/unauthorized.error.ts';
import { InternalError } from '../../error-handling/internal-error.model.ts';
import { OnAppInit } from '../../global/on-app-init.interface.ts';
import { type LeaseServiceInterface } from '../../leases/lease-service.interface.ts';
import { $ts } from '../../localization/translate.function.ts';
import { AuditAction, AuditOutcome } from '../../logging/audit-event.model.ts';
import { auditReasonFor } from '../../logging/audit-reason-for.function.ts';
import { type LoggerInterface } from '../../logging/logger.interface.ts';
import { Ms } from '../../utilities/ms.ts';
import { validateEntitiesRegistered } from '../../utilities/validate-entities-registered.function.ts';
import { BaseUser } from '../models/base-user.model.ts';
import { TwoFactorMethod } from './methods/two-factor-method.interface.ts';
import { TwoFactorFailureLimit, TwoFactorLock } from './two-factor-failure-limit.model.ts';
import { CreateTwoFactorFailureStreakData, TwoFactorFailureStreak } from './two-factor-failure-streak.model.ts';
import { TwoFactorLockedError } from './two-factor-locked.error.ts';
import { TwoFactorMethods } from './two-factor-methods.model.ts';
import { TwoFactorServiceInterface } from './two-factor-service.interface.ts';
import { TwoFactorThrottledError } from './two-factor-throttled.error.ts';

/**
 * Default implementation of the two factor service.
 */
@Injectable({ register: 'onUse' })
export class TwoFactorService implements TwoFactorServiceInterface, OnAppInit {
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    readonly twoFactorMethods: TwoFactorMethods = [];

    private failureLimit: TwoFactorFailureLimit = false;

    // read when used rather than injected, so that an application without the entity is told to
    // declare it by init, instead of failing on a repository token while this is built
    private get failureStreakRepository(): Repository<TwoFactorFailureStreak, CreateTwoFactorFailureStreakData> {
        return inject(repositoryTokenFor(TwoFactorFailureStreak));
    }

    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        private readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.LEASE_SERVICE)
        private readonly leaseService: LeaseServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.TWO_FACTOR_FAILURE_DELAY_IN_MS)
        private readonly failureDelayInMs: number
    ) { }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async onAppInit(app: ZibriApplication): Promise<void> {
        const { twoFactorMethods, twoFactorFailureLimit } = app.options;
        for (const method of twoFactorMethods) {
            register({ token: method, useClass: method });
            this.twoFactorMethods.push(method);
        }
        if (twoFactorMethods.length) {
            validateEntitiesRegistered(TwoFactorService.name, app, TwoFactorFailureStreak);
            this.validateFailureDelay();
            this.failureLimit = twoFactorFailureLimit;
            this.validateFailureLimit();
            this.logger.info(
                `initializes ${twoFactorMethods.length} ${twoFactorMethods.length > 1 ? 'two factor methods' : 'two factor method'}`
            );
            for (const method of twoFactorMethods) {
                this.logger.info(`  - ${method.name}`);
                // built here rather than at the first login that asks for a second factor, so that what
                // a method needs - its entities, its optional peer - is refused while the app starts
                await inject(method).init?.(app);
            }
        }
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async requestRegisterTwoFactorMethodForUser<
        Role extends string,
        UserType extends BaseUser<Role>,
        TwoFactorRequestRegisterData,
        TwoFactorConfirmRegisterData,
        TwoFactorRequestRegisterResult
    >(
        user: UserType,
        method: TwoFactorMethod<TwoFactorRequestRegisterData, TwoFactorConfirmRegisterData, TwoFactorRequestRegisterResult, unknown>,
        data: TwoFactorRequestRegisterData
    ): Promise<TwoFactorRequestRegisterResult> {
        return await method.requestRegisterForUser(user, data);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async startSecondFactor<
        Role extends string,
        UserType extends BaseUser<Role>,
        TwoFactorRequestRegisterData,
        TwoFactorConfirmRegisterData,
        SecondFactorStartType
    >(
        user: UserType,
        method: TwoFactorMethod<TwoFactorRequestRegisterData, TwoFactorConfirmRegisterData, unknown, SecondFactorStartType>
    ): Promise<SecondFactorStartType> {
        return await method.startSecondFactor(user);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async confirmRegisterTwoFactorMethodForUser<
        Role extends string,
        UserType extends BaseUser<Role>,
        TwoFactorRequestRegisterData,
        TwoFactorConfirmRegisterData
    >(
        user: UserType,
        method: TwoFactorMethod<TwoFactorRequestRegisterData, TwoFactorConfirmRegisterData, unknown, unknown>,
        data: TwoFactorConfirmRegisterData
    ): Promise<void> {
        await method.confirmRegisterForUser(user, data);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async unregisterTwoFactorMethodForUser<
        Role extends string,
        UserType extends BaseUser<Role>,
        TwoFactorRequestRegisterData,
        TwoFactorConfirmRegisterData
    >(
        user: UserType,
        method: TwoFactorMethod<TwoFactorRequestRegisterData, TwoFactorConfirmRegisterData, unknown, unknown>
    ): Promise<void> {
        await method.unregisterForUser(user);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async isRegistered(user: BaseUser<string>, allowedMethods: TwoFactorMethods = this.twoFactorMethods): Promise<boolean> {
        const registered: boolean[] = await Promise.all(allowedMethods.map(async m => await inject(m).isRegisteredForUser(user)));
        return registered.includes(true);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async has2fa(
        user: BaseUser<string>,
        context: HttpRequestContext | WebsocketRequestContext,
        allowedMethods: TwoFactorMethods = this.twoFactorMethods
    ): Promise<boolean> {
        try {
            await this.validate2fa(user, context, allowedMethods);
            return true;
        }
        catch (error) {
            // a refusal is the answer "no". Anything else means the question could not be decided,
            // and answering "no" to that is what made an outage look like a wrong code
            if (ErrorUtilities.isRefusal(error)) {
                return false;
            }
            throw error;
        }
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async validate2fa(
        user: BaseUser<string>,
        context: HttpRequestContext | WebsocketRequestContext,
        allowedMethods: TwoFactorMethods = this.twoFactorMethods
    ): Promise<void> {
        try {
            // the HAS_2FA token asks this with every registered method, so a route that named a subset
            // would be told yes by a factor it does not accept. Reading the token here would also make
            // it its own dependency, since the token is what calls this.
            const checked: boolean | undefined = await this.leaseService.withLease(
                {
                    // one check per user at a time, on every instance. Reading the streak, checking the
                    // code and writing the streak are three steps, and without this a guesser sends a
                    // hundred codes at once and every one of them reads the same streak before any
                    // of them has written it - the parallel sessions that undid AuthQuake's limit.
                    key: `2fa:${user.id}`,
                    leaseInMs: Ms.SECOND * 30,
                    mode: 'skip',
                    onCompletion: 'release'
                },
                async () => {
                    await this.validateWithinStreak(user, context, allowedMethods);
                    return true;
                }
            );
            if (checked !== true) {
                // another code for this user is being checked right now. Refused rather than
                // queued, since queueing is exactly how the parallel guesses would get their turn
                throw new TwoFactorThrottledError(new Date(Date.now() + Ms.SECOND));
            }
        }
        catch (error) {
            // every method's error is kept, so a wrong code and a data source that is down stay
            // apart in the trail
            this.logger.audit({
                action: AuditAction.TWO_FACTOR,
                outcome: AuditOutcome.FAILURE,
                reason: auditReasonFor(error),
                userId: user.id
            });
            throw error;
        }
    }

    /**
     * Checks the request's second factor, unless the user still has to wait, and keeps the streak of
     * wrong codes up to date.
     * @param user - The user the second factor is for.
     * @param context - The request presenting it.
     * @param allowedMethods - The methods that may satisfy it.
     * @throws {TwoFactorThrottledError} When the user still has to wait.
     * @throws When no allowed method accepts the request.
     */
    private async validateWithinStreak(
        user: BaseUser<string>,
        context: HttpRequestContext | WebsocketRequestContext,
        allowedMethods: TwoFactorMethods
    ): Promise<void> {
        const streak: TwoFactorFailureStreak | undefined = await this.failureStreakRepository.findOne({
            where: { userId: user.id },
            required: false
        });
        if (streak && streak.retryAt.getTime() > Date.now()) {
            // refused without being checked. Checking it and only delaying the answer would still
            // tell the guesser whether this code was the one
            throw new TwoFactorThrottledError(streak.retryAt);
        }
        const locked: boolean = this.isLocked(streak);
        // while locked, the locked methods are not checked at all - only the way back is. A guess at a
        // recovery code still counts towards the wait
        const methods: TwoFactorMethods = locked
            ? allowedMethods.filter(m => inject(m).unlocksLockedFactors === true)
            : allowedMethods;
        if (!methods.length && locked) {
            throw new TwoFactorLockedError();
        }

        try {
            await Promise.any(methods.map(async m => await inject(m).validate(user, context)));
        }
        catch (error) {
            await this.handleValidateError(error, user, streak, locked);
        }

        if (locked) {
            // the methods the lock disabled stay disabled: the user proved the account another way,
            // and enrolls a new authenticator rather than going back to the one being guessed at
            await this.removeSecondFactors(user, this.twoFactorMethods.filter(m => inject(m).unlocksLockedFactors !== true));
        }
        if (streak) {
            await this.failureStreakRepository.deleteById(streak.id);
        }
    }

    private async handleValidateError(
        error: unknown,
        user: BaseUser<string>,
        streak: TwoFactorFailureStreak | undefined,
        locked: boolean
    ): Promise<void> {
        const errors: unknown[] = error instanceof AggregateError ? error.errors : [error];
        // only a wrong code is a guess. No code, a malformed one or one already spent tells the
        // caller nothing about which code is right, and counting them would make a client that
        // simply asks before it has a code pay for it
        const guessed: boolean = errors.some(e => e instanceof InvalidTwoFactorCodeError);
        if (guessed && await this.recordFailure(user.id, streak)) {
            throw new TwoFactorLockedError({ cause: error });
        }
        // a locked user who sent no recovery code is told why nothing was checked, rather than
        // that a header of a method they have no use for right now is missing
        if (locked && !guessed) {
            throw new TwoFactorLockedError({ cause: error });
        }
        throw this.resolveRefusal(error, errors);
    }

    /**
     * Whether a streak has locked its user's second factor, under the limit the application sets now.
     * @param streak - The streak, if there is one.
     * @returns True when it is locked.
     */
    private isLocked(streak: TwoFactorFailureStreak | undefined): boolean {
        // under the limit set now rather than the one set when the lock was: an application that turns
        // the limit off has lifted every lock with it
        return this.failureLimit !== false && streak?.lockedAt != undefined;
    }

    /**
     * Adds a wrong code to the user's streak, moves the next check out accordingly, and locks the
     * user's second factor once the streak reaches the limit.
     * @param userId - The user the code was presented for.
     * @param streak - The streak so far, if there is one.
     * @returns Whether this wrong code locked the second factor.
     */
    private async recordFailure(userId: string, streak: TwoFactorFailureStreak | undefined): Promise<boolean> {
        const count: number = (streak?.count ?? 0) + 1;
        // doubling with no ceiling, which makes the wait the main limit: the n-th wrong code in a row
        // costs 2^(n-1) times the delay, so a guesser gets a few dozen codes a year while a typo costs
        // a second. The optional hard limit on top caps the total chance of a hit rather than its rate
        // (NIST 800-63B allows disabling the factor after at most 100 in a row); with the doubling it is
        // only ever reached at small values, see evaluation/03 §C3.
        const retryAt: Date = new Date(Date.now() + (this.failureDelayInMs * (2 ** (count - 1))));
        const locks: boolean = this.failureLimit !== false && streak?.lockedAt == undefined && count >= this.failureLimit.maxFailures;
        // null rather than undefined, so an update that does not lock keeps the column as it is
        // eslint-disable-next-line unicorn/no-null
        const lockedAt: Date | null = locks ? new Date() : streak?.lockedAt ?? null;
        await (streak
            ? this.failureStreakRepository.updateById(streak.id, { count, retryAt, lockedAt })
            : this.failureStreakRepository.create({ userId, count, retryAt, lockedAt }));
        if (locks) {
            await this.lock(userId);
        }
        return locks;
    }

    /**
     * Does what locking a user's second factor does beyond recording it.
     * @param userId - The user whose second factor was locked.
     */
    private async lock(userId: string): Promise<void> {
        this.logger.audit({ action: AuditAction.TWO_FACTOR_LOCKED, outcome: AuditOutcome.SUCCESS, userId });
        if (this.failureLimit !== false && this.failureLimit.lock === 'account') {
            // ended rather than left to expire: whoever is guessing already holds a session, since
            // presenting a code takes one, and refusing new logins alone would leave them that
            await inject(ZIBRI_DI_TOKENS.AUTH_SERVICE).endLogins(userId, undefined);
        }
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async resolveLock(user: BaseUser<string>): Promise<TwoFactorLock | undefined> {
        // asked on every login, so an application without a limit is not charged a read for it
        if (this.failureLimit === false) {
            return undefined;
        }
        const streak: TwoFactorFailureStreak | undefined = await this.failureStreakRepository.findOne({
            where: { userId: user.id },
            required: false
        });
        return this.isLocked(streak) ? this.failureLimit.lock : undefined;
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async resetSecondFactors(user: BaseUser<string>): Promise<void> {
        await this.removeSecondFactors(user, this.twoFactorMethods);
        await this.failureStreakRepository.deleteAll({ userId: user.id });
    }

    /**
     * Removes the given methods from a user, and records it.
     * @param user - The user.
     * @param methods - The methods to remove.
     */
    private async removeSecondFactors(user: BaseUser<string>, methods: TwoFactorMethods): Promise<void> {
        await Promise.all(methods.map(async m => await inject(m).unregisterForUser(user)));
        this.logger.audit({ action: AuditAction.TWO_FACTOR_RESET, outcome: AuditOutcome.SUCCESS, userId: user.id });
    }

    /**
     * What to answer once every allowed method has refused.
     * @param error - What the methods threw together.
     * @param errors - Each method's error.
     * @returns The error to throw.
     */
    private resolveRefusal(error: unknown, errors: unknown[]): unknown {
        // a method that could not answer at all leaves the second factor undecided. Answering 401
        // would send a client to ask its user for a new code against a store that is down
        const failure: unknown = errors.find(e => !ErrorUtilities.isRefusal(e));
        if (failure != undefined || !errors.length) {
            // an empty list means nothing was tried, which is a configuration problem
            return failure ?? error;
        }
        // one method's refusal says why - a wrong code, a used one, none at all. With several, each
        // describes a factor the caller may never have meant to present, so none of them is the answer
        return errors.length === 1
            ? errors[0]
            : new UnauthorizedError($ts`You need to provide a second factor to access this route.`);
    }

    private validateFailureLimit(): void {
        if (this.failureLimit === false) {
            return;
        }
        const { maxFailures } = this.failureLimit;
        // 100 is NIST 800-63B's ceiling for disabling a factor; fewer than one would lock on no failure
        if (!Number.isInteger(maxFailures) || maxFailures < 1 || maxFailures > 100) {
            throw new InternalError(`twoFactorFailureLimit.maxFailures must be a whole number from 1 to 100, got ${maxFailures}.`);
        }
    }

    private validateFailureDelay(): void {
        // zero would switch the limit off, and a negative delay is no delay either
        if (!(this.failureDelayInMs > 0)) {
            throw new InternalError(
                `TWO_FACTOR_FAILURE_DELAY_IN_MS must be greater than 0, got ${this.failureDelayInMs}.`
            );
        }
    }
}