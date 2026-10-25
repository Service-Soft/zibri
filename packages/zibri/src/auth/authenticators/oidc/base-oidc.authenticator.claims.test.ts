import { createHash, randomBytes } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource, FakeOAuthProvider, startFakeOAuthProvider, TestBrowser } from 'zibri-testing';

import { BaseOidcAuthenticator } from './base-oidc.authenticator';
import { OidcAuthenticationTime } from './oidc-authentication-time.type';
import { TestTimeouts } from '../../../__testing__/constants';
import { JwtUser } from '../../../__testing__/mocks/entities/jwt-user.entity';
import { Roles } from '../../../__testing__/mocks/entities/roles.enum';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { Repository } from '../../../data-source/repository/repository';
import { Transaction } from '../../../data-source/transaction/transaction.model';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { defineProvider } from '../../../di/models/di-provider.model';
import { ForbiddenError } from '../../../error-handling/errors/forbidden.error';
import { KnownHeader } from '../../../http/known-header.enum';
import { MimeType } from '../../../http/mime-type.enum';
import { $ts } from '../../../localization/translate.function';
import { Body } from '../../../routing/decorators/body.decorator';
import { Controller } from '../../../routing/decorators/controller.decorator';
import { Get } from '../../../routing/decorators/get.decorator';
import { Post } from '../../../routing/decorators/post.decorator';
import { Newable } from '../../../types/newable.type';
import { JsonUtilities } from '../../../utilities/json.utilities';
import { OtpTwoFactorMethod } from '../../2fa/methods/otp/otp.two-factor-method';
import { AuthController } from '../../auth-controller/auth-controller.model';
import { type AuthServiceInterface } from '../../auth-service.interface';
import { Auth } from '../../decorators/auth.decorator';
import { CookieAuthData } from '../../strategies/cookie/cookie-auth-data.model';
import { CookieAuthRefreshSession } from '../../strategies/cookie/cookie-auth-refresh-session.model';
import { CookieAuthSession } from '../../strategies/cookie/cookie-auth-session.model';
import { CookieAuthStrategy } from '../../strategies/cookie/cookie-auth.auth-strategy';
import { JwtAuthData } from '../../strategies/jwt/jwt-auth-data.model';
import { JwtAuthStrategy } from '../../strategies/jwt/jwt.auth-strategy';
import { FederatedConnectionCode } from '../federated/federated-connection-code.model';
import { FederatedTicketCredentials } from '../federated/federated-credentials.model';
import { FederatedHandoverCode } from '../federated/federated-handover-code.model';
import { FederatedIdentity, FederatedIdentityCreateData } from '../federated/federated-identity.model';
import { FederatedLoginAttempt } from '../federated/federated-login-attempt.model';
import { FederatedRegistrationTicket } from '../federated/federated-registration-ticket.model';
import { FederatedRegistration } from '../federated/federated-registration.model';
import { OAuthClientAuthentication } from '../oauth/oauth-client-authentication.model';

const PUBLIC_URL: string = 'http://zibri.test';
const CLIENT_ID: string = 'zibri-test-client';
const CLIENT_SECRET: string = 'zibri-test-secret';
const REDIRECT_TO: string = 'https://app.example.com/signed-in';
const REGISTRATION_URL: string = 'https://app.example.com/register';
const ERROR_URL: string = 'https://app.example.com/sign-in-failed';
const ADMINS_GROUP: string = 'app-admins';
const BLOCKED_GROUP: string = 'app-blocked';
const MFA_METHOD: string = 'mfa';
const MFA_CONTEXT_CLASS: string = 'urn:example:mfa';

let groupsProvider: FakeOAuthProvider;
let pairwiseProvider: FakeOAuthProvider;

/**
 * Keeps the roles of a user in step with the groups the provider proves, turns a blocked one away, and
 * asks the provider for a second factor.
 */
class GroupsProviderAuthenticator extends BaseOidcAuthenticator<string, JwtUser> {
    readonly name: string = 'groups';

    readonly clientId: string = CLIENT_ID;

    readonly clientAuthentication: OAuthClientAuthentication = { method: 'client_secret_basic', clientSecret: CLIENT_SECRET };

    readonly authenticationTime: OidcAuthenticationTime = 'auth_time';

    override readonly acrValues: string[] = [MFA_CONTEXT_CLASS];

    get issuer(): string {
        return groupsProvider.issuer;
    }

