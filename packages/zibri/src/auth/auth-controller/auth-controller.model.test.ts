import assert from 'node:assert';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { TOTP } from 'otpauth';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { TestTimeouts } from '../../__testing__/constants';
import { JwtUser } from '../../__testing__/mocks/entities/jwt-user.entity';
import { Roles } from '../../__testing__/mocks/entities/roles.enum';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { defineProvider } from '../../di/models/di-provider.model';
import { Property } from '../../entity/decorators/property.decorator';
import { OmitClass } from '../../entity/omit-class.model';
import { UnauthorizedError } from '../../error-handling/errors/unauthorized.error';
import { KnownHeader } from '../../http/known-header.enum';
import { $ts } from '../../localization/translate.function';
import { Response } from '../../open-api/decorators/response.decorator';
import { OpenApiDefinition, OpenApiOperation } from '../../open-api/open-api.model';
import { Controller } from '../../routing/decorators/controller.decorator';
import { Get } from '../../routing/decorators/get.decorator';
import { Newable } from '../../types/newable.type';
import { JsonUtilities } from '../../utilities/json.utilities';
import { OtpTwoFactorMethod } from '../2fa/methods/otp/otp.two-factor-method';
import { AuthControllerAuthenticatorInterface } from '../authenticators/auth-controller-authenticator.interface';
import { PasswordCredentials, PasswordCredentialsCreateData } from '../authenticators/password/password-credentials.model';
import { PasswordAuthenticator } from '../authenticators/password/password.authenticator';
import { Auth } from '../decorators/auth.decorator';
import { Authentication } from '../models/authentication.model';
import { CookieAuthRefreshSession } from '../strategies/cookie/cookie-auth-refresh-session.model';
import { CookieAuthSession } from '../strategies/cookie/cookie-auth-session.model';
import { CookieAuthStrategy } from '../strategies/cookie/cookie-auth.auth-strategy';
import { JwtAuthStrategy } from '../strategies/jwt/jwt.auth-strategy';
import { AuthController } from './auth-controller.model';

const EMAIL: string = 'auth-controller@example.com';
const PASSWORD: string = 'secure123';
const PIN: string = '4711';

type RefreshTokenBody = {
    refreshToken: { value: string }
};

class PinCredentials {
    @Property.string({ minLength: 4, maxLength: 4 })
    pin!: string;
}

/**
 * An authenticator of the application's own, which the login route logs in with by its credentials model.
 */
class PinAuthenticator implements AuthControllerAuthenticatorInterface<string, JwtUser, PinCredentials> {
    readonly name: string = 'pin';

    readonly credentialsModel: Newable<PinCredentials> = PinCredentials;

    async authenticate(credentials: PinCredentials): Promise<Authentication<JwtUser>> {
        if (credentials.pin !== PIN) {
            throw new UnauthorizedError($ts`Wrong pin.`);
        }
        const user: JwtUser = await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser)).findOne({ where: { email: EMAIL } });
        return { user, authenticatedAt: new Date() };
    }
}

/**
 * Has the method that calls for the registration routes, and none of the models those read.
 */
class HalfRegistrationAuthenticator extends PinAuthenticator {
    override readonly name: string = 'half';

    async confirmRegistration(): Promise<void> {
        // nothing to register with
    }
}

// the routes of an application logging in with jwts and with cookies, by password and by pin
@Controller('/auth', { allowOrphan: true, versions: 'all' })
class TwoWaysAuthController extends AuthController({
        strategies: [JwtAuthStrategy, CookieAuthStrategy],
        authenticators: [PasswordAuthenticator, PinAuthenticator],
        twoFactorMethods: [OtpTwoFactorMethod],
        currentUserRoute: true,
        twoFactorRegistrationsRoute: true,
        updateCurrentUserRoute: true
    }) {}

// what an application of 3.0 wrote, before AuthController answered GET /me and listed the second factors
@Controller('/auth', { allowOrphan: true, versions: 'all' })
class OwnCurrentUserAuthController extends AuthController({
        strategies: [JwtAuthStrategy, CookieAuthStrategy],
        authenticators: [PasswordAuthenticator, PinAuthenticator],
        twoFactorMethods: [OtpTwoFactorMethod]
    }) {

    @Auth.isLoggedIn()
    @Response.empty()
    @Get('/me')
    async me(): Promise<void> {
        // answers nothing, which is all a route of its own needs to here
    }

    @Auth.isLoggedIn()
    @Response.empty()
    @Get('/2fa/registrations')
    async registrations(): Promise<void> {
        // answers nothing, which is all a route of its own needs to here
    }
}

