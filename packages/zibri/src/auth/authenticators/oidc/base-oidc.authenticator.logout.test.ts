import { randomBytes } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource, FakeOAuthProvider, startFakeOAuthProvider, TestBrowser } from 'zibri-testing';

import { BaseOidcAuthenticator } from './base-oidc.authenticator';
import { OidcAuthenticationTime } from './oidc-authentication-time.type';
import { TestTimeouts } from '../../../__testing__/constants';
import { JwtUser } from '../../../__testing__/mocks/entities/jwt-user.entity';
import { Roles } from '../../../__testing__/mocks/entities/roles.enum';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { Repository } from '../../../data-source/repository/repository';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { defineProvider } from '../../../di/models/di-provider.model';
import { KnownHeader } from '../../../http/known-header.enum';
import { MimeType } from '../../../http/mime-type.enum';
import { Controller } from '../../../routing/decorators/controller.decorator';
import { JsonUtilities } from '../../../utilities/json.utilities';
import { OtpTwoFactorMethod } from '../../2fa/methods/otp/otp.two-factor-method';
import { AuthController } from '../../auth-controller/auth-controller.model';
import { LogoutResult } from '../../models/logout-result.model';
import { CookieAuthData } from '../../strategies/cookie/cookie-auth-data.model';
import { CookieAuthRefreshSession } from '../../strategies/cookie/cookie-auth-refresh-session.model';
import { CookieAuthSession } from '../../strategies/cookie/cookie-auth-session.model';
import { CookieAuthStrategy } from '../../strategies/cookie/cookie-auth.auth-strategy';
import { FederatedConnectionCode } from '../federated/federated-connection-code.model';
import { FederatedHandoverCode } from '../federated/federated-handover-code.model';
import { FederatedIdentity, FederatedIdentityCreateData } from '../federated/federated-identity.model';
import { FederatedLoginAttempt } from '../federated/federated-login-attempt.model';
import { FederatedRegistrationTicket } from '../federated/federated-registration-ticket.model';
import { OAuthClientAuthentication } from '../oauth/oauth-client-authentication.model';

const PUBLIC_URL: string = 'http://zibri.test';
const CLIENT_ID: string = 'zibri-test-client';
const CLIENT_SECRET: string = 'zibri-test-secret';
const REDIRECT_TO: string = 'https://app.example.com/signed-in';
const SIGNED_OUT_URL: string = 'https://app.example.com/signed-out';
const LOGOUT_ROUTE: string = `${PUBLIC_URL}/auth/federated/fake/logout`;

let provider: FakeOAuthProvider;
let otherProvider: FakeOAuthProvider;

class FakeProviderAuthenticator extends BaseOidcAuthenticator<string, JwtUser> {
    readonly name: string = 'fake';

    readonly clientId: string = CLIENT_ID;

    readonly clientAuthentication: OAuthClientAuthentication = { method: 'client_secret_basic', clientSecret: CLIENT_SECRET };

    readonly authenticationTime: OidcAuthenticationTime = 'auth_time';

    get issuer(): string {
        return provider.issuer;
    }
}

@Controller('/auth', { allowOrphan: true, versions: 'all' })
class LogoutAuthController extends AuthController({
        strategies: [CookieAuthStrategy],
        authenticators: [FakeProviderAuthenticator],
        twoFactorMethods: [OtpTwoFactorMethod]
    }) {}

let server: StartedTestServer;
let baseUrl: string;

/**
 * A browser on the application, which resolves its public url to where the server listens.
 * @returns The browser.
 */
function newBrowser(): TestBrowser {
    return new TestBrowser(baseUrl, PUBLIC_URL);
}

/**
 * Signs a browser in at the provider as a linked user, the way a browser does.
 * @param browser - The browser.
 * @returns The id of the session the sign-in started at the provider.
 */
async function signIn(browser: TestBrowser): Promise<string> {
    const query: string = new URLSearchParams({ authenticator: 'fake', redirectTo: REDIRECT_TO }).toString();
    const atProvider: string = await browser.follow(`${baseUrl}/auth/federated/authorize?${query}`);
    expect(await browser.follow(await browser.follow(atProvider))).toBe(REDIRECT_TO);
    return provider.sessionIds.at(-1) ?? '';
}

/**
 * Whether a browser holds a login, which only a session answers the csrf token to.
 * @param browser - The browser.
 * @returns True when it is logged in.
 */
async function isLoggedIn(browser: TestBrowser): Promise<boolean> {
    return (await browser.open(`${baseUrl}/auth/csrf-token`)).status === 200;
}

