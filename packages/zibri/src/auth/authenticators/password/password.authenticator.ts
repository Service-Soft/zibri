import { randomBytes } from 'node:crypto';

import { ChangePasswordData } from './change-password-data.model';
import { ConfirmPasswordResetData } from './confirm-password-reset-data.model';
import { PasswordCredentials, PasswordCredentialsCreateData, PasswordCredentialsDto } from './password-credentials.model';
import { PasswordFailureLimit } from './password-failure-limit.model';
import { PasswordFailureStreak, PasswordFailureStreakCreateData } from './password-failure-streak.model';
import { PasswordResetEmailTemplate } from './password-reset-email-template.model';
import { RequestPasswordResetData } from './request-password-reset-data.model';
import { ZibriApplication } from '../../../application/application';
import { Repository } from '../../../data-source/repository/repository';
import { type RepositoryTransaction } from '../../../data-source/transaction/repository-transaction.type';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { Inject } from '../../../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { NoProviderError } from '../../../di/errors/no-provider.error';
import { inject } from '../../../di/inject.function';
import { type EmailServiceInterface } from '../../../email/email-service.interface';
import { EmailPriority } from '../../../email/models/email-priority.enum';
import { BadRequestError } from '../../../error-handling/errors/bad-request.error';
import { EmailNotVerifiedError } from '../../../error-handling/errors/email-not-verified.error';
import { ForbiddenError } from '../../../error-handling/errors/forbidden.error';
import { HttpError } from '../../../error-handling/errors/http.error';
import { PasswordLockedError } from '../../../error-handling/errors/password-locked.error';
import { UnauthorizedError } from '../../../error-handling/errors/unauthorized.error';
import { InternalError } from '../../../error-handling/internal-error.model';
import { $ts } from '../../../localization/translate.function';
import { AuditAction, AuditOutcome } from '../../../logging/audit-event.model';
import { TsxUtilities } from '../../../tsx/tsx.utilities';
import { Newable } from '../../../types/newable.type';
import { validateEntitiesRegistered } from '../../../utilities/validate-entities-registered.function';
import { type EmailVerificationServiceInterface } from '../../email-verification/email-verification-service.interface';
import { type HashServiceInterface } from '../../hash/hash-service.interface';
import type { HashString } from '../../hash/hash.utilities';
import { Sha256HashStrategy } from '../../hash/strategies/sha256.hash-strategy';
import { Authentication } from '../../models/authentication.model';
import { BaseUser } from '../../models/base-user.model';
import { LoginTicket } from '../../models/login-ticket.model';
import { PasswordResetToken, PasswordResetTokenCreateData } from '../../models/password-reset-token.model';
import { PasswordPolicy } from '../../password-policy/password-policy.model';
import { PasswordPolicyUtilities } from '../../password-policy/password-policy.utilities';
import { type UserServiceInterface } from '../../user/user-service.interface';
import { AuthControllerAuthenticatorInterface } from '../auth-controller-authenticator.interface';

/**
 * Authenticates a user by email and password, and resets a forgotten password by email.
 */
export class PasswordAuthenticator<
    RoleType extends string,
    UserType extends BaseUser<RoleType> = BaseUser<RoleType>
