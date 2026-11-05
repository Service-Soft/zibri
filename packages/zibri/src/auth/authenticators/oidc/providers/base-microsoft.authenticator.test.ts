import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource, FakeOAuthProvider, InMemoryDataSource, startFakeOAuthProvider, TestBrowser } from 'zibri-testing';

import { BaseMicrosoftAuthenticator } from './base-microsoft.authenticator';
import { TestTimeouts } from '../../../../__testing__/constants';
import { JwtUser } from '../../../../__testing__/mocks/entities/jwt-user.entity';
import { Roles } from '../../../../__testing__/mocks/entities/roles.enum';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../../../__testing__/test-server/providers';
import { startAndStopTestServerWithout } from '../../../../__testing__/test-server/start-and-stop-test-server-without.function';
import { StartedTestServer, startTestServer } from '../../../../__testing__/test-server/start-test-server.function';
import { Repository } from '../../../../data-source/repository/repository';
import { repositoryTokenFor } from '../../../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../../di/inject.function';
import { defineProvider } from '../../../../di/models/di-provider.model';
import { FetchForLibraryOptions } from '../../../../http-client/fetch-for-library-options.model';
import { HttpClient } from '../../../../http-client/http-client';
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
import { FederationOptions } from '../../federated/federation-options.model';
import { OAuthClientAuthentication } from '../../oauth/oauth-client-authentication.model';
import { OAuthProviderTokens } from '../../oauth/oauth-provider-tokens.model';
import { ProviderToken } from '../../provider-token.model';
import { OidcAuthenticationTime } from '../oidc-authentication-time.type';
import { OidcBearerTokens } from '../oidc-bearer-tokens.model';
import { OidcDiscoveryAtBoot } from '../oidc-discovery-at-boot.type';

const PUBLIC_URL: string = 'http://zibri.test';
const CLIENT_ID: string = 'zibri-test-client';
const CLIENT_SECRET: string = 'zibri-test-secret';
const REDIRECT_TO: string = 'https://app.example.com/logged-in';
const ERROR_URL: string = 'https://app.example.com/login-failed';
const API_AUDIENCE: string = 'api://zibri-test';
// Entra ID's endpoint for the work accounts of every tenant, and the issuer template its metadata names
const ORGANIZATIONS_URL: string = 'https://login.microsoftonline.com/organizations/v2.0';
const TENANT_ISSUER_TEMPLATE: string = 'https://login.microsoftonline.com/{tenantid}/v2.0';
const PARTNER_TENANT: string = '6f0c3c1e-3a4b-4f7e-9c2d-1b2a3c4d5e6f';
const STRANGER_TENANT: string = '0d9e8f7a-6b5c-4d3e-8f2a-1b0c9d8e7f6a';

let entra: FakeOAuthProvider;

/**
 * Sends what is meant for Entra ID to the fake provider playing it, as the network would send it to
 * Microsoft: the one boundary the test cannot run in its own process.
 */
class EntraRoutingHttpClient extends HttpClient {
    override async fetchForLibrary(url: string, init: RequestInit, options?: FetchForLibraryOptions): Promise<Response> {
        const routed: string = url.startsWith(ORGANIZATIONS_URL) ? `${entra.listeningUrl}${url.slice(ORGANIZATIONS_URL.length)}` : url;
        return await super.fetchForLibrary(routed, init, options);
    }
}

class PartnerAuthenticator extends BaseMicrosoftAuthenticator<string, JwtUser> {
    readonly tenantId: string = 'organizations';

    override readonly allowedTenantIds: string[] = [PARTNER_TENANT];

    readonly authenticationTime: OidcAuthenticationTime = 'auth_time';

    readonly discoveryAtBoot: OidcDiscoveryAtBoot = 'required';

    readonly clientId: string = CLIENT_ID;

    readonly clientAuthentication: OAuthClientAuthentication = { method: 'client_secret_basic', clientSecret: CLIENT_SECRET };

    override readonly bearerTokens: OidcBearerTokens = { accessTokenAudiences: [API_AUDIENCE], accessTokenType: 'at+jwt', idTokenAudiences: [] };
}

class EveryTenantAuthenticator extends BaseMicrosoftAuthenticator<string, JwtUser> {
    readonly tenantId: string = 'common';

    readonly authenticationTime: OidcAuthenticationTime = 'auth_time';

    readonly discoveryAtBoot: OidcDiscoveryAtBoot = 'required';

    readonly clientId: string = CLIENT_ID;

    readonly clientAuthentication: OAuthClientAuthentication = { method: 'client_secret_basic', clientSecret: CLIENT_SECRET };
}

// an orphan for the case that boots without it
@Controller('/auth', { allowOrphan: true, versions: 'all' })
class MicrosoftAuthController extends AuthController({
        strategies: [CookieAuthStrategy],
        authenticators: [PartnerAuthenticator],
        twoFactorMethods: [OtpTwoFactorMethod]
    }) {}

const FEDERATION_OPTIONS: FederationOptions = {
    allowedRedirects: ['https://app.example.com'],
    registrationUrl: 'https://app.example.com/register',
    errorUrl: ERROR_URL,
    maxAuthenticationAgeInMs: 3600000
};

/**
 * Creates a user, linked to an identity in a tenant.
 * @param email - The user's email.
 * @param tenantId - The tenant of the identity.
 * @param objectId - Who the user is in the tenant.
 * @returns The user.
 */
