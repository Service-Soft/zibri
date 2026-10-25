import { afterAll, beforeAll, describe, it } from '@jest/globals';

import { TestTimeouts } from '../../__testing__/constants';
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
    }, TestTimeouts.postgres.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.postgres.shutdown);

    it('starts successfully despite the controller not being passed in', () => {
        void AllowedOrphanWebsocketController;
    });
});