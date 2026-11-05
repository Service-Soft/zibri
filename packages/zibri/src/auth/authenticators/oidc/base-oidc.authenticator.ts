import type { JWTPayload } from 'jose';
import type { ClientAuth, Configuration, DiscoveryRequestOptions, IDToken, ServerMetadata, TokenEndpointResponse, TokenEndpointResponseHelpers } from 'openid-client';

import { OidcAuthenticationTime } from './oidc-authentication-time.type';
import { OidcBearerTokens } from './oidc-bearer-tokens.model';
import { OidcDiscoveryAtBoot } from './oidc-discovery-at-boot.type';
import { ZibriApplication } from '../../../application/application';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { BadRequestError } from '../../../error-handling/errors/bad-request.error';
import { UnauthorizedError } from '../../../error-handling/errors/unauthorized.error';
import { InternalError } from '../../../error-handling/internal-error.model';
import { HttpMethod } from '../../../http/http-method.enum';
import { type HttpClientInterface } from '../../../http-client/http-client.interface';
import { $ts } from '../../../localization/translate.function';
import { type LoggerInterface } from '../../../logging/logger.interface';
import { JsonUtilities } from '../../../utilities/json.utilities';
import { Ms } from '../../../utilities/ms';
import { BaseUser } from '../../models/base-user.model';
import { ProviderAuthentication } from '../../models/provider-authentication.model';
import { EncodedJwt } from '../../strategies/jwt/encoded-jwt.model';
import { isJwtConfirmation, JwtConfirmation } from '../../strategies/jwt/jwt-confirmation.model';
import { JwtRemoteKeySet } from '../../strategies/jwt/jwt-remote-key-set.type';
import { JwtUtilities } from '../../strategies/jwt/jwt.utilities';
import { FederatedCredentials } from '../federated/federated-credentials.model';
import { FederatedIdentity } from '../federated/federated-identity.model';
import { FederatedLoginFailure } from '../federated/federated-login-failure.enum';
import { FederatedLoginError } from '../federated/federated-login.error';
import { FederatedProfile } from '../federated/federated-profile.model';
import { FederatedProviderLogoutMessage } from '../federated/federated-provider-logout-message.model';
import { FederatedProviderLogout } from '../federated/federated-provider-logout.model';
import { FederatedReauthentication } from '../federated/federated-reauthentication.model';
import { FederatedRouteEndpoint } from '../federated/federated-route-endpoint.model';
import { FederatedSessionMatch } from '../federated/federated-session-match.model';
import { FederatedSession } from '../federated/federated-session.model';
import { BaseOAuthAuthenticator } from '../oauth/base-oauth.authenticator';
import { OAuthCodeExchange } from '../oauth/oauth-code-exchange.model';
import { OAuthOfflineAccess } from '../oauth/oauth-offline-access.model';
import { OAuthProviderLogin } from '../oauth/oauth-provider-login.model';
import { OpenIdClient } from '../oauth/open-id-client.type';
import { ProviderTokenAuthenticatorInterface } from '../provider-token-authenticator.interface';
import { ProviderToken } from '../provider-token.model';

/**
 * The event a logout token carries, as OpenID Connect Back-Channel Logout 1.0 names it.
 */
const BACK_CHANNEL_LOGOUT_EVENT: string = 'http://schemas.openid.net/event/backchannel-logout';

/**
 * Authenticates a user by a login at an OpenID Connect provider, which proves who logged in with a
 * signed ID token.
 *
 * Extend it once for every provider, naming the provider and the client registered there. The
 * login itself runs through the routes of `AuthController`.
 */
export abstract class BaseOidcAuthenticator<
    RoleType extends string,
    UserType extends BaseUser<RoleType> = BaseUser<RoleType>
