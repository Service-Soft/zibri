import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource, FakeOAuthProvider, InMemoryDataSource, startFakeOAuthProvider, TestBrowser } from 'zibri-testing';

import { OtpTwoFactorMethod } from '../../auth/2fa/methods/otp/otp.two-factor-method';
import { AuthController } from '../../auth/auth-controller/auth-controller.model';
import { FederatedConnectionCode } from '../../auth/authenticators/federated/federated-connection-code.model';
import { FederatedHandoverCode } from '../../auth/authenticators/federated/federated-handover-code.model';
import { FederatedIdentity, FederatedIdentityCreateData } from '../../auth/authenticators/federated/federated-identity.model';
import { FederatedLoginAttempt } from '../../auth/authenticators/federated/federated-login-attempt.model';
import { FederatedProviderIdentity } from '../../auth/authenticators/federated/federated-provider-identity.model';
import { FederatedRegistrationTicket } from '../../auth/authenticators/federated/federated-registration-ticket.model';
import { OAuthClientAuthentication } from '../../auth/authenticators/oauth/oauth-client-authentication.model';
import { BaseOAuth2Authenticator } from '../../auth/authenticators/oauth2/base-oauth2.authenticator';
import { CookieAuthRefreshSession } from '../../auth/strategies/cookie/cookie-auth-refresh-session.model';
import { CookieAuthSession } from '../../auth/strategies/cookie/cookie-auth-session.model';
import { CookieAuthStrategy } from '../../auth/strategies/cookie/cookie-auth.auth-strategy';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { defineProvider } from '../../di/models/di-provider.model';
import { Controller } from '../../routing/decorators/controller.decorator';
import { Newable } from '../../types/newable.type';
import { JwtUser } from '../mocks/entities/jwt-user.entity';
import { Roles } from '../mocks/entities/roles.enum';
import { defaultTestServerEntities } from '../test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../test-server/providers';
import { StartedTestServer, startTestServer } from '../test-server/start-test-server.function';

const PUBLIC_URL: string = 'http://zibri.test';
const CLIENT_ID: string = 'zibri-oauth2-client';
const CLIENT_SECRET: string = 'zibri-oauth2-secret';
const REDIRECT_TO: string = 'https://app.example.com/signed-in';

let provider: FakeOAuthProvider;

class PlainOAuth2Authenticator extends BaseOAuth2Authenticator<Roles, JwtUser> {
    readonly name: string = 'plain';

    readonly clientId: string = CLIENT_ID;

    readonly clientAuthentication: OAuthClientAuthentication = { method: 'client_secret_basic', clientSecret: CLIENT_SECRET };

    readonly scopes: string[] = ['user'];

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
        const user: unknown = await this.fetchJson(`${provider.issuer}/user`, accessToken);
        const id: unknown = typeof user === 'object' && user != undefined && 'id' in user ? user.id : undefined;
        if (typeof id !== 'string') {
            throw new Error('The provider answered without the id of the user.');
        }
        return { subject: id, profile: { email: undefined, emailVerified: undefined, name: undefined, givenName: undefined, familyName: undefined } };
    }
}

@Controller('/auth', { allowOrphan: true, versions: 'all' })
class EvaluationAuthController extends AuthController({
        strategies: [CookieAuthStrategy],
        authenticators: [PlainOAuth2Authenticator],
        twoFactorMethods: [OtpTwoFactorMethod]
    }) {}

describe('evaluation/03-auth-and-security H15 - a provider that speaks plain OAuth2', () => {
    let server: StartedTestServer;
    let baseUrl: string;

    beforeAll(async () => {
        // a provider without OpenID Connect: no ID token, and who signed in is read from its api
        provider = await startFakeOAuthProvider({
            clientId: CLIENT_ID,
            clientSecret: CLIENT_SECRET,
            issuesIdToken: false,
            resources: { '/user': identity => ({ id: identity.subject }) }
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
                FederatedConnectionCode
            ],
            allowOrphan: true
        });
        server = await startTestServer({
            baseUrl: PUBLIC_URL,
            dataSources: [dataSourceClass],
            authStrategies: [CookieAuthStrategy],
            authenticators: [PlainOAuth2Authenticator],
            controllers: [EvaluationAuthController],
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

    it('signs a linked user in, though the provider issues no ID token', async () => {
        const user: JwtUser = await inject(repositoryTokenFor(JwtUser)).create({ email: 'oauth2@example.com', roles: [Roles.USER] });
        await inject<Repository<FederatedIdentity, FederatedIdentityCreateData>>(repositoryTokenFor(FederatedIdentity))
            .create({ issuer: provider.issuer, subject: 'plain-subject', userId: user.id, signIn: true, grantedScopes: [] });
        provider.identity = { subject: 'plain-subject' };
        const browser: TestBrowser = new TestBrowser(baseUrl, PUBLIC_URL);

        const atProvider: string = await browser.follow(
            `${PUBLIC_URL}/auth/federated/authorize?${new URLSearchParams({ redirectTo: REDIRECT_TO }).toString()}`
        );
        const landing: string = await browser.follow(await browser.follow(atProvider));

        expect(landing).toBe(REDIRECT_TO);
        expect((await browser.open(`${baseUrl}/auth/csrf-token`)).status).toBe(200);
    });
});