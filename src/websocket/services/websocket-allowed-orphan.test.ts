import { afterAll, beforeAll, describe, it } from '@jest/globals';

import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { WebsocketController } from '../decorators/websocket-controller.decorator';
import { WebsocketRoute } from '../decorators/websocket-route.decorator';

@WebsocketController({ allowOrphan: true, eventPrefix: 'allowed-orphan:' })
class AllowedOrphanWebsocketController {
    @WebsocketRoute('ping')
    ping(): { ok: boolean } {
        return { ok: true };
    }
}

describe('WebsocketService — allowOrphan bypasses the orphan check', () => {
    let server: StartedTestServer;

    beforeAll(async () => {
        server = await startTestServer({ websocketControllers: [] });
    }, 15000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    it('starts successfully despite the controller not being passed in', () => {
        void AllowedOrphanWebsocketController;
    });
});