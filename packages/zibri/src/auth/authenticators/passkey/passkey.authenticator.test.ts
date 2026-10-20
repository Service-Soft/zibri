import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInMemoryDataSource,
    FakeFidoMetadataService,
    FakePasskeyAttestation,
    FakePasskeyDevice,
    InMemoryDataSource,
    startFakeFidoMetadataService,
    TestBrowser } from 'zibri-testing';

import { PasskeyChallenge } from './passkey-challenge.model.ts';
import { PasskeyConnectionRequest } from './passkey-connection-request.model.ts';
import { PasskeyCreationOptions } from './passkey-creation-options.model.ts';
import { PasskeyTicketCredentials } from './passkey-credentials.model.ts';
import { PasskeyOptions } from './passkey-options.model.ts';
import { PasskeyRegistrationTicket } from './passkey-registration-ticket.model.ts';
import { PasskeyRegistration } from './passkey-registration.model.ts';
import { PasskeyRequestOptions } from './passkey-request-options.model.ts';
import { PasskeyAuthenticator } from './passkey.authenticator.ts';
import { Passkey } from './passkey.model.ts';
import { JwtUser } from '../../../__testing__/mocks/entities/jwt-user.entity.ts';
import { Roles } from '../../../__testing__/mocks/entities/roles.enum.ts';
import { defaultTestServerEntities } from '../../../__testing__/test-server/create-test-data-source.function.ts';
import { defaultTestServerProviders } from '../../../__testing__/test-server/providers.ts';
import { startAndStopTestServerWithout } from '../../../__testing__/test-server/start-and-stop-test-server-without.function.ts';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function.ts';
import { Repository } from '../../../data-source/repository/repository.ts';
import { Transaction } from '../../../data-source/transaction/transaction.model.ts';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../../di/inject.function.ts';
import { defineProvider } from '../../../di/models/di-provider.model.ts';
import { BaseEntity } from '../../../entity/base-entity.model.ts';
import { KnownHeader } from '../../../http/known-header.enum.ts';
import { MimeType } from '../../../http/mime-type.enum.ts';
import { AuditAction, AuditOutcome, AuditReason } from '../../../logging/audit-event.model.ts';
import { Log } from '../../../logging/log.model.ts';
import { type LoggerInterface } from '../../../logging/logger.interface.ts';
import { Body } from '../../../routing/decorators/body.decorator.ts';
import { Controller } from '../../../routing/decorators/controller.decorator.ts';
import { Post } from '../../../routing/decorators/post.decorator.ts';
import { Newable } from '../../../types/newable.type.ts';
import { JsonUtilities } from '../../../utilities/json.utilities.ts';
import { OtpTwoFactorMethod } from '../../2fa/methods/otp/otp.two-factor-method.ts';
import { PasskeyTwoFactorMethod } from '../../2fa/methods/passkey/passkey.two-factor-method.ts';
import { AuthController } from '../../auth-controller/auth-controller.model.ts';
import { type AuthServiceInterface } from '../../auth-service.interface.ts';
import { Auth } from '../../decorators/auth.decorator.ts';
import { CookieAuthData } from '../../strategies/cookie/cookie-auth-data.model.ts';
import { CookieAuthRefreshSession } from '../../strategies/cookie/cookie-auth-refresh-session.model.ts';
import { CookieAuthSession } from '../../strategies/cookie/cookie-auth-session.model.ts';
import { CookieAuthStrategy } from '../../strategies/cookie/cookie-auth.auth-strategy.ts';
import { JwtAuthStrategy } from '../../strategies/jwt/jwt.auth-strategy.ts';
import { LinkedIdentity } from '../linked-identity.model.ts';
import { PasswordCredentials, PasswordCredentialsCreateData } from '../password/password-credentials.model.ts';
import { PasswordAuthenticator } from '../password/password.authenticator.ts';

const ORIGIN: string = 'https://app.example.com';

