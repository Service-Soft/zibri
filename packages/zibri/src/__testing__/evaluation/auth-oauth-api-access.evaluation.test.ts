import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource, FakeOAuthProvider, InMemoryDataSource, startFakeOAuthProvider, TestBrowser } from 'zibri-testing';

import { OtpTwoFactorMethod } from '../../auth/2fa/methods/otp/otp.two-factor-method';
import { AuthController } from '../../auth/auth-controller/auth-controller.model';
import { FederatedConnectionCode } from '../../auth/authenticators/federated/federated-connection-code.model';
import { FederatedConnectionStart } from '../../auth/authenticators/federated/federated-connection-start.model';
import { FederatedHandoverCode } from '../../auth/authenticators/federated/federated-handover-code.model';
import { FederatedIdentity } from '../../auth/authenticators/federated/federated-identity.model';
import { FederatedLoginAttempt } from '../../auth/authenticators/federated/federated-login-attempt.model';
import { FederatedRegistrationTicket } from '../../auth/authenticators/federated/federated-registration-ticket.model';
import { LinkedIdentity } from '../../auth/authenticators/linked-identity.model';
import { OAuthClientAuthentication } from '../../auth/authenticators/oauth/oauth-client-authentication.model';
import { OAuthProviderTokens } from '../../auth/authenticators/oauth/oauth-provider-tokens.model';
import { BaseOidcAuthenticator } from '../../auth/authenticators/oidc/base-oidc.authenticator';
import { PasswordCredentials, PasswordCredentialsCreateData } from '../../auth/authenticators/password/password-credentials.model';
import { PasswordAuthenticator } from '../../auth/authenticators/password/password.authenticator';
import { Auth } from '../../auth/decorators/auth.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { CookieAuthRefreshSession } from '../../auth/strategies/cookie/cookie-auth-refresh-session.model';
import { CookieAuthSession } from '../../auth/strategies/cookie/cookie-auth-session.model';
import { CookieAuthStrategy } from '../../auth/strategies/cookie/cookie-auth.auth-strategy';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { defineProvider } from '../../di/models/di-provider.model';
import { KnownHeader } from '../../http/known-header.enum';
import { Controller } from '../../routing/decorators/controller.decorator';
import { Get } from '../../routing/decorators/get.decorator';
import { Post } from '../../routing/decorators/post.decorator';
import { Newable } from '../../types/newable.type';
import { JsonUtilities } from '../../utilities/json.utilities';
import { JwtUser } from '../mocks/entities/jwt-user.entity';
import { Roles } from '../mocks/entities/roles.enum';
import { defaultTestServerEntities } from '../test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../test-server/providers';
import { StartedTestServer, startTestServer } from '../test-server/start-test-server.function';

const PUBLIC_URL: string = 'http://zibri.test';
const CLIENT_ID: string = 'zibri-api-client';
const CLIENT_SECRET: string = 'zibri-api-secret';
const CONNECTED_URL: string = 'https://app.example.com/account';
const ERROR_URL: string = 'https://app.example.com/sign-in-failed';
const CALENDAR_SCOPE: string = 'calendar.read';

let provider: FakeOAuthProvider;

class ProviderAuthenticator extends BaseOidcAuthenticator<Roles, JwtUser> {
    readonly name: string = 'company';

    readonly clientId: string = CLIENT_ID;

    readonly clientAuthentication: OAuthClientAuthentication = { method: 'client_secret_basic', clientSecret: CLIENT_SECRET };

    override readonly apiScopes: string[] = [CALENDAR_SCOPE];

    get issuer(): string {
        return provider.issuer;
    }
}

@Controller('/auth', { allowOrphan: true, versions: 'all' })
class EvaluationAuthController extends AuthController({
        strategies: [CookieAuthStrategy],
        authenticators: [PasswordAuthenticator, ProviderAuthenticator],
        twoFactorMethods: [OtpTwoFactorMethod]
    }) {}

@Controller('/account', { allowOrphan: true })
class AccountController {
    // what an application writes: a route of its own that connects the provider for its calendar,
    // without making it a way to sign in
    @Auth.isLoggedIn()
    @Post('/connect-calendar')
    async connectCalendar(): Promise<FederatedConnectionStart> {
        return await inject(ZIBRI_DI_TOKENS.AUTH_SERVICE).startConnection(
            ProviderAuthenticator,
            { redirectTo: CONNECTED_URL, signIn: false, scopes: [CALENDAR_SCOPE] }
        );
    }

