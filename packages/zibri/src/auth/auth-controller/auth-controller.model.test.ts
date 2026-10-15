import assert from 'node:assert';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { TOTP } from 'otpauth';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { AuthController } from './auth-controller.model';
import { JwtUser } from '../../__testing__/mocks/entities/jwt-user.entity';
import { Roles } from '../../__testing__/mocks/entities/roles.enum';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function';
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
import { OpenApiDefinition, OpenApiOperation } from '../../open-api/open-api.model';
import { Controller } from '../../routing/decorators/controller.decorator';
import { Newable } from '../../types/newable.type';
import { JsonUtilities } from '../../utilities/json.utilities';
import { OtpTwoFactorMethod } from '../2fa/methods/otp/otp.two-factor-method';
import { AuthControllerAuthenticatorInterface } from '../authenticators/auth-controller-authenticator.interface';
import { PasswordCredentials, PasswordCredentialsCreateData } from '../authenticators/password/password-credentials.model';
import { PasswordAuthenticator } from '../authenticators/password/password.authenticator';
import { Authentication } from '../models/authentication.model';
import { CookieAuthRefreshSession } from '../strategies/cookie/cookie-auth-refresh-session.model';
import { CookieAuthSession } from '../strategies/cookie/cookie-auth-session.model';
import { CookieAuthStrategy } from '../strategies/cookie/cookie-auth.auth-strategy';
import { JwtAuthStrategy } from '../strategies/jwt/jwt.auth-strategy';

const EMAIL: string = 'auth-controller@example.com';
const PASSWORD: string = 'secure123';
const PIN: string = '4711';

class PinCredentials {
    @Property.string({ minLength: 4, maxLength: 4 })
    pin!: string;
}

/**
 * An authenticator of the application's own, which the login route logs in with by its credentials model.
 */
class PinAuthenticator implements AuthControllerAuthenticatorInterface<Roles, JwtUser, PinCredentials> {
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
 * Has the method that calls for the sign-up routes, and none of the models those read.
 */
class HalfSignUpAuthenticator extends PinAuthenticator {
    override readonly name: string = 'half';

    async completeSignUp(): Promise<void> {
        // nothing to sign up with
    }
}

// the routes of an application logging in with jwts and with cookies, by password and by pin
@Controller('/auth', { allowOrphan: true, versions: 'all' })
class TwoWaysAuthController extends AuthController({
        strategies: [JwtAuthStrategy, CookieAuthStrategy],
        authenticators: [PasswordAuthenticator, PinAuthenticator],
        twoFactorMethods: [OtpTwoFactorMethod]
    }) {}

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
class HalfSignUpAuthController extends AuthController({
        strategies: [JwtAuthStrategy, CookieAuthStrategy],
        authenticators: [PasswordAuthenticator, HalfSignUpAuthenticator],
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

        expect(['login', 'refreshLogin', 'logout', 'requestPasswordReset'].filter(key => !(key in jwtOnly.prototype))).toEqual([]);
        expect(['csrfToken', 'authorize', 'signInOptions', 'startConnection', 'findIdentities', 'startSecondFactor']
            .filter(key => key in jwtOnly.prototype)).toEqual([]);

        const cookies: Newable<object> = AuthController({
            strategies: [CookieAuthStrategy],
            authenticators: [PasswordAuthenticator],
            twoFactorMethods: [OtpTwoFactorMethod]
        });
        expect('csrfToken' in cookies.prototype).toBe(true);
        expect('startSecondFactor' in cookies.prototype).toBe(true);
    });

    it('types the routes it leaves out as absent, so they cannot be left out again', () => {
        // the routes a jwt login of a password with no second factor has
        OmitClass(AuthController({ strategies: [JwtAuthStrategy], authenticators: [PasswordAuthenticator], twoFactorMethods: [] }), ['requestPasswordReset']);
        // @ts-expect-error - a jwt login issues no csrf token
        OmitClass(AuthController({ strategies: [JwtAuthStrategy], authenticators: [PasswordAuthenticator], twoFactorMethods: [] }), ['csrfToken']);
        // @ts-expect-error - without a two factor method there is nothing to enrol
        OmitClass(AuthController({ strategies: [JwtAuthStrategy], authenticators: [PasswordAuthenticator], twoFactorMethods: [] }), ['startSecondFactor']);
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
    }, 20000);