const PASSKEY_OPTIONS: PasskeyOptions = { relyingPartyId: 'example.com', relyingPartyName: 'Example', origins: [ORIGIN] };

const PASSKEY_ENTITIES: Newable<BaseEntity>[] = [Passkey, PasskeyChallenge, PasskeyRegistrationTicket];

@Auth.skip({ allowRedundant: true })
// the auth routes of passkeys, logging in with cookies or with jwts. Orphans for the cases that boot
// with the other
@Controller('/auth', { allowOrphan: true, versions: 'all' })
class CookiePasskeyAuthController extends AuthController({
        strategies: [CookieAuthStrategy],
        authenticators: [PasswordAuthenticator, PasskeyAuthenticator],
        twoFactorMethods: [PasskeyTwoFactorMethod]
    }) {}

@Controller('/auth', { allowOrphan: true, versions: 'all' })
class JwtPasskeyAuthController extends AuthController({
        strategies: [JwtAuthStrategy],
        authenticators: [PasskeyAuthenticator],
        twoFactorMethods: [OtpTwoFactorMethod]
    }) {}

@Controller('/users', { allowOrphan: true })
class CookieSignUpController {
    // what an application writes: create the user and add the passkey in one transaction, so neither
    // exists without the other, and log in once that is committed
    @Post('/sign-up')
    async signUp(
        @Body(PasskeyTicketCredentials)
        credentials: PasskeyTicketCredentials
    ): Promise<CookieAuthData<string>> {
        const authService: AuthServiceInterface = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
        const users: Repository<JwtUser> = inject(repositoryTokenFor(JwtUser));
        const transaction: Transaction = await users.dataSource.startTransaction();
        try {
            const registration: PasskeyRegistration = await authService.resolveRegistration(PasskeyAuthenticator, credentials, transaction);
            const user: JwtUser = await users.create({ email: registration.name, roles: [Roles.USER] }, { transaction });
            await authService.linkIdentity(PasskeyAuthenticator, credentials, user.id, transaction);
            await transaction.commit();
        }
        catch (error) {
            await transaction.rollback();
            throw error;
        }
        return await authService.login(PasskeyAuthenticator, CookieAuthStrategy, credentials, undefined);
    }
}

@Controller('/account', { allowOrphan: true })
class AccountController {
    // what an application writes: a route of its own that starts adding a passkey to the user
    @Auth.isLoggedIn()
    @Post('/passkeys')
    async addPasskey(
        @Body(PasskeyConnectionRequest)
        request: PasskeyConnectionRequest
    ): Promise<PasskeyCreationOptions> {
        return await inject(ZIBRI_DI_TOKENS.AUTH_SERVICE).startConnection(PasskeyAuthenticator, request);
    }

    @Auth.require2fa()
    @Post('/payment-details')
    updatePaymentDetails(): { ok: boolean } {
        return { ok: true };
    }

    @Auth.require2fa({ reauth: true })
    @Post('/email')
    updateEmail(): { ok: boolean } {
        return { ok: true };
    }
}

/**
 * A user logged in to cookies.
 */
type LoggedIn = {
    /**
     * The browser holding their session.
     */
    browser: TestBrowser,
    /**
     * The csrf token of that session.
     */
    csrfToken: string,
    /**
     * The user.
     */
    userId: string
};

/**
 * What a sign-in with a passkey answered, and the browser it went through.
 */
type SignedIn = {
    /**
     * The answer of the login route.
     */
    res: Response,
    /**
     * The browser.
     */
    browser: TestBrowser
};

let baseUrl: string;

/**
 * Starts an application signing in with passkeys to cookies.
 * @param passkeyOptions - The passkey options, if any.
 * @param entities - The entities the passkeys are kept in.
 * @returns The server and where it listens.
 */
