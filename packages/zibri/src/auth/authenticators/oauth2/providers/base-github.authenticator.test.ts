import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource, FakeOAuthApiRequest, FakeOAuthProvider, InMemoryDataSource, startFakeOAuthProvider, TestBrowser } from 'zibri-testing';

import { BaseGitHubAuthenticator } from './base-github.authenticator';
import { JwtUser } from '../../../../__testing__/mocks/entities/jwt-user.entity';
import { Roles } from '../../../../__testing__/mocks/entities/roles.enum';
import { defaultTestServerEntities } from '../../../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../../../__testing__/test-server/start-test-server.function';
import { Repository } from '../../../../data-source/repository/repository';
import { repositoryTokenFor } from '../../../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../../di/inject.function';
import { defineProvider } from '../../../../di/models/di-provider.model';
import { KnownHeader } from '../../../../http/known-header.enum';
import { Body } from '../../../../routing/decorators/body.decorator';
import { Controller } from '../../../../routing/decorators/controller.decorator';
import { Post } from '../../../../routing/decorators/post.decorator';
import { Newable } from '../../../../types/newable.type';
import { JsonUtilities } from '../../../../utilities/json.utilities';
import { OtpTwoFactorMethod } from '../../../2fa/methods/otp/otp.two-factor-method';
import { AuthController } from '../../../auth-controller/auth-controller.model';
import { Auth } from '../../../decorators/auth.decorator';
import { CookieAuthRefreshSession } from '../../../strategies/cookie/cookie-auth-refresh-session.model';
import { CookieAuthSession } from '../../../strategies/cookie/cookie-auth-session.model';
import { CookieAuthStrategy } from '../../../strategies/cookie/cookie-auth.auth-strategy';
import { FederatedConnectionCode } from '../../federated/federated-connection-code.model';
import { FederatedTicketCredentials } from '../../federated/federated-credentials.model';
import { FederatedHandoverCode } from '../../federated/federated-handover-code.model';
import { FederatedIdentity, FederatedIdentityCreateData } from '../../federated/federated-identity.model';
import { FederatedLoginAttempt } from '../../federated/federated-login-attempt.model';
import { FederatedRegistrationTicket } from '../../federated/federated-registration-ticket.model';
import { FederatedRegistration } from '../../federated/federated-registration.model';
import { OAuthClientAuthentication } from '../../oauth/oauth-client-authentication.model';
import { OAuthProviderTokens } from '../../oauth/oauth-provider-tokens.model';

const PUBLIC_URL: string = 'http://zibri.test';
const CLIENT_ID: string = 'zibri-github-client';
const CLIENT_SECRET: string = 'zibri-github-secret';
const REDIRECT_TO: string = 'https://app.example.com/signed-in';
const REGISTRATION_URL: string = 'https://app.example.com/register';

let github: FakeOAuthProvider;

class GitHubAuthenticator extends BaseGitHubAuthenticator<Roles, JwtUser> {
    readonly clientId: string = CLIENT_ID;

    readonly clientAuthentication: OAuthClientAuthentication = { method: 'client_secret_basic', clientSecret: CLIENT_SECRET };

    // GitHub itself, played by the fake provider, which is running by the time the application builds this
    override readonly issuer: string = github.issuer;

    override readonly authorizationEndpoint: string = `${github.issuer}/authorize`;

    override readonly tokenEndpoint: string = `${github.issuer}/token`;

    override readonly apiUrl: string = github.issuer;

    override readonly apiScopes: string[] = ['repo'];
}

@Auth.skip({ allowRedundant: true })
@Controller('/auth', { versions: 'all' })
class GitHubAuthController extends AuthController({
        strategies: [CookieAuthStrategy],
        authenticators: [GitHubAuthenticator],
        twoFactorMethods: [OtpTwoFactorMethod]
    }) {}

@Controller('/register', { allowOrphan: true })
class ProfileController {
    // what a registration reads before it creates the user
    @Post('/profile')
    async profile(
        @Body(FederatedTicketCredentials)
        credentials: FederatedTicketCredentials
    ): Promise<FederatedRegistration> {
        return await inject(ZIBRI_DI_TOKENS.AUTH_SERVICE).resolveRegistration(GitHubAuthenticator, credentials, undefined);
    }
}

