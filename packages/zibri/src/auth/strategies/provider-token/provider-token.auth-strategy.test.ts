import { randomBytes, X509Certificate } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createFakeKeyPair, createInMemoryDataSource, FakeDpopKey, FakeKeyPair, FakeOAuthProvider, InMemoryDataSource, startFakeOAuthProvider } from 'zibri-testing';

import { ProviderTokenAuthStrategy } from './provider-token.auth-strategy';
import { JwtUser } from '../../../__testing__/mocks/entities/jwt-user.entity';
import { Roles } from '../../../__testing__/mocks/entities/roles.enum';
import { defaultTestServerEntities } from '../../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { Repository } from '../../../data-source/repository/repository';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { defineProvider } from '../../../di/models/di-provider.model';
import { Controller } from '../../../routing/decorators/controller.decorator';
import { Get } from '../../../routing/decorators/get.decorator';
import { Newable } from '../../../types/newable.type';
import { Ms } from '../../../utilities/ms';
import { OtpTwoFactorMethod } from '../../2fa/methods/otp/otp.two-factor-method';
import { AuthController } from '../../auth-controller/auth-controller.model';
import { FederatedConnectionCode } from '../../authenticators/federated/federated-connection-code.model';
import { FederatedHandoverCode } from '../../authenticators/federated/federated-handover-code.model';
import { FederatedIdentity, FederatedIdentityCreateData } from '../../authenticators/federated/federated-identity.model';
import { FederatedLoginAttempt } from '../../authenticators/federated/federated-login-attempt.model';
import { FederatedRegistrationTicket } from '../../authenticators/federated/federated-registration-ticket.model';
import { OAuthClientAuthentication } from '../../authenticators/oauth/oauth-client-authentication.model';
import { BaseOidcAuthenticator } from '../../authenticators/oidc/base-oidc.authenticator';
import { OidcBearerTokens } from '../../authenticators/oidc/oidc-bearer-tokens.model';
import { Auth } from '../../decorators/auth.decorator';
import { CurrentUser } from '../../decorators/current-user.decorator';
import { AuthStrategies } from '../auth-strategies.model';
import { ClientAccessTokenAuthStrategy } from '../client-access-token/client-access-token.auth-strategy';
import { BaseClientCertificateAuthStrategy } from '../client-certificate/base-client-certificate.auth-strategy';
import { ClientCertificateHeaderFormat } from '../client-certificate/client-certificate-header-format.type';
import { JwtAuthStrategy } from '../jwt/jwt.auth-strategy';
import { JwtUtilities } from '../jwt/jwt.utilities';

// where the application is reached from the outside, which a DPoP proof names
const PUBLIC_URL: string = 'http://zibri.test';
const CLIENT_ID: string = 'zibri-test-client';
const CLIENT_SECRET: string = 'zibri-test-secret';
// the audience the api is known by at the providers
const API_AUDIENCE: string = 'https://api.zibri.test';
// the client a mobile app signs in at the provider as
const MOBILE_CLIENT_ID: string = 'zibri-mobile-app';

let strictProvider: FakeOAuthProvider;
let lenientProvider: FakeOAuthProvider;
let signInOnlyProvider: FakeOAuthProvider;
let otherProvider: FakeOAuthProvider;

/**
 * The authority client certificates are issued by, made before any application starts.
 */
let authority: FakeKeyPair;

/**
 * Takes access tokens for the api only as RFC 9068 marks them.
 */
class StrictProviderAuthenticator extends BaseOidcAuthenticator<Roles, JwtUser> {
    readonly name: string = 'strict';

    readonly clientId: string = CLIENT_ID;

    readonly clientAuthentication: OAuthClientAuthentication = { method: 'client_secret_basic', clientSecret: CLIENT_SECRET };

    override readonly bearerTokens: OidcBearerTokens = { accessTokenAudiences: [API_AUDIENCE], accessTokenType: 'at+jwt', idTokenAudiences: [] };

    get issuer(): string {
        return strictProvider.issuer;
    }
}

/**
 * Takes access tokens for the api whatever they are marked, and the ID tokens of the mobile app.
 */
class LenientProviderAuthenticator extends BaseOidcAuthenticator<Roles, JwtUser> {
    readonly name: string = 'lenient';

    readonly clientId: string = CLIENT_ID;