async function startApp(
    passkeyOptions: PasskeyOptions | undefined,
    entities: Newable<BaseEntity>[] = PASSKEY_ENTITIES
): Promise<[StartedTestServer, string]> {
    const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
        entities: [...defaultTestServerEntities, CookieAuthSession, CookieAuthRefreshSession, ...entities],
        allowOrphan: true
    });
    const server: StartedTestServer = await startTestServer({
        dataSources: [dataSourceClass],
        authStrategies: [CookieAuthStrategy],
        authenticators: [PasswordAuthenticator, PasskeyAuthenticator],
        twoFactorMethods: [PasskeyTwoFactorMethod],
        controllers: [CookiePasskeyAuthController, CookieSignUpController, AccountController],
        providers: [
            ...defaultTestServerProviders,
            defineProvider({ token: ZIBRI_DI_TOKENS.COOKIE_SIGN_SECRET, useFactory: () => 'test-cookie-secret' }),
            defineProvider({ token: ZIBRI_DI_TOKENS.PASSKEY_OPTIONS, useValue: passkeyOptions })
        ]
    });
    return [server, await server.start()];
}

/**
 * Posts json, as a page on the application's origin does.
 * @param browser - The browser.
 * @param path - The route.
 * @param body - The body.
 * @param headers - Anything else to send.
 * @returns The response.
 */
async function post(browser: TestBrowser, path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
    return await browser.open(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { [KnownHeader.CONTENT_TYPE]: MimeType.JSON, ...headers },
        body: JsonUtilities.stringify(body)
    });
}

/**
 * Reads a json answer.
 * @param res - The response.
 * @returns The body.
 */
async function read<T>(res: Response): Promise<T> {
    // eslint-disable-next-line typescript/no-unsafe-assignment
    const body: T = await res.json();
    return body;
}

/**
 * Signs a new user up with a passkey of the given device, which logs them in.
 * @param device - The device.
 * @param email - The name the device lists the account under, and the user's email.
 * @returns The user, logged in.
 */
async function signUp(device: FakePasskeyDevice, email: string = `${crypto.randomUUID()}@example.com`): Promise<LoggedIn> {
    const browser: TestBrowser = new TestBrowser(baseUrl, undefined);
    const options: PasskeyCreationOptions = await read(await post(browser, '/auth/registration-options', { name: email }));
    const { ticket }: PasskeyTicketCredentials = await read(await post(browser, '/auth/register', { response: device.create(options, ORIGIN) }));
    const res: Response = await post(browser, '/users/sign-up', { ticket });
    expect(res.status).toBe(200);
    const { csrfToken, userId }: CookieAuthData<string> = await read(res);
    return { browser, csrfToken, userId };
}

/**
 * Signs in with a passkey of the given device, in a new browser.
 * @param device - The device.
 * @param origin - The origin of the page the browser is on.
 * @returns What the login answered.
 */
async function signIn(device: FakePasskeyDevice, origin: string = ORIGIN): Promise<SignedIn> {
    const browser: TestBrowser = new TestBrowser(baseUrl, undefined);
    const options: PasskeyRequestOptions = await read(await post(browser, '/auth/sign-in-options', {}));
    return { res: await post(browser, '/auth/login?authenticator=passkey', { response: device.get(options, origin) }), browser };
}

/**
 * The audit blocks of everything logged so far, flushed first because the logger writes later.
 * @returns Whatever each entry carries under `context.metadata.audit`.
 */
async function auditEvents(): Promise<unknown[]> {
    await inject<LoggerInterface>(ZIBRI_DI_TOKENS.LOGGER).flush();
    return (await inject(repositoryTokenFor(Log)).findAll({})).map(l => l.context.metadata?.['audit']);
}

/**
 * The passkey of a user as the header of a guarded request.
 * @param loggedIn - The user, logged in.
 * @param device - The device holding their passkey.
 * @returns The headers.
 */
async function secondFactorHeaders(loggedIn: LoggedIn, device: FakePasskeyDevice): Promise<Record<string, string>> {
    const options: PasskeyRequestOptions = await read(await post(
        loggedIn.browser,
        '/auth/2fa/start?method=passkey',
        {},
        { 'x-csrf-token': loggedIn.csrfToken }
    ));
    return {
        'x-csrf-token': loggedIn.csrfToken,
        'x-authorization-passkey': Buffer.from(JsonUtilities.stringify(device.get(options, ORIGIN))).toString('base64url')
    };
}

