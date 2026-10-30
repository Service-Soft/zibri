import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { PasswordCredentials, PasswordCredentialsCreateData } from '../../auth/authenticators/password/password-credentials.model';
import { Auth } from '../../auth/decorators/auth.decorator';
import { HasPermissionMetadata } from '../../auth/models/has-permission-metadata.model';
import { ApiKeyAuthStrategy } from '../../auth/strategies/api-key/api-key.auth-strategy';
import { JwtAuthStrategy } from '../../auth/strategies/jwt/jwt.auth-strategy';
import { PostgresDataSource } from '../../data-source/data-sources/postgres/postgres-data-source.model';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { inject } from '../../di/inject.function';
import { InvalidDecoratorCombinationError } from '../../error-handling/errors/invalid-decorator-combination.error';
import { Controller } from '../../routing/decorators/controller.decorator';
import { Get } from '../../routing/decorators/get.decorator';
import { Newable } from '../../types/newable.type';
import { JsonUtilities } from '../../utilities/json.utilities';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { TestTimeouts } from '../constants';
import { JwtTestAuthController } from '../mocks/controllers/jwt-test-auth.controller';
import { JwtUser } from '../mocks/entities/jwt-user.entity';
import { Roles } from '../mocks/entities/roles.enum';
import { TestPlatformPermissions } from '../mocks/entities/test-permissions.model';
import { createTestDataSource, defaultTestServerEntities, defaultTestServerRepositories } from '../test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../test-server/start-test-server.function';

/**
 * Executable form of evaluation/02-http-runtime-core.md M3.
 *
 * What a route declared is static: the decorators run once, when the module is loaded, and nothing
 * can change what they said afterwards. It was nevertheless read back on every request - around forty
 * lookups, each one allocating a copy - and reading it is not free of side effects either, because
 * that is where a declaration nothing can satisfy is caught and where the "Useless @Auth.skip"
 * warnings come from. A route the framework refuses to make sense of therefore booted cleanly and
 * failed on whoever called it first.
 *
 * The copy those lookups allocated was a shallow spread, so the arrays inside it - the strategies a
 * route accepts a caller from - were still the route's own. Handing them out is handing out the
 * ability to widen the route.
 *
 * Every expectation describes the fixed behavior, so this file is red until the finding is closed.
 * See ./README.md for why.
 */

const password: string = 'secure123';

const dataSourceClass: Newable<PostgresDataSource> = createTestDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories });

@Controller('/evaluation-route-metadata')
class RouteMetadataController {

    // what the caller below holds, accepted only from a strategy their login is not one of
    @Auth.hasPlatformPermission(TestPlatformPermissions.USER, [ApiKeyAuthStrategy])
    @Get('/keys-only')
    keysOnly(): { ok: boolean } {
        return { ok: true };
    }

    // carries no declaration at all, so anything that appears on it after boot appeared after the
    // route was registered
    @Get('/plain')
    plain(): { ok: boolean } {
        return { ok: true };
    }
}

// an orphan for every test but the last one, which is the only place an application is asked to
// register it
@Controller('/evaluation-impossible', { allowOrphan: true })
class ImpossibleController {

    // says both "a caller has to be logged in" and "check nothing". There is no reading of the two
    // that a request could be served under.
    @Auth.isLoggedIn()
    @Auth.skip()
    @Get('/both')
    both(): { ok: boolean } {
        return { ok: true };
    }
}

let server: StartedTestServer | undefined;
let baseUrl: string;
let accessToken: string;

beforeAll(async () => {
    server = await startTestServer({
        dataSources: [dataSourceClass],
        controllers: [RouteMetadataController, JwtTestAuthController],
        authStrategies: [JwtAuthStrategy]
    });
    baseUrl = await server.start();

    const email: string = 'route-metadata-evaluation@example.com';
    // a caller who is logged in through a strategy the route does not accept, which is the only
    // vantage point from which widening `allowedStrategies` is visible
    const user: JwtUser = await inject(repositoryTokenFor(JwtUser)).create({ email, roles: [Roles.USER] });
    const credentials: Repository<PasswordCredentials, PasswordCredentialsCreateData> = inject(repositoryTokenFor(PasswordCredentials));
    await credentials.create({ password, userId: user.id });

    const res: globalThis.Response = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JsonUtilities.stringify({ email, password })
    });
    const data: { accessToken: { value: string } } = await res.json() as { accessToken: { value: string } };
    accessToken = data.accessToken.value;
}, 60000);

afterAll(async () => {
    // guarded so a failed beforeAll reports the real cause instead of a shutdown TypeError
    await server?.shutdown();
}, TestTimeouts.postgres.shutdown);

describe('evaluation/02-http-runtime-core M3 - what a route declared is read once', () => {

    it('refuses a caller logged in through a strategy the route does not accept', async () => {
        // the control every expectation below reads against
        const res: globalThis.Response = await fetch(`${baseUrl}/evaluation-route-metadata/keys-only`, {
            headers: { authorization: `Bearer ${accessToken}` }
        });

        expect(res.status).toBe(403);
    });

    it('does not hand out the route\'s own declaration by reference', async () => {
        const handedOut: HasPermissionMetadata | undefined = MetadataUtilities.getRouteHasPlatformPermission(RouteMetadataController, 'keysOnly');
        expect(handedOut?.allowedStrategies).toEqual([ApiKeyAuthStrategy]);

        handedOut?.allowedStrategies?.push(JwtAuthStrategy);

        // the copy was a shallow spread: the array inside it was the route's own, so writing to what
        // a lookup handed back rewrote what the route accepts
        expect(MetadataUtilities.getRouteHasPlatformPermission(RouteMetadataController, 'keysOnly')?.allowedStrategies)
            .toEqual([ApiKeyAuthStrategy]);

        const res: globalThis.Response = await fetch(`${baseUrl}/evaluation-route-metadata/keys-only`, {
            headers: { authorization: `Bearer ${accessToken}` }
        });
        expect(res.status).toBe(403);
    });

    it('does not read the declaration again while serving a request', async () => {
        const before: globalThis.Response = await fetch(`${baseUrl}/evaluation-route-metadata/plain`);
        expect(before.status).toBe(200);

        // a login requirement that did not exist when the route was registered. Nothing legitimate
        // writes metadata after boot - decorators run at module load - so this is the question "is
        // the declaration still being read" asked in the only way a caller can ask it.
        MetadataUtilities.setRouteIsLoggedIn(RouteMetadataController, { allowedStrategies: undefined }, 'plain');

        const after: globalThis.Response = await fetch(`${baseUrl}/evaluation-route-metadata/plain`);
        expect(after.status).toBe(200);
    });

    // last in the file on purpose: it replaces the running application with one that refuses to
    // start, and nothing after it would be looking at the server the tests above started
    it('refuses an impossible declaration while registering the route, not while serving it', async () => {
        expect(server).toBeDefined();

        // booting is when a deployment can still be stopped. Reaching this on the first request that
        // happens to hit the route means the process serves 500s for something that was decided
        // before it ever listened.
        await expect(server?.reInit({ controllers: [ImpossibleController] })).rejects.toThrow(InvalidDecoratorCombinationError);
    }, 60000);
});