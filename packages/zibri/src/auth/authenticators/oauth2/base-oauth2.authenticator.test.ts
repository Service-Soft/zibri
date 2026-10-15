import { createHash, randomBytes } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource, FakeOAuthProvider, InMemoryDataSource, startFakeOAuthProvider, TestBrowser } from 'zibri-testing';

import { BaseOAuth2Authenticator } from './base-oauth2.authenticator';
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
import { KnownHeader } from '../../../http/known-header.enum';
import { RedirectResponse } from '../../../http/redirect-response.model';
import { Response as RouteResponse } from '../../../open-api/decorators/response.decorator';
import { Body } from '../../../routing/decorators/body.decorator';
import { Controller } from '../../../routing/decorators/controller.decorator';
import { Get } from '../../../routing/decorators/get.decorator';
import { Param } from '../../../routing/decorators/param.decorator';
import { Post } from '../../../routing/decorators/post.decorator';
import { Newable } from '../../../types/newable.type';
import { JsonUtilities } from '../../../utilities/json.utilities';
import { OtpTwoFactorMethod } from '../../2fa/methods/otp/otp.two-factor-method';
import { AuthController } from '../../auth-controller/auth-controller.model';
import { Auth } from '../../decorators/auth.decorator';
import { CookieAuthRefreshSession } from '../../strategies/cookie/cookie-auth-refresh-session.model';
import { CookieAuthSession } from '../../strategies/cookie/cookie-auth-session.model';
import { CookieAuthStrategy } from '../../strategies/cookie/cookie-auth.auth-strategy';
import { JwtAuthData } from '../../strategies/jwt/jwt-auth-data.model';
import { JwtAuthStrategy } from '../../strategies/jwt/jwt.auth-strategy';
import { FederatedConnectionCode } from '../federated/federated-connection-code.model';
import { FederatedHandoverCredentials, FederatedTicketCredentials } from '../federated/federated-credentials.model';
import { FederatedHandoverCode } from '../federated/federated-handover-code.model';
import { FederatedIdentity, FederatedIdentityCreateData } from '../federated/federated-identity.model';
import { FederatedLoginAttempt } from '../federated/federated-login-attempt.model';
import { FederatedProviderIdentity } from '../federated/federated-provider-identity.model';
import { FederatedRegistrationTicket } from '../federated/federated-registration-ticket.model';
import { FederatedRegistration } from '../federated/federated-registration.model';
import type { FederatedRouteEndpoint } from '../federated/federated-route-endpoint.model';
import type { FederatedRoute } from '../federated/federated-route.type';
import { FederatedRouteUtilities } from '../federated/federated-route.utilities';
import { FederatedSignInResult } from '../federated/federated-sign-in-result.model';
import { OAuthClientAuthentication } from '../oauth/oauth-client-authentication.model';
import { OAuthProviderTokens } from '../oauth/oauth-provider-tokens.model';
import type { OAuthResponseMode } from '../oauth/oauth-response-mode.type';
import { ProviderAccessFailure } from '../provider-access-failure.enum';

const PUBLIC_URL: string = 'http://zibri.test';
const CLIENT_ID: string = 'zibri-oauth2-client';
const CLIENT_SECRET: string = 'zibri-oauth2-secret';
const REDIRECT_TO: string = 'https://app.example.com/signed-in';
const REGISTRATION_URL: string = 'https://app.example.com/register';
const ERROR_URL: string = 'https://app.example.com/sign-in-failed';

let provider: FakeOAuthProvider;

class PlainOAuth2Authenticator extends BaseOAuth2Authenticator<Roles, JwtUser> {
    readonly name: string = 'plain';

    readonly clientId: string = CLIENT_ID;

    readonly clientAuthentication: OAuthClientAuthentication = { method: 'client_secret_basic', clientSecret: CLIENT_SECRET };

    readonly scopes: string[] = ['user'];

    override readonly apiScopes: string[] = ['repo'];

    // the provider, which is running by the time the application builds this
    override readonly revocationEndpoint: string | undefined = `${provider.issuer}/revoke`;

    // where the user is read from, which a case points at a path the provider does not answer
    userPath: string = '/user';

