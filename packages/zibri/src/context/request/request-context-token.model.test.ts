import assert from 'node:assert';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { TOTP } from 'otpauth';

import { HttpRequestContext } from './http-request.context';
import { ZIBRI_REQUEST_CONTEXT_TOKENS } from './request-context-token.model';
import { WebsocketRequestContext } from './websocket-request.context';
import { TestTimeouts } from '../../__testing__/constants';
import { JwtUser } from '../../__testing__/mocks/entities/jwt-user.entity';
import { Roles } from '../../__testing__/mocks/entities/roles.enum';
import { createTestDataSource, defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { OtpCredentials } from '../../auth/2fa/methods/otp/otp-credentials.model';
import { OtpTwoFactorMethod } from '../../auth/2fa/methods/otp/otp.two-factor-method';
import { OTP_PERIOD_IN_SECONDS } from '../../auth/2fa/methods/otp/otp.utilities';
import { type TwoFactorServiceInterface } from '../../auth/2fa/two-factor-service.interface';
import { AuthController } from '../../auth/auth-controller/auth-controller.model';
import { PasswordCredentials, PasswordCredentialsCreateData } from '../../auth/authenticators/password/password-credentials.model';
import { PasswordAuthenticator } from '../../auth/authenticators/password/password.authenticator';
import { Auth } from '../../auth/decorators/auth.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { CookieAuthRefreshSession } from '../../auth/strategies/cookie/cookie-auth-refresh-session.model';
import { CookieAuthSession } from '../../auth/strategies/cookie/cookie-auth-session.model';
import { CookieAuthStrategy } from '../../auth/strategies/cookie/cookie-auth.auth-strategy';
import { JwtAuthStrategy } from '../../auth/strategies/jwt/jwt.auth-strategy';
import { PostgresDataSource } from '../../data-source/data-sources/postgres/postgres-data-source.model';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { defineProvider } from '../../di/models/di-provider.model';
import { InternalError } from '../../error-handling/internal-error.model';
import { Controller } from '../../routing/decorators/controller.decorator';
import { Get } from '../../routing/decorators/get.decorator';
import { Newable } from '../../types/newable.type';
import { JsonUtilities } from '../../utilities/json.utilities';
import { Ms } from '../../utilities/ms';

// the tokens answer for the route that matched: the current user for the strategies that route
// names, the second factor for the codes the request carried. Answered without the route, the user
// came from whichever strategy resolved one and the second factor was a constant

const password: string = 'secure123';

const dataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: [...defaultTestServerEntities, CookieAuthSession, CookieAuthRefreshSession],
    repositories: defaultTestServerRepositories
});

/**
 * The request being handled right now.
 * @returns The context.
 * @throws When there is none, which cannot happen inside a route.
 */
function currentContext(): HttpRequestContext | WebsocketRequestContext {
    const context: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
    if (!context) {
        throw new InternalError('A route ran without a request context.');
    }
    return context;
}

@Controller('/auth', { versions: 'all' })
class TestAuthController extends AuthController({
        strategies: [JwtAuthStrategy, CookieAuthStrategy],
        authenticators: [PasswordAuthenticator],
        twoFactorMethods: [OtpTwoFactorMethod]
    }) {}

@Controller('/context')
class ContextController {

    // no @Auth decorator on these: the point is what @CurrentUser's own arguments are worth, and an
    // @Auth.isLoggedIn() above them would refuse the caller first and leave that unanswered
    @Get('/user')
    user(
        @CurrentUser()
        user: CurrentUser<JwtUser>
    ): { id: string } {
        return { id: user.id };
    }

    @Get('/cookie-user')
    cookieUser(
        @CurrentUser({ authStrategies: [CookieAuthStrategy] })
        user: CurrentUser<JwtUser>
    ): { id: string } {
        return { id: user.id };
    }

    @Auth.isLoggedIn()
    @Get('/second-factor')
    async secondFactor(): Promise<{ has2fa: boolean }> {
        return { has2fa: await currentContext().get(ZIBRI_REQUEST_CONTEXT_TOKENS.HAS_2FA) };
    }
}

let server: StartedTestServer | undefined;
let baseUrl: string;
let user: JwtUser;
let accessToken: string;
let otpHeader: string;

/**
 * Asks for a route as a caller holding an access token.
 * @param path - The route to ask for.
 * @param headers - Anything to send beyond the authorization.
 * @returns The response.
 */
async function get(path: string, headers: Record<string, string> = {}): Promise<Response> {
    return await fetch(`${baseUrl}/context${path}`, {
        headers: { authorization: `Bearer ${accessToken}`, ...headers }
    });
}

