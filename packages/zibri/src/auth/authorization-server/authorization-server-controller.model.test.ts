import { generateKeyPairSync, KeyObject, randomBytes, X509Certificate } from 'node:crypto';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createRemoteJWKSet, exportJWK, jwtVerify, JWTVerifyResult, SignJWT } from 'jose';
import { createFakeKeyPair, createInMemoryDataSource, FakeDpopKey, FakeKeyPair, InMemoryDataSource } from 'zibri-testing';

import { AuthorizationServerController } from './authorization-server-controller.model';
import { IntrospectionResponse } from './introspection-response.model';
import { JwtTestAuthController } from '../../__testing__/mocks/controllers/jwt-test-auth.controller';
import { JwtUser } from '../../__testing__/mocks/entities/jwt-user.entity';
import { Roles } from '../../__testing__/mocks/entities/roles.enum';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { HttpRequestContext } from '../../context/request/http-request.context';
import { WebsocketRequestContext } from '../../context/request/websocket-request.context';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { defineProvider, DiProvider } from '../../di/models/di-provider.model';
import { BaseEntity } from '../../entity/base-entity.model';
import { GlobalRegistry } from '../../global/global-registry';
import { OpenApiSecuritySchemeObject } from '../../open-api/open-api.model';
import { Controller } from '../../routing/decorators/controller.decorator';
import { Get } from '../../routing/decorators/get.decorator';
import { Newable } from '../../types/newable.type';
import { JsonUtilities } from '../../utilities/json.utilities';
import { Ms } from '../../utilities/ms';
import { type AuthServiceInterface } from '../auth-service.interface';
import { PasswordCredentials, PasswordCredentialsCreateData } from '../authenticators/password/password-credentials.model';
import { PasswordAuthenticator } from '../authenticators/password/password.authenticator';
import { Auth } from '../decorators/auth.decorator';
import { CurrentUser } from '../decorators/current-user.decorator';
import { BaseUser } from '../models/base-user.model';
import { ApiKeyAuthenticationMethod } from '../strategies/api-key/api-key-authentication-method.enum';
import { ApiKeyAuthStrategy } from '../strategies/api-key/api-key.auth-strategy';
import { ApiKey } from '../strategies/api-key/api-key.model';
import { CreatedApiKey } from '../strategies/api-key/created-api-key.model';
import { AuthStrategies } from '../strategies/auth-strategies.model';
import { AuthorizationHeaderUtilities } from '../strategies/authorization-header.utilities';
import { AuthorizationToken } from '../strategies/authorization-token.model';
import { ClientAccessTokenAuthStrategy } from '../strategies/client-access-token/client-access-token.auth-strategy';
import { ClientAccessTokenGrant } from '../strategies/client-access-token-grant.model';
import { ClientAccessTokenIssuingAuthStrategyInterface } from '../strategies/client-access-token-issuing-auth-strategy.interface';
import { BaseClientCertificateAuthStrategy } from '../strategies/client-certificate/base-client-certificate.auth-strategy';
import { ClientCertificateHeaderFormat } from '../strategies/client-certificate/client-certificate-header-format.type';
import { IssuedClientAccessToken } from '../strategies/issued-client-access-token.model';
import { AccessTokenRevocation } from '../strategies/jwt/access-token-revocation.type';
import { JwksController } from '../strategies/jwt/jwks.controller';
import { JwtAuthData } from '../strategies/jwt/jwt-auth-data.model';
import { JwtAuthOptionsInput } from '../strategies/jwt/jwt-auth-options.model';
import { JwtRevokedAccessToken } from '../strategies/jwt/jwt-revoked-access-token.model';
import { JwtAuthStrategy } from '../strategies/jwt/jwt.auth-strategy';
import { JwtUtilities } from '../strategies/jwt/jwt.utilities';

/**
 * What the route answering with the current user answers.
 */
type Me = {
    id: string,
    roles: Roles[]
};

/**
 * What the token endpoint, introspection and errors answer, as far as the tests read it.
 */
type OAuth2Answer = Record<string, unknown>;

/**
 * A service the application lets clients ask for tokens for, besides itself.
 */
const REPORTS: string = 'https://reports.example.com';

@Controller('/machine')
class MachineController {
    @Auth.isLoggedIn()
    @Get('/me')
    me(
        @CurrentUser()
        user: JwtUser
    ): Me {
        return { id: user.id, roles: user.roles };
    }

    @Auth.hasPlatformRole([Roles.ADMIN])
    @Get('/admin')
    admin(): { ok: boolean } {
        return { ok: true };
    }

    // a route for people only, which a client's token cannot reach whatever its roles
    @Auth.isLoggedIn([JwtAuthStrategy])
    @Get('/people-only')
    peopleOnly(): { ok: boolean } {
        return { ok: true };
    }
}

@Controller('/oauth2')
class TestAuthorizationServerController extends AuthorizationServerController({ introspectionRoles: [Roles.ADMIN], resources: [REPORTS] }) {}

/**
 * The authority client certificates are issued by, made before any application starts.
 */
let authority: FakeKeyPair;

/**
 * Takes the certificate from the proxy on this machine, which is where the test's requests come from,
 * and finds the user by the email address in its common name.
 */
class LocalProxyClientCertificateAuthStrategy extends BaseClientCertificateAuthStrategy<Roles, JwtUser> {
    readonly header: string = 'Client-Cert';
    readonly headerFormat: ClientCertificateHeaderFormat = 'rfc9440';
    readonly trustedProxies: string[] = ['127.0.0.1', '::1'];
    readonly certificateAuthorities: string[] = [authority.certificate];

    async resolveUserByCertificate(certificate: X509Certificate): Promise<JwtUser | undefined> {
        const email: string | undefined = /^CN=(.+)$/m.exec(certificate.subject)?.[1];
        return email == undefined ? undefined : await inject(repositoryTokenFor(JwtUser)).findOne({ where: { email }, required: false });
    }
}

/**
 * Every strategy an application with an authorization server registers, and one for certificates.
 */
const ALL_STRATEGIES: AuthStrategies = [JwtAuthStrategy, ApiKeyAuthStrategy, ClientAccessTokenAuthStrategy, LocalProxyClientCertificateAuthStrategy];

let server: StartedTestServer | undefined;
let baseUrl: string;

/**
 * Starts an application with an authorization server, keeping its data in memory.
 * @param providers - What it runs with besides the defaults.
 * @param entities - The entities it declares besides the defaults.
 * @param authStrategies - The strategies it reads requests with.
 * @param controllers - Its controllers besides the defaults.
 * @returns The server, started.
 */
