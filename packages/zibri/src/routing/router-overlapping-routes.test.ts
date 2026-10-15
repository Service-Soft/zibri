import { describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { Controller } from './decorators/controller.decorator';
import { Get } from './decorators/get.decorator';
import { defaultTestServerEntities } from '../__testing__/test-server/create-test-data-source.function';
import { startTestServer } from '../__testing__/test-server/start-test-server.function';

// in process rather than the postgres container the test server defaults to: the check fails the boot
// before anything is stored, and starting and stopping a container around it was the whole of what
// this test took - past its timeout in a busy run
const dataSourceClass: ReturnType<typeof createInMemoryDataSource> = createInMemoryDataSource({
    entities: defaultTestServerEntities
});

@Controller('/dup')
class DupControllerA {
    @Get('/thing')
    get(): { from: string } {
        return { from: 'a' };
    }
}

@Controller('/dup')
class DupControllerB {
    @Get('/thing')
    get(): { from: string } {
        return { from: 'b' };
    }
}

describe('Router — overlapping route detection', () => {
    it('rejects startup when two controllers share the same base route for overlapping versions', async () => {
        await expect(
            startTestServer({ dataSources: [dataSourceClass], controllers: [DupControllerA, DupControllerB] })
        ).rejects.toThrow(/has been defined on more than one controller/);
    });
});