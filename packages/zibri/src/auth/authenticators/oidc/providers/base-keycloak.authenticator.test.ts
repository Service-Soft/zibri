import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { createInMemoryDataSource, InMemoryDataSource, TestBrowser } from 'zibri-testing';

import { BaseKeycloakAuthenticator } from './base-keycloak.authenticator.ts';
import { JwtUser } from '../../../../__testing__/mocks/entities/jwt-user.entity.ts';
import { Roles } from '../../../../__testing__/mocks/entities/roles.enum.ts';
import { defaultTestServerEntities } from '../../../../__testing__/test-server/create-test-data-source.function.ts';
import { defaultTestServerProviders } from '../../../../__testing__/test-server/providers.ts';
import { StartedTestServer, startTestServer } from '../../../../__testing__/test-server/start-test-server.function.ts';
import { Repository } from '../../../../data-source/repository/repository.ts';
import { Transaction } from '../../../../data-source/transaction/transaction.model.ts';
import { repositoryTokenFor } from '../../../../di/decorators/inject-repository.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../../../di/inject.function.ts';
import { defineProvider } from '../../../../di/models/di-provider.model.ts';
import { KnownHeader } from '../../../../http/known-header.enum.ts';
import { Body } from '../../../../routing/decorators/body.decorator.ts';
import { Controller } from '../../../../routing/decorators/controller.decorator.ts';
import { Get } from '../../../../routing/decorators/get.decorator.ts';
import { Post } from '../../../../routing/decorators/post.decorator.ts';
import { Newable } from '../../../../types/newable.type.ts';
import { JsonUtilities } from '../../../../utilities/json.utilities.ts';
import { OtpTwoFactorMethod } from '../../../2fa/methods/otp/otp.two-factor-method.ts';
import { AuthController } from '../../../auth-controller/auth-controller.model.ts';
import { type AuthServiceInterface } from '../../../auth-service.interface.ts';
import { Auth } from '../../../decorators/auth.decorator.ts';
import { CurrentUser } from '../../../decorators/current-user.decorator.ts';
import { LogoutResult } from '../../../models/logout-result.model.ts';
import { CookieAuthData } from '../../../strategies/cookie/cookie-auth-data.model.ts';
import { CookieAuthRefreshSession } from '../../../strategies/cookie/cookie-auth-refresh-session.model.ts';
import { CookieAuthSession } from '../../../strategies/cookie/cookie-auth-session.model.ts';
import { CookieAuthStrategy } from '../../../strategies/cookie/cookie-auth.auth-strategy.ts';
import { ProviderTokenAuthStrategy } from '../../../strategies/provider-token/provider-token.auth-strategy.ts';
import { FederatedConnectionCode } from '../../federated/federated-connection-code.model.ts';
import { FederatedTicketCredentials } from '../../federated/federated-credentials.model.ts';
import { FederatedHandoverCode } from '../../federated/federated-handover-code.model.ts';
import { FederatedIdentity, FederatedIdentityCreateData } from '../../federated/federated-identity.model.ts';
import { FederatedLoginAttempt } from '../../federated/federated-login-attempt.model.ts';
import { FederatedRegistrationTicket } from '../../federated/federated-registration-ticket.model.ts';
import { FederatedRegistration } from '../../federated/federated-registration.model.ts';
import { OAuthClientAuthentication } from '../../oauth/oauth-client-authentication.model.ts';
import { BaseSamlAuthenticator } from '../../saml/base-saml.authenticator.ts';
import { SamlIdentityProvider } from '../../saml/saml-identity-provider.model.ts';
import { OidcBearerTokens } from '../oidc-bearer-tokens.model.ts';

/**
 * The Keycloak the sign-in is tested against, run in development mode, which serves plain http.
 *
 * Pinned rather than `latest`, so a suite that passes today passes tomorrow for the same reason.
 */