    readonly clientAuthentication: OAuthClientAuthentication = { method: 'client_secret_basic', clientSecret: CLIENT_SECRET };

    override readonly bearerTokens: OidcBearerTokens = { accessTokenAudiences: [API_AUDIENCE], accessTokenType: 'any', idTokenAudiences: [MOBILE_CLIENT_ID] };

    get issuer(): string {
        return lenientProvider.issuer;
    }
}

/**
 * Signs users in, and takes none of its provider's tokens.
 */
class SignInOnlyProviderAuthenticator extends BaseOidcAuthenticator<Roles, JwtUser> {
    readonly name: string = 'sign-in-only';

    readonly clientId: string = CLIENT_ID;

    readonly clientAuthentication: OAuthClientAuthentication = { method: 'client_secret_basic', clientSecret: CLIENT_SECRET };

    get issuer(): string {
        return signInOnlyProvider.issuer;
    }
}

/**
 * Says it takes bearer tokens, and names nobody they may be for.
 */
class NoAudienceProviderAuthenticator extends BaseOidcAuthenticator<Roles, JwtUser> {
    readonly name: string = 'no-audience';

    readonly clientId: string = CLIENT_ID;

    readonly clientAuthentication: OAuthClientAuthentication = { method: 'client_secret_basic', clientSecret: CLIENT_SECRET };

    override readonly bearerTokens: OidcBearerTokens = { accessTokenAudiences: [], accessTokenType: 'at+jwt', idTokenAudiences: [] };

    get issuer(): string {
        return strictProvider.issuer;
    }
}

/**
 * Another client at the provider StrictProviderAuthenticator signs in at, taking its tokens as well.
 */
class SecondStrictProviderAuthenticator extends StrictProviderAuthenticator {
    override readonly name: string = 'strict-second';

    override readonly clientId: string = 'zibri-second-client';
}

/**
 * Takes the certificate from the proxy on this machine, which is where the test's requests come from.
 */
class LocalProxyClientCertificateAuthStrategy extends BaseClientCertificateAuthStrategy<Roles, JwtUser> {
    readonly header: string = 'Client-Cert';
    readonly headerFormat: ClientCertificateHeaderFormat = 'rfc9440';
    readonly trustedProxies: string[] = ['127.0.0.1', '::1'];
    readonly certificateAuthorities: string[] = [authority.certificate];

    async resolveUserByCertificate(): Promise<JwtUser | undefined> {
        // eslint-disable-next-line typescript/no-confusing-void-expression
        return await Promise.resolve(undefined);
    }
}

/**
 * What the route answering with the current user answers.
 */
type Me = {
    id: string
};

@Controller('/api', { allowOrphan: true })
class ApiController {
    @Auth.isLoggedIn()
    @Get('/me')
    me(
        @CurrentUser()
        user: JwtUser
    ): Me {
        return { id: user.id };
    }

    @Auth.isLoggedIn()
    @Auth.require2fa({ reauth: { allow: true, windowInMs: 10 * Ms.MINUTE } })
    @Get('/sensitive')
    sensitive(): { ok: boolean } {
        return { ok: true };
    }
}

const ALL_STRATEGIES: AuthStrategies = [JwtAuthStrategy, ClientAccessTokenAuthStrategy, ProviderTokenAuthStrategy, LocalProxyClientCertificateAuthStrategy];

/**
 * The auth routes of an application signing in through the given providers, which the providers send
 * the browser back to.
 * @param authenticators - The providers' authenticators.
 * @returns The controller.
 */
function defineAuthController(authenticators: Newable<BaseOidcAuthenticator<Roles, JwtUser>>[]): Newable<unknown> {
    // an orphan for every case that boots with other providers
    @Controller('/auth', { allowOrphan: true, versions: 'all' })
    class ProviderAuthController extends AuthController({ strategies: [JwtAuthStrategy], authenticators, twoFactorMethods: [OtpTwoFactorMethod] }) {}
    return ProviderAuthController;
}

/**
 * Starts an application that takes the tokens of the providers, keeping its data in memory.
 * @param authenticators - Its authenticators.
 * @param authStrategies - Its strategies.
 * @returns The server, and the url it listens at.
 */