async function startApp(
    providers: DiProvider<unknown>[] = [],
    entities: Newable<BaseEntity>[] = [ApiKey],
    authStrategies: AuthStrategies = ALL_STRATEGIES,
    controllers: Newable<object>[] = []
): Promise<StartedTestServer> {
    const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
        entities: [...defaultTestServerEntities, ...entities],
        allowOrphan: true
    });
    return await startTestServer({
        dataSources: [dataSourceClass],
        authStrategies,
        controllers: [
            TestAuthorizationServerController,
            MachineController,
            ...authStrategies.some(strategy => strategy === JwtAuthStrategy) ? [JwtTestAuthController] : [],
            ...controllers
        ],
        providers: [...defaultTestServerProviders, ...providers]
    });
}

/**
 * Who the application's tokens name as their issuer.
 * @returns Its baseUrl.
 */
function issuer(): string {
    return GlobalRegistry.getAppData('baseUrl') ?? '';
}

/**
 * Posts a form to a route of the authorization server.
 * @param path - The route below /oauth2.
 * @param fields - The fields of the form.
 * @param headers - The headers to send besides its type.
 * @returns The answer.
 */
async function post(path: string, fields: [string, string][], headers: Record<string, string> = {}): Promise<Response> {
    return await fetch(`${baseUrl}/oauth2${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
        body: new URLSearchParams(fields).toString()
    });
}

/**
 * Reads the body of an answer.
 * @param res - The answer.
 * @returns Its body.
 */
async function body(res: Response): Promise<OAuth2Answer> {
    const json: unknown = await res.json();
    if (typeof json !== 'object' || json == undefined) {
        throw new Error(`The answer is no object: ${String(json)}`);
    }
    return Object.fromEntries(Object.entries(json));
}

/**
 * The authorization header a client sends its id and secret in.
 * @param clientId - The id.
 * @param secret - The secret.
 * @returns The header.
 */
function basic(clientId: string, secret: string): Record<string, string> {
    const buffer: Buffer = Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(secret)}`);
    return { authorization: `Basic ${buffer.toString('base64')}` };
}

/**
 * Asks for a token with a client's id and secret in the authorization header.
 * @param key - The client's api key.
 * @param fields - The fields of the form besides the grant type.
 * @param headers - The headers to send besides the authorization header, such as a DPoP proof.
 * @returns The answer.
 */
async function requestToken(key: CreatedApiKey, fields: [string, string][] = [], headers: Record<string, string> = {}): Promise<Response> {
    return await post('/token', [['grant_type', 'client_credentials'], ...fields], { ...basic(key.apiKey.id, key.key), ...headers });
}

/**
 * Asks for a token with a client's id and secret, and reads it.
 * @param key - The client's api key.
 * @param fields - The fields of the form besides the grant type.
 * @returns The access token.
 */
async function issueToken(key: CreatedApiKey, fields: [string, string][] = []): Promise<string> {
    const res: Response = await requestToken(key, fields);
    expect(res.status).toBe(200);
    return String((await body(res))['access_token']);
}

/**
 * Calls a route of the machine controller with a bearer token.
 * @param path - The route below /machine.
 * @param token - The token.
 * @param headers - The headers to send besides it.
 * @returns The answer.
 */
async function callWith(path: string, token: string, headers: Record<string, string> = {}): Promise<Response> {
    return await fetch(`${baseUrl}/machine${path}`, { headers: { authorization: `Bearer ${token}`, ...headers } });
}

/**
 * Calls a route of the machine controller with a token bound to a DPoP key, and a proof of the key.
 * @param path - The route below /machine.
 * @param token - The token.
 * @param dpopKey - The key the proof is signed with.
 * @param nonce - The nonce the proof carries, if any.
 * @returns The answer.
 */
async function callBound(path: string, token: string, dpopKey: FakeDpopKey, nonce?: string): Promise<Response> {
    return await fetch(`${baseUrl}/machine${path}`, {
        headers: {
            authorization: `DPoP ${token}`,
            dpop: dpopKey.createProof('GET', `${issuer()}/machine${path}`, { accessToken: token, nonce })
        }
    });
}

/**
 * The auth service of the running application.
 * @returns The service.
 */
function authService(): AuthServiceInterface {
    return inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
}

/**
 * Creates a user with the given roles.
 * @param name - What sets the user's email apart.
 * @param roles - The roles of the user.
 * @returns The user.
 */
async function createUser(name: string, roles: Roles[] = [Roles.USER]): Promise<JwtUser> {
    return await inject(repositoryTokenFor(JwtUser)).create({ email: `${name}@clients.test`, roles });
}

/**
 * Creates an api key that is a secret.
 * @param user - The user the key acts as.
 * @param roles - The roles the key may use.
 * @param expiresAt - When the key stops working.
 * @returns The created key.
 */
async function createKey(user: JwtUser, roles: Roles[] = [Roles.USER], expiresAt: Date | undefined = undefined): Promise<CreatedApiKey> {
    return await authService().createApiKey(user.id, { name: 'service', roles, expiresAt, tenantId: undefined, clientAuthentication: undefined, requireDpop: false }, undefined);
}

/**
 * The api key of a resource server that may introspect tokens.
 * @returns The key itself.
 */
async function createResourceServerKey(): Promise<string> {
    return (await createKey(await createUser(`resource-server-${Date.now()}-${Math.random()}`, [Roles.ADMIN]), [Roles.ADMIN])).key;
}

/**
 * Introspects a token as a resource server holding an api key.
 * @param token - The token.
 * @param key - The resource server's api key.
 * @returns The answer.
 */
async function introspect(token: string, key: string): Promise<OAuth2Answer> {
    const res: Response = await post('/introspect', [['token', token]], { 'x-api-key': key });
    expect(res.status).toBe(200);
    return await body(res);
}

/**
 * Logs a user in with a password and the jwt strategy.
 * @param user - The user.
 * @returns The tokens.
 */
async function login(user: JwtUser): Promise<JwtAuthData<Roles>> {
    const credentials: Repository<PasswordCredentials, PasswordCredentialsCreateData> = inject(repositoryTokenFor(PasswordCredentials));
    await credentials.create({ userId: user.id, password: 'correct horse battery staple' });
    return await authService().login(
        PasswordAuthenticator<Roles>,
        JwtAuthStrategy<Roles>,
        { email: user.email, password: 'correct horse battery staple' },
        undefined
    );
}

/**
 * Issues a client certificate to a user, signed by the authority.
 * @param user - The user, whose email address is its common name.
 * @returns The certificate, PEM encoded.
 */
async function issueCertificate(user: JwtUser): Promise<string> {
    return (await createFakeKeyPair(`CN=${user.email}`, { issuer: authority })).certificate;
}

/**
 * Makes a self-signed client certificate for a user.
 * @param user - The user, whose email address is its common name.
 * @returns The certificate, PEM encoded.
 */