const KEYCLOAK_TEST_IMAGE: string = 'quay.io/keycloak/keycloak:26.4.0';
const KEYCLOAK_PORT: number = 8080;
const REALM: string = 'zibri';
const CLIENT_ID: string = 'zibri-test-client';
const CLIENT_SECRET: string = 'zibri-test-secret';
const KEY_CLIENT_ID: string = 'zibri-test-key-client';
const KEY_ID: string = 'zibri-test-key';
// the entity id of the application, which Keycloak knows its SAML client by
const SAML_CLIENT_ID: string = 'zibri-test-saml-client';
// where the application is reached from the outside, as its baseUrl, which a browser here resolves to
// wherever the server ended up listening. Keycloak only compares it, and never calls it
const PUBLIC_URL: string = 'http://zibri.test';
const REDIRECT_TO: string = 'https://app.example.com/signed-in';
const REGISTRATION_URL: string = 'https://app.example.com/register';
const ERROR_URL: string = 'https://app.example.com/sign-in-failed';
const SIGNED_OUT_URL: string = 'https://app.example.com/signed-out';
// the client a mobile app signs in as, whose access tokens are for the api
const MOBILE_CLIENT_ID: string = 'zibri-test-mobile-app';
// the audience the api is known by in the realm
const API_AUDIENCE: string = 'https://api.zibri.test';

/**
 * A user of the realm.
 */
type KeycloakUser = {
    /**
     * Their id, which is the subject of their ID tokens.
     */
    id: string,
    /**
     * What they sign in with.
     */
    username: string,
    /**
     * Their password.
     */
    password: string,
    /**
     * Their email, verified.
     */
    email: string
};

// linked to a user of the application before every case
const GRACE: KeycloakUser = {
    id: '6f1c2a52-3c0e-4a8e-9a43-1d5b7e0c2f10',
    username: 'grace',
    password: 'grace-password',
    email: 'grace@example.com'
};

// linked to nobody, so her sign-in goes to the registration
const ADA: KeycloakUser = {
    id: '0b7d4e8a-5f2c-4c61-8e3d-9a6f1b2c7d40',
    username: 'ada',
    password: 'ada-password',
    email: 'ada@example.com'
};

// signs in through SAML only, so the persistent NameID Keycloak makes for the application is linked to nobody
const KATHERINE: KeycloakUser = {
    id: '3a9e5c1d-7b24-4f80-b6a2-8c0d4e1f5a93',
    username: 'katherine',
    password: 'katherine-password',
    email: 'katherine@example.com'
};

// only known once the container runs, which is after the authenticators below are declared
let keycloakUrl: string = '';

// generated before the realm is imported, which names the public half as the key of its client
let privateKey: CryptoKey;

class KeycloakAuthenticator extends BaseKeycloakAuthenticator<Roles, JwtUser> {
    readonly realm: string = REALM;

    readonly clientId: string = CLIENT_ID;

    readonly clientAuthentication: OAuthClientAuthentication = { method: 'client_secret_basic', clientSecret: CLIENT_SECRET };

    // Keycloak marks its access tokens `JWT`
    override readonly bearerTokens: OidcBearerTokens = { accessTokenAudiences: [API_AUDIENCE], accessTokenType: 'any', idTokenAudiences: [] };

    get baseUrl(): string {
        return keycloakUrl;
    }
}

class KeycloakKeyAuthenticator extends BaseKeycloakAuthenticator<Roles, JwtUser> {
    override readonly name: string = 'keycloak-key';

    readonly realm: string = REALM;

    readonly clientId: string = KEY_CLIENT_ID;

    get clientAuthentication(): OAuthClientAuthentication {
        return { method: 'private_key_jwt', privateKey, keyId: KEY_ID };
    }

    get baseUrl(): string {
        return keycloakUrl;
    }
}

// the realm as a SAML identity provider, read from the metadata Keycloak publishes
class KeycloakSamlAuthenticator extends BaseSamlAuthenticator<Roles, JwtUser> {
    readonly name: string = 'keycloak-saml';

    readonly entityId: string = SAML_CLIENT_ID;

    get issuer(): string {
        return `${keycloakUrl}/realms/${REALM}`;
    }

    get identityProvider(): SamlIdentityProvider {
        return { metadataUrl: `${keycloakUrl}/realms/${REALM}/protocol/saml/descriptor` };
    }
}

