import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource, FakeOAuthProvider, InMemoryDataSource, startFakeOAuthProvider, TestBrowser } from 'zibri-testing';

import { BaseGoogleAuthenticator } from './base-google.authenticator';
import { TestTimeouts } from '../../../../__testing__/constants';
import { JwtUser } from '../../../../__testing__/mocks/entities/jwt-user.entity';
import { Roles } from '../../../../__testing__/mocks/entities/roles.enum';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../../../__testing__/test-server/start-test-server.function';
import { Repository } from '../../../../data-source/repository/repository';
import { repositoryTokenFor } from '../../../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../../di/inject.function';
import { defineProvider } from '../../../../di/models/di-provider.model';
import { Controller } from '../../../../routing/decorators/controller.decorator';
import { Newable } from '../../../../types/newable.type';
import { OtpTwoFactorMethod } from '../../../2fa/methods/otp/otp.two-factor-method';
import { AuthController } from '../../../auth-controller/auth-controller.model';
import { CookieAuthRefreshSession } from '../../../strategies/cookie/cookie-auth-refresh-session.model';
import { CookieAuthSession } from '../../../strategies/cookie/cookie-auth-session.model';
import { CookieAuthStrategy } from '../../../strategies/cookie/cookie-auth.auth-strategy';
import { FederatedConnectionCode } from '../../federated/federated-connection-code.model';
import { FederatedHandoverCode } from '../../federated/federated-handover-code.model';
import { FederatedIdentity, FederatedIdentityCreateData } from '../../federated/federated-identity.model';
import { FederatedLoginAttempt } from '../../federated/federated-login-attempt.model';
import { FederatedRegistrationTicket } from '../../federated/federated-registration-ticket.model';
import { OAuthClientAuthentication } from '../../oauth/oauth-client-authentication.model';
import { OAuthProviderTokens } from '../../oauth/oauth-provider-tokens.model';
import { OidcDiscoveryAtBoot } from '../oidc-discovery-at-boot.type';

const PUBLIC_URL: string = 'http://zibri.test';
const CLIENT_ID: string = 'zibri-test-client';
const CLIENT_SECRET: string = 'zibri-test-secret';
const REDIRECT_TO: string = 'https://app.example.com/logged-in';
const CALENDAR_SCOPE: string = 'calendar.readonly';

let google: FakeOAuthProvider;

class GoogleAuthenticator extends BaseGoogleAuthenticator<string, JwtUser> {
    readonly clientId: string = CLIENT_ID;

    readonly discoveryAtBoot: OidcDiscoveryAtBoot = 'required';

    readonly clientAuthentication: OAuthClientAuthentication = { method: 'client_secret_basic', clientSecret: CLIENT_SECRET };

    override readonly apiScopes: string[] = [CALENDAR_SCOPE];

    // Google itself, played by the fake provider, which is running by the time the application builds this
    override readonly issuer: string = google.issuer;
}

@Controller('/auth', { versions: 'all' })
class GoogleAuthController extends AuthController({
        strategies: [CookieAuthStrategy],
        authenticators: [GoogleAuthenticator],
        twoFactorMethods: [OtpTwoFactorMethod]
    }) {}

