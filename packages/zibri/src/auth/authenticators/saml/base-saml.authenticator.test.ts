import { createHash, randomBytes } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFakeKeyPair, createInMemoryDataSource, FakeKeyPair, FakeSamlAnswer, FakeSamlBackChannelAnswer, FakeSamlLogoutForm, FakeSamlLogoutResponse, FakeSamlProvider, InMemoryDataSource, startFakeSamlProvider, TestBrowser } from 'zibri-testing';

import { BaseSamlAuthenticator } from './base-saml.authenticator.ts';
import { SamlIdentityProvider } from './saml-identity-provider.model.ts';
import { SamlKeyPair } from './saml-key-pair.model.ts';
import { JwtUser } from '../../../__testing__/mocks/entities/jwt-user.entity.ts';
import { Roles } from '../../../__testing__/mocks/entities/roles.enum.ts';
import { defaultTestServerEntities } from '../../../__testing__/test-server/create-test-data-source.function.ts';
import { defaultTestServerProviders } from '../../../__testing__/test-server/providers.ts';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function.ts';
import { Repository } from '../../../data-source/repository/repository.ts';
import { Transaction } from '../../../data-source/transaction/transaction.model.ts';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../../di/inject.function.ts';
import { defineProvider } from '../../../di/models/di-provider.model.ts';
import { KnownHeader } from '../../../http/known-header.enum.ts';
import { MimeType } from '../../../http/mime-type.enum.ts';
import { Body } from '../../../routing/decorators/body.decorator.ts';
import { Controller } from '../../../routing/decorators/controller.decorator.ts';
import { Post } from '../../../routing/decorators/post.decorator.ts';
import { Newable } from '../../../types/newable.type.ts';
import { JsonUtilities } from '../../../utilities/json.utilities.ts';
import { OtpTwoFactorMethod } from '../../2fa/methods/otp/otp.two-factor-method.ts';
import { AuthController } from '../../auth-controller/auth-controller.model.ts';
import { type AuthServiceInterface } from '../../auth-service.interface.ts';
import { Auth } from '../../decorators/auth.decorator.ts';
import { LogoutResult } from '../../models/logout-result.model.ts';
import { CookieAuthData } from '../../strategies/cookie/cookie-auth-data.model.ts';
import { CookieAuthRefreshSession } from '../../strategies/cookie/cookie-auth-refresh-session.model.ts';
import { CookieAuthSession } from '../../strategies/cookie/cookie-auth-session.model.ts';
import { CookieAuthStrategy } from '../../strategies/cookie/cookie-auth.auth-strategy.ts';
import { JwtAuthData } from '../../strategies/jwt/jwt-auth-data.model.ts';
import { JwtAuthStrategy } from '../../strategies/jwt/jwt.auth-strategy.ts';
import { FederatedConnectionCode } from '../federated/federated-connection-code.model.ts';
import { FederatedTicketCredentials } from '../federated/federated-credentials.model.ts';
import { FederatedHandoverCode } from '../federated/federated-handover-code.model.ts';
import { FederatedIdentity, FederatedIdentityCreateData } from '../federated/federated-identity.model.ts';
import { FederatedLoginAttempt } from '../federated/federated-login-attempt.model.ts';
import { FederatedRegistrationTicket } from '../federated/federated-registration-ticket.model.ts';
import { FederatedRegistration } from '../federated/federated-registration.model.ts';
import { FederationOptions } from '../federated/federation-options.model.ts';

// where the application is reached from the outside, as its baseUrl, which a browser here resolves to
// wherever the server ended up listening
const PUBLIC_URL: string = 'http://zibri.test';
const SP_ENTITY_ID: string = 'https://app.example.com/saml';
const REDIRECT_TO: string = 'https://app.example.com/signed-in';
const REGISTRATION_URL: string = 'https://app.example.com/register';
const ERROR_URL: string = 'https://app.example.com/sign-in-failed';
const SIGNED_OUT_URL: string = 'https://app.example.com/signed-out';
const MAX_AUTHENTICATION_AGE_IN_MS: number = 3600000;

let idp: FakeSamlProvider;
let strictIdp: FakeSamlProvider;
// answers a logout of the application with a page that posts the answer
let postAnsweringIdp: FakeSamlProvider;
// takes logouts as posted forms only
let postOnlyIdp: FakeSamlProvider;
let signingKey: FakeKeyPair;
let decryptionKey: FakeKeyPair;

class CompanyAuthenticator extends BaseSamlAuthenticator<Roles, JwtUser> {
    readonly name: string = 'company';

    readonly entityId: string = SP_ENTITY_ID;

    get issuer(): string {
        return idp.entityId;
    }

    get identityProvider(): SamlIdentityProvider {
        return { metadataUrl: idp.metadataUrl };
    }
}

// signs its requests and has the assertions encrypted to it, with the provider given by hand
class StrictAuthenticator extends BaseSamlAuthenticator<Roles, JwtUser> {
    readonly name: string = 'strict';

    readonly entityId: string = SP_ENTITY_ID;

    get issuer(): string {
        return strictIdp.entityId;
    }

    get identityProvider(): SamlIdentityProvider {
        return { signInUrl: strictIdp.signInUrl, certificates: [strictIdp.certificate], logoutUrl: strictIdp.logoutUrl };
    }

    // read as the authenticator is built, which is once the keys are made
    override readonly signingKey: SamlKeyPair = signingKey;

    override readonly decryptionKey: SamlKeyPair = decryptionKey;
}

class PostAnsweringAuthenticator extends BaseSamlAuthenticator<Roles, JwtUser> {
    readonly name: string = 'post-answering';

    readonly entityId: string = SP_ENTITY_ID;

    get issuer(): string {
        return postAnsweringIdp.entityId;
    }

    get identityProvider(): SamlIdentityProvider {
        return { metadataUrl: postAnsweringIdp.metadataUrl };
    }
}

