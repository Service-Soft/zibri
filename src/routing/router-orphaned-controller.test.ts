import { describe, expect, it } from '@jest/globals';

import { Controller } from './decorators/controller.decorator';
import { Get } from './decorators/get.decorator';
import { startTestServer } from '../__testing__/test-server/start-test-server.function';

@Controller('/orphan')
class OrphanController {
    @Get()
    get(): { ok: boolean } {
        return { ok: true };
    }
}

describe('Router — orphaned controller detection', () => {
    it('rejects startup when a decorated controller is not passed to the application options', async () => {
        await expect(startTestServer({ controllers: [] })).rejects.toThrow(/orphaned controllers/i);
        void OrphanController;
    }, 15000);
});