/**
 * Creates a user linked to a fresh identity at the provider, which signs in as them from now on.
 * @returns The user.
 */
async function createLinkedUser(): Promise<JwtUser> {
    const subject: string = `subject-${randomBytes(6).toString('hex')}`;
    const user: JwtUser = await inject(repositoryTokenFor(JwtUser)).create({ email: `${subject}@example.com`, roles: [Roles.USER] });
    await inject<Repository<FederatedIdentity, FederatedIdentityCreateData>>(repositoryTokenFor(FederatedIdentity))
        .create({ issuer: provider.issuer, subject, userId: user.id, signIn: true, grantedScopes: [] });
    provider.identity = { subject, email: user.email };
    return user;
}

/**
 * Posts a logout token to the back-channel logout route, the way the provider does.
 * @param token - The token.
 * @returns The status.
 */
async function postLogoutToken(token: string): Promise<number> {
    const res: Response = await fetch(`${baseUrl}/auth/federated/fake/logout/back-channel`, {
        method: 'POST',
        headers: { [KnownHeader.CONTENT_TYPE]: MimeType.FORM_URL_ENCODED },
        body: new URLSearchParams({ logout_token: token })
    });
    return res.status;
}

/**
 * Logs a browser out the way the frontend does, with the cookies of its login.
 * @param browser - The browser.
 * @returns What the logout answers.
 */
async function logOut(browser: TestBrowser): Promise<LogoutResult> {
    const res: Response = await browser.open(`${baseUrl}/auth/logout`, {
        method: 'POST',
        headers: { [KnownHeader.CONTENT_TYPE]: MimeType.JSON },
        body: JsonUtilities.stringify({ clearCookies: true })
    });
    expect(res.status).toBe(200);
    return await res.json() as LogoutResult;
}

/**
 * Refreshes the login of a browser the way the frontend does once its access session ran out, which
 * rotates it.
 * @param browser - The browser.
 * @param userId - The user it is logged in as, whose only login it is.
 */
async function rotateLogin(browser: TestBrowser, userId: string): Promise<void> {
    const { csrfToken }: Pick<CookieAuthData<string>, 'csrfToken'> = await (await browser.open(`${baseUrl}/auth/csrf-token`)).json() as CookieAuthData<string>;
    await inject(repositoryTokenFor(CookieAuthSession)).updateAll({ userId }, { expirationDate: new Date(Date.now() - 1000) });
    const res: Response = await browser.open(`${baseUrl}/auth/refresh-login`, {
        method: 'POST',
        headers: { [KnownHeader.CONTENT_TYPE]: MimeType.JSON, 'x-csrf-token': csrfToken },
        body: '{}'
    });
    expect(res.status).toBe(200);
}