// signs what it sends, which for a provider taking posted forms is the answer inside the form
class PostOnlyAuthenticator extends BaseSamlAuthenticator<Roles, JwtUser> {
    readonly name: string = 'post-only';

    readonly entityId: string = SP_ENTITY_ID;

    get issuer(): string {
        return postOnlyIdp.entityId;
    }

    get identityProvider(): SamlIdentityProvider {
        return { metadataUrl: postOnlyIdp.metadataUrl };
    }

    override readonly signingKey: SamlKeyPair = signingKey;
}

// trusts the metadata of the fake provider for an entity it is not
class ElsewhereAuthenticator extends BaseSamlAuthenticator<Roles, JwtUser> {
    readonly name: string = 'elsewhere';

    readonly entityId: string = SP_ENTITY_ID;

    readonly issuer: string = 'https://idp.elsewhere.example.com';

    get identityProvider(): SamlIdentityProvider {
        return { metadataUrl: idp.metadataUrl };
    }
}

// the auth routes of the identity providers, logging in with cookies or with jwts. Orphans for the
// cases that boot with the other
@Controller('/auth', { allowOrphan: true, versions: 'all' })
class CookieSamlAuthController extends AuthController({
        strategies: [CookieAuthStrategy],
        authenticators: [CompanyAuthenticator, StrictAuthenticator, PostAnsweringAuthenticator, PostOnlyAuthenticator, ElsewhereAuthenticator],
        twoFactorMethods: [OtpTwoFactorMethod]
    }) {}

@Controller('/auth', { allowOrphan: true, versions: 'all' })
class JwtSamlAuthController extends AuthController({
        strategies: [JwtAuthStrategy],
        authenticators: [CompanyAuthenticator, StrictAuthenticator, PostAnsweringAuthenticator, PostOnlyAuthenticator, ElsewhereAuthenticator],
        twoFactorMethods: [OtpTwoFactorMethod]
    }) {}

@Auth.skip({ allowRedundant: true })
@Controller('/register', { allowOrphan: true })
class RegistrationController {
    // what an application writes: read who signed in, create the user and link the identity in one
    // transaction, and log in once that is committed
    @Post('/')
    async register(
        @Body(FederatedTicketCredentials)
        credentials: FederatedTicketCredentials
    ): Promise<CookieAuthData<string>> {
        const authService: AuthServiceInterface = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
        const users: Repository<JwtUser> = inject(repositoryTokenFor(JwtUser));
        const transaction: Transaction = await users.dataSource.startTransaction();
        try {
            const registration: FederatedRegistration = await authService.resolveRegistration(CompanyAuthenticator, credentials, transaction);
            const user: JwtUser = await users.create({ email: registration.email ?? '', roles: [Roles.USER] }, { transaction });
            await authService.linkIdentity(CompanyAuthenticator, credentials, user.id, transaction);
            await transaction.commit();
        }
        catch (error) {
            await transaction.rollback();
            throw error;
        }
        return await authService.login(CompanyAuthenticator, CookieAuthStrategy, credentials, undefined);
    }
}

/**
 * The hops of one sign-in.
 */
type SignIn = {
    /**
     * What the identity provider answered, the form its page posts.
     */
    answer: FakeSamlAnswer,
    /**
     * Where the callback sends the browser.
     */
    landing: string
};

let baseUrl: string;

/**
 * A browser on the application, which resolves its public url to where the server listens.
 * @returns The browser.
 */
function newBrowser(): TestBrowser {
    return new TestBrowser(baseUrl, PUBLIC_URL);
}

/**
 * The authorize route of a provider.
 * @param provider - The name of the provider.
 * @param query - Anything else to ask.
 * @returns The url.
 */
function authorizeUrl(provider: string, query: Record<string, string> = {}): string {
    return `${baseUrl}/auth/federated/authorize?${new URLSearchParams({ authenticator: provider, redirectTo: REDIRECT_TO, ...query }).toString()}`;
}

/**
 * Has the browser post an answer of the identity provider to the callback, the way the provider's page does.
 * @param browser - The browser.
 * @param answer - The answer.
 * @param from - The origin of the page that posts it.
 * @returns Where the callback sends the browser.
 */
async function postAnswer(browser: TestBrowser, answer: FakeSamlAnswer, from: string): Promise<string> {
    // the answer names the public url, which the browser resolves to where the server listens
    return await browser.follow(answer.url, {
        method: 'POST',
        headers: { [KnownHeader.CONTENT_TYPE]: MimeType.FORM_URL_ENCODED },
        body: answer.fields,
        crossSiteFrom: from
    });
}

/**
 * Has the browser go to the identity provider and read its answer, without posting it yet.
 * @param browser - The browser.
 * @param url - The authorize route.
 * @param at - The identity provider.
 * @returns The answer.
 */
async function askProvider(browser: TestBrowser, url: string, at: FakeSamlProvider): Promise<FakeSamlAnswer> {
    const atProvider: string = await browser.follow(url);
    const res: Response = await browser.open(atProvider);
    expect(res.status).toBe(200);
    const answer: FakeSamlAnswer | undefined = at.answers.at(-1);
    if (answer == undefined) {
        throw new Error('The identity provider did not answer.');
    }
    return answer;
}

/**
 * Signs in at the identity provider, the way a browser does: to the authorize route, on to the
 * provider, and its answer posted back to the callback.
 * @param browser - The browser.
 * @param url - The authorize route.
 * @param at - The identity provider.
 * @returns The hops.
 */
async function signIn(browser: TestBrowser, url: string, at: FakeSamlProvider = idp): Promise<SignIn> {
    const answer: FakeSamlAnswer = await askProvider(browser, url, at);
    return { answer, landing: await postAnswer(browser, answer, new URL(at.entityId).origin) };
}

/**
 * Creates a user, linked to the NameID the provider signs in next.
 * @param at - The identity provider the user is linked at.
 * @returns The user.
 */
