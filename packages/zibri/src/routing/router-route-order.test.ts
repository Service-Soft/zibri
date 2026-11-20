import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { Controller } from './decorators/controller.decorator';
import { Get } from './decorators/get.decorator';
import { Param } from './decorators/param.decorator';

@Controller('/reports')
class ReportController {
    // declared first, so that the order of declaration would hand it the requests of the routes below
    @Get('/:id')
    findById(@Param.path('id') id: string): { route: string } {
        return { route: `id ${id}` };
    }

    @Get('/:id/latest')
    latestOf(@Param.path('id') id: string): { route: string } {
        return { route: `latest of ${id}` };
    }

    @Get('/summary')
    summary(): { route: string } {
        return { route: 'summary' };
    }

    @Get('/summary/:id')
    summaryOf(@Param.path('id') id: string): { route: string } {
        return { route: `summary of ${id}` };
    }
}

describe('Router — the order routes are matched in', () => {
    let server: StartedTestServer | undefined;
    let baseUrl: string;

    beforeAll(async () => {
        server = await startTestServer({
            controllers: [ReportController],
            dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories })]
        });
        baseUrl = await server.start();
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    it.each([
        ['/reports/summary', 'summary'],
        ['/reports/summary/7', 'summary of 7'],
        ['/reports/7', 'id 7'],
        ['/reports/7/latest', 'latest of 7'],
        // the first segment where two routes differ decides
        ['/reports/summary/latest', 'summary of latest']
    ])('matches a fixed segment before a path parameter in the same place: %s', async (path, route) => {
        expect(await (await fetch(`${baseUrl}${path}`)).json()).toEqual({ route });
    });
});