// the same routes, without the password reset
@Controller('/auth', { allowOrphan: true, versions: 'all' })
class NoResetAuthController extends OmitClass(
        AuthController({ strategies: [JwtAuthStrategy], authenticators: [PasswordAuthenticator], twoFactorMethods: [OtpTwoFactorMethod] }),
        ['requestPasswordReset', 'verifyPasswordResetToken', 'confirmPasswordReset']
    ) {}

@Controller('/other-auth', { allowOrphan: true, versions: 'all' })
class SecondAuthController extends AuthController({
        strategies: [JwtAuthStrategy, CookieAuthStrategy],
        authenticators: [PasswordAuthenticator, PinAuthenticator],
        twoFactorMethods: [OtpTwoFactorMethod]
    }) {}

@Controller('/auth', { allowOrphan: true, versions: 'all' })
class JwtOnlyAuthController extends AuthController({
        strategies: [JwtAuthStrategy],
        authenticators: [PasswordAuthenticator, PinAuthenticator],
        twoFactorMethods: [OtpTwoFactorMethod]
    }) {}

@Controller('/auth', { allowOrphan: true, versions: 'all' })
class NoTwoFactorAuthController extends AuthController({
        strategies: [JwtAuthStrategy, CookieAuthStrategy],
        authenticators: [PasswordAuthenticator, PinAuthenticator],
        twoFactorMethods: []
    }) {}

@Controller('/auth', { allowOrphan: true, versions: 'all' })
class HalfRegistrationAuthController extends AuthController({
        strategies: [JwtAuthStrategy, CookieAuthStrategy],
        authenticators: [PasswordAuthenticator, HalfRegistrationAuthenticator],
        twoFactorMethods: [OtpTwoFactorMethod]
    }) {}

/**
 * Starts an application logging in with jwts and with cookies, by password and by the given second
 * authenticator, keeping its data in memory.
 * @param controllers - Its controllers.
 * @param secondAuthenticator - The authenticator besides the password.
 * @returns The server, and the url it listens at.
 */
async function startApp(
    controllers: Newable<unknown>[],
    secondAuthenticator: Newable<PinAuthenticator> = PinAuthenticator
): Promise<[StartedTestServer, string]> {
    const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
        entities: [...defaultTestServerEntities, CookieAuthSession, CookieAuthRefreshSession],
        repositories: defaultTestServerRepositories,
        allowOrphan: true
    });
    const server: StartedTestServer = await startTestServer({
        dataSources: [dataSourceClass],
        authStrategies: [JwtAuthStrategy, CookieAuthStrategy],
        authenticators: [PasswordAuthenticator, secondAuthenticator],
        twoFactorMethods: [OtpTwoFactorMethod],
        controllers,
        providers: [
            ...defaultTestServerProviders,
            defineProvider({ token: ZIBRI_DI_TOKENS.COOKIE_SIGN_SECRET, useFactory: () => 'test-cookie-secret' })
        ]
    });
    try {
        return [server, await server.start()];
    }
    catch (error) {
        // a start the application refuses still leaves it initialized, which only the test can end
        await server.shutdown();
        throw error;
    }
}

/**
 * Starts an application a case expects to be refused, and ends it again when it starts anyway.
 * @param controllers - Its controllers.
 * @param secondAuthenticator - The authenticator besides the password.
 */
async function startThenShutDown(controllers: Newable<unknown>[], secondAuthenticator?: Newable<PinAuthenticator>): Promise<void> {
    const [server] = await startApp(controllers, secondAuthenticator);
    await server.shutdown();
}

