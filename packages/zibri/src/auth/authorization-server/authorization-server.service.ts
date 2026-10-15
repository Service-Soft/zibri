import { createPublicKey, KeyObject, X509Certificate } from 'node:crypto';

import { AuthorizationServerControllerClass } from './authorization-server-controller-class.type';
import { AuthorizationServerControllerOptions } from './authorization-server-controller-options.model';
import { isAuthorizationServerControllerClass } from './authorization-server-controller.model';
import { AuthorizationServerEndpoint } from './authorization-server-endpoint.model';
import { AuthorizationServerMetadata } from './authorization-server-metadata.model';
import { AuthorizationServerServiceInterface } from './authorization-server-service.interface';
import { IntrospectionResponse } from './introspection-response.model';
import { OAuth2ClientCredentials } from './oauth2-client-credentials.model';
import { OAuth2ErrorCode } from './oauth2-error-code.enum';
import { OAuth2ErrorOptions } from './oauth2-error-options.model';
import { OAuth2Error } from './oauth2.error';
import { TokenPresentation } from './token-presentation.model';
import { TokenRequest } from './token-request.model';
import { TokenResponse } from './token-response.model';
import { ZibriApplication } from '../../application/application';
import { HttpRequestContext } from '../../context/request/http-request.context';
import { WebsocketRequestContext } from '../../context/request/websocket-request.context';
import { Inject } from '../../di/decorators/inject.decorator';
import { Injectable } from '../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { InternalError } from '../../error-handling/internal-error.model';
import { AfterAppInit } from '../../global/after-app-init.interface';
import { OnAppInit } from '../../global/on-app-init.interface';
import { HttpMethod } from '../../http/http-method.enum';
import { HttpClientInterface } from '../../http-client/http-client.interface';
import { type LeaseServiceInterface } from '../../leases/lease-service.interface';
import { $ts } from '../../localization/translate.function';
import { AuditAction, AuditOutcome, AuditReason } from '../../logging/audit-event.model';
import { auditReasonFor } from '../../logging/audit-reason-for.function';
import { type LoggerInterface } from '../../logging/logger.interface';
import { BaseMembership } from '../../tenancy/membership/base-membership.model';
import { type MembershipServiceInterface } from '../../tenancy/membership/membership-service.interface';
import { Ms } from '../../utilities/ms';
import { type AuthServiceInterface } from '../auth-service.interface';
import { type DpopServiceInterface } from '../dpop/dpop-service.interface';
import { type HashServiceInterface } from '../hash/hash-service.interface';
import { Sha256HashStrategy } from '../hash/strategies/sha256.hash-strategy';
import { BaseUser } from '../models/base-user.model';
import { ApiKeyAuthenticationMethod } from '../strategies/api-key/api-key-authentication-method.enum';
import { type ApiKeyServiceInterface } from '../strategies/api-key/api-key-service.interface';
import { ApiKey } from '../strategies/api-key/api-key.model';
import { ClientAccessTokenIssuingAuthStrategyInterface,
    isClientAccessTokenIssuingAuthStrategy } from '../strategies/client-access-token-issuing-auth-strategy.interface';
import { ClientCertificateUtilities } from '../strategies/client-certificate/client-certificate.utilities';
import { ClientCertificateAuthStrategyInterface, isClientCertificateAuthStrategy } from '../strategies/client-certificate-auth-strategy.interface';
import { IssuedClientAccessToken } from '../strategies/issued-client-access-token.model';
import { isJwksControllerClass, JwksController } from '../strategies/jwt/jwks.controller';
import { JwtAsymmetricAlgorithm } from '../strategies/jwt/jwt-asymmetric-algorithm.type';
import { JwtRemoteKeySet } from '../strategies/jwt/jwt-remote-key-set.type';
import { JwtUtilities } from '../strategies/jwt/jwt.utilities';
import { isTokenIntrospectingAuthStrategy, TokenIntrospectingAuthStrategyInterface } from '../strategies/token-introspecting-auth-strategy.interface';
import { type UserServiceInterface } from '../user/user-service.interface';

/**
 * The only grant the token endpoint issues tokens for.
 */
const CLIENT_CREDENTIALS_GRANT: string = 'client_credentials';

/**
 * The kind of a jwt a client signed to authenticate itself (RFC 7523, 2.2).
 */
const JWT_BEARER_ASSERTION_TYPE: string = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';

/**
 * How far ahead a jwt a client signed may expire. A jwt is remembered as spent until it expires, so
 * this bounds how long that is.
 */
