import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInMemoryDataSource, FakeOAuthProvider, InMemoryDataSource, startFakeOAuthProvider, TestBrowser } from 'zibri-testing';

import { OtpTwoFactorMethod } from '../../auth/2fa/methods/otp/otp.two-factor-method.ts';
import { AuthController } from '../../auth/auth-controller/auth-controller.model.ts';
import { FederatedConnectionCode } from '../../auth/authenticators/federated/federated-connection-code.model.ts';
import { FederatedHandoverCode } from '../../auth/authenticators/federated/federated-handover-code.model.ts';
import { FederatedIdentity } from '../../auth/authenticators/federated/federated-identity.model.ts';
import { FederatedLoginAttempt } from '../../auth/authenticators/federated/federated-login-attempt.model.ts';
import { FederatedRegistrationTicket } from '../../auth/authenticators/federated/federated-registration-ticket.model.ts';
import { OAuthClientAuthentication } from '../../auth/authenticators/oauth/oauth-client-authentication.model.ts';
import { BaseOidcAuthenticator } from '../../auth/authenticators/oidc/base-oidc.authenticator.ts';
import { PasswordCredentials, PasswordCredentialsCreateData } from '../../auth/authenticators/password/password-credentials.model.ts';
import { PasswordAuthenticator } from '../../auth/authenticators/password/password.authenticator.ts';
import { Auth } from '../../auth/decorators/auth.decorator.ts';
import { CookieAuthRefreshSession } from '../../auth/strategies/cookie/cookie-auth-refresh-session.model.ts';
import { CookieAuthSession } from '../../auth/strategies/cookie/cookie-auth-session.model.ts';
import { CookieAuthStrategy } from '../../auth/strategies/cookie/cookie-auth.auth-strategy.ts';
import { Repository } from '../../data-source/repository/repository.ts';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../di/inject.function.ts';
import { defineProvider } from '../../di/models/di-provider.model.ts';
import { Property } from '../../entity/decorators/property.decorator.ts';
import { KnownHeader } from '../../http/known-header.enum.ts';
import { Body } from '../../routing/decorators/body.decorator.ts';
import { Controller } from '../../routing/decorators/controller.decorator.ts';
import { Post } from '../../routing/decorators/post.decorator.ts';
import { Newable } from '../../types/newable.type.ts';
import { JsonUtilities } from '../../utilities/json.utilities.ts';
import { JwtUser } from '../mocks/entities/jwt-user.entity.ts';
import { Roles } from '../mocks/entities/roles.enum.ts';
import { defaultTestServerEntities } from '../test-server/create-test-data-source.function.ts';
import { defaultTestServerProviders } from '../test-server/providers.ts';
import { StartedTestServer, startTestServer } from '../test-server/start-test-server.function.ts';

const PUBLIC_URL: string = 'http://zibri.test';
const CLIENT_ID: string = 'zibri-connect-client';
const CLIENT_SECRET: string = 'zibri-connect-secret';
const CONNECTED_URL: string = 'https://app.example.com/account';

let provider: FakeOAuthProvider;

class ProviderAuthenticator extends BaseOidcAuthenticator<Roles, JwtUser> {
    readonly name: string = 'company';

    readonly clientId: string = CLIENT_ID;

    readonly clientAuthentication: OAuthClientAuthentication = { method: 'client_secret_basic', clientSecret: CLIENT_SECRET };

    get issuer(): string {
        return provider.issuer;
    }
}

class ConnectionInput {
    @Property.string()
    redirectTo!: string;
}

@Controller('/auth', { allowOrphan: true, versions: 'all' })
class EvaluationAuthController extends AuthController({
        strategies: [CookieAuthStrategy],
        authenticators: [PasswordAuthenticator, ProviderAuthenticator],
        twoFactorMethods: [OtpTwoFactorMethod]
    }) {}

@Controller('/account', { allowOrphan: true })
class AccountController {
    // what an application writes: a route of its own, guarded however it decides, that answers with
    // where the browser goes to connect the provider
    @Auth.isLoggedIn()
    @Post('/connect')
    async connect(
        @Body(ConnectionInput)
        input: ConnectionInput
    ): Promise<{ url: string }> {
        return {
            url: (await inject(ZIBRI_DI_TOKENS.AUTH_SERVICE).startConnection(ProviderAuthenticator, { redirectTo: input.redirectTo, signIn: true })).url
        };
    }
}

describe('evaluation/03-auth-and-security H16 - adding an identity provider to an account that already exists', () => {
    let server: StartedTestServer;
    let baseUrl: string;

    beforeAll(async () => {
        provider = await startFakeOAuthProvider({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
        const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
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
                        errorUrl: 'https://app.example.com/sign-in-failed',
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

    it('connects a provider to the account of a user logged in with their password, which then signs them in', async () => {
        const user: JwtUser = await inject(repositoryTokenFor(JwtUser)).create({ email: 'connect@example.com', roles: [Roles.USER] });
        await inject<Repository<PasswordCredentials, PasswordCredentialsCreateData>>(repositoryTokenFor(PasswordCredentials))
            .create({ password: 'secure123', userId: user.id });
        const browser: TestBrowser = new TestBrowser(baseUrl, PUBLIC_URL);
        const login: Response = await browser.open(`${PUBLIC_URL}/auth/login?authenticator=password`, {
            method: 'POST',
            headers: { [KnownHeader.CONTENT_TYPE]: 'application/json' },
            body: JsonUtilities.stringify({ email: 'connect@example.com', password: 'secure123' })
        });
        expect(login.status).toBe(200);
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const { csrfToken }: { csrfToken: string } = await login.json();

        // the user connects the provider from their account page
        provider.identity = { subject: 'connected-subject', email: 'someone-else@example.com' };
        const started: Response = await browser.open(`${PUBLIC_URL}/account/connect`, {
            method: 'POST',
            headers: { [KnownHeader.CONTENT_TYPE]: 'application/json', 'x-csrf-token': csrfToken },
            body: JsonUtilities.stringify({ redirectTo: CONNECTED_URL })
        });
        expect(started.status).toBe(200);
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const { url }: { url: string } = await started.json();
        const atProvider: string = await browser.follow(url);
        const callback: string = await browser.follow(atProvider);
        expect(await browser.follow(callback)).toBe(CONNECTED_URL);

        // a sign-in through the provider in another browser now logs in as that user, though the
        // provider reports another email
        const elsewhere: TestBrowser = new TestBrowser(baseUrl, PUBLIC_URL);
        const signedIn: string = await elsewhere.follow(await elsewhere.follow(await elsewhere.follow(
            `${PUBLIC_URL}/auth/federated/authorize?${new URLSearchParams({ authenticator: 'company', redirectTo: 'https://app.example.com/home' }).toString()}`
        )));
        expect(signedIn).toBe('https://app.example.com/home');
        const sessions: CookieAuthRefreshSession[] = await inject(repositoryTokenFor(CookieAuthRefreshSession))
            .findAll({ where: { userId: user.id } });
        expect(sessions).toHaveLength(2);
    });
});