    get issuer(): string {
        return provider.issuer;
    }

    get authorizationEndpoint(): string {
        return `${provider.issuer}/authorize`;
    }

    get tokenEndpoint(): string {
        return `${provider.issuer}/token`;
    }

    protected async resolveIdentity(accessToken: string): Promise<Pick<FederatedProviderIdentity, 'subject' | 'profile'>> {
        const user: unknown = await this.fetchJson(`${provider.issuer}${this.userPath}`, accessToken);
        if (typeof user !== 'object' || user == undefined || !('id' in user) || typeof user.id !== 'string') {
            throw new Error('The provider answered without the id of the user.');
        }
        return {
            subject: user.id,
            profile: {
                email: 'email' in user && typeof user.email === 'string' ? user.email : undefined,
                emailVerified: 'verified' in user && typeof user.verified === 'boolean' ? user.verified : undefined,
                name: 'name' in user && typeof user.name === 'string' ? user.name : undefined,
                givenName: undefined,
                familyName: undefined
            }
        };
    }
}

@Auth.skip({ allowRedundant: true })
@Controller('/register', { allowOrphan: true })
class ProfileController {
    // what a registration reads before it creates the user
    @Post('/profile')
    async profile(
        @Body(FederatedTicketCredentials)
        credentials: FederatedTicketCredentials
    ): Promise<FederatedRegistration> {
        return await inject(ZIBRI_DI_TOKENS.AUTH_SERVICE).resolveRegistration(PlainOAuth2Authenticator, credentials, undefined);
    }
}

/**
 * Signs in through the plain provider at routes the application writes itself, rather than the ones of
 * a federated controller.
 */
class HandWrittenRoutesAuthenticator extends PlainOAuth2Authenticator {
    override get routes(): FederatedRouteEndpoint[] {
        return super.routes.filter(endpoint => endpoint.route === 'callback');
    }

    override resolveRouteUrl(route: FederatedRoute): string {
        return `${PUBLIC_URL}/login/plain-${route}`;
    }
}

/**
 * Has the provider post its answer to the hand-written callback, which the application only answers
 * when the browser is sent there.
 */
class FormPostingAuthenticator extends HandWrittenRoutesAuthenticator {
    override readonly responseMode: OAuthResponseMode = 'form_post';
}

/**
 * Gives out urls no route of the application answers.
 */
class MisroutedAuthenticator extends PlainOAuth2Authenticator {
    override resolveRouteUrl(route: FederatedRoute): string {
        return `${PUBLIC_URL}/login/nowhere/${route}`;
    }
}

/**
 * Gives out urls of another application.
 */
class ElsewhereAuthenticator extends PlainOAuth2Authenticator {
    override resolveRouteUrl(route: FederatedRoute): string {
        return `https://elsewhere.example.com/login/plain-${route}`;
    }
}

@Auth.skip({ allowRedundant: true })
@Controller('/login', { allowOrphan: true })
class HandWrittenSignInController {
    @RouteResponse.redirect()
    @Get('/plain')
    async start(
        @Param.query('redirectTo')
        redirectTo: string,
        @Param.query('codeChallenge')
        codeChallenge: string
    ): Promise<RedirectResponse> {
        const url: string = await inject(HandWrittenRoutesAuthenticator)
            .startSignIn({ redirectTo, codeChallenge, strategy: undefined, reauthenticate: false, apiScopes: [] });
        return RedirectResponse.to(url);
    }

    @RouteResponse.redirect()
    @Get('/plain-callback')
    async callback(): Promise<RedirectResponse> {
        const result: FederatedSignInResult = await inject(HandWrittenRoutesAuthenticator).completeSignIn(FederatedRouteUtilities.resolveCallbackQuery());
        if (result.type !== 'handover') {
            throw new Error(`The sign-in ended in a ${result.type} rather than a handover.`);
        }
        return FederatedRouteUtilities.toRedirect(result.redirectTo, result.code);
    }

    @RouteResponse.object(JwtAuthData)
    @Post('/plain-token')
    async token(
        @Body(FederatedHandoverCredentials)
        credentials: FederatedHandoverCredentials
    ): Promise<JwtAuthData<string>> {
        return await inject(ZIBRI_DI_TOKENS.AUTH_SERVICE).login(HandWrittenRoutesAuthenticator, JwtAuthStrategy, credentials, undefined);
    }
}