describe('BaseGoogleAuthenticator', () => {
    let server: StartedTestServer;
    let baseUrl: string;

    beforeAll(async () => {
        // the prompts Google documents, and the only ones it takes; and no word on when the user
        // logged in, since Google puts no auth_time into its ID tokens and takes no max_age
        google = await startFakeOAuthProvider({
            clientId: CLIENT_ID,
            clientSecret: CLIENT_SECRET,
            supportedPrompts: ['none', 'consent', 'select_account'],
            issuesAuthTime: false
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
            repositories: defaultTestServerRepositories,
            allowOrphan: true
        });
        server = await startTestServer({
            baseUrl: PUBLIC_URL,
            dataSources: [dataSourceClass],
            authStrategies: [CookieAuthStrategy],
            authenticators: [GoogleAuthenticator],
            controllers: [GoogleAuthController],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({ token: ZIBRI_DI_TOKENS.COOKIE_SIGN_SECRET, useFactory: () => 'test-cookie-secret' }),
                defineProvider({
                    token: ZIBRI_DI_TOKENS.FEDERATION_OPTIONS,
                    useValue: {
                        allowedRedirects: ['https://app.example.com'],
                        registrationUrl: 'https://app.example.com/register',
                        errorUrl: 'https://app.example.com/login-failed',
                        maxAuthenticationAgeInMs: 3600000
                    }
                })
            ]
        });
        baseUrl = await server.start();
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
        await google?.stop();
    }, TestTimeouts.inMemory.shutdown);

    it('signs a linked user in although Google says nothing about when they logged in, which never counts as a recent login', async () => {
        const user: JwtUser = await inject(repositoryTokenFor(JwtUser)).create({ email: 'ada@example.com', roles: [Roles.USER] });
        await inject<Repository<FederatedIdentity, FederatedIdentityCreateData>>(repositoryTokenFor(FederatedIdentity))
            .create({ issuer: google.issuer, subject: 'google-ada', userId: user.id, forLogin: true, grantedScopes: [] });
        google.identity = { subject: 'google-ada' };
        const browser: TestBrowser = new TestBrowser(baseUrl, PUBLIC_URL);

        const atGoogle: string = await browser.follow(`${PUBLIC_URL}/auth/federated/login/request?${new URLSearchParams({ redirectTo: REDIRECT_TO }).toString()}`);
        const landing: string = await browser.follow(await browser.follow(atGoogle));

        // every login through Google was refused as invalid, since the ID token was required to say
        // when the user logged in, which Google's never does
        expect(landing).toBe(REDIRECT_TO);
        // and Google was asked for max_age, which it does not know
        expect(new URL(atGoogle).searchParams.has('max_age')).toBe(false);
        const sessions: CookieAuthRefreshSession[] = await inject(repositoryTokenFor(CookieAuthRefreshSession)).findAll({ where: { userId: user.id } });
        expect(sessions.map(s => new Date(s.authenticatedAt).getTime())).toStrictEqual([0]);
    });

    it('signs a user in again with a prompt Google takes, which a connection always does', async () => {
        const user: JwtUser = await inject(repositoryTokenFor(JwtUser)).create({ email: 'grace@example.com', roles: [Roles.USER] });
        await inject<Repository<FederatedIdentity, FederatedIdentityCreateData>>(repositoryTokenFor(FederatedIdentity))
            .create({ issuer: google.issuer, subject: 'google-grace', userId: user.id, forLogin: true, grantedScopes: [] });
        google.identity = { subject: 'google-grace' };
        const browser: TestBrowser = new TestBrowser(baseUrl, PUBLIC_URL);

        const atGoogle: string = await browser.follow(
            `${PUBLIC_URL}/auth/federated/login/request?${new URLSearchParams({ redirectTo: REDIRECT_TO, reauthenticate: 'true' }).toString()}`
        );
        const callback: string = await browser.follow(atGoogle);

        expect(new URL(atGoogle).searchParams.get('prompt')).toBe('select_account');
        expect(await browser.follow(callback)).toBe(REDIRECT_TO);
    });

    it('asks Google for a refresh token its own way, adding to what was granted before', async () => {
        const asked: URLSearchParams = new URL(await new TestBrowser(baseUrl, PUBLIC_URL).follow(
            `${PUBLIC_URL}/auth/federated/login/request?${new URLSearchParams({ redirectTo: REDIRECT_TO, reauthenticate: 'true', scopes: CALENDAR_SCOPE }).toString()}`
        )).searchParams;

        expect(asked.get('scope')).toBe(`openid email profile ${CALENDAR_SCOPE}`);
        expect(asked.get('access_type')).toBe('offline');
        expect(asked.get('include_granted_scopes')).toBe('true');
        expect(asked.get('prompt')).toBe('select_account consent');
    });
});