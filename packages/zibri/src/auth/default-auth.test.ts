import assert from 'node:assert';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AuthServiceInterface } from './auth-service.interface.ts';
import { Auth } from './decorators/auth.decorator.ts';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function.ts';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default.ts';
import { inject } from '../di/inject.function.ts';
import { LoggerInterface } from '../logging/logger.interface.ts';
import { OpenApiDefinition, OpenApiOperation, OpenApiSecurityRequirementObject } from '../open-api/open-api.model.ts';
import { Controller } from '../routing/decorators/controller.decorator.ts';
import { Get } from '../routing/decorators/get.decorator.ts';

/**
 * The `'requireLogin'` half of `defaultAuth`.
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

    @Get('/role-skipped')
    @Auth.hasRole.skip()
    roleSkipped(): string {
        return 'said nothing about a login';
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
    @Auth.hasRole(['ADMIN'])
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

let server: StartedTestServer;
let baseUrl: string;

/**
 * The running application's auth service.
 *
 * Resolved per call rather than once in `beforeAll`, so it is the instance of whichever container is
 * live rather than of the one that happened to exist first.
 * @returns The service.
 */
function authService(): AuthServiceInterface {
    return inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
}

beforeAll(async () => {
    server = await startTestServer({
        controllers: [DefaultAuthController, PublicControllerWithOneGuardedRoute, LoginSkippedController],
        defaultAuth: 'requireLogin'
    });
    baseUrl = await server.start();
}, 60000);

afterAll(async () => {
    await server.shutdown();
}, 30000);

describe('defaultAuth: requireLogin', () => {
    it('refuses a route that carries no auth decorators', async () => {
        const res: Response = await fetch(`${baseUrl}/default-auth/undecorated`);

        expect(res.status).toBe(401);
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
        const res: Response = await fetch(`${baseUrl}/default-auth/role-skipped`);

        // the asymmetry, and the easiest thing to get wrong later: @Auth.isLoggedIn.skip opts a
        // route out of the application wide requirement because that requirement *is* a login.
        // hasRole.skip, belongsTo.skip, require2fa.skip and isNotLoggedIn.skip say nothing about
        // one, so they must not - a route that skipped a role check has not thereby become public.
        expect(res.status).toBe(401);
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
        // eslint-disable-next-line typescript-js/typedef
        const warnSpy = vi.spyOn(logger, 'warn');

        authService().resolveRouteAuth(DefaultAuthController, 'declaredPublic');

        // the inverse of ./auth.service.test.ts's warning case. Under this default the skip is the
        // only thing making the route reachable, so warning about it would tell a developer to
        // delete the decorator that is holding the route open.
        expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('Useless @Auth.skip'));
        warnSpy.mockRestore();
    });

    it('does not call @Auth.isLoggedIn.skip useless either', () => {
        const logger: LoggerInterface = inject(ZIBRI_DI_TOKENS.LOGGER);
        // eslint-disable-next-line typescript-js/typedef
        const warnSpy = vi.spyOn(logger, 'warn');

        authService().resolveRouteAuth(DefaultAuthController, 'loginSkipped');
        authService().resolveRouteAuth(LoginSkippedController, 'anyone');

        // it opts a route out of the application wide requirement, so under this default it is
        // load bearing in exactly the way @Auth.skip is
        expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('Useless @Auth.isLoggedIn.skip'));
        warnSpy.mockRestore();
    });

    it('still calls a per-check skip useless when it says nothing about a login', () => {
        const logger: LoggerInterface = inject(ZIBRI_DI_TOKENS.LOGGER);
        // eslint-disable-next-line typescript-js/typedef
        const warnSpy = vi.spyOn(logger, 'warn');

        authService().resolveRouteAuth(DefaultAuthController, 'roleSkipped');

        // the control for the two above: making the isLoggedIn skips conditional must not quietly
        // silence the other four, which have nothing to skip under either default
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Useless @Auth.hasRole.skip'));
        warnSpy.mockRestore();
    });

    describe('open api spec', () => {
        let spec: OpenApiDefinition;

        beforeAll(async () => {
            // anonymously, even though this application requires a login for everything that does
            // not say otherwise: the OpenApi surface says otherwise by default. See
            // ZIBRI_DI_TOKENS.OPEN_API_AUTH for why, and
            // ../__testing__/evaluation/manual-routes.evaluation.test.ts for an application that
            // decides differently.
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

        it('still documents a route that skips only a role check as requiring auth', () => {
            // it answers 401 too: @Auth.hasRole.skip says nothing about a login, so the application
            // wide requirement survives it
            expect(securityOf('/default-auth/role-skipped')).toBeDefined();
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