@Controller('/auth', { allowOrphan: true, versions: 'all' })
class KeycloakAuthController extends AuthController({
        strategies: [CookieAuthStrategy],
        authenticators: [KeycloakAuthenticator, KeycloakKeyAuthenticator, KeycloakSamlAuthenticator],
        twoFactorMethods: [OtpTwoFactorMethod]
    }) {}

@Controller('/api', { allowOrphan: true })
class ApiController {
    @Auth.isLoggedIn()
    @Get('/me')
    me(
        @CurrentUser()
        user: JwtUser
    ): { id: string } {
        return { id: user.id };
    }
}

@Auth.skip({ allowRedundant: true })
@Controller('/register-saml', { allowOrphan: true })
class SamlRegistrationController {
    @Post('/')
    async register(
        @Body(FederatedTicketCredentials)
        credentials: FederatedTicketCredentials
    ): Promise<CookieAuthData<string>> {
        const authService: AuthServiceInterface = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
        const users: Repository<JwtUser> = inject(repositoryTokenFor(JwtUser));
        const transaction: Transaction = await users.dataSource.startTransaction();
        try {
            const registration: FederatedRegistration = await authService.resolveRegistration(KeycloakSamlAuthenticator, credentials, transaction);
            const user: JwtUser = await users.create({ email: registration.email ?? '', roles: [Roles.USER] }, { transaction });
            await authService.linkIdentity(KeycloakSamlAuthenticator, credentials, user.id, transaction);
            await transaction.commit();
        }
        catch (error) {
            await transaction.rollback();
            throw error;
        }
        return await authService.login(KeycloakSamlAuthenticator, CookieAuthStrategy, credentials, undefined);
    }
}

@Auth.skip({ allowRedundant: true })
@Controller('/register', { allowOrphan: true })
class RegistrationController {
    @Post('/')
    async register(
        @Body(FederatedTicketCredentials)
        credentials: FederatedTicketCredentials
    ): Promise<CookieAuthData<string>> {
        const authService: AuthServiceInterface = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
        const users: Repository<JwtUser> = inject(repositoryTokenFor(JwtUser));
        const transaction: Transaction = await users.dataSource.startTransaction();
        try {
            const registration: FederatedRegistration = await authService.resolveRegistration(KeycloakAuthenticator, credentials, transaction);
            const user: JwtUser = await users.create({ email: registration.email ?? '', roles: [Roles.USER] }, { transaction });
            await authService.linkIdentity(KeycloakAuthenticator, credentials, user.id, transaction);
            await transaction.commit();
        }
        catch (error) {
            await transaction.rollback();
            throw error;
        }
        return await authService.login(KeycloakAuthenticator, CookieAuthStrategy, credentials, undefined);
    }
}

/**
 * The realm Keycloak starts with: a client signing in with a secret, one signing in with a key, a SAML
 * client, the client of a mobile app, and three users.
 * @param publicKey - The public half of the key the second client signs in with.
 * @returns The realm, as Keycloak imports it.
 */
async function resolveRealm(publicKey: CryptoKey): Promise<object> {
    const jwk: JsonWebKey = await crypto.subtle.exportKey('jwk', publicKey);
    return {
        realm: REALM,
        enabled: true,
        // a container is reached from outside its own network, which Keycloak by default only
        // answers over https
        sslRequired: 'none',
        clients: [
            { ...toRealmClient(CLIENT_ID, 'keycloak', {}), clientAuthenticatorType: 'client-secret', secret: CLIENT_SECRET },
            {
                ...toRealmClient(KEY_CLIENT_ID, 'keycloak-key', {
                    'token.endpoint.auth.signing.alg': 'ES256',
                    'use.jwks.string': 'true',
                    'jwks.string': JsonUtilities.stringify({ keys: [{ ...jwk, kid: KEY_ID, alg: 'ES256', use: 'sig' }] })
                }),
                clientAuthenticatorType: 'client-jwt'
            },
            toSamlRealmClient(),
            toMobileRealmClient()
        ],
        users: [toRealmUser(GRACE, 'Grace', 'Hopper'), toRealmUser(ADA, 'Ada', 'Lovelace'), toRealmUser(KATHERINE, 'Katherine', 'Johnson')]
    };
}