async function createSelfSignedCertificate(user: JwtUser): Promise<string> {
    return (await createFakeKeyPair(`CN=${user.email}`, {})).certificate;
}

/**
 * Where a server on this machine listens.
 * @param listening - The server, listening.
 * @returns Its port.
 * @throws When the address of the server is invalid.
 */
function portOf(listening: Server): number {
    const address: string | AddressInfo | null = listening.address();
    if (address == undefined || typeof address === 'string') {
        throw new Error('The server listens on no port.');
    }
    return address.port;
}

/**
 * The header the proxy forwards a certificate in.
 * @param certificate - The certificate, PEM encoded.
 * @returns The header, as RFC 9440 writes it.
 */
function certificateHeader(certificate: string): Record<string, string> {
    return { 'client-cert': `:${new X509Certificate(certificate).raw.toString('base64')}:` };
}

/**
 * Signs a jwt a client authenticates with (RFC 7523).
 * @param privateKey - The client's private key.
 * @param clientId - The client.
 * @param audience - Who the jwt is for.
 * @param expiresInSeconds - When it expires, from now.
 * @param kid - The key id to name in the header.
 * @returns The jwt.
 */
async function signAssertion(
    privateKey: KeyObject,
    clientId: string,
    audience: string,
    expiresInSeconds: number = 60,
    kid: string | undefined = undefined
): Promise<string> {
    return await new SignJWT({ jti: `${Date.now()}-${Math.random()}` })
        .setProtectedHeader({ alg: 'ES256', kid })
        .setIssuer(clientId)
        .setSubject(clientId)
        .setAudience(audience)
        .setIssuedAt()
        .setExpirationTime(Math.floor(Date.now() / 1000) + expiresInSeconds)
        .sign(privateKey);
}

/**
 * Asks for a token with a jwt the client signed.
 * @param assertion - The jwt.
 * @returns The answer.
 */