// first, for the reason on startAndStopTestServerWithout
describe('PasskeyAuthenticator — starting', () => {
    it('refuses to start without its entities, and names them', async () => {
        const start: Promise<void> = startAndStopTestServerWithout([], {
            authenticators: [PasskeyAuthenticator],
            providers: [...defaultTestServerProviders, defineProvider({ token: ZIBRI_DI_TOKENS.PASSKEY_OPTIONS, useValue: PASSKEY_OPTIONS })]
        });

        await expect(start).rejects.toThrow(/Passkey[\S\s]*PasskeyChallenge/);
    }, 30000);

    it('refuses to start without the passkey options', async () => {
        await expect(startApp(undefined)).rejects.toThrow(/passkey_options/);
    }, 30000);

    it('starts with passkeys as a second factor only, without the table of a sign-up', async () => {
        const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
            entities: [...defaultTestServerEntities, Passkey, PasskeyChallenge],
            allowOrphan: true
        });
        const server: StartedTestServer = await startTestServer({
            dataSources: [dataSourceClass],
            twoFactorMethods: [PasskeyTwoFactorMethod],
            providers: [...defaultTestServerProviders, defineProvider({ token: ZIBRI_DI_TOKENS.PASSKEY_OPTIONS, useValue: PASSKEY_OPTIONS })]
        });

        await expect(server.start()).resolves.toBeDefined();
        await server.shutdown();
    }, 30000);
});

