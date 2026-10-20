import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInMemoryDataSource, FakeOAuthProvider, InMemoryDataSource, startFakeOAuthProvider, TestBrowser } from 'zibri-testing';

import { OtpTwoFactorMethod } from '../../auth/2fa/methods/otp/otp.two-factor-method.ts';
import { AuthController } from '../../auth/auth-controller/auth-controller.model.ts';
import { FederatedConnectionCode } from '../../auth/authenticators/federated/federated-connection-code.model.ts';
import { FederatedHandoverCode } from '../../auth/authenticators/federated/federated-handover-code.model.ts';
import { FederatedIdentity, FederatedIdentityCreateData } from '../../auth/authenticators/federated/federated-identity.model.ts';
import { FederatedLoginAttempt } from '../../auth/authenticators/federated/federated-login-attempt.model.ts';
import { FederatedRegistrationTicket } from '../../auth/authenticators/federated/federated-registration-ticket.model.ts';
import { OAuthClientAuthentication } from '../../auth/authenticators/oauth/oauth-client-authentication.model.ts';
import { OAuthResponseMode } from '../../auth/authenticators/oauth/oauth-response-mode.type.ts';
import { BaseOidcAuthenticator } from '../../auth/authenticators/oidc/base-oidc.authenticator.ts';
import { CookieAuthRefreshSession } from '../../auth/strategies/cookie/cookie-auth-refresh-session.model.ts';
import { CookieAuthSession } from '../../auth/strategies/cookie/cookie-auth-session.model.ts';
import { CookieAuthStrategy } from '../../auth/strategies/cookie/cookie-auth.auth-strategy.ts';
import { Repository } from '../../data-source/repository/repository.ts';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../di/inject.function.ts';
import { defineProvider } from '../../di/models/di-provider.model.ts';
import { KnownHeader } from '../../http/known-header.enum.ts';
import { MimeType } from '../../http/mime-type.enum.ts';
import { Controller } from '../../routing/decorators/controller.decorator.ts';
import { Newable } from '../../types/newable.type.ts';
import { JwtUser } from '../mocks/entities/jwt-user.entity.ts';
import { Roles } from '../mocks/entities/roles.enum.ts';
import { defaultTestServerEntities } from '../test-server/create-test-data-source.function.ts';
import { defaultTestServerProviders } from '../test-server/providers.ts';
import { StartedTestServer, startTestServer } from '../test-server/start-test-server.function.ts';

const PUBLIC_URL: string = 'http://zibri.test';
const CLIENT_ID: string = 'zibri-form-post-client';
const CLIENT_SECRET: string = 'zibri-form-post-secret';
const REDIRECT_TO: string = 'https://app.example.com/signed-in';

let provider: FakeOAuthProvider;

class FormPostProviderAuthenticator extends BaseOidcAuthenticator<Roles, JwtUser> {
    readonly name: string = 'form-post';

    readonly clientId: string = CLIENT_ID;

    readonly clientAuthentication: OAuthClientAuthentication = { method: 'client_secret_basic', clientSecret: CLIENT_SECRET };

    override readonly responseMode: OAuthResponseMode = 'form_post';

    get issuer(): string {
        return provider.issuer;
    }
}

@Controller('/auth', { allowOrphan: true, versions: 'all' })
class EvaluationAuthController extends AuthController({
        strategies: [CookieAuthStrategy],
        authenticators: [FormPostProviderAuthenticator],
        twoFactorMethods: [OtpTwoFactorMethod]
    }) {}

describe('evaluation/03-auth-and-security H17 - a provider answering with a form post', () => {
    let server: StartedTestServer;
    let baseUrl: string;

    beforeAll(async () => {
        provider = await startFakeOAuthProvider({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, formPost: true });
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
            authenticators: [FormPostProviderAuthenticator],
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

    it('signs a linked user in when the provider posts its answer to the callback', async () => {
        const user: JwtUser = await inject(repositoryTokenFor(JwtUser)).create({ email: 'form-post@example.com', roles: [Roles.USER] });
        await inject<Repository<FederatedIdentity, FederatedIdentityCreateData>>(repositoryTokenFor(FederatedIdentity))
            .create({ issuer: provider.issuer, subject: 'form-post-subject', userId: user.id, signIn: true, grantedScopes: [] });
        provider.identity = { subject: 'form-post-subject' };
        const browser: TestBrowser = new TestBrowser(baseUrl, PUBLIC_URL);

        const atProvider: string = await browser.follow(
            `${PUBLIC_URL}/auth/federated/authorize?${new URLSearchParams({ redirectTo: REDIRECT_TO }).toString()}`
        );
        const page: Response = await browser.open(atProvider);
        expect(page.status).toBe(200);

        // the page submits the form: a POST another site sends, which a browser sends without a
        // SameSite=Lax cookie. The sign-in is tied to the browser with a cookie, and the callback
        // refuses the answer without it
        let res: Response = await browser.open(`${PUBLIC_URL}/auth/federated/form-post/callback`, {
            method: 'POST',
            headers: { [KnownHeader.CONTENT_TYPE]: MimeType.FORM_URL_ENCODED },
            body: provider.formPosts.at(-1),
            crossSiteFrom: new URL(provider.issuer).origin
        });
        // whatever the application answers on its own origin, followed the way a browser does
        let location: string | null = res.headers.get(KnownHeader.LOCATION);
        for (let hop: number = 0; hop < 5 && location?.startsWith(PUBLIC_URL) === true; hop++) {
            res = await browser.open(location);
            location = res.headers.get(KnownHeader.LOCATION);
        }

        expect(location).toBe(REDIRECT_TO);
        expect((await browser.open(`${baseUrl}/auth/csrf-token`)).status).toBe(200);
    });
});