async function requestTokenWithAssertion(assertion: string): Promise<Response> {
    return await post('/token', [
        ['grant_type', 'client_credentials'],
        ['client_assertion_type', 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer'],
        ['client_assertion', assertion]
    ]);
}

beforeAll(async () => {
    authority = await createFakeKeyPair('CN=Client test authority', { authority: true });
});

/**
 * A second strategy issuing the access tokens of clients, beside ClientAccessTokenAuthStrategy.
 */
class CompanyClientAccessTokenAuthStrategy<Role extends string> extends ClientAccessTokenAuthStrategy<Role> {}

/**
 * What the opaque strategy below keeps of a token it issued.
 */
type OpaqueToken = {
    userId: string,
    clientId: string,
    roles: string[]
};

/**
 * Issues opaque tokens and keeps them in memory: a strategy of the application's own, related to none
 * the framework ships.
 */
class OpaqueClientAccessTokenAuthStrategy implements ClientAccessTokenIssuingAuthStrategyInterface<Roles, JwtUser> {
    readonly name: string = 'opaque-client-access-token';
    readonly securityScheme: OpenApiSecuritySchemeObject = { type: 'http', scheme: 'bearer' };
    private readonly tokens: Map<string, OpaqueToken> = new Map();

    hasCredential(context: HttpRequestContext | WebsocketRequestContext): boolean {
        return this.findRequestToken(context) != undefined;
    }

    async resolveUser(context: HttpRequestContext | WebsocketRequestContext): Promise<JwtUser | undefined> {
        const token: OpaqueToken | undefined = this.findRequestToken(context);
        const user: JwtUser | undefined = token == undefined
            ? undefined
            : await inject(repositoryTokenFor(JwtUser)).findOne({ where: { id: token.userId }, required: false });
        return token == undefined || user == undefined ? undefined : { ...user, roles: user.roles.filter(role => token.roles.includes(role)) };
    }

    async resolveAuthenticatedAt(): Promise<Date | undefined> {
        return await Promise.resolve<Date | undefined>(undefined);
    }

    async resolveExpiresAt(): Promise<Date | undefined> {
        // kept until the application stops, which is all this fixture needs
        return await Promise.resolve<Date | undefined>(undefined);
    }

    async issueClientAccessToken(user: BaseUser<string>, grant: ClientAccessTokenGrant): Promise<IssuedClientAccessToken> {
        const value: string = randomBytes(32).toString('base64url');
        this.tokens.set(value, { userId: user.id, clientId: grant.clientId, roles: grant.roles });
        return await Promise.resolve({ value, expiresInMs: Ms.HOUR });
    }

    async introspectToken(token: string): Promise<IntrospectionResponse> {
        const found: OpaqueToken | undefined = this.tokens.get(token);
        return await Promise.resolve(found == undefined
            ? { active: false }
            : { active: true, sub: found.userId, client_id: found.clientId, scope: found.roles.join(' '), token_type: 'Bearer' });
    }

    async revokeToken(token: string): Promise<void> {
        this.tokens.delete(token);
        await Promise.resolve();
    }

    private findRequestToken(context: HttpRequestContext | WebsocketRequestContext): OpaqueToken | undefined {
        const token: AuthorizationToken | undefined = AuthorizationHeaderUtilities.findToken(context);
        return token?.scheme === 'Bearer' ? this.tokens.get(token.value) : undefined;
    }
}

describe('AuthorizationServerController — starting', () => {
    it.each([
        [[JwtAuthStrategy, ApiKeyAuthStrategy], [ApiKey], 'The authStrategies hold 0'],
        [[ClientAccessTokenAuthStrategy, CompanyClientAccessTokenAuthStrategy], [ApiKey], 'The authStrategies hold 2'],
        [[JwtAuthStrategy, ClientAccessTokenAuthStrategy], [], /AuthorizationServerController[\S\s]*ApiKey/]
    ])('refuses to start without one strategy issuing the tokens of clients, or without its clients (%#)', async (strategies, entities, message) => {
        await expect(startApp([], entities, strategies)).rejects.toThrow(message);
    }, 30000);

    it('starts with the strategy issuing the tokens of clients alone, which issues and reads them', async () => {
        server = await startApp([], [ApiKey], [ClientAccessTokenAuthStrategy]);
        try {
            baseUrl = await server.start();
            const user: JwtUser = await createUser('issuer-only');
            const key: ApiKey = await authService().createApiKey(user.id, {
                name: 'issuer-only',
                roles: [Roles.USER],
                expiresAt: undefined,
                tenantId: undefined,
                clientAuthentication: { method: ApiKeyAuthenticationMethod.SELF_SIGNED_TLS_CLIENT_AUTH, certificate: await createSelfSignedCertificate(user) },
                requireDpop: false
            }, undefined);
            const secretKey: CreatedApiKey = await createKey(user);

            expect(key.authenticationMethod).toBe(ApiKeyAuthenticationMethod.SELF_SIGNED_TLS_CLIENT_AUTH);
            expect((await callWith('/me', await issueToken(secretKey))).status).toBe(200);
        }
        finally {
            await server.shutdown();
        }
    }, 30000);

    it('issues, introspects and revokes through a strategy of the application\'s own', async () => {
        server = await startApp([], [ApiKey], [OpaqueClientAccessTokenAuthStrategy]);
        try {
            baseUrl = await server.start();
            const user: JwtUser = await createUser('opaque');
            const resourceServer: CreatedApiKey = await createKey(await createUser('opaque-resource-server', [Roles.ADMIN]), [Roles.ADMIN]);

            const token: string = await issueToken(await createKey(user));

            expect(JwtUtilities.findUnverifiedPayload(token)).toBeUndefined();
            expect((await callWith('/me', token)).status).toBe(200);
            const introspected: Response = await post('/introspect', [['token', token]], basic(resourceServer.apiKey.id, resourceServer.key));
            expect(await body(introspected)).toMatchObject({ active: true, sub: user.id, scope: Roles.USER });
            expect((await post('/revoke', [['token', token]])).status).toBe(200);
            expect((await callWith('/me', token)).status).toBe(401);
        }
        finally {
            await server.shutdown();
        }
    }, 30000);

    it('refuses to revoke access tokens at once while checks trust the credential', async () => {
        await expect(startApp([
            defineProvider({ token: ZIBRI_DI_TOKENS.ACCESS_TOKEN_REVOCATION, useFactory: (): AccessTokenRevocation => 'immediately' }),
            defineProvider({ token: ZIBRI_DI_TOKENS.REVALIDATE_USER_ON_AUTH_CHECK, useFactory: () => false })
        ], [ApiKey, JwtRevokedAccessToken])).rejects.toThrow('REVALIDATE_USER_ON_AUTH_CHECK is false');
    }, 30000);

    it('refuses to revoke client tokens at once without the entity they are kept in', async () => {
        await expect(startApp([defineProvider({ token: ZIBRI_DI_TOKENS.ACCESS_TOKEN_REVOCATION, useFactory: (): AccessTokenRevocation => 'immediately' })])).rejects.toThrow(/JwtRevokedAccessToken/);
    }, 30000);
});

describe('AuthorizationServerController — access tokens that work until they expire', () => {
    beforeAll(async () => {
        server = await startApp();
        baseUrl = await server.start();
    }, 30000);

    afterAll(async () => {
        await server?.shutdown();
    });

    it('publishes where its routes are and what they take', async () => {
        const res: Response = await fetch(`${baseUrl}/.well-known/oauth-authorization-server`);

        expect(res.status).toBe(200);
        expect(await body(res)).toEqual({
            issuer: issuer(),
            token_endpoint: `${issuer()}/oauth2/token`,
            introspection_endpoint: `${issuer()}/oauth2/introspect`,
            revocation_endpoint: `${issuer()}/oauth2/revoke`,
            response_types_supported: [],
            grant_types_supported: ['client_credentials'],
            token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'private_key_jwt', 'tls_client_auth', 'self_signed_tls_client_auth'],
            token_endpoint_auth_signing_alg_values_supported: ['ES256', 'ES384', 'ES512', 'EdDSA', 'RS256'],
            introspection_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'private_key_jwt', 'tls_client_auth', 'self_signed_tls_client_auth'],
            revocation_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'private_key_jwt', 'tls_client_auth', 'self_signed_tls_client_auth', 'none'],
            tls_client_certificate_bound_access_tokens: true,
            dpop_signing_alg_values_supported: ['ES256', 'ES384', 'ES512', 'EdDSA', 'RS256']
        });
    });

    it('binds a token to the DPoP key of a client sending a proof, which works only with a proof of that key', async () => {
        const resourceServer: string = await createResourceServerKey();
        const key: CreatedApiKey = await createKey(await createUser('dpop'));
        const dpopKey: FakeDpopKey = new FakeDpopKey();

        const res: Response = await requestToken(key, [], { dpop: dpopKey.createProof('POST', `${issuer()}/oauth2/token`) });

        expect(res.status).toBe(200);
        const answer: OAuth2Answer = await body(res);
        expect(answer).toMatchObject({ token_type: 'DPoP' });
        const token: string = String(answer['access_token']);
        expect(JwtUtilities.findUnverifiedPayload(token)).toMatchObject({ cnf: { jkt: dpopKey.thumbprint } });
        expect((await callBound('/me', token, dpopKey)).status).toBe(200);
        // as a bearer token, or with a proof of another key, it is nothing
        expect((await callWith('/me', token)).status).toBe(401);
        expect((await callBound('/me', token, new FakeDpopKey())).status).toBe(401);
        expect(await introspect(token, resourceServer)).toMatchObject({ active: true, token_type: 'DPoP', cnf: { jkt: dpopKey.thumbprint } });
        // and a bearer token sent with the scheme of a bound one is refused as well
        const bearer: string = await issueToken(key);
        expect((await callBound('/me', bearer, dpopKey)).status).toBe(401);
    });

    it('refuses a token request whose DPoP proof is not valid for it', async () => {
        const key: CreatedApiKey = await createKey(await createUser('dpop-invalid'));

        const res: Response = await requestToken(key, [], { dpop: new FakeDpopKey().createProof('POST', `${issuer()}/oauth2/introspect`) });

        expect(res.status).toBe(400);
        expect(await body(res)).toMatchObject({ error: 'invalid_dpop_proof' });
    });

    it('issues the tokens of a key requiring DPoP only to a proof, and never takes the key itself', async () => {
        const user: JwtUser = await createUser('dpop-required');
        const key: CreatedApiKey = await authService().createApiKey(
            user.id,
            { name: 'bound', roles: [Roles.USER], expiresAt: undefined, tenantId: undefined, clientAuthentication: undefined, requireDpop: true },
            undefined
        );

        const refused: Response = await requestToken(key);
        expect(refused.status).toBe(400);
        expect(await body(refused)).toMatchObject({ error: 'invalid_dpop_proof' });

        const dpopKey: FakeDpopKey = new FakeDpopKey();
        const issued: Response = await requestToken(key, [], { dpop: dpopKey.createProof('POST', `${issuer()}/oauth2/token`) });
        expect(issued.status).toBe(200);
        expect((await callBound('/me', String((await body(issued))['access_token']), dpopKey)).status).toBe(200);

        expect((await fetch(`${baseUrl}/machine/me`, { headers: { 'x-api-key': key.key } })).status).toBe(401);
        expect((await callWith('/me', key.key)).status).toBe(401);
    });

    it('issues a token to a client sending its id and secret in the authorization header, which acts as the key\'s user', async () => {
        const user: JwtUser = await createUser('basic', [Roles.USER, Roles.ADMIN]);
        const key: CreatedApiKey = await createKey(user, [Roles.USER]);

        const res: Response = await requestToken(key);

        expect(res.status).toBe(200);
        expect(res.headers.get('cache-control')).toBe('no-store');
        const answer: OAuth2Answer = await body(res);
        expect(answer).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: Roles.USER });
        const token: string = String(answer['access_token']);
        expect(JwtUtilities.findUnverifiedPayload(token)).toMatchObject({
            iss: issuer(), aud: issuer(), sub: user.id, client_id: key.apiKey.id, scope: Roles.USER
        });
        // the key's roles only, though the user holds more
        const me: Response = await callWith('/me', token);
        expect(me.status).toBe(200);
        expect(await me.json()).toEqual({ id: user.id, roles: [Roles.USER] });
        expect((await callWith('/admin', token)).status).toBe(403);
    });

    it('keeps a route that names the jwt strategy for people, whatever a client\'s token may do', async () => {
        const user: JwtUser = await createUser('people', [Roles.USER]);
        const token: string = await issueToken(await createKey(user));

        expect((await callWith('/people-only', token)).status).toBe(401);
        expect((await callWith('/people-only', (await login(user)).accessToken.value)).status).toBe(200);
    });

    it('issues a token to a client sending its id and secret in the body', async () => {
        const key: CreatedApiKey = await createKey(await createUser('post'));

        const res: Response = await post('/token', [
            ['grant_type', 'client_credentials'],
            ['client_id', key.apiKey.id],
            ['client_secret', key.key]
        ]);

        expect(res.status).toBe(200);
        expect((await callWith('/me', String((await body(res))['access_token']))).status).toBe(200);
    });

    it('refuses a wrong secret, challenging a client that sent it in the authorization header', async () => {
        const key: CreatedApiKey = await createKey(await createUser('wrong-secret'));

        const inHeader: Response = await post('/token', [['grant_type', 'client_credentials']], basic(key.apiKey.id, 'zibri_wrong'));
        expect(inHeader.status).toBe(401);
        expect(inHeader.headers.get('www-authenticate')).toBe('Basic realm="token"');
        expect(await body(inHeader)).toMatchObject({ error: 'invalid_client' });

        const inBody: Response = await post('/token', [
            ['grant_type', 'client_credentials'],
            ['client_id', key.apiKey.id],
            ['client_secret', 'zibri_wrong']
        ]);
        expect(inBody.status).toBe(401);
        expect(inBody.headers.get('www-authenticate')).toBeNull();
    });

    it('refuses a client of an expired key, of a deactivated user, or an id that is no key', async () => {
        const expired: CreatedApiKey = await createKey(await createUser('expired'), [Roles.USER], new Date(Date.now() + 200));
        await new Promise(resolve => setTimeout(resolve, 300));
        expect((await requestToken(expired)).status).toBe(401);

        // deactivated without its keys revoked, which deactivating through the auth service does as well
        const deactivatedUser: JwtUser = await createUser('deactivated');
        const deactivated: CreatedApiKey = await createKey(deactivatedUser);
        await inject(repositoryTokenFor(JwtUser)).updateById(deactivatedUser.id, { deactivatedAt: new Date() });
        expect((await requestToken(deactivated)).status).toBe(401);

        expect((await post('/token', [['grant_type', 'client_credentials']], basic('not-a-key', 'zibri_x'))).status).toBe(401);
    });

    it('answers the request errors the way OAuth2 says they look', async () => {
        const key: CreatedApiKey = await createKey(await createUser('errors'));

        const noGrant: Response = await post('/token', [], basic(key.apiKey.id, key.key));
        expect(noGrant.status).toBe(400);
        expect(await body(noGrant)).toMatchObject({ error: 'invalid_request' });

        const otherGrant: Response = await post('/token', [['grant_type', 'password']], basic(key.apiKey.id, key.key));
        expect(otherGrant.status).toBe(400);
        expect(await body(otherGrant)).toMatchObject({ error: 'unsupported_grant_type' });

        const noClient: Response = await post('/token', [['grant_type', 'client_credentials']]);
        expect(noClient.status).toBe(401);
        expect(await body(noClient)).toMatchObject({ error: 'invalid_client' });

        // two ways at once, which leaves which one counts to a guess
        const twice: Response = await post(
            '/token',
            [['grant_type', 'client_credentials'], ['client_id', key.apiKey.id], ['client_secret', key.key]],
            basic(key.apiKey.id, key.key)
        );
        expect(twice.status).toBe(400);
        expect(await body(twice)).toMatchObject({ error: 'invalid_request' });
    });

    it('issues a token for fewer roles when asked, and refuses one the key may not use', async () => {
        const user: JwtUser = await createUser('scoped', [Roles.USER, Roles.ADMIN]);
        const key: CreatedApiKey = await createKey(user, [Roles.USER, Roles.ADMIN]);

        const all: string = await issueToken(key);
        expect((await callWith('/admin', all)).status).toBe(200);

        const fewer: OAuth2Answer = await body(await requestToken(key, [['scope', Roles.USER]]));
        expect(fewer).toMatchObject({ scope: Roles.USER });
        expect((await callWith('/admin', String(fewer['access_token']))).status).toBe(403);

        const unknown: Response = await requestToken(key, [['scope', 'OWNER']]);
        expect(unknown.status).toBe(400);
        expect(await body(unknown)).toMatchObject({ error: 'invalid_scope' });
    });

    it('takes a role from a client\'s tokens when it is taken from the user', async () => {
        const user: JwtUser = await createUser('demoted', [Roles.USER, Roles.ADMIN]);
        const token: string = await issueToken(await createKey(user, [Roles.USER, Roles.ADMIN]));
        expect((await callWith('/admin', token)).status).toBe(200);

        await inject(repositoryTokenFor(JwtUser)).updateById(user.id, { roles: [Roles.USER] });

        expect((await callWith('/admin', token)).status).toBe(403);
    });

    it('issues a token for another service, which the application itself refuses', async () => {
        const key: CreatedApiKey = await createKey(await createUser('reports'));

        const token: string = await issueToken(key, [['resource', REPORTS]]);
        expect(JwtUtilities.findUnverifiedPayload(token)).toMatchObject({ aud: REPORTS });
        expect((await callWith('/me', token)).status).toBe(401);

        const both: string = await issueToken(key, [['resource', REPORTS], ['resource', issuer()]]);
        expect(JwtUtilities.findUnverifiedPayload(both)).toMatchObject({ aud: [REPORTS, issuer()] });
        expect((await callWith('/me', both)).status).toBe(200);

        const elsewhere: Response = await requestToken(key, [['resource', 'https://elsewhere.example.com']]);
        expect(elsewhere.status).toBe(400);
        expect(await body(elsewhere)).toMatchObject({ error: 'invalid_target' });
    });

    it('issues a token to a client signing a jwt with the key it registered, once per jwt', async () => {
        const user: JwtUser = await createUser('signed');
        const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
        const apiKey: ApiKey = await authService().createApiKey(user.id, {
            name: 'signer',
            roles: [Roles.USER],
            expiresAt: undefined,
            tenantId: undefined,
            clientAuthentication: { method: ApiKeyAuthenticationMethod.PRIVATE_KEY_JWT, publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString() },
            requireDpop: false
        }, undefined);
        expect(apiKey.value).toBeFalsy();

        const assertion: string = await signAssertion(privateKey, apiKey.id, `${issuer()}/oauth2/token`);
        const res: Response = await requestTokenWithAssertion(assertion);
        expect(res.status).toBe(200);
        expect((await callWith('/me', String((await body(res))['access_token']))).status).toBe(200);

        // spent: a captured jwt is worth nothing a second time
        expect((await requestTokenWithAssertion(assertion)).status).toBe(401);
        // for somebody else
        expect((await requestTokenWithAssertion(await signAssertion(privateKey, apiKey.id, 'https://elsewhere.example.com'))).status).toBe(401);
        // expiring too far ahead to be remembered as spent for that long
        expect((await requestTokenWithAssertion(await signAssertion(privateKey, apiKey.id, issuer(), 2 * 60 * 60))).status).toBe(401);
        // signed with another key
        const stranger: KeyObject = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
        expect((await requestTokenWithAssertion(await signAssertion(stranger, apiKey.id, issuer()))).status).toBe(401);
        // a key with a secret proves itself by its secret only
        const secretKey: CreatedApiKey = await createKey(user);
        expect((await requestTokenWithAssertion(await signAssertion(privateKey, secretKey.apiKey.id, issuer()))).status).toBe(401);
    });

    it('issues a token to a client signing a jwt with a key it publishes at a url', async () => {
        const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
        const jwks: string = JsonUtilities.stringify({ keys: [{ ...await exportJWK(publicKey), kid: 'client-key-1', alg: 'ES256', use: 'sig' }] });
        const keySet: Server = createServer((_req, res) => {
            res.writeHead(200, { 'content-type': 'application/json' }).end(jwks);
        });
        await new Promise<void>(resolve => keySet.listen(0, '127.0.0.1', resolve));
        try {
            const apiKey: ApiKey = await authService().createApiKey((await createUser('published')).id, {
                name: 'publisher',
                roles: [Roles.USER],
                expiresAt: undefined,
                tenantId: undefined,
                clientAuthentication: { method: ApiKeyAuthenticationMethod.PRIVATE_KEY_JWT, jwksUrl: `http://127.0.0.1:${portOf(keySet)}/jwks.json` },
                requireDpop: false
            }, undefined);

            const res: Response = await requestTokenWithAssertion(await signAssertion(privateKey, apiKey.id, issuer(), 60, 'client-key-1'));

            expect(res.status).toBe(200);
        }
        finally {
            await new Promise(resolve => keySet.close(resolve));
        }
    });

    it('refuses a key whose public key, url or certificate cannot be used', async () => {
        const user: JwtUser = await createUser('unusable');

        await expect(authService().createApiKey(user.id, {
            name: 'x',
            roles: [],
            expiresAt: undefined,
            tenantId: undefined,
            clientAuthentication: { method: ApiKeyAuthenticationMethod.PRIVATE_KEY_JWT, publicKey: 'not a key' },
            requireDpop: false
        }, undefined)).rejects.toThrow('The public key of an api key');
        await expect(authService().createApiKey(user.id, {
            name: 'x',
            roles: [],
            expiresAt: undefined,
            tenantId: undefined,
            clientAuthentication: { method: ApiKeyAuthenticationMethod.PRIVATE_KEY_JWT, jwksUrl: 'http://keys.example.com/jwks.json' },
            requireDpop: false
        }, undefined)).rejects.toThrow('has to be at an https url');
        await expect(authService().createApiKey(user.id, {
            name: 'x',
            roles: [],
            expiresAt: undefined,
            tenantId: undefined,
            clientAuthentication: { method: ApiKeyAuthenticationMethod.SELF_SIGNED_TLS_CLIENT_AUTH, certificate: 'not a certificate' },
            requireDpop: false
        }, undefined)).rejects.toThrow('The certificate of an api key');
    });

    it('issues a token bound to the certificate of a client authenticating with one an authority issued', async () => {
        const user: JwtUser = await createUser('mtls');
        const apiKey: ApiKey = await authService().createApiKey(user.id, {
            name: 'mtls',
            roles: [Roles.USER],
            expiresAt: undefined,
            tenantId: undefined,
            clientAuthentication: { method: ApiKeyAuthenticationMethod.TLS_CLIENT_AUTH },
            requireDpop: false
        }, undefined);
        const certificate: string = await issueCertificate(user);

        const res: Response = await post('/token', [['grant_type', 'client_credentials'], ['client_id', apiKey.id]], certificateHeader(certificate));

        expect(res.status).toBe(200);
        const token: string = String((await body(res))['access_token']);
        expect(JwtUtilities.findUnverifiedPayload(token)).toMatchObject({
            cnf: { 'x5t#S256': JwtUtilities.resolveCertificateThumbprint(new X509Certificate(certificate)) }
        });
        // beside its certificate one credential rather than two, and nothing without it
        expect((await callWith('/me', token, certificateHeader(certificate))).status).toBe(200);
        expect((await callWith('/me', token)).status).toBe(401);
        expect((await callWith('/me', token, certificateHeader(await issueCertificate(user)))).status).toBe(401);

        // a certificate of somebody else, and one no authority issued
        const other: JwtUser = await createUser('mtls-other');
        expect((await post('/token', [['grant_type', 'client_credentials'], ['client_id', apiKey.id]], certificateHeader(await issueCertificate(other))))
            .status).toBe(401);
        expect((await post('/token', [['grant_type', 'client_credentials'], ['client_id', apiKey.id]], certificateHeader(await createSelfSignedCertificate(user))))
            .status).toBe(401);
    });

    it('issues a token to a client authenticating with the self-signed certificate its key names', async () => {
        const user: JwtUser = await createUser('self-signed');
        const certificate: string = await createSelfSignedCertificate(user);
        const apiKey: ApiKey = await authService().createApiKey(user.id, {
            name: 'self-signed',
            roles: [Roles.USER],
            expiresAt: undefined,
            tenantId: undefined,
            clientAuthentication: { method: ApiKeyAuthenticationMethod.SELF_SIGNED_TLS_CLIENT_AUTH, certificate },
            requireDpop: false
        }, undefined);

        const res: Response = await post('/token', [['grant_type', 'client_credentials'], ['client_id', apiKey.id]], certificateHeader(certificate));
        expect(res.status).toBe(200);
        expect((await callWith('/me', String((await body(res))['access_token']), certificateHeader(certificate))).status).toBe(200);

        const another: string = await createSelfSignedCertificate(user);
        expect((await post('/token', [['grant_type', 'client_credentials'], ['client_id', apiKey.id]], certificateHeader(another))).status).toBe(401);
    });

    it('answers a resource server whether a client\'s token is active, and what it says', async () => {
        const resourceServer: string = await createResourceServerKey();
        const user: JwtUser = await createUser('introspected', [Roles.USER]);
        const key: CreatedApiKey = await createKey(user);
        const token: string = await issueToken(key);

        expect(await introspect(token, resourceServer)).toMatchObject({
            active: true,
            scope: Roles.USER,
            client_id: key.apiKey.id,
            username: user.email,
            token_type: 'Bearer',
            sub: user.id,
            aud: [issuer()],
            iss: issuer()
        });
        expect(await introspect('not-a-token', resourceServer)).toEqual({ active: false });
        expect(await introspect(`${token}x`, resourceServer)).toEqual({ active: false });

        // a token for another service is active too: it is that service's to refuse
        expect(await introspect(await issueToken(key, [['resource', REPORTS]]), resourceServer)).toMatchObject({ active: true, aud: [REPORTS] });
    });

    it('answers for the tokens of a login and for api keys, and not for a deactivated user\'s', async () => {
        const resourceServer: string = await createResourceServerKey();
        const user: JwtUser = await createUser('login-introspected');
        const tokens: JwtAuthData<Roles> = await login(user);
        const key: CreatedApiKey = await createKey(user);

        expect(await introspect(tokens.accessToken.value, resourceServer)).toMatchObject({ active: true, sub: user.id, token_type: 'Bearer' });
        expect(await introspect(tokens.refreshToken.value, resourceServer)).toMatchObject({ active: true, sub: user.id, token_type: 'refresh_token' });
        expect(await introspect(key.key, resourceServer)).toMatchObject({ active: true, sub: user.id, client_id: key.apiKey.id });

        await authService().deactivateUser(user.id, undefined);

        expect(await introspect(tokens.accessToken.value, resourceServer)).toEqual({ active: false });
        expect(await introspect(key.key, resourceServer)).toEqual({ active: false });
    });

    it('answers only a caller holding a role that may introspect', async () => {
        const token: string = await issueToken(await createKey(await createUser('guarded')));
        const someone: CreatedApiKey = await createKey(await createUser('nosy'));

        const anonymous: Response = await post('/introspect', [['token', token]]);
        expect(anonymous.status).toBe(401);
        expect(await body(anonymous)).toMatchObject({ error: 'invalid_client' });

        const withoutRole: Response = await post('/introspect', [['token', token]], { 'x-api-key': someone.key });
        expect(withoutRole.status).toBe(403);
        expect(await body(withoutRole)).toMatchObject({ error: 'insufficient_scope' });

        // a resource server authenticating as a client, the way OAuth2 libraries do
        const resourceServer: CreatedApiKey = await createKey(await createUser('resource-client', [Roles.ADMIN]), [Roles.ADMIN]);
        const asClient: Response = await post('/introspect', [['token', token]], basic(resourceServer.apiKey.id, resourceServer.key));
        expect(asClient.status).toBe(200);
        expect(await body(asClient)).toMatchObject({ active: true });

        const missing: Response = await post('/introspect', [], { 'x-api-key': resourceServer.key });
        expect(missing.status).toBe(400);
        expect(await body(missing)).toMatchObject({ error: 'invalid_request' });
    });

    it('revokes a refresh token, which ends its login', async () => {
        const resourceServer: string = await createResourceServerKey();
        const tokens: JwtAuthData<Roles> = await login(await createUser('revoked-login'));

        expect((await post('/revoke', [['token', tokens.refreshToken.value]])).status).toBe(200);

        expect(await introspect(tokens.refreshToken.value, resourceServer)).toEqual({ active: false });
        const refresh: Response = await fetch(`${baseUrl}/auth/refresh-login`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JsonUtilities.stringify({ refreshToken: tokens.refreshToken.value })
        });
        expect(refresh.status).toBe(401);
    });

    it('refuses to revoke an access token that works until it expires, which then still works', async () => {
        const key: CreatedApiKey = await createKey(await createUser('kept-token'));
        const token: string = await issueToken(key);

        const res: Response = await post('/revoke', [['token', token]]);
        expect(res.status).toBe(400);
        expect(await body(res)).toMatchObject({ error: 'unsupported_token_type' });

        // and revoking the client keeps the tokens it was issued, until they expire
        await authService().revokeApiKey(key.apiKey.userId, key.apiKey.id, undefined);
        expect((await callWith('/me', token)).status).toBe(200);
    });

    it('revokes an api key presented as a token, and changes nothing for a token that is none', async () => {
        const key: CreatedApiKey = await createKey(await createUser('revoked-key'));

        expect((await post('/revoke', [['token', key.key]])).status).toBe(200);
        expect((await fetch(`${baseUrl}/machine/me`, { headers: { 'x-api-key': key.key } })).status).toBe(401);

        expect((await post('/revoke', [['token', 'not-a-token']])).status).toBe(200);
    });

    it('lets a client that authenticates revoke only its own', async () => {
        const mine: CreatedApiKey = await createKey(await createUser('owner'));
        const theirs: CreatedApiKey = await createKey(await createUser('neighbor'));

        const res: Response = await post('/revoke', [['token', theirs.key]], basic(mine.apiKey.id, mine.key));

        expect(res.status).toBe(400);
        expect(await body(res)).toMatchObject({ error: 'unauthorized_client' });
        expect((await fetch(`${baseUrl}/machine/me`, { headers: { 'x-api-key': theirs.key } })).status).toBe(200);
    });
});

