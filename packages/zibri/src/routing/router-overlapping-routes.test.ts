import { describe, expect, it } from '@jest/globals';

import { Controller } from './decorators/controller.decorator';
import { Get } from './decorators/get.decorator';
import { startTestServer } from '../__testing__/test-server/start-test-server.function';

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
            startTestServer({ controllers: [DupControllerA, DupControllerB] })
        ).rejects.toThrow(/has been defined on more than one controller/);
    }, 15000);
});