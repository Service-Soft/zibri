import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInMemoryDataSource, FakeOAuthProvider, InMemoryDataSource, startFakeOAuthProvider, TestBrowser } from 'zibri-testing';

import { BaseOidcAuthenticator } from './base-oidc.authenticator.ts';
import { JwtUser } from '../../../__testing__/mocks/entities/jwt-user.entity.ts';
import { Roles } from '../../../__testing__/mocks/entities/roles.enum.ts';
import { defaultTestServerEntities } from '../../../__testing__/test-server/create-test-data-source.function.ts';
import { defaultTestServerProviders } from '../../../__testing__/test-server/providers.ts';
import { startAndStopTestServerWithout } from '../../../__testing__/test-server/start-and-stop-test-server-without.function.ts';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function.ts';
import { Repository } from '../../../data-source/repository/repository.ts';
import { Transaction } from '../../../data-source/transaction/transaction.model.ts';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../../di/inject.function.ts';
import { defineProvider } from '../../../di/models/di-provider.model.ts';
import { Property } from '../../../entity/decorators/property.decorator.ts';
import { BadRequestError } from '../../../error-handling/errors/bad-request.error.ts';
import { NotFoundError } from '../../../error-handling/errors/not-found.error.ts';
import { KnownHeader } from '../../../http/known-header.enum.ts';
import { MimeType } from '../../../http/mime-type.enum.ts';
import { AuditAction, AuditOutcome } from '../../../logging/audit-event.model.ts';
import { Log } from '../../../logging/log.model.ts';
import { type LoggerInterface } from '../../../logging/logger.interface.ts';
import { Body } from '../../../routing/decorators/body.decorator.ts';
import { Controller } from '../../../routing/decorators/controller.decorator.ts';
import { Param } from '../../../routing/decorators/param.decorator.ts';
import { Post } from '../../../routing/decorators/post.decorator.ts';
import { Newable } from '../../../types/newable.type.ts';
import { JsonUtilities } from '../../../utilities/json.utilities.ts';
import { OtpTwoFactorMethod } from '../../2fa/methods/otp/otp.two-factor-method.ts';
import { AuthController } from '../../auth-controller/auth-controller.model.ts';
import { type AuthServiceInterface } from '../../auth-service.interface.ts';
import { Auth } from '../../decorators/auth.decorator.ts';
import { CookieAuthData } from '../../strategies/cookie/cookie-auth-data.model.ts';
import { CookieAuthRefreshSession } from '../../strategies/cookie/cookie-auth-refresh-session.model.ts';
import { CookieAuthSession } from '../../strategies/cookie/cookie-auth-session.model.ts';
import { CookieAuthStrategy } from '../../strategies/cookie/cookie-auth.auth-strategy.ts';
import { JwtAuthData } from '../../strategies/jwt/jwt-auth-data.model.ts';
import { JwtAuthStrategy } from '../../strategies/jwt/jwt.auth-strategy.ts';
import { FederatedConnectionCode } from '../federated/federated-connection-code.model.ts';
import { FederatedConnectionStart } from '../federated/federated-connection-start.model.ts';
import { FederatedTicketCredentials } from '../federated/federated-credentials.model.ts';
import { FederatedHandoverCode } from '../federated/federated-handover-code.model.ts';
import { FederatedIdentity, FederatedIdentityCreateData } from '../federated/federated-identity.model.ts';
import { FederatedLoginAttempt } from '../federated/federated-login-attempt.model.ts';
import { FederatedRegistrationTicket } from '../federated/federated-registration-ticket.model.ts';
import { FederatedRegistration } from '../federated/federated-registration.model.ts';
import { FederatedRouteUtilities } from '../federated/federated-route.utilities.ts';
import { FederationOptions } from '../federated/federation-options.model.ts';
import { LinkedIdentity } from '../linked-identity.model.ts';
import { OAuthClientAuthentication } from '../oauth/oauth-client-authentication.model.ts';
import { OAuthProviderTokens } from '../oauth/oauth-provider-tokens.model.ts';
import { OAuthResponseMode } from '../oauth/oauth-response-mode.type.ts';
import { ProviderAccessFailure } from '../provider-access-failure.enum.ts';
import { ProviderAccessError } from '../provider-access.error.ts';

// where the application is reached from the outside, as its baseUrl, which a browser here resolves to
// wherever the server ended up listening - the shape of a deployment behind a reverse proxy
const PUBLIC_URL: string = 'http://zibri.test';
const CLIENT_ID: string = 'zibri-test-client';
const CLIENT_SECRET: string = 'zibri-test-secret';
const REDIRECT_TO: string = 'https://app.example.com/signed-in';
const REGISTRATION_URL: string = 'https://app.example.com/register';
const ERROR_URL: string = 'https://app.example.com/sign-in-failed';
const CONNECTED_URL: string = 'https://app.example.com/account';
const READ_SCOPE: string = 'calendar.read';
const WRITE_SCOPE: string = 'calendar.write';

let provider: FakeOAuthProvider;
let formPostProvider: FakeOAuthProvider;
let apiProvider: FakeOAuthProvider;

class FakeProviderAuthenticator extends BaseOidcAuthenticator<Roles, JwtUser> {
    readonly name: string = 'fake';

    readonly clientId: string = CLIENT_ID;

    readonly clientAuthentication: OAuthClientAuthentication = { method: 'client_secret_basic', clientSecret: CLIENT_SECRET };

    get issuer(): string {
        return provider.issuer;
    }
}

class FormPostProviderAuthenticator extends BaseOidcAuthenticator<Roles, JwtUser> {
    readonly name: string = 'fake-form-post';

    readonly clientId: string = CLIENT_ID;

    readonly clientAuthentication: OAuthClientAuthentication = { method: 'client_secret_basic', clientSecret: CLIENT_SECRET };

    override readonly responseMode: OAuthResponseMode = 'form_post';

    get issuer(): string {
        return formPostProvider.issuer;
    }
}

class ApiProviderAuthenticator extends BaseOidcAuthenticator<Roles, JwtUser> {
    readonly name: string = 'fake-api';

    readonly clientId: string = CLIENT_ID;

    readonly clientAuthentication: OAuthClientAuthentication = { method: 'client_secret_basic', clientSecret: CLIENT_SECRET };

    override readonly apiScopes: string[] = [READ_SCOPE, WRITE_SCOPE];

    get issuer(): string {
        return apiProvider.issuer;
    }
}

/**
 * Has the browser post the provider's last answer to the callback, the way the provider's page does.
 * @param browser - The browser.
 * @param from - The origin of the page that posts it.
 * @returns The response of the callback.
 */
async function postAnswer(browser: TestBrowser, from: string): Promise<Response> {
    return await browser.open(`${PUBLIC_URL}/auth/federated/fake-form-post/callback`, {
        method: 'POST',
        headers: { [KnownHeader.CONTENT_TYPE]: MimeType.FORM_URL_ENCODED },
        body: formPostProvider.formPosts.at(-1),
        crossSiteFrom: from
    });
}

/**
 * A browser on the application, which resolves its public url to where the server listens.
 * @param baseUrl - Where the server listens.
 * @returns The browser.
 */
function newBrowser(baseUrl: string): TestBrowser {
    return new TestBrowser(baseUrl, PUBLIC_URL);
}

/**
 * The hops of one sign-in.
 */
type SignIn = {
    /**
     * Where the provider sends the browser back to, the callback with the code.
     */
    callback: string,
    /**
     * Where the callback sends the browser.
     */
    landing: string
};

/**
 * Signs in at the provider, the way a browser does: to the application's authorize route, on to the
 * provider, and back to the callback.
 * @param browser - The browser.
 * @param authorizeUrl - The application's authorize route, with its query.
 * @returns The hops.
 */
async function signIn(browser: TestBrowser, authorizeUrl: string): Promise<SignIn> {
    const atProvider: string = await browser.follow(authorizeUrl);
    const callback: string = await browser.follow(atProvider);
    return { callback, landing: await browser.follow(callback) };
}

/**
 * The options every app in this file runs with.
 * @returns The options.
 */