/**
 * The SAML client of the realm: it signs the response and the assertion, takes requests that are not
 * signed, names the user by a persistent NameID, sends their email along, and answers a logout
 * request over the redirect binding.
 * @returns The client, as Keycloak imports it.
 */
function toSamlRealmClient(): object {
    const routes: string = `${PUBLIC_URL}/auth/federated/keycloak-saml`;
    return {
        clientId: SAML_CLIENT_ID,
        enabled: true,
        protocol: 'saml',
        frontchannelLogout: true,
        redirectUris: [`${routes}/*`],
        attributes: {
            'saml.server.signature': 'true',
            'saml.assertion.signature': 'true',
            'saml.client.signature': 'false',
            'saml.encrypt': 'false',
            'saml.authnstatement': 'true',
            'saml.force.post.binding': 'false',
            'saml.signature.algorithm': 'RSA_SHA256',
            saml_signature_canonicalization_method: 'http://www.w3.org/2001/10/xml-exc-c14n#',
            saml_name_id_format: 'persistent',
            saml_assertion_consumer_url_post: `${routes}/callback`,
            saml_single_logout_service_url_redirect: `${routes}/logout`
        },
        protocolMappers: [
            {
                name: 'email',
                protocol: 'saml',
                protocolMapper: 'saml-user-property-mapper',
                consentRequired: false,
                config: { 'user.attribute': 'email', 'attribute.name': 'email', 'attribute.nameformat': 'Basic' }
            }
        ]
    };
}

/**
 * The client of a mobile app, whose access tokens name the api as their audience. It takes the user's
 * password at the token endpoint, which is the shortest way for a test to hold a token as the app
 * would.
 * @returns The client, as Keycloak imports it.
 */
function toMobileRealmClient(): object {
    return {
        clientId: MOBILE_CLIENT_ID,
        enabled: true,
        protocol: 'openid-connect',
        publicClient: true,
        standardFlowEnabled: false,
        directAccessGrantsEnabled: true,
        protocolMappers: [
            {
                name: 'api audience',
                protocol: 'openid-connect',
                protocolMapper: 'oidc-audience-mapper',
                consentRequired: false,
                config: { 'included.custom.audience': API_AUDIENCE, 'access.token.claim': 'true', 'id.token.claim': 'false' }
            }
        ]
    };
}

/**
 * A client of the realm, which only takes a sign-in with PKCE.
 * @param clientId - The client id.
 * @param name - The name of the authenticator signing in with it, which its callback url is under.
 * @param attributes - Any attributes on top.
 * @returns The client, as Keycloak imports it.
 */
function toRealmClient(clientId: string, name: string, attributes: Record<string, string>): object {
    return {
        clientId,
        enabled: true,
        protocol: 'openid-connect',
        publicClient: false,
        standardFlowEnabled: true,
        directAccessGrantsEnabled: false,
        redirectUris: [`${PUBLIC_URL}/auth/federated/${name}/callback`],
        attributes: { 'pkce.code.challenge.method': 'S256', ...attributes }
    };
}

/**
 * A user of the realm, with a verified email and nothing left to do before signing in.
 * @param user - The user.
 * @param firstName - Their first name.
 * @param lastName - Their last name.
 * @returns The user, as Keycloak imports them.
 */
function toRealmUser(user: KeycloakUser, firstName: string, lastName: string): object {
    return {
        id: user.id,
        username: user.username,
        email: user.email,
        emailVerified: true,
        firstName,
        lastName,
        enabled: true,
        credentials: [{ type: 'password', value: user.password, temporary: false }]
    };
}

/**
 * Signs in on Keycloak's login page, the way a user does: opens it, and posts the form with the
 * username and the password.
 * @param browser - The browser.
 * @param atProvider - Where the application sent the browser.
 * @param user - Who signs in.
 * @returns Where Keycloak sends the browser back to, the callback with the code.
 * @throws When Keycloak answers without its login form.
 */
