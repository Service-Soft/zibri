import { randomBytes, timingSafeEqual } from 'node:crypto';

import { CookieAuthData } from './cookie-auth-data.model';
import { CookieAuthLogoutData, CookieAuthLogoutDto } from './cookie-auth-logout-data.model';
import { CookieAuthRefreshLoginData, CookieAuthRefreshLoginDto } from './cookie-auth-refresh-login-data.model';
import { CookieAuthRefreshSession, CookieAuthRefreshSessionCreateData } from './cookie-auth-refresh-session.model';
import { CookieAuthSessionCleanupCronJob } from './cookie-auth-session-cleanup.cron-job';
import { CookieAuthSession, CookieAuthSessionCreateData } from './cookie-auth-session.model';
import { ZibriApplication } from '../../../application/application';
import { HttpRequestContext } from '../../../context/request/http-request.context';
import { WebsocketRequestContext } from '../../../context/request/websocket-request.context';
import { IsolationLevel } from '../../../data-source/data-sources/data-source.interface';
import { Repository } from '../../../data-source/repository/repository';
import { Transaction } from '../../../data-source/transaction/transaction.model';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { Inject } from '../../../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { NoProviderError } from '../../../di/errors/no-provider.error';
import { inject } from '../../../di/inject.function';
import { CredentialReusedError } from '../../../error-handling/errors/credential-reused.error';
import { NotFoundError } from '../../../error-handling/errors/not-found.error';
import { UnauthorizedError } from '../../../error-handling/errors/unauthorized.error';
import { type CookieOptions } from '../../../http/cookie-options.model';
import { HttpMethod } from '../../../http/http-method.enum';
import { KnownHeader } from '../../../http/known-header.enum';
import { $ts } from '../../../localization/translate.function';
import { OpenApiSecuritySchemeObject } from '../../../open-api/open-api.model';
import { Newable } from '../../../types/newable.type';
import { type OmitStrict } from '../../../types/omit-strict.type';
import { Ms } from '../../../utilities/ms';
import { UUIDUtilities } from '../../../utilities/uuid.utilities';
import { validateEntitiesRegistered } from '../../../utilities/validate-entities-registered.function';
import { FederatedSessionColumns } from '../../authenticators/federated/federated-session-columns.model';
import { FederatedSessionMatch } from '../../authenticators/federated/federated-session-match.model';
import { FederatedSession } from '../../authenticators/federated/federated-session.model';
import { FederatedSessionUtilities } from '../../authenticators/federated/federated-session.utilities';
import { Authentication } from '../../models/authentication.model';
import { BaseUser } from '../../models/base-user.model';
import { type UserServiceInterface } from '../../user/user-service.interface';
import { AuthControllerStrategyInterface } from '../auth-controller-strategy.interface';
import { CsrfTokenAuthStrategyInterface } from '../csrf-token-auth-strategy.interface';

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
 * A session and the refresh session it belongs to.
 */