// the auth routes of the plain provider, logging in with cookies or with jwts. Orphans for the cases
// that boot with the other
@Controller('/auth', { allowOrphan: true, versions: 'all' })
class CookiePlainAuthController extends AuthController({
        strategies: [CookieAuthStrategy],
        authenticators: [PlainOAuth2Authenticator],
        twoFactorMethods: [OtpTwoFactorMethod]
    }) {}

@Controller('/auth', { allowOrphan: true, versions: 'all' })
class JwtPlainAuthController extends AuthController({
        strategies: [JwtAuthStrategy],
        authenticators: [PlainOAuth2Authenticator],
        twoFactorMethods: [OtpTwoFactorMethod]
    }) {}

/**
 * Starts an application signing in through the plain OAuth2 provider.
 * @param controllers - The controllers, which decide which strategy the sign-in logs in with.
 * @param strategy - That strategy.
 * @param authenticator - The authenticator of the provider, which decides where its routes are.
 * @returns The server and the url it listens at.
 */
async function startApp(
    controllers: Newable<unknown>[],
    strategy: typeof CookieAuthStrategy | typeof JwtAuthStrategy,
    authenticator: typeof PlainOAuth2Authenticator = PlainOAuth2Authenticator
): Promise<[StartedTestServer, string]> {
    const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
        entities: [
            ...defaultTestServerEntities,
            CookieAuthSession,
            CookieAuthRefreshSession,
            FederatedLoginAttempt,
            FederatedIdentity,
            FederatedHandoverCode,
            FederatedRegistrationTicket,
            FederatedConnectionCode,
            OAuthProviderTokens
        ],
        allowOrphan: true
    });
    const server: StartedTestServer = await startTestServer({
        baseUrl: PUBLIC_URL,
        dataSources: [dataSourceClass],
        authStrategies: [strategy],
        authenticators: [authenticator],
        controllers,
        providers: [
            ...defaultTestServerProviders,
            defineProvider({ token: ZIBRI_DI_TOKENS.COOKIE_SIGN_SECRET, useFactory: () => 'test-cookie-secret' }),
            defineProvider({
                token: ZIBRI_DI_TOKENS.FEDERATION_OPTIONS,
                useValue: {
                    allowedRedirects: ['https://app.example.com'],
                    registrationUrl: REGISTRATION_URL,
                    errorUrl: ERROR_URL,
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
 * @param controllers - The controllers.
 * @param strategy - The strategy the sign-in logs in with.
 * @param authenticator - The authenticator of the provider.
 */
async function startThenShutDown(
    controllers: Newable<unknown>[],
    strategy: typeof CookieAuthStrategy | typeof JwtAuthStrategy,
    authenticator: typeof PlainOAuth2Authenticator = PlainOAuth2Authenticator
): Promise<void> {
    const [server] = await startApp(controllers, strategy, authenticator);
    await server.shutdown();
}

/**
 * Creates a user, linked to the identity the provider signs in next when a subject is given.
 * @param subject - Who the user is at the provider, if they are linked.
 * @returns The user.
 */
async function createUser(subject: string | undefined): Promise<JwtUser> {
    const user: JwtUser = await inject(repositoryTokenFor(JwtUser)).create({ email: `${randomBytes(6).toString('hex')}@example.com`, roles: [Roles.USER] });
    if (subject != undefined) {
        await inject<Repository<FederatedIdentity, FederatedIdentityCreateData>>(repositoryTokenFor(FederatedIdentity))
            .create({ issuer: provider.issuer, subject, userId: user.id, signIn: true, grantedScopes: [] });
    }
    return user;
}

/**
 * Signs in at the provider, the way a browser does.
 * @param browser - The browser.
 * @param authorizeUrl - The application's authorize route, with its query.
 * @returns Where the callback sends the browser.
 */
async function signIn(browser: TestBrowser, authorizeUrl: string): Promise<string> {
    return await browser.follow(await browser.follow(await browser.follow(authorizeUrl)));
}

beforeAll(async () => {
    provider = await startFakeOAuthProvider({
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        issuesIdToken: false,
        // shorter than the margin a token is refreshed within, so a kept one is always due for a new one
        accessTokenExpiresInSeconds: 30,
        resources: {
            '/user': identity => ({ id: identity.subject, email: identity.email, verified: identity.emailVerified, name: identity.name })
        }
    });
});

afterAll(async () => {
    await provider?.stop();
});

describe('BaseOAuth2Authenticator — signing in to cookies', () => {
    let server: StartedTestServer;
    let baseUrl: string;

    beforeAll(async () => {
        [server, baseUrl] = await startApp([CookiePlainAuthController, ProfileController], CookieAuthStrategy);
    }, 20000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    const authorizeUrl: (query?: Record<string, string>) => string = query => `${PUBLIC_URL}/auth/federated/authorize?${new URLSearchParams({ redirectTo: REDIRECT_TO, ...query }).toString()}`;

    it('signs a linked user in with the identity its api names, and never counts it as a recent login', async () => {
        const subject: string = `plain-${randomBytes(6).toString('hex')}`;
        const user: JwtUser = await createUser(subject);
        provider.identity = { subject };
        const browser: TestBrowser = new TestBrowser(baseUrl, PUBLIC_URL);

        expect(await signIn(browser, authorizeUrl())).toBe(REDIRECT_TO);

        const sessions: CookieAuthRefreshSession[] = await inject(repositoryTokenFor(CookieAuthRefreshSession))
            .findAll({ where: { userId: user.id } });
        // the provider does not say when the user signed in there, so a route that would take a recent
        // login in place of a second factor does not take this one
        expect(sessions.map(session => new Date(session.authenticatedAt).getTime())).toStrictEqual([0]);
    });

    it('asks the provider without a nonce or max_age, which only an ID token answers', async () => {
        const asked: URLSearchParams = new URL(await new TestBrowser(baseUrl, PUBLIC_URL).follow(authorizeUrl({ reauthenticate: 'true' }))).searchParams;

        expect(asked.get('scope')).toBe('user');
        expect(asked.get('code_challenge_method')).toBe('S256');
        expect(asked.has('nonce')).toBe(false);
        expect(asked.has('max_age')).toBe(false);
        expect(asked.get('prompt')).toBe('login');
    });

    it('sends an identity no user is linked to to the registration, with what the api reports', async () => {
        const subject: string = `plain-${randomBytes(6).toString('hex')}`;
        provider.identity = { subject, email: `${subject}@example.com`, emailVerified: true, name: 'Ada Lovelace' };
        const browser: TestBrowser = new TestBrowser(baseUrl, PUBLIC_URL);

        const landing: string = await signIn(browser, authorizeUrl());
        expect(landing.startsWith(`${REGISTRATION_URL}?ticket=`)).toBe(true);
        const res: Response = await browser.open(`${baseUrl}/register/profile`, {
            method: 'POST',
            headers: { [KnownHeader.CONTENT_TYPE]: 'application/json' },
            body: JsonUtilities.stringify({ ticket: new URL(landing).searchParams.get('ticket') })
        });

        // eslint-disable-next-line typescript/no-unsafe-assignment
        const registration: FederatedRegistration = await res.json();
        expect(registration).toMatchObject({
            provider: 'plain',
            issuer: provider.issuer,
            subject,
            email: `${subject}@example.com`,
            emailVerified: true,
            name: 'Ada Lovelace'
        });
    });

    it('keeps the access token a sign-in asked for, and has none once it expires without a refresh token', async () => {
        const subject: string = `plain-${randomBytes(6).toString('hex')}`;
        const user: JwtUser = await createUser(subject);
        provider.identity = { subject };

        expect(await signIn(new TestBrowser(baseUrl, PUBLIC_URL), authorizeUrl({ scopes: 'repo' }))).toBe(REDIRECT_TO);
        const [linked] = await inject(ZIBRI_DI_TOKENS.AUTH_SERVICE).findIdentities(user.id, undefined, [PlainOAuth2Authenticator]);

        expect(linked?.identity.grantedScopes).toStrictEqual(['user', 'repo']);
        // plain OAuth2 has no standard way to ask for a refresh token, so this provider issued none
        await expect(inject(ZIBRI_DI_TOKENS.AUTH_SERVICE).resolveProviderAccessToken(user.id, linked?.identity.id ?? '', ['repo']))
            .rejects.toMatchObject({ failure: ProviderAccessFailure.EXPIRED });
    });

    it('hands the access token back at the revocation endpoint the authenticator names', async () => {
        const subject: string = `plain-${randomBytes(6).toString('hex')}`;
        const user: JwtUser = await createUser(subject);
        provider.identity = { subject };
        await signIn(new TestBrowser(baseUrl, PUBLIC_URL), authorizeUrl({ scopes: 'repo' }));
        const [linked] = await inject(ZIBRI_DI_TOKENS.AUTH_SERVICE).findIdentities(user.id, undefined, [PlainOAuth2Authenticator]);
        const revokedBefore: number = provider.revokedTokens.length;

        await inject(ZIBRI_DI_TOKENS.AUTH_SERVICE).revokeProviderAccess(user.id, linked?.identity.id ?? '', undefined);

        expect(provider.revokedTokens).toHaveLength(revokedBefore + 1);
    });

    it('goes to the error url when the provider\'s api does not answer who signed in', async () => {
        const authenticator: PlainOAuth2Authenticator = inject(PlainOAuth2Authenticator);
        authenticator.userPath = '/not-there';
        try {
            expect(await signIn(new TestBrowser(baseUrl, PUBLIC_URL), authorizeUrl())).toBe(`${ERROR_URL}?error=provider_error`);
        }
        finally {
            authenticator.userPath = '/user';
        }
    });
});

describe('BaseOAuth2Authenticator — signing in to jwt', () => {
    let server: StartedTestServer;
    let baseUrl: string;

    beforeAll(async () => {
        [server, baseUrl] = await startApp([JwtPlainAuthController], JwtAuthStrategy);
    }, 20000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    it('hands the login over with a code, whose tokens carry a login time that is never recent', async () => {
        const subject: string = `plain-${randomBytes(6).toString('hex')}`;
        const user: JwtUser = await createUser(subject);
        provider.identity = { subject };
        const verifier: string = randomBytes(32).toString('base64url');
        const codeChallenge: string = createHash('sha256').update(verifier)
            .digest('base64url');

        const landing: string = await signIn(
            new TestBrowser(baseUrl, PUBLIC_URL),
            `${PUBLIC_URL}/auth/federated/authorize?${new URLSearchParams({ redirectTo: REDIRECT_TO, codeChallenge }).toString()}`
        );
        const res: Response = await fetch(`${baseUrl}/auth/login`, {
            method: 'POST',
            headers: { [KnownHeader.CONTENT_TYPE]: 'application/json' },
            body: JsonUtilities.stringify({ code: new URL(landing).searchParams.get('code'), codeVerifier: verifier })
        });

        expect(res.status).toBe(200);
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const body: { userId: string, accessToken: { value: string } } = await res.json();
        expect(body.userId).toBe(user.id);
        const payload: unknown = JsonUtilities.parse<unknown>(Buffer.from(body.accessToken.value.split('.')[1] ?? '', 'base64url').toString('utf8'));
        expect(payload).toMatchObject({ auth_time: 0 });
    });
});

/**
 * Serves the auth routes at a path of the application's own.
 */
@Controller('/sign-in', { allowOrphan: true, versions: 'all' })
class CompanyAuthController extends AuthController({
        strategies: [JwtAuthStrategy],
        authenticators: [PlainOAuth2Authenticator],
        twoFactorMethods: [OtpTwoFactorMethod]
    }) {}

describe('BaseOAuth2Authenticator — routes at a path of the application\'s own', () => {
    let server: StartedTestServer;
    let baseUrl: string;

    beforeAll(async () => {
        [server, baseUrl] = await startApp([CompanyAuthController], JwtAuthStrategy);
    }, 20000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    it('sends the provider back to the routes of the auth controller, at its path', async () => {
        const subject: string = `plain-${randomBytes(6).toString('hex')}`;
        const user: JwtUser = await createUser(subject);
        provider.identity = { subject };
        const verifier: string = randomBytes(32).toString('base64url');
        const codeChallenge: string = createHash('sha256').update(verifier)
            .digest('base64url');

        expect(inject(PlainOAuth2Authenticator).getCallbackUrl()).toBe(`${PUBLIC_URL}/sign-in/federated/plain/callback`);
        const landing: string = await signIn(
            new TestBrowser(baseUrl, PUBLIC_URL),
            `${PUBLIC_URL}/sign-in/federated/authorize?${new URLSearchParams({ redirectTo: REDIRECT_TO, codeChallenge }).toString()}`
        );
        const res: Response = await fetch(`${baseUrl}/sign-in/login`, {
            method: 'POST',
            headers: { [KnownHeader.CONTENT_TYPE]: 'application/json' },
            body: JsonUtilities.stringify({ code: new URL(landing).searchParams.get('code'), codeVerifier: verifier })
        });

        expect(res.status).toBe(200);
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const body: { userId: string } = await res.json();
        expect(body.userId).toBe(user.id);
    });
});

describe('BaseOAuth2Authenticator — routes the application writes itself', () => {
    let server: StartedTestServer;
    let baseUrl: string;

    beforeAll(async () => {
        [server, baseUrl] = await startApp([HandWrittenSignInController], JwtAuthStrategy, HandWrittenRoutesAuthenticator);
    }, 20000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    it('sends the provider back to the url the authenticator resolves', async () => {
        const subject: string = `plain-${randomBytes(6).toString('hex')}`;
        const user: JwtUser = await createUser(subject);
        provider.identity = { subject };
        const verifier: string = randomBytes(32).toString('base64url');
        const codeChallenge: string = createHash('sha256').update(verifier)
            .digest('base64url');

        expect(inject(HandWrittenRoutesAuthenticator).getCallbackUrl()).toBe(`${PUBLIC_URL}/login/plain-callback`);
        const landing: string = await signIn(
            new TestBrowser(baseUrl, PUBLIC_URL),
            `${PUBLIC_URL}/login/plain?${new URLSearchParams({ redirectTo: REDIRECT_TO, codeChallenge }).toString()}`
        );
        const res: Response = await fetch(`${baseUrl}/login/plain-token`, {
            method: 'POST',
            headers: { [KnownHeader.CONTENT_TYPE]: 'application/json' },
            body: JsonUtilities.stringify({ code: new URL(landing).searchParams.get('code'), codeVerifier: verifier })
        });

        expect(res.status).toBe(200);
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const body: { userId: string } = await res.json();
        expect(body.userId).toBe(user.id);
    });
});

describe('BaseOAuth2Authenticator — starting', () => {
    it('refuses to start without a controller the provider sends the browser back to, naming the routes it needs', async () => {
        await expect(startThenShutDown([ProfileController], JwtAuthStrategy))
            .rejects.toThrow(/PlainOAuth2Authenticator[\S\s]*callback, connect[\S\s]*AuthController[\S\s]*resolveRouteUrl/);
    }, 20000);

    it('refuses to start when a url the authenticator gives out reaches no route of the application', async () => {
        await expect(startThenShutDown([HandWrittenSignInController], JwtAuthStrategy, MisroutedAuthenticator))
            .rejects.toThrow(/MisroutedAuthenticator[\S\s]*http:\/\/zibri\.test\/login\/nowhere\/callback/);
    }, 20000);

    it('refuses to start when a route answers a url the authenticator gives out, but not the method the browser requests it with', async () => {
        await expect(startThenShutDown([HandWrittenSignInController], JwtAuthStrategy, FormPostingAuthenticator))
            .rejects.toThrow(/FormPostingAuthenticator[\S\s]*http:\/\/zibri\.test\/login\/plain-callback[\S\s]*POST[\S\s]*GET/);
    }, 20000);

    it('refuses to start when a url the authenticator gives out is not one of the application', async () => {
        await expect(startThenShutDown([HandWrittenSignInController], JwtAuthStrategy, ElsewhereAuthenticator))
            .rejects.toThrow(/ElsewhereAuthenticator[\S\s]*https:\/\/elsewhere\.example\.com\/login\/plain-callback[\S\s]*baseUrl/);
    }, 20000);
});