describe('AuthController — the routes it defines', () => {
    it('defines only the routes its classes call for, which its type says as well', () => {
        const jwtOnly: Newable<object> = AuthController({
            strategies: [JwtAuthStrategy],
            authenticators: [PasswordAuthenticator],
            twoFactorMethods: []
        });

        expect(['login', 'refreshLogin', 'logout', 'requestPasswordReset'].filter(key => !(key in jwtOnly.prototype)))
            .toEqual([]);
        expect([
            'getCurrentUser',
            'csrfToken',
            'requestProviderLogin',
            'loginOptions',
            'requestLinkIdentity',
            'findIdentities',
            'requestSecondFactor',
            'findTwoFactorRegistrations'
        ].filter(key => key in jwtOnly.prototype)).toEqual([]);

        const cookies: Newable<object> = AuthController({
            strategies: [CookieAuthStrategy],
            authenticators: [PasswordAuthenticator],
            twoFactorMethods: [OtpTwoFactorMethod]
        });
        expect('csrfToken' in cookies.prototype).toBe(true);
        expect('requestSecondFactor' in cookies.prototype).toBe(true);
        // there only when asked for, as GET /me is
        expect('findTwoFactorRegistrations' in cookies.prototype).toBe(false);

        const answeringWhoIsLoggedIn: Newable<object> = AuthController({
            strategies: [JwtAuthStrategy],
            authenticators: [PasswordAuthenticator],
            twoFactorMethods: [],
            currentUserRoute: true
        });
        expect('getCurrentUser' in answeringWhoIsLoggedIn.prototype).toBe(true);
        // asked for on its own, as an application can have a PATCH /me of its own beside a GET /me of zibri
        expect('updateCurrentUser' in answeringWhoIsLoggedIn.prototype).toBe(false);
        const changingThemselves: Newable<object> = AuthController({
            strategies: [JwtAuthStrategy],
            authenticators: [PasswordAuthenticator],
            twoFactorMethods: [],
            updateCurrentUserRoute: true
        });
        expect(['updateCurrentUser' in changingThemselves.prototype, 'getCurrentUser' in changingThemselves.prototype]).toEqual([true, false]);

        const listingSecondFactors: Newable<object> = AuthController({
            strategies: [JwtAuthStrategy],
            authenticators: [PasswordAuthenticator],
            twoFactorMethods: [OtpTwoFactorMethod],
            twoFactorRegistrationsRoute: true
        });
        expect('findTwoFactorRegistrations' in listingSecondFactors.prototype).toBe(true);

        const verifying: Newable<object> = AuthController({
            strategies: [JwtAuthStrategy],
            authenticators: [PasswordAuthenticator],
            twoFactorMethods: [],
            emailVerification: true
        });
        const confirmingAnyLink: Newable<object> = AuthController({
            strategies: [JwtAuthStrategy],
            authenticators: [PasswordAuthenticator],
            twoFactorMethods: [],
            emailVerification: true,
            confirmEmailRoute: true
        });
        expect('confirmEmailVerification' in verifying.prototype).toBe(true);
        expect('confirmEmail' in verifying.prototype).toBe(false);
        expect('confirmEmail' in confirmingAnyLink.prototype).toBe(true);
    });

    it('types the routes it leaves out as absent, so they cannot be left out again', () => {
        // the routes a jwt login of a password with no second factor has
        OmitClass(AuthController({ strategies: [JwtAuthStrategy], authenticators: [PasswordAuthenticator], twoFactorMethods: [] }), ['requestPasswordReset']);
        // @ts-expect-error - a jwt login issues no csrf token
        OmitClass(AuthController({ strategies: [JwtAuthStrategy], authenticators: [PasswordAuthenticator], twoFactorMethods: [] }), ['csrfToken']);
        // @ts-expect-error - without a two factor method there is nothing to enrol
        OmitClass(AuthController({ strategies: [JwtAuthStrategy], authenticators: [PasswordAuthenticator], twoFactorMethods: [] }), ['requestSecondFactor']);
        // @ts-expect-error - GET /me is there only when asked for
        OmitClass(AuthController({ strategies: [JwtAuthStrategy], authenticators: [PasswordAuthenticator], twoFactorMethods: [] }), ['getCurrentUser']);
        OmitClass(
            AuthController({ strategies: [JwtAuthStrategy], authenticators: [PasswordAuthenticator], twoFactorMethods: [], currentUserRoute: true }),
            ['getCurrentUser']
        );
        // @ts-expect-error - GET /2fa/registrations is there only when asked for
        OmitClass(AuthController({ strategies: [JwtAuthStrategy], authenticators: [PasswordAuthenticator], twoFactorMethods: [OtpTwoFactorMethod] }), ['findTwoFactorRegistrations']);
        OmitClass(
            AuthController({
                strategies: [JwtAuthStrategy],
                authenticators: [PasswordAuthenticator],
                twoFactorMethods: [OtpTwoFactorMethod],
                twoFactorRegistrationsRoute: true
            }),
            ['findTwoFactorRegistrations']
        );
        // @ts-expect-error - POST /confirm-email is there only when asked for
        OmitClass(AuthController({ strategies: [JwtAuthStrategy], authenticators: [PasswordAuthenticator], twoFactorMethods: [], emailVerification: true }), ['confirmEmail']);
        OmitClass(
            AuthController({
                strategies: [JwtAuthStrategy],
                authenticators: [PasswordAuthenticator],
                twoFactorMethods: [],
                emailVerification: true,
                confirmEmailRoute: true
            }),
            ['confirmEmail']
        );
        expect(true).toBe(true);
    });

    it('refuses to be defined without a strategy or an authenticator', () => {
        expect(() => AuthController({ strategies: [], authenticators: [PasswordAuthenticator], twoFactorMethods: [] }))
            .toThrow(/at least one strategy and one authenticator/);
    });
});

