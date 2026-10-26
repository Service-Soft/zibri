import { describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { Controller } from './decorators/controller.decorator';
import { Get } from './decorators/get.decorator';
import { TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { startTestServer } from '../__testing__/test-server/start-test-server.function';
import { DataSourceInterface } from '../data-source/data-sources/data-source.interface';
import { Newable } from '../types/newable.type';

@Controller('/orphan')
class OrphanController {
    @Get()
    get(): { ok: boolean } {
        return { ok: true };
    }
}

// in memory, because the refusal is about the controller: on a container most of the time went to
// starting a database the test never reaches, and under a full run that alone outlasted the timeout
const dataSourceClass: Newable<DataSourceInterface> = createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories });

describe('Router — orphaned controller detection', () => {
    it('rejects startup when a decorated controller is not passed to the application options, and names it', async () => {
        await expect(startTestServer({ controllers: [], dataSources: [dataSourceClass] }))
            .rejects.toThrow(/orphaned controllers:\s+- OrphanController\b/);
        void OrphanController;
    }, TestTimeouts.inMemory.start);
});