describe('BaseOidcAuthenticator - logging out', () => {
    beforeAll(async () => {
        provider = await startFakeOAuthProvider({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
        otherProvider = await startFakeOAuthProvider({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
        server = await startTestServer({
            baseUrl: PUBLIC_URL,
            dataSources: [
                createInMemoryDataSource({
                    entities: [
                        ...defaultTestServerEntities,
                        CookieAuthSession,
                        CookieAuthRefreshSession,
                        FederatedLoginAttempt,
                        FederatedIdentity,
                        FederatedHandoverCode,
                        FederatedRegistrationTicket,
                        FederatedConnectionCode
                    ],
                    repositories: defaultTestServerRepositories,
                    allowOrphan: true
                })
            ],
            authStrategies: [CookieAuthStrategy],
            authenticators: [FakeProviderAuthenticator],
            controllers: [LogoutAuthController],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({ token: ZIBRI_DI_TOKENS.COOKIE_SIGN_SECRET, useFactory: () => 'test-cookie-secret' }),
                defineProvider({
                    token: ZIBRI_DI_TOKENS.FEDERATION_OPTIONS,
                    useValue: {
                        allowedRedirects: ['https://app.example.com'],
                        registrationUrl: 'https://app.example.com/register',
                        errorUrl: 'https://app.example.com/sign-in-failed',
                        signedOutUrl: SIGNED_OUT_URL,
                        maxAuthenticationAgeInMs: 3600000
                    }
                })
            ]
        });
        baseUrl = await server.start();
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
        await provider?.stop();
        await otherProvider?.stop();
    }, TestTimeouts.inMemory.shutdown);

    it('answers where to log out at the provider, with the ID token of the login and the way back, and lands on the signed-out page', async () => {
        await createLinkedUser();
        const browser: TestBrowser = newBrowser();
        await signIn(browser);

        const { providerLogoutUrl } = await logOut(browser);

        expect(providerLogoutUrl?.startsWith(`${provider.issuer}/end-session?`)).toBe(true);
        const asked: URLSearchParams = new URL(providerLogoutUrl ?? '').searchParams;
        expect(asked.get('id_token_hint')).toMatch(/^(?:[\w-]+\.){2}[\w-]+$/);
        expect(asked.get('client_id')).toBe(CLIENT_ID);
        expect(asked.get('post_logout_redirect_uri')).toBe(LOGOUT_ROUTE);
        // the provider ends its session and sends the browser back, which lands on the signed-out page
        const back: string = await browser.follow(providerLogoutUrl ?? '');
        expect(back).toBe(LOGOUT_ROUTE);
        expect(await browser.follow(back)).toBe(SIGNED_OUT_URL);
    });

    it('ends exactly the login of the session a logout token names, refreshed or not', async () => {
        const user: JwtUser = await createLinkedUser();
        const loggedOut: TestBrowser = newBrowser();
        const sessionId: string = await signIn(loggedOut);
        await rotateLogin(loggedOut, user.id);
        const stillIn: TestBrowser = newBrowser();
        await signIn(stillIn);

        expect(await postLogoutToken(provider.createLogoutToken({ sessionId }))).toBe(204);

        expect(await isLoggedIn(loggedOut)).toBe(false);
        expect(await isLoggedIn(stillIn)).toBe(true);
    });

    it('ends every login of the user a logout token names without a session, and nobody else\'s', async () => {
        await createLinkedUser();
        const somebodyElse: TestBrowser = newBrowser();
        await signIn(somebodyElse);
        const user: JwtUser = await createLinkedUser();
        const first: TestBrowser = newBrowser();
        await signIn(first);
        const second: TestBrowser = newBrowser();
        await signIn(second);
        const subject: string = provider.identity.subject;

        expect(await postLogoutToken(provider.createLogoutToken({ subject }))).toBe(204);

        expect(await isLoggedIn(first)).toBe(false);
        expect(await isLoggedIn(second)).toBe(false);
        expect(await isLoggedIn(somebodyElse)).toBe(true);
        void user;
    });

    it('refuses a logout token another provider signed, one without the event, one with a nonce, one naming nobody, and one presented before', async () => {
        await createLinkedUser();
        const browser: TestBrowser = newBrowser();
        const sessionId: string = await signIn(browser);
        otherProvider.identity = provider.identity;

        expect(await postLogoutToken(otherProvider.createLogoutToken({ sessionId, claims: { iss: provider.issuer } }))).toBe(401);
        expect(await postLogoutToken(provider.createLogoutToken({ sessionId, claims: { events: {} } }))).toBe(401);
        expect(await postLogoutToken(provider.createLogoutToken({ sessionId, claims: { nonce: 'n' } }))).toBe(401);
        expect(await postLogoutToken(provider.createLogoutToken({}))).toBe(401);
        expect(await isLoggedIn(browser)).toBe(true);

        const token: string = provider.createLogoutToken({ sessionId });
        expect(await postLogoutToken(token)).toBe(204);
        expect(await postLogoutToken(token)).toBe(401);
    });

    it('ends the login of the session a front-channel logout names, and refuses one naming another provider or no session', async () => {
        await createLinkedUser();
        const browser: TestBrowser = newBrowser();
        const sessionId: string = await signIn(browser);

        // loaded in a frame of the provider's logout page, in whichever browser the user logged out at
        const landing: string = await newBrowser().follow(`${LOGOUT_ROUTE}?${new URLSearchParams({ iss: provider.issuer, sid: sessionId }).toString()}`);

        expect(landing).toBe(SIGNED_OUT_URL);
        expect(await isLoggedIn(browser)).toBe(false);

        const other: TestBrowser = newBrowser();
        const otherSessionId: string = await signIn(other);
        const elsewhere: Response = await newBrowser().open(`${LOGOUT_ROUTE}?${new URLSearchParams({ iss: otherProvider.issuer, sid: otherSessionId }).toString()}`);
        expect(elsewhere.status).toBe(400);
        const nobody: Response = await newBrowser().open(`${LOGOUT_ROUTE}?${new URLSearchParams({ iss: provider.issuer }).toString()}`);
        expect(nobody.status).toBe(400);
        expect(await isLoggedIn(other)).toBe(true);
    });
});