    protected override async resolveSignInUser(
        claims: Record<string, unknown>,
        user: JwtUser,
        transaction: Transaction | undefined
    ): Promise<JwtUser> {
        const groups: unknown = claims['groups'];
        const names: string[] = Array.isArray(groups) ? groups.filter((group): group is string => typeof group === 'string') : [];
        if (names.includes(BLOCKED_GROUP)) {
            throw new ForbiddenError($ts`Your account has no access to this application.`);
        }
        const roles: Roles[] = names.includes(ADMINS_GROUP) ? [Roles.ADMIN] : [Roles.USER];
        return await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser)).updateById(user.id, { roles }, { transaction });
    }
}

/**
 * Knows its identities by the `oid` claim, as a provider whose `sub` differs per client is known by.
 */
class PairwiseProviderAuthenticator extends BaseOidcAuthenticator<string, JwtUser> {
    readonly name: string = 'pairwise';

    readonly clientId: string = CLIENT_ID;

    readonly clientAuthentication: OAuthClientAuthentication = { method: 'client_secret_basic', clientSecret: CLIENT_SECRET };

    readonly authenticationTime: OidcAuthenticationTime = 'auth_time';

    override readonly subjectClaim: string = 'oid';

    get issuer(): string {
        return pairwiseProvider.issuer;
    }
}

/**
 * What a registration answers, for the cases to read what it was handed.
 */
type Registered = {
    subject: string,
    claims: Record<string, unknown>
};

@Auth.skip({ allowRedundant: true })
@Controller('/register', { allowOrphan: true })
class RegistrationController {
    @Post('/groups')
    async registerAtGroups(
        @Body(FederatedTicketCredentials)
        credentials: FederatedTicketCredentials
    ): Promise<Registered> {
        return await register(GroupsProviderAuthenticator, credentials);
    }

    @Post('/pairwise')
    async registerAtPairwise(
        @Body(FederatedTicketCredentials)
        credentials: FederatedTicketCredentials
    ): Promise<Registered> {
        return await register(PairwiseProviderAuthenticator, credentials);
    }
}

// registers and logs in with jwts, the way an application handing the login over does
@Auth.skip({ allowRedundant: true })
@Controller('/register-jwt', { allowOrphan: true })
class JwtRegistrationController {
    @Post('/')
    async register(
        @Body(FederatedTicketCredentials)
        credentials: FederatedTicketCredentials
    ): Promise<JwtAuthData<string>> {
        await register(GroupsProviderAuthenticator, credentials);
        return await inject(ZIBRI_DI_TOKENS.AUTH_SERVICE).login(GroupsProviderAuthenticator, JwtAuthStrategy, credentials, undefined);
    }
}

// routes counting a second factor presented at the provider, by its method, by its class, or not at all
@Controller('/guarded', { allowOrphan: true })
class GuardedController {
    @Auth.require2fa({ providerFactors: { methods: [MFA_METHOD] } })
    @Get('/by-method')
    byMethod(): { ok: boolean } {
        return { ok: true };
    }

    @Auth.require2fa({ providerFactors: { contextClasses: [MFA_CONTEXT_CLASS] } })
    @Get('/by-class')
    byClass(): { ok: boolean } {
        return { ok: true };
    }

    @Auth.require2fa()
    @Get('/by-nothing')
    byNothing(): { ok: boolean } {
        return { ok: true };
    }
}

@Controller('/auth', { allowOrphan: true, versions: 'all' })
class CookieClaimsAuthController extends AuthController({
        strategies: [CookieAuthStrategy],
        authenticators: [GroupsProviderAuthenticator, PairwiseProviderAuthenticator],
        twoFactorMethods: [OtpTwoFactorMethod]
    }) {}

@Controller('/auth', { allowOrphan: true, versions: 'all' })
class JwtClaimsAuthController extends AuthController({
        strategies: [JwtAuthStrategy],
        authenticators: [GroupsProviderAuthenticator, PairwiseProviderAuthenticator],
        twoFactorMethods: [OtpTwoFactorMethod]
    }) {}

let server: StartedTestServer;
let baseUrl: string;

/**
 * Creates the user a first sign-in becomes, links the identity, and answers what the registration read.
 * @param authenticator - The provider the sign-in came through.
 * @param credentials - The ticket.
 * @returns Who the provider said signed in.
 */
async function register(
    authenticator: typeof GroupsProviderAuthenticator | typeof PairwiseProviderAuthenticator,
    credentials: FederatedTicketCredentials
): Promise<Registered> {
    const authService: AuthServiceInterface = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
    const registration: FederatedRegistration = await authService.resolveRegistration(authenticator, credentials, undefined);
    const user: JwtUser = await inject(repositoryTokenFor(JwtUser)).create({ email: registration.email ?? '', roles: [Roles.USER] });
    await authService.linkIdentity(authenticator, credentials, user.id, undefined);
    return { subject: registration.subject, claims: registration.claims };
}