async function startApp(
    authenticators: Newable<BaseOidcAuthenticator<Roles, JwtUser>>[],
    authStrategies: AuthStrategies = ALL_STRATEGIES
): Promise<[StartedTestServer, string]> {
    const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
        entities: [
            ...defaultTestServerEntities,
            FederatedLoginAttempt,
            FederatedIdentity,
            FederatedHandoverCode,
            FederatedRegistrationTicket,
            FederatedConnectionCode
        ],
        allowOrphan: true
    });
    const server: StartedTestServer = await startTestServer({
        baseUrl: PUBLIC_URL,
        dataSources: [dataSourceClass],
        authStrategies,
        authenticators,
        twoFactorMethods: [OtpTwoFactorMethod],
        controllers: [defineAuthController(authenticators), ApiController],
        providers: [
            ...defaultTestServerProviders,
            defineProvider({
                token: ZIBRI_DI_TOKENS.FEDERATION_OPTIONS,
                useValue: {
                    allowedRedirects: ['https://app.example.com'],
                    registrationUrl: 'https://app.example.com/register',
                    errorUrl: 'https://app.example.com/sign-in-failed',
                    maxAuthenticationAgeInMs: 3600000
                }
            })
        ]
    });
    try {
        return [server, await server.start()];
    }
    catch (error) {
        // a start the application refuses still leaves it initialized, which only the test can end
        await server.shutdown();
        throw error;
    }
}

/**
 * Starts an application a case expects to be refused, and ends it again when it starts anyway, so the
 * case fails rather than leaving it running.
 * @param authenticators - Its authenticators.
 */
async function startThenShutDown(authenticators: Newable<BaseOidcAuthenticator<Roles, JwtUser>>[]): Promise<void> {
    const [server] = await startApp(authenticators);
    await server.shutdown();
}

