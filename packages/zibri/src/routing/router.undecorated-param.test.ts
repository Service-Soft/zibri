import { describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { Controller } from './decorators/controller.decorator';
import { Get } from './decorators/get.decorator';
import { Param } from './decorators/param.decorator';
import { TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';

@Controller('/undecorated')
class UndecoratedParamController {
    @Get('/:id')
    findById(@Param.path('id') id: string, verbose: boolean): string {
        return verbose ? `the item ${id}` : id;
    }
}

// the parameters were counted against the method on every request,
// so the application started and the route answered 500 to whoever called it first
describe('a route with a parameter no decorator declares', () => {
    it('keeps the application from starting, naming the route', async () => {
        let server: StartedTestServer | undefined;
        try {
            await expect((async () => {
                server = await startTestServer({
                    controllers: [UndecoratedParamController],
                    dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories })]
                });
            })()).rejects.toThrow('UndecoratedParamController.findById');
        }
        finally {
            await server?.shutdown();
        }
    }, TestTimeouts.inMemory.start);
});