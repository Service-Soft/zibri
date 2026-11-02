import assert from 'node:assert';

import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';

import { PasswordCredentials, PasswordCredentialsCreateData } from './authenticators/password/password-credentials.model';
import { Auth } from './decorators/auth.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { RouteAuthServiceInterface } from './route-auth-service.interface';
import { JwtTestAuthController } from '../__testing__/mocks/controllers/jwt-test-auth.controller';
import { JwtUser } from '../__testing__/mocks/entities/jwt-user.entity';
import { Roles } from '../__testing__/mocks/entities/roles.enum';
import { TestPermissions, TestPlatformPermissions } from '../__testing__/mocks/entities/test-permissions.model';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { Repository } from '../data-source/repository/repository';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { defineProvider } from '../di/models/di-provider.model';
import { HttpMethod } from '../http/http-method.enum';
import { AuditAction, AuditOutcome, AuditReason } from '../logging/audit-event.model';
import { Log } from '../logging/log.model';
import { LoggerInterface } from '../logging/logger.interface';
import { OpenApiDefinition, OpenApiOperation, OpenApiSecurityRequirementObject } from '../open-api/open-api.model';
import { Controller } from '../routing/decorators/controller.decorator';
import { Get } from '../routing/decorators/get.decorator';
import { type RouterInterface } from '../routing/router.interface';
import { JsonUtilities } from '../utilities/json.utilities';

/**
 * The `'isLoggedIn'` half of `defaultAuth`.
 *
 * The `'public'` half is in ./auth.service.test.ts, whose server declares it - including the
 * "Useless @Auth.skip" warning, which is only correct there. Both halves exist because the warning
 * is a statement about the declared default rather than about the decorators alone: the same
 * `@Auth.skip` is noise under one and load bearing under the other.
 */
@Controller('/default-auth')
class DefaultAuthController {
    @Get('/undecorated')
    undecorated(): string {
        return 'said nothing';
    }

    @Get('/declared-public')
    @Auth.skip()
    declaredPublic(): string {
        return 'said nothing, on purpose';
    }

    @Get('/login-skipped')
    @Auth.isLoggedIn.skip()
    loginSkipped(): string {
        return 'said it does not need a login';
    }

    @Get('/permission-skipped')
    @Auth.hasPermission.skip()
    permissionSkipped(): string {
        return 'said nothing about a login';
    }

    @Get('/optional-user')
    optionalUser(@CurrentUser({ required: false }) user: CurrentUser | undefined): string {
        return user == undefined ? 'anonymous' : user.id;
    }

    @Get('/optional-user-public')
    @Auth.skip()
    optionalUserPublic(@CurrentUser({ required: false }) user: CurrentUser | undefined): string {
        return user == undefined ? 'anonymous' : user.id;
    }
}

/**
 * A whole controller declared public, with one route that opts back in.
 */
@Auth.skip()
@Controller('/default-auth-public')
class PublicControllerWithOneGuardedRoute {
    @Get('/anyone')
    anyone(): string {
        return 'covered by the controller level skip';
    }

    @Get('/admins')
    @Auth.hasPermission(TestPermissions.MEMBER_ADMIN)
    admins(): string {
        return 'not covered by it';
    }
}

/**
 * A whole controller that opts out of the login requirement only.
 */
@Auth.isLoggedIn.skip()
@Controller('/default-auth-login-skipped')
class LoginSkippedController {
    @Get('/anyone')
    anyone(): string {
        return 'covered by the controller level login skip';
    }
}

const PASSWORD: string = 'secure123';

let server: StartedTestServer;
let baseUrl: string;

/**
 * The running application's route auth service.
 *
 * Resolved per call rather than once in `beforeAll`, so it is the instance of whichever container is
 * live rather than of the one that happened to exist first.
 * @returns The service.
 */
function routeAuthService(): RouteAuthServiceInterface {
    return inject(ZIBRI_DI_TOKENS.ROUTE_AUTH_SERVICE);
}

let userToken: string;
let adminToken: string;