/**
 * Starts an application signing in through the fake providers.
 * @param strategy - The strategy the sign-ins log in with.
 * @param controllers - The controllers, which go with that strategy.
 */
async function startApp(strategy: typeof CookieAuthStrategy | typeof JwtAuthStrategy, controllers: Newable<unknown>[]): Promise<void> {
    server = await startTestServer({
        baseUrl: PUBLIC_URL,
        dataSources: [
            createInMemoryDataSource({
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
            })
        ],
        authStrategies: [strategy],
        authenticators: [GroupsProviderAuthenticator, PairwiseProviderAuthenticator],
        controllers,
        providers: [
            ...defaultTestServerProviders,
            defineProvider({ token: ZIBRI_DI_TOKENS.COOKIE_SIGN_SECRET, useFactory: () => 'test-cookie-secret' }),
            defineProvider({
                token: ZIBRI_DI_TOKENS.FEDERATION_OPTIONS,
                useValue: {
                    allowedRedirects: ['https://app.example.com'],
                    registrationUrl: REGISTRATION_URL,
                    errorUrl: ERROR_URL,
                    maxAuthenticationAgeInMs: 3600000
                }
            })
        ]
    });
    baseUrl = await server.start();
}

/**
 * A browser on the application, which resolves its public url to where the server listens.
 * @returns The browser.
 */
function newBrowser(): TestBrowser {
    return new TestBrowser(baseUrl, PUBLIC_URL);
}

/**
 * Signs in at a provider, the way a browser does, and answers where the callback sent it.
 * @param browser - The browser.
 * @param authenticator - The provider's name.
 * @returns Where the browser landed.
 */
async function signIn(browser: TestBrowser, authenticator: string): Promise<string> {
    const query: string = new URLSearchParams({ authenticator, redirectTo: REDIRECT_TO }).toString();
    const atProvider: string = await browser.follow(`${baseUrl}/auth/federated/authorize?${query}`);
    return await browser.follow(await browser.follow(atProvider));
}

/**
 * Whether a browser holds a login, which only a session answers the csrf token to.
 * @param browser - The browser.
 * @returns True when it is logged in.
 */
async function isLoggedIn(browser: TestBrowser): Promise<boolean> {
    return (await browser.open(`${baseUrl}/auth/csrf-token`)).status === 200;
}

/**
 * Creates a user linked to an identity at a provider.
 * @param subject - Who the user is there.
 * @param at - The provider.
 * @returns The user.
 */
async function createLinkedUser(subject: string, at: FakeOAuthProvider): Promise<JwtUser> {
    const user: JwtUser = await inject(repositoryTokenFor(JwtUser)).create({ email: `${subject}@example.com`, roles: [Roles.USER] });
    await inject<Repository<FederatedIdentity, FederatedIdentityCreateData>>(repositoryTokenFor(FederatedIdentity))
        .create({ issuer: at.issuer, subject, userId: user.id, signIn: true, grantedScopes: [] });
    return user;
}

/**
 * Registers the identity a landing names the ticket of.
 * @param browser - The browser that signed in.
 * @param landing - Where the sign-in landed.
 * @param path - The registration route.
 * @param codeVerifier - The verifier of the sign-in's PKCE challenge, when it was started with one.
 * @returns What it answered.
 */
async function registerFrom<T>(browser: TestBrowser, landing: string, path: string, codeVerifier?: string): Promise<T> {
    expect(landing.startsWith(`${REGISTRATION_URL}?ticket=`)).toBe(true);
    const res: Response = await browser.open(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { [KnownHeader.CONTENT_TYPE]: MimeType.JSON },
        body: JsonUtilities.stringify({ ticket: new URL(landing).searchParams.get('ticket'), codeVerifier })
    });
    expect(res.status).toBe(200);
    return await res.json() as T;
}

/**
 * Calls a guarded route with the cookies of a browser.
 * @param browser - The browser.
 * @param path - The route below `/guarded`.
 * @returns The status.
 */
async function guarded(browser: TestBrowser, path: string): Promise<number> {
    return (await browser.open(`${baseUrl}/guarded${path}`)).status;
}

/**
 * Refreshes the login of a browser the way the frontend does once its access session ran out, which
 * rotates it.
 * @param browser - The browser.
 * @param userId - The user it is logged in as, whose only login it is.
 */
