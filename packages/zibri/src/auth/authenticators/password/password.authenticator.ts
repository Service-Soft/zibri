import { randomBytes } from 'node:crypto';

import { ConfirmPasswordResetData } from './confirm-password-reset-data.model';
import { PasswordCredentials, PasswordCredentialsCreateData, PasswordCredentialsDto } from './password-credentials.model';
import { PasswordResetEmailTemplate } from './password-reset-email-template.model';
import { RequestPasswordResetData } from './request-password-reset-data.model';
import { ZibriApplication } from '../../../application/application';
import { Repository } from '../../../data-source/repository/repository';
import { Transaction } from '../../../data-source/transaction/transaction.model';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { Inject } from '../../../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { NoProviderError } from '../../../di/errors/no-provider.error';
import { inject } from '../../../di/inject.function';
import { type EmailServiceInterface } from '../../../email/email-service.interface';
import { EmailPriority } from '../../../email/models/email-priority.enum';
import { HttpError } from '../../../error-handling/errors/http.error';
import { UnauthorizedError } from '../../../error-handling/errors/unauthorized.error';
import { $ts } from '../../../localization/translate.function';
import { TsxUtilities } from '../../../tsx/tsx.utilities';
import { Newable } from '../../../types/newable.type';
import { validateEntitiesRegistered } from '../../../utilities/validate-entities-registered.function';
import { type HashServiceInterface } from '../../hash/hash-service.interface';
import type { HashString } from '../../hash/hash.utilities';
import { Sha256HashStrategy } from '../../hash/strategies/sha256.hash-strategy';
import { Authentication } from '../../models/authentication.model';
import { BaseUser } from '../../models/base-user.model';
import { PasswordResetToken, PasswordResetTokenCreateData } from '../../models/password-reset-token.model';
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

    // read when used rather than injected, so that an application without the entities is told which
    // ones to declare by init, instead of failing on a repository token while this is built
    private get credentialsRepository(): Repository<PasswordCredentials, PasswordCredentialsCreateData> {
        return inject(repositoryTokenFor(PasswordCredentials));
    }

    private get passwordResetTokenRepository(): Repository<PasswordResetToken, PasswordResetTokenCreateData> {
        return inject(repositoryTokenFor(PasswordResetToken));
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
        validateEntitiesRegistered(PasswordAuthenticator.name, app, PasswordCredentials, PasswordResetToken);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async authenticate(credentials: PasswordCredentialsDto, transaction: Transaction | undefined): Promise<Authentication<UserType>> {
        try {
            const foundUser: UserType | undefined = await this.userService.findByEmail(credentials.email, { required: false });
            // a user can exist without a password - created by an admin, or signed in some other way -
            // and that has to answer the same as a wrong password. A store that cannot be read is a
            // fault rather than a missing password, and surfaces as one below
            const storedPassword: HashString | undefined = foundUser == undefined
                ? undefined
                : (await this.credentialsRepository.findOne({ where: { userId: foundUser.id }, transaction, required: false }))?.password;

            // one comparison on every path, against a stand-in when there is nothing to compare
            // against. An unknown address used to answer before any key derivation ran while a known
            // one waited for a full scrypt, which made the response time an account existence oracle
            // - readable from anywhere, and unaffected by the messages being identical.
            const passwordMatched: boolean = await this.hashService.equal(
                credentials.password,
                storedPassword ?? await this.resolveDummyPasswordHash()
            );
            if (foundUser == undefined || storedPassword == undefined || !passwordMatched) {
                throw new UnauthorizedError($ts`Invalid email or password.`);
            }
            await this.upgradeStoredPassword(foundUser, credentials.password, storedPassword);
            return { user: foundUser, authenticatedAt: new Date() };
        }
        catch (error) {
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
            subject: 'Password Reset',
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
        await this.credentialsRepository.updateById(credentials.id, { password: data.newPassword }, { transaction: data.transaction });
        await this.passwordResetTokenRepository.deleteById(resetToken.id, { transaction: data.transaction });
        // TODO: set require password change to false
        return user.id;
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

    private async activePasswordResetTokenAlreadyExists(user: BaseUser<RoleType>, transaction: Transaction): Promise<boolean> {
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