const MAX_ASSERTION_LIFETIME_IN_MS: number = Ms.HOUR;

/**
 * Every way a client may authenticate, as RFC 8414 names them.
 */
const CLIENT_AUTHENTICATION_METHODS: string[] = [
    'client_secret_basic',
    'client_secret_post',
    'private_key_jwt',
    'tls_client_auth',
    'self_signed_tls_client_auth'
];

/**
 * What a jwt a client signs may be signed with.
 */
const ASSERTION_ALGORITHMS: JwtAsymmetricAlgorithm[] = ['ES256', 'ES384', 'ES512', 'EdDSA', 'RS256'];

/**
 * What a client that sent its secret in the authorization header is refused with: a challenge to send
 * it there again (RFC 6749, 5.2).
 */
const BASIC_CHALLENGE: OAuth2ErrorOptions = { challenge: 'Basic realm="token"' };

/**
 * How a request says which client it is from, before anything about it is checked.
 */
type PresentedClient = {
    /**
     * How the client authenticates: its secret in the authorization header or in the body, a jwt it
     * signed, or a client certificate.
     */
    method: 'basic' | 'post' | 'assertion' | 'certificate',
    /**
     * The id the client names itself by.
     */
    clientId: string,
    /**
     * The secret, or the jwt, it proves itself with. Undefined for a certificate.
     */
    proof: string | undefined
};

/**
 * A client whose credentials were checked.
 */
type AuthenticatedClient = {
    /**
     * The client's api key.
     */
    apiKey: ApiKey,
    /**
     * The user the api key acts as.
     */
    user: BaseUser<string>,
    /**
     * The SHA-256 thumbprint of the client certificate it authenticated with, if it did.
     */
    certificateThumbprint: string | undefined
};

/**
 * Who asks whether a token is active.
 */
type IntrospectionCaller = {
    /**
     * Their id, for the trail.
     */
    userId: string | undefined,
    /**
     * The roles they hold for the request.
     */
    roles: string[]
};

/**
 * A token a strategy answered as active, and the strategy.
 */
type ActiveToken = {
    /**
     * The strategy whose token it is.
     */
    strategy: TokenIntrospectingAuthStrategyInterface<string, BaseUser<string>>,
    /**
     * What the token says.
     */
    introspection: IntrospectionResponse
};

/**
 * Default implementation of the service answering the routes of the authorization server.
 */
@Injectable({ register: 'onUse' })
export class AuthorizationServerService implements AuthorizationServerServiceInterface, OnAppInit, AfterAppInit {
    /**
     * The key sets clients publish, by url, which keep what they fetched for a while.
     */
    private readonly remoteKeySets: Map<string, JwtRemoteKeySet> = new Map();

    /**
     * Whether the application declares an authorization server.
     */
    private declared: boolean = false;

    // read when used rather than injected, so that an application without an authorization server
    // never resolves them
    private get apiKeyService(): ApiKeyServiceInterface {
        return inject(ZIBRI_DI_TOKENS.API_KEY_SERVICE);
    }

    private get membershipService(): MembershipServiceInterface {
        return inject(ZIBRI_DI_TOKENS.MEMBERSHIP_SERVICE);
    }

    private get userService(): UserServiceInterface {
        return inject(ZIBRI_DI_TOKENS.USER_SERVICE);
    }

    private get authService(): AuthServiceInterface {
        return inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
    }

    private get httpClient(): HttpClientInterface {
        return inject(ZIBRI_DI_TOKENS.HTTP_CLIENT);
    }

