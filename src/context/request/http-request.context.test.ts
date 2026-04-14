
import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';

import { RequestContextToken } from './request-context-token.model';
import { createTestDataSource, defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { Repository } from '../../data-source/repository';
import { InjectRepository } from '../../di/decorators/inject-repository.decorator';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { KnownHeader } from '../../http/known-header.enum';
import { Controller } from '../../routing/decorators/controller.decorator';
import { Get } from '../../routing/decorators/get.decorator';

const CURRENT_USER: RequestContextToken<{ isAdmin: boolean }> = new RequestContextToken(
    'current-user',
    (ctx) => {
        const auth: string | undefined = ctx.request.headers[KnownHeader.AUTHORIZATION];
        return { isAdmin: auth === 'admin' };
    }
);

@Entity()
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
}

let server: StartedTestServer;
let baseUrl: string;
describe('request context integration', () => {
    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [createTestDataSource({ entities: [...defaultTestServerEntities, Test] })],
            controllers: [ContextTestController]
        });
        baseUrl = await server.start();
    }, 10000);

    afterAll(async () => {
        await server.shutdown();
    });

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
});