async function signInAtKeycloak(browser: TestBrowser, atProvider: string, user: KeycloakUser): Promise<string> {
    const page: Response = await browser.open(atProvider);
    const html: string = await page.text();
    const action: string | undefined = /action="([^"]*\/login-actions\/authenticate[^"]*)"/.exec(html)?.[1];
    if (action == undefined) {
        throw new Error(`Keycloak answered ${page.status} without its login form: ${html}`);
    }
    return await browser.follow(action.replaceAll('&amp;', '&'), {
        method: 'POST',
        headers: { [KnownHeader.CONTENT_TYPE]: 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ username: user.username, password: user.password, credentialId: '' }).toString()
    });
}

/**
 * Signs in on Keycloak's login page for the SAML client, and posts the answer the way the page Keycloak
 * answers with does.
 * @param browser - The browser.
 * @param atProvider - Where the application sent the browser.
 * @param user - Who signs in.
 * @returns Where the callback sends the browser.
 * @throws When Keycloak answers without its login form, or without the form posting the answer.
 */
async function signInAtKeycloakWithSaml(browser: TestBrowser, atProvider: string, user: KeycloakUser): Promise<string> {
    const page: Response = await browser.open(atProvider);
    const html: string = await page.text();
    const action: string | undefined = /action="([^"]*\/login-actions\/authenticate[^"]*)"/.exec(html)?.[1];
    if (action == undefined) {
        throw new Error(`Keycloak answered ${page.status} without its login form: ${html}`);
    }
    const answerPage: Response = await browser.open(action.replaceAll('&amp;', '&'), {
        method: 'POST',
        headers: { [KnownHeader.CONTENT_TYPE]: 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ username: user.username, password: user.password, credentialId: '' }).toString()
    });
    const answer: string = await answerPage.text();
    const callback: string | undefined = /<form[^>]*action="([^"]*)"/.exec(answer)?.[1];
    if (callback == undefined) {
        throw new Error(`Keycloak answered ${answerPage.status} without the form posting its answer: ${answer}`);
    }
    const fields: URLSearchParams = new URLSearchParams(
        [...answer.matchAll(/<input[^>]*name="([^"]*)"[^>]*value="([^"]*)"/g)]
            .map(([, name = '', value = '']) => [name, value.replaceAll('&amp;', '&')])
    );
    return await browser.follow(callback.replaceAll('&amp;', '&'), {
        method: 'POST',
        headers: { [KnownHeader.CONTENT_TYPE]: 'application/x-www-form-urlencoded' },
        body: fields,
        crossSiteFrom: new URL(keycloakUrl).origin
    });
}

