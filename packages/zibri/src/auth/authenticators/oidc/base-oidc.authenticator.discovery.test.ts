import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource, FakeOAuthProvider, InMemoryDataSource, startFakeOAuthProvider } from 'zibri-testing';

import { BaseOidcAuthenticator } from './base-oidc.authenticator';
import { OidcAuthenticationTime } from './oidc-authentication-time.type';
import { OidcDiscoveryAtBoot } from './oidc-discovery-at-boot.type';
import { TestTimeouts } from '../../../__testing__/constants';
import { JwtUser } from '../../../__testing__/mocks/entities/jwt-user.entity';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { defineProvider } from '../../../di/models/di-provider.model';
import { Controller } from '../../../routing/decorators/controller.decorator';
import { Newable } from '../../../types/newable.type';
import { OtpTwoFactorMethod } from '../../2fa/methods/otp/otp.two-factor-method';
import { AuthController } from '../../auth-controller/auth-controller.model';
import { CookieAuthRefreshSession } from '../../strategies/cookie/cookie-auth-refresh-session.model';
import { CookieAuthSession } from '../../strategies/cookie/cookie-auth-session.model';
import { CookieAuthStrategy } from '../../strategies/cookie/cookie-auth.auth-strategy';
import { FederatedConnectionCode } from '../federated/federated-connection-code.model';
import { FederatedHandoverCode } from '../federated/federated-handover-code.model';
import { FederatedIdentity } from '../federated/federated-identity.model';
import { FederatedLoginAttempt } from '../federated/federated-login-attempt.model';
import { FederatedRegistrationTicket } from '../federated/federated-registration-ticket.model';
import { OAuthClientAuthentication } from '../oauth/oauth-client-authentication.model';

const PUBLIC_URL: string = 'http://zibri.test';
const CLIENT_ID: string = 'zibri-test-client';
const CLIENT_SECRET: string = 'zibri-test-secret';

let provider: FakeOAuthProvider;

abstract class TestProviderAuthenticator extends BaseOidcAuthenticator<string, JwtUser> {
    readonly clientId: string = CLIENT_ID;

    readonly clientAuthentication: OAuthClientAuthentication = { method: 'client_secret_basic', clientSecret: CLIENT_SECRET };

    readonly authenticationTime: OidcAuthenticationTime = 'auth_time';

    get issuer(): string {
        return provider.issuer;
    }
}

class RequiredProviderAuthenticator extends TestProviderAuthenticator {
    readonly name: string = 'required';

    readonly discoveryAtBoot: OidcDiscoveryAtBoot = 'required';
}

class WhenReachableProviderAuthenticator extends TestProviderAuthenticator {
    readonly name: string = 'when-reachable';

    readonly discoveryAtBoot: OidcDiscoveryAtBoot = 'whenReachable';
}

// reads the metadata again for every use
class ShortLivedMetadataProviderAuthenticator extends TestProviderAuthenticator {
    readonly name: string = 'short-lived';

    readonly discoveryAtBoot: OidcDiscoveryAtBoot = 'required';

    override readonly metadataMaxAgeInMs: number = 0;
}

// the routes of each provider, one controller each, since the options of one name exactly the
// authenticators of the application. Orphans for the cases that start with another
@Controller('/auth', { allowOrphan: true, versions: 'all' })
class RequiredAuthController extends AuthController({
        strategies: [CookieAuthStrategy],
        authenticators: [RequiredProviderAuthenticator],
        twoFactorMethods: [OtpTwoFactorMethod]
    }) {}

@Controller('/auth', { allowOrphan: true, versions: 'all' })
class WhenReachableAuthController extends AuthController({
        strategies: [CookieAuthStrategy],
        authenticators: [WhenReachableProviderAuthenticator],
        twoFactorMethods: [OtpTwoFactorMethod]
    }) {}

@Controller('/auth', { allowOrphan: true, versions: 'all' })
class ShortLivedAuthController extends AuthController({
        strategies: [CookieAuthStrategy],
        authenticators: [ShortLivedMetadataProviderAuthenticator],
        twoFactorMethods: [OtpTwoFactorMethod]
    }) {}

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
    repositories: defaultTestServerRepositories,
    allowOrphan: true
});