describe('AuthorizationServerController — access tokens revoked at once', () => {
    beforeAll(async () => {
        server = await startApp(
            [defineProvider({ token: ZIBRI_DI_TOKENS.ACCESS_TOKEN_REVOCATION, useFactory: (): AccessTokenRevocation => 'immediately' })],
            [ApiKey, JwtRevokedAccessToken]
        );
        baseUrl = await server.start();
    }, 30000);

    afterAll(async () => {
        await server?.shutdown();
    });

    it('revokes one token of a client, and keeps its others', async () => {
        const resourceServer: string = await createResourceServerKey();
        const key: CreatedApiKey = await createKey(await createUser('one-token'));
        const revoked: string = await issueToken(key);
        const kept: string = await issueToken(key);

        expect((await post('/revoke', [['token', revoked]])).status).toBe(200);

        expect((await callWith('/me', revoked)).status).toBe(401);
        expect(await introspect(revoked, resourceServer)).toEqual({ active: false });
        expect((await callWith('/me', kept)).status).toBe(200);
        // revoking it again changes nothing
        expect((await post('/revoke', [['token', revoked]])).status).toBe(200);
    });

    it('ends every token of a client once its key is revoked', async () => {
        const key: CreatedApiKey = await createKey(await createUser('revoked-client'));
        const token: string = await issueToken(key);

        await authService().revokeApiKey(key.apiKey.userId, key.apiKey.id, undefined);

        expect((await callWith('/me', token)).status).toBe(401);
    });

    it('ends the access token of a login once the login ends', async () => {
        const user: JwtUser = await createUser('ended-login');
        const tokens: JwtAuthData<Roles> = await login(user);
        expect((await callWith('/me', tokens.accessToken.value)).status).toBe(200);

        await authService().endLogins(user.id, undefined);

        expect((await callWith('/me', tokens.accessToken.value)).status).toBe(401);
    });

    it('revokes the access token of a login, which ends the login', async () => {
        const tokens: JwtAuthData<Roles> = await login(await createUser('revoked-access'));

        expect((await post('/revoke', [['token', tokens.accessToken.value]])).status).toBe(200);

        expect((await callWith('/me', tokens.accessToken.value)).status).toBe(401);
        const refresh: Response = await fetch(`${baseUrl}/auth/refresh-login`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JsonUtilities.stringify({ refreshToken: tokens.refreshToken.value })
        });
        expect(refresh.status).toBe(401);
    });

    it('lets a client that authenticates revoke only the tokens issued to it', async () => {
        const mine: CreatedApiKey = await createKey(await createUser('token-owner'));
        const theirs: string = await issueToken(await createKey(await createUser('token-neighbor')));

        const res: Response = await post('/revoke', [['token', theirs]], basic(mine.apiKey.id, mine.key));

        expect(res.status).toBe(400);
        expect(await body(res)).toMatchObject({ error: 'unauthorized_client' });
        expect((await callWith('/me', theirs)).status).toBe(200);
    });
});