/**
 * Creates a user with the given roles and logs in as them.
 * @param email - The address of the account.
 * @param roles - What the account may do.
 * @returns The access token a client sends.
 */
async function createAndLogIn(email: string, roles: Roles[]): Promise<string> {
    const user: JwtUser = await inject(repositoryTokenFor(JwtUser)).create({ email, roles });
    await inject<Repository<PasswordCredentials, PasswordCredentialsCreateData>>(repositoryTokenFor(PasswordCredentials))
        .create({ password: PASSWORD, userId: user.id });
    const res: Response = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JsonUtilities.stringify({ email, password: PASSWORD })
    });
    expect(res.status).toBe(200);
    return (await res.json() as { accessToken: { value: string } }).accessToken.value;
}

/**
 * Calls a route.
 * @param route - The route.
 * @param token - The access token to send, if any.
 * @returns The status it was answered with.
 */
async function call(route: string, token?: string): Promise<number> {
    return (await fetch(`${baseUrl}${route}`, { headers: token == undefined ? {} : { authorization: `Bearer ${token}` } })).status;
}

beforeAll(async () => {
    server = await startTestServer({
        controllers: [DefaultAuthController, PublicControllerWithOneGuardedRoute, LoginSkippedController, JwtTestAuthController],
        defaultAuth: 'isLoggedIn',
        // the document open to everyone, which the spec cases below read anonymously
        providers: [...defaultTestServerProviders, defineProvider({ token: ZIBRI_DI_TOKENS.OPEN_API_AUTH, useValue: { skip: true } })]
    });
    baseUrl = await server.start();

    // registered once the application runs, the way a plugin does
    const router: RouterInterface = inject(ZIBRI_DI_TOKENS.ROUTER);
    router.registerRoute({ httpMethod: HttpMethod.GET, route: '/manual/inherits', openApi: { useInOpenApi: false }, handler: () => 'inherits' });
    router.registerRoute({
        httpMethod: HttpMethod.GET,
        route: '/manual/public',
        openApi: { useInOpenApi: false },
        auth: { skip: true },
        handler: () => 'public'
    });
    router.registerRoute({
        httpMethod: HttpMethod.GET,
        route: '/manual/admin',
        openApi: { useInOpenApi: false },
        auth: { hasPlatformPermission: { permission: TestPlatformPermissions.ADMIN } },
        handler: () => 'admin'
    });
    router.registerRoute({
        httpMethod: HttpMethod.GET,
        route: '/manual/second-factor',
        openApi: { useInOpenApi: false },
        auth: { require2fa: {} },
        handler: () => 'second factor'
    });
    userToken = await createAndLogIn('manual-user@example.com', [Roles.USER]);
    adminToken = await createAndLogIn('manual-admin@example.com', [Roles.ADMIN]);
}, 60000);

afterAll(async () => {
    await server.shutdown();
}, 30000);

// a route registered without a controller ran its handler for anybody, since only the controller
// handler checked access - the framework's own routes among them
describe('defaultAuth: isLoggedIn, on a route registered without a controller', () => {
    it('refuses an anonymous caller on a route that states nothing, and serves a logged in one', async () => {
        expect(await call('/manual/inherits')).toBe(401);
        expect(await call('/manual/inherits', userToken)).toBe(200);
    });

    it('serves a route that states it is public to an anonymous caller', async () => {
        expect(await call('/manual/public')).toBe(200);
    });

    it('refuses a caller without the permission the route asks for, and serves one who has it', async () => {
        expect(await call('/manual/admin', userToken)).toBe(403);
        expect(await call('/manual/admin', adminToken)).toBe(200);
    });

    it('refuses a caller who presented no second factor, and an anonymous one before asking about it', async () => {
        expect(await call('/manual/second-factor', userToken)).toBe(401);
        expect(await call('/manual/second-factor')).toBe(401);
    });

    // a browser asks for a favicon on its own, before any login exists to send
    it('serves the favicon without a login', async () => {
        expect(await call('/favicon.ico')).not.toBe(401);
    });
});