describe('BaseGitHubAuthenticator', () => {
    let server: StartedTestServer;
    let baseUrl: string;

    beforeAll(async () => {
        // GitHub's api as it answers: the user with a numeric id and one name, and the emails apart. It
        // sends null for what is not set, which the authenticator has to read as nothing
        /* eslint-disable unicorn/no-null */
        github = await startFakeOAuthProvider({
            clientId: CLIENT_ID,
            clientSecret: CLIENT_SECRET,
            issuesIdToken: false,
            resources: {
                '/user': identity => ({ id: Number(identity.subject), login: 'the-login', name: identity.name ?? null, email: null }),
                '/user/emails': identity => [
                    { email: 'old@example.com', primary: false, verified: true, visibility: null },
                    { email: identity.email, primary: true, verified: identity.emailVerified === true, visibility: 'private' }
                ]
            }
        });
        /* eslint-enable unicorn/no-null */
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
            authenticators: [GitHubAuthenticator],
            controllers: [GitHubAuthController, ProfileController],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({ token: ZIBRI_DI_TOKENS.COOKIE_SIGN_SECRET, useFactory: () => 'test-cookie-secret' }),
                defineProvider({
                    token: ZIBRI_DI_TOKENS.FEDERATION_OPTIONS,
                    useValue: {
                        allowedRedirects: ['https://app.example.com'],
                        registrationUrl: REGISTRATION_URL,
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
        await github?.stop();
    }, 15000);

    const authorizeUrl: (query?: Record<string, string>) => string = query => `${PUBLIC_URL}/auth/federated/authorize?${new URLSearchParams({ redirectTo: REDIRECT_TO, ...query }).toString()}`;

    it('asks for the user and their emails, and has the user pick the account when signing in again', async () => {
        const asked: URLSearchParams = new URL(await new TestBrowser(baseUrl, PUBLIC_URL).follow(authorizeUrl({ reauthenticate: 'true' }))).searchParams;

        expect(asked.get('scope')).toBe('read:user user:email');
        expect(asked.get('prompt')).toBe('select_account');
    });

    it('signs in the user linked to the id of the GitHub account', async () => {
        const user: JwtUser = await inject(repositoryTokenFor(JwtUser)).create({ email: 'octocat@example.com', roles: [Roles.USER] });
        await inject<Repository<FederatedIdentity, FederatedIdentityCreateData>>(repositoryTokenFor(FederatedIdentity))
            .create({ issuer: github.issuer, subject: '583231', userId: user.id, signIn: true, grantedScopes: [] });
        github.identity = { subject: '583231', email: 'octocat@example.com', emailVerified: true };
        const browser: TestBrowser = new TestBrowser(baseUrl, PUBLIC_URL);

        const landing: string = await browser.follow(await browser.follow(await browser.follow(authorizeUrl())));

        expect(landing).toBe(REDIRECT_TO);
        expect((await browser.open(`${baseUrl}/auth/csrf-token`)).status).toBe(200);
    });

    it('registers a new user with the primary email of the account and its name', async () => {
        github.identity = { subject: '1024', email: 'mona@example.com', emailVerified: true, name: 'Mona Lisa' };
        const browser: TestBrowser = new TestBrowser(baseUrl, PUBLIC_URL);

        const landing: string = await browser.follow(await browser.follow(await browser.follow(authorizeUrl())));
        expect(landing.startsWith(`${REGISTRATION_URL}?ticket=`)).toBe(true);
        const res: Response = await browser.open(`${baseUrl}/register/profile`, {
            method: 'POST',
            headers: { [KnownHeader.CONTENT_TYPE]: 'application/json' },
            body: JsonUtilities.stringify({ ticket: new URL(landing).searchParams.get('ticket') })
        });

        // eslint-disable-next-line typescript/no-unsafe-assignment
        const registration: FederatedRegistration = await res.json();
        expect(registration).toMatchObject({
            provider: 'github',
            subject: '1024',
            email: 'mona@example.com',
            emailVerified: true,
            name: 'Mona Lisa'
        });
        expect(registration.givenName).toBeUndefined();
    });

    it('reports the primary email as unverified when GitHub has not verified it', async () => {
        github.identity = { subject: '2048', email: 'unverified@example.com', emailVerified: false };
        const browser: TestBrowser = new TestBrowser(baseUrl, PUBLIC_URL);

        const landing: string = await browser.follow(await browser.follow(await browser.follow(authorizeUrl())));
        const res: Response = await browser.open(`${baseUrl}/register/profile`, {
            method: 'POST',
            headers: { [KnownHeader.CONTENT_TYPE]: 'application/json' },
            body: JsonUtilities.stringify({ ticket: new URL(landing).searchParams.get('ticket') })
        });

        // eslint-disable-next-line typescript/no-unsafe-assignment
        const registration: FederatedRegistration = await res.json();
        expect(registration).toMatchObject({ email: 'unverified@example.com', emailVerified: false });
    });

    it('withdraws the grant of the OAuth app through GitHub\'s api when the access is revoked', async () => {
        const user: JwtUser = await inject(repositoryTokenFor(JwtUser)).create({ email: 'hubot@example.com', roles: [Roles.USER] });
        await inject<Repository<FederatedIdentity, FederatedIdentityCreateData>>(repositoryTokenFor(FederatedIdentity))
            .create({ issuer: github.issuer, subject: '4096', userId: user.id, signIn: true, grantedScopes: [] });
        github.identity = { subject: '4096', email: 'hubot@example.com', emailVerified: true };
        const browser: TestBrowser = new TestBrowser(baseUrl, PUBLIC_URL);
        await browser.follow(await browser.follow(await browser.follow(authorizeUrl({ scopes: 'repo' }))));
        const [linked] = await inject(ZIBRI_DI_TOKENS.AUTH_SERVICE).findIdentities(user.id, undefined, [GitHubAuthenticator]);

        await inject(ZIBRI_DI_TOKENS.AUTH_SERVICE).revokeProviderAccess(user.id, linked?.identity.id ?? '', undefined);

        const withdrawn: FakeOAuthApiRequest | undefined = github.apiRequests.find(request => request.method === 'DELETE');
        const credentials: string = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
        expect(withdrawn).toMatchObject({ path: `/applications/${CLIENT_ID}/grant`, authorization: `Basic ${credentials}` });
        expect(JsonUtilities.parse<unknown>(withdrawn?.body ?? '')).toStrictEqual({ access_token: expect.any(String) });
    });
});