describe('AuthorizationServerController — DPoP proofs that carry a nonce', () => {
    beforeAll(async () => {
        server = await startApp([defineProvider({ token: ZIBRI_DI_TOKENS.DPOP_NONCES, useFactory: () => true })]);
        baseUrl = await server.start();
    }, 30000);

    afterAll(async () => {
        await server?.shutdown();
    });

    it('answers a token request whose proof carries no nonce with one, and issues to the proof carrying it', async () => {
        const key: CreatedApiKey = await createKey(await createUser('nonce-client'));
        const dpopKey: FakeDpopKey = new FakeDpopKey();

        const asked: Response = await requestToken(key, [], { dpop: dpopKey.createProof('POST', `${issuer()}/oauth2/token`) });
        expect(asked.status).toBe(400);
        expect(await body(asked)).toMatchObject({ error: 'use_dpop_nonce' });
        const nonce: string = asked.headers.get('dpop-nonce') ?? '';

        const issued: Response = await requestToken(key, [], { dpop: dpopKey.createProof('POST', `${issuer()}/oauth2/token`, { nonce }) });
        expect(issued.status).toBe(200);
        expect((await callBound('/me', String((await body(issued))['access_token']), dpopKey, nonce)).status).toBe(200);
    });
});

describe('AuthorizationServerController — tokens signed with a key pair', () => {
    beforeAll(async () => {
        const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
        server = await startApp(
            [
                defineProvider({
                    token: ZIBRI_DI_TOKENS.JWT_AUTH_OPTIONS_INPUT,
                    useFactory: (): JwtAuthOptionsInput => ({
                        accessTokenKey: { algorithm: 'ES256', key: privateKey },
                        refreshTokenSecret: 'test-refresh-token-secret'
                    })
                })
            ],
            [ApiKey],
            ALL_STRATEGIES,
            [JwksController]
        );
        baseUrl = await server.start();
    }, 30000);

    afterAll(async () => {
        await server?.shutdown();
    });

    it('issues tokens a resource server verifies by the published keys, as RFC 9068 describes them', async () => {
        const metadata: OAuth2Answer = await body(await fetch(`${baseUrl}/.well-known/oauth-authorization-server`));
        expect(metadata['jwks_uri']).toBe(`${issuer()}/.well-known/jwks.json`);
        const user: JwtUser = await createUser('verified-elsewhere');
        const key: CreatedApiKey = await createKey(user);

        const token: string = await issueToken(key, [['resource', REPORTS]]);

        // what the reports service does: the keys from the authorization server, its own audience
        const verified: JWTVerifyResult = await jwtVerify(token, createRemoteJWKSet(new URL(`${baseUrl}/.well-known/jwks.json`)), {
            issuer: issuer(),
            audience: REPORTS,
            typ: 'at+jwt'
        });
        expect(verified.payload).toMatchObject({ sub: user.id, client_id: key.apiKey.id, scope: Roles.USER });
        expect(typeof verified.payload.jti).toBe('string');
    });
});