describe('PasskeyAuthenticator — signing in to cookies', () => {
    let server: StartedTestServer;

    beforeAll(async () => {
        [server, baseUrl] = await startApp(PASSKEY_OPTIONS);
    }, 30000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    it('signs a user up with a passkey, which logs them in, and signs them in with it again', async () => {
        const device: FakePasskeyDevice = new FakePasskeyDevice({ synced: true });
        const signedUp: LoggedIn = await signUp(device, 'signed-up@example.com');

        const { res } = await signIn(device);

        expect(res.status).toBe(200);
        expect((await read<CookieAuthData<string>>(res)).userId).toBe(signedUp.userId);
    });

    it('counts a sign-in with a passkey as a recent login', async () => {
        const device: FakePasskeyDevice = new FakePasskeyDevice({ synced: true });
        await signUp(device);
        const { res, browser } = await signIn(device);
        const { csrfToken }: CookieAuthData<string> = await read(res);

        const updated: Response = await post(browser, '/account/email', {}, { 'x-csrf-token': csrfToken });

        expect(updated.status).toBe(200);
    });

    it('logs in with the ticket of a sign-up only once', async () => {
        const browser: TestBrowser = new TestBrowser(baseUrl, undefined);
        const options: PasskeyCreationOptions = await read(await post(browser, '/auth/registration-options', { name: 'once@example.com' }));
        const { ticket }: PasskeyTicketCredentials = await read(await post(browser, '/auth/register', {
            response: new FakePasskeyDevice().create(options, ORIGIN)
        }));
        expect((await post(browser, '/users/sign-up', { ticket })).status).toBe(200);

        expect((await post(browser, '/users/sign-up', { ticket })).status).toBe(401);
    });

    it('logs nobody in with a ticket whose passkey the application added to nobody', async () => {
        const browser: TestBrowser = new TestBrowser(baseUrl, undefined);
        const options: PasskeyCreationOptions = await read(await post(browser, '/auth/registration-options', { name: 'nobody@example.com' }));
        const { ticket }: PasskeyTicketCredentials = await read(await post(browser, '/auth/register', {
            response: new FakePasskeyDevice().create(options, ORIGIN)
        }));

        await expect(inject(ZIBRI_DI_TOKENS.AUTH_SERVICE).login(PasskeyAuthenticator, CookieAuthStrategy, { ticket }, undefined))
            .rejects.toThrow('No user is linked to this sign-in.');
    });

    it('takes one answer to each challenge, and records one given again as reuse', async () => {
        const device: FakePasskeyDevice = new FakePasskeyDevice({ synced: true });
        await signUp(device);
        const browser: TestBrowser = new TestBrowser(baseUrl, undefined);
        const options: PasskeyRequestOptions = await read(await post(browser, '/auth/sign-in-options', {}));
        const response: unknown = device.get(options, ORIGIN);
        expect((await post(browser, '/auth/login?authenticator=passkey', { response })).status).toBe(200);

        const replayed: Response = await post(new TestBrowser(baseUrl, undefined), '/auth/login?authenticator=passkey', { response });

        expect(replayed.status).toBe(401);
        expect(await auditEvents()).toContainEqual(expect.objectContaining({
            action: AuditAction.LOGIN,
            outcome: AuditOutcome.FAILURE,
            reason: AuditReason.TOKEN_REUSED
        }));
    });

    it('refuses a sign-in that answers a challenge issued for a second factor', async () => {
        const device: FakePasskeyDevice = new FakePasskeyDevice({ synced: true });
        const loggedIn: LoggedIn = await signUp(device);
        const options: PasskeyRequestOptions = await read(await post(
            loggedIn.browser,
            '/auth/2fa/start?method=passkey',
            {},
            { 'x-csrf-token': loggedIn.csrfToken }
        ));

        const res: Response = await post(new TestBrowser(baseUrl, undefined), '/auth/login?authenticator=passkey', { response: device.get(options, ORIGIN) });

        expect(res.status).toBe(401);
    });

    it('refuses an answer to a challenge that expired', async () => {
        const device: FakePasskeyDevice = new FakePasskeyDevice({ synced: true });
        await signUp(device);
        const browser: TestBrowser = new TestBrowser(baseUrl, undefined);
        const options: PasskeyRequestOptions = await read(await post(browser, '/auth/sign-in-options', {}));
        const challenges: Repository<PasskeyChallenge> = inject(repositoryTokenFor(PasskeyChallenge));
        for (const challenge of await challenges.findAll({ where: { spent: false } })) {
            await challenges.updateById(challenge.id, { expirationDate: new Date(Date.now() - 1000) });
        }

        const res: Response = await post(browser, '/auth/login?authenticator=passkey', { response: device.get(options, ORIGIN) });

        expect(res.status).toBe(401);
    });

    it('refuses an answer from a page on an origin it does not know, though it is under the site', async () => {
        const device: FakePasskeyDevice = new FakePasskeyDevice({ synced: true });
        await signUp(device);

        const { res } = await signIn(device, 'https://evil.example.com');

        expect(res.status).toBe(401);
    });

    it('refuses a device that does not verify its user, when it creates a passkey and when it uses one', async () => {
        const careless: FakePasskeyDevice = new FakePasskeyDevice({ verifiesUser: false });
        const browser: TestBrowser = new TestBrowser(baseUrl, undefined);
        const options: PasskeyCreationOptions = await read(await post(browser, '/auth/registration-options', { name: 'careless@example.com' }));
        const created: Response = await post(browser, '/auth/register', { response: careless.create(options, ORIGIN) });
        expect(created.status).toBe(400);

        const device: FakePasskeyDevice = new FakePasskeyDevice({ synced: true });
        await signUp(device);
        device.verifiesUser = false;
        const { res } = await signIn(device);
        expect(res.status).toBe(401);
    });

    it('refuses a copy of a security key whose count fell behind, records it, and keeps the passkey', async () => {
        const securityKey: FakePasskeyDevice = new FakePasskeyDevice();
        await signUp(securityKey);
        expect((await signIn(securityKey)).res.status).toBe(200);
        const copy: FakePasskeyDevice = securityKey.copy();
        expect((await signIn(securityKey)).res.status).toBe(200);

        // the copy counts on from where it was copied, which the original has passed already
        const { res } = await signIn(copy);

        expect(res.status).toBe(401);
        expect(await auditEvents()).toContainEqual(expect.objectContaining({
            action: AuditAction.LOGIN,
            outcome: AuditOutcome.FAILURE,
            reason: AuditReason.CREDENTIAL_CLONED
        }));
        expect((await signIn(securityKey)).res.status).toBe(200);
    });

    it('signs a synced passkey in again and again, though it counts no signatures', async () => {
        const device: FakePasskeyDevice = new FakePasskeyDevice({ synced: true });
        await signUp(device);

        expect((await signIn(device)).res.status).toBe(200);
        expect((await signIn(device)).res.status).toBe(200);
    });

    it('adds a passkey to a user logged in with a password, lists it with their identities, and removes it', async () => {
        const email: string = 'with-password@example.com';
        const user: JwtUser = await inject(repositoryTokenFor(JwtUser)).create({ email, roles: [Roles.USER] });
        await inject<Repository<PasswordCredentials, PasswordCredentialsCreateData>>(repositoryTokenFor(PasswordCredentials))
            .create({ password: 'secure123', userId: user.id });
        const browser: TestBrowser = new TestBrowser(baseUrl, undefined);
        const { csrfToken }: CookieAuthData<string> = await read(await post(browser, '/auth/login?authenticator=password', { email, password: 'secure123' }));
        const device: FakePasskeyDevice = new FakePasskeyDevice({ synced: true });

        const options: PasskeyCreationOptions = await read(await post(browser, '/account/passkeys', { name: email }, { 'x-csrf-token': csrfToken }));
        const connected: Response = await post(
            browser,
            '/auth/connect/complete',
            { response: device.create(options, ORIGIN) },
            { 'x-csrf-token': csrfToken }
        );
        expect(connected.status).toBe(204);

        const { res } = await signIn(device);
        expect((await read<CookieAuthData<string>>(res)).userId).toBe(user.id);
        const linked: LinkedIdentity<Passkey>[] = await inject(ZIBRI_DI_TOKENS.AUTH_SERVICE).findIdentities(user.id, undefined, [PasskeyAuthenticator]);
        expect(linked.map(l => l.authenticator)).toEqual(['passkey']);
        expect(linked[0]?.identity.discoverable).toBe(true);

        await inject(ZIBRI_DI_TOKENS.AUTH_SERVICE).unlinkIdentity(user.id, linked[0]?.identity.id ?? '', undefined);
        expect((await signIn(device)).res.status).toBe(401);
    });

    it('adds a security key that cannot store a passkey to a user logged in with a password, as a second factor it cannot sign in with', async () => {
        const email: string = 'older-key@example.com';
        const user: JwtUser = await inject(repositoryTokenFor(JwtUser)).create({ email, roles: [Roles.USER] });
        await inject<Repository<PasswordCredentials, PasswordCredentialsCreateData>>(repositoryTokenFor(PasswordCredentials))
            .create({ password: 'secure123', userId: user.id });
        const browser: TestBrowser = new TestBrowser(baseUrl, undefined);
        const { csrfToken }: CookieAuthData<string> = await read(await post(browser, '/auth/login?authenticator=password', { email, password: 'secure123' }));
        const olderKey: FakePasskeyDevice = new FakePasskeyDevice({ storesPasskeys: false });

        const options: PasskeyCreationOptions = await read(await post(browser, '/account/passkeys', { name: email }, { 'x-csrf-token': csrfToken }));
        const connected: Response = await post(
            browser,
            '/auth/connect/complete',
            { response: olderKey.create(options, ORIGIN) },
            { 'x-csrf-token': csrfToken }
        );
        expect(connected.status).toBe(204);
        const linked: LinkedIdentity<Passkey>[] = await inject(ZIBRI_DI_TOKENS.AUTH_SERVICE).findIdentities(user.id, undefined, [PasskeyAuthenticator]);
        expect(linked[0]?.identity.discoverable).toBe(false);

        const factor: Record<string, string> = await secondFactorHeaders({ browser, csrfToken, userId: user.id }, olderKey);
        expect((await post(browser, '/account/payment-details', {}, factor)).status).toBe(200);
        // a sign-in names no passkey, so the key has none to offer
        await expect(signIn(olderKey)).rejects.toThrow(/holds no passkey/);
    });

    it('signs nobody up with a security key that cannot store a passkey, which the browser refuses', async () => {
        const browser: TestBrowser = new TestBrowser(baseUrl, undefined);
        const options: PasskeyCreationOptions = await read(await post(browser, '/auth/registration-options', { name: 'older-key-only@example.com' }));

        expect(() => new FakePasskeyDevice({ storesPasskeys: false }).create(options, ORIGIN)).toThrow(/cannot store a passkey/);
    });

    it('finishes adding a passkey only for the user it was started for', async () => {
        const starter: LoggedIn = await signUp(new FakePasskeyDevice({ synced: true }));
        const other: LoggedIn = await signUp(new FakePasskeyDevice({ synced: true }));
        const options: PasskeyCreationOptions = await read(await post(
            starter.browser,
            '/account/passkeys',
            { name: 'starter@example.com' },
            { 'x-csrf-token': starter.csrfToken }
        ));

        const res: Response = await post(
            other.browser,
            '/auth/connect/complete',
            { response: new FakePasskeyDevice().create(options, ORIGIN) },
            { 'x-csrf-token': other.csrfToken }
        );

        expect(res.status).toBe(401);
    });

    it('takes a passkey as the second factor of an operation, of the user it belongs to only, and once', async () => {
        const ownerDevice: FakePasskeyDevice = new FakePasskeyDevice({ synced: true });
        const owner: LoggedIn = await signUp(ownerDevice);
        const otherDevice: FakePasskeyDevice = new FakePasskeyDevice({ synced: true });
        const other: LoggedIn = await signUp(otherDevice);

        expect((await post(owner.browser, '/account/payment-details', {}, { 'x-csrf-token': owner.csrfToken })).status).toBe(401);

        // the passkey of somebody else, presented with the owner's session
        const othersFactor: Record<string, string> = await secondFactorHeaders(other, otherDevice);
        const presentedByOwner: Response = await post(owner.browser, '/account/payment-details', {}, {
            ...othersFactor,
            'x-csrf-token': owner.csrfToken
        });
        expect(presentedByOwner.status).toBe(401);

        const ownFactor: Record<string, string> = await secondFactorHeaders(owner, ownerDevice);
        expect((await post(owner.browser, '/account/payment-details', {}, ownFactor)).status).toBe(200);
        expect((await post(owner.browser, '/account/payment-details', {}, ownFactor)).status).toBe(401);
    });
});

describe('PasskeyAuthenticator — models of devices', () => {
    let server: StartedTestServer;
    let metadata: FakeFidoMetadataService;
    let allowed: FakePasskeyAttestation;
    let listedButNotAllowed: FakePasskeyAttestation;
    let compromised: FakePasskeyAttestation;

    /**
     * Creates a passkey on a device for a new user, with a jwt login.
     * @param device - The device.
     * @returns The status the creation answered.
     */
    async function create(device: FakePasskeyDevice): Promise<number> {
        const browser: TestBrowser = new TestBrowser(baseUrl, undefined);
        const options: PasskeyCreationOptions = await read(await post(browser, '/auth/registration-options', { name: 'device@example.com' }));
        return (await post(browser, '/auth/register', { response: device.create(options, ORIGIN) })).status;
    }

    beforeAll(async () => {
        metadata = await startFakeFidoMetadataService();
        allowed = await metadata.addModel();
        listedButNotAllowed = await metadata.addModel();
        compromised = await metadata.addModel();
        metadata.reportCompromised(compromised.aaguid);
        const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
            entities: [...defaultTestServerEntities, ...PASSKEY_ENTITIES],
            allowOrphan: true
        });
        server = await startTestServer({
            dataSources: [dataSourceClass],
            authStrategies: [JwtAuthStrategy],
            authenticators: [PasskeyAuthenticator],
            controllers: [JwtPasskeyAuthController],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({
                    token: ZIBRI_DI_TOKENS.PASSKEY_OPTIONS,
                    useValue: {
                        ...PASSKEY_OPTIONS,
                        attestation: {
                            allowedAaguids: [allowed.aaguid, compromised.aaguid],
                            metadataServiceUrl: metadata.blobUrl,
                            metadataServiceRootCertificates: [metadata.rootCertificate]
                        }
                    }
                })
            ]
        });
        baseUrl = await server.start();
    }, 30000);

    afterAll(async () => {
        await server?.shutdown();
        await metadata?.close();
    }, 15000);

    it('creates passkeys on a model the metadata lists and the application allows, downloading the metadata once', async () => {
        expect(await create(new FakePasskeyDevice({ attestation: allowed }))).toBe(200);
        expect(await create(new FakePasskeyDevice({ attestation: allowed }))).toBe(200);

        expect(metadata.downloads).toBe(1);
    });

    it('refuses a model the metadata lists that the application does not allow', async () => {
        expect(await create(new FakePasskeyDevice({ attestation: listedButNotAllowed }))).toBe(403);
    });

    it('refuses a device that proves no model, though it names an allowed one', async () => {
        expect(await create(new FakePasskeyDevice({ aaguid: allowed.aaguid }))).toBe(403);
    });

    it('refuses a device whose proof was issued by someone other than the maker the metadata names', async () => {
        expect(await create(new FakePasskeyDevice({ attestation: await metadata.createUnlistedModel(allowed.aaguid) }))).toBe(403);
    });

    it('refuses a model whose keys were reported compromised', async () => {
        expect(await create(new FakePasskeyDevice({ attestation: compromised }))).toBe(403);
    });
});