/**
 * Enrolls the user in otp and returns a code an authenticator would show next.
 *
 * Confirming spends a code, so the enrollment is confirmed with the previous window's - otherwise
 * the code this hands back is one that was already used, and the refusal that follows says nothing
 * about what the test was observing.
 * @returns A code that has not been presented yet.
 */
async function enrollInOtp(): Promise<string> {
    const twoFactorService: TwoFactorServiceInterface = inject(ZIBRI_DI_TOKENS.TWO_FACTOR_SERVICE);
    const otpMethod: OtpTwoFactorMethod = inject(OtpTwoFactorMethod);

    await twoFactorService.requestTwoFactorRegistration(user, otpMethod, undefined);
    const [credentials]: OtpCredentials[] = await inject(repositoryTokenFor(OtpCredentials))
        .findAll({ where: { userId: user.id } });
    assert(credentials, 'no otp credential was registered for the user');
    const secret: string = credentials.secret;

    await twoFactorService.confirmTwoFactorRegistration(user, otpMethod, {
        token: new TOTP({ secret, period: OTP_PERIOD_IN_SECONDS })
            .generate({ timestamp: Date.now() - (OTP_PERIOD_IN_SECONDS * Ms.SECOND) })
    });

    return new TOTP({ secret }).generate();
}

beforeAll(async () => {
    server = await startTestServer({
        dataSources: [dataSourceClass],
        controllers: [ContextController, TestAuthController],
        // two of them, because a route naming one is the only way to observe that the name is read.
        // The caller below logs in with a bearer token and is then a caller the cookie strategy has
        // never heard of, which is the case `@CurrentUser({ authStrategies: [CookieAuthStrategy] })`
        // exists to refuse
        authStrategies: [JwtAuthStrategy, CookieAuthStrategy],
        twoFactorMethods: [OtpTwoFactorMethod],
        providers: [
            ...defaultTestServerProviders,
            defineProvider({ token: ZIBRI_DI_TOKENS.COOKIE_SIGN_SECRET, useFactory: () => 'test-cookie-secret' })
        ]
    });
    baseUrl = await server.start();
    otpHeader = inject(ZIBRI_DI_TOKENS.OTP_HEADER);

    const email: string = 'request-context@example.com';
    user = await inject(repositoryTokenFor(JwtUser)).create({ email, roles: [Roles.USER] });
    const credentials: Repository<PasswordCredentials, PasswordCredentialsCreateData> = inject(repositoryTokenFor(PasswordCredentials));
    await credentials.create({ password, userId: user.id });

    const res: Response = await fetch(`${baseUrl}/auth/login?strategy=jwt`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JsonUtilities.stringify({ email, password })
    });
    const data: { accessToken: { value: string } } = await res.json() as { accessToken: { value: string } };
    accessToken = data.accessToken.value;
}, TestTimeouts.postgres.start);

afterAll(async () => {
    // guarded so a failed beforeAll reports the real cause instead of a shutdown TypeError
    await server?.shutdown();
}, TestTimeouts.postgres.shutdown);

describe('ZIBRI_REQUEST_CONTEXT_TOKENS.CURRENT_USER', () => {
    // `@CurrentUser()` means required, and the parameter is typed `CurrentUser<JwtUser>`: the
    // alternative to a 401 is a handler running with undefined where its signature promised an
    // account. No @Auth decorator on the route, so the refusal is the parameter's own
    it('refuses a caller that a required @CurrentUser cannot be resolved for', async () => {
        expect((await fetch(`${baseUrl}/context/user`)).status).toBe(401);
    });

    // a route naming which strategies may identify its user was handed whoever any strategy resolved,
    // so a bearer token identified the user on a route that said only a session may - and the
    // parameter arrived looking exactly as it should
    it('refuses a credential the route does not accept for @CurrentUser', async () => {
        // the control: the same caller is resolved where every strategy may identify them
        expect(await (await get('/user')).json()).toEqual({ id: user.id });

        expect((await get('/cookie-user')).status).toBe(401);
    });
});

describe('ZIBRI_REQUEST_CONTEXT_TOKENS.HAS_2FA', () => {
    it('says no second factor was presented when none was', async () => {
        const res: Response = await get('/second-factor');

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ has2fa: false });
    });

    // a route reading the token to decide what a session may do would otherwise read a constant
    it('says a second factor was presented when one was', async () => {
        const code: string = await enrollInOtp();

        const res: Response = await get('/second-factor', { [otpHeader]: code });

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ has2fa: true });
        // tens of milliseconds alone, and past jest's five while other suites run a postgres of their
        // own: an enrollment, its confirmation and a request with the code
    }, 30000);
});