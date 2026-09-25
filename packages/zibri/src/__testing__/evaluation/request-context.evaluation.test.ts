import assert from 'node:assert';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { TOTP } from 'otpauth';

import { OtpCredentials } from '../../auth/2fa/methods/otp/otp-credentials.model';
import { OtpTwoFactorMethod } from '../../auth/2fa/methods/otp/otp.two-factor-method';
import { OTP_PERIOD_IN_SECONDS } from '../../auth/2fa/methods/otp/otp.utilities';
import { type TwoFactorServiceInterface } from '../../auth/2fa/two-factor-service.interface';
import { Auth } from '../../auth/decorators/auth.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { CookieAuthCredentials } from '../../auth/strategies/cookie/cookie-auth-credentials.model';
import { CookieAuthRefreshSession } from '../../auth/strategies/cookie/cookie-auth-refresh-session.model';
import { CookieAuthSession } from '../../auth/strategies/cookie/cookie-auth-session.model';
import { CookieAuthStrategy } from '../../auth/strategies/cookie/cookie-auth.auth-strategy';
import { JwtAuthController } from '../../auth/strategies/jwt/jwt-auth.controller';
import { JwtCredentials, JwtCredentialsCreateData } from '../../auth/strategies/jwt/jwt-credentials.model';
import { JwtAuthStrategy } from '../../auth/strategies/jwt/jwt.auth-strategy';
import { HttpRequestContext } from '../../context/request/http-request.context';
import { ZIBRI_REQUEST_CONTEXT_TOKENS } from '../../context/request/request-context-token.model';
import { WebsocketRequestContext } from '../../context/request/websocket-request.context';
import { PostgresDataSource } from '../../data-source/data-sources/postgres/postgres-typeorm-data-source.model';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { Injectable } from '../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { defineProvider } from '../../di/models/di-provider.model';
import { InternalError } from '../../error-handling/internal-error.model';
import { Controller } from '../../routing/decorators/controller.decorator';
import { Get } from '../../routing/decorators/get.decorator';
import { Newable } from '../../types/newable.type';
import { Ms } from '../../utilities/ms';
import { JwtUser } from '../mocks/entities/jwt-user.entity';
import { Roles } from '../mocks/entities/roles.enum';
import { createTestDataSource, defaultTestServerEntities } from '../test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../test-server/providers';
import { StartedTestServer, startTestServer } from '../test-server/start-test-server.function';

/**
 * Executable form of evaluation/02-http-runtime-core.md M5, of the dead cache half of M4, and of
 * 05-di-metadata-and-packaging.md D2 - the request scope, whose point is that a service can be built
 * per request rather than reaching for the context at call time.
 *
 * A http request is routed after its context exists, so nothing ever told the context which route it
 * matched. Every consumer of that took its "routing has not resolved yet" branch - forever - which
 * meant `@CurrentUser`'s own arguments were read for the parameter index and then thrown away, and
 * the token that answers whether a second factor was presented answered `false` without looking.
 *
 * The three `context.has(...)` short circuits that read those tokens back are the other half. They
 * answer a question without regard to the arguments it was asked with, which is why closing M5 could
 * not leave them in place: a live token would have made them return an answer computed for a
 * different set of strategies.
 *
 * Every expectation describes the fixed behavior, so this file is red until the finding is closed.
 * See ./README.md for why.
 */

const password: string = 'secure123';

const dataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: [...defaultTestServerEntities, CookieAuthCredentials, CookieAuthSession, CookieAuthRefreshSession]
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

let instancesBuilt: number = 0;

/**
 * A service that lives for one request, which is what the whole scope exists to allow.
 *
 * Counting constructions is what makes the scope observable from outside: a value that is built
 * again per request is a different id, and one that is kept for the process is the same id forever.
 */
@Injectable({ scope: 'request' })
class PerRequestService {
    readonly id: number = ++instancesBuilt;
}

@Controller('/evaluation-context')
class EvaluationContextController {

    // no @Auth decorator anywhere on this controller: the point is what @CurrentUser's own
    // arguments are worth, and an @Auth.isLoggedIn() above them would refuse the caller first and
    // leave that unanswered
    @Get('/required-user')
    requiredUser(
        @CurrentUser()
        user: JwtUser
    ): { id: string } {
        return { id: user.id };
    }

    @Get('/optional-user')
    optionalUser(
        @CurrentUser(false)
        user: JwtUser | undefined
    ): { id: string | undefined } {
        return { id: user?.id };
    }

    @Get('/cookie-user')
    cookieUser(
        @CurrentUser(true, [CookieAuthStrategy])
        user: JwtUser
    ): { id: string } {
        return { id: user.id };
    }

    @Get('/matched-route')
    matchedRoute(): { controller: string | undefined, method: string | undefined } {
        const context: HttpRequestContext | WebsocketRequestContext = currentContext();
        return { controller: context.controllerClass?.name, method: context.controllerMethod };
    }

    @Auth.isLoggedIn()
    @Get('/second-factor')
    async secondFactor(): Promise<{ has2fa: boolean }> {
        return { has2fa: await currentContext().get(ZIBRI_REQUEST_CONTEXT_TOKENS.HAS_2FA) };
    }