    it('refuses options that name fewer strategies than the application registers', async () => {
        await expect(startThenShutDown([JwtOnlyAuthController]))
            .rejects.toThrow(/JwtOnlyAuthController[\S\s]*auth strategies that log in JwtAuthStrategy[\S\s]*JwtAuthStrategy, CookieAuthStrategy/);
    }, 20000);

    it('refuses options that name other two factor methods than the application registers', async () => {
        await expect(startThenShutDown([NoTwoFactorAuthController]))
            .rejects.toThrow(/NoTwoFactorAuthController[\S\s]*two factor methods none[\S\s]*OtpTwoFactorMethod/);
    }, 20000);

    it('refuses an authenticator that does not declare what a route given it reads', async () => {
        await expect(startThenShutDown([HalfSignUpAuthController], HalfSignUpAuthenticator))
            .rejects.toThrow(/HalfSignUpAuthenticator[\S\s]*register route[\S\s]*SignUpAuthenticatorInterface/);
    }, 20000);
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
    }, 20000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

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
        const { refreshToken }: { refreshToken: { value: string } } = await login.json();

        const refreshed: Response = await post('/auth/refresh-login?strategy=jwt', { refreshToken: refreshToken.value });
        expect(refreshed.status).toBe(200);
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const next: { refreshToken: { value: string } } = await refreshed.json();
        expect((await post('/auth/logout?strategy=jwt', { refreshToken: next.refreshToken.value })).status).toBe(200);
        expect((await post('/auth/refresh-login?strategy=jwt', { refreshToken: next.refreshToken.value })).status).toBe(401);
    });

    it('leaves out the routes none of its classes call for', async () => {
        // neither the password nor the pin links identities, signs in at a provider or hands out a challenge
        expect((await fetch(`${baseUrl}/auth/identities`)).status).toBe(404);
        expect((await fetch(`${baseUrl}/auth/federated/authorize`)).status).toBe(404);
        expect((await post('/auth/sign-in-options', {})).status).toBe(404);
    });

    it('enrols the first second factor on a recent login, and then asks for the factor itself', async () => {
        const accessToken: string = await logIn();
        const authorization: Record<string, string> = { Authorization: `Bearer ${accessToken}` };

        const registered: Response = await post('/auth/2fa/register', {}, authorization);
        expect(registered.status).toBe(200);
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const { secret }: { secret: string } = await registered.json();
        // the code of the step before, so the one of this step is still unspent afterwards
        const previous: string = new TOTP({ secret }).generate({ timestamp: Date.now() - 30_000 });
        expect((await post('/auth/2fa/confirm', { token: previous }, authorization)).status).toBe(204);
        expect((await post('/auth/2fa/start', {}, authorization)).status).toBe(204);

        // a recent login is no longer enough once the user holds a factor
        expect((await post('/auth/2fa/register', {}, authorization)).status).toBe(401);
        const withoutCode: Response = await fetch(`${baseUrl}/auth/2fa/otp`, { method: 'DELETE', headers: authorization });
        expect(withoutCode.status).toBe(401);
        const removed: Response = await fetch(`${baseUrl}/auth/2fa/otp`, {
            method: 'DELETE',
            headers: { ...authorization, [inject(ZIBRI_DI_TOKENS.OTP_HEADER)]: new TOTP({ secret }).generate() }
        });
        expect(removed.status).toBe(204);
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
        expect(spec.paths?.['/auth/federated/authorize']).toBeUndefined();
    });
});

describe('AuthController — a route left out with OmitClass', () => {
    let server: StartedTestServer;
    let baseUrl: string;

    beforeAll(async () => {
        const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({ entities: defaultTestServerEntities, allowOrphan: true });
        server = await startTestServer({ dataSources: [dataSourceClass], controllers: [NoResetAuthController] });
        baseUrl = await server.start();
    }, 20000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

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