/**
 * Publishes the keys at a path of the application's own.
 */
@Controller('/keys', { allowOrphan: true, versions: 'all' })
class CompanyJwksController extends JwksController {}

describe('AuthorizationServerController — keys published at a path of the application\'s own', () => {
    beforeAll(async () => {
        const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
        server = await startApp(
            [
                defineProvider({
                    token: ZIBRI_DI_TOKENS.JWT_AUTH_OPTIONS_INPUT,
                    useFactory: (): JwtAuthOptionsInput => ({
                        accessTokenKey: { algorithm: 'ES256', key: privateKey },
                        refreshTokenSecret: 'test-refresh-token-secret'
                    })
                })
            ],
            [ApiKey],
            ALL_STRATEGIES,
            [CompanyJwksController]
        );
        baseUrl = await server.start();
    }, 30000);

    afterAll(async () => {
        await server?.shutdown();
    });

    it('publishes where the controller extending JwksController serves them', async () => {
        const metadata: OAuth2Answer = await body(await fetch(`${baseUrl}/.well-known/oauth-authorization-server`));
        expect(metadata['jwks_uri']).toBe(`${issuer()}/keys/jwks.json`);
        const token: string = await issueToken(await createKey(await createUser('keys-elsewhere')));

        await expect(jwtVerify(token, createRemoteJWKSet(new URL(`${baseUrl}/keys/jwks.json`)), { issuer: issuer() })).resolves.toBeDefined();
    });
});