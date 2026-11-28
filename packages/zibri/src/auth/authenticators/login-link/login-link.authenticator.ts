import { randomBytes } from 'node:crypto';

import { ZibriApplication } from '../../../application/application';
import { HttpRequestContext } from '../../../context/request/http-request.context';
import { WebsocketRequestContext } from '../../../context/request/websocket-request.context';
import { IsolationLevel } from '../../../data-source/data-sources/data-source.interface';
import { Repository } from '../../../data-source/repository/repository';
import { type RepositoryTransaction } from '../../../data-source/transaction/repository-transaction.type';
import { SpanningTransaction } from '../../../data-source/transaction/spanning-transaction.model';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { Inject } from '../../../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { NoProviderError } from '../../../di/errors/no-provider.error';
import { inject } from '../../../di/inject.function';
import { EmailPriority } from '../../../email/models/email-priority.enum';
import { TooManyRequestsError } from '../../../error-handling/errors/too-many-requests.error';
import { UnauthorizedError } from '../../../error-handling/errors/unauthorized.error';
import { InternalError } from '../../../error-handling/internal-error.model';
import { BeforeAppShutdown } from '../../../global/before-app-shutdown.interface';
import { runInLocale } from '../../../localization/run-in-locale.function';
import { $ts } from '../../../localization/translate.function';
import { AuditAction, AuditOutcome, AuditReason } from '../../../logging/audit-event.model';
import { AuditUtilities } from '../../../logging/audit.utilities';
import { RateLimitResult } from '../../../rate-limiting/rate-limit-result.model';
import { TsxUtilities } from '../../../tsx/tsx.utilities';
import { Newable } from '../../../types/newable.type';
import { Ms } from '../../../utilities/ms';
import { validateEntitiesRegistered } from '../../../utilities/validate-entities-registered.function';
import { EmailTwoFactorMethod } from '../../2fa/methods/code/email.two-factor-method';
import { TwoFactorMethods } from '../../2fa/two-factor-methods.model';
import { type HashServiceInterface } from '../../hash/hash-service.interface';
import type { HashString } from '../../hash/hash.utilities';
import { Sha256HashStrategy } from '../../hash/strategies/sha256.hash-strategy';
import { Authentication } from '../../models/authentication.model';
import { BaseUser } from '../../models/base-user.model';
import { UserKindUtilities } from '../../user/user-kind.utilities';
import { type UserServiceInterface } from '../../user/user-service.interface';
import { AuthControllerAuthenticatorInterface } from '../auth-controller-authenticator.interface';
import { PasswordCredentials, PasswordCredentialsCreateData } from '../password/password-credentials.model';
import { PasswordAuthenticator } from '../password/password.authenticator';
import { LoginLinkCredentials } from './login-link-credentials.model';
import { LoginLinkOptions } from './login-link-options.model';
import { LoginLinkToken, LoginLinkTokenCreateData } from './login-link-token.model';

/**
 * The cookie a link is bound to the browser that asked for it with.
 */
const BROWSER_BINDING_COOKIE: string = 'zibri-login-link';

/**
 * The options a login link authenticator runs with, its defaults filled in.
 */
type ResolvedLoginLinkOptions = Required<LoginLinkOptions>;

/**
 * Logs users in with a link sent to their email. The link opens a page of the frontend, which posts its token to the
 * login route.
 */
export class LoginLinkAuthenticator<
    RoleType extends string,
    UserType extends BaseUser<RoleType> = BaseUser<RoleType>
