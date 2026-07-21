import { afterAll, beforeAll, describe, it } from '@jest/globals';

import { Controller } from './decorators/controller.decorator';
import { Get } from './decorators/get.decorator';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';

@Controller('/allowed-orphan', { allowOrphan: true })
class AllowedOrphanController {
    @Get()
    get(): { ok: boolean } {
        return { ok: true };
    }
}

describe('Router — allowOrphan bypasses the orphan check', () => {
    let server: StartedTestServer;

    beforeAll(async () => {
        server = await startTestServer({ controllers: [] });
    }, 15000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    it('starts successfully despite the controller not being passed in', () => {
        void AllowedOrphanController;
    });
});