> extends BaseOAuthAuthenticator<RoleType, UserType>
    implements ProviderTokenAuthenticatorInterface<RoleType, UserType, FederatedCredentials> {
    /**
     * The provider's issuer url, eg. `https://accounts.google.com`, where it publishes what it is.
     */
    abstract override readonly issuer: string;

    /**
     * How the provider says when the user logged in there. `auth_time` for one that answers `max_age`
     * with the `auth_time` claim, `none` for one that does not say, whose logins never count as a
     * recent login.
     */
    abstract readonly authenticationTime: OidcAuthenticationTime;

    /**
     * What happens when the provider's metadata cannot be read while the application starts:
     * `required` stops the start, `whenReachable` starts with a warning while the provider cannot be
     * reached, and reads it on the first login.
     */
    abstract readonly discoveryAtBoot: OidcDiscoveryAtBoot;

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly scopes: string[] = ['openid', 'email', 'profile'];

    /**
     * The claim an identity at the provider is known by, in the ID token of a login and in a token a
     * request sends. `sub` by default. `oid` for a provider whose `sub` differs from one client to
     * another, such as Microsoft Entra ID.
     */
    readonly subjectClaim: string = 'sub';

    /**
     * How long ago a logout token the provider sends may have been issued. 10 minutes by default.
     */
    readonly logoutTokenMaxAgeInMs: number = Ms.MINUTE * 10;

    /**
     * How far the clocks of the provider and the application may be apart, for the times in its ID
     * tokens, its tokens a request sends and its logout tokens. A minute by default.
     */
    readonly acceptedClockSkewInMs: number = Ms.MINUTE;

    /**
     * The classes of authentication a login asks the provider for, as `acr_values`, such as one that
     * stands for a second factor. None by default.
     */
    readonly acrValues: string[] = [];

    /**
     * The algorithms an ID token may be signed with.
     */
    readonly allowedAlgorithms: string[] = ['RS256', 'PS256', 'ES256', 'EdDSA'];

    // OpenID Connect's own way, which a provider honors only together with the consent prompt
    override readonly offlineAccess: OAuthOfflineAccess = { scopes: ['offline_access'], prompts: ['consent'], parameters: {} };

    /**
     * Which of the provider's tokens a request may send as its credential, read by
     * `ProviderTokenAuthStrategy`. None, when undefined.
     */
    readonly bearerTokens: OidcBearerTokens | undefined = undefined;

    /**
     * The keys the provider signs its tokens with, set up when a token first arrives and kept.
     */
    private keySet: JwtRemoteKeySet | undefined;

    private get httpClient(): HttpClientInterface {
        return inject(ZIBRI_DI_TOKENS.HTTP_CLIENT);
    }

    private get oidcLogger(): LoggerInterface {
        return inject(ZIBRI_DI_TOKENS.LOGGER);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    get acceptsProviderTokens(): boolean {
        return this.bearerTokens != undefined;
    }

    // the logout route, for the provider to send the browser to, and the back-channel route it posts
    // logout tokens to
    override get routes(): FederatedRouteEndpoint[] {
        return [
            ...super.routes,
            { route: 'logout', method: HttpMethod.GET },
            { route: 'logout/back-channel', method: HttpMethod.POST }
        ];
    }

    // asynchronous although BaseOAuthAuthenticator declares init as void: AuthenticatorInterface
    // declares it as `void | Promise<void>` and the auth service awaits it while the application boots,
    // which is what lets the discovery at boot fail the boot
    // eslint-disable-next-line typescript/no-misused-promises
    override async init(app: ZibriApplication): Promise<void> {
        super.init(app);
        if (
            this.bearerTokens != undefined
            && !this.bearerTokens.accessTokenAudiences.length
            && !this.bearerTokens.idTokenAudiences.length
        ) {
            throw new InternalError(
                // eslint-disable-next-line stylistic/max-len
                `${this.constructor.name} takes bearer tokens for no audience: name the api's in accessTokenAudiences, or the clients' in idTokenAudiences.`
            );
        }
        await this.discoverAtBoot();
    }

    /**
     * Verifies a token of the provider a request sends as its credential, against the keys the provider
     * publishes, as `bearerTokens` says, and finds the user its identity is linked to for logging in.
     * @param token - The token.
     * @returns What it says, or undefined when it does not verify, is not taken, or names an identity
     * linked to nobody.
     * @throws When the provider cannot be reached to find out where it publishes its keys.
     */
    async findProviderToken(token: string): Promise<ProviderToken | undefined> {
        const bearerTokens: OidcBearerTokens | undefined = this.bearerTokens;
        if (bearerTokens == undefined) {
            return undefined;
        }
        const metadata: ServerMetadata = (await this.resolveConfiguration()).serverMetadata();
        const keySet: JwtRemoteKeySet | undefined = this.resolveKeySet(metadata);
        const issuer: string | undefined = this.findTokenIssuer(token);
        if (keySet == undefined || issuer == undefined) {
            return undefined;
        }
        const verified: EncodedJwt<JWTPayload> | undefined = await JwtUtilities.verifyProviderToken(token, keySet, {
            issuer,
            audiences: [...bearerTokens.accessTokenAudiences, ...bearerTokens.idTokenAudiences],
            algorithms: this.allowedAlgorithms,
            clockToleranceInMs: this.acceptedClockSkewInMs
        });
        const cnf: unknown = verified?.payload['cnf'];
        const confirmation: JwtConfirmation | undefined = isJwtConfirmation(cnf) ? cnf : undefined;
        const subject: unknown = verified?.payload[this.subjectClaim];
        // a token bound to something not checked here is refused rather than taken as unbound
        if (
            verified == undefined
            || typeof subject !== 'string'
            || !this.isTakenToken(verified, bearerTokens)
            || (cnf != undefined && confirmation == undefined)
        ) {
            return undefined;
        }
        // the issuer identities are stored with is the one the ID token of the login named, which is
        // the one the token was verified against
        const identity: FederatedIdentity | undefined = await this.identityRepository.findOne({
            where: { issuer, subject, forLogin: true },
            required: false
        });
        if (identity == undefined) {
            return undefined;
        }
        const authTime: unknown = verified.payload['auth_time'];
        return {
            userId: identity.userId,
            authenticatedAt: typeof authTime === 'number' ? new Date(authTime * Ms.SECOND) : undefined,
            expiresAt: verified.payload.exp == undefined ? undefined : new Date(verified.payload.exp * Ms.SECOND),
            providerAuthentication: this.findProviderAuthentication(verified.payload),
            dpopKeyThumbprint: confirmation?.jkt,
            certificateThumbprint: confirmation?.['x5t#S256']
        };
    }

    /**
     * The url at the provider that ends the session there a login was started from: its end session
     * endpoint, told which ID token the session was started with and where to send the browser back to.
     * @param session - The session the login kept.
     * @returns The url, or undefined when the provider publishes no end session endpoint.
     */
    override async createLogoutUrl(session: FederatedSession): Promise<string | undefined> {
        const endpoint: string | undefined = (await this.resolveConfiguration()).serverMetadata().end_session_endpoint;
        if (endpoint == undefined) {
            return undefined;
        }
        const url: URL = new URL(endpoint);
        if (session.logout != undefined) {
            url.searchParams.set('id_token_hint', session.logout);
        }
        url.searchParams.set('client_id', this.clientId);
        url.searchParams.set('post_logout_redirect_uri', this.resolveRouteUrl('logout'));
        return url.toString();
    }

    /**
     * Reads what the provider sent the browser to the logout route with: a front-channel logout naming
     * the issuer and the session the user logged out of there, or the browser coming back after the
     * provider ended its session on a logout started here.
     * @param message - The query of the redirect.
     * @returns What the provider said.
     * @throws BadRequestError when the provider posted, which OpenID Connect does not do, or names
     * another issuer or no session.
     */
    // eslint-disable-next-line typescript/require-await
    override async readProviderLogout(message: FederatedProviderLogoutMessage): Promise<FederatedProviderLogout> {
        if (message.binding !== 'redirect') {
            throw new BadRequestError($ts`The provider "${this.name}" logs out with a redirect, not a posted form.`);
        }
        const issuer: string | null = message.query.get('iss');
        const sessionId: string | null = message.query.get('sid');
        if (issuer == undefined && sessionId == undefined) {
            return { type: 'response' };
        }
        // the session alone: a front-channel logout names no user, and the page it is loaded in
        // carries the cookies of whoever is in the browser, which may be somebody else
        if (issuer == undefined || !URL.canParse(issuer) || !this.isOwnIssuer(issuer) || sessionId == undefined) {
            throw new BadRequestError($ts`The logout names another provider, or no session.`);
        }
        return {
            type: 'request',
            session: { provider: this.name, subjectKey: undefined, sessionKey: this.toSessionKey([this.issuer, sessionId]) },
            answer: undefined
        };
    }

    /**
     * Reads a logout token the provider sent server to server (OpenID Connect Back-Channel Logout 1.0):
     * verified against the keys the provider publishes, issued by it for this client, carrying the
     * back-channel logout event and no nonce, and presented once.
     * @param token - The token, exactly as it arrived.
     * @returns The logins that end: those of the session the token names, or of the person when it
     * names no session.
     * @throws UnauthorizedError when the token does not verify, carries no such event, carries a
     * nonce, names neither a session nor a person, or was presented before.
     */
    override async resolveBackChannelLogout(token: string): Promise<FederatedSessionMatch> {
        const metadata: ServerMetadata = (await this.resolveConfiguration()).serverMetadata();
        const keySet: JwtRemoteKeySet | undefined = this.resolveKeySet(metadata);
        const issuer: string | undefined = this.findTokenIssuer(token);
        const payload: JWTPayload | undefined = keySet == undefined || issuer == undefined
            ? undefined
            : await JwtUtilities.verifyLogoutToken(token, keySet, {
                issuer,
                audiences: [this.clientId],
                algorithms: this.allowedAlgorithms,
                maxAgeInMs: this.logoutTokenMaxAgeInMs,
                clockToleranceInMs: this.acceptedClockSkewInMs
            });
        const events: unknown = payload?.['events'];
        const sessionId: unknown = payload?.['sid'];
        const subject: unknown = payload?.sub;
        if (
            payload == undefined
            || typeof events !== 'object' || events == undefined || !(BACK_CHANNEL_LOGOUT_EVENT in events)
            // a nonce marks an ID token, which must never pass as a logout token
            || payload['nonce'] != undefined
            || (typeof sessionId !== 'string' && typeof subject !== 'string')
        ) {
            throw new UnauthorizedError($ts`The logout token could not be verified.`);
        }
        await this.spendLogoutToken(String(payload.jti));
        return {
            provider: this.name,
            subjectKey: typeof subject === 'string' ? this.toSessionKey([this.issuer, subject]) : undefined,
            sessionKey: typeof sessionId === 'string' ? this.toSessionKey([this.issuer, sessionId]) : undefined
        };
    }

    /**
     * Reads what the registration of a new user gets from the claims of the provider's ID token.
     *
     * Override it for a provider that names these differently, or sends them next to the code.
     * @param claims - The verified claims of the ID token.
     * @param answer - Everything the provider sent the browser back with. Unlike the claims, nothing
     * signed it.
     * @returns The email, whether it is verified, and the names.
     */
    protected resolveProfile(
        claims: IDToken,
        // eslint-disable-next-line unusedImports/no-unused-vars
        answer: URLSearchParams
    ): FederatedProfile {
        return {
            email: this.findStringClaim(claims, 'email'),
            emailVerified: typeof claims['email_verified'] === 'boolean' ? claims['email_verified'] : undefined,
            name: this.findStringClaim(claims, 'name'),
            givenName: this.findStringClaim(claims, 'given_name'),
            familyName: this.findStringClaim(claims, 'family_name')
        };
    }

    protected override async createConfiguration(
        client: OpenIdClient,
        clientAuthentication: ClientAuth,
        requestOptions: DiscoveryRequestOptions
    ): Promise<Configuration> {
        return await client.discovery(
            new URL(this.issuer),
            this.clientId,
            // for the times in the ID token of a login
            { [client.clockTolerance]: Math.floor(this.acceptedClockSkewInMs / Ms.SECOND) },
            clientAuthentication,
            requestOptions
        );
    }

    protected override getAuthorizationParameters(exchange: Pick<OAuthCodeExchange, 'nonce' | 'maxAgeInSeconds'>): Record<string, string> {
        return {
            nonce: exchange.nonce,
            // what makes a provider say when the user logged in: a provider that silently reused its
            // session has not produced a fresh login, and the login time is what a route accepting a
            // recent login in place of a second factor reads. Not sent to a provider that does not
            // answer it, which may refuse a parameter it does not know
            ...this.authenticationTime === 'auth_time' ? { max_age: String(exchange.maxAgeInSeconds) } : {},
            ...this.acrValues.length ? { acr_values: this.acrValues.join(' ') } : {}
        };
    }

    /**
     * Reads the provider's metadata while the application starts, so a wrong `issuer` or a provider
     * that cannot be reached is found by the deployment rather than by the first user.
     * @throws InternalError when it cannot be read, unless `discoveryAtBoot` lets a provider that cannot
     * be reached by.
     */
    private async discoverAtBoot(): Promise<void> {
        try {
            await this.resolveConfiguration();
        }
        catch (error) {
            if (this.discoveryAtBoot === 'whenReachable' && this.isUnreachable(error)) {
                this.oidcLogger.warn(
                    `${this.constructor.name} could not reach its provider at ${this.issuer}, and reads its metadata on the first login.`,
                    { error }
                );
                return;
            }
            throw new InternalError(
                `${this.constructor.name} could not read the metadata of its provider at ${this.issuer}.`,
                { cause: error }
            );
        }
    }

    /**
     * Whether reading the metadata failed because the provider could not be reached, rather than
     * because it answered with something other than its metadata.
     * @param error - What reading it threw.
     * @returns True for a failed connection, a timeout, or an answer of the provider's server failing.
     */
    private isUnreachable(error: unknown): boolean {
        const client: OpenIdClient = this.resolveOpenIdClient();
        return !(error instanceof client.ClientError)
            // the answer openid-client found wrong rides along: a server error is an outage, any other
            // answer is a provider saying something about the url, such as a 404 for a wrong issuer
            || (error.code === 'OAUTH_RESPONSE_IS_NOT_CONFORM' && error.cause instanceof Response && error.cause.status >= 500);
    }

    /**
     * Reads how the user proved who they are at the provider, off the `amr` and `acr` claims.
     * @param claims - The verified claims of a token.
     * @returns What they say, or undefined when the token carries neither.
     */
    private findProviderAuthentication(claims: JWTPayload): ProviderAuthentication | undefined {
        const amr: unknown = claims['amr'];
        const acr: unknown = claims['acr'];
        if (!Array.isArray(amr) && typeof acr !== 'string') {
            return undefined;
        }
        return {
            methods: Array.isArray(amr) ? amr.filter((method): method is string => typeof method === 'string') : [],
            contextClass: typeof acr === 'string' ? acr : undefined
        };
    }

    /**
     * Verifies the ID token - its signature against the provider's keys, its algorithm, issuer,
     * audience, expiry, nonce and login time.
     * @param answer - Everything the provider sent the browser back with.
     * @param exchange - What the answer is checked and exchanged with.
     * @returns Who the ID token says logged in and when, and the tokens. Or that the user logged in at
     * the provider longer ago than allowed, which starts the login again asking for a fresh one.
     * @throws FederatedLoginError when the provider cannot be reached or the token cannot be verified.
     */
    protected override async resolveLogin(
        answer: URLSearchParams,
        exchange: OAuthCodeExchange
    ): Promise<OAuthProviderLogin | FederatedReauthentication> {
        const tokens: TokenEndpointResponse & TokenEndpointResponseHelpers = await this.exchangeCode(answer, exchange, {
            expectedNonce: exchange.nonce,
            idTokenExpected: true
        });
        const claims: IDToken | undefined = tokens.claims();
        const subject: string | undefined = claims == undefined ? undefined : this.findStringClaim(claims, this.subjectClaim);
        // a token without the claim the identity is known by names nobody
        if (claims == undefined || subject == undefined || !this.isSignedWithAllowedAlgorithm(tokens.id_token)) {
            throw new FederatedLoginError(FederatedLoginFailure.INVALID, { action: exchange.action });
        }
        // verified already against the provider's issuer, which for a multi-tenant endpoint is every
        // tenant's: which of them log in is the application's to say
        if (!this.isOwnIssuer(claims.iss)) {
            throw new FederatedLoginError(FederatedLoginFailure.REFUSED, { action: exchange.action });
        }
        const authenticatedAt: Date | FederatedReauthentication = this.resolveAuthenticatedAt(claims, exchange);
        if ('reauthenticate' in authenticatedAt) {
            return authenticatedAt;
        }
        return {
            identity: {
                issuer: claims.iss,
                subject,
                authenticatedAt,
                profile: this.resolveProfile(claims, answer),
                claims: { ...claims },
                providerAuthentication: this.findProviderAuthentication(claims)
            },
            tokens,
            // the session the provider names in `sid`, which its logouts name again, and the ID token
            // the end session endpoint is told which session to end with
            session: tokens.id_token == undefined
                ? undefined
                : { id: this.findStringClaim(claims, 'sid'), logout: tokens.id_token }
        };
    }

    /**
     * The keys a login is found by: the person by the subject, a session by its id alone, since a
     * provider's logout may name the session without the person.
     * @param subject - Who the person is at the provider.
     * @param sessionId - The provider's id of the session, if it names one.
     * @returns The keys.
     */
    protected override resolveSessionKeys(subject: string, sessionId: string | undefined): FederatedSessionMatch {
        return {
            provider: this.name,
            subjectKey: this.toSessionKey([this.issuer, subject]),
            sessionKey: sessionId == undefined ? undefined : this.toSessionKey([this.issuer, sessionId])
        };
    }

    /**
     * Reads when the user logged in at the provider off the ID token, as `authenticationTime` says the
     * provider reports it.
     * @param claims - The verified claims of the ID token.
     * @param exchange - What the answer is checked with.
     * @returns The time. Or that it is longer ago than allowed, which starts the login again.
     * @throws FederatedLoginError when the provider should have said and did not.
     */
    private resolveAuthenticatedAt(claims: IDToken, exchange: OAuthCodeExchange): Date | FederatedReauthentication {
        if (this.authenticationTime === 'none') {
            // the provider does not say, and may have reused its own session without asking the user.
            // So the login never counts as a recent login, rather than passing a provider session as
            // a fresh login to a route that would take one for a second factor
            return new Date(0);
        }
        // the provider was asked with max_age, so a token without the claim is not what it promised
        if (typeof claims.auth_time !== 'number') {
            throw new FederatedLoginError(FederatedLoginFailure.INVALID, { action: exchange.action });
        }
        const authenticatedAt: Date = new Date(claims.auth_time * Ms.SECOND);
        // judged here rather than by the library's own max_age check, which refuses: a provider that
        // ignored max_age is asked for a fresh login with the prompt instead, so the user logs in
        // once more and lands where they wanted
        return Date.now() - authenticatedAt.getTime() > exchange.maxAgeInSeconds * Ms.SECOND ? { reauthenticate: true } : authenticatedAt;
    }

    /**
     * Whether the ID token is signed with one of the allowed algorithms.
     *
     * Checked on top of the verification, which accepts what the provider says it signs with: the
     * client metadata that would narrow that takes a single algorithm.
     * @param idToken - The ID token, verified already.
     * @returns True when its algorithm is allowed.
     */
    private isSignedWithAllowedAlgorithm(idToken: string | undefined): boolean {
        const header: string | undefined = idToken?.split('.')[0];
        if (header == undefined) {
            return false;
        }
        const parsed: unknown = JsonUtilities.parse<unknown>(Buffer.from(header, 'base64url').toString('utf8'));
        return typeof parsed === 'object' && parsed != undefined && 'alg' in parsed
            && typeof parsed.alg === 'string' && this.allowedAlgorithms.includes(parsed.alg);
    }

    /**
     * Whether a verified token is one `bearerTokens` takes: an access token for one of the api's
     * audiences, of the type it says, or an ID token for one of the clients.
     * @param verified - The token, verified already.
     * @param bearerTokens - Which tokens are taken.
     * @returns True when it is taken.
     */
    private isTakenToken(verified: EncodedJwt<JWTPayload>, bearerTokens: OidcBearerTokens): boolean {
        const audiences: string[] = typeof verified.payload.aud === 'string' ? [verified.payload.aud] : verified.payload.aud ?? [];
        // `application/at+jwt` is the same type written out in full, which RFC 9068 allows
        const isMarkedAccessToken: boolean = verified.header.typ?.toLowerCase().replace(/^application\//, '') === 'at+jwt';
        const isAccessToken: boolean = audiences.some(audience => bearerTokens.accessTokenAudiences.includes(audience))
            && (bearerTokens.accessTokenType === 'any' || isMarkedAccessToken);
        // a token marked as an access token is none of the ID tokens, whoever it is for
        const isIdToken: boolean = audiences.some(audience => bearerTokens.idTokenAudiences.includes(audience)) && !isMarkedAccessToken;
        return isAccessToken || isIdToken;
    }

    private findStringClaim(claims: IDToken, name: string): string | undefined {
        const value: unknown = claims[name];
        return typeof value === 'string' ? value : undefined;
    }

    /**
     * The keys the provider signs its tokens with, from where its metadata says they are.
     * @param metadata - The provider's metadata.
     * @returns The key set, or undefined when the provider publishes none.
     */
    private resolveKeySet(metadata: ServerMetadata): JwtRemoteKeySet | undefined {
        if (metadata.jwks_uri == undefined) {
            return undefined;
        }
        this.keySet ??= JwtUtilities.createRemoteKeySet(
            metadata.jwks_uri,
            async (url, init) => await this.httpClient.fetchForLibrary(url, init)
        );
        return this.keySet;
    }

    /**
     * Records that a logout token has been taken, and refuses one taken before.
     *
     * A lease rather than anything local, so a token replayed against another replica is refused as
     * well. It lapses once the token is too old to be taken anyway.
     * @param jti - The id of the token.
     * @throws UnauthorizedError when the token was taken before.
     */
    private async spendLogoutToken(jti: string): Promise<void> {
        // for as long as it is taken: from the skew before its iat to the age and the skew after it
        const leaseInMs: number = this.logoutTokenMaxAgeInMs + (2 * this.acceptedClockSkewInMs);
        const first: boolean | undefined = await this.leaseService.withLease(
            { key: `logout-token:${this.name}:${jti}`, leaseInMs, mode: 'skip', onCompletion: 'retain' },
            () => Promise.resolve(true)
        );
        if (first !== true) {
            throw new UnauthorizedError($ts`The logout token was presented before.`);
        }
    }

    /**
     * The issuer a token of the provider names, when it is this provider.
     *
     * Read before the token is verified, to know which issuer to verify it against, which the
     * verification then holds it to: a multi-tenant endpoint names a template rather than an issuer.
     * @param token - The token.
     * @returns The issuer, or undefined when the token names none, or another.
     */
    private findTokenIssuer(token: string): string | undefined {
        const payload: unknown = JwtUtilities.findUnverifiedPayload(token);
        const issuer: unknown = typeof payload === 'object' && payload != undefined && 'iss' in payload ? payload.iss : undefined;
        return typeof issuer === 'string' && URL.canParse(issuer) && this.isOwnIssuer(issuer) ? issuer : undefined;
    }
}