> implements AuthControllerAuthenticatorInterface<RoleType, UserType, LoginLinkCredentials>, BeforeAppShutdown {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly name: string = 'login-link';

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly credentialsModel: Newable<LoginLinkCredentials> = LoginLinkCredentials;

    private readonly options: ResolvedLoginLinkOptions;

    private twoFactorMethods: TwoFactorMethods = [];

    private storesPasswords: boolean = false;

    /**
     * The links still being made after their request was answered, which a shutdown waits for.
     */
    private readonly pendingRequests: Set<Promise<void>> = new Set();

    // read when used rather than injected, so that an application without the entity is told to declare it by init,
    // instead of failing on a repository token while this is built
    private get tokenRepository(): Repository<LoginLinkToken, LoginLinkTokenCreateData> {
        return inject(repositoryTokenFor(LoginLinkToken));
    }

    constructor(
        @Inject(ZIBRI_DI_TOKENS.USER_SERVICE)
        private readonly userService: UserServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.HASH_SERVICE)
        private readonly hashService: HashServiceInterface
    ) {
        const options: LoginLinkOptions | undefined = inject(ZIBRI_DI_TOKENS.LOGIN_LINK_OPTIONS);
        if (options == undefined) {
            throw new NoProviderError(ZIBRI_DI_TOKENS.LOGIN_LINK_OPTIONS, []);
        }
        this.options = { tokenExpiresInMs: Ms.MINUTE * 15, secondFactor: 'twoFactorAtLogin', bindToBrowser: false, ...options };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    init(app: ZibriApplication): void {
        validateEntitiesRegistered(LoginLinkAuthenticator.name, app, LoginLinkToken);
        if (!this.options.loginLinkUrl) {
            throw new InternalError('ZIBRI_DI_TOKENS.LOGIN_LINK_OPTIONS names no loginLinkUrl for its links to point to.');
        }
        if (!(this.options.tokenExpiresInMs > 0)) {
            throw new InternalError('The tokenExpiresInMs of ZIBRI_DI_TOKENS.LOGIN_LINK_OPTIONS needs to be more than 0.');
        }
        this.twoFactorMethods = app.options.twoFactorMethods;
        this.storesPasswords = app.options.authenticators
            .some(a => a === PasswordAuthenticator || a.prototype instanceof PasswordAuthenticator);
    }

    /**
     * Whether a link is all a user logs in and confirms who they are with: they have no password of
     * `PasswordAuthenticator` and no second factor. A login by a link counts as a recent login for such a user only.
     * @param user - The user.
     * @param transaction - The transaction to read in, if any.
     * @returns True when they have neither.
     */
    async resolveLogsInByLinkOnly(user: BaseUser<string>, transaction: RepositoryTransaction | undefined): Promise<boolean> {
        const hasSecondFactor: boolean = await inject(ZIBRI_DI_TOKENS.TWO_FACTOR_SERVICE).isRegistered(user);
        // only an application with the authenticator declares the passwords
        return !hasSecondFactor && (!this.storesPasswords || await inject<Repository<PasswordCredentials, PasswordCredentialsCreateData>>(
            repositoryTokenFor(PasswordCredentials)
        ).findOne({ where: { userId: user.id }, transaction, required: false }) == undefined);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async deleteUserRows(userIds: string[], transaction: RepositoryTransaction): Promise<void> {
        await this.tokenRepository.deleteAll({ userId: { oneOf: userIds } }, { transaction });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async authenticate(
        credentials: LoginLinkCredentials,
        transaction: RepositoryTransaction | undefined
    ): Promise<Authentication<UserType>> {
        const found: LoginLinkToken | undefined = await this.tokenRepository.findOne({
            where: { value: await this.hashValue(credentials.token) },
            transaction,
            required: false
        });
        if (found == undefined) {
            throw new UnauthorizedError($ts`This login link is unknown or was used already. Ask for a new one.`);
        }
        if (new Date(found.expiresAt).getTime() <= Date.now()) {
            await this.tokenRepository.deleteById(found.id);
            throw new UnauthorizedError($ts`This login link expired. Ask for a new one.`);
        }
        // before it is spent, so the browser that asked for it can still use it
        await this.validateBrowser(found);
        // spent outside the login's transaction, which a login waiting for its second factor rolls back: the link
        // proved the mailbox once, and the ticket is what the login continues with. By its id, so that of two
        // requests presenting it at once, one spends it
        const spent: number = await this.tokenRepository.deleteAll({ id: found.id });
        const user: UserType | undefined = spent === 0
            ? undefined
            : await this.userService.findById<RoleType, UserType, false>(found.userId, { required: false });
        if (user == undefined) {
            throw new UnauthorizedError($ts`This login link is unknown or was used already. Ask for a new one.`);
        }
        inject(ZIBRI_DI_TOKENS.AUDIT_SERVICE)
            .record({ action: AuditAction.LOGIN_LINK_USED, outcome: AuditOutcome.SUCCESS, userId: user.id });
        return {
            user: await this.markEmailVerified(user),
            authenticatedAt: new Date(),
            completesWithoutSecondFactor: this.options.secondFactor === 'none',
            // a code by email proves the mailbox the link just proved
            excludedTwoFactorMethods: this.twoFactorMethods
                .map(m => inject(m))
                .filter(m => m instanceof EmailTwoFactorMethod)
                .map(m => m.name),
            // a recent login stands in for a second factor because it proved the password, which a link does not. A user
            // with neither a password nor a second factor has nothing but a link to prove it with, so theirs counts.
            // Decided now, and kept for the whole login
            countsAsRecentLogin: await this.resolveLogsInByLinkOnly(user, transaction)
        };
    }

    /**
     * Mails a link to log in with to the account of an email.
     *
     * Answers once the email is looked up, whether or not it has an account, and makes the link and its email after
     * that: an account answers like an email nobody has, in what it says and in how long it takes. A deactivated
     * user gets no link. A new link replaces the one the user had.
     * @param email - The email.
     * @throws {TooManyRequestsError} When links were asked for the email too often, as `AuthRateLimiter` counts them.
     */
    async requestLoginLink(email: string): Promise<void> {
        await this.validateEmailBudget(email);
        // set for an email without an account too, so the answer looks the same
        const browserBinding: string | undefined = this.options.bindToBrowser ? this.bindBrowser() : undefined;
        const user: UserType | undefined = await this.userService.findByEmail<RoleType, UserType, false>(email, { required: false });
        const tenantId: string | undefined = inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).getActiveTenantId();
        // answered here, after the one lookup an email without an account costs as well, for the reason
        // requestPasswordResetForEmail of the AuthService gives
        void this.trackRequest(this.requestLoginLinkInBackground(email, user, browserBinding, tenantId));
    }

    /**
     * Creates the token of a link to log in with for a user, which works in any browser, such as the one accepting an
     * invitation without a password logs its account in with. Whoever holds it logs in as the user: it is for
     * `login` of the `AuthService`, and for no response.
     * @param userId - The user.
     * @returns The token.
     */
    async createLoginToken(userId: string): Promise<string> {
        const token: string = this.generateToken();
        await this.tokenRepository.create({
            value: token,
            userId,
            expiresAt: new Date(Date.now() + this.options.tokenExpiresInMs),
            browserBinding: null
        });
        return token;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async beforeAppShutdown(): Promise<void> {
        // before the other hooks, which the link still needs: the audit trail flushes and the mail transport closes
        // in theirs
        await Promise.all(this.pendingRequests);
    }

    /**
     * Keeps a link among the pending ones, which a shutdown waits for, until it settles.
     * @param request - The making of the link.
     */
    private async trackRequest(request: Promise<void>): Promise<void> {
        this.pendingRequests.add(request);
        try {
            await request;
        }
        finally {
            this.pendingRequests.delete(request);
        }
    }

    /**
     * Makes a link and mails it, then records the request. Never rejects: a failure is recorded and logged, since
     * nobody is waiting for it.
     * @param email - The email that was asked for.
     * @param user - Who holds it, if anybody.
     * @param browserBinding - The cookie of the browser the link is bound to, if any.
     * @param tenantId - The tenant of the request, which the link is for.
     */
    private async requestLoginLinkInBackground(
        email: string,
        user: UserType | undefined,
        browserBinding: string | undefined,
        tenantId: string | undefined
    ): Promise<void> {
        try {
            if (user == undefined || user.deactivatedAt != undefined) {
                // the one worth seeing: the answer is identical either way, so a run against a list of addresses
                // leaves no other trace
                this.recordRequest(
                    AuditOutcome.FAILURE,
                    user == undefined ? AuditReason.NO_SUCH_SUBJECT : AuditReason.DEACTIVATED,
                    email,
                    user?.id
                );
                return;
            }
            // answered alike as well: a service account never logs in, and a link would be a way to
            if (UserKindUtilities.getKind(user) === 'service') {
                inject(ZIBRI_DI_TOKENS.AUDIT_SERVICE).record({
                    action: AuditAction.LOGIN_LINK_REQUESTED,
                    outcome: AuditOutcome.FAILURE,
                    reason: AuditReason.SERVICE_ACCOUNT,
                    subject: email,
                    userId: user.id,
                    userKind: 'service'
                });
                return;
            }
            await inject(ZIBRI_DI_TOKENS.LEASE_SERVICE).withLease(
                // one link per user at a time, on every instance, for the reason requestPasswordResetForEmail of the
                // AuthService gives. Skipped, because the one holding it makes the link this would
                { key: `login-link:${user.id}`, leaseInMs: Ms.MINUTE, mode: 'skip' },
                async () => await this.sendLoginLink(user, browserBinding, tenantId)
            );
            this.recordRequest(AuditOutcome.SUCCESS, undefined, email, user.id);
        }
        catch (error) {
            const reason: AuditReason = AuditUtilities.resolveReason(error);
            this.recordRequest(AuditOutcome.FAILURE, reason, email, user?.id);
            if (reason === AuditReason.ERROR) {
                inject(ZIBRI_DI_TOKENS.LOGGER).error(new InternalError('Could not make the requested login link', { cause: error }));
            }
        }
    }

    /**
     * Replaces the link of a user with a new one, and mails it.
     * @param user - The user.
     * @param browserBinding - The cookie of the browser the link is bound to, if any.
     * @param tenantId - The tenant of the request, which the link is for.
     */
    private async sendLoginLink(user: UserType, browserBinding: string | undefined, tenantId: string | undefined): Promise<void> {
        const token: string = this.generateToken();
        const expiresAt: Date = new Date(Date.now() + this.options.tokenExpiresInMs);
        // spanning, as everywhere auth writes beside the application: one reaching a single data source costs nothing
        const transaction: SpanningTransaction = new SpanningTransaction({ isolationLevel: IsolationLevel.READ_COMMITTED });
        try {
            // one link at a time, so a user who asks again can only use the newest
            await this.tokenRepository.deleteAll({ userId: user.id }, { transaction });
            await this.tokenRepository.create({
                value: token,
                userId: user.id,
                expiresAt,
                browserBinding: browserBinding == undefined ? null : await this.hashValue(browserBinding)
            }, { transaction });
            await transaction.commit();
        }
        catch (error) {
            await transaction.rollback();
            throw error;
        }
        // once the token is stored, so no mail carries a link that does not work
        await this.mailLoginLink(user, token, expiresAt, tenantId);
    }

    /**
     * Mails a user their link, in their locale.
     * @param user - The user.
     * @param token - The token of the link.
     * @param expiresAt - When the link stops working.
     * @param tenantId - The tenant the link is for, if any.
     */
    private async mailLoginLink(user: UserType, token: string, expiresAt: Date, tenantId: string | undefined): Promise<void> {
        const url: string = `${this.options.loginLinkUrl}/${token}`;
        const loginLink: string = tenantId == undefined
            ? url
            : await inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).resolveTenantUrl(url, tenantId);
        // in the user's locale rather than in the one of the request, which anybody knowing the address can make
        await runInLocale(user.locale, async () => {
            await inject(ZIBRI_DI_TOKENS.EMAIL_SERVICE).queue({
                recipients: [user.email],
                subject: $ts`Your login link`,
                html: TsxUtilities.renderEmail(this.options.loginLinkEmail, { loginLink, user, expiresAt }),
                priority: EmailPriority.HIGH,
                // the body carries the token in the clear, for the reason the password reset mail gives
                persist: false
            });
        });
    }

    /**
     * Records a request for a link.
     * @param outcome - Whether a link went out.
     * @param reason - Why not, if it did not.
     * @param email - The email that was asked for.
     * @param userId - The user it belongs to, if any.
     */
    private recordRequest(outcome: AuditOutcome, reason: AuditReason | undefined, email: string, userId: string | undefined): void {
        inject(ZIBRI_DI_TOKENS.AUDIT_SERVICE).record({ action: AuditAction.LOGIN_LINK_REQUESTED, outcome, reason, subject: email, userId });
    }

    /**
     * Takes a turn of the email's own budget, beside the one of the caller the route takes.
     * @param email - The email.
     * @throws {TooManyRequestsError} When the budget is spent.
     */
    private async validateEmailBudget(email: string): Promise<void> {
        // whether or not the email has an account, so the answer says nothing about it. Without it, callers at many
        // addresses could fill one mailbox with links
        const result: RateLimitResult = await inject(ZIBRI_DI_TOKENS.AUTH_RATE_LIMITER)
            .consume(`login-link:${email.trim().toLowerCase()}`, 1);
        if (!result.allowed) {
            throw new TooManyRequestsError(
                $ts`A login link was asked for this email too often. Wait before asking for another one.`,
                result
            );
        }
    }

    /**
     * Gives the browser of the request a cookie a link is bound to: http only, with the attributes of the session
     * cookie of the cookie strategy, so it reaches the api where a login does.
     * @returns The value of the cookie.
     * @throws {InternalError} When no http request is being handled.
     */
    private bindBrowser(): string {
        const context: HttpRequestContext = this.resolveHttpContext();
        const value: string = this.generateToken();
        const { sameSite = 'lax', domain, path = '/', secure } = inject(ZIBRI_DI_TOKENS.COOKIE_AUTH_SESSION_OPTIONS);
        context.response.cookie(BROWSER_BINDING_COOKIE, value, {
            httpOnly: true,
            sameSite,
            domain,
            path,
            // a browser refuses SameSite=None on a cookie that is not secure
            secure: sameSite === 'none' || (secure ?? context.request.secure),
            maxAge: this.options.tokenExpiresInMs
        });
        return value;
    }

    /**
     * Refuses a link bound to a browser other than the one presenting it.
     * @param token - The token of the link.
     * @throws {UnauthorizedError} When the request does not carry the cookie the link is bound to.
     */
    private async validateBrowser(token: LoginLinkToken): Promise<void> {
        if (token.browserBinding == undefined) {
            return;
        }
        // eslint-disable-next-line typescript/no-unsafe-member-access
        const presented: unknown = this.resolveHttpContext().request.cookies?.[BROWSER_BINDING_COOKIE];
        if (typeof presented !== 'string' || await this.hashValue(presented) !== token.browserBinding) {
            throw new UnauthorizedError(
                $ts`This login link works on the device it was asked for on. Open it there, or ask for a new one on this device.`
            );
        }
    }

    private resolveHttpContext(): HttpRequestContext {
        const context: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
        if (!(context instanceof HttpRequestContext)) {
            throw new InternalError('A login link bound to a browser is asked for and used inside an http request.');
        }
        return context;
    }

    /**
     * Marks the email of a user verified, which the link reaching it proves.
     *
     * Outside the login's transaction, for the reason authenticate spends the link outside it.
     * @param user - The user.
     * @returns The user, with the email verified.
     */
    private async markEmailVerified(user: UserType): Promise<UserType> {
        if (user.emailVerifiedAt != undefined) {
            return user;
        }
        const emailVerifiedAt: Date = new Date();
        await this.userService.updateEmail(user.id, user.email, emailVerifiedAt, undefined);
        return { ...user, emailVerifiedAt };
    }

    private async hashValue(value: string): Promise<HashString> {
        // the strategy the token's property names, so the value is found the way it was stored
        return await this.hashService.hash(value, { strategy: Sha256HashStrategy });
    }

    private generateToken(): string {
        // kept here, because the stored value is the hash, for the reason PasswordAuthenticator gives
        return randomBytes(32).toString('base64url');
    }
}