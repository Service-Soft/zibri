import assert from 'node:assert';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { PasswordCredentials, PasswordCredentialsCreateData } from '../../auth/authenticators/password/password-credentials.model';
import { PostgresDataSource } from '../../data-source/data-sources/postgres/postgres-typeorm-data-source.model';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { defineProvider } from '../../di/models/di-provider.model';
import { HttpMethod } from '../../http/http-method.enum';
import { type RouterInterface } from '../../routing/router.interface';
import { Newable } from '../../types/newable.type';
import { JsonUtilities } from '../../utilities/json.utilities';
import { JwtTestAuthController } from '../mocks/controllers/jwt-test-auth.controller';
import { JwtUser } from '../mocks/entities/jwt-user.entity';
import { Roles } from '../mocks/entities/roles.enum';
import { createTestDataSource } from '../test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../test-server/providers';
import { StartedTestServer, startTestServer } from '../test-server/start-test-server.function';

/**
 * Executable form of evaluation/02-http-runtime-core.md M13.
 *
 * `registerRoute` is the other way to mount a route, and it used to be the way that reached no
 * authorization at all: `checkAccess` was called from the controller handler and from nowhere else,
 * so a manually registered route had no metadata to read and no check run against it. The framework's
 * own OpenAPI surface is registered this way, which is why an application declaring
 * `defaultAuth: 'requireLogin'` still served its spec to anyone.
 *
 * The server here declares `requireLogin`, because that is the posture the hole is visible against: a
 * `'public'` application is not lied to by a route that answers everybody.
 */

const password: string = 'secure123';

let server: StartedTestServer | undefined;
let baseUrl: string;
let userToken: string;
let adminToken: string;

const dataSourceClass: Newable<PostgresDataSource> = createTestDataSource();

/**
 * Creates a user with the given roles and logs in as them.
 * @param email - The address to create the account under.
 * @param roles - What the account may do.
 * @returns The access token a client would send.
 */
async function createAndLogIn(email: string, roles: Roles[]): Promise<string> {
    const user: JwtUser = await inject(repositoryTokenFor(JwtUser)).create({ email, roles });
    const credentials: Repository<PasswordCredentials, PasswordCredentialsCreateData> = inject(repositoryTokenFor(PasswordCredentials));
    await credentials.create({ password, userId: user.id });

    const res: Response = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JsonUtilities.stringify({ email, password })
    });
    expect(res.status).toBe(200);
    const data: { accessToken: { value: string } } = await res.json() as { accessToken: { value: string } };
    return data.accessToken.value;
}

/**
 * Calls one of the routes registered below.
 * @param route - The route to call.
 * @param token - The access token to send, if any.
 * @returns The status the server answered with.
 */
async function call(route: string, token?: string): Promise<number> {
    const res: Response = await fetch(`${baseUrl}${route}`, {
        headers: token == undefined ? {} : { authorization: `Bearer ${token}` }
    });
    return res.status;
}

beforeAll(async () => {
    server = await startTestServer({
        dataSources: [dataSourceClass],
        // the real login endpoint, because the point is what a *logged in* caller gets - a file that
        // only ever sends anonymous requests cannot tell a closed route from a broken one
        controllers: [JwtTestAuthController],
        defaultAuth: 'requireLogin'
    });
    baseUrl = await server.start();

    // registered after init on purpose: this is the shape an application plugin uses, and
    // registerRoute mounts immediately once the deferred loop has already run
    const router: RouterInterface = inject(ZIBRI_DI_TOKENS.ROUTER);
    router.registerRoute({
        httpMethod: HttpMethod.GET,
        route: '/manual/inherits',
        openApi: { useInOpenApi: false },
        handler: () => 'inherits'
    });
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
        auth: { hasPlatformRole: { allowedRoles: [Roles.ADMIN] } },
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
    // guarded so a failed beforeAll reports the real cause instead of a shutdown TypeError
    await server?.shutdown();
}, 30000);

describe('evaluation/02-http-runtime-core M13 - a manually registered route is still a route', () => {

    describe('the application default reaches it', () => {
        it('refuses an anonymous caller on a route that states nothing', async () => {
            // the finding: checkAccess was reached from the controller handler and from nowhere
            // else, so this route ran its handler for anybody. `defaultAuth: 'requireLogin'` is the
            // application saying nothing is reachable without a login, and it has to mean that for
            // every route rather than for the ones that happen to be on a class.
            expect(await call('/manual/inherits')).toBe(401);
        });

        it('serves that same route to a logged in caller', async () => {
            // the control: the route works, so the refusal above is the check rather than a broken
            // handler or a route that was never mounted
            expect(await call('/manual/inherits', userToken)).toBe(200);
        });

        it('serves a route that states it is public to an anonymous caller', async () => {
            // the way out of the default, and the reason the default can be safe: a route that has
            // to answer anonymously says so, once, where anyone reading it can see it
            expect(await call('/manual/public')).toBe(200);
        });
    });

    describe('it can state the checks a decorated route states', () => {
        it('refuses a caller who does not have the role the route asks for', async () => {
            expect(await call('/manual/admin', userToken)).toBe(403);
        });

        it('serves the caller who has it', async () => {
            expect(await call('/manual/admin', adminToken)).toBe(200);
        });

        it('refuses a logged in caller who presented no second factor', async () => {
            expect(await call('/manual/second-factor', userToken)).toBe(401);
        });

        it('still refuses an anonymous caller before asking about the second factor', async () => {
            expect(await call('/manual/second-factor')).toBe(401);
        });
    });

    describe('the framework registers its own routes this way', () => {
        it('serves the openapi spec to anyone, even where everything else needs a login', async () => {
            // the OpenApi surface states its posture rather than inheriting, and what it states is
            // public. A browser reaches the explorer by navigating to it, and a navigation carries no
            // Authorization header, so inheriting a login requirement would leave a bearer token
            // application with an explorer nobody can open rather than one only its callers can.
            expect(await call('/explorer/spec/1.0.0')).toBe(200);
        });

        it('serves the favicon without a login', async () => {
            // the same kind of route for the same kind of reason: a browser asks for a favicon on
            // its own, before any login exists to send
            expect(await call('/favicon.ico')).not.toBe(401);
        });
    });

    // last in the file on purpose: it replaces the running application with one configured
    // differently, and nothing after it would be looking at the server the tests above started
    describe('an application that does not publish its endpoint map', () => {
        it('puts the whole openapi surface behind the login it declared', async () => {
            assert(server);
            await server.reInit({
                providers: [
                    ...defaultTestServerProviders,
                    // `{}` is a route that says nothing, which is how a manually registered route
                    // asks for the application's default - the same thing an undecorated controller
                    // route gets
                    defineProvider({ token: ZIBRI_DI_TOKENS.OPEN_API_AUTH, useFactory: () => ({}) })
                ]
            });
            baseUrl = await server.start();
            const token: string = await createAndLogIn('manual-openapi@example.com', [Roles.USER]);

            // the spec is a map of every endpoint the application has, and since this rework it also
            // documents which of them answer anonymous callers. An api whose shape is not for
            // everyone can say so in one place, including behind a role.
            expect(await call('/explorer/spec/1.0.0')).toBe(401);
            expect(await call('/explorer/spec/1.0.0', token)).toBe(200);
        }, 60000);
    });
});