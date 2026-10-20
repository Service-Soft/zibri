import { describe, expect, it } from 'vitest';

import { startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { WebsocketController } from '../decorators/websocket-controller.decorator.ts';
import { WebsocketRoute } from '../decorators/websocket-route.decorator.ts';

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
    }, 20000);
});