describe('AuthController — starting', () => {
    it('refuses two controllers it defined, since a provider sends the browser back to one url', async () => {
        await expect(startThenShutDown([TwoWaysAuthController, SecondAuthController]))
            .rejects.toThrow(/TwoWaysAuthController, SecondAuthController are all defined by AuthController/);
    }, TestTimeouts.inMemory.start);

    it('refuses options that name fewer strategies than the application registers', async () => {
        await expect(startThenShutDown([JwtOnlyAuthController]))
            .rejects.toThrow(/JwtOnlyAuthController[\S\s]*auth strategies that log in JwtAuthStrategy[\S\s]*JwtAuthStrategy, CookieAuthStrategy/);
    }, TestTimeouts.inMemory.start);

    it('refuses options that name other two factor methods than the application registers', async () => {
        await expect(startThenShutDown([NoTwoFactorAuthController]))
            .rejects.toThrow(/NoTwoFactorAuthController[\S\s]*two factor methods none[\S\s]*OtpTwoFactorMethod/);
    }, TestTimeouts.inMemory.start);

    // GET /me was there for every application, and one with a route of its own there refused to start
    it('starts with a GET /me and a GET /2fa/registrations of the application\'s own, which it answers itself', async () => {
        const [server, url] = await startApp([OwnCurrentUserAuthController]);
        try {
            expect((await fetch(`${url}/auth/me`)).status).toBe(401);
            expect((await fetch(`${url}/auth/2fa/registrations`)).status).toBe(401);
        }
        finally {
            await server.shutdown();
        }
    }, TestTimeouts.inMemory.start);

    it('refuses an authenticator that does not declare what a route given it reads', async () => {
        await expect(startThenShutDown([HalfRegistrationAuthController], HalfRegistrationAuthenticator))
            .rejects.toThrow(/HalfRegistrationAuthenticator[\S\s]*confirmRegistration route[\S\s]*RegistrationAuthenticatorInterface/);
    }, TestTimeouts.inMemory.start);
});