async function createLinkedUser(email: string, tenantId: string, objectId: string): Promise<JwtUser> {
    const user: JwtUser = await inject(repositoryTokenFor(JwtUser)).create({ email, roles: [Roles.USER] });
    await inject<Repository<FederatedIdentity, FederatedIdentityCreateData>>(repositoryTokenFor(FederatedIdentity)).create({
        issuer: TENANT_ISSUER_TEMPLATE.replace('{tenantid}', tenantId),
        subject: objectId,
        userId: user.id,
        forLogin: true,
        grantedScopes: []
    });
    return user;
}

// first, for the reason on startAndStopTestServerWithout
describe('BaseMicrosoftAuthenticator — starting', () => {
    it('refuses to start a multi-tenant endpoint without the tenants it allows', async () => {
        const start: Promise<void> = startAndStopTestServerWithout([], {
            authenticators: [EveryTenantAuthenticator],
            providers: [...defaultTestServerProviders, defineProvider({ token: ZIBRI_DI_TOKENS.FEDERATION_OPTIONS, useValue: FEDERATION_OPTIONS })]
        });

        await expect(start).rejects.toThrow(/EveryTenantAuthenticator logs in the accounts of every tenant through "common"/);
    }, TestTimeouts.inMemory.start);
});

describe('BaseMicrosoftAuthenticator — the accounts of several tenants', () => {
    let server: StartedTestServer;
    let baseUrl: string;

    /**
     * A browser that reaches the application at its public url, and Entra ID at the fake provider.
     * @returns The browser.
     */
    function newBrowser(): TestBrowser {
        return new TestBrowser(baseUrl, PUBLIC_URL, { [ORGANIZATIONS_URL]: entra.listeningUrl });
    }

    /**
     * Logs in through Entra ID, as the identity the fake provider logs in next.
     * @param browser - The browser.
     * @returns Where the browser lands.
     */
    async function logIn(browser: TestBrowser): Promise<string> {
        const atEntra: string = await browser.follow(`${PUBLIC_URL}/auth/federated/login/request?${new URLSearchParams({ redirectTo: REDIRECT_TO }).toString()}`);
        return await browser.follow(await browser.follow(atEntra));
    }

    beforeAll(async () => {
        entra = await startFakeOAuthProvider({
            clientId: CLIENT_ID,
            clientSecret: CLIENT_SECRET,
            publicUrl: ORGANIZATIONS_URL,
            issuer: TENANT_ISSUER_TEMPLATE
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
            authenticators: [PartnerAuthenticator],
            controllers: [MicrosoftAuthController],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({ token: ZIBRI_DI_TOKENS.HTTP_CLIENT, useClass: EntraRoutingHttpClient }),
                defineProvider({ token: ZIBRI_DI_TOKENS.COOKIE_SIGN_SECRET, useFactory: () => 'test-cookie-secret' }),
                defineProvider({ token: ZIBRI_DI_TOKENS.FEDERATION_OPTIONS, useValue: FEDERATION_OPTIONS })
            ]
        });
        baseUrl = await server.start();
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
        await entra?.stop();
    }, TestTimeouts.inMemory.shutdown);

    it('logs in an account of a tenant allowedTenantIds names, as the identity in that tenant', async () => {
        const user: JwtUser = await createLinkedUser('ada@partner.example.com', PARTNER_TENANT, 'ada-object-id');
        entra.identity = { subject: 'pairwise-ada', claims: { tid: PARTNER_TENANT, oid: 'ada-object-id' } };

        expect(await logIn(newBrowser())).toBe(REDIRECT_TO);
        const identities: FederatedIdentity[] = await inject(ZIBRI_DI_TOKENS.AUTH_SERVICE).findIdentities(user.id, undefined, [PartnerAuthenticator])
            .then(linked => linked.map(l => l.identity));
        expect(identities.map(identity => identity.issuer)).toStrictEqual([TENANT_ISSUER_TEMPLATE.replace('{tenantid}', PARTNER_TENANT)]);
    });

    it('refuses an account of another tenant, which Entra ID itself lets through', async () => {
        await createLinkedUser('grace@stranger.example.com', STRANGER_TENANT, 'grace-object-id');
        entra.identity = { subject: 'pairwise-grace', claims: { tid: STRANGER_TENANT, oid: 'grace-object-id' } };

        expect(await logIn(newBrowser())).toBe(`${ERROR_URL}?error=refused`);
    });

    it('takes an access token for the api from a tenant it allows, and none from another', async () => {
        const user: JwtUser = await createLinkedUser('linus@partner.example.com', PARTNER_TENANT, 'linus-object-id');
        const authenticator: PartnerAuthenticator = inject(PartnerAuthenticator);

        entra.identity = { subject: 'pairwise-linus', claims: { tid: PARTNER_TENANT, oid: 'linus-object-id' } };
        const partnerToken: ProviderToken | undefined = await authenticator.findProviderToken(entra.createJwtAccessToken({ audience: API_AUDIENCE }));
        entra.identity = { subject: 'pairwise-linus', claims: { tid: STRANGER_TENANT, oid: 'linus-object-id' } };
        const strangerToken: ProviderToken | undefined = await authenticator.findProviderToken(entra.createJwtAccessToken({ audience: API_AUDIENCE }));

        expect(partnerToken?.userId).toBe(user.id);
        expect(strangerToken).toBeUndefined();
    });
});