/**
 * Starts an application logging in through one provider.
 * @param authenticator - The provider's authenticator.
 * @param controller - The controller serving its routes.
 * @returns The server, started.
 */
async function startApp(authenticator: Newable<TestProviderAuthenticator>, controller: Newable<object>): Promise<StartedTestServer> {
    const server: StartedTestServer = await startTestServer({
        baseUrl: PUBLIC_URL,
        dataSources: [dataSourceClass],
        authStrategies: [CookieAuthStrategy],
        authenticators: [authenticator],
        controllers: [controller],
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
    await server.start();
    return server;
}

/**
 * Where the provider's end session endpoint is, which reading its metadata finds out.
 * @param authenticator - The provider's authenticator, built by the running application.
 * @returns The url the authenticator sends a browser to for logging out.
 */
async function findLogoutUrl(authenticator: TestProviderAuthenticator): Promise<string | undefined> {
    return await authenticator.createLogoutUrl({ provider: authenticator.name, subjectKey: 'subject', sessionKey: undefined, logout: undefined });
}

beforeAll(async () => {
    provider = await startFakeOAuthProvider({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
});

afterAll(async () => {
    await provider?.stop();
});

describe('BaseOidcAuthenticator — the provider\'s metadata at boot', () => {
    it('reads the provider\'s metadata while the application starts', async () => {
        const readsBefore: number = provider.metadataReads;

        const server: StartedTestServer = await startApp(RequiredProviderAuthenticator, RequiredAuthController);
        try {
            expect(provider.metadataReads).toBe(readsBefore + 1);
        }
        finally {
            await server.shutdown();
        }
    }, TestTimeouts.inMemory.start);

    it('does not start while the provider cannot be reached, with discoveryAtBoot required', async () => {
        provider.failNextDiscovery(503);

        await expect(startApp(RequiredProviderAuthenticator, RequiredAuthController)).rejects.toThrow(/RequiredProviderAuthenticator could not read the metadata of its provider/);
    }, TestTimeouts.inMemory.start);

    it('starts while the provider cannot be reached with discoveryAtBoot whenReachable, and reads the metadata when first needed', async () => {
        provider.failNextDiscovery(503);

        const server: StartedTestServer = await startApp(WhenReachableProviderAuthenticator, WhenReachableAuthController);
        try {
            expect(await findLogoutUrl(inject(WhenReachableProviderAuthenticator))).toMatch(new RegExp(`^${provider.issuer}/end-session`));
        }
        finally {
            await server.shutdown();
        }
    }, TestTimeouts.inMemory.start);

    it('does not start when the issuer answers with something other than metadata, whatever discoveryAtBoot says', async () => {
        provider.failNextDiscovery(404);

        await expect(startApp(WhenReachableProviderAuthenticator, WhenReachableAuthController)).rejects.toThrow(/WhenReachableProviderAuthenticator could not read the metadata of its provider/);
    }, TestTimeouts.inMemory.start);
});

describe('BaseOidcAuthenticator — reading the provider\'s metadata again', () => {
    let server: StartedTestServer;

    beforeAll(async () => {
        server = await startApp(ShortLivedMetadataProviderAuthenticator, ShortLivedAuthController);
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    it('reads it again once metadataMaxAgeInMs passed, and keeps what it read before while the provider cannot be reached', async () => {
        const authenticator: ShortLivedMetadataProviderAuthenticator = inject(ShortLivedMetadataProviderAuthenticator);
        const readsBefore: number = provider.metadataReads;

        await findLogoutUrl(authenticator);
        provider.failNextDiscovery(503);
        const whileUnreachable: string | undefined = await findLogoutUrl(authenticator);

        expect(provider.metadataReads).toBe(readsBefore + 2);
        expect(whileUnreachable).toMatch(new RegExp(`^${provider.issuer}/end-session`));
    });
});