function createFederationOptions(): FederationOptions {
    return {
        allowedRedirects: ['https://app.example.com'],
        registrationUrl: REGISTRATION_URL,
        errorUrl: ERROR_URL,
        maxAuthenticationAgeInMs: 3600000
    };
}

/**
 * Starts an application signing in through the fake provider.
 * @param controllers - The controllers, which decide which strategy the sign-in logs in with.
 * @param strategy - That strategy.
 * @param oauthOptions - The options.
 * @returns The server and the url it listens at.
 */
async function startApp(
    controllers: Newable<unknown>[],
    strategy: typeof CookieAuthStrategy | typeof JwtAuthStrategy,
    oauthOptions: FederationOptions | undefined
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
        authenticators: [FakeProviderAuthenticator, FormPostProviderAuthenticator, ApiProviderAuthenticator],
        controllers,
        providers: [
            ...defaultTestServerProviders,
            defineProvider({ token: ZIBRI_DI_TOKENS.COOKIE_SIGN_SECRET, useFactory: () => 'test-cookie-secret' }),
            defineProvider({ token: ZIBRI_DI_TOKENS.FEDERATION_OPTIONS, useValue: oauthOptions })
        ]
    });
    return [server, await server.start()];
}

/**
 * Creates a user, linked to the identity the provider signs in next when a subject is given.
 * @param email - The user's email.
 * @param subject - Who the user is at the provider, if they are linked.
 * @param at - The provider the user is linked at.
 * @returns The user.
 */
async function createUser(email: string, subject: string | undefined, at: FakeOAuthProvider = provider): Promise<JwtUser> {
    const user: JwtUser = await inject(repositoryTokenFor(JwtUser)).create({ email, roles: [Roles.USER] });
    if (subject != undefined) {
        await inject<Repository<FederatedIdentity, FederatedIdentityCreateData>>(repositoryTokenFor(FederatedIdentity))
            .create({ issuer: at.issuer, subject, userId: user.id, signIn: true, grantedScopes: [] });
    }
    return user;
}

/**
 * A fresh subject, so the cases in this file do not see each other's links.
 * @returns The subject.
 */
function newSubject(): string {
    return `subject-${randomBytes(6).toString('hex')}`;
}

/**
 * A user logged in to cookies.
 */
type LoggedIn = {
    /**
     * The browser holding their session.
     */
    browser: TestBrowser,
    /**
     * The csrf token of that session.
     */
    csrfToken: string,
    /**
     * The user.
     */
    user: JwtUser
};

/**
 * Logs a new user in to cookies, through the provider they are linked at.
 * @param baseUrl - Where the application listens.
 * @returns The user and their browser.
 */
async function logIn(baseUrl: string): Promise<LoggedIn> {
    const subject: string = newSubject();
    const user: JwtUser = await createUser(`${subject}@example.com`, subject);
    provider.identity = { subject };
    const browser: TestBrowser = newBrowser(baseUrl);
    await signIn(browser, `${baseUrl}/auth/federated/authorize?${new URLSearchParams({ authenticator: 'fake', redirectTo: REDIRECT_TO }).toString()}`);
    // eslint-disable-next-line typescript/no-unsafe-assignment
    const { csrfToken }: { csrfToken: string } = await (await browser.open(`${baseUrl}/auth/csrf-token`)).json();
    return { browser, csrfToken, user };
}

@Auth.skip({ allowRedundant: true })
@Controller('/register', { allowOrphan: true })
class CookieRegistrationController {
    // what an application writes: read who signed in, create the user and link the identity in one
    // transaction, so neither exists without the other - and log in once that is committed
    @Post('/')
    async register(
        @Body(FederatedTicketCredentials)
        credentials: FederatedTicketCredentials
    ): Promise<CookieAuthData<string>> {
        const authService: AuthServiceInterface = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
        const users: Repository<JwtUser> = inject(repositoryTokenFor(JwtUser));
        const transaction: Transaction = await users.dataSource.startTransaction();
        try {
            const registration: FederatedRegistration = await authService.resolveRegistration(FakeProviderAuthenticator, credentials, transaction);
            const user: JwtUser = await users.create({ email: registration.email ?? '', roles: [Roles.USER] }, { transaction });
            await authService.linkIdentity(FakeProviderAuthenticator, credentials, user.id, transaction);
            await transaction.commit();
        }
        catch (error) {
            await transaction.rollback();
            throw error;
        }
        return await authService.login(FakeProviderAuthenticator, CookieAuthStrategy, credentials, undefined);
    }
}

@Auth.skip({ allowRedundant: true })
@Controller('/register', { allowOrphan: true })
class JwtRegistrationController {
    @Post('/')
    async register(
        @Body(FederatedTicketCredentials)
        credentials: FederatedTicketCredentials
    ): Promise<JwtAuthData<string>> {
        const authService: AuthServiceInterface = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
        const registration: FederatedRegistration = await authService.resolveRegistration(FakeProviderAuthenticator, credentials, undefined);
        const user: JwtUser = await inject(repositoryTokenFor(JwtUser)).create({ email: registration.email ?? '', roles: [Roles.USER] });
        await authService.linkIdentity(FakeProviderAuthenticator, credentials, user.id, undefined);
        return await authService.login(FakeProviderAuthenticator, JwtAuthStrategy, credentials, undefined);
    }
}

@Auth.skip({ allowRedundant: true })
@Controller('/register-api', { allowOrphan: true })
class ApiRegistrationController {
    @Post('/')
    async register(
        @Body(FederatedTicketCredentials)
        credentials: FederatedTicketCredentials
    ): Promise<{ userId: string }> {
        const authService: AuthServiceInterface = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
        const registration: FederatedRegistration = await authService.resolveRegistration(ApiProviderAuthenticator, credentials, undefined);
        const user: JwtUser = await inject(repositoryTokenFor(JwtUser)).create({ email: registration.email ?? '', roles: [Roles.USER] });
        await authService.linkIdentity(ApiProviderAuthenticator, credentials, user.id, undefined);
        return { userId: user.id };
    }
}

class ConnectionInput {
    @Property.string()
    redirectTo!: string;
}

class ApiConnectionInput {
    @Property.boolean()
    signIn!: boolean;

    @Property.array({ items: { type: 'string' } })
    scopes!: string[];
}

@Controller('/account', { allowOrphan: true })
class ConnectionController {
    // what an application writes: a route of its own, guarded as it decides, answering with the url
    // the frontend sends the browser to
    @Auth.isLoggedIn()
    @Post('/connect/:provider')
    async connect(
        @Param.path('provider')
        provider: string,
        @Body(ConnectionInput)
        input: ConnectionInput
    ): Promise<FederatedConnectionStart> {
        return await inject(ZIBRI_DI_TOKENS.AUTH_SERVICE).startConnection(
            FederatedRouteUtilities.resolveAuthenticator(provider),
            { redirectTo: input.redirectTo, signIn: true }
        );
    }

    // the same without the guard, which shows that startConnection itself takes nobody but the user
    // logged in with the request
    @Auth.skip({ allowRedundant: true })
    @Post('/unguarded-connect')
    async unguardedConnect(
        @Body(ConnectionInput)
        input: ConnectionInput
    ): Promise<FederatedConnectionStart> {
        return await inject(ZIBRI_DI_TOKENS.AUTH_SERVICE).startConnection(
            FakeProviderAuthenticator,
            { redirectTo: input.redirectTo, signIn: true }
        );
    }

    // a connection for the apis of the provider that has some, for what the body says
    @Auth.isLoggedIn()
    @Post('/connect-api')
    async connectApi(
        @Body(ApiConnectionInput)
        input: ApiConnectionInput
    ): Promise<FederatedConnectionStart> {
        return await inject(ZIBRI_DI_TOKENS.AUTH_SERVICE).startConnection(
            ApiProviderAuthenticator,
            { redirectTo: CONNECTED_URL, signIn: input.signIn, scopes: input.scopes }
        );
    }
}

// the auth routes of the providers, logging in with cookies or with jwts. Orphans for the cases that
// boot with the other
@Controller('/auth', { allowOrphan: true, versions: 'all' })
class CookieProviderAuthController extends AuthController({
        strategies: [CookieAuthStrategy],
        authenticators: [FakeProviderAuthenticator, FormPostProviderAuthenticator, ApiProviderAuthenticator],
        twoFactorMethods: [OtpTwoFactorMethod]
    }) {}