async function createLinkedUser(at: FakeSamlProvider = idp): Promise<JwtUser> {
    const nameId: string = `name-id-${randomBytes(6).toString('hex')}`;
    const user: JwtUser = await inject(repositoryTokenFor(JwtUser)).create({ email: `${nameId}@example.com`, roles: [Roles.USER] });
    await inject<Repository<FederatedIdentity, FederatedIdentityCreateData>>(repositoryTokenFor(FederatedIdentity))
        .create({ issuer: at.entityId, subject: nameId, userId: user.id, signIn: true, grantedScopes: [] });
    at.identity = { nameId, attributes: { email: `${nameId}@example.com` } };
    return user;
}

/**
 * The error a sign-in landed on the error url with.
 * @param landing - Where the sign-in landed.
 * @returns The error, or undefined when it did not land on the error url.
 */
function errorOf(landing: string): string | undefined {
    return landing.startsWith(ERROR_URL) ? new URL(landing).searchParams.get('error') ?? undefined : undefined;
}

/**
 * Reads the user a browser is logged in as.
 * @param browser - The browser.
 * @returns Whether it holds a session the application takes.
 */
async function isLoggedIn(browser: TestBrowser): Promise<boolean> {
    const res: Response = await browser.open(`${baseUrl}/auth/csrf-token`);
    return res.status === 200;
}

/**
 * Logs a browser out the way the frontend does, with the cookies of its login.
 * @param browser - The browser.
 * @returns What the logout answers.
 */
async function logOut(browser: TestBrowser): Promise<LogoutResult> {
    const res: Response = await browser.open(`${baseUrl}/auth/logout`, {
        method: 'POST',
        headers: { [KnownHeader.CONTENT_TYPE]: MimeType.JSON },
        body: JsonUtilities.stringify({ clearCookies: true })
    });
    expect(res.status).toBe(200);
    // eslint-disable-next-line typescript/no-unsafe-return
    return await res.json();
}

/**
 * Refreshes the login of a browser the way the frontend does once its access session ran out, which
 * rotates it.
 * @param browser - The browser.
 * @param userId - The user it is logged in as, whose only login it is.
 */
async function rotateLogin(browser: TestBrowser, userId: string): Promise<void> {
    // eslint-disable-next-line typescript/no-unsafe-assignment
    const { csrfToken }: Pick<CookieAuthData<string>, 'csrfToken'> = await (await browser.open(`${baseUrl}/auth/csrf-token`)).json();
    await inject(repositoryTokenFor(CookieAuthSession)).updateAll({ userId }, { expirationDate: new Date(Date.now() - 1000) });
    const res: Response = await browser.open(`${baseUrl}/auth/refresh-login`, {
        method: 'POST',
        headers: { [KnownHeader.CONTENT_TYPE]: MimeType.JSON, 'x-csrf-token': csrfToken },
        body: '{}'
    });
    expect(res.status).toBe(200);
    expect(await isLoggedIn(browser)).toBe(true);
}

/**
 * Starts an application signing in through the fake identity providers.
 * @param strategy - The strategy the sign-ins log in with.
 * @param controllers - The controllers, which go with that strategy.
 * @returns The server, started.
 */
async function startApp(strategy: typeof CookieAuthStrategy | typeof JwtAuthStrategy, controllers: Newable<unknown>[]): Promise<StartedTestServer> {
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
    const federationOptions: FederationOptions = {
        allowedRedirects: ['https://app.example.com'],
        registrationUrl: REGISTRATION_URL,
        errorUrl: ERROR_URL,
        signedOutUrl: SIGNED_OUT_URL,
        maxAuthenticationAgeInMs: MAX_AUTHENTICATION_AGE_IN_MS
    };
    const server: StartedTestServer = await startTestServer({
        baseUrl: PUBLIC_URL,
        dataSources: [dataSourceClass],
        authStrategies: [strategy],
        authenticators: [CompanyAuthenticator, StrictAuthenticator, PostAnsweringAuthenticator, PostOnlyAuthenticator, ElsewhereAuthenticator],
        controllers,
        providers: [
            ...defaultTestServerProviders,
            defineProvider({ token: ZIBRI_DI_TOKENS.COOKIE_SIGN_SECRET, useFactory: () => 'test-cookie-secret' }),
            defineProvider({ token: ZIBRI_DI_TOKENS.FEDERATION_OPTIONS, useValue: federationOptions })
        ]
    });
    baseUrl = await server.start();
    return server;
}

beforeAll(async () => {
    signingKey = await createFakeKeyPair('CN=Zibri test service provider signing');
    decryptionKey = await createFakeKeyPair('CN=Zibri test service provider encryption');
    idp = await startFakeSamlProvider({
        serviceProviderEntityId: SP_ENTITY_ID,
        serviceProviderLogoutUrl: `${PUBLIC_URL}/auth/federated/company/logout`
    });
    strictIdp = await startFakeSamlProvider({
        serviceProviderEntityId: SP_ENTITY_ID,
        signs: 'both',
        encryptsTo: decryptionKey.certificate,
        requiresRequestsSignedBy: signingKey.certificate,
        serviceProviderLogoutUrl: `${PUBLIC_URL}/auth/federated/strict/logout`
    });
    postAnsweringIdp = await startFakeSamlProvider({
        serviceProviderEntityId: SP_ENTITY_ID,
        serviceProviderLogoutUrl: `${PUBLIC_URL}/auth/federated/post-answering/logout`,
        answersLogoutWith: 'post'
    });
    postOnlyIdp = await startFakeSamlProvider({
        serviceProviderEntityId: SP_ENTITY_ID,
        requiresRequestsSignedBy: signingKey.certificate,
        serviceProviderLogoutUrl: `${PUBLIC_URL}/auth/federated/post-only/logout`,
        logoutBindings: ['post']
    });
}, 15000);