type SessionPair = {
    /**
     * The session.
     */
    session: CookieAuthSession,
    /**
     * The refresh session, which is what carries the csrf token.
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
> implements AuthControllerStrategyInterface<
    RoleType,
    UserType,
    CookieAuthData<RoleType>,
    CookieAuthRefreshLoginData,
    CookieAuthLogoutData
>, CsrfTokenAuthStrategyInterface<RoleType, UserType> {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly name: string = 'cookie';
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly authDataModel: Newable<CookieAuthData<RoleType>> = CookieAuthData;
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly refreshLoginModel: Newable<CookieAuthRefreshLoginDto> = CookieAuthRefreshLoginDto;
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly logoutModel: Newable<CookieAuthLogoutDto> = CookieAuthLogoutDto;
    // the cookies go out with whichever response the login is started in, a redirect included
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly logsInWithResponse: boolean = true;
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly securityScheme: OpenApiSecuritySchemeObject;

    private readonly sessionOptions: CookieAuthSessionOptions;
    private readonly refreshSessionOptions: CookieAuthSessionOptions;

    // read when used rather than injected, so that an application without the entities is told which
    // ones to declare by init, instead of failing on a repository token while this is built
    private get sessionRepository(): Repository<CookieAuthSession, CookieAuthSessionCreateData> {
        return inject(repositoryTokenFor(CookieAuthSession));
    }

    private get refreshSessionRepository(): Repository<CookieAuthRefreshSession, CookieAuthRefreshSessionCreateData> {
        return inject(repositoryTokenFor(CookieAuthRefreshSession));
    }

    constructor(
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
        @Inject(ZIBRI_DI_TOKENS.COOKIE_SIGN_SECRET)
        secret: string | undefined
    ) {
        if (!secret) {
            throw new NoProviderError(ZIBRI_DI_TOKENS.COOKIE_SIGN_SECRET, []);
        }

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
        // first, since the cleanup job below needs them as well
        validateEntitiesRegistered(CookieAuthStrategy.name, app, CookieAuthSession, CookieAuthRefreshSession);
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
        const sessions: SessionPair | undefined = await this.resolveAndValidateSessions(context, undefined);
        if (!sessions) {
            return undefined;
        }

        return await this.userService.findById<RoleType, UserType>(sessions.session.userId);
    }

    /**
     * Resolves the csrf token that goes with the session the request carries.
     *
     * Renews a session that has lapsed first, like any request resolving it does, so the token is the
     * one that is valid from now on.
     * @param context - The request carrying the session cookies.
     * @returns The csrf token, or undefined when the request carries no valid session.
     */
    async resolveCsrfToken(context: HttpRequestContext | WebsocketRequestContext): Promise<string | undefined> {
        const sessions: SessionPair | undefined = await this.resolveAndValidateSessions(context, undefined);
        return sessions?.refreshSession.csrfToken;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveAuthenticatedAt(context: HttpRequestContext | WebsocketRequestContext): Promise<Date | undefined> {
        // read without validating again. Validating rotates a session that has lapsed, and the user
        // this is asked about was resolved earlier in the same request - which already rotated it,
        // so a second rotation would present a refresh session that request just spent, and end the
        // login as reuse. A blacklisted row is therefore not refused here: inside this request it is
        // the one the rotation just replaced, and it carries the same login time as its successor
        const refreshSession: CookieAuthRefreshSession | undefined = await this.resolveRefreshSession(context, undefined);
        if (!refreshSession || new Date(refreshSession.expirationDate).getTime() <= Date.now()) {
            return undefined;
        }
        return new Date(refreshSession.authenticatedAt);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveExpiresAt(context: HttpRequestContext | WebsocketRequestContext): Promise<Date | undefined> {
        // the refresh session's, read without validating for the reason resolveAuthenticatedAt gives:
        // a session that lapses before it is rotated into a new one, so the pair is accepted until then
        const refreshSession: CookieAuthRefreshSession | undefined = await this.resolveRefreshSession(context, undefined);
        return refreshSession == undefined ? undefined : new Date(refreshSession.expirationDate);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async startTransaction(): Promise<Transaction> {
        return await this.sessionRepository.dataSource.startTransaction({ isolationLevel: IsolationLevel.READ_COMMITTED });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async startLogin(authentication: Authentication<UserType>, transaction: Transaction | undefined): Promise<CookieAuthData<RoleType>> {
        const refreshSession: CookieAuthRefreshSession = await this.createRefreshSession(
            authentication.user.id,
            UUIDUtilities.generate(),
            transaction,
            randomBytes(32).toString('base64url'),
            // rotation carries both from here on
            authentication.authenticatedAt,
            FederatedSessionUtilities.toColumns(authentication.federatedSession)
        );
        const session: CookieAuthSession = await this.createSession(refreshSession, transaction);
        this.setRefreshSessionCookie(refreshSession);
        this.setSessionCookie(session);

        return {
            userId: session.userId,
            roles: authentication.user.roles,
            csrfToken: refreshSession.csrfToken,
            sessionExpirationDate: session.expirationDate,
            refreshSessionExpirationDate: refreshSession.expirationDate
        };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async endLogins(userId: string, transaction: Transaction | undefined): Promise<void> {
        await this.sessionRepository.deleteAll({ userId }, { transaction });
        // the refresh sessions too. With only the sessions gone, a refresh session from before rotated
        // into a fresh session on its next refresh, so whoever held the cookies stayed logged in
        // through a password reset that was meant to end their access
        await this.refreshSessionRepository.deleteAll({ userId }, { transaction });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async endFederatedLogins(session: FederatedSessionMatch, transaction: Transaction | undefined): Promise<void> {
        const refreshSessions: CookieAuthRefreshSession[] = await this.refreshSessionRepository.findAll({
            where: FederatedSessionUtilities.toWhere(session),
            transaction
        });
        const familyIds: string[] = [...new Set(refreshSessions.map(refreshSession => refreshSession.familyId))];
        if (!familyIds.length) {
            return;
        }
        // the sessions as well, which carry no provider of their own: they hang off the family
        await this.sessionRepository.deleteAll({ familyId: { oneOf: familyIds } }, { transaction });
        await this.refreshSessionRepository.deleteAll({ familyId: { oneOf: familyIds } }, { transaction });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async logout(data: CookieAuthLogoutData): Promise<FederatedSession | undefined> {
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
            return refreshSession == undefined ? undefined : FederatedSessionUtilities.fromColumns(refreshSession);
        }
        catch {
            // ignore
            return undefined;
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
    ): Promise<SessionPair> {
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
            randomBytes(32).toString('base64url'),
            // the login's time, not now: a rotation is not a login. Its session at a provider stays too
            currentRefreshSession.authenticatedAt,
            FederatedSessionUtilities.toColumns(FederatedSessionUtilities.fromColumns(currentRefreshSession))
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

    private async resolveAndValidateSessions(
        context: HttpRequestContext | WebsocketRequestContext,
        transaction: Transaction | undefined
    ): Promise<SessionPair | undefined> {
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
            return await this.rotateSessions(refreshSession, transaction);
        }

        if (session.familyId !== refreshSession.familyId || session.userId !== refreshSession.userId) {
            return undefined;
        }

        return { session, refreshSession };
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
        csrfToken: string,
        authenticatedAt: Date,
        federatedSession: FederatedSessionColumns
    ): Promise<CookieAuthRefreshSession> {
        return await this.refreshSessionRepository.create({
            userId,
            blacklisted: false,
            familyId,
            expirationDate: new Date(Date.now() + this.refreshSessionExpiresInMs + (Ms.MINUTE * 5)),
            csrfToken,
            authenticatedAt,
            ...federatedSession
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