@Controller('/auth', { allowOrphan: true, versions: 'all' })
class JwtProviderAuthController extends AuthController({
        strategies: [JwtAuthStrategy],
        authenticators: [FakeProviderAuthenticator, FormPostProviderAuthenticator, ApiProviderAuthenticator],
        twoFactorMethods: [OtpTwoFactorMethod]
    }) {}

/**
 * The auth service of the running application.
 * @returns The service.
 */
function authService(): AuthServiceInterface {
    return inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
}

/**
 * Who a user is at a provider, as the identities linked to them there say.
 * @param authenticator - The provider.
 * @param userId - The user.
 * @returns The subjects of the identities.
 */
async function findSubjects(
    authenticator: typeof FakeProviderAuthenticator | typeof FormPostProviderAuthenticator | typeof ApiProviderAuthenticator,
    userId: string
): Promise<string[]> {
    return (await authService().findIdentities(userId, undefined, [authenticator])).map(linked => linked.identity.subject);
}

/**
 * The audit blocks of everything logged so far, flushed first because the logger writes later.
 * @returns Whatever each entry carries under `context.metadata.audit`.
 */
async function auditEvents(): Promise<unknown[]> {
    await inject<LoggerInterface>(ZIBRI_DI_TOKENS.LOGGER).flush();
    return (await inject<Repository<Log>>(repositoryTokenFor(Log)).findAll({})).map(l => l.context.metadata?.['audit']);
}