afterAll(async () => {
    // each on its own, so one that never started leaves no other listening
    await idp?.stop();
    await strictIdp?.stop();
    await postAnsweringIdp?.stop();
    await postOnlyIdp?.stop();
}, 15000);

/**
 * Has a browser post a logout form of the identity provider to the logout route, the way the
 * provider's page does.
 * @param browser - The browser.
 * @param form - The form.
 * @param at - The identity provider whose page posts it.
 * @returns The answer of the logout route.
 */
async function postLogout(browser: TestBrowser, form: FakeSamlLogoutForm, at: FakeSamlProvider): Promise<Response> {
    return await browser.open(form.url, {
        method: 'POST',
        headers: { [KnownHeader.CONTENT_TYPE]: MimeType.FORM_URL_ENCODED },
        body: form.fields,
        crossSiteFrom: new URL(at.entityId).origin
    });
}

/**
 * Reads the form a page of the application posts on its own, as the HTTP-POST binding sends it.
 * @param html - The page.
 * @returns Where it posts and what.
 */
function readAutoPostedForm(html: string): FakeSamlLogoutForm {
    const action: string = /<form[^>]*action="([^"]*)"/.exec(html)?.[1] ?? '';
    const fields: URLSearchParams = new URLSearchParams();
    for (const [, name, value] of html.matchAll(/<input[^>]*name="([^"]*)"[^>]*value="([^"]*)"/g)) {
        fields.set(name ?? '', (value ?? '').replaceAll('&quot;', '"')
            .replaceAll('&lt;', '<')
            .replaceAll('&gt;', '>')
            .replaceAll('&amp;', '&'));
    }
    return { url: action.replaceAll('&amp;', '&'), fields };
}

