import { describe, expect, it } from '@jest/globals';

import { startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { WebsocketController } from '../decorators/websocket-controller.decorator';
import { WebsocketRoute } from '../decorators/websocket-route.decorator';

@WebsocketController({ eventPrefix: 'orphan:' })
class OrphanWebsocketController {
    @WebsocketRoute('ping')
    ping(): { ok: boolean } {
        return { ok: true };
    }
}

describe('WebsocketService — orphaned controller detection', () => {
    it('rejects startup when a decorated websocket controller is not passed to the application options', async () => {
        await expect(startTestServer({ websocketControllers: [] })).rejects.toThrow(/orphaned controllers/i);
        void OrphanWebsocketController;
    }, 15000);
});