beforeAll(async () => {
    provider = await startFakeOAuthProvider({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
    formPostProvider = await startFakeOAuthProvider({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, formPost: true });
    apiProvider = await startFakeOAuthProvider({
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        rotatesRefreshTokens: true,
        // shorter than the margin a token is refreshed within, so every use refreshes it
        accessTokenExpiresInSeconds: 30
    });
});

afterAll(async () => {
    await provider?.stop();
    await formPostProvider?.stop();
    await apiProvider?.stop();
});

// first, for the reason on startAndStopTestServerWithout
describe('BaseOidcAuthenticator — starting', () => {
    it('refuses to start without its entities, and names them', async () => {
        const start: Promise<void> = startAndStopTestServerWithout([], {
            authenticators: [FakeProviderAuthenticator],
            providers: [...defaultTestServerProviders, defineProvider({ token: ZIBRI_DI_TOKENS.FEDERATION_OPTIONS, useValue: createFederationOptions() })]
        });

        await expect(start).rejects.toThrow(/Error initializing FakeProviderAuthenticator[\S\s]*FederatedLoginAttempt[\S\s]*FederatedRegistrationTicket/);
    }, 30000);

    it('refuses to start without the options every provider shares', async () => {
        const start: Promise<[StartedTestServer, string]> = startApp([], JwtAuthStrategy, undefined);

        await expect(start).rejects.toThrow(/federation_options/);
    }, 30000);
});

describe('BaseOidcAuthenticator — signing in to cookies', () => {
    const oauthOptions: FederationOptions = createFederationOptions();
    let server: StartedTestServer;
    let baseUrl: string;

    beforeAll(async () => {
        [server, baseUrl] = await startApp(
            [CookieProviderAuthController, CookieRegistrationController],
            CookieAuthStrategy,
            oauthOptions
        );
    }, 20000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    const authorizeUrl: (query?: Record<string, string>) => string = query => `${baseUrl}/auth/federated/authorize?${new URLSearchParams({ authenticator: 'fake', redirectTo: REDIRECT_TO, ...query }).toString()}`;

    it('signs a linked user in, and lands where the frontend asked with a session', async () => {
        const subject: string = newSubject();
        await createUser(`${subject}@example.com`, subject);
        provider.identity = { subject, email: `${subject}@example.com`, emailVerified: true };
        const browser: TestBrowser = newBrowser(baseUrl);

        const { landing } = await signIn(browser, authorizeUrl());

        expect(landing).toBe(REDIRECT_TO);
        // the frontend reads its csrf token once it is back, which only a session answers
        const csrf: Response = await browser.open(`${baseUrl}/auth/csrf-token`);
        expect(csrf.status).toBe(200);
    });

    it('ties the sign-in to the browser with an httpOnly cookie a top level navigation still sends', async () => {
        const res: Response = await newBrowser(baseUrl).open(authorizeUrl());

        const cookie: string | undefined = res.headers.getSetCookie().find(c => c.startsWith('zibri-federated-'));
        expect(cookie).toMatch(/HttpOnly/);
        expect(cookie).toMatch(/SameSite=Lax/);
    });

    it('asks the provider with PKCE, a nonce, max_age and the scopes', async () => {
        const atProvider: URL = new URL(await newBrowser(baseUrl).follow(authorizeUrl()));

        expect(atProvider.origin).toBe(provider.issuer);
        const asked: URLSearchParams = atProvider.searchParams;
        expect(asked.get('code_challenge_method')).toBe('S256');
        expect(asked.get('code_challenge')).toMatch(/^[\w-]{43}$/);
        expect(asked.get('nonce')).toBeTruthy();
        expect(asked.get('max_age')).toBe('3600');
        expect(asked.get('scope')).toBe('openid email profile');
        expect(asked.get('redirect_uri')).toBe(`${PUBLIC_URL}/auth/federated/fake/callback`);
        expect(asked.has('prompt')).toBe(false);
    });

    it('asks the provider for a fresh sign-in when the frontend reauthenticates', async () => {
        const atProvider: URL = new URL(await newBrowser(baseUrl).follow(authorizeUrl({ reauthenticate: 'true' })));

        expect(atProvider.searchParams.get('prompt')).toBe('login');
    });

    it('keeps when the user signed in at the provider as the login time, not when the callback ran', async () => {
        const subject: string = newSubject();
        const user: JwtUser = await createUser(`${subject}@example.com`, subject);
        provider.identity = { subject };
        const signedInAt: Date = new Date(Math.floor((Date.now() - 600000) / 1000) * 1000);
        provider.authenticatedAt = signedInAt;

        try {
            await signIn(newBrowser(baseUrl), authorizeUrl());
        }
        finally {
            provider.authenticatedAt = undefined;
        }

        const sessions: CookieAuthRefreshSession[] = await inject(repositoryTokenFor(CookieAuthRefreshSession)).findAll({ where: { userId: user.id } });
        expect(sessions.map(s => new Date(s.authenticatedAt).getTime())).toStrictEqual([signedInAt.getTime()]);
    });

    it('refuses the answer in another browser than the one the sign-in started in', async () => {
        const subject: string = newSubject();
        await createUser(`${subject}@example.com`, subject);
        provider.identity = { subject };
        const victim: TestBrowser = newBrowser(baseUrl);
        const attacker: TestBrowser = newBrowser(baseUrl);
        const callback: string = await attacker.follow(await attacker.follow(authorizeUrl()));

        expect(await victim.follow(callback)).toBe(`${ERROR_URL}?error=expired`);
        expect((await victim.open(`${baseUrl}/auth/csrf-token`)).status).toBe(401);
    });

    it('refuses the same answer twice', async () => {
        const subject: string = newSubject();
        await createUser(`${subject}@example.com`, subject);
        provider.identity = { subject };
        const browser: TestBrowser = newBrowser(baseUrl);
        const { callback } = await signIn(browser, authorizeUrl());

        expect(await browser.follow(callback)).toBe(`${ERROR_URL}?error=expired`);
    });

    it('goes to the error url when the user declines at the provider', async () => {
        provider.denyNext('access_denied');

        const { landing } = await signIn(newBrowser(baseUrl), authorizeUrl());

        expect(landing).toBe(`${ERROR_URL}?error=cancelled`);
    });

    it('refuses an ID token issued for another client', async () => {
        provider.rewriteNextIdToken(claims => ({ ...claims, aud: 'another-client' }));

        const { landing } = await signIn(newBrowser(baseUrl), authorizeUrl());

        expect(landing).toBe(`${ERROR_URL}?error=invalid`);
    });

    it('refuses an ID token carrying another nonce', async () => {
        provider.rewriteNextIdToken(claims => ({ ...claims, nonce: 'not-the-one-sent' }));

        const { landing } = await signIn(newBrowser(baseUrl), authorizeUrl());

        expect(landing).toBe(`${ERROR_URL}?error=invalid`);
    });

    it('refuses an ID token from a sign-in at the provider longer ago than allowed', async () => {
        provider.authenticatedAt = new Date(Date.now() - 7200000);

        try {
            const { landing } = await signIn(newBrowser(baseUrl), authorizeUrl());
            expect(landing).toBe(`${ERROR_URL}?error=invalid`);
        }
        finally {
            provider.authenticatedAt = undefined;
        }
    });

    it('refuses to send the sign-in on to a page that is not one of the allowed redirects', async () => {
        const res: Response = await newBrowser(baseUrl).open(authorizeUrl({ redirectTo: 'https://app.example.com.evil.example/steal' }));

        expect(res.status).toBe(400);
        expect(res.headers.get(KnownHeader.LOCATION)).toBeNull();
    });

    it('sends an identity no user is linked to to the registration, which links and logs them in', async () => {
        const subject: string = newSubject();
        provider.identity = { subject, email: `${subject}@example.com`, emailVerified: true };
        const browser: TestBrowser = newBrowser(baseUrl);

        const { landing } = await signIn(browser, authorizeUrl());
        const ticket: string | null = new URL(landing).searchParams.get('ticket');
        expect(landing.startsWith(`${REGISTRATION_URL}?ticket=`)).toBe(true);

        const registered: Response = await browser.open(`${baseUrl}/register`, {
            method: 'POST',
            headers: { [KnownHeader.CONTENT_TYPE]: 'application/json' },
            body: JsonUtilities.stringify({ ticket })
        });
        expect(registered.status).toBe(200);

        // linked from now on: the next sign-in logs straight in
        expect((await signIn(newBrowser(baseUrl), authorizeUrl())).landing).toBe(REDIRECT_TO);
    });

    it('refuses a registration ticket from another browser than the one the sign-in started in', async () => {
        provider.identity = { subject: newSubject() };
        const { landing } = await signIn(newBrowser(baseUrl), authorizeUrl());

        const res: Response = await newBrowser(baseUrl).open(`${baseUrl}/register`, {
            method: 'POST',
            headers: { [KnownHeader.CONTENT_TYPE]: 'application/json' },
            body: JsonUtilities.stringify({ ticket: new URL(landing).searchParams.get('ticket') })
        });

        expect(res.status).toBe(401);
    });

    it('asks a provider that answers with a form post for one, and ties the sign-in with a cookie its post carries', async () => {
        const res: Response = await newBrowser(baseUrl).open(authorizeUrl().replace('authenticator=fake&', 'authenticator=fake-form-post&'));

        const asked: URLSearchParams = new URL(res.headers.get(KnownHeader.LOCATION) ?? '').searchParams;
        expect(asked.get('response_mode')).toBe('form_post');
        const cookie: string | undefined = res.headers.getSetCookie().find(c => c.startsWith('zibri-federated-'));
        expect(cookie).toMatch(/SameSite=None/);
        expect(cookie).toMatch(/Secure/);
        expect(cookie).toMatch(/HttpOnly/);
    });

    it('signs a linked user in when the provider posts its answer from its sign-in page', async () => {
        const subject: string = newSubject();
        await createUser(`${subject}@example.com`, subject, formPostProvider);
        formPostProvider.identity = { subject };
        const browser: TestBrowser = newBrowser(baseUrl);
        await browser.open(await browser.follow(authorizeUrl().replace('authenticator=fake&', 'authenticator=fake-form-post&')));

        const res: Response = await postAnswer(browser, new URL(formPostProvider.issuer).origin);

        expect(res.headers.get(KnownHeader.LOCATION)).toBe(REDIRECT_TO);
        expect((await browser.open(`${baseUrl}/auth/csrf-token`)).status).toBe(200);
    });

    it('refuses the answer posted from any other page than the provider\'s', async () => {
        const subject: string = newSubject();
        await createUser(`${subject}@example.com`, subject, formPostProvider);
        formPostProvider.identity = { subject };
        const browser: TestBrowser = newBrowser(baseUrl);
        await browser.open(await browser.follow(authorizeUrl().replace('authenticator=fake&', 'authenticator=fake-form-post&')));

        const res: Response = await postAnswer(browser, 'https://attacker.example.com');

        expect(res.status).toBe(403);
        expect((await browser.open(`${baseUrl}/auth/csrf-token`)).status).toBe(401);
    });

    it('takes no post with cookies from another site for a provider that redirects', async () => {
        const browser: TestBrowser = newBrowser(baseUrl);
        await browser.open(authorizeUrl());

        const res: Response = await browser.open(`${PUBLIC_URL}/auth/federated/fake/callback`, {
            method: 'POST',
            // the cookie of a provider that redirects is lax, which this would not carry: one that
            // does carry a cookie shows the route itself takes nothing from another site
            headers: { [KnownHeader.CONTENT_TYPE]: MimeType.FORM_URL_ENCODED, [KnownHeader.COOKIE]: 'session=any' },
            body: 'code=anything&state=anything',
            crossSiteFrom: new URL(provider.issuer).origin
        });

        expect(res.status).toBe(403);
    });

    it('sends an identity no user is linked to to the registration after a form post, with the ticket kept to this browser', async () => {
        const subject: string = newSubject();
        formPostProvider.identity = { subject, email: `${subject}@example.com`, emailVerified: true };
        const browser: TestBrowser = newBrowser(baseUrl);
        await browser.open(await browser.follow(authorizeUrl().replace('authenticator=fake&', 'authenticator=fake-form-post&')));

        const answered: Response = await postAnswer(browser, new URL(formPostProvider.issuer).origin);
        const landing: string = answered.headers.get(KnownHeader.LOCATION) ?? '';
        expect(landing.startsWith(`${REGISTRATION_URL}?ticket=`)).toBe(true);
        // lax again: the registration is the application's own page, so the ticket's cookie need not
        // go along with anything another site sends
        expect(answered.headers.getSetCookie().find(c => c.startsWith('zibri-federated-'))).toMatch(/SameSite=Lax/);
    });

    it('never signs an unlinked identity in as the user who holds the same email', async () => {
        const subject: string = newSubject();
        await createUser(`${subject}@example.com`, undefined);
        provider.identity = { subject, email: `${subject}@example.com`, emailVerified: true };

        const { landing } = await signIn(newBrowser(baseUrl), authorizeUrl());

        expect(landing.startsWith(`${REGISTRATION_URL}?ticket=`)).toBe(true);
    });
});

describe('BaseOidcAuthenticator — signing in to jwt', () => {
    const oauthOptions: FederationOptions = createFederationOptions();
    let server: StartedTestServer;
    let baseUrl: string;

    beforeAll(async () => {
        [server, baseUrl] = await startApp([JwtProviderAuthController, JwtRegistrationController], JwtAuthStrategy, oauthOptions);
    }, 20000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    /**
     * Starts a sign-in the way a frontend does, with a PKCE verifier it keeps.
     * @param verifier - The verifier.
     * @returns The authorize url.
     */
    function authorizeUrl(verifier: string): string {
        const codeChallenge: string = createHash('sha256').update(verifier)
            .digest('base64url');
        return `${baseUrl}/auth/federated/authorize?${new URLSearchParams({ authenticator: 'fake', redirectTo: REDIRECT_TO, codeChallenge }).toString()}`;
    }

    /**
     * Exchanges the code a sign-in landed with.
     * @param code - The code.
     * @param codeVerifier - The verifier sent with it.
     * @returns The response.
     */
    async function exchange(code: string | null, codeVerifier: string): Promise<Response> {
        return await fetch(`${baseUrl}/auth/login?authenticator=fake`, {
            method: 'POST',
            headers: { [KnownHeader.CONTENT_TYPE]: 'application/json' },
            body: JsonUtilities.stringify({ code, codeVerifier })
        });
    }

    it('hands the login over with a code in the url, which the verifier exchanges for tokens', async () => {
        const subject: string = newSubject();
        const user: JwtUser = await createUser(`${subject}@example.com`, subject);
        provider.identity = { subject };
        const verifier: string = randomBytes(32).toString('base64url');

        const { landing } = await signIn(newBrowser(baseUrl), authorizeUrl(verifier));
        expect(landing.startsWith(`${REDIRECT_TO}?code=`)).toBe(true);
        const res: Response = await exchange(new URL(landing).searchParams.get('code'), verifier);

        expect(res.status).toBe(200);
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const body: { userId: string, accessToken: { value: string } } = await res.json();
        expect(body.userId).toBe(user.id);
        expect(body.accessToken.value).toBeTruthy();
    });

    it('hands the login over with a code when the provider posts its answer', async () => {
        const subject: string = newSubject();
        const user: JwtUser = await createUser(`${subject}@example.com`, subject, formPostProvider);
        formPostProvider.identity = { subject };
        const verifier: string = randomBytes(32).toString('base64url');
        const browser: TestBrowser = newBrowser(baseUrl);
        await browser.open(await browser.follow(authorizeUrl(verifier).replace('authenticator=fake&', 'authenticator=fake-form-post&')));

        const landing: string = (await postAnswer(browser, new URL(formPostProvider.issuer).origin)).headers.get(KnownHeader.LOCATION) ?? '';
        const res: Response = await fetch(`${baseUrl}/auth/login?authenticator=fake-form-post`, {
            method: 'POST',
            headers: { [KnownHeader.CONTENT_TYPE]: 'application/json' },
            body: JsonUtilities.stringify({ code: new URL(landing).searchParams.get('code'), codeVerifier: verifier })
        });

        expect(res.status).toBe(200);
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const body: { userId: string } = await res.json();
        expect(body.userId).toBe(user.id);
    });

    it('refuses the code with another verifier than the one the sign-in started with', async () => {
        const subject: string = newSubject();
        await createUser(`${subject}@example.com`, subject);
        provider.identity = { subject };
        const verifier: string = randomBytes(32).toString('base64url');
        const { landing } = await signIn(newBrowser(baseUrl), authorizeUrl(verifier));

        const res: Response = await exchange(new URL(landing).searchParams.get('code'), randomBytes(32).toString('base64url'));

        expect(res.status).toBe(401);
    });

    it('refuses the same code twice', async () => {
        const subject: string = newSubject();
        await createUser(`${subject}@example.com`, subject);
        provider.identity = { subject };
        const verifier: string = randomBytes(32).toString('base64url');
        const { landing } = await signIn(newBrowser(baseUrl), authorizeUrl(verifier));
        const code: string | null = new URL(landing).searchParams.get('code');

        expect((await exchange(code, verifier)).status).toBe(200);
        expect((await exchange(code, verifier)).status).toBe(401);
    });

    it('refuses to start a sign-in without the challenge of a verifier', async () => {
        const res: Response = await fetch(
            `${baseUrl}/auth/federated/authorize?${new URLSearchParams({ authenticator: 'fake', redirectTo: REDIRECT_TO }).toString()}`,
            { redirect: 'manual' }
        );

        expect(res.status).toBe(400);
        // the jwt login cannot go out with the redirect, so the answer says how to have it handed over
        expect(await res.text()).toMatch(/Send a codeChallenge to have the login handed over by code/);
    });

    it('takes a registration ticket only with the verifier', async () => {
        const subject: string = newSubject();
        provider.identity = { subject, email: `${subject}@example.com`, emailVerified: true };
        const verifier: string = randomBytes(32).toString('base64url');
        const { landing } = await signIn(newBrowser(baseUrl), authorizeUrl(verifier));
        const ticket: string | null = new URL(landing).searchParams.get('ticket');
        const register: (codeVerifier: string | undefined) => Promise<Response> = async codeVerifier => await fetch(`${baseUrl}/register`, {
            method: 'POST',
            headers: { [KnownHeader.CONTENT_TYPE]: 'application/json' },
            body: JsonUtilities.stringify({ ticket, codeVerifier })
        });

        expect((await register(undefined)).status).toBe(401);
        expect((await register(verifier)).status).toBe(200);
    });
});

describe('BaseOidcAuthenticator — connecting a provider to an account', () => {
    let server: StartedTestServer;
    let baseUrl: string;

    beforeAll(async () => {
        [server, baseUrl] = await startApp(
            [CookieProviderAuthController, ConnectionController],
            CookieAuthStrategy,
            createFederationOptions()
        );
    }, 20000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    /**
     * Asks the application's own route for the url that connects a provider, the way the frontend does.
     * @param loggedIn - Who asks.
     * @param to - The name of the provider.
     * @param redirectTo - Where the browser goes once it is connected.
     * @returns The response.
     */
    async function askToConnect(loggedIn: LoggedIn, to: string, redirectTo: string = CONNECTED_URL): Promise<Response> {
        return await loggedIn.browser.open(`${baseUrl}/account/connect/${to}`, {
            method: 'POST',
            headers: { [KnownHeader.CONTENT_TYPE]: 'application/json', 'x-csrf-token': loggedIn.csrfToken },
            body: JsonUtilities.stringify({ redirectTo })
        });
    }

    /**
     * Connects the provider that redirects to the account, as the user's browser does.
     * @param loggedIn - Who connects.
     * @returns Where the browser lands.
     */
    async function connect(loggedIn: LoggedIn): Promise<string> {
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const { url }: { url: string } = await (await askToConnect(loggedIn, 'fake')).json();
        return (await signIn(loggedIn.browser, url)).landing;
    }

    /**
     * Signs in through the provider that redirects, in a new browser.
     * @returns Where the browser lands: the redirect for a linked identity, the registration otherwise.
     */
    async function signInElsewhere(): Promise<string> {
        return (await signIn(newBrowser(baseUrl), `${baseUrl}/auth/federated/authorize?${new URLSearchParams({ authenticator: 'fake', redirectTo: REDIRECT_TO }).toString()}`)).landing;
    }

    it('links the identity to the logged in user, so a sign-in through it logs in as them', async () => {
        const loggedIn: LoggedIn = await logIn(baseUrl);
        const subject: string = newSubject();
        formPostProvider.identity = { subject };

        // eslint-disable-next-line typescript/no-unsafe-assignment
        const { url }: { url: string } = await (await askToConnect(loggedIn, 'fake-form-post')).json();
        await loggedIn.browser.open(await loggedIn.browser.follow(url));
        const answered: Response = await postAnswer(loggedIn.browser, new URL(formPostProvider.issuer).origin);

        expect(answered.headers.get(KnownHeader.LOCATION)).toBe(CONNECTED_URL);
        expect(await findSubjects(FormPostProviderAuthenticator, loggedIn.user.id)).toStrictEqual([subject]);
        expect(await auditEvents()).toContainEqual({
            action: AuditAction.IDENTITY_LINKED,
            outcome: AuditOutcome.SUCCESS,
            userId: loggedIn.user.id
        });
        // a sign-in through it in another browser logs straight in rather than going to the registration
        const elsewhere: TestBrowser = newBrowser(baseUrl);
        await elsewhere.open(await elsewhere.follow(`${baseUrl}/auth/federated/authorize?${new URLSearchParams({ authenticator: 'fake-form-post', redirectTo: REDIRECT_TO }).toString()}`));
        expect((await postAnswer(elsewhere, new URL(formPostProvider.issuer).origin)).headers.get(KnownHeader.LOCATION)).toBe(REDIRECT_TO);
    });

    it('has the user sign in at the provider, rather than it reusing a session it has', async () => {
        const loggedIn: LoggedIn = await logIn(baseUrl);

        // eslint-disable-next-line typescript/no-unsafe-assignment
        const { url }: { url: string } = await (await askToConnect(loggedIn, 'fake')).json();
        const atProvider: URL = new URL(await loggedIn.browser.follow(url));

        expect(atProvider.origin).toBe(provider.issuer);
        expect(atProvider.searchParams.get('prompt')).toBe('login');
    });

    it('connects nobody but the user logged in with the request', async () => {
        const codes: Repository<FederatedConnectionCode> = inject(repositoryTokenFor(FederatedConnectionCode));
        const before: number = (await codes.findAll({})).length;

        const res: Response = await newBrowser(baseUrl).open(`${baseUrl}/account/unguarded-connect`, {
            method: 'POST',
            headers: { [KnownHeader.CONTENT_TYPE]: 'application/json' },
            body: JsonUtilities.stringify({ redirectTo: CONNECTED_URL })
        });

        expect(res.status).toBe(401);
        expect(await codes.findAll({})).toHaveLength(before);
    });

    it('refuses to send the connection on to a page that is not one of the allowed redirects', async () => {
        const res: Response = await askToConnect(await logIn(baseUrl), 'fake', 'https://app.example.com.evil.example/steal');

        expect(res.status).toBe(400);
    });

    it('refuses an identity linked to another user, and leaves it with them', async () => {
        const subject: string = newSubject();
        const owner: JwtUser = await createUser(`${subject}@example.com`, subject);
        const loggedIn: LoggedIn = await logIn(baseUrl);
        provider.identity = { subject };

        expect(await connect(loggedIn)).toBe(`${ERROR_URL}?error=already_linked`);

        expect(await findSubjects(FakeProviderAuthenticator, owner.id)).toStrictEqual([subject]);
        expect(await findSubjects(FakeProviderAuthenticator, loggedIn.user.id)).not.toContain(subject);
        expect(await auditEvents()).toContainEqual(expect.objectContaining({
            action: AuditAction.IDENTITY_LINKED,
            outcome: AuditOutcome.FAILURE
        }));
    });

    it('takes an identity linked to the same user again', async () => {
        const loggedIn: LoggedIn = await logIn(baseUrl);

        // the provider still signs in the identity the user logged in with
        expect(await connect(loggedIn)).toBe(CONNECTED_URL);
        expect(await findSubjects(FakeProviderAuthenticator, loggedIn.user.id)).toHaveLength(1);
    });

    it('refuses the answer in another browser than the one the connection started in', async () => {
        // the attacker connects, and sends the victim the link to the provider. Taken there, the
        // victim's identity would be linked to the attacker's account, and the victim's next sign-in
        // would log them into it
        const attacker: LoggedIn = await logIn(baseUrl);
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const { url }: { url: string } = await (await askToConnect(attacker, 'fake')).json();
        const atProvider: string = await attacker.browser.follow(url);
        const victimSubject: string = newSubject();
        await createUser(`${victimSubject}@example.com`, undefined);
        provider.identity = { subject: victimSubject };
        const victim: TestBrowser = newBrowser(baseUrl);

        expect(await victim.follow(await victim.follow(atProvider))).toBe(`${ERROR_URL}?error=expired`);
        expect(await findSubjects(FakeProviderAuthenticator, attacker.user.id)).not.toContain(victimSubject);
    });

    it('takes the url of a connection once', async () => {
        const loggedIn: LoggedIn = await logIn(baseUrl);
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const { url }: { url: string } = await (await askToConnect(loggedIn, 'fake')).json();
        await loggedIn.browser.follow(url);

        expect(await newBrowser(baseUrl).follow(url)).toBe(`${ERROR_URL}?error=expired`);
    });

    it('connects through the routes of the auth controller, and lists and unlinks the identity there', async () => {
        const loggedIn: LoggedIn = await logIn(baseUrl);
        const headers: Record<string, string> = { [KnownHeader.CONTENT_TYPE]: 'application/json', 'x-csrf-token': loggedIn.csrfToken };

        const started: Response = await loggedIn.browser.open(`${baseUrl}/auth/connect?authenticator=fake`, {
            method: 'POST',
            headers,
            body: JsonUtilities.stringify({ redirectTo: CONNECTED_URL, signIn: true })
        });
        expect(started.status).toBe(200);
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const { url }: { url: string } = await started.json();
        expect((await signIn(loggedIn.browser, url)).landing).toBe(CONNECTED_URL);

        // eslint-disable-next-line typescript/no-unsafe-assignment
        const listed: LinkedIdentity[] = await (await loggedIn.browser.open(`${baseUrl}/auth/identities`)).json();
        expect(listed.map(identity => identity.authenticator)).toStrictEqual(['fake']);
        const unlinked: Response = await loggedIn.browser.open(`${baseUrl}/auth/identities/${listed[0]?.identity.id}`, { method: 'DELETE', headers });
        expect(unlinked.status).toBe(204);
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const left: LinkedIdentity[] = await (await loggedIn.browser.open(`${baseUrl}/auth/identities`)).json();
        expect(left).toStrictEqual([]);
    });

    it('finds the identities a user has at every provider, each with the provider it signs in through', async () => {
        const subject: string = newSubject();
        const user: JwtUser = await createUser(`${subject}@example.com`, subject);
        const elsewhere: string = newSubject();
        await inject<Repository<FederatedIdentity, FederatedIdentityCreateData>>(repositoryTokenFor(FederatedIdentity))
            .create({ issuer: formPostProvider.issuer, subject: elsewhere, userId: user.id, signIn: true, grantedScopes: [] });

        const linked: LinkedIdentity[] = await authService().findIdentities(user.id, undefined);

        expect(linked).toHaveLength(2);
        expect(linked.map(identity => identity.authenticator).sort()).toStrictEqual(['fake', 'fake-form-post']);
        // and only at the providers asked for
        expect(await findSubjects(FakeProviderAuthenticator, user.id)).toStrictEqual([subject]);
        expect(await findSubjects(FormPostProviderAuthenticator, user.id)).toStrictEqual([elsewhere]);
    });

    it('unlinks an identity by its id, after which a sign-in through it goes to the registration', async () => {
        const subject: string = newSubject();
        const user: JwtUser = await createUser(`${subject}@example.com`, subject);
        provider.identity = { subject };
        const [linked] = await authService().findIdentities(user.id, undefined);

        await authService().unlinkIdentity(user.id, linked?.identity.id ?? '', undefined);

        expect((await signInElsewhere()).startsWith(`${REGISTRATION_URL}?ticket=`)).toBe(true);
        expect(await auditEvents()).toContainEqual({
            action: AuditAction.IDENTITY_UNLINKED,
            outcome: AuditOutcome.SUCCESS,
            userId: user.id
        });
    });

    it('refuses to unlink an identity of another user', async () => {
        const subject: string = newSubject();
        const owner: JwtUser = await createUser(`${subject}@example.com`, subject);
        const [linked] = await authService().findIdentities(owner.id, undefined);
        const other: JwtUser = await createUser(`${newSubject()}@example.com`, undefined);

        await expect(authService().unlinkIdentity(other.id, linked?.identity.id ?? '', undefined)).rejects.toThrow(NotFoundError);
        expect(await findSubjects(FakeProviderAuthenticator, owner.id)).toStrictEqual([subject]);
        expect(await auditEvents()).toContainEqual(expect.objectContaining({
            action: AuditAction.IDENTITY_UNLINKED,
            outcome: AuditOutcome.FAILURE,
            userId: other.id
        }));
    });

    it('leaves an identity of another provider to that provider\'s authenticator', async () => {
        const subject: string = newSubject();
        const owner: JwtUser = await createUser(`${subject}@example.com`, subject);
        const [linked] = await authService().findIdentities(owner.id, undefined, [FakeProviderAuthenticator]);

        await expect(inject(FormPostProviderAuthenticator).unlinkIdentity(owner.id, linked?.identity.id ?? '', undefined)).rejects.toThrow(NotFoundError);
        expect(await findSubjects(FakeProviderAuthenticator, owner.id)).toStrictEqual([subject]);
    });
});

describe('BaseOidcAuthenticator — connecting a provider to a jwt account', () => {
    let server: StartedTestServer;
    let baseUrl: string;

    beforeAll(async () => {
        [server, baseUrl] = await startApp([JwtProviderAuthController, ConnectionController], JwtAuthStrategy, createFederationOptions());
    }, 20000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    it('links the identity to the user whose access token asked for it', async () => {
        const subject: string = newSubject();
        const user: JwtUser = await createUser(`${subject}@example.com`, subject);
        provider.identity = { subject };
        const verifier: string = randomBytes(32).toString('base64url');
        const codeChallenge: string = createHash('sha256').update(verifier)
            .digest('base64url');
        const { landing } = await signIn(
            newBrowser(baseUrl),
            `${baseUrl}/auth/federated/authorize?${new URLSearchParams({ authenticator: 'fake', redirectTo: REDIRECT_TO, codeChallenge }).toString()}`
        );
        const tokens: Response = await fetch(`${baseUrl}/auth/login?authenticator=fake`, {
            method: 'POST',
            headers: { [KnownHeader.CONTENT_TYPE]: 'application/json' },
            body: JsonUtilities.stringify({ code: new URL(landing).searchParams.get('code'), codeVerifier: verifier })
        });
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const { accessToken }: { accessToken: { value: string } } = await tokens.json();

        // the frontend asks with its token, and sends the browser on: a browser that holds no session
        // of its own, which the connection does not need
        const asked: Response = await fetch(`${baseUrl}/account/connect/fake`, {
            method: 'POST',
            headers: { [KnownHeader.CONTENT_TYPE]: 'application/json', [KnownHeader.AUTHORIZATION]: `Bearer ${accessToken.value}` },
            body: JsonUtilities.stringify({ redirectTo: CONNECTED_URL })
        });
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const { url }: { url: string } = await asked.json();
        const connected: string = newSubject();
        provider.identity = { subject: connected };

        expect((await signIn(newBrowser(baseUrl), url)).landing).toBe(CONNECTED_URL);
        expect((await findSubjects(FakeProviderAuthenticator, user.id)).sort()).toStrictEqual([subject, connected].sort());
    });
});

describe('BaseOidcAuthenticator — keeping a provider\'s tokens', () => {
    let server: StartedTestServer;
    let baseUrl: string;

    beforeAll(async () => {
        [server, baseUrl] = await startApp(
            [CookieProviderAuthController, ConnectionController, ApiRegistrationController],
            CookieAuthStrategy,
            createFederationOptions()
        );
    }, 20000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    /**
     * Connects the provider with apis to the account, as the user's browser does.
     * @param loggedIn - Who connects.
     * @param subject - Who they are at the provider.
     * @param connection - What the identity is connected for.
     * @returns Where the browser lands.
     */
    async function connectApi(loggedIn: LoggedIn, subject: string, connection: ApiConnectionInput): Promise<string> {
        apiProvider.identity = { subject };
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const { url }: { url: string } = await (await loggedIn.browser.open(`${baseUrl}/account/connect-api`, {
            method: 'POST',
            headers: { [KnownHeader.CONTENT_TYPE]: 'application/json', 'x-csrf-token': loggedIn.csrfToken },
            body: JsonUtilities.stringify(connection)
        })).json();
        return (await signIn(loggedIn.browser, url)).landing;
    }

    /**
     * The identity of a user at the provider with apis, as findIdentities lists it.
     * @param userId - The user.
     * @returns The identity.
     */
    async function findApiIdentity(userId: string): Promise<FederatedIdentity | undefined> {
        return (await authService().findIdentities(userId, undefined, [ApiProviderAuthenticator]))[0]?.identity;
    }

    /**
     * How many refreshes the provider with apis has been asked for.
     * @returns The number.
     */
    function countRefreshes(): number {
        return apiProvider.tokenRequests.filter(body => body.get('grant_type') === 'refresh_token').length;
    }

    /**
     * Why there was no access token, for a call that was expected to fail.
     * @param resolving - The call.
     * @returns The failure.
     */
    async function findFailure(resolving: Promise<string>): Promise<ProviderAccessFailure | undefined> {
        try {
            await resolving;
            return undefined;
        }
        catch (error) {
            return error instanceof ProviderAccessError ? error.failure : undefined;
        }
    }

    it('asks for the scopes and a refresh token only when a sign-in asks for apis', async () => {
        const asking: URL = new URL(await newBrowser(baseUrl).follow(
            `${baseUrl}/auth/federated/authorize?${new URLSearchParams({ authenticator: 'fake-api', redirectTo: REDIRECT_TO, scopes: READ_SCOPE }).toString()}`
        ));
        const plain: URL = new URL(await newBrowser(baseUrl).follow(
            `${baseUrl}/auth/federated/authorize?${new URLSearchParams({ authenticator: 'fake-api', redirectTo: REDIRECT_TO }).toString()}`
        ));

        expect(asking.searchParams.get('scope')).toBe(`openid email profile ${READ_SCOPE} offline_access`);
        expect(asking.searchParams.get('prompt')).toBe('consent');
        expect(plain.searchParams.get('scope')).toBe('openid email profile');
        expect(plain.searchParams.has('prompt')).toBe(false);
    });

    it('refuses a sign-in asking for a scope the authenticator does not allow', async () => {
        const res: Response = await newBrowser(baseUrl).open(
            `${baseUrl}/auth/federated/authorize?${new URLSearchParams({ authenticator: 'fake-api', redirectTo: REDIRECT_TO, scopes: 'drive' }).toString()}`
        );

        expect(res.status).toBe(400);
    });

    it('refuses a connection for neither signing in nor any scope, and one asking for a scope it does not allow', async () => {
        const authenticator: ApiProviderAuthenticator = inject(ApiProviderAuthenticator);

        // refused as a bad request: the connect route of AuthController takes what a client sends
        await expect(authenticator.startConnection(randomUUID(), { redirectTo: CONNECTED_URL, signIn: false })).rejects.toThrow(BadRequestError);
        await expect(authenticator.startConnection(randomUUID(), { redirectTo: CONNECTED_URL, signIn: true, scopes: ['drive'] }))
            .rejects.toThrow(BadRequestError);
    });

    it('keeps the tokens of a connection for apis only, which signs nobody in', async () => {
        const loggedIn: LoggedIn = await logIn(baseUrl);
        const subject: string = newSubject();

        expect(await connectApi(loggedIn, subject, { signIn: false, scopes: [READ_SCOPE] })).toBe(CONNECTED_URL);

        expect(await findApiIdentity(loggedIn.user.id)).toMatchObject({ subject, signIn: false, grantedScopes: expect.arrayContaining([READ_SCOPE]) });
        expect(await auditEvents()).toContainEqual({
            action: AuditAction.PROVIDER_ACCESS_GRANTED,
            outcome: AuditOutcome.SUCCESS,
            userId: loggedIn.user.id,
            scopes: expect.arrayContaining([READ_SCOPE])
        });
        expect((await signIn(
            newBrowser(baseUrl),
            `${baseUrl}/auth/federated/authorize?${new URLSearchParams({ authenticator: 'fake-api', redirectTo: REDIRECT_TO }).toString()}`
        )).landing).toBe(`${ERROR_URL}?error=not_for_sign_in`);
    });

    it('turns signing in on when the identity is connected again to sign in, and keeps its tokens', async () => {
        const loggedIn: LoggedIn = await logIn(baseUrl);
        const subject: string = newSubject();
        await connectApi(loggedIn, subject, { signIn: false, scopes: [READ_SCOPE] });

        await connectApi(loggedIn, subject, { signIn: true, scopes: [] });

        expect(await findApiIdentity(loggedIn.user.id)).toMatchObject({ signIn: true, grantedScopes: expect.arrayContaining([READ_SCOPE]) });
    });

    it('keeps only the scopes the user granted', async () => {
        const loggedIn: LoggedIn = await logIn(baseUrl);
        apiProvider.declinedScopes = [WRITE_SCOPE];
        try {
            await connectApi(loggedIn, newSubject(), { signIn: false, scopes: [READ_SCOPE, WRITE_SCOPE] });
        }
        finally {
            apiProvider.declinedScopes = [];
        }
        const identity: FederatedIdentity | undefined = await findApiIdentity(loggedIn.user.id);

        expect(identity?.grantedScopes).not.toContain(WRITE_SCOPE);
        expect(await findFailure(authService().resolveProviderAccessToken(loggedIn.user.id, identity?.id ?? '', [WRITE_SCOPE])))
            .toBe(ProviderAccessFailure.MISSING_SCOPES);
        expect(await authService().resolveProviderAccessToken(loggedIn.user.id, identity?.id ?? '', [READ_SCOPE])).toBeTruthy();
    });

    it('refreshes once for two requests at the same time, from a provider that rotates its refresh tokens', async () => {
        const loggedIn: LoggedIn = await logIn(baseUrl);
        await connectApi(loggedIn, newSubject(), { signIn: false, scopes: [READ_SCOPE] });
        const identityId: string = (await findApiIdentity(loggedIn.user.id))?.id ?? '';
        const before: number = countRefreshes();

        const [first, second] = await Promise.all([
            authService().resolveProviderAccessToken(loggedIn.user.id, identityId, [READ_SCOPE]),
            authService().resolveProviderAccessToken(loggedIn.user.id, identityId, [READ_SCOPE])
        ]);
        // the refresh token the provider rotated to is the one kept, so the next refresh works too
        const third: string = await authService().resolveProviderAccessToken(loggedIn.user.id, identityId, [READ_SCOPE]);

        expect(first).toBe(second);
        expect(third).not.toBe(first);
        expect(countRefreshes()).toBe(before + 2);
    });

    it('removes the tokens once the provider refuses the refresh', async () => {
        const loggedIn: LoggedIn = await logIn(baseUrl);
        const subject: string = newSubject();
        await connectApi(loggedIn, subject, { signIn: true, scopes: [READ_SCOPE] });
        const identityId: string = (await findApiIdentity(loggedIn.user.id))?.id ?? '';
        // the user removes the application from their account at the provider
        apiProvider.revokeGrantsOf(subject);

        expect(await findFailure(authService().resolveProviderAccessToken(loggedIn.user.id, identityId, [READ_SCOPE])))
            .toBe(ProviderAccessFailure.REVOKED);
        expect(await findFailure(authService().resolveProviderAccessToken(loggedIn.user.id, identityId, [READ_SCOPE])))
            .toBe(ProviderAccessFailure.NOT_CONNECTED);
        expect(await findApiIdentity(loggedIn.user.id)).toMatchObject({ signIn: true, grantedScopes: [] });
        expect(await auditEvents()).toContainEqual(expect.objectContaining({
            action: AuditAction.PROVIDER_ACCESS_REVOKED,
            outcome: AuditOutcome.SUCCESS,
            userId: loggedIn.user.id
        }));
    });

    it('hands the tokens back when the access is revoked, and keeps an identity that signs in', async () => {
        const loggedIn: LoggedIn = await logIn(baseUrl);
        await connectApi(loggedIn, newSubject(), { signIn: true, scopes: [READ_SCOPE] });
        const identityId: string = (await findApiIdentity(loggedIn.user.id))?.id ?? '';
        const revokedBefore: number = apiProvider.revokedTokens.length;

        await authService().revokeProviderAccess(loggedIn.user.id, identityId, undefined);

        expect(apiProvider.revokedTokens).toHaveLength(revokedBefore + 1);
        expect(await findApiIdentity(loggedIn.user.id)).toMatchObject({ signIn: true, grantedScopes: [] });
        expect(await findFailure(authService().resolveProviderAccessToken(loggedIn.user.id, identityId, [READ_SCOPE])))
            .toBe(ProviderAccessFailure.NOT_CONNECTED);
    });

    it('unlinks an identity connected for apis only when its access is revoked', async () => {
        const loggedIn: LoggedIn = await logIn(baseUrl);
        await connectApi(loggedIn, newSubject(), { signIn: false, scopes: [READ_SCOPE] });
        const identityId: string = (await findApiIdentity(loggedIn.user.id))?.id ?? '';

        await authService().revokeProviderAccess(loggedIn.user.id, identityId, undefined);

        expect(await findApiIdentity(loggedIn.user.id)).toBeUndefined();
        expect(await auditEvents()).toContainEqual(expect.objectContaining({
            action: AuditAction.IDENTITY_UNLINKED,
            outcome: AuditOutcome.SUCCESS,
            userId: loggedIn.user.id
        }));
    });

    it('stops an identity signing in when its sign-in is revoked, and keeps its tokens', async () => {
        const loggedIn: LoggedIn = await logIn(baseUrl);
        await connectApi(loggedIn, newSubject(), { signIn: true, scopes: [READ_SCOPE] });
        const identityId: string = (await findApiIdentity(loggedIn.user.id))?.id ?? '';

        await authService().revokeProviderSignIn(loggedIn.user.id, identityId, undefined);

        expect(await findApiIdentity(loggedIn.user.id)).toMatchObject({ signIn: false, grantedScopes: expect.arrayContaining([READ_SCOPE]) });
        expect(await authService().resolveProviderAccessToken(loggedIn.user.id, identityId, [READ_SCOPE])).toBeTruthy();
        expect((await signIn(
            newBrowser(baseUrl),
            `${baseUrl}/auth/federated/authorize?${new URLSearchParams({ authenticator: 'fake-api', redirectTo: REDIRECT_TO }).toString()}`
        )).landing).toBe(`${ERROR_URL}?error=not_for_sign_in`);
        expect(await auditEvents()).toContainEqual(expect.objectContaining({
            action: AuditAction.IDENTITY_SIGN_IN_REVOKED,
            outcome: AuditOutcome.SUCCESS,
            userId: loggedIn.user.id
        }));
    });

    it('unlinks an identity linked to sign in only when its sign-in is revoked', async () => {
        const loggedIn: LoggedIn = await logIn(baseUrl);
        await connectApi(loggedIn, newSubject(), { signIn: true, scopes: [] });
        const identityId: string = (await findApiIdentity(loggedIn.user.id))?.id ?? '';

        await authService().revokeProviderSignIn(loggedIn.user.id, identityId, undefined);

        expect(await findApiIdentity(loggedIn.user.id)).toBeUndefined();
        expect(await auditEvents()).toContainEqual(expect.objectContaining({
            action: AuditAction.IDENTITY_UNLINKED,
            outcome: AuditOutcome.SUCCESS,
            userId: loggedIn.user.id
        }));
    });

    it('hands the tokens back when the identity is unlinked', async () => {
        const loggedIn: LoggedIn = await logIn(baseUrl);
        await connectApi(loggedIn, newSubject(), { signIn: true, scopes: [READ_SCOPE] });
        const identityId: string = (await findApiIdentity(loggedIn.user.id))?.id ?? '';
        const revokedBefore: number = apiProvider.revokedTokens.length;

        await authService().unlinkIdentity(loggedIn.user.id, identityId, undefined);

        expect(apiProvider.revokedTokens).toHaveLength(revokedBefore + 1);
    });

    it('has no access token for an identity linked to sign in only', async () => {
        const loggedIn: LoggedIn = await logIn(baseUrl);
        await connectApi(loggedIn, newSubject(), { signIn: true, scopes: [] });
        const identityId: string = (await findApiIdentity(loggedIn.user.id))?.id ?? '';

        expect(await findFailure(authService().resolveProviderAccessToken(loggedIn.user.id, identityId, [READ_SCOPE])))
            .toBe(ProviderAccessFailure.NOT_CONNECTED);
    });

    it('keeps the tokens a first sign-in asked for, once the registration links the identity', async () => {
        apiProvider.identity = { subject: newSubject(), email: 'first@example.com' };
        const browser: TestBrowser = newBrowser(baseUrl);
        const { landing } = await signIn(
            browser,
            `${baseUrl}/auth/federated/authorize?${new URLSearchParams({ authenticator: 'fake-api', redirectTo: REDIRECT_TO, scopes: READ_SCOPE }).toString()}`
        );
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const { userId }: { userId: string } = await (await browser.open(`${baseUrl}/register-api`, {
            method: 'POST',
            headers: { [KnownHeader.CONTENT_TYPE]: 'application/json' },
            body: JsonUtilities.stringify({ ticket: new URL(landing).searchParams.get('ticket') })
        })).json();
        const identityId: string = (await findApiIdentity(userId))?.id ?? '';

        expect(await authService().resolveProviderAccessToken(userId, identityId, [READ_SCOPE])).toBeTruthy();
    });
});