    // and one that reads the calendar for the user, with whatever access token is valid by then
    @Auth.isLoggedIn()
    @Get('/calendar')
    async calendar(
        @CurrentUser()
        user: JwtUser
    ): Promise<unknown> {
        const linked: LinkedIdentity[] = await inject(ZIBRI_DI_TOKENS.AUTH_SERVICE).findIdentities(user.id, undefined, [ProviderAuthenticator]);
        const identityId: string | undefined = linked[0]?.identity.id;
        if (identityId == undefined) {
            return undefined;
        }
        const accessToken: string = await inject(ZIBRI_DI_TOKENS.AUTH_SERVICE).resolveProviderAccessToken(user.id, identityId, [CALENDAR_SCOPE]);
        const res: Response = await fetch(`${provider.issuer}/calendar`, { headers: { authorization: `Bearer ${accessToken}` } });
        return await res.json();
    }
}

describe('evaluation/03-auth-and-security H18 - connecting a provider for access to its apis', () => {
    let server: StartedTestServer;
    let baseUrl: string;

    beforeAll(async () => {
        provider = await startFakeOAuthProvider({
            clientId: CLIENT_ID,
            clientSecret: CLIENT_SECRET,
            // shorter than the margin a token is refreshed within, so every use refreshes it
            accessTokenExpiresInSeconds: 30,
            resources: { '/calendar': identity => ({ owner: identity.subject, events: ['standup'] }) }
        });
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
        server = await startTestServer({
            baseUrl: PUBLIC_URL,
            dataSources: [dataSourceClass],
            authStrategies: [CookieAuthStrategy],
            authenticators: [PasswordAuthenticator, ProviderAuthenticator],
            controllers: [EvaluationAuthController, AccountController],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({ token: ZIBRI_DI_TOKENS.COOKIE_SIGN_SECRET, useFactory: () => 'test-cookie-secret' }),
                defineProvider({
                    token: ZIBRI_DI_TOKENS.FEDERATION_OPTIONS,
                    useValue: {
                        allowedRedirects: ['https://app.example.com'],
                        registrationUrl: 'https://app.example.com/register',
                        errorUrl: ERROR_URL,
                        maxAuthenticationAgeInMs: 3600000
                    }
                })
            ]
        });
        baseUrl = await server.start();
    }, 20000);

    afterAll(async () => {
        await server?.shutdown();
        await provider?.stop();
    }, 15000);

    it('keeps the provider\'s tokens for the scopes an application asks for, refreshes them, and signs nobody in with them', async () => {
        const user: JwtUser = await inject(repositoryTokenFor(JwtUser)).create({ email: 'calendar@example.com', roles: [Roles.USER] });
        await inject<Repository<PasswordCredentials, PasswordCredentialsCreateData>>(repositoryTokenFor(PasswordCredentials))
            .create({ password: 'secure123', userId: user.id });
        const browser: TestBrowser = new TestBrowser(baseUrl, PUBLIC_URL);
        const login: Response = await browser.open(`${PUBLIC_URL}/auth/login?authenticator=password`, {
            method: 'POST',
            headers: { [KnownHeader.CONTENT_TYPE]: 'application/json' },
            body: JsonUtilities.stringify({ email: 'calendar@example.com', password: 'secure123' })
        });
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const { csrfToken }: { csrfToken: string } = await login.json();

        // the user connects their calendar from their account page
        provider.identity = { subject: 'calendar-subject' };
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const { url }: { url: string } = await (await browser.open(`${PUBLIC_URL}/account/connect-calendar`, {
            method: 'POST',
            headers: { 'x-csrf-token': csrfToken }
        })).json();
        const atProvider: string = await browser.follow(url);
        expect(new URL(atProvider).searchParams.get('scope')?.split(' ')).toContain(CALENDAR_SCOPE);
        expect(await browser.follow(await browser.follow(atProvider))).toBe(CONNECTED_URL);

        // every access token the provider issues is about to expire, so each read asks for a new one
        const refreshesBefore: number = provider.tokenRequests.filter(body => body.get('grant_type') === 'refresh_token').length;
        const first: Response = await browser.open(`${PUBLIC_URL}/account/calendar`);
        const second: Response = await browser.open(`${PUBLIC_URL}/account/calendar`);
        expect(await first.json()).toStrictEqual({ owner: 'calendar-subject', events: ['standup'] });
        expect(await second.json()).toStrictEqual({ owner: 'calendar-subject', events: ['standup'] });
        expect(provider.tokenRequests.filter(body => body.get('grant_type') === 'refresh_token')).toHaveLength(refreshesBefore + 2);

        // the connection was for the calendar only, so it is no way into the account
        const elsewhere: TestBrowser = new TestBrowser(baseUrl, PUBLIC_URL);
        const landing: string = await elsewhere.follow(await elsewhere.follow(await elsewhere.follow(
            `${PUBLIC_URL}/auth/federated/authorize?${new URLSearchParams({ authenticator: 'company', redirectTo: 'https://app.example.com/home' }).toString()}`
        )));
        expect(landing).toBe(`${ERROR_URL}?error=not_for_sign_in`);
    });
});