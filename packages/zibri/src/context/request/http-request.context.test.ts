
import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';

import { type HttpRequestContext } from './http-request.context';
import { RequestContextToken } from './request-context-token.model';
import { type WebsocketRequestContext } from './websocket-request.context';
import { TestTimeouts } from '../../__testing__/constants';
import { createTestDataSource, defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { Repository } from '../../data-source/repository/repository';
import { InjectRepository } from '../../di/decorators/inject-repository.decorator';
import { Injectable } from '../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { KnownHeader } from '../../http/known-header.enum';
import { Controller } from '../../routing/decorators/controller.decorator';
import { Get } from '../../routing/decorators/get.decorator';

const CURRENT_USER: RequestContextToken<{ isAdmin: boolean }> = new RequestContextToken(
    'current-user',
    (ctx) => {
        const auth: string | undefined = ctx.request.headers?.[KnownHeader.AUTHORIZATION];
        return { isAdmin: auth === 'admin' };
    }
);

@Entity({ tenant: 'shared' })
class Test extends BaseEntity {
    @Property.string({
        exclude: async (_, ctx) => {
            if (!ctx) {
                return false;
            }
            const { isAdmin } = await ctx.get(CURRENT_USER);
            return !isAdmin;
        }
    })
    secret!: string;

    @Property.string({
        default: async (_, ctx) => {
            if (!ctx) {
                throw new Error('Could not find request context when resolving default value for Test.label');
            }
            const { isAdmin } = await ctx.get(CURRENT_USER);
            return isAdmin ? 'admin-default' : 'user-default';
        }
    })
    label!: string;
}

@Controller('/context-test')
class ContextTestController {
    constructor(
        @InjectRepository(Test)
        private readonly testRepository: Repository<Test>
    ) {}

    @Get('/')
    async get(): Promise<Test> {
        return await this.testRepository.create({ secret: 'top-secret' });
    }

    @Get('/matched-route')
    matchedRoute(): { controller: string | undefined, method: string | undefined } {
        const context: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
        return { controller: context?.controllerClass?.name, method: context?.controllerMethod };
    }

    @Get('/request-scope')
    requestScope(): { first: number, second: number } {
        // asked for twice on purpose: one request is meant to see one instance, however many times
        // it asks, while the next request sees its own
        return { first: inject(PerRequestService).id, second: inject(PerRequestService).id };
    }
}

let instancesBuilt: number = 0;

/**
 * A service that lives for one request, which is what the request scope exists to allow.
 *
 * Counting constructions is what makes the scope observable from outside: a value built again per
 * request is a different id, and one kept for the process is the same id forever.
 */
@Injectable({ scope: 'request' })
class PerRequestService {
    readonly id: number = ++instancesBuilt;
}

let server: StartedTestServer;
let baseUrl: string;
describe('request context integration', () => {
    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [createTestDataSource({ entities: [...defaultTestServerEntities, Test], repositories: defaultTestServerRepositories })],
            controllers: [ContextTestController]
        });
        baseUrl = await server.start();
    }, TestTimeouts.postgres.start);

    afterAll(async () => {
        await server.shutdown();
    }, TestTimeouts.postgres.shutdown);

    test('context is available during exclude/default evaluation and is cached', async () => {
        const res: Response = await fetch(`${baseUrl}/context-test`, { headers: { Authorization: 'admin' } });
        expect(res.status).toBe(200);

        const body: Test = await res.json() as Test;
        expect(body.secret).toBe('top-secret');
        expect(body.label).toBe('admin-default');
    });

    test('exclude sees the request context for non-admin users', async () => {
        const res: Response = await fetch(`${baseUrl}/context-test`, { headers: { Authorization: 'user' } });

        const body: Test = await res.json() as Test;
        expect(body.secret).toBeUndefined();
        expect(body.label).toBe('user-default');
    });

    // read from inside the handler they name: left unset, every consumer of the matched route took
    // its "routing has not resolved yet" branch forever
    test('names the route that is handling the request', async () => {
        const res: Response = await fetch(`${baseUrl}/context-test/matched-route`);

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ controller: 'ContextTestController', method: 'matchedRoute' });
    });

    // as a singleton both requests would read one id, and as a transient the two asks inside one
    // request would read two
    test('builds a request scoped service once per request, over http', async () => {
        const first: { first: number, second: number } = await (await fetch(`${baseUrl}/context-test/request-scope`)).json() as { first: number, second: number };
        const second: { first: number, second: number } = await (await fetch(`${baseUrl}/context-test/request-scope`)).json() as { first: number, second: number };

        expect(first.first).toBe(first.second);
        expect(second.first).toBe(second.second);
        expect(first.first).not.toBe(second.first);
    });
});