describe('BaseSamlAuthenticator', () => {
    let server: StartedTestServer;

    beforeAll(async () => {
        server = await startApp(CookieAuthStrategy, [CookieSamlAuthController, RegistrationController]);
    }, 30000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    it('signs a linked user in, asking for a persistent NameID, and reads the metadata once', async () => {
        await createLinkedUser();
        const reads: number = idp.metadataReads;
        const browser: TestBrowser = newBrowser();

        const { landing } = await signIn(browser, authorizeUrl('company'));

        expect(landing).toBe(REDIRECT_TO);
        expect(await isLoggedIn(browser)).toBe(true);
        expect(idp.requests.at(-1)).toMatchObject({
            issuer: SP_ENTITY_ID,
            assertionConsumerServiceUrl: `${PUBLIC_URL}/auth/federated/company/callback`,
            forceAuthn: false,
            nameIdFormat: 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent'
        });
        await createLinkedUser();
        expect((await signIn(newBrowser(), authorizeUrl('company'))).landing).toBe(REDIRECT_TO);
        // read for the first sign-in this application did at all, and kept since
        expect(idp.metadataReads - reads).toBeLessThanOrEqual(1);
    });

    it('sends a user nobody is linked to to the registration, with what the provider reports, and logs them in from there', async () => {
        const nameId: string = `new-${randomBytes(6).toString('hex')}`;
        idp.identity = { nameId, attributes: { mail: `${nameId}@example.com`, givenName: 'Ada', sn: 'Lovelace' } };
        const browser: TestBrowser = newBrowser();

        const { landing } = await signIn(browser, authorizeUrl('company'));

        expect(landing.startsWith(REGISTRATION_URL)).toBe(true);
        const ticket: string = new URL(landing).searchParams.get('ticket') ?? '';
        // the registration page of the application, in the browser the sign-in was started in
        const registered: Response = await browser.open(`${baseUrl}/register`, {
            method: 'POST',
            headers: { [KnownHeader.CONTENT_TYPE]: MimeType.JSON },
            body: JSON.stringify({ ticket })
        });

        expect(registered.status).toBe(200);
        const user: JwtUser | undefined = await inject(repositoryTokenFor(JwtUser)).findOne({ where: { email: `${nameId}@example.com` }, required: false });
        expect(user).toBeDefined();
        const identities: FederatedIdentity[] = await inject(repositoryTokenFor(FederatedIdentity)).findAll({ where: { userId: user?.id ?? '' } });
        expect(identities.map(i => [i.issuer, i.subject])).toEqual([[idp.entityId, nameId]]);
        expect(await isLoggedIn(browser)).toBe(true);
    });

    it('refuses an answer posted a second time', async () => {
        await createLinkedUser();
        const browser: TestBrowser = newBrowser();
        const { answer, landing } = await signIn(browser, authorizeUrl('company'));
        expect(landing).toBe(REDIRECT_TO);

        expect(errorOf(await postAnswer(browser, answer, new URL(idp.entityId).origin))).toBe('expired');
    });

    it('refuses the answer to another browser\'s request, even posted with this browser\'s own state', async () => {
        await createLinkedUser();
        const victim: TestBrowser = newBrowser();
        const victimAnswer: FakeSamlAnswer = await askProvider(victim, authorizeUrl('company'), idp);
        const attacker: TestBrowser = newBrowser();
        const attackerAnswer: FakeSamlAnswer = await askProvider(attacker, authorizeUrl('company'), idp);

        // the attacker's signed response, carried back with the victim's own relay state
        const mixed: FakeSamlAnswer = {
            ...attackerAnswer,
            fields: new URLSearchParams({
                SAMLResponse: attackerAnswer.fields.get('SAMLResponse') ?? '',
                RelayState: victimAnswer.fields.get('RelayState') ?? ''
            })
        };

        expect(errorOf(await postAnswer(victim, mixed, new URL(idp.entityId).origin))).toBe('invalid');
        expect(await isLoggedIn(victim)).toBe(false);
    });

    it('refuses an answer the provider sends to no request', async () => {
        await createLinkedUser();
        idp.changeNextAnswer({ unsolicited: true });

        expect(errorOf((await signIn(newBrowser(), authorizeUrl('company'))).landing)).toBe('invalid');
    });

    it.each([
        ['meant for another application', { audience: 'https://other.example.com/saml' }],
        ['naming another issuer', { issuer: 'https://idp.other.example.com' }],
        ['that has expired', { notOnOrAfter: new Date(Date.now() - 600000) }],
        ['that is not signed', { unsigned: true }],
        ['signed by a key the metadata does not name', { signedByAnotherKey: true }],
        ['without when the user signed in', { omitAuthnStatement: true }]
    ])('refuses an answer %s', async (_, changes) => {
        await createLinkedUser();
        idp.changeNextAnswer(changes);

        expect(errorOf((await signIn(newBrowser(), authorizeUrl('company'))).landing)).toBe('invalid');
    });

    it('refuses an answer changed after it was signed', async () => {
        const victim: JwtUser = await createLinkedUser();
        const victimNameId: string = idp.identity.nameId;
        await createLinkedUser();
        // the attacker's own signed answer, with the victim's NameID put in
        idp.changeNextAnswer({ tamper: xml => xml.replace(/(<saml:NameID[^>]*>)[^<]*/, `$1${victimNameId}`) });
        const browser: TestBrowser = newBrowser();

        expect(errorOf((await signIn(browser, authorizeUrl('company'))).landing)).toBe('invalid');
        expect(await isLoggedIn(browser)).toBe(false);
        void victim;
    });

    it('refuses a NameID that is new for every sign-in', async () => {
        await createLinkedUser();
        idp.identity = { ...idp.identity, nameIdFormat: 'urn:oasis:names:tc:SAML:2.0:nameid-format:transient' };

        expect(errorOf((await signIn(newBrowser(), authorizeUrl('company'))).landing)).toBe('invalid');
    });

    it('tells the error page that the provider refused the user', async () => {
        await createLinkedUser();
        idp.denyNext('urn:oasis:names:tc:SAML:2.0:status:RequestDenied');

        expect(errorOf((await signIn(newBrowser(), authorizeUrl('company'))).landing)).toBe('cancelled');
    });

    it('sends a user whose sign-in at the provider is too old back there to sign in again, and lands them where they wanted', async () => {
        await createLinkedUser();
        idp.authenticatedAt = new Date(Date.now() - (MAX_AUTHENTICATION_AGE_IN_MS * 2));
        const browser: TestBrowser = newBrowser();

        try {
            const { landing } = await signIn(browser, authorizeUrl('company'));
            // straight back to the provider, asking for a new sign-in
            expect(landing.startsWith(idp.signInUrl)).toBe(true);
            const res: Response = await browser.open(landing);
            expect(res.status).toBe(200);
            expect(idp.requests.at(-1)?.forceAuthn).toBe(true);
            const answer: FakeSamlAnswer | undefined = idp.answers.at(-1);
            expect(answer).toBeDefined();
            expect(await postAnswer(
                browser,
                answer ?? { url: '', fields: new URLSearchParams(), xml: '', sessionIndex: undefined },
                new URL(idp.entityId).origin
            )).toBe(REDIRECT_TO);
            expect(await isLoggedIn(browser)).toBe(true);
        }
        finally {
            idp.authenticatedAt = undefined;
        }
    });

    it('asks the provider for a new sign-in when the frontend says so', async () => {
        await createLinkedUser();

        await signIn(newBrowser(), authorizeUrl('company', { reauthenticate: 'true' }));

        expect(idp.requests.at(-1)?.forceAuthn).toBe(true);
    });

    it('signs its requests and reads an encrypted assertion, for a provider that asks for both', async () => {
        await createLinkedUser(strictIdp);
        const browser: TestBrowser = newBrowser();

        const { answer, landing } = await signIn(browser, authorizeUrl('strict'), strictIdp);

        expect(strictIdp.requests.at(-1)?.signed).toBe(true);
        expect(answer.xml).toContain('EncryptedAssertion');
        expect(answer.xml).not.toContain(strictIdp.identity.nameId);
        expect(landing).toBe(REDIRECT_TO);
        expect(await isLoggedIn(browser)).toBe(true);
    });

    it('takes the answer only from the provider\'s own page', async () => {
        await createLinkedUser();
        const browser: TestBrowser = newBrowser();
        const answer: FakeSamlAnswer = await askProvider(browser, authorizeUrl('company'), idp);

        const res: Response = await browser.open(answer.url, {
            method: 'POST',
            headers: { [KnownHeader.CONTENT_TYPE]: MimeType.FORM_URL_ENCODED },
            body: answer.fields,
            crossSiteFrom: 'https://evil.example.com'
        });

        expect(res.status).toBe(403);
    });

    it('publishes its metadata as a service provider, with the callback and the certificates of its keys', async () => {
        const res: Response = await newBrowser().open(`${baseUrl}/auth/federated/strict/metadata`);

        expect(res.status).toBe(200);
        expect(res.headers.get(KnownHeader.CONTENT_TYPE)).toContain('application/samlmetadata+xml');
        const metadata: string = await res.text();
        expect(metadata).toContain(`entityID="${SP_ENTITY_ID}"`);
        expect(metadata).toContain(`Location="${PUBLIC_URL}/auth/federated/strict/callback"`);
        expect(metadata).toContain(`Location="${PUBLIC_URL}/auth/federated/strict/logout"`);
        const certificateBody: (pem: string) => string = pem => pem.replaceAll(/-----[^-]+-----|\s/g, '');
        expect(metadata.replaceAll(/\s/g, '')).toContain(certificateBody(signingKey.certificate));
        expect(metadata.replaceAll(/\s/g, '')).toContain(certificateBody(decryptionKey.certificate));
    });

    it('starts no sign-in through metadata that describes another identity provider', async () => {
        const res: Response = await newBrowser().open(authorizeUrl('elsewhere'));

        expect(res.status).toBe(500);
        const attempts: FederatedLoginAttempt[] = await inject(repositoryTokenFor(FederatedLoginAttempt)).findAll({ where: { provider: 'elsewhere' } });
        expect(attempts).toEqual([]);
    });

    it('ends exactly the login of the session the provider logs the user out of, and tells the provider', async () => {
        await createLinkedUser();
        const loggedOut: TestBrowser = newBrowser();
        const { answer } = await signIn(loggedOut, authorizeUrl('company'));
        const stillIn: TestBrowser = newBrowser();
        await signIn(stillIn, authorizeUrl('company'));

        // the provider's page sends it in whichever browser the user logged out at the provider
        const landing: string = await newBrowser()
            .follow(idp.createLogoutRequestUrl({ nameId: idp.identity.nameId, sessionIndex: answer.sessionIndex }));

        expect(landing.startsWith(idp.logoutUrl)).toBe(true);
        const response: string = inflateRawSync(Buffer.from(new URL(landing).searchParams.get('SAMLResponse') ?? '', 'base64')).toString('utf8');
        expect(response).toContain('urn:oasis:names:tc:SAML:2.0:status:Success');
        expect(await isLoggedIn(loggedOut)).toBe(false);
        expect(await isLoggedIn(stillIn)).toBe(true);
    });

    it('ends a login the provider logs the user out of after it was refreshed', async () => {
        const user: JwtUser = await createLinkedUser();
        const browser: TestBrowser = newBrowser();
        const { answer } = await signIn(browser, authorizeUrl('company'));
        await rotateLogin(browser, user.id);

        await newBrowser().follow(idp.createLogoutRequestUrl({ nameId: idp.identity.nameId, sessionIndex: answer.sessionIndex }));

        expect(await isLoggedIn(browser)).toBe(false);
    });

    it('answers where to log out at the provider, for a refreshed login too', async () => {
        const user: JwtUser = await createLinkedUser();
        const browser: TestBrowser = newBrowser();
        await signIn(browser, authorizeUrl('company'));
        await rotateLogin(browser, user.id);

        const { providerLogoutUrl } = await logOut(browser);

        expect(providerLogoutUrl?.startsWith(idp.logoutUrl)).toBe(true);
    });

    it('ends every login of the user when the provider names no session, and nobody else\'s', async () => {
        await createLinkedUser();
        const somebodyElse: TestBrowser = newBrowser();
        await signIn(somebodyElse, authorizeUrl('company'));
        await createLinkedUser();
        const first: TestBrowser = newBrowser();
        await signIn(first, authorizeUrl('company'));
        const second: TestBrowser = newBrowser();
        await signIn(second, authorizeUrl('company'));

        await newBrowser().follow(idp.createLogoutRequestUrl({ nameId: idp.identity.nameId }));

        expect(await isLoggedIn(first)).toBe(false);
        expect(await isLoggedIn(second)).toBe(false);
        expect(await isLoggedIn(somebodyElse)).toBe(true);
    });

    it.each([
        ['that is not signed', { unsigned: true }],
        ['signed by a key the metadata does not name', { signedByAnotherKey: true }]
    ])('refuses a logout request %s', async (_, changes) => {
        await createLinkedUser();
        const browser: TestBrowser = newBrowser();
        const { answer } = await signIn(browser, authorizeUrl('company'));

        const res: Response = await newBrowser()
            .open(idp.createLogoutRequestUrl({ nameId: idp.identity.nameId, sessionIndex: answer.sessionIndex, ...changes }));

        expect(res.status).toBe(401);
        expect(await isLoggedIn(browser)).toBe(true);
    });

    it('logs the user out at the provider too, and lands them on the signed-out page once it ended the session', async () => {
        await createLinkedUser();
        const browser: TestBrowser = newBrowser();
        const { answer } = await signIn(browser, authorizeUrl('company'));

        const { providerLogoutUrl } = await logOut(browser);

        expect(await isLoggedIn(browser)).toBe(false);
        expect(providerLogoutUrl?.startsWith(idp.logoutUrl)).toBe(true);
        const landing: string = await browser.follow(await browser.follow(providerLogoutUrl ?? ''));
        expect(idp.logoutRequests.at(-1)).toMatchObject({ issuer: SP_ENTITY_ID, nameId: idp.identity.nameId, sessionIndex: answer.sessionIndex });
        expect(landing).toBe(SIGNED_OUT_URL);
    });

    it('signs its logout requests, for a provider that asks for it', async () => {
        await createLinkedUser(strictIdp);
        const browser: TestBrowser = newBrowser();
        await signIn(browser, authorizeUrl('strict'), strictIdp);

        const { providerLogoutUrl } = await logOut(browser);
        const landing: string = await browser.follow(await browser.follow(providerLogoutUrl ?? ''));

        expect(strictIdp.logoutRequests.at(-1)?.signed).toBe(true);
        expect(landing).toBe(SIGNED_OUT_URL);
    });

    // evaluation/03-auth-and-security H23: the metadata named the logout url for posted messages only,
    // and the route took none; logout requests sent server to server had no route at all
    describe('logout through the post and SOAP bindings', () => {
        it('publishes its logout url for redirected and posted messages, and its SOAP logout url', async () => {
            const metadata: string = await (await newBrowser().open(`${baseUrl}/auth/federated/company/metadata`)).text();

            const services: string[] = [...metadata.matchAll(/<(?:\w+:)?SingleLogoutService\b[^>]*>/g)].map(([tag]) => tag);
            const logoutUrl: string = `${PUBLIC_URL}/auth/federated/company/logout`;
            expect(services).toEqual([
                expect.stringMatching(new RegExp(`Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="${logoutUrl}"`)),
                expect.stringMatching(new RegExp(`Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${logoutUrl}"`)),
                expect.stringMatching(new RegExp(`Binding="urn:oasis:names:tc:SAML:2.0:bindings:SOAP" Location="${logoutUrl}/soap"`))
            ]);
        });

        it('ends exactly the login of the session a posted logout request names, and tells the provider', async () => {
            await createLinkedUser();
            const loggedOut: TestBrowser = newBrowser();
            const { answer } = await signIn(loggedOut, authorizeUrl('company'));
            const stillIn: TestBrowser = newBrowser();
            await signIn(stillIn, authorizeUrl('company'));

            const res: Response = await postLogout(
                newBrowser(),
                idp.createLogoutRequestForm({ nameId: idp.identity.nameId, sessionIndex: answer.sessionIndex }),
                idp
            );

            expect(res.status).toBe(303);
            const location: string = res.headers.get(KnownHeader.LOCATION) ?? '';
            expect(location.startsWith(idp.logoutUrl)).toBe(true);
            const response: string = inflateRawSync(Buffer.from(new URL(location).searchParams.get('SAMLResponse') ?? '', 'base64')).toString('utf8');
            expect(response).toContain('urn:oasis:names:tc:SAML:2.0:status:Success');
            expect(await isLoggedIn(loggedOut)).toBe(false);
            expect(await isLoggedIn(stillIn)).toBe(true);
        });

        it.each([
            ['that is not signed', { unsigned: true }],
            ['signed by a key the metadata does not name', { signedByAnotherKey: true }]
        ])('refuses a posted logout request %s', async (_, changes) => {
            await createLinkedUser();
            const browser: TestBrowser = newBrowser();
            const { answer } = await signIn(browser, authorizeUrl('company'));

            const form: FakeSamlLogoutForm = idp.createLogoutRequestForm({ nameId: idp.identity.nameId, sessionIndex: answer.sessionIndex, ...changes });
            const res: Response = await postLogout(newBrowser(), form, idp);

            expect(res.status).toBe(401);
            expect(await isLoggedIn(browser)).toBe(true);
        });

        it('lands on the signed-out page once a provider that answers with a form ended the session', async () => {
            await createLinkedUser(postAnsweringIdp);
            const browser: TestBrowser = newBrowser();
            await signIn(browser, authorizeUrl('post-answering'), postAnsweringIdp);
            const { providerLogoutUrl } = await logOut(browser);

            await browser.open(providerLogoutUrl ?? '');
            const posted: FakeSamlLogoutForm | undefined = postAnsweringIdp.logoutAnswers.at(-1);
            const res: Response = await postLogout(browser, posted ?? { url: '', fields: new URLSearchParams() }, postAnsweringIdp);

            expect(res.status).toBe(303);
            expect(res.headers.get(KnownHeader.LOCATION)).toBe(SIGNED_OUT_URL);
        });

        it('answers a provider that takes posted forms only with a page posting the signed answer', async () => {
            await createLinkedUser(postOnlyIdp);
            const browser: TestBrowser = newBrowser();
            const { answer } = await signIn(browser, authorizeUrl('post-only'), postOnlyIdp);
            const form: FakeSamlLogoutForm = postOnlyIdp.createLogoutRequestForm({ nameId: postOnlyIdp.identity.nameId, sessionIndex: answer.sessionIndex });

            const res: Response = await postLogout(newBrowser(), form, postOnlyIdp);

            expect(res.status).toBe(200);
            expect(res.headers.get(KnownHeader.CONTENT_TYPE)).toContain(MimeType.HTML);
            const page: string = await res.text();
            const answered: FakeSamlLogoutForm = readAutoPostedForm(page);
            expect(answered.url).toBe(postOnlyIdp.logoutUrl);
            // the page may post to the provider and run its one script, and nothing else
            expect(res.headers.get('content-security-policy')).toContain(`form-action ${new URL(postOnlyIdp.entityId).origin}`);
            expect(await isLoggedIn(browser)).toBe(false);

            const posted: Response = await fetch(answered.url, { method: 'POST', body: answered.fields });
            expect(posted.status).toBe(200);
            const response: FakeSamlLogoutResponse | undefined = postOnlyIdp.logoutResponses.at(-1);
            expect(response).toMatchObject({ status: 'urn:oasis:names:tc:SAML:2.0:status:Success', signed: true });
            expect(response?.inResponseTo).toBe(new RegExp(/ID="([^"]+)"/).exec(Buffer.from(form.fields.get('SAMLRequest') ?? '', 'base64').toString('utf8'))?.[1]);
        });

        it('ends exactly the login of the session a logout request sent server to server names, and answers in SOAP', async () => {
            await createLinkedUser();
            const loggedOut: TestBrowser = newBrowser();
            const { answer } = await signIn(loggedOut, authorizeUrl('company'));
            const stillIn: TestBrowser = newBrowser();
            await signIn(stillIn, authorizeUrl('company'));

            const answered: FakeSamlBackChannelAnswer = await idp.sendBackChannelLogout(
                `${baseUrl}/auth/federated/company/logout/soap`,
                { nameId: idp.identity.nameId, sessionIndex: answer.sessionIndex }
            );

            expect(answered.status).toBe(200);
            expect(answered.contentType).toContain(MimeType.TEXT_XML);
            expect(answered.body).toMatch(/<(\w+:)?Envelope\b[^>]*xmlns(:\w+)?="http:\/\/schemas.xmlsoap.org\/soap\/envelope\/"/);
            expect(answered.body).toContain(`InResponseTo="${answered.requestId}"`);
            expect(answered.body).toContain('urn:oasis:names:tc:SAML:2.0:status:Success');
            expect(answered.body).not.toContain('<?xml');
            expect(await isLoggedIn(loggedOut)).toBe(false);
            expect(await isLoggedIn(stillIn)).toBe(true);
        });

        it('signs its SOAP answer, for a provider that asks for signed messages', async () => {
            await createLinkedUser(strictIdp);
            const browser: TestBrowser = newBrowser();
            const { answer } = await signIn(browser, authorizeUrl('strict'), strictIdp);

            const answered: FakeSamlBackChannelAnswer = await strictIdp.sendBackChannelLogout(
                `${baseUrl}/auth/federated/strict/logout/soap`,
                { nameId: strictIdp.identity.nameId, sessionIndex: answer.sessionIndex }
            );

            expect(answered.status).toBe(200);
            expect(answered.signed).toBe(true);
            expect(await isLoggedIn(browser)).toBe(false);
        });

        it.each([
            ['that is not signed', { unsigned: true }],
            ['signed by a key the metadata does not name', { signedByAnotherKey: true }]
        ])('refuses a logout request sent server to server %s', async (_, changes) => {
            await createLinkedUser();
            const browser: TestBrowser = newBrowser();
            const { answer } = await signIn(browser, authorizeUrl('company'));

            const answered: FakeSamlBackChannelAnswer = await idp.sendBackChannelLogout(
                `${baseUrl}/auth/federated/company/logout/soap`,
                { nameId: idp.identity.nameId, sessionIndex: answer.sessionIndex, ...changes }
            );

            expect(answered.status).toBe(401);
            expect(await isLoggedIn(browser)).toBe(true);
        });

        it('refuses a body that is not a SOAP envelope carrying a logout request', async () => {
            const send: (body: string) => Promise<number> = async body => (await fetch(`${baseUrl}/auth/federated/company/logout/soap`, {
                method: 'POST',
                headers: { [KnownHeader.CONTENT_TYPE]: MimeType.TEXT_XML },
                body
            })).status;

            expect(await send('<LogoutRequest xmlns="urn:oasis:names:tc:SAML:2.0:protocol"/>')).toBe(400);
            expect(await send('<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><a/></s:Body></s:Envelope>')).toBe(400);
            expect(await send('<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>')).toBe(400);
        });
    });
});

describe('BaseSamlAuthenticator with the jwt strategy', () => {
    let server: StartedTestServer;

    beforeAll(async () => {
        server = await startApp(JwtAuthStrategy, [JwtSamlAuthController]);
    }, 30000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    /**
     * A login handed over to the frontend.
     */
    type JwtLogin = {
        /**
         * The session at the identity provider it was signed in with.
         */
        sessionIndex: string | undefined,
        /**
         * Its refresh token.
         */
        refreshToken: string
    };

    /**
     * Signs in the way a frontend does, with a PKCE verifier it keeps, and exchanges the code.
     * @returns The login.
     */
    async function logIn(): Promise<JwtLogin> {
        const verifier: string = randomBytes(32).toString('base64url');
        const codeChallenge: string = createHash('sha256').update(verifier)
            .digest('base64url');
        const { answer, landing } = await signIn(newBrowser(), authorizeUrl('company', { codeChallenge }));
        const res: Response = await fetch(`${baseUrl}/auth/login?authenticator=company`, {
            method: 'POST',
            headers: { [KnownHeader.CONTENT_TYPE]: MimeType.JSON },
            body: JsonUtilities.stringify({ code: new URL(landing).searchParams.get('code'), codeVerifier: verifier })
        });
        expect(res.status).toBe(200);
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const data: JwtAuthData<string> = await res.json();
        return { sessionIndex: answer.sessionIndex, refreshToken: data.refreshToken.value };
    }

    /**
     * Refreshes a login.
     * @param refreshToken - Its refresh token, which is spent.
     * @returns The next refresh token, or undefined when the refresh is refused.
     */
    async function refresh(refreshToken: string): Promise<string | undefined> {
        const res: Response = await fetch(`${baseUrl}/auth/refresh-login`, {
            method: 'POST',
            headers: { [KnownHeader.CONTENT_TYPE]: MimeType.JSON },
            body: JsonUtilities.stringify({ refreshToken })
        });
        if (res.status !== 200) {
            return undefined;
        }
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const data: JwtAuthData<string> = await res.json();
        return data.refreshToken.value;
    }

    it('ends exactly the login of the session the provider logs the user out of, refreshed or not', async () => {
        await createLinkedUser();
        const loggedOut: JwtLogin = await logIn();
        const stillIn: JwtLogin = await logIn();
        // the session goes along to the next refresh token
        const refreshed: string | undefined = await refresh(loggedOut.refreshToken);
        expect(refreshed).toBeDefined();

        await newBrowser().follow(idp.createLogoutRequestUrl({ nameId: idp.identity.nameId, sessionIndex: loggedOut.sessionIndex }));

        expect(await refresh(refreshed ?? '')).toBeUndefined();
        expect(await refresh(stillIn.refreshToken)).toBeDefined();
    });

    it('ends exactly the login of the session a logout request sent server to server names', async () => {
        await createLinkedUser();
        const loggedOut: JwtLogin = await logIn();
        const stillIn: JwtLogin = await logIn();

        const answered: FakeSamlBackChannelAnswer = await idp.sendBackChannelLogout(
            `${baseUrl}/auth/federated/company/logout/soap`,
            { nameId: idp.identity.nameId, sessionIndex: loggedOut.sessionIndex }
        );

        expect(answered.status).toBe(200);
        expect(await refresh(loggedOut.refreshToken)).toBeUndefined();
        expect(await refresh(stillIn.refreshToken)).toBeDefined();
    });

    it('answers where to log out at the provider, for a refreshed login too', async () => {
        await createLinkedUser();
        const login: JwtLogin = await logIn();
        const refreshed: string | undefined = await refresh(login.refreshToken);

        const res: Response = await fetch(`${baseUrl}/auth/logout`, {
            method: 'POST',
            headers: { [KnownHeader.CONTENT_TYPE]: MimeType.JSON },
            body: JsonUtilities.stringify({ refreshToken: refreshed })
        });

        expect(res.status).toBe(200);
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const result: LogoutResult = await res.json();
        expect(result.providerLogoutUrl?.startsWith(idp.logoutUrl)).toBe(true);
        expect(await refresh(refreshed ?? '')).toBeUndefined();
    });
});