describe('BaseKeycloakAuthenticator', () => {
    let keycloak: StartedTestContainer;
    let server: StartedTestServer;
    let baseUrl: string;
    let grace: JwtUser;

    beforeAll(async () => {
        const keyPair: CryptoKeyPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
        privateKey = keyPair.privateKey;
        keycloak = await new GenericContainer(KEYCLOAK_TEST_IMAGE)
            .withCommand(['start-dev', '--import-realm'])
            .withCopyContentToContainer([
                {
                    content: JsonUtilities.stringify(await resolveRealm(keyPair.publicKey)),
                    target: `/opt/keycloak/data/import/${REALM}-realm.json`
                }
            ])
            .withExposedPorts(KEYCLOAK_PORT)
            // the realm's discovery answers once the import is done, which the server's health does not wait for
            .withWaitStrategy(Wait.forHttp(`/realms/${REALM}/.well-known/openid-configuration`, KEYCLOAK_PORT).forStatusCode(200))
            .withStartupTimeout(150000)
            .start();
        keycloakUrl = `http://${keycloak.getHost()}:${keycloak.getMappedPort(KEYCLOAK_PORT)}`;

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
            authStrategies: [CookieAuthStrategy, ProviderTokenAuthStrategy],
            authenticators: [KeycloakAuthenticator, KeycloakKeyAuthenticator, KeycloakSamlAuthenticator],
            controllers: [KeycloakAuthController, RegistrationController, SamlRegistrationController, ApiController],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({ token: ZIBRI_DI_TOKENS.COOKIE_SIGN_SECRET, useFactory: () => 'test-cookie-secret' }),
                defineProvider({
                    token: ZIBRI_DI_TOKENS.FEDERATION_OPTIONS,
                    useValue: {
                        allowedRedirects: ['https://app.example.com'],
                        registrationUrl: REGISTRATION_URL,
                        errorUrl: ERROR_URL,
                        signedOutUrl: SIGNED_OUT_URL,
                        maxAuthenticationAgeInMs: 3600000
                    }
                })
            ]
        });
        baseUrl = await server.start();

        grace = await inject(repositoryTokenFor(JwtUser)).create({ email: GRACE.email, roles: [Roles.USER] });
        await inject<Repository<FederatedIdentity, FederatedIdentityCreateData>>(repositoryTokenFor(FederatedIdentity))
            .create({ issuer: `${keycloakUrl}/realms/${REALM}`, subject: GRACE.id, userId: grace.id, signIn: true, grantedScopes: [] });
    }, 180000);

    afterAll(async () => {
        await server?.shutdown();
        await keycloak?.stop();
    }, 30000);

    const authorizeUrl: (name: string, query?: Record<string, string>) => string = (name, query) => `${PUBLIC_URL}/auth/federated/authorize?${new URLSearchParams({ authenticator: name, redirectTo: REDIRECT_TO, ...query }).toString()}`;

    it('signs a linked user in through the login page, and lands where the frontend asked with a session', async () => {
        const browser: TestBrowser = new TestBrowser(baseUrl, PUBLIC_URL);

        const callback: string = await signInAtKeycloak(browser, await browser.follow(authorizeUrl('keycloak')), GRACE);

        expect(await browser.follow(callback)).toBe(REDIRECT_TO);
        expect((await browser.open(`${baseUrl}/auth/csrf-token`)).status).toBe(200);
    }, 30000);

    it('signs in with a client that proves itself with a private key', async () => {
        const browser: TestBrowser = new TestBrowser(baseUrl, PUBLIC_URL);

        const callback: string = await signInAtKeycloak(browser, await browser.follow(authorizeUrl('keycloak-key')), GRACE);

        expect(await browser.follow(callback)).toBe(REDIRECT_TO);
    }, 30000);

    it('reuses the session at Keycloak, keeping when the user signed in there as the login time', async () => {
        const sessions: Repository<CookieAuthRefreshSession> = inject(repositoryTokenFor(CookieAuthRefreshSession));
        const earlier: Set<string> = new Set((await sessions.findAll({ where: { userId: grace.id } })).map(s => s.id));
        const browser: TestBrowser = new TestBrowser(baseUrl, PUBLIC_URL);
        await browser.follow(await signInAtKeycloak(browser, await browser.follow(authorizeUrl('keycloak')), GRACE));
        // whole seconds apart, so a login time taken from the callback could not pass for Keycloak's
        await new Promise(resolve => setTimeout(resolve, 1100));

        // no login page this time: Keycloak sends the browser straight back
        const callback: string = await browser.follow(await browser.follow(authorizeUrl('keycloak')));

        expect(await browser.follow(callback)).toBe(REDIRECT_TO);
        const loginTimes: number[] = (await sessions.findAll({ where: { userId: grace.id } }))
            .filter(s => !earlier.has(s.id))
            .map(s => new Date(s.authenticatedAt).getTime());
        expect(loginTimes).toHaveLength(2);
        expect(new Set(loginTimes).size).toBe(1);
    }, 30000);

    it('asks for the password again when the frontend reauthenticates', async () => {
        const browser: TestBrowser = new TestBrowser(baseUrl, PUBLIC_URL);
        await browser.follow(await signInAtKeycloak(browser, await browser.follow(authorizeUrl('keycloak')), GRACE));

        const callback: string = await signInAtKeycloak(
            browser,
            await browser.follow(authorizeUrl('keycloak', { reauthenticate: 'true' })),
            GRACE
        );

        expect(await browser.follow(callback)).toBe(REDIRECT_TO);
    }, 30000);

    it('sends a user nobody is linked to to the registration, with the profile Keycloak reports', async () => {
        const browser: TestBrowser = new TestBrowser(baseUrl, PUBLIC_URL);

        const landing: string = await browser.follow(await signInAtKeycloak(browser, await browser.follow(authorizeUrl('keycloak')), ADA));
        expect(landing.startsWith(`${REGISTRATION_URL}?ticket=`)).toBe(true);
        const registered: Response = await browser.open(`${baseUrl}/register`, {
            method: 'POST',
            headers: { [KnownHeader.CONTENT_TYPE]: 'application/json' },
            body: JsonUtilities.stringify({ ticket: new URL(landing).searchParams.get('ticket') })
        });

        expect(registered.status).toBe(200);
        expect(await inject(repositoryTokenFor(JwtUser)).findAll({ where: { email: ADA.email } })).toHaveLength(1);
    }, 30000);

    it('takes the access token a mobile app holds from Keycloak, as the user its identity is linked to', async () => {
        const issued: Response = await fetch(`${keycloakUrl}/realms/${REALM}/protocol/openid-connect/token`, {
            method: 'POST',
            headers: { [KnownHeader.CONTENT_TYPE]: 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ grant_type: 'password', client_id: MOBILE_CLIENT_ID, username: GRACE.username, password: GRACE.password, scope: 'openid' })
        });
        expect(issued.status).toBe(200);
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const { access_token: accessToken }: { access_token: string } = await issued.json();

        const res: Response = await fetch(`${baseUrl}/api/me`, { headers: { [KnownHeader.AUTHORIZATION]: `Bearer ${accessToken}` } });

        expect(res.status).toBe(200);
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const me: { id: string } = await res.json();
        expect(me.id).toBe(grace.id);
    }, 30000);

    it('signs a user in through SAML, and logs them out at Keycloak as well', async () => {
        const browser: TestBrowser = new TestBrowser(baseUrl, PUBLIC_URL);

        // read from Keycloak's metadata, verified against its signature, and linked to nobody yet
        const landing: string = await signInAtKeycloakWithSaml(browser, await browser.follow(authorizeUrl('keycloak-saml')), KATHERINE);
        expect(landing.startsWith(`${REGISTRATION_URL}?ticket=`)).toBe(true);
        const registered: Response = await browser.open(`${baseUrl}/register-saml`, {
            method: 'POST',
            headers: { [KnownHeader.CONTENT_TYPE]: 'application/json' },
            body: JsonUtilities.stringify({ ticket: new URL(landing).searchParams.get('ticket') })
        });
        expect(registered.status).toBe(200);
        const user: JwtUser = await inject(repositoryTokenFor(JwtUser)).findOne({ where: { email: KATHERINE.email } });
        const identities: FederatedIdentity[] = await inject(repositoryTokenFor(FederatedIdentity)).findAll({ where: { userId: user.id } });
        expect(identities.map(i => i.issuer)).toEqual([`${keycloakUrl}/realms/${REALM}`]);

        const loggedOut: Response = await browser.open(`${baseUrl}/auth/logout`, {
            method: 'POST',
            headers: { [KnownHeader.CONTENT_TYPE]: 'application/json' },
            body: JsonUtilities.stringify({ clearCookies: true })
        });
        expect(loggedOut.status).toBe(200);
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const { providerLogoutUrl }: LogoutResult = await loggedOut.json();
        expect(providerLogoutUrl?.startsWith(`${keycloakUrl}/realms/${REALM}/protocol/saml`)).toBe(true);

        // Keycloak ends its session, and answers to the logout route of the application
        const back: string = await browser.follow(providerLogoutUrl ?? '');
        expect(back.startsWith(`${PUBLIC_URL}/auth/federated/keycloak-saml/logout?`)).toBe(true);
        expect(await browser.follow(back)).toBe(SIGNED_OUT_URL);
        // with no session left there, the next sign-in shows the login page again
        const page: Response = await browser.open(await browser.follow(authorizeUrl('keycloak-saml')));
        expect(await page.text()).toContain('login-actions/authenticate');
    }, 30000);
});