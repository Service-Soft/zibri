import { randomBytes, timingSafeEqual } from 'node:crypto';

import { CookieAuthConfirmPasswordResetData } from './cookie-auth-confirm-password-reset-data.model';
import { CookieAuthCredentials, CookieAuthCredentialsData } from './cookie-auth-credentials.model';
import { CookieAuthData } from './cookie-auth-data.model';
import { CookieAuthLogoutData } from './cookie-auth-logout-data.model';
import { CookieAuthRefreshLoginData } from './cookie-auth-refresh-login-data.model';
import { CookieAuthRefreshSession, CookieAuthRefreshSessionCreateData } from './cookie-auth-refresh-session.model';
import { CookieAuthRequestPasswordResetData } from './cookie-auth-request-password-reset-data.model';
import { CookieAuthSessionCleanupCronJob } from './cookie-auth-session-cleanup.cron-job';
import { CookieAuthSession, CookieAuthSessionCreateData } from './cookie-auth-session.model';
import { ZibriApplication } from '../../../application/application';
import { HttpRequestContext } from '../../../context/request/http-request.context';
import { WebsocketRequestContext } from '../../../context/request/websocket-request.context';
import { Repository } from '../../../data-source/repository/repository';
import { Transaction } from '../../../data-source/transaction/transaction.model';
import { InjectRepository } from '../../../di/decorators/inject-repository.decorator';
import { Inject } from '../../../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { NoProviderError } from '../../../di/errors/no-provider.error';
import { inject } from '../../../di/inject.function';
import { type EmailServiceInterface } from '../../../email/email-service.interface';
import { EmailPriority } from '../../../email/models/email-priority.enum';
import { CredentialReusedError } from '../../../error-handling/errors/credential-reused.error';
import { HttpError } from '../../../error-handling/errors/http.error';
import { NotFoundError } from '../../../error-handling/errors/not-found.error';
import { UnauthorizedError } from '../../../error-handling/errors/unauthorized.error';
import { type CookieOptions } from '../../../http/cookie-options.model';
import { HttpMethod } from '../../../http/http-method.enum';
import { KnownHeader } from '../../../http/known-header.enum';
import { $ts } from '../../../localization/translate.function';
import { OpenApiSecuritySchemeObject } from '../../../open-api/open-api.model';
import { TsxUtilities } from '../../../tsx/tsx.utilities';
import { type OmitStrict } from '../../../types/omit-strict.type';
import { Ms } from '../../../utilities/ms';
import { UUIDUtilities } from '../../../utilities/uuid.utilities';
import { type HashServiceInterface } from '../../hash/hash-service.interface';
import type { HashString } from '../../hash/hash.utilities';
import { Sha256HashStrategy } from '../../hash/strategies/sha256.hash-strategy';
import { BaseUser } from '../../models/base-user.model';
import { PasswordResetToken, PasswordResetTokenCreateData } from '../../models/password-reset-token.model';
import { type UserServiceInterface } from '../../user/user-service.interface';
import { AuthStrategyInterface } from '../auth-strategy.interface';
import { PasswordResetEmailTemplate } from '../jwt/jwt-auth.controller';

/**
 * Options input for any cookie session.
 *
 * `secure` is the one worth a note. Left unset it is derived per request from whether the connection
 * actually was https, which is right for a deployment that serves both. Set to `true` it is always
 * sent - say that when the api is https only, so that a `security.trustProxy` that is wrong, or
 * missing, cannot quietly downgrade a session cookie to one the browser will send in the clear.
 * Setting it to `false` turns the flag off outright and is only sensible in local development.
 */
export type CookieAuthSessionOptionsInput = OmitStrict<CookieOptions, 'maxAge' | 'expires' | 'signed' | 'httpOnly'>;

/**
 * The pair minted by one rotation.
 */
type RotatedSessions = {
    /**
     * The new session.
     */
    session: CookieAuthSession,
    /**
     * The new refresh session, which is what carries the new csrf token.
     */
    refreshSession: CookieAuthRefreshSession
};