describe('AuthController — a login of several strategies and authenticators', () => {
    let server: StartedTestServer;
    let baseUrl: string;
    let user: JwtUser;

    /**
     * Posts json.
     * @param path - The route, below the base url.
     * @param body - What to send.
     * @param headers - Anything else to send.
     * @returns The response.
     */
    async function post(path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
        return await fetch(`${baseUrl}${path}`, {
            method: 'POST',
            headers: { [KnownHeader.CONTENT_TYPE]: 'application/json', ...headers },
            body: JsonUtilities.stringify(body)
        });
    }

    /**
     * Logs the user in with a jwt, by password.
     * @returns The access token.
     */
    async function logIn(): Promise<string> {
        const res: Response = await post('/auth/login?authenticator=password&strategy=jwt', { email: EMAIL, password: PASSWORD });
        expect(res.status).toBe(200);
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const body: { accessToken: { value: string } } = await res.json();
        return body.accessToken.value;
    }

    beforeAll(async () => {
        [server, baseUrl] = await startApp([TwoWaysAuthController]);
        user = await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser)).create({ email: EMAIL, roles: [Roles.USER] });
        await inject<Repository<PasswordCredentials, PasswordCredentialsCreateData>>(repositoryTokenFor(PasswordCredentials))
            .create({ password: PASSWORD, userId: user.id });
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    it('logs in with the strategy and the authenticator the request names', async () => {
        const jwt: Response = await post('/auth/login?authenticator=password&strategy=jwt', { email: EMAIL, password: PASSWORD });
        expect(jwt.status).toBe(200);
        expect(await jwt.json()).toEqual(expect.objectContaining({ userId: user.id, accessToken: expect.anything() }));

        const cookie: Response = await post('/auth/login?authenticator=pin&strategy=cookie', { pin: PIN });
        expect(cookie.status).toBe(200);
        expect(await cookie.json()).toEqual(expect.objectContaining({ userId: user.id, csrfToken: expect.any(String) }));
    });

    it('refuses a request that names no strategy or authenticator while there is a choice, or one that is none of them', async () => {
        expect((await post('/auth/login?authenticator=password', { email: EMAIL, password: PASSWORD })).status).toBe(400);
        expect((await post('/auth/login?strategy=jwt', { email: EMAIL, password: PASSWORD })).status).toBe(400);
        expect((await post('/auth/login?authenticator=fingerprint&strategy=jwt', { email: EMAIL, password: PASSWORD })).status).toBe(400);
    });

    it('checks the credentials against the authenticator the request names, not the first one they fit', async () => {
        const res: Response = await post('/auth/login?authenticator=pin&strategy=jwt', { email: EMAIL, password: PASSWORD });

        expect(res.status).toBe(400);
    });

    it('refreshes and logs out with the strategy the request names', async () => {
        const login: Response = await post('/auth/login?authenticator=password&strategy=jwt', { email: EMAIL, password: PASSWORD });
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const { refreshToken }: RefreshTokenBody = await login.json();

        const refreshed: Response = await post('/auth/refresh-login?strategy=jwt', { refreshToken: refreshToken.value });
        expect(refreshed.status).toBe(200);
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const next: RefreshTokenBody = await refreshed.json();
        expect((await post('/auth/logout?strategy=jwt', { refreshToken: next.refreshToken.value })).status).toBe(200);
        expect((await post('/auth/refresh-login?strategy=jwt', { refreshToken: next.refreshToken.value })).status).toBe(401);
    });

    it('leaves out the routes none of its classes call for', async () => {
        // neither the password nor the pin links identities, logs in at a provider or hands out a challenge
        expect((await fetch(`${baseUrl}/auth/identities`)).status).toBe(404);
        expect((await fetch(`${baseUrl}/auth/federated/login/request`)).status).toBe(404);
        expect((await post('/auth/login-options', {})).status).toBe(404);
    });

    it('answers who is logged in and what they may do, without their roles', async () => {
        const accessToken: string = await logIn();

        const res: Response = await fetch(`${baseUrl}/auth/me`, { headers: { Authorization: `Bearer ${accessToken}` } });

        expect(res.status).toBe(200);
        // the roles are left out, like on the CurrentUser of a handler: routes check permissions. The locale is the
        // one the user was created in, outside a request
        expect(await res.json()).toEqual({
            id: user.id,
            email: EMAIL,
            kind: 'person',
            locale: 'en-US',
            memberships: [],
            platformPermissions: expect.any(Array)
        });
        expect((await fetch(`${baseUrl}/auth/me`)).status).toBe(401);
    });

    it('changes the locale of who is logged in, back to the default with null, and refuses one the application lacks', async () => {
        const accessToken: string = await logIn();
        const patch: (body: unknown, loggedIn?: boolean) => Promise<Response> = async (body, loggedIn = true) => await fetch(`${baseUrl}/auth/me`, {
            method: 'PATCH',
            headers: { [KnownHeader.CONTENT_TYPE]: 'application/json', ...loggedIn ? { Authorization: `Bearer ${accessToken}` } : {} },
            body: JsonUtilities.stringify(body)
        });
        const users: Repository<JwtUser> = inject(repositoryTokenFor(JwtUser));
        const storedLocale: () => Promise<string | null | undefined> = async () => (await users.findById(user.id)).locale;

        const cleared: Response = await patch({ locale: null });
        expect(cleared.status).toBe(200);
        expect(await cleared.json()).toEqual(expect.not.objectContaining({ locale: expect.anything() }));
        expect(await storedLocale()).toBeNull();

        const set: Response = await patch({ locale: 'en-US' });
        expect(await set.json()).toEqual(expect.objectContaining({ id: user.id, email: EMAIL, locale: 'en-US' }));
        expect(await storedLocale()).toBe('en-US');

        // left out, it stays
        expect(await (await patch({})).json()).toEqual(expect.objectContaining({ locale: 'en-US' }));
        // one the application doesn't support, which no text of it is in
        expect((await patch({ locale: 'fr' })).status).toBe(400);
        expect(await storedLocale()).toBe('en-US');
        expect((await patch({ locale: null }, false)).status).toBe(401);
    });

    it('enrols the first second factor on a recent login, lists it, and then asks for the factor itself', async () => {
        const accessToken: string = await logIn();
        const authorization: Record<string, string> = { Authorization: `Bearer ${accessToken}` };

        /**
         * The second factors the user has enrolled.
         * @returns The names of their methods.
         */
        async function findRegistrations(): Promise<string[]> {
            const res: Response = await fetch(`${baseUrl}/auth/2fa/registrations`, { headers: authorization });
            expect(res.status).toBe(200);
            // eslint-disable-next-line typescript/no-unsafe-assignment
            const { methods }: { methods: string[] } = await res.json();
            return methods;
        }
        expect(await findRegistrations()).toEqual([]);

        const registered: Response = await post('/auth/2fa/registration/request', {}, authorization);
        expect(registered.status).toBe(200);
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const { secret }: { secret: string } = await registered.json();
        // the code of the step before, so the one of this step is still unspent afterwards
        const previous: string = new TOTP({ secret }).generate({ timestamp: Date.now() - 30_000 });
        expect((await post('/auth/2fa/registration/confirm', { token: previous }, authorization)).status).toBe(204);
        expect(await findRegistrations()).toEqual(['otp']);
        expect((await post('/auth/2fa/request', {}, authorization)).status).toBe(204);

        // a recent login is no longer enough once the user holds a factor
        expect((await post('/auth/2fa/registration/request', {}, authorization)).status).toBe(401);
        const withoutCode: Response = await fetch(`${baseUrl}/auth/2fa/registration/otp`, { method: 'DELETE', headers: authorization });
        expect(withoutCode.status).toBe(401);
        // named apart from a login that is no good, so a client asks for a code instead of refreshing
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const { name }: { name: string } = await withoutCode.json();
        expect(name).toBe('SecondFactorMissingError');
        const removed: Response = await fetch(`${baseUrl}/auth/2fa/registration/otp`, {
            method: 'DELETE',
            headers: { ...authorization, [inject(ZIBRI_DI_TOKENS.OTP_HEADER)]: new TOTP({ secret }).generate() }
        });
        expect(removed.status).toBe(204);
        expect(await findRegistrations()).toEqual([]);
    });

    it('describes a body of several authenticators and an answer of several strategies in the OpenAPI document', async () => {
        const res: Response = await fetch(`${baseUrl}/explorer/spec/1.0.0`);
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const spec: OpenApiDefinition = await res.json();
        const login: OpenApiOperation | undefined = spec.paths?.['/auth/login']?.post;
        assert(login);

        expect(login.parameters).toEqual(expect.arrayContaining([
            expect.objectContaining({ name: 'authenticator', in: 'query', required: true }),
            expect.objectContaining({ name: 'strategy', in: 'query', required: true })
        ]));
        expect(JsonUtilities.stringify(login.requestBody)).toMatch(/anyOf[\S\s]*email[\S\s]*pin/);
        expect(JsonUtilities.stringify(login.responses)).toMatch(/oneOf[\S\s]*accessToken[\S\s]*csrfToken/);
        expect(spec.paths?.['/auth/csrf-token']?.get).toBeDefined();
        expect(spec.paths?.['/auth/federated/login/request']).toBeUndefined();
    });
});

describe('AuthController — a route left out with OmitClass', () => {
    let server: StartedTestServer;
    let baseUrl: string;

    beforeAll(async () => {
        const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories, allowOrphan: true });
        server = await startTestServer({ dataSources: [dataSourceClass], controllers: [NoResetAuthController] });
        baseUrl = await server.start();
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    it('answers the routes it keeps, and none of the ones left out', async () => {
        const reset: Response = await fetch(`${baseUrl}/auth/request-password-reset`, {
            method: 'POST',
            headers: { [KnownHeader.CONTENT_TYPE]: 'application/json' },
            body: JsonUtilities.stringify({ email: EMAIL })
        });
        expect(reset.status).toBe(404);

        const login: Response = await fetch(`${baseUrl}/auth/login`, {
            method: 'POST',
            headers: { [KnownHeader.CONTENT_TYPE]: 'application/json' },
            body: JsonUtilities.stringify({ email: EMAIL, password: PASSWORD })
        });
        // a route that is there, answering for an account that is not
        expect(login.status).toBe(401);
    });
});