beforeAll(async () => {
    authority = await createFakeKeyPair('CN=Client test authority', { authority: true });
    strictProvider = await startFakeOAuthProvider({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
    lenientProvider = await startFakeOAuthProvider({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, algorithm: 'RS256' });
    signInOnlyProvider = await startFakeOAuthProvider({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
    otherProvider = await startFakeOAuthProvider({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
});

afterAll(async () => {
    await strictProvider?.stop();
    await lenientProvider?.stop();
    await signInOnlyProvider?.stop();
    await otherProvider?.stop();
});

// first, so no application is running yet when they start one
describe('ProviderTokenAuthStrategy — starting', () => {
    it('refuses to start when no authenticator of the application takes its provider\'s tokens', async () => {
        await expect(startThenShutDown([SignInOnlyProviderAuthenticator]))
            .rejects.toThrow(/ProviderTokenAuthStrategy[\S\s]*no authenticator of the application takes/);
    }, 30000);

    it('refuses to start an authenticator that takes bearer tokens for no audience', async () => {
        await expect(startThenShutDown([NoAudienceProviderAuthenticator]))
            .rejects.toThrow(/NoAudienceProviderAuthenticator takes bearer tokens for no audience/);
    }, 30000);

    it('refuses to start when two authenticators take the tokens of the same provider', async () => {
        await expect(startThenShutDown([StrictProviderAuthenticator, SecondStrictProviderAuthenticator]))
            .rejects.toThrow(/StrictProviderAuthenticator and SecondStrictProviderAuthenticator both take/);
    }, 30000);
});

describe('ProviderTokenAuthStrategy — reading a provider\'s tokens', () => {
    let server: StartedTestServer;
    let baseUrl: string;

    beforeAll(async () => {
        [server, baseUrl] = await startApp([StrictProviderAuthenticator, LenientProviderAuthenticator, SignInOnlyProviderAuthenticator]);
    }, 20000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    /**
     * Creates a user, and links an identity at a provider to them.
     * @param at - The provider.
     * @param signIn - Whether the identity signs in, rather than being linked for the provider's apis only.
     * @returns The user, whom the provider signs its tokens for from now.
     */
    async function createLinkedUser(at: FakeOAuthProvider, signIn: boolean = true): Promise<JwtUser> {
        const subject: string = `subject-${randomBytes(6).toString('hex')}`;
        const user: JwtUser = await inject(repositoryTokenFor(JwtUser)).create({ email: `${subject}@example.com`, roles: [Roles.USER] });
        await inject<Repository<FederatedIdentity, FederatedIdentityCreateData>>(repositoryTokenFor(FederatedIdentity))
            .create({ issuer: at.issuer, subject, userId: user.id, signIn, grantedScopes: [] });
        at.identity = { subject, email: user.email };
        return user;
    }

    /**
     * Calls a route of the api with a token.
     * @param path - The route below /api.
     * @param token - The token.
     * @param headers - The headers to send besides the token.
     * @returns The answer.
     */
    async function callWith(path: string, token: string, headers: Record<string, string> = {}): Promise<Response> {
        return await fetch(`${baseUrl}/api${path}`, { headers: { authorization: `Bearer ${token}`, ...headers } });
    }

    /**
     * Reads who the route answering with the current user says is calling.
     * @param res - Its answer.
     * @returns The id of the user.
     */
    async function readUserId(res: Response): Promise<string> {
        expect(res.status).toBe(200);
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const me: Me = await res.json();
        return me.id;
    }

    it('takes an access token the provider issued for the api, as the user its identity is linked to', async () => {
        const user: JwtUser = await createLinkedUser(strictProvider);

        // RFC 9068 has a client's id in every access token, which the application's own client tokens carry too
        const token: string = strictProvider.createJwtAccessToken({ audience: API_AUDIENCE });

        expect(await readUserId(await callWith('/me', token))).toBe(user.id);
    });

    it('takes an access token naming no client, which the application\'s own login tokens look like', async () => {
        const user: JwtUser = await createLinkedUser(strictProvider);

        const token: string = strictProvider.createJwtAccessToken({ audience: API_AUDIENCE, claims: { client_id: undefined } });

        expect(await readUserId(await callWith('/me', token))).toBe(user.id);
    });

    it('leaves the application\'s own tokens to its own strategies', async () => {
        const user: JwtUser = await inject(repositoryTokenFor(JwtUser)).create({ email: `own-${randomBytes(6).toString('hex')}@example.com`, roles: [Roles.USER] });
        const own: string = await inject(ZIBRI_DI_TOKENS.JWT_SERVICE).signAccessToken(
            { id: user.id, email: user.email, roles: user.roles, auth_time: Math.floor(Date.now() / Ms.SECOND), sid: 'login' },
            PUBLIC_URL
        );

        expect(await readUserId(await callWith('/me', own))).toBe(user.id);
    });

    it('refuses an access token the provider issued for another api', async () => {
        await createLinkedUser(strictProvider);

        const token: string = strictProvider.createJwtAccessToken({ audience: 'https://reports.example.com' });

        expect((await callWith('/me', token)).status).toBe(401);
    });

    it('refuses a token naming the provider that the provider did not sign', async () => {
        await createLinkedUser(strictProvider);
        otherProvider.identity = strictProvider.identity;

        const forged: string = otherProvider.createJwtAccessToken({ audience: API_AUDIENCE, claims: { iss: strictProvider.issuer } });

        expect((await callWith('/me', forged)).status).toBe(401);
    });

    it('refuses an expired access token', async () => {
        await createLinkedUser(strictProvider);
        const longAgo: number = Math.floor(Date.now() / Ms.SECOND) - 3600;

        const token: string = strictProvider.createJwtAccessToken({ audience: API_AUDIENCE, claims: { iat: longAgo - 300, exp: longAgo } });

        expect((await callWith('/me', token)).status).toBe(401);
    });

    it('refuses a token whose identity is linked to nobody, or linked for the provider\'s apis only', async () => {
        strictProvider.identity = { subject: `subject-${randomBytes(6).toString('hex')}` };
        expect((await callWith('/me', strictProvider.createJwtAccessToken({ audience: API_AUDIENCE }))).status).toBe(401);

        await createLinkedUser(strictProvider, false);
        expect((await callWith('/me', strictProvider.createJwtAccessToken({ audience: API_AUDIENCE }))).status).toBe(401);
    });

    it('takes an access token marked `JWT` only from a provider whose authenticator takes any', async () => {
        await createLinkedUser(strictProvider);
        expect((await callWith('/me', strictProvider.createJwtAccessToken({ audience: API_AUDIENCE, type: 'JWT' }))).status).toBe(401);

        const user: JwtUser = await createLinkedUser(lenientProvider);
        expect(await readUserId(await callWith('/me', lenientProvider.createJwtAccessToken({ audience: API_AUDIENCE, type: 'JWT' })))).toBe(user.id);
    });

    it('takes the ID token of the mobile app only from a provider whose authenticator takes the app\'s', async () => {
        const user: JwtUser = await createLinkedUser(lenientProvider);
        expect(await readUserId(await callWith('/me', lenientProvider.createIdToken(MOBILE_CLIENT_ID)))).toBe(user.id);
        // the ID token of the application's own client, which the mobile app never holds
        expect((await callWith('/me', lenientProvider.createIdToken(CLIENT_ID))).status).toBe(401);

        await createLinkedUser(strictProvider);
        expect((await callWith('/me', strictProvider.createIdToken(MOBILE_CLIENT_ID))).status).toBe(401);
    });

    it('refuses a token marked as an access token for the mobile app, which is no ID token of it', async () => {
        await createLinkedUser(lenientProvider);

        const token: string = lenientProvider.createJwtAccessToken({ audience: MOBILE_CLIENT_ID });

        expect((await callWith('/me', token)).status).toBe(401);
    });

    it('refuses the tokens of a provider whose authenticator takes none of them', async () => {
        await createLinkedUser(signInOnlyProvider);

        const token: string = signInOnlyProvider.createJwtAccessToken({ audience: API_AUDIENCE });

        expect((await callWith('/me', token)).status).toBe(401);
    });

    it('takes a token bound to a DPoP key only with a proof of the key', async () => {
        const user: JwtUser = await createLinkedUser(strictProvider);
        const dpopKey: FakeDpopKey = new FakeDpopKey();
        const token: string = strictProvider.createJwtAccessToken({ audience: API_AUDIENCE, claims: { cnf: { jkt: dpopKey.thumbprint } } });

        expect((await callWith('/me', token)).status).toBe(401);
        const bound: Response = await fetch(`${baseUrl}/api/me`, {
            headers: { authorization: `DPoP ${token}`, dpop: dpopKey.createProof('GET', `${PUBLIC_URL}/api/me`, { accessToken: token }) }
        });
        expect(await readUserId(bound)).toBe(user.id);
    });

    it('takes a token bound to a client certificate only beside that certificate', async () => {
        const user: JwtUser = await createLinkedUser(strictProvider);
        const certificate: string = (await createFakeKeyPair(`CN=${user.email}`, { issuer: authority })).certificate;
        const thumbprint: string = JwtUtilities.resolveCertificateThumbprint(new X509Certificate(certificate));
        const token: string = strictProvider.createJwtAccessToken({ audience: API_AUDIENCE, claims: { cnf: { 'x5t#S256': thumbprint } } });
        const certificateHeader: (pem: string) => Record<string, string> = pem => ({ 'client-cert': `:${new X509Certificate(pem).raw.toString('base64')}:` });

        expect((await callWith('/me', token)).status).toBe(401);
        expect((await callWith('/me', token, certificateHeader((await createFakeKeyPair(`CN=${user.email}`, { issuer: authority })).certificate))).status).toBe(401);
        expect(await readUserId(await callWith('/me', token, certificateHeader(certificate)))).toBe(user.id);
    });

    it('refuses a token bound in a way the application does not check', async () => {
        await createLinkedUser(strictProvider);

        const token: string = strictProvider.createJwtAccessToken({ audience: API_AUDIENCE, claims: { cnf: { jwk: { kty: 'EC' } } } });

        expect((await callWith('/me', token)).status).toBe(401);
    });

    it('takes when the user signed in at the provider as the time of the login', async () => {
        await createLinkedUser(strictProvider);
        const now: number = Math.floor(Date.now() / Ms.SECOND);

        const recent: string = strictProvider.createJwtAccessToken({ audience: API_AUDIENCE, claims: { auth_time: now - 60 } });
        const longAgo: string = strictProvider.createJwtAccessToken({ audience: API_AUDIENCE, claims: { auth_time: now - 3600 } });
        const unsaid: string = strictProvider.createJwtAccessToken({ audience: API_AUDIENCE, claims: { auth_time: undefined } });

        expect((await callWith('/sensitive', recent)).status).toBe(200);
        // the second factor the route asks for in place of a recent login
        expect((await callWith('/sensitive', longAgo)).status).toBe(401);
        expect((await callWith('/sensitive', unsaid)).status).toBe(401);
    });
});