    private get dpopService(): DpopServiceInterface {
        return inject(ZIBRI_DI_TOKENS.DPOP_SERVICE);
    }

    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        private readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.HASH_SERVICE)
        private readonly hashService: HashServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.LEASE_SERVICE)
        private readonly leaseService: LeaseServiceInterface
    ) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    onAppInit(app: ZibriApplication): void {
        const controllers: AuthorizationServerControllerClass[] = app.options.controllers.filter(
            c => isAuthorizationServerControllerClass(c)
        );
        const controller: AuthorizationServerControllerClass | undefined = controllers[0];
        if (controller == undefined) {
            return;
        }
        this.declared = true;
        this.validateSetup(app, controllers);
        const keysController: typeof JwksController | undefined = app.options.controllers.find(isJwksControllerClass);
        this.logger.info('registers the metadata of the authorization server at /.well-known/oauth-authorization-server');
        inject(ZIBRI_DI_TOKENS.ROUTER).registerRoute({
            httpMethod: HttpMethod.GET,
            route: '/.well-known/oauth-authorization-server',
            versions: 'all',
            openApi: { useInOpenApi: false },
            // public by definition, like the keys: a client reads it before it holds anything
            auth: { skip: true },
            handler: () => this.toMetadata(
                controller.resolveEndpoint(),
                keysController?.resolveUrl(),
                this.authService.resolveStrategies(isClientCertificateAuthStrategy).length > 0
            )
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    afterAppInit(): void {
        // after the strategies are registered, which is what tells which of them can do what
        if (this.declared) {
            this.resolveIssuingStrategy();
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async issueToken(
        endpoint: AuthorizationServerEndpoint,
        request: TokenRequest,
        authorization: string | undefined
    ): Promise<TokenResponse> {
        let presented: PresentedClient | undefined;
        try {
            presented = this.findPresentedClient(request, authorization);
            if (request.grant_type == undefined) {
                throw new OAuth2Error(OAuth2ErrorCode.INVALID_REQUEST, $ts`The request names no grant_type.`);
            }
            if (request.grant_type !== CLIENT_CREDENTIALS_GRANT) {
                throw new OAuth2Error(
                    OAuth2ErrorCode.UNSUPPORTED_GRANT_TYPE,
                    $ts`Tokens are issued for the client_credentials grant only.`
                );
            }
            if (presented == undefined) {
                throw new OAuth2Error(OAuth2ErrorCode.INVALID_CLIENT, $ts`The request authenticates no client.`);
            }
            const client: AuthenticatedClient = await this.resolveClient(endpoint, presented, `${endpoint.url}/token`);
            const dpopKeyThumbprint: string | undefined = await this.resolveDpopKeyThumbprint(client);
            const roles: string[] = await this.resolveGrantedRoles(client, request.scope);
            const issued: IssuedClientAccessToken = await this.resolveIssuingStrategy().issueClientAccessToken(client.user, {
                clientId: client.apiKey.id,
                roles,
                tenantId: client.apiKey.tenantId ?? undefined,
                audience: this.resolveAudience(endpoint, request.resource),
                certificateThumbprint: client.certificateThumbprint,
                dpopKeyThumbprint
            });
            this.logger.audit({
                action: AuditAction.TOKEN_ISSUED,
                outcome: AuditOutcome.SUCCESS,
                subject: client.apiKey.id,
                userId: client.user.id
            });
            return {
                access_token: issued.value,
                // the scheme a request sends it with (RFC 9449, 5)
                token_type: dpopKeyThumbprint == undefined ? 'Bearer' : 'DPoP',
                expires_in: Math.floor(issued.expiresInMs / Ms.SECOND),
                scope: roles.join(' ')
            };
        }
        catch (error) {
            this.logger.audit({
                action: AuditAction.TOKEN_ISSUED,
                outcome: AuditOutcome.FAILURE,
                reason: auditReasonFor(error),
                subject: presented?.clientId
            });
            throw error;
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async introspect(
        endpoint: AuthorizationServerEndpoint,
        presentation: TokenPresentation,
        authorization: string | undefined
    ): Promise<IntrospectionResponse> {
        const caller: IntrospectionCaller = await this.resolveIntrospectionCaller(endpoint, presentation, authorization);
        if (!caller.roles.some(role => endpoint.introspectionRoles.includes(role))) {
            this.logger.audit({
                action: AuditAction.AUTHORIZATION,
                outcome: AuditOutcome.FAILURE,
                reason: AuditReason.MISSING_ROLE,
                userId: caller.userId
            });
            throw new OAuth2Error(OAuth2ErrorCode.INSUFFICIENT_SCOPE, $ts`The caller holds none of the roles that may introspect.`);
        }
        const active: ActiveToken | undefined = await this.findActiveToken(this.validateToken(presentation));
        return active?.introspection ?? { active: false };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async revoke(endpoint: AuthorizationServerEndpoint, presentation: TokenPresentation, authorization: string | undefined): Promise<void> {
        // holding a token is enough to revoke it, since revoking only ever takes access away. A client
        // that authenticates may revoke only its own (RFC 7009, 2.1)
        const presented: PresentedClient | undefined = this.findPresentedClient(presentation, authorization);
        const client: AuthenticatedClient | undefined = presented == undefined
            ? undefined
            : await this.resolveClient(endpoint, presented, `${endpoint.url}/revoke`);
        const token: string = this.validateToken(presentation);
        // a token that is not active has nothing left to take away, whoever asks
        const active: ActiveToken | undefined = await this.findActiveToken(token);
        if (active == undefined) {
            return;
        }
        // a token of a login names no client, so no client may revoke it
        this.validateOwnToken(client, active.introspection.client_id);
        await active.strategy.revokeToken(token);
        this.logger.audit({ action: AuditAction.TOKEN_REVOKED, outcome: AuditOutcome.SUCCESS, userId: active.introspection.sub });
    }

    /**
     * The DPoP key a client asks its token to be bound to, by the proof its request carries.
     * @param client - The client.
     * @returns The thumbprint of the key, or undefined when the request carries no proof.
     * @throws An OAuth2Error `invalid_dpop_proof` when the proof is not valid, or the api key binds its
     * tokens and the request carries none, or `use_dpop_nonce`.
     */
    private async resolveDpopKeyThumbprint(client: AuthenticatedClient): Promise<string | undefined> {
        const context: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
        const thumbprint: string | undefined = context == undefined
            ? undefined
            : await this.dpopService.resolveProofThumbprint(context, undefined);
        if (thumbprint == undefined && client.apiKey.requireDpop) {
            throw new OAuth2Error(
                OAuth2ErrorCode.INVALID_DPOP_PROOF,
                $ts`The tokens of the client are bound to a DPoP key, which the request carries no proof of.`
            );
        }
        return thumbprint;
    }

    /**
     * Finds the registered strategy a token is an active one of, asking each that answers for its tokens.
     * @param token - The token.
     * @returns The strategy and what the token says, or undefined when it is no active token of any.
     */
    private async findActiveToken(token: string): Promise<ActiveToken | undefined> {
        for (const strategy of this.authService.resolveStrategies(isTokenIntrospectingAuthStrategy)) {
            const introspection: IntrospectionResponse = await strategy.introspectToken(token);
            if (introspection.active) {
                return { strategy, introspection };
            }
        }
        return undefined;
    }

    /**
     * Refuses an application that declares the authorization server without what it needs.
     * @param app - The application.
     * @param controllers - Every authorization server controller it declares.
     * @throws An InternalError naming what is missing.
     */
    private validateSetup(app: ZibriApplication, controllers: AuthorizationServerControllerClass[]): void {
        if (controllers.length > 1) {
            throw new InternalError('An application declares one AuthorizationServerController, since it issues tokens as one issuer.');
        }
        // the clients are api keys
        this.apiKeyService.registerReader(app, 'AuthorizationServerController');
        for (const controller of controllers) {
            const options: AuthorizationServerControllerOptions<string> = controller.authorizationServerOptions;
            if (!options.introspectionRoles.length) {
                throw new InternalError('The AuthorizationServerController names no role that may introspect tokens.');
            }
            for (const resource of options.resources) {
                if (!URL.canParse(resource) || new URL(resource).hash !== '') {
                    throw new InternalError(
                        `The resource "${resource}" of the AuthorizationServerController is not an absolute url without a fragment.`
                    );
                }
            }
        }
    }

    /**
     * What the authorization server publishes about itself.
     * @param endpoint - Where its routes answer.
     * @param jwksUri - Where the keys tokens are signed with are published, if they are.
     * @param bindsTokens - Whether tokens issued over a client certificate are bound to it.
     * @returns The metadata.
     */
    private toMetadata(
        endpoint: AuthorizationServerEndpoint,
        jwksUri: string | undefined,
        bindsTokens: boolean
    ): AuthorizationServerMetadata {
        return {
            issuer: endpoint.issuer,
            token_endpoint: `${endpoint.url}/token`,
            introspection_endpoint: `${endpoint.url}/introspect`,
            revocation_endpoint: `${endpoint.url}/revoke`,
            ...jwksUri == undefined ? {} : { jwks_uri: jwksUri },
            response_types_supported: [],
            grant_types_supported: [CLIENT_CREDENTIALS_GRANT],
            token_endpoint_auth_methods_supported: CLIENT_AUTHENTICATION_METHODS,
            token_endpoint_auth_signing_alg_values_supported: ASSERTION_ALGORITHMS,
            introspection_endpoint_auth_methods_supported: CLIENT_AUTHENTICATION_METHODS,
            revocation_endpoint_auth_methods_supported: [...CLIENT_AUTHENTICATION_METHODS, 'none'],
            tls_client_certificate_bound_access_tokens: bindsTokens,
            dpop_signing_alg_values_supported: this.dpopService.algorithms
        };
    }

    /**
     * Reads how a request says which client it is from: its id and secret in the authorization
     * header or in the body, a jwt it signed, or its id beside a client certificate.
     * @param credentials - The body of the request.
     * @param authorization - The authorization header of the request.
     * @returns The client as it presents itself, or undefined when the request names none.
     * @throws An OAuth2Error when the request authenticates in more than one way, or in a way that
     * cannot be read.
     */
    private findPresentedClient(credentials: OAuth2ClientCredentials, authorization: string | undefined): PresentedClient | undefined {
        const presented: PresentedClient[] = [];
        const basic: PresentedClient | undefined = this.findBasicCredentials(authorization);
        if (basic != undefined) {
            presented.push(basic);
        }
        if (credentials.client_secret != undefined) {
            if (credentials.client_id == undefined) {
                throw new OAuth2Error(OAuth2ErrorCode.INVALID_REQUEST, $ts`A client_secret is sent with a client_id.`);
            }
            presented.push({ method: 'post', clientId: credentials.client_id, proof: credentials.client_secret });
        }
        if (credentials.client_assertion != undefined || credentials.client_assertion_type != undefined) {
            if (credentials.client_assertion_type !== JWT_BEARER_ASSERTION_TYPE || credentials.client_assertion == undefined) {
                throw new OAuth2Error(
                    OAuth2ErrorCode.INVALID_REQUEST,
                    $ts`A client_assertion is a jwt, sent with the client_assertion_type ${JWT_BEARER_ASSERTION_TYPE}.`
                );
            }
            presented.push({
                method: 'assertion',
                // the jwt names the client as its subject, which is the one it is checked against
                clientId: credentials.client_id ?? this.findAssertionSubject(credentials.client_assertion),
                proof: credentials.client_assertion
            });
        }
        if (presented.length > 1) {
            throw new OAuth2Error(OAuth2ErrorCode.INVALID_REQUEST, $ts`The request authenticates its client in more than one way.`);
        }
        if (basic != undefined && credentials.client_id != undefined && credentials.client_id !== basic.clientId) {
            throw new OAuth2Error(OAuth2ErrorCode.INVALID_REQUEST, $ts`The client_id differs from the client in the authorization header.`);
        }
        if (presented[0] == undefined && credentials.client_id != undefined) {
            // an id and nothing else to prove it: a client authenticating with its certificate
            return { method: 'certificate', clientId: credentials.client_id, proof: undefined };
        }
        return presented[0];
    }

    /**
     * Reads the id and secret of a client in the authorization header (RFC 6749, 2.3.1).
     * @param authorization - The authorization header.
     * @returns The client, or undefined when the header holds no basic credentials.
     * @throws An OAuth2Error when it holds basic credentials that cannot be read.
     */
    private findBasicCredentials(authorization: string | undefined): PresentedClient | undefined {
        const [scheme, encoded] = authorization?.split(' ') ?? [];
        if (scheme?.toLowerCase() !== 'basic') {
            return undefined;
        }
        const decoded: string = Buffer.from(encoded ?? '', 'base64').toString('utf8');
        const separator: number = decoded.indexOf(':');
        if (separator < 1) {
            throw new OAuth2Error(
                OAuth2ErrorCode.INVALID_CLIENT,
                $ts`The authorization header holds no client id and secret.`,
                BASIC_CHALLENGE
            );
        }
        try {
            // both are form encoded before they are joined, so a colon in either one survives
            return {
                method: 'basic',
                clientId: decodeURIComponent(decoded.slice(0, separator).replaceAll('+', ' ')),
                proof: decodeURIComponent(decoded.slice(separator + 1).replaceAll('+', ' '))
            };
        }
        catch {
            throw new OAuth2Error(
                OAuth2ErrorCode.INVALID_CLIENT,
                $ts`The authorization header holds no client id and secret.`,
                BASIC_CHALLENGE
            );
        }
    }

    /**
     * The client a jwt it signed names as its subject, read before it is verified to find the key it
     * is verified with.
     * @param assertion - The jwt.
     * @returns The subject, or an empty id that names no client.
     */
    private findAssertionSubject(assertion: string): string {
        const payload: unknown = JwtUtilities.findUnverifiedPayload(assertion);
        return typeof payload === 'object'
            && payload != undefined
            && 'sub' in payload
            && typeof payload.sub === 'string'
            ? payload.sub
            : '';
    }

    /**
     * Checks the credentials of a client.
     * @param endpoint - Where the routes answer.
     * @param presented - The client as it presents itself.
     * @param calledUrl - The url of the route the request was sent to, which a jwt the client signed
     * may be for.
     * @returns The client, its api key and the user it acts as.
     * @throws An OAuth2Error `invalid_client` when the credentials are not those of an active api key
     * of an active user.
     */
    private async resolveClient(
        endpoint: AuthorizationServerEndpoint,
        presented: PresentedClient,
        calledUrl: string
    ): Promise<AuthenticatedClient> {
        // one answer for every way it can fail: which one it was matters only to somebody guessing
        const refused: OAuth2Error = new OAuth2Error(
            OAuth2ErrorCode.INVALID_CLIENT,
            $ts`The client could not be authenticated.`,
            presented.method === 'basic' ? BASIC_CHALLENGE : {}
        );
        const apiKey: ApiKey | undefined = await this.apiKeyService.findActiveById(presented.clientId);
        if (apiKey == undefined) {
            throw refused;
        }
        const certificateThumbprint: string | undefined = await this.resolveProof(endpoint, presented, apiKey, calledUrl, refused);
        const user: BaseUser<string> | undefined = await this.userService.findById(apiKey.userId, { required: false });
        if (user == undefined || user.deactivatedAt != undefined) {
            throw refused;
        }
        return { apiKey, user, certificateThumbprint };
    }

    /**
     * Checks that a client proves itself the way its api key says it does.
     * @param endpoint - Where the routes answer.
     * @param presented - The client as it presents itself.
     * @param apiKey - Its api key.
     * @param calledUrl - The url of the route the request was sent to.
     * @param refused - What a client that does not prove itself is refused with.
     * @returns The thumbprint of the client certificate it proved itself with, if it did.
     * @throws The refusal, when it does not prove itself.
     */
    private async resolveProof(
        endpoint: AuthorizationServerEndpoint,
        presented: PresentedClient,
        apiKey: ApiKey,
        calledUrl: string,
        refused: OAuth2Error
    ): Promise<string | undefined> {
        switch (presented.method) {
            case 'basic':
            case 'post': {
                const hash: string | undefined = presented.proof == undefined
                    ? undefined
                    : await this.hashService.hash(presented.proof, { strategy: Sha256HashStrategy });
                if (
                    apiKey.authenticationMethod !== ApiKeyAuthenticationMethod.SECRET
                    || apiKey.value == undefined
                    || hash !== apiKey.value
                ) {
                    throw refused;
                }
                return undefined;
            }
            case 'assertion': {
                if (apiKey.authenticationMethod !== ApiKeyAuthenticationMethod.PRIVATE_KEY_JWT || presented.proof == undefined) {
                    throw refused;
                }
                await this.validateAssertion(presented.proof, apiKey, [endpoint.issuer, `${endpoint.url}/token`, calledUrl], refused);
                return undefined;
            }
            case 'certificate': {
                return await this.resolveCertificateThumbprint(apiKey, refused);
            }
        }
    }

    /**
     * Checks a jwt a client signed to authenticate itself, and spends it.
     * @param assertion - The jwt.
     * @param apiKey - The client's api key.
     * @param audiences - Who the jwt may be for.
     * @param refused - What a jwt that does not verify is refused with.
     * @throws The refusal, when the jwt does not verify, expires too far ahead or was spent before.
     */
    private async validateAssertion(assertion: string, apiKey: ApiKey, audiences: string[], refused: OAuth2Error): Promise<void> {
        const key: KeyObject | JwtRemoteKeySet | undefined = this.findClientKey(apiKey);
        const payload: Record<string, unknown> | undefined = key == undefined
            ? undefined
            : await JwtUtilities.verifyAssertion(assertion, key, { clientId: apiKey.id, audiences });
        const expiresAt: number = typeof payload?.['exp'] === 'number' ? payload['exp'] * Ms.SECOND : 0;
        const jwtId: unknown = payload?.['jti'];
        if (typeof jwtId !== 'string' || expiresAt - Date.now() > MAX_ASSERTION_LIFETIME_IN_MS) {
            throw refused;
        }
        // kept rather than handed back, for as long as the jwt could be presented: it is the record
        // that the jwt was spent, on every replica
        const first: boolean | undefined = await this.leaseService.withLease(
            {
                key: `oauth2-client-assertion:${apiKey.id}:${jwtId}`,
                leaseInMs: Math.max(expiresAt - Date.now(), Ms.SECOND),
                mode: 'skip',
                onCompletion: 'retain'
            },
            () => Promise.resolve(true)
        );
        if (first !== true) {
            throw refused;
        }
    }

    /**
     * The key a client signs its jwts with: its public key, or the key set it publishes.
     * @param apiKey - The client's api key.
     * @returns The key, or undefined for an api key that names none.
     */
    private findClientKey(apiKey: ApiKey): KeyObject | JwtRemoteKeySet | undefined {
        if (apiKey.publicKey != undefined) {
            return createPublicKey(apiKey.publicKey);
        }
        if (apiKey.jwksUrl == undefined) {
            return undefined;
        }
        const known: JwtRemoteKeySet | undefined = this.remoteKeySets.get(apiKey.jwksUrl);
        if (known != undefined) {
            return known;
        }
        const keySet: JwtRemoteKeySet = JwtUtilities.createRemoteKeySet(
            apiKey.jwksUrl,
            async (url, init) => await this.httpClient.fetchForLibrary(url, init)
        );
        this.remoteKeySets.set(apiKey.jwksUrl, keySet);
        return keySet;
    }

    /**
     * Checks the client certificate a client authenticates with, the way its api key says.
     * @param apiKey - The client's api key.
     * @param refused - What a client that does not prove itself is refused with.
     * @returns The thumbprint of the certificate.
     * @throws The refusal, when the request presents no certificate, or not one of the api key.
     */
    private async resolveCertificateThumbprint(apiKey: ApiKey, refused: OAuth2Error): Promise<string> {
        const strategy: ClientCertificateAuthStrategyInterface<string, BaseUser<string>> | undefined
            = this.authService.resolveStrategies(isClientCertificateAuthStrategy)[0];
        const context: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
        const certificate: X509Certificate | undefined = context == undefined ? undefined : strategy?.findClientCertificate(context);
        if (strategy == undefined || certificate == undefined) {
            throw refused;
        }
        const thumbprint: string = JwtUtilities.resolveCertificateThumbprint(certificate);
        switch (apiKey.authenticationMethod) {
            case ApiKeyAuthenticationMethod.TLS_CLIENT_AUTH: {
                // an authority issued it, and the application finds the key's user for it
                const user: BaseUser<string> | undefined = strategy.isTrusted(certificate)
                    ? await strategy.resolveUserByCertificate(certificate)
                    : undefined;
                if (user?.id !== apiKey.userId) {
                    throw refused;
                }
                return thumbprint;
            }
            case ApiKeyAuthenticationMethod.SELF_SIGNED_TLS_CLIENT_AUTH: {
                if (!ClientCertificateUtilities.isWithinValidity(certificate) || thumbprint !== apiKey.certificateThumbprint) {
                    throw refused;
                }
                return thumbprint;
            }
            case ApiKeyAuthenticationMethod.SECRET:
            case ApiKeyAuthenticationMethod.PRIVATE_KEY_JWT: {
                throw refused;
            }
        }
    }

    /**
     * The roles a token a client is issued may use: those it asks for, each one its api key may use
     * and its user has - of their own, or through a membership in the tenant the key is bound to, or in
     * any tenant for a key bound to none - or all of those.
     * @param client - The client.
     * @param scope - The roles it asks for, separated by spaces.
     * @returns The roles.
     * @throws An OAuth2Error `invalid_scope` when it asks for one it may not use.
     */
    private async resolveGrantedRoles(client: AuthenticatedClient, scope: string | undefined): Promise<string[]> {
        const tenantId: string | undefined = client.apiKey.tenantId ?? undefined;
        const memberships: BaseMembership<string>[] = tenantId == undefined
            ? await this.membershipService.findMemberships(client.user.id)
            : [await this.membershipService.findMembership(client.user.id, tenantId)].filter(m => m != undefined);
        const held: Set<string> = new Set([...client.user.roles, ...memberships.flatMap(membership => membership.roles)]);
        const allowed: string[] = client.apiKey.roles.filter(role => held.has(role));
        const requested: string[] = scope?.split(' ').filter(role => role !== '') ?? [];
        const refused: string[] = requested.filter(role => !allowed.includes(role));
        if (refused.length) {
            throw new OAuth2Error(OAuth2ErrorCode.INVALID_SCOPE, $ts`The client may not use the roles ${refused.join(', ')}.`);
        }
        return requested.length ? [...new Set(requested)] : allowed;
    }

    /**
     * Who a token a client is issued is for: the services it asks for, each one tokens may be issued
     * for, or the application.
     * @param endpoint - Where the routes answer, and the services tokens may be issued for.
     * @param resources - The services the client asks for.
     * @returns Who the token is for.
     * @throws An OAuth2Error `invalid_target` when it asks for one tokens are not issued for.
     */
    private resolveAudience(endpoint: AuthorizationServerEndpoint, resources: string[] | undefined): string[] {
        if (!resources?.length) {
            return [endpoint.issuer];
        }
        const allowed: string[] = [endpoint.issuer, ...endpoint.resources];
        const refused: string[] = resources.filter(resource => !allowed.includes(resource));
        if (refused.length) {
            throw new OAuth2Error(OAuth2ErrorCode.INVALID_TARGET, $ts`Tokens are not issued for ${refused.join(', ')}.`);
        }
        return [...new Set(resources)];
    }

    /**
     * Finds who asks whether a token is active: a client by its credentials, or the user of any other
     * credential the request carries, such as an api key.
     * @param endpoint - Where the routes answer.
     * @param presentation - The body of the request.
     * @param authorization - The authorization header of the request.
     * @returns The caller and the roles they hold.
     * @throws An OAuth2Error `invalid_client` when the request carries no credential, or one that is
     * refused.
     */
    private async resolveIntrospectionCaller(
        endpoint: AuthorizationServerEndpoint,
        presentation: TokenPresentation,
        authorization: string | undefined
    ): Promise<IntrospectionCaller> {
        const presented: PresentedClient | undefined = this.findPresentedClient(presentation, authorization);
        if (presented != undefined) {
            const client: AuthenticatedClient = await this.resolveClient(endpoint, presented, `${endpoint.url}/introspect`);
            return { userId: client.user.id, roles: client.user.roles.filter(role => client.apiKey.roles.includes(role)) };
        }
        const context: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
        const user: BaseUser<string> | undefined = context == undefined
            ? undefined
            : await this.authService.getCurrentUser<string, BaseUser<string>, false>(context, this.authService.strategies, false);
        if (user == undefined) {
            this.logger.audit({ action: AuditAction.AUTHORIZATION, outcome: AuditOutcome.FAILURE, reason: AuditReason.NOT_LOGGED_IN });
            throw new OAuth2Error(OAuth2ErrorCode.INVALID_CLIENT, $ts`The request authenticates no caller.`);
        }
        return { userId: user.id, roles: user.roles };
    }

    /**
     * The token a request presents.
     * @param presentation - The body of the request.
     * @returns The token.
     * @throws An OAuth2Error `invalid_request` when it presents none.
     */
    private validateToken(presentation: TokenPresentation): string {
        if (presentation.token == undefined || presentation.token === '') {
            throw new OAuth2Error(OAuth2ErrorCode.INVALID_REQUEST, $ts`The request names no token.`);
        }
        return presentation.token;
    }

    /**
     * Refuses a client revoking a token that was not issued to it.
     * @param client - The client that authenticated, if one did.
     * @param clientId - The client the token was issued to, or undefined for a token of a login.
     * @throws An OAuth2Error `unauthorized_client` when a client authenticated and the token is not its own.
     */
    private validateOwnToken(client: AuthenticatedClient | undefined, clientId: string | undefined): void {
        if (client != undefined && client.apiKey.id !== clientId) {
            throw new OAuth2Error(OAuth2ErrorCode.UNAUTHORIZED_CLIENT, $ts`The token was not issued to the client.`);
        }
    }

    /**
     * The one registered strategy that issues the access tokens of clients, so that every token the
     * authorization server issues is one the application takes.
     * @returns Its instance.
     * @throws An InternalError when the application registered none, or more than one.
     */
    private resolveIssuingStrategy(): ClientAccessTokenIssuingAuthStrategyInterface<string, BaseUser<string>> {
        const strategies: ClientAccessTokenIssuingAuthStrategyInterface<string, BaseUser<string>>[]
            = this.authService.resolveStrategies(isClientAccessTokenIssuingAuthStrategy);
        const strategy: ClientAccessTokenIssuingAuthStrategyInterface<string, BaseUser<string>> | undefined = strategies[0];
        if (strategy == undefined || strategies.length > 1) {
            throw new InternalError([
                'The authorization server issues its tokens through the one strategy that issues the access tokens of clients,',
                `such as ClientAccessTokenAuthStrategy. The authStrategies hold ${strategies.length}.`
            ]);
        }
        return strategy;
    }
}