/**
 * Full options for any cookie session.
 */
type CookieAuthSessionOptions = CookieOptions
    & Required<Pick<CookieOptions, 'maxAge' | 'httpOnly' | 'signed' | 'sameSite'>>;

/**
 * Cookie auth strategy implementation of Zibri.
 */
export class CookieAuthStrategy<
    RoleType extends string,
    UserType extends BaseUser<RoleType> = BaseUser<RoleType>
> implements AuthStrategyInterface<
    RoleType,
    UserType,
    CookieAuthData<RoleType>,
    CookieAuthCredentialsData,
    CookieAuthRequestPasswordResetData<RoleType, UserType>,
    CookieAuthConfirmPasswordResetData,
    CookieAuthRefreshLoginData,
    CookieAuthLogoutData
> {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly name: string = 'cookie';
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly securityScheme: OpenApiSecuritySchemeObject;

    private readonly confirmPasswordResetUrl: string;
    private readonly PasswordResetEmail: PasswordResetEmailTemplate<RoleType, UserType>;
    private dummyPasswordHashPromise: Promise<HashString> | undefined;
    private readonly sessionOptions: CookieAuthSessionOptions;
    private readonly refreshSessionOptions: CookieAuthSessionOptions;

    constructor(
        @InjectRepository(CookieAuthSession)
        private readonly sessionRepository: Repository<CookieAuthSession, CookieAuthSessionCreateData>,
        @InjectRepository(CookieAuthRefreshSession)
        private readonly refreshSessionRepository: Repository<CookieAuthRefreshSession, CookieAuthRefreshSessionCreateData>,
        @Inject(ZIBRI_DI_TOKENS.USER_SERVICE)
        private readonly userService: UserServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.CSRF_TOKEN_HEADER)
        private readonly csrfTokenHeader: string,
        @Inject(ZIBRI_DI_TOKENS.COOKIE_AUTH_SESSION_OPTIONS)
        sessionOptions: OmitStrict<CookieOptions, 'maxAge' | 'expires'>,
        @Inject(ZIBRI_DI_TOKENS.COOKIE_AUTH_REFRESH_SESSION_OPTIONS)
        refreshSessionOptions: OmitStrict<CookieOptions, 'maxAge' | 'expires'>,
        @Inject(ZIBRI_DI_TOKENS.COOKIE_AUTH_SESSION_EXPIRES_IN_MS)
        private readonly sessionExpiresInMs: number,
        @Inject(ZIBRI_DI_TOKENS.COOKIE_AUTH_REFRESH_SESSION_EXPIRES_IN_MS)
        private readonly refreshSessionExpiresInMs: number,
        @Inject(ZIBRI_DI_TOKENS.PASSWORD_RESET_TOKEN_EXPIRES_IN_MS)
        private readonly passwordResetTokenExpiresInMs: number,
        @InjectRepository(PasswordResetToken)
        private readonly passwordResetTokenRepository: Repository<PasswordResetToken>,
        @InjectRepository(CookieAuthCredentials)
        private readonly credentialsRepository: Repository<CookieAuthCredentials>,
        @Inject(ZIBRI_DI_TOKENS.EMAIL_SERVICE)
        private readonly emailService: EmailServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.HASH_SERVICE)
        private readonly hashService: HashServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.COOKIE_SIGN_SECRET)
        secret: string | undefined
    ) {
        if (!secret) {
            throw new NoProviderError(ZIBRI_DI_TOKENS.COOKIE_SIGN_SECRET, []);
        }
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

        this.sessionOptions = {
            maxAge: this.sessionExpiresInMs,
            signed: true,
            httpOnly: true,
            sameSite: 'lax',
            ...sessionOptions
        };
        this.refreshSessionOptions = {
            maxAge: this.refreshSessionExpiresInMs,
            signed: true,
            httpOnly: true,
            sameSite: 'lax',
            ...refreshSessionOptions
        };

        this.securityScheme = {
            type: 'apiKey',
            in: 'cookie',
            name: this.sessionOptions.name
        };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    init(app: ZibriApplication): void {
        if (!app.options.cronJobs.includes(CookieAuthSessionCleanupCronJob)) {
            app.options.cronJobs.push(CookieAuthSessionCleanupCronJob);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    hasCredential(context: HttpRequestContext | WebsocketRequestContext): boolean {
        // either cookie, though resolving needs both: a request carrying only the refresh cookie is
        // still addressing this strategy - its session has lapsed and is about to be rotated - and
        // must not read as carrying no cookie credential at all.
        //
        // Presence rather than validity on purpose. Whether the session behind it is any good is
        // what resolving decides; answering false for an expired one would let a request pairing a
        // stale cookie with someone else's token quietly resolve as that token.
        if (!(context instanceof HttpRequestContext)) {
            // cookies are an http thing, and resolveSession says the same
            return false;
        }
        return [this.sessionOptions.name, this.refreshSessionOptions.name].some(
            // eslint-disable-next-line typescript/no-unsafe-member-access
            name => context.request.signedCookies?.[name] != undefined
        );
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveUser(context: HttpRequestContext | WebsocketRequestContext): Promise<UserType | undefined> {
        const session: CookieAuthSession | undefined = await this.resolveAndValidateSession(context, undefined);
        if (!session) {
            return undefined;
        }

        return await this.userService.findById<RoleType, UserType>(session.userId);
    }

    /**
     * The stored password for a user, or undefined when there is none to compare against.
     *
     * A user can exist without credentials, and that has to answer the same as a wrong password
     * rather than as an error.
     * @param user - The user to look up.
     * @returns The stored hash, or undefined when the user has no credentials.
     */
    private async findStoredPassword(user: UserType): Promise<HashString | undefined> {
        try {
            const credentials: CookieAuthCredentials = await this.userService.resolveCredentialsFor(user);
            return credentials.password;
        }
        catch {
            return undefined;
        }
    }

    /**
     * Re-hashes a password that was just proven correct, if the stored hash is out of date.
     *
     * See the same method on the jwt strategy for why it lives here rather than in `AuthService`.
     * @param user - The user that just logged in.
     * @param password - The plaintext they logged in with.
     * @param storedPassword - The hash it was compared against.
     */
    private async upgradeStoredPassword(user: UserType, password: string, storedPassword: HashString): Promise<void> {
        try {
            if (!await this.hashService.needsRehash(storedPassword)) {
                return;
            }
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
     * what a comparison against a real password costs. Computed once and reused.
     * @returns The stand-in hash.
     */
    private async dummyPasswordHash(): Promise<HashString> {
        this.dummyPasswordHashPromise ??= Promise.resolve(this.hashService.hash(randomBytes(32).toString('hex')));
        return await this.dummyPasswordHashPromise;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async login(credentials: CookieAuthCredentialsData): Promise<CookieAuthData<RoleType>> {
        try {
            const foundUser: UserType | undefined = await this.userService.findByEmail(credentials.email, { required: false });
            const storedPassword: HashString | undefined = foundUser == undefined
                ? undefined
                : await this.findStoredPassword(foundUser);

            // one comparison on every path - see the same note on the jwt strategy. Without it the
            // response time says whether the address is registered.
            const passwordMatched: boolean = await this.hashService.equal(
                credentials.password,
                storedPassword ?? await this.dummyPasswordHash()
            );
            if (foundUser == undefined || storedPassword == undefined || !passwordMatched) {
                throw new UnauthorizedError($ts`Invalid email or password.`);
            }
            await this.upgradeStoredPassword(foundUser, credentials.password, storedPassword);

            const refreshSession: CookieAuthRefreshSession = await this.createRefreshSession(
                foundUser.id,
                UUIDUtilities.generate(),
                credentials.transaction,
                randomBytes(32).toString('base64url')
            );
            const session: CookieAuthSession = await this.createSession(refreshSession, credentials.transaction);
            this.setRefreshSessionCookie(refreshSession);
            this.setSessionCookie(session);

            return {
                userId: session.userId,
                roles: foundUser.roles,
                csrfToken: refreshSession.csrfToken,
                sessionExpirationDate: session.expirationDate,
                refreshSessionExpirationDate: refreshSession.expirationDate
            };
        }
        catch (error) {
            // see the same note on the jwt strategy: every way of being *refused* answers alike, but
            // a fault is not one of them and must not be dressed as one
            if (!(error instanceof HttpError)) {
                throw error;
            }
            throw new UnauthorizedError($ts`Invalid email or password.`);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async logout(data: CookieAuthLogoutData): Promise<void> {
        try {
            const refreshSession: CookieAuthRefreshSession | undefined = await this.refreshSessionRepository.findOne(
                { where: { id: data.refreshSessionId }, transaction: data.transaction, required: false }
            );
            await this.refreshSessionRepository.deleteAll({ id: data.refreshSessionId }, { transaction: data.transaction });
            if (refreshSession) {
                await this.sessionRepository.deleteAll({ familyId: refreshSession.familyId }, { transaction: data.transaction });
                await this.refreshSessionRepository.deleteAll({ familyId: refreshSession.familyId }, { transaction: data.transaction });
            }

            if (data.clearCookies) {
                this.clearCookies();
            }
        }
        catch {
            // ignore
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async refreshLogin(data: CookieAuthRefreshLoginData): Promise<CookieAuthData<RoleType>> {
        const context: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
        if (!(context instanceof HttpRequestContext)) {
            throw new UnauthorizedError($ts`No valid context`);
        }

        const currentRefreshSession: CookieAuthRefreshSession | undefined = await this.resolveRefreshSession(context, data.transaction);
        if (!currentRefreshSession) {
            this.clearCookies();
            throw new UnauthorizedError($ts`No valid refresh session`);
        }
        if (currentRefreshSession.blacklisted) {
            await this.logout({ clearCookies: true, refreshSessionId: currentRefreshSession.id, transaction: data.transaction });
            // split out from the expiry check below only so that the trail can tell them apart. The
            // answer is identical - same status, same message - because whoever presented a spent
            // session is the last party who should learn that it was noticed.
            throw new CredentialReusedError($ts`No valid refresh session`);
        }
        if (new Date(currentRefreshSession.expirationDate).getTime() <= Date.now()) {
            await this.logout({ clearCookies: true, refreshSessionId: currentRefreshSession.id, transaction: data.transaction });
            throw new UnauthorizedError($ts`No valid refresh session`);
        }
        if (!this.isCsrfTokenValid(currentRefreshSession, context)) {
            throw new UnauthorizedError($ts`No valid csrf token`);
        }

        const currentSession: CookieAuthSession | undefined = await this.resolveSession(context, data.transaction);
        if (currentSession && new Date(currentSession.expirationDate).getTime() > Date.now()) {
            // the current session is valid, no need to refresh
            const user: UserType = await this.userService.findById(currentSession.userId);
            return {
                userId: currentSession.userId,
                roles: user.roles,
                csrfToken: currentRefreshSession.csrfToken,
                sessionExpirationDate: currentSession.expirationDate,
                refreshSessionExpirationDate: currentRefreshSession.expirationDate
            };
        }

        const { session: newSession, refreshSession: newRefresh } = await this.rotateSessions(
            currentRefreshSession,
            data.transaction
        );
        const user: UserType = await this.userService.findById(newSession.userId);

        return {
            userId: newSession.userId,
            roles: user.roles,
            // the new one. Rotation mints a fresh csrf token, so answering with the token that was
            // just retired would hand the client something already refused.
            csrfToken: newRefresh.csrfToken,
            sessionExpirationDate: newSession.expirationDate,
            refreshSessionExpirationDate: newRefresh.expirationDate
        };
    }

    /**
     * Replaces a spent refresh session and the session hanging off it.
     *
     * Returns both, because the caller needs the new csrf token and only the refresh session carries
     * it.
     * @param currentRefreshSession - The refresh session being spent.
     * @param transaction - The transaction to run in, if any.
     * @returns The freshly minted pair.
     */
    private async rotateSessions(
        currentRefreshSession: CookieAuthRefreshSession,
        transaction: Transaction | undefined
    ): Promise<RotatedSessions> {
        if (currentRefreshSession.blacklisted) {
            // ends here. This used to log out and then carry on to mint a new refresh session and a
            // new access session in the same family, handing the presenter of a spent credential a
            // working session - the opposite of what detecting reuse is for. Both callers happen to
            // check `blacklisted` before getting here, so nothing could reach it, but that made it
            // untested code on the critical path rather than code that was correct.
            await this.logout({ clearCookies: true, refreshSessionId: currentRefreshSession.id, transaction });
            throw new CredentialReusedError($ts`The given refresh session has already been used.`);
        }
        // 1. claim the old refresh, only while it is still usable (reuse detection). Reading it took
        // no lock, so two requests carrying the same cookie both reach this - the condition on the
        // write is what decides between them.
        try {
            await this.refreshSessionRepository.updateById(
                currentRefreshSession.id,
                { blacklisted: true },
                { transaction, where: { blacklisted: false } }
            );
        }
        catch (error) {
            if (!(error instanceof NotFoundError)) {
                throw error;
            }
            // only reachable by a session that was *not* blacklisted when it was read and then lost
            // the claim to a concurrent request, because the branch above returns for one that was.
            // So: a client with two requests in flight, not reuse. No logout, since ending the family
            // would turn its own retry into an attack on itself, and deliberately not a
            // CredentialReusedError - that retry would otherwise read as a stolen credential in the
            // audit trail.
            throw new UnauthorizedError($ts`The given refresh session has already been used.`);
        }

        // 2. create new refresh (same family, new csrf). Carrying the old token over meant one csrf
        // token stayed valid for the whole life of the family - thirty days by default - and was
        // never replaced by anything, including re-authentication.
        const newRefresh: CookieAuthRefreshSession = await this.createRefreshSession(
            currentRefreshSession.userId,
            currentRefreshSession.familyId,
            transaction,
            randomBytes(32).toString('base64url')
        );

        // 3. create new access session
        const newSession: CookieAuthSession = await this.createSession(newRefresh, transaction);

        // 4. set cookies (important: use current context)
        this.setSessionCookie(newSession);
        this.setRefreshSessionCookie(newRefresh);
        this.setCsrfTokenHeader(newRefresh.csrfToken);

        return { session: newSession, refreshSession: newRefresh };
    }

    /**
     * Hands the caller the csrf token that goes with the session it was just given.
     *
     * A response body is not always available. A session renews itself in the middle of whatever
     * request happened to notice it had expired, and that response belongs to the route, not to the
     * auth system - so without a header the client's token would go stale silently and its next
     * unsafe request would be refused. Login and refresh-login still return it in their bodies too.
     *
     * A browser on another origin can only read this if the header is listed in
     * `security.cors.exposedHeaders`.
     * @param csrfToken - The token that is now the valid one.
     */
    private setCsrfTokenHeader(csrfToken: string): void {
        const context: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
        if (!(context instanceof HttpRequestContext)) {
            return;
        }
        context.response.setHeader(this.csrfTokenHeader as KnownHeader, csrfToken);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async requestPasswordReset(data: CookieAuthRequestPasswordResetData<RoleType, UserType>): Promise<void> {
        if (await this.activePasswordResetTokenAlreadyExists(data.user, data.transaction)) {
            // silently, for the same reason as in the jwt strategy: a different answer here named an
            // address that exists and had recently been asked about
            return;
        }

        // kept here rather than read back off the entity - the property is hashed on the way in, so
        // this is the only moment the token itself exists. See the same note in the jwt strategy.
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
            // after the spread, so an application cannot ask for this one to be kept - see the same
            // note in the jwt strategy
            persist: false
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async confirmPasswordReset(data: CookieAuthConfirmPasswordResetData): Promise<void> {
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

        const user: UserType = await this.userService.findById(resetToken.userId);
        const credentials: CookieAuthCredentials = await this.userService.resolveCredentialsFor(user);

        await this.credentialsRepository.updateById(credentials.id, { password: data.newPassword }, { transaction: data.transaction });
        await this.passwordResetTokenRepository.deleteById(resetToken.id, { transaction: data.transaction });
        await this.sessionRepository.deleteAll({ userId: resetToken.userId }, { transaction: data.transaction });
        // TODO: set require password change to false
    }

    private async activePasswordResetTokenAlreadyExists(user: BaseUser<RoleType>, transaction: Transaction | undefined): Promise<boolean> {
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

    private async resolveSession(
        context: HttpRequestContext | WebsocketRequestContext,
        transaction: Transaction | undefined
    ): Promise<CookieAuthSession | undefined> {
        if (!(context instanceof HttpRequestContext)) {
            return undefined;
        }
        // eslint-disable-next-line typescript/no-unsafe-assignment, typescript/no-unsafe-member-access
        const currentSessionId: string | undefined = context.request.signedCookies?.[this.sessionOptions.name];
        if (!currentSessionId) {
            return undefined;
        }
        return await this.sessionRepository.findOne({ where: { id: currentSessionId }, transaction, required: false });
    }

    private async resolveAndValidateSession(
        context: HttpRequestContext | WebsocketRequestContext,
        transaction: Transaction | undefined
    ): Promise<CookieAuthSession | undefined> {
        const refreshSession: CookieAuthRefreshSession | undefined = await this.resolveRefreshSession(context, transaction);

        if (!refreshSession) {
            this.clearCookies();
            return undefined;
        }
        if (new Date(refreshSession.expirationDate).getTime() <= Date.now() || refreshSession.blacklisted) {
            await this.logout({ clearCookies: true, refreshSessionId: refreshSession.id, transaction });
            return undefined;
        }
        if (!this.isCsrfTokenValid(refreshSession, context)) {
            return undefined;
        }

        const session: CookieAuthSession | undefined = await this.resolveSession(context, transaction);
        if (!session) {
            return undefined;
        }
        if (new Date(session.expirationDate).getTime() <= Date.now()) {
            // the new csrf token reaches this caller through the response header, since this renewal
            // happens inside somebody else's request and there is no body of ours to put it in
            return (await this.rotateSessions(refreshSession, transaction)).session;
        }

        if (session.familyId !== refreshSession.familyId || session.userId !== refreshSession.userId) {
            return undefined;
        }

        return session;
    }

    private isCsrfTokenValid(
        refreshSession: CookieAuthRefreshSession,
        context: HttpRequestContext | WebsocketRequestContext
    ): boolean {
        if (!(context instanceof HttpRequestContext)) {
            return false;
        }

        if ([HttpMethod.GET, HttpMethod.HEAD, HttpMethod.OPTIONS].includes(context.request.method)) {
            // don't validate safe methods
            return true;
        }
        const csrfToken: string | undefined = this.resolveCsrfTokenFromHeader(context);
        if (csrfToken == undefined) {
            return false;
        }
        // constant time, like the framework's own cookie signature check already is. `===` returns as soon
        // as two bytes differ, which leaks the shared prefix of a token an attacker is guessing.
        // Compared as bytes, with the length checked first because timingSafeEqual throws on a
        // mismatch - the length itself is not a secret.
        const provided: Buffer = Buffer.from(csrfToken);
        const expected: Buffer = Buffer.from(refreshSession.csrfToken);
        if (provided.length !== expected.length) {
            return false;
        }
        return timingSafeEqual(provided, expected);
    }

    private async resolveRefreshSession(
        context: HttpRequestContext | WebsocketRequestContext,
        transaction: Transaction | undefined
    ): Promise<CookieAuthRefreshSession | undefined> {
        if (!(context instanceof HttpRequestContext)) {
            return undefined;
        }
        // eslint-disable-next-line typescript/no-unsafe-assignment, typescript/no-unsafe-member-access
        const currentRefreshSessionId: string | undefined = context.request.signedCookies?.[this.refreshSessionOptions.name];
        if (!currentRefreshSessionId) {
            return undefined;
        }
        return await this.refreshSessionRepository.findOne(
            { where: { id: currentRefreshSessionId }, transaction, required: false }
        );
    }

    private async createSession(
        refreshSession: CookieAuthRefreshSession,
        transaction: Transaction | undefined
    ): Promise<CookieAuthSession> {
        const sessionCreateData: CookieAuthSessionCreateData = {
            userId: refreshSession.userId,
            familyId: refreshSession.familyId,
            expirationDate: new Date(Date.now() + this.sessionExpiresInMs + (Ms.MINUTE * 5))
        };
        return await this.sessionRepository.create(sessionCreateData, { transaction });
    }

    private async createRefreshSession(
        userId: string,
        familyId: string,
        transaction: Transaction | undefined,
        csrfToken: string
    ): Promise<CookieAuthRefreshSession> {
        return await this.refreshSessionRepository.create({
            userId,
            blacklisted: false,
            familyId,
            expirationDate: new Date(Date.now() + this.refreshSessionExpiresInMs + (Ms.MINUTE * 5)),
            csrfToken
        }, { transaction });
    }

    private resolveCsrfTokenFromHeader(context: HttpRequestContext | WebsocketRequestContext): string | undefined {
        if (!(context instanceof HttpRequestContext)) {
            return undefined;
        }
        return context.request.headers[this.csrfTokenHeader as KnownHeader];
    }

    private clearCookies(): void {
        const context: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
        if (!(context instanceof HttpRequestContext)) {
            return;
        }
        // same attributes the cookie was written with, so that clearing it matches it
        context.response.clearCookie(this.sessionOptions.name, {
            ...this.sessionOptions,
            secure: this.isSecure(this.sessionOptions, context)
        });
        context.response.clearCookie(this.refreshSessionOptions.name, {
            ...this.refreshSessionOptions,
            secure: this.isSecure(this.refreshSessionOptions, context)
        });
    }

    private setSessionCookie(session: CookieAuthSession): void {
        const context: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
        if (!(context instanceof HttpRequestContext)) {
            return;
        }
        context.response.cookie(
            this.sessionOptions.name,
            session.id,
            { ...this.sessionOptions, secure: this.isSecure(this.sessionOptions, context) }
        );
    }

    private setRefreshSessionCookie(session: CookieAuthRefreshSession): void {
        const context: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
        if (!(context instanceof HttpRequestContext)) {
            return;
        }
        context.response.cookie(
            this.refreshSessionOptions.name,
            session.id,
            { ...this.refreshSessionOptions, secure: this.isSecure(this.refreshSessionOptions, context) }
        );
    }

    /**
     * Whether this cookie goes out with the `Secure` flag.
     *
     * An application that says so outright wins - it knows whether it is https only, and saying it
     * cannot be undone by a proxy that forgot to be declared in `security.trustProxy`. Otherwise it
     * follows `req.secure`, which honours the forwarded protocol for as many hops as trustProxy
     * allows. Never the `X-Forwarded-Proto` header directly: reading that believed whoever sent the
     * request, so a caller could both ask for a Secure cookie and, worse, decline one.
     * @param options - The options for the cookie being written.
     * @param context - The request the cookie is a response to.
     * @returns Whether to set the flag.
     */
    private isSecure(options: CookieAuthSessionOptions, context: HttpRequestContext): boolean {
        return options.secure ?? context.request.secure;
    }
}