describe('defaultAuth: isLoggedIn', () => {
    it('refuses a route that carries no auth decorators', async () => {
        const res: Response = await fetch(`${baseUrl}/default-auth/undecorated`);

        expect(res.status).toBe(401);
    });

    // an access review asks who was refused what. Denials only: a line per allowed request would be
    // an access log, and burying these in one defeats the purpose
    it('records that a route refused an anonymous caller, and why', async () => {
        const logger: LoggerInterface = inject(ZIBRI_DI_TOKENS.LOGGER);
        await logger.flush();
        await inject(repositoryTokenFor(Log)).deleteAll({});

        expect(await call('/default-auth/undecorated')).toBe(401);

        await logger.flush();
        expect((await inject(repositoryTokenFor(Log)).findAll({})).map(l => l.context.metadata?.['audit'])).toContainEqual({
            action: AuditAction.AUTHORIZATION,
            outcome: AuditOutcome.FAILURE,
            reason: AuditReason.NOT_LOGGED_IN
        });
    });

    it('serves a route that skips auth explicitly', async () => {
        const res: Response = await fetch(`${baseUrl}/default-auth/declared-public`);

        expect(res.status).toBe(200);
    });

    it('serves a route that skips only the login check', async () => {
        const res: Response = await fetch(`${baseUrl}/default-auth/login-skipped`);

        // @Auth.isLoggedIn.skip says exactly one thing - this route does not need a login - and the
        // application wide requirement is a login. Letting it survive would turn the decorator into
        // a no-op that still reads like it does something.
        expect(res.status).toBe(200);
    });

    it('still refuses a route that skips only a check saying nothing about a login', async () => {
        const res: Response = await fetch(`${baseUrl}/default-auth/permission-skipped`);

        // the asymmetry, and the easiest thing to get wrong later: @Auth.isLoggedIn.skip opts a
        // route out of the application wide requirement because that requirement *is* a login.
        // hasPermission.skip, require2fa.skip and isNotLoggedIn.skip say nothing about one, so they
        // must not - a route that skipped a permission check has not thereby become public.
        expect(res.status).toBe(401);
    });

    // `@CurrentUser({ required: false })` says what the handler is given, not who may call
    // it, so under this default an anonymous caller is refused until the route says it is public
    it('refuses an anonymous caller of a route whose user is optional, until the route skips auth', async () => {
        const optional: Response = await fetch(`${baseUrl}/default-auth/optional-user`);
        const skipped: Response = await fetch(`${baseUrl}/default-auth/optional-user-public`);

        expect(optional.status).toBe(401);
        expect(skipped.status).toBe(200);
        expect(await skipped.json()).toBe('anonymous');
    });

    it('serves every route of a controller that skips auth', async () => {
        const res: Response = await fetch(`${baseUrl}/default-auth-public/anyone`);

        expect(res.status).toBe(200);
    });

    it('keeps a route guarded when it declares its own rule on a skipped controller', async () => {
        const res: Response = await fetch(`${baseUrl}/default-auth-public/admins`);

        // a controller level skip is a statement about the routes that say nothing, not permission
        // to override the ones that do. Reading it the other way would make the broadest decorator
        // in the namespace silently disarm the narrowest.
        expect(res.status).toBe(401);
    });

    it('serves a controller that skips only the login check', async () => {
        const res: Response = await fetch(`${baseUrl}/default-auth-login-skipped/anyone`);

        expect(res.status).toBe(200);
    });

    // the three below resolve a declaration rather than call the route, because that is when the
    // warning is due: the router resolves each route once while registering it, and a request reads
    // the answer back out of the route registry without resolving anything
    it('does not call @Auth.skip useless', () => {
        const logger: LoggerInterface = inject(ZIBRI_DI_TOKENS.LOGGER);
        // eslint-disable-next-line typescript/typedef
        const warnSpy = jest.spyOn(logger, 'warn');

        routeAuthService().resolveRouteAuth(DefaultAuthController, 'declaredPublic');

        // the inverse of ./auth.service.test.ts's warning case. Under this default the skip is the
        // only thing making the route reachable, so warning about it would tell a developer to
        // delete the decorator that is holding the route open.
        expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('Useless @Auth.skip'));
        warnSpy.mockRestore();
    });

    it('does not call @Auth.isLoggedIn.skip useless either', () => {
        const logger: LoggerInterface = inject(ZIBRI_DI_TOKENS.LOGGER);
        // eslint-disable-next-line typescript/typedef
        const warnSpy = jest.spyOn(logger, 'warn');

        routeAuthService().resolveRouteAuth(DefaultAuthController, 'loginSkipped');
        routeAuthService().resolveRouteAuth(LoginSkippedController, 'anyone');

        // it opts a route out of the application wide requirement, so under this default it is
        // load bearing in exactly the way @Auth.skip is
        expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('Useless @Auth.isLoggedIn.skip'));
        warnSpy.mockRestore();
    });

    it('still calls a per-check skip useless when it says nothing about a login', () => {
        const logger: LoggerInterface = inject(ZIBRI_DI_TOKENS.LOGGER);
        // eslint-disable-next-line typescript/typedef
        const warnSpy = jest.spyOn(logger, 'warn');

        routeAuthService().resolveRouteAuth(DefaultAuthController, 'permissionSkipped');

        // the control for the two above: making the isLoggedIn skips conditional must not quietly
        // silence the others, which have nothing to skip under either default
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Useless @Auth.hasPermission.skip'));
        warnSpy.mockRestore();
    });

    describe('open api spec', () => {
        let spec: OpenApiDefinition;

        beforeAll(async () => {
            // anonymously, even though this application requires a login for everything that does
            // not say otherwise: its ZIBRI_DI_TOKENS.OPEN_API_AUTH opens the OpenApi surface, which
            // follows defaultAuth when nothing is provided.
            const res: Response = await fetch(`${baseUrl}/explorer/spec/1.0.0`);
            expect(res.status).toBe(200);
            // eslint-disable-next-line typescript/no-unsafe-assignment
            spec = await res.json();
        }, 20000);

        /**
         * The security requirements the spec documents for a GET route, asserting it is documented at all.
         * @param path - The OpenApi path key.
         * @returns The requirements, or undefined when the spec calls the route public.
         */
        function securityOf(path: string): OpenApiSecurityRequirementObject[] | undefined {
            const operation: OpenApiOperation | undefined = spec.paths?.[path]?.get;
            assert(operation, `the spec does not document GET ${path}`);
            return operation.security;
        }

        it('documents a route that carries no auth decorators as requiring auth', () => {
            // the same route the first test of this file gets a 401 from. Its decorators say nothing,
            // so reading only those documented it as public - and the spec is what consumers read
            // instead of the code, which made it advertise every route the default protects as open.
            expect(securityOf('/default-auth/undecorated')).toBeDefined();
            expect(securityOf('/default-auth/undecorated')?.length).toBeGreaterThan(0);
        });

        it('still documents a route that skips only a permission check as requiring auth', () => {
            // it answers 401 too: @Auth.hasPermission.skip says nothing about a login, so the
            // application wide requirement survives it
            expect(securityOf('/default-auth/permission-skipped')).toBeDefined();
        });

        it('documents a route on a controller that skips auth as requiring auth when it guards itself', () => {
            expect(securityOf('/default-auth-public/admins')).toBeDefined();
        });

        it('documents the routes that opted out as public', () => {
            // the control: a skip is how a route says "nothing" on purpose, and the spec has to
            // repeat that rather than mark everything secured
            expect(securityOf('/default-auth/declared-public')).toBeUndefined();
            expect(securityOf('/default-auth/login-skipped')).toBeUndefined();
            expect(securityOf('/default-auth-public/anyone')).toBeUndefined();
            expect(securityOf('/default-auth-login-skipped/anyone')).toBeUndefined();
        });
    });
});