async function rotateLogin(browser: TestBrowser, userId: string): Promise<void> {
    const { csrfToken }: Pick<CookieAuthData<string>, 'csrfToken'> = await (await browser.open(`${baseUrl}/auth/csrf-token`)).json() as CookieAuthData<string>;
    await inject(repositoryTokenFor(CookieAuthSession)).updateAll({ userId }, { expirationDate: new Date(Date.now() - 1000) });
    const res: Response = await browser.open(`${baseUrl}/auth/refresh-login`, {
        method: 'POST',
        headers: { [KnownHeader.CONTENT_TYPE]: MimeType.JSON, 'x-csrf-token': csrfToken },
        body: '{}'
    });
    expect(res.status).toBe(200);
}

/**
 * The roles a user holds now.
 * @param user - The user.
 * @returns The roles.
 */
async function rolesOf(user: JwtUser): Promise<string[]> {
    return (await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser)).findById(user.id)).roles;
}

/**
 * A fresh subject, so the cases do not see each other's links.
 * @param prefix - What it starts with.
 * @returns The subject.
 */
function newSubject(prefix: string = 'subject'): string {
    return `${prefix}-${randomBytes(6).toString('hex')}`;
}

beforeAll(async () => {
    groupsProvider = await startFakeOAuthProvider({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
    pairwiseProvider = await startFakeOAuthProvider({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
});

afterAll(async () => {
    await groupsProvider?.stop();
    await pairwiseProvider?.stop();
});

describe('BaseOidcAuthenticator - what the provider proved', () => {
    beforeAll(async () => {
        await startApp(CookieAuthStrategy, [CookieClaimsAuthController, RegistrationController, GuardedController]);
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    it('keeps the roles of a linked user in step with the groups the provider proves', async () => {
        const subject: string = newSubject();
        const user: JwtUser = await createLinkedUser(subject, groupsProvider);
        groupsProvider.identity = { subject, claims: { groups: [ADMINS_GROUP] } };

        expect(await signIn(newBrowser(), 'groups')).toBe(REDIRECT_TO);
        expect(await rolesOf(user)).toEqual([Roles.ADMIN]);

        // taken out of the group at the provider
        groupsProvider.identity = { subject, claims: { groups: [] } };
        expect(await signIn(newBrowser(), 'groups')).toBe(REDIRECT_TO);
        expect(await rolesOf(user)).toEqual([Roles.USER]);
    });

    it('turns a linked user away when the authenticator refuses the sign-in', async () => {
        const subject: string = newSubject();
        await createLinkedUser(subject, groupsProvider);
        groupsProvider.identity = { subject, claims: { groups: [BLOCKED_GROUP] } };
        const browser: TestBrowser = newBrowser();

        expect(await signIn(browser, 'groups')).toBe(`${ERROR_URL}?error=refused`);
        expect(await isLoggedIn(browser)).toBe(false);
    });

    it('hands the registration every claim the provider proved', async () => {
        const subject: string = newSubject();
        groupsProvider.identity = { subject, email: `${subject}@example.com`, claims: { groups: ['staff'], hd: 'corp.example' } };
        const browser: TestBrowser = newBrowser();

        const registered: Registered = await registerFrom(browser, await signIn(browser, 'groups'), '/register/groups');

        expect(registered.subject).toBe(subject);
        expect(registered.claims).toEqual(expect.objectContaining({
            sub: subject,
            email: `${subject}@example.com`,
            groups: ['staff'],
            hd: 'corp.example'
        }));
    });

    it('knows an identity by the claim subjectClaim names, whichever sub the provider sends', async () => {
        const oid: string = newSubject('oid');
        pairwiseProvider.identity = { subject: newSubject('web'), claims: { oid } };
        const browser: TestBrowser = newBrowser();

        const registered: Registered = await registerFrom(browser, await signIn(browser, 'pairwise'), '/register/pairwise');
        expect(registered.subject).toBe(oid);

        // the same person, under another sub
        pairwiseProvider.identity = { subject: newSubject('other'), claims: { oid } };
        const again: TestBrowser = newBrowser();
        expect(await signIn(again, 'pairwise')).toBe(REDIRECT_TO);
        expect(await isLoggedIn(again)).toBe(true);
    });

    it('refuses a sign-in whose ID token lacks the claim the identity is known by', async () => {
        pairwiseProvider.identity = { subject: newSubject('no-oid') };

        expect(await signIn(newBrowser(), 'pairwise')).toBe(`${ERROR_URL}?error=invalid`);
    });

    it('takes the second factor presented at the provider on a route that counts its method, across a refresh', async () => {
        const subject: string = newSubject();
        const user: JwtUser = await createLinkedUser(subject, groupsProvider);
        groupsProvider.identity = { subject, claims: { amr: ['pwd', MFA_METHOD] } };
        const browser: TestBrowser = newBrowser();
        expect(await signIn(browser, 'groups')).toBe(REDIRECT_TO);

        expect(await guarded(browser, '/by-method')).toBe(200);
        expect(await guarded(browser, '/by-class')).toBe(401);
        expect(await guarded(browser, '/by-nothing')).toBe(401);

        await rotateLogin(browser, user.id);
        expect(await guarded(browser, '/by-method')).toBe(200);
    });

    it('takes it by the class of the authentication', async () => {
        const subject: string = newSubject();
        await createLinkedUser(subject, groupsProvider);
        groupsProvider.identity = { subject, claims: { acr: MFA_CONTEXT_CLASS } };
        const browser: TestBrowser = newBrowser();
        expect(await signIn(browser, 'groups')).toBe(REDIRECT_TO);

        expect(await guarded(browser, '/by-class')).toBe(200);
        expect(await guarded(browser, '/by-method')).toBe(401);
    });

    it('refuses a login whose provider reports a password alone, or nothing', async () => {
        const subject: string = newSubject();
        await createLinkedUser(subject, groupsProvider);
        groupsProvider.identity = { subject, claims: { amr: ['pwd'] } };
        const password: TestBrowser = newBrowser();
        expect(await signIn(password, 'groups')).toBe(REDIRECT_TO);
        expect(await guarded(password, '/by-method')).toBe(401);

        groupsProvider.identity = { subject };
        const silent: TestBrowser = newBrowser();
        expect(await signIn(silent, 'groups')).toBe(REDIRECT_TO);
        expect(await guarded(silent, '/by-method')).toBe(401);
    });

    it('asks the provider for the classes of authentication the authenticator names', async () => {
        await newBrowser().follow(`${baseUrl}/auth/federated/authorize?${new URLSearchParams({ authenticator: 'groups', redirectTo: REDIRECT_TO }).toString()}`);

        expect(groupsProvider.authorizationRequests.at(-1)?.get('acr_values')).toBe(MFA_CONTEXT_CLASS);
    });
});

describe('BaseOidcAuthenticator - what the provider proved, logging in with jwts', () => {
    beforeAll(async () => {
        await startApp(JwtAuthStrategy, [JwtClaimsAuthController, JwtRegistrationController, GuardedController]);
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    /**
     * Calls a guarded route with an access token.
     * @param path - The route below `/guarded`.
     * @param accessToken - The token.
     * @returns The status.
     */
    async function guardedWith(path: string, accessToken: string): Promise<number> {
        return (await fetch(`${baseUrl}/guarded${path}`, { headers: { authorization: `Bearer ${accessToken}` } })).status;
    }

    it('carries the factor into the jwt login a registration starts, and across its refresh', async () => {
        const subject: string = newSubject();
        groupsProvider.identity = { subject, email: `${subject}@example.com`, claims: { amr: [MFA_METHOD] } };
        const browser: TestBrowser = newBrowser();
        // a jwt login is handed over by code, so the sign-in starts with a PKCE challenge and the
        // ticket is spent with its verifier
        const codeVerifier: string = randomBytes(32).toString('base64url');
        const codeChallenge: string = createHash('sha256').update(codeVerifier)
            .digest('base64url');
        const query: string = new URLSearchParams({ authenticator: 'groups', redirectTo: REDIRECT_TO, codeChallenge }).toString();
        const atProvider: string = await browser.follow(`${baseUrl}/auth/federated/authorize?${query}`);
        const landing: string = await browser.follow(await browser.follow(atProvider));

        const tokens: JwtAuthData<string> = await registerFrom(browser, landing, '/register-jwt', codeVerifier);
        expect(await guardedWith('/by-method', tokens.accessToken.value)).toBe(200);
        expect(await guardedWith('/by-nothing', tokens.accessToken.value)).toBe(401);

        const refreshed: Response = await fetch(`${baseUrl}/auth/refresh-login`, {
            method: 'POST',
            headers: { [KnownHeader.CONTENT_TYPE]: MimeType.JSON },
            body: JsonUtilities.stringify({ refreshToken: tokens.refreshToken.value })
        });
        expect(refreshed.status).toBe(200);
        expect(await guardedWith('/by-method', (await refreshed.json() as JwtAuthData<string>).accessToken.value)).toBe(200);
    });
});