describe('PasskeyAuthenticator — metadata it cannot trust', () => {
    let server: StartedTestServer;
    let metadata: FakeFidoMetadataService;
    let someoneElse: FakeFidoMetadataService;
    let allowed: FakePasskeyAttestation;

    beforeAll(async () => {
        metadata = await startFakeFidoMetadataService();
        someoneElse = await startFakeFidoMetadataService();
        allowed = await metadata.addModel();
        const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
            entities: [...defaultTestServerEntities, ...PASSKEY_ENTITIES],
            allowOrphan: true
        });
        server = await startTestServer({
            dataSources: [dataSourceClass],
            authStrategies: [JwtAuthStrategy],
            authenticators: [PasskeyAuthenticator],
            controllers: [JwtPasskeyAuthController],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({
                    token: ZIBRI_DI_TOKENS.PASSKEY_OPTIONS,
                    useValue: {
                        ...PASSKEY_OPTIONS,
                        attestation: {
                            allowedAaguids: [allowed.aaguid],
                            metadataServiceUrl: metadata.blobUrl,
                            // the list is signed under the root of another service than this one
                            metadataServiceRootCertificates: [someoneElse.rootCertificate]
                        }
                    }
                })
            ]
        });
        baseUrl = await server.start();
    }, 30000);

    afterAll(async () => {
        await server?.shutdown();
        await metadata?.close();
        await someoneElse?.close();
    }, 15000);

    it('creates no passkey with metadata not signed under the root it is configured with, and answers that as a fault', async () => {
        const browser: TestBrowser = new TestBrowser(baseUrl, undefined);
        const options: PasskeyCreationOptions = await read(await post(browser, '/auth/registration-options', { name: 'device@example.com' }));

        const res: Response = await post(browser, '/auth/register', { response: new FakePasskeyDevice({ attestation: allowed }).create(options, ORIGIN) });

        expect(res.status).toBe(500);
    });
});