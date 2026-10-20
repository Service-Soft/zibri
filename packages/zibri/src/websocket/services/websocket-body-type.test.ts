import { describe, expect, it } from 'vitest';

import { startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { Property } from '../../entity/decorators/property.decorator.ts';
import { MimeType } from '../../http/mime-type.enum.ts';
import { Body } from '../../routing/decorators/body.decorator.ts';
import { WebsocketController } from '../decorators/websocket-controller.decorator.ts';
import { WebsocketRoute } from '../decorators/websocket-route.decorator.ts';

class Upload {
    @Property.string()
    caption!: string;
}

@WebsocketController({ eventPrefix: 'body-type:' })
class FormDataWebsocketController {
    // the http decorator, which stores its metadata where the websocket one does
    @WebsocketRoute('upload')
    upload(@Body(Upload, { type: MimeType.FORM_DATA }) upload: Upload): Upload {
        return upload;
    }
}

describe('WebsocketService — body type', () => {
    it('rejects startup when a websocket route declares a body other than json', async () => {
        await expect(startTestServer({ websocketControllers: [FormDataWebsocketController] }))
            .rejects.toThrow(/not supported for websockets/i);
    }, 30000);
});