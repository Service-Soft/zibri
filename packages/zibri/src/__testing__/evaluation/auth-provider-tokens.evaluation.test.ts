import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInMemoryDataSource, FakeOAuthProvider, InMemoryDataSource, startFakeOAuthProvider } from 'zibri-testing';

import { OtpTwoFactorMethod } from '../../auth/2fa/methods/otp/otp.two-factor-method.ts';
import { AuthController } from '../../auth/auth-controller/auth-controller.model.ts';
import { FederatedConnectionCode } from '../../auth/authenticators/federated/federated-connection-code.model.ts';
import { FederatedHandoverCode } from '../../auth/authenticators/federated/federated-handover-code.model.ts';
import { FederatedIdentity, FederatedIdentityCreateData } from '../../auth/authenticators/federated/federated-identity.model.ts';
import { FederatedLoginAttempt } from '../../auth/authenticators/federated/federated-login-attempt.model.ts';
import { FederatedRegistrationTicket } from '../../auth/authenticators/federated/federated-registration-ticket.model.ts';
import { OAuthClientAuthentication } from '../../auth/authenticators/oauth/oauth-client-authentication.model.ts';
import { BaseOidcAuthenticator } from '../../auth/authenticators/oidc/base-oidc.authenticator.ts';
import { OidcBearerTokens } from '../../auth/authenticators/oidc/oidc-bearer-tokens.model.ts';
import { Auth } from '../../auth/decorators/auth.decorator.ts';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.ts';
import { JwtAuthStrategy } from '../../auth/strategies/jwt/jwt.auth-strategy.ts';
import { ProviderTokenAuthStrategy } from '../../auth/strategies/provider-token/provider-token.auth-strategy.ts';
import { Repository } from '../../data-source/repository/repository.ts';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../di/inject.function.ts';
import { defineProvider } from '../../di/models/di-provider.model.ts';
import { Controller } from '../../routing/decorators/controller.decorator.ts';
import { Get } from '../../routing/decorators/get.decorator.ts';
import { Newable } from '../../types/newable.type.ts';
import { JwtUser } from '../mocks/entities/jwt-user.entity.ts';
import { Roles } from '../mocks/entities/roles.enum.ts';
import { defaultTestServerEntities } from '../test-server/create-test-data-source.function.ts';
import { defaultTestServerProviders } from '../test-server/providers.ts';
import { StartedTestServer, startTestServer } from '../test-server/start-test-server.function.ts';

const PUBLIC_URL: string = 'http://zibri.test';
const CLIENT_ID: string = 'zibri-oidc-client';
const CLIENT_SECRET: string = 'zibri-oidc-secret';
const API_AUDIENCE: string = 'https://api.zibri.test';

let provider: FakeOAuthProvider;

class CompanyProviderAuthenticator extends BaseOidcAuthenticator<Roles, JwtUser> {
    readonly name: string = 'company';

    readonly clientId: string = CLIENT_ID;

    readonly clientAuthentication: OAuthClientAuthentication = { method: 'client_secret_basic', clientSecret: CLIENT_SECRET };

    override readonly bearerTokens: OidcBearerTokens = { accessTokenAudiences: [API_AUDIENCE], accessTokenType: 'at+jwt', idTokenAudiences: [] };

    get issuer(): string {
        return provider.issuer;
    }
}

@Controller('/auth', { allowOrphan: true, versions: 'all' })
class EvaluationProviderAuthController extends AuthController({
        strategies: [JwtAuthStrategy],
        authenticators: [CompanyProviderAuthenticator],
        twoFactorMethods: [OtpTwoFactorMethod]
    }) {}

@Controller('/evaluation-provider-tokens', { allowOrphan: true })
class EvaluationProviderTokensController {
    @Auth.isLoggedIn()
    @Get('/me')
    me(
        @CurrentUser()
        user: JwtUser
    ): { id: string } {
        return { id: user.id };
    }
}

describe('evaluation/03-auth-and-security H14 - an identity provider\'s tokens as bearer credentials', () => {
    let server: StartedTestServer;
    let baseUrl: string;

    beforeAll(async () => {
        provider = await startFakeOAuthProvider({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
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
        server = await startTestServer({
            baseUrl: PUBLIC_URL,
            dataSources: [dataSourceClass],
            authStrategies: [JwtAuthStrategy, ProviderTokenAuthStrategy],
            authenticators: [CompanyProviderAuthenticator],
            controllers: [EvaluationProviderAuthController, EvaluationProviderTokensController],
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
        baseUrl = await server.start();
    }, 20000);

    afterAll(async () => {
        await server?.shutdown();
        await provider?.stop();
    }, 15000);

    it('verifies a token the provider issued against the keys the provider publishes', async () => {
        const user: JwtUser = await inject(repositoryTokenFor(JwtUser)).create({ email: 'mobile@example.com', roles: [Roles.USER] });
        await inject<Repository<FederatedIdentity, FederatedIdentityCreateData>>(repositoryTokenFor(FederatedIdentity))
            .create({ issuer: provider.issuer, subject: 'mobile-subject', userId: user.id, signIn: true, grantedScopes: [] });
        provider.identity = { subject: 'mobile-subject' };

        // what a mobile app holds from the company's provider, and calls the api with
        const res: Response = await fetch(`${baseUrl}/evaluation-provider-tokens/me`, {
            headers: { authorization: `Bearer ${provider.createJwtAccessToken({ audience: API_AUDIENCE })}` }
        });

        expect(res.status).toBe(200);
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const body: { id: string } = await res.json();
        expect(body.id).toBe(user.id);
    });
});