    @Get('/request-scope')
    requestScope(): { first: number, second: number } {
        // asked for twice on purpose: one request is meant to see one instance, however many times
        // it asks, while the next request sees its own
        return { first: inject(PerRequestService).id, second: inject(PerRequestService).id };
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
async function get(path: string, headers: Record<string, string> = {}): Promise<globalThis.Response> {
    return await fetch(`${baseUrl}/evaluation-context${path}`, {
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

    await twoFactorService.requestRegisterTwoFactorMethodForUser(user, otpMethod, undefined);
    const [credentials]: OtpCredentials[] = await inject(repositoryTokenFor(OtpCredentials))
        .findAll({ where: { userId: user.id } });
    assert(credentials, 'no otp credential was registered for the user');
    const secret: string = credentials.secret;

    await twoFactorService.confirmRegisterTwoFactorMethodForUser(user, otpMethod, {
        token: new TOTP({ secret, period: OTP_PERIOD_IN_SECONDS })
            .generate({ timestamp: Date.now() - (OTP_PERIOD_IN_SECONDS * Ms.SECOND) })
    });

    return new TOTP({ secret }).generate();
}

beforeAll(async () => {
    server = await startTestServer({
        dataSources: [dataSourceClass],
        controllers: [EvaluationContextController, JwtAuthController],
        // two of them, because a route naming one is the only way to observe that the name is read.
        // Only the jwt one has its controller mounted - the caller below logs in with a bearer token
        // and is then a caller the cookie strategy has never heard of, which is exactly the case
        // `@CurrentUser(true, [CookieAuthStrategy])` exists to refuse.
        authStrategies: [JwtAuthStrategy, CookieAuthStrategy],
        twoFactorMethods: [OtpTwoFactorMethod],
        providers: [
            ...defaultTestServerProviders,
            defineProvider({ token: ZIBRI_DI_TOKENS.COOKIE_SIGN_SECRET, useFactory: () => 'test-cookie-secret' })
        ]
    });
    baseUrl = await server.start();
    otpHeader = inject(ZIBRI_DI_TOKENS.OTP_HEADER);

    const email: string = 'request-context-evaluation@example.com';
    user = await inject(repositoryTokenFor(JwtUser)).create({ email, roles: [Roles.USER] });
    const credentials: Repository<JwtCredentials, JwtCredentialsCreateData> = inject(repositoryTokenFor(JwtCredentials));
    await credentials.create({ email, password, userId: user.id });

    const res: globalThis.Response = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password })
    });
    const data: { accessToken: { value: string } } = await res.json() as { accessToken: { value: string } };
    accessToken = data.accessToken.value;
}, 60000);

afterAll(async () => {
    // guarded so a failed beforeAll reports the real cause instead of a shutdown TypeError
    await server?.shutdown();
}, 15000);

describe('evaluation/02-http-runtime-core M5 - the matched route on the request context', () => {

    it('names the route that is handling the request', async () => {
        const res: globalThis.Response = await get('/matched-route');

        // the claim docs/request-context.md makes about controllerClass and controllerMethod, read
        // from inside the handler they name. Both stayed undefined there, which is what made every
        // branch below unreachable rather than merely wrong
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ controller: 'EvaluationContextController', method: 'matchedRoute' });
    });

    it('refuses a caller that a required @CurrentUser cannot be resolved for', async () => {
        const res: globalThis.Response = await fetch(`${baseUrl}/evaluation-context/required-user`);

        // `@CurrentUser()` means required - the decorator says so and the docs show it beside a
        // route that expects a user. The parameter is typed `JwtUser`, so the alternative to a 401
        // is a handler running with undefined where its own signature promised an account
        expect(res.status).toBe(401);
    });

    it('hands a required @CurrentUser to a caller that is logged in', async () => {
        // the control for the case above: the refusal has to be about resolving nobody, not about
        // the parameter being unresolvable
        const res: globalThis.Response = await get('/required-user');

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ id: user.id });
    });

    it('runs a route with an optional @CurrentUser for a caller that is not logged in', async () => {
        const res: globalThis.Response = await fetch(`${baseUrl}/evaluation-context/optional-user`);

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({});
    });

    it('refuses a credential the route does not accept for @CurrentUser', async () => {
        const res: globalThis.Response = await get('/cookie-user');

        // the security half. A route that names which strategies may identify its user was handed
        // whoever any strategy resolved, so a bearer token identified the user on a route that said
        // only a session may - and the parameter arrived looking exactly as it should
        expect(res.status).toBe(401);
    });
});

describe('evaluation/05-di-metadata-and-packaging D2 - the request scope', () => {

    it('builds one instance per request, over http', async () => {
        const first: { first: number, second: number } = await (await get('/request-scope')).json() as { first: number, second: number };
        const second: { first: number, second: number } = await (await get('/request-scope')).json() as { first: number, second: number };

        // singleton-or-transient was the whole scope model: as a singleton both requests read one
        // id, and as a transient the two asks inside one request read two
        expect(first.first).toBe(first.second);
        expect(second.first).toBe(second.second);
        expect(first.first).not.toBe(second.first);
    });
});

describe('evaluation/02-http-runtime-core M5 - the second factor token', () => {

    it('says no second factor was presented when none was', async () => {
        const res: globalThis.Response = await get('/second-factor');

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ has2fa: false });
    });

    it('says a second factor was presented when one was', async () => {
        const code: string = await enrollInOtp();

        const res: globalThis.Response = await get('/second-factor', { [otpHeader]: code });

        // the answer the token returned unconditionally before, for every request, whether or not a
        // valid code came with it. A route reading it to decide what a session may do read a
        // constant.
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ has2fa: true });
    });
});