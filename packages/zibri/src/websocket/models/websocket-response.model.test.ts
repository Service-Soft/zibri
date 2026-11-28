import { describe, expect, it } from '@jest/globals';

import { HttpStatus } from '../../http/http-status.enum';
import { SentWebsocketMessage } from './sent-websocket-message.model';
import { WebsocketMessage, WebsocketRecipientType } from './websocket-message.model';
import { WebsocketResponseHandler } from './websocket-response.model';

describe('a WebsocketResponseHandler', () => {
    it('is a handler of 3.2 as well, declared to take a WebsocketMessage', async () => {
        const handled: SentWebsocketMessage[] = [];
        // as an application of 3.2 wrote it. The typecheck checks that it still is one
        const handlerOf32: (res: WebsocketMessage) => void = res => {
            handled.push(res);
        };
        const handler: WebsocketResponseHandler = handlerOf32;
        // a message sent with persist: false, which carries no seq
        const sent: SentWebsocketMessage = {
            id: 'b6f1c2d4-8e3a-4f5b-9c7d-1a2b3c4d5e6f',
            createdAt: new Date(0),
            ok: true,
            event: 'answer',
            status: HttpStatus.OK,
            senderUserId: undefined,
            senderConnectionId: undefined,
            data: { answer: 42 },
            error: undefined,
            recipientType: WebsocketRecipientType.USER,
            recipientId: undefined
        };

        await handler(sent);

        expect(handled).toEqual([sent]);
    });
});