> implements AuthControllerAuthenticatorInterface<RoleType, UserType, PasswordCredentialsDto> {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly name: string = 'password';

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly credentialsModel: Newable<PasswordCredentialsDto> = PasswordCredentialsDto;

    private readonly confirmPasswordResetUrl: string;
    private readonly PasswordResetEmail: PasswordResetEmailTemplate<RoleType, UserType>;
    private dummyPasswordHashPromise: Promise<HashString> | undefined;
    private failureLimit: PasswordFailureLimit = false;

    // read when used rather than injected, so that an application without the entities is told which
    // ones to declare by init, instead of failing on a repository token while this is built
    private get credentialsRepository(): Repository<PasswordCredentials, PasswordCredentialsCreateData> {
        return inject(repositoryTokenFor(PasswordCredentials));
    }

    private get passwordResetTokenRepository(): Repository<PasswordResetToken, PasswordResetTokenCreateData> {
        return inject(repositoryTokenFor(PasswordResetToken));
    }

    private get failureStreakRepository(): Repository<PasswordFailureStreak, PasswordFailureStreakCreateData> {
        return inject(repositoryTokenFor(PasswordFailureStreak));
    }

    constructor(
        @Inject(ZIBRI_DI_TOKENS.PASSWORD_RESET_TOKEN_EXPIRES_IN_MS)
        private readonly passwordResetTokenExpiresInMs: number,
        @Inject(ZIBRI_DI_TOKENS.USER_SERVICE)
        private readonly userService: UserServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.EMAIL_SERVICE)
        private readonly emailService: EmailServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.HASH_SERVICE)
        private readonly hashService: HashServiceInterface
    ) {
        const confirmPasswordResetUrl: string | undefined = inject(ZIBRI_DI_TOKENS.CONFIRM_PASSWORD_RESET_URL);
        if (!confirmPasswordResetUrl) {
            throw new NoProviderError(ZIBRI_DI_TOKENS.CONFIRM_PASSWORD_RESET_URL, []);
        }
        const PasswordResetEmail: PasswordResetEmailTemplate<RoleType, UserType> | undefined = inject(
            ZIBRI_DI_TOKENS.PASSWORD_RESET_EMAIL_TEMPLATE
        );
        if (!PasswordResetEmail) {
            throw new NoProviderError(ZIBRI_DI_TOKENS.PASSWORD_RESET_EMAIL_TEMPLATE, []);
        }
        this.confirmPasswordResetUrl = confirmPasswordResetUrl;
        this.PasswordResetEmail = PasswordResetEmail;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    init(app: ZibriApplication): void {
        // the ticket too: any login can be the one that has to choose a new password first
        validateEntitiesRegistered(PasswordAuthenticator.name, app, PasswordCredentials, PasswordResetToken, LoginTicket);
        this.failureLimit = app.options.passwordFailureLimit;
        if (this.failureLimit !== false) {
            validateEntitiesRegistered(PasswordAuthenticator.name, app, PasswordFailureStreak);
            this.validateFailureLimit();
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async deleteUserRows(userIds: string[], transaction: RepositoryTransaction): Promise<void> {
        await this.credentialsRepository.deleteAll({ userId: { oneOf: userIds } }, { transaction });
        await this.passwordResetTokenRepository.deleteAll({ userId: { oneOf: userIds } }, { transaction });
        // only an application that limits failed passwords declares the streaks
        if (this.failureLimit !== false) {
            await this.failureStreakRepository.deleteAll({ userId: { oneOf: userIds } }, { transaction });
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async authenticate(
        credentials: PasswordCredentialsDto,
        transaction: RepositoryTransaction | undefined
    ): Promise<Authentication<UserType>> {
        try {
            const foundUser: UserType | undefined = await this.userService.findByEmail(credentials.email, { required: false });
            // a user can exist without a password - created by an admin, or logged in some other way -
            // and that has to answer the same as a wrong password. A store that cannot be read is a
            // fault rather than a missing password, and surfaces as one below
            const stored: PasswordCredentials | undefined = foundUser == undefined
                ? undefined
                : await this.credentialsRepository.findOne({ where: { userId: foundUser.id }, transaction, required: false });
            const storedPassword: HashString | undefined = stored?.password;

            // one comparison on every path, against a stand-in when there is nothing to compare
            // against. An unknown address used to answer before any key derivation ran while a known
            // one waited for a full scrypt, which made the response time an account existence oracle
            // - readable from anywhere, and unaffected by the messages being identical.
            const standIn: HashString = await this.resolveDummyPasswordHash();
            // and never quicker than the stand-in: a hash keeps the cost it was made at, so a user who
            // has not logged in since the cost was raised holds one that answers sooner than an
            // address nobody has. Compared against the stand-in as well, on the machine as it is at
            // this moment: a wait padding to a duration recorded at a quieter one fell short of a
            // comparison made under load, and the account was readable from the response time again.
            // The second derivation is paid until the next right password upgrades the hash
            const comparisons: (boolean | Promise<boolean>)[] = [this.hashService.equal(credentials.password, storedPassword ?? standIn)];
            if (storedPassword != undefined && await this.hashService.needsRehash(storedPassword)) {
                comparisons.push(this.hashService.equal(credentials.password, standIn));
            }
            const [passwordMatched = false] = await Promise.all(comparisons);
            if (foundUser == undefined || stored == undefined || storedPassword == undefined || !passwordMatched) {
                if (foundUser != undefined) {
                    await this.recordWrongPassword(foundUser.id);
                }
                throw new UnauthorizedError($ts`Invalid email or password.`);
            }
            // after the comparison, whatever it says: a lock that skipped the hash would be readable
            // from the response time
            const streak: PasswordFailureStreak | undefined = await this.findFailureStreak(foundUser.id);
            this.validateNotLocked(streak);
            if (streak != undefined) {
                // the right password ends the streak
                await this.failureStreakRepository.deleteById(streak.id);
            }
            const passwordChangeRequired: boolean = stored.changeRequired || await this.isRefusedOutdatedPassword(credentials.password);
            // a password about to be replaced is not worth hashing again
            if (!passwordChangeRequired) {
                await this.upgradeStoredPassword(foundUser, credentials.password, storedPassword);
            }
            const verification: EmailVerificationServiceInterface = inject(ZIBRI_DI_TOKENS.EMAIL_VERIFICATION_SERVICE);
            if (verification.isRequiredForLogin && foundUser.emailVerifiedAt == undefined) {
                // after the password, like the lock, so it says nothing to whoever does not know it. With a
                // link to verify the address, outside the login's transaction, which the refusal rolls back
                await verification.requestEmailVerification(foundUser.id, undefined);
                throw new EmailNotVerifiedError();
            }
            return { user: foundUser, authenticatedAt: new Date(), passwordChangeRequired };
        }
        catch (error) {
            // the refusals that say more than "wrong", once the password matched: a lock to the trail
            // only, its message is the same, and an address to verify to the user, who has to act on it
            if (error instanceof PasswordLockedError || error instanceof EmailNotVerifiedError) {
                throw error;
            }
            // every way of being refused answers the same, or the difference says whether the address
            // is registered. A fault is not one of those, and folding it in made a user store that is
            // down answer exactly like a wrong password - to the caller, and in the audit trail, where
            // an outage then reads as a credential stuffing run. It surfaces as a masked 500 instead.
            if (!(error instanceof HttpError)) {
                throw error;
            }
            throw new UnauthorizedError($ts`Invalid email or password.`);
        }
    }

    /**
     * Mails the user a link to reset their password with.
     *
     * Does nothing while an earlier link is still valid.
     * @param data - The user, and overrides for the email.
     */
    async requestPasswordReset(data: RequestPasswordResetData<RoleType, UserType>): Promise<void> {
        // a link to whatever address somebody typed in would hand the account to its holder
        inject(ZIBRI_DI_TOKENS.EMAIL_VERIFICATION_SERVICE).validateEmailVerified(data.user);
        if (await this.activePasswordResetTokenAlreadyExists(data.user, data.transaction)) {
            // silently, because answering differently here told an unauthenticated caller that the
            // address exists *and* that somebody recently asked to reset it. One live token at a
            // time is still the rule - the account already has a usable one in its inbox, so there
            // is nothing to do rather than something to refuse.
            return;
        }

        // kept here, because it does not survive being stored: the property is hashed on the way in,
        // so the created entity holds the hash and this is the only moment the token itself exists.
        // Reading it back off the entity mailed the user a hash of their own token.
        const tokenValue: string = randomBytes(16).toString('hex');
        const resetTokenData: PasswordResetTokenCreateData = {
            value: tokenValue,
            userId: data.user.id,
            expirationDate: new Date(Date.now() + this.passwordResetTokenExpiresInMs)
        };
        await this.passwordResetTokenRepository.create(resetTokenData, { transaction: data.transaction });

        const html: string = TsxUtilities.renderEmail(
            this.PasswordResetEmail,
            {
                user: data.user,
                confirmPasswordResetLink: `${data.emailData?.confirmPasswordResetUrl ?? this.confirmPasswordResetUrl}/${tokenValue}`
            }
        );

        await this.emailService.queue({
            recipients: [data.user.email],
            subject: $ts`Password Reset`,
            html,
            priority: EmailPriority.HIGH,
            ...data.emailData,
            // after the spread, so an application cannot ask for this one to be kept. The mail body
            // carries the token in the clear - that is what a reset link is - and the queue row is
            // deleted once it is sent. Retaining it would put back exactly the readable token that
            // hashing the stored value removed, and keep it long after the token itself expired.
            persist: false
        });
    }

    /**
     * Whether a reset link still resets a password: its token is known, has not expired, and its user
     * still exists. An expired token is removed along the way.
     * @param resetToken - The token from the link.
     * @returns True when the link still works.
     */
    async isPasswordResetTokenValid(resetToken: string): Promise<boolean> {
        // hashed to be searched for, because that is how it is stored
        const value: HashString = await this.hashService.hash(resetToken, { strategy: Sha256HashStrategy });
        const found: PasswordResetToken | undefined = await this.passwordResetTokenRepository.findOne(
            { where: { value }, required: false }
        );
        if (!found) {
            return false;
        }
        if (new Date(found.expirationDate).getTime() <= Date.now()) {
            await this.passwordResetTokenRepository.deleteById(found.id);
            return false;
        }
        try {
            await this.userService.findById(found.userId);
            return true;
        }
        catch {
            return false;
        }
    }

    /**
     * Sets a new password for the user a reset link was sent to.
     *
     * Ending the user's logins is not part of this: they live in the auth strategies, and
     * `AuthService.confirmPasswordReset` ends them in every one of them.
     * @param data - The token from the link, and the new password.
     * @returns The id of the user whose password was reset.
     * @throws When the token is unknown or has expired.
     */
    async confirmPasswordReset(data: ConfirmPasswordResetData): Promise<string> {
        const resetToken: PasswordResetToken | undefined = await this.passwordResetTokenRepository.findOne(
            {
                // hashed to be searched for, because that is how it is stored
                where: { value: await this.hashService.hash(data.resetToken, { strategy: Sha256HashStrategy }) },
                transaction: data.transaction,
                required: false
            }
        );
        if (!resetToken) {
            throw new UnauthorizedError($ts`Link invalid`);
        }
        if (new Date(resetToken.expirationDate).getTime() <= Date.now()) {
            await this.passwordResetTokenRepository.deleteById(resetToken.id, { transaction: data.transaction });
            throw new UnauthorizedError($ts`Link expired`);
        }

        // the user rather than the token's userId alone, so a token outliving its user is refused. The
        // stored password is read rather than updated blindly, because an update that matches no row
        // succeeds: a user without a password would be told theirs was reset and still have none
        const user: UserType = await this.userService.findById(resetToken.userId);
        const credentials: PasswordCredentials = await this.credentialsRepository.findOne(
            { where: { userId: user.id }, transaction: data.transaction }
        );
        // a new password is what a required change waits for
        await this.credentialsRepository.updateById(
            credentials.id,
            { password: data.newPassword, changeRequired: false },
            { transaction: data.transaction }
        );
        await this.passwordResetTokenRepository.deleteById(resetToken.id, { transaction: data.transaction });
        if (this.failureLimit !== false) {
            // the user proved the mailbox is theirs, which is what a lock was waiting for
            await this.failureStreakRepository.deleteAll({ userId: user.id }, { transaction: data.transaction });
        }
        return user.id;
    }

    /**
     * Sets a new password for a user who knows the one they have.
     *
     * Ending the user's other logins is not part of this, for the reason `confirmPasswordReset` gives:
     * `AuthService.changePassword` ends them.
     * @param user - The user, as the request asking is logged in as.
     * @param data - The current password, the new one, and the transaction.
     * @throws A ForbiddenError when the current password is wrong, and PasswordLockedError while the
     * account is locked.
     */
    async changePassword(user: UserType, data: ChangePasswordData): Promise<void> {
        try {
            // the way a login checks it, so a wrong one counts against the streak and a locked account
            // stays locked: a stolen session would otherwise be a place to guess passwords at no cost
            await this.authenticate({ email: user.email, password: data.currentPassword }, data.transaction);
        }
        catch (error) {
            if (error instanceof PasswordLockedError || !(error instanceof UnauthorizedError)) {
                throw error;
            }
            // not the 401 of a login: the caller is logged in, and a 401 sends a client to refresh and
            // ask again
            throw new ForbiddenError($ts`The current password is wrong.`, { cause: error });
        }
        // read rather than updated blindly, for the reason confirmPasswordReset gives
        const credentials: PasswordCredentials = await this.credentialsRepository.findOne(
            { where: { userId: user.id }, transaction: data.transaction }
        );
        await this.credentialsRepository.updateById(
            credentials.id,
            { password: data.newPassword, changeRequired: false },
            { transaction: data.transaction }
        );
    }

    /**
     * Has a user choose a new password before their next login starts.
     *
     * Ending the user's logins is not part of this, for the reason `confirmPasswordReset` gives:
     * `AuthService.requirePasswordChange` ends them.
     * @param userId - The user.
     * @param transaction - The transaction to run in, if any.
     * @throws A NotFoundError when the user has no password.
     */
    async requirePasswordChange(userId: string, transaction: RepositoryTransaction | undefined): Promise<void> {
        // read rather than updated blindly, for the reason confirmPasswordReset gives
        const credentials: PasswordCredentials = await this.credentialsRepository.findOne({ where: { userId }, transaction });
        await this.credentialsRepository.updateById(credentials.id, { changeRequired: true }, { transaction });
    }

    /**
     * Sets the new password a login waits for, once the login proved the user knows the one they have.
     * @param user - The user the login is for.
     * @param newPassword - The new password.
     * @param transaction - The transaction to run in, if any.
     * @throws A BadRequestError when the new password is the one the user has, and what the password
     * policy throws for one it refuses.
     */
    async changePasswordAtLogin(user: UserType, newPassword: string, transaction: RepositoryTransaction | undefined): Promise<void> {
        const credentials: PasswordCredentials = await this.credentialsRepository.findOne({ where: { userId: user.id }, transaction });
        // a change asked for after a breach is no change when the password stays what it was
        if (await this.hashService.equal(newPassword, credentials.password)) {
            throw new BadRequestError($ts`Choose a password other than the one you have.`);
        }
        await this.credentialsRepository.updateById(credentials.id, { password: newPassword, changeRequired: false }, { transaction });
    }

    /**
     * Counts a wrong password against the user, and locks the account once the streak reaches the
     * application's limit.
     *
     * Outside the login's transaction, which the refusal rolls back.
     * @param userId - The user the password was presented for.
     */
    private async recordWrongPassword(userId: string): Promise<void> {
        if (this.failureLimit === false) {
            return;
        }
        const streak: PasswordFailureStreak | undefined = await this.findFailureStreak(userId);
        // a lock that has passed ends the streak too, or the first wrong password after it would lock again
        const count: number = streak == undefined || this.hasLockPassed(streak) ? 1 : streak.count + 1;
        const locks: boolean = count >= this.failureLimit.maxFailures && !this.isLocked(streak);
        // null rather than undefined, so an update that does not lock keeps the column as it is
        // eslint-disable-next-line unicorn/no-null
        const lockedUntil: Date | null = locks ? new Date(Date.now() + this.failureLimit.lockForInMs) : streak?.lockedUntil ?? null;
        await (streak
            ? this.failureStreakRepository.updateById(streak.id, { count, lockedUntil })
            : this.failureStreakRepository.create({ userId, count, lockedUntil }));
        if (locks) {
            inject(ZIBRI_DI_TOKENS.AUDIT_SERVICE).record({ action: AuditAction.PASSWORD_LOCKED, outcome: AuditOutcome.SUCCESS, userId });
        }
    }

    /**
     * The user's streak of wrong passwords, if the application counts them and there is one.
     * @param userId - The user.
     * @returns The streak.
     */
    private async findFailureStreak(userId: string): Promise<PasswordFailureStreak | undefined> {
        return this.failureLimit === false ? undefined : await this.failureStreakRepository.findOne({ where: { userId }, required: false });
    }

    /**
     * Refuses a streak that has locked its account.
     * @param streak - The streak, if there is one.
     * @throws PasswordLockedError while the lock lasts.
     */
    private validateNotLocked(streak: PasswordFailureStreak | undefined): void {
        if (this.isLocked(streak)) {
            throw new PasswordLockedError();
        }
    }

    private isLocked(streak: PasswordFailureStreak | undefined): boolean {
        return streak?.lockedUntil != undefined && new Date(streak.lockedUntil).getTime() > Date.now();
    }

    private hasLockPassed(streak: PasswordFailureStreak): boolean {
        return streak.lockedUntil != undefined && !this.isLocked(streak);
    }

    private validateFailureLimit(): void {
        if (this.failureLimit === false) {
            return;
        }
        const { maxFailures, lockForInMs } = this.failureLimit;
        // 100 is NIST 800-63B's ceiling for consecutive failures; fewer than one would lock on none
        if (!Number.isInteger(maxFailures) || maxFailures < 1 || maxFailures > 100) {
            throw new InternalError(`passwordFailureLimit.maxFailures must be a whole number from 1 to 100, got ${maxFailures}.`);
        }
        if (!(lockForInMs > 0)) {
            throw new InternalError(`passwordFailureLimit.lockForInMs must be greater than 0, got ${lockForInMs}.`);
        }
    }

    /**
     * Re-hashes a password that was just proven correct, if the stored hash is out of date.
     *
     * Here because this is the one moment the plaintext exists, and the user and stored hash are
     * already loaded.
     *
     * Deliberately does not fail the login: the caller proved who they are, and a write that did not
     * happen is a hash that stays old rather than a reason to refuse them.
     * @param user - The user that just logged in.
     * @param password - The plaintext they logged in with.
     * @param storedPassword - The hash it was compared against.
     */
    private async upgradeStoredPassword(user: UserType, password: string, storedPassword: HashString): Promise<void> {
        try {
            if (!await this.hashService.needsRehash(storedPassword)) {
                return;
            }
            // a password set before the policy asked for more is refused by the write below, and the
            // hash it has still verifies it. Kept as it is, without a warning on every login
            if (!await this.isAllowedByPolicy(password)) {
                return;
            }
            // written as plaintext on purpose: the entity hook hashes it on the way in, with whatever
            // the current strategy and cost are, which is the whole point of the upgrade
            await this.credentialsRepository.updateAll({ userId: user.id }, { password });
        }
        catch (error) {
            inject(ZIBRI_DI_TOKENS.LOGGER).warn(
                `Could not upgrade the stored password hash for user ${user.id}: ${String(error)}`
            );
        }
    }

    /**
     * Whether a password the user just proved is one the policy refuses and has them replace.
     * @param password - The password.
     * @returns True when the policy says `'requireChange'` and refuses the password.
     */
    private async isRefusedOutdatedPassword(password: string): Promise<boolean> {
        // asked only when it decides something, since the policy's own check may be a request elsewhere
        return inject(ZIBRI_DI_TOKENS.PASSWORD_POLICY)?.outdatedPasswords === 'requireChange'
            && !await this.isAllowedByPolicy(password);
    }

    /**
     * Whether the password policy takes a password.
     * @param password - The password.
     * @returns False when the policy refuses it, true when it takes it or the application provides none.
     */
    private async isAllowedByPolicy(password: string): Promise<boolean> {
        const policy: PasswordPolicy | undefined = inject(ZIBRI_DI_TOKENS.PASSWORD_POLICY);
        if (policy == undefined) {
            return true;
        }
        try {
            await PasswordPolicyUtilities.validatePassword(password, policy);
            return true;
        }
        catch {
            return false;
        }
    }

    /**
     * Something to compare a password against when there is nothing real to compare it against.
     *
     * Hashed from a value nobody holds, with the default strategy, so a comparison against it costs
     * what a comparison against a real password costs and follows a change of strategy for free.
     * Computed once and reused - the very first miss in a process pays for producing it, which is
     * one request out of all of them.
     * @returns The stand-in hash.
     */
    private async resolveDummyPasswordHash(): Promise<HashString> {
        this.dummyPasswordHashPromise ??= Promise.resolve(this.hashService.hash(randomBytes(32).toString('hex')));
        return await this.dummyPasswordHashPromise;
    }

    private async activePasswordResetTokenAlreadyExists(user: BaseUser<RoleType>, transaction: RepositoryTransaction): Promise<boolean> {
        const existingToken: PasswordResetToken | undefined = await this.passwordResetTokenRepository.findOne(
            { where: { userId: user.id }, transaction, required: false }
        );
        if (existingToken) {
            if (new Date(existingToken.expirationDate).getTime() > Date.now()) {
                return true;
            }
            await this.passwordResetTokenRepository.deleteById(existingToken.id, { transaction });
        }
        return false;
    }
}