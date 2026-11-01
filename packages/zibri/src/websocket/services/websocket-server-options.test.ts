import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import { io, Socket } from 'socket.io-client';
import { createInMemoryDataSource } from 'zibri-testing';

import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { defineProvider } from '../../di/models/di-provider.model';
import { fileSizeToBytes } from '../../entity/models/file-property-metadata.model';
import { Ms } from '../../utilities/ms';
import { WebsocketController } from '../decorators/websocket-controller.decorator';
import { WebsocketRoute } from '../decorators/websocket-route.decorator';
import { WebsocketMessage } from '../models/websocket-message.model';
import { WebsocketOptionsInput } from '../models/websocket-options.model';

/**
 * What a client learns about the server when it connects.
 */
type Handshake = {
    pingInterval: number,
    pingTimeout: number,
    maxPayload: number
};

/**
 * The event the test sends, and what it is answered with.
 */
type SentEvents = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    'options:ping': (request: { body: string }, answer: (message: WebsocketMessage) => void) => void
};

@WebsocketController({ allowOrphan: true, eventPrefix: 'options:' })
class OptionsWsController {
    @WebsocketRoute('ping')
    ping(): string {
        return 'pong';
    }
}

const websocketOptions: WebsocketOptionsInput = {
    messageRetentionInMs: Ms.DAY,
    path: '/live',
    maxMessageSize: '2mb',
    pingIntervalInMs: 10_000,
    pingTimeoutInMs: 4000
};

let server: StartedTestServer | undefined;
let baseUrl: string = '';
const clients: Socket<Record<string, never>, SentEvents>[] = [];

beforeAll(async () => {
    server = await startTestServer({
        websocketControllers: [OptionsWsController],
        dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories })],
        providers: [
            ...defaultTestServerProviders,
            defineProvider({ token: ZIBRI_DI_TOKENS.WEBSOCKET_OPTIONS_INPUT, useValue: websocketOptions })
        ]
    });
    baseUrl = await server.start();
}, TestTimeouts.inMemory.start);

afterEach(() => {
    for (const client of clients.splice(0)) {
        client.disconnect();
    }
});

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.inMemory.shutdown);

describe('the websocket server options', () => {
    it('serve clients at the path, with the message size and ping settings', async () => {
        const socket: Socket<Record<string, never>, SentEvents> = io(baseUrl, { path: '/live', auth: { offset: 0 }, transports: ['websocket'] });
        clients.push(socket);
        const handshake: Promise<Handshake> = new Promise<Handshake>(resolve => socket.io.engine.once('handshake', resolve));
        await new Promise<void>((resolve, reject) => {
            socket.once('connect', resolve);
            socket.once('connect_error', reject);
        });

        expect(await handshake).toMatchObject({
            pingInterval: 10_000,
            pingTimeout: 4000,
            maxPayload: fileSizeToBytes('2mb').toNumber()
        });
        // over socket.io's own megabyte, and still answered
        const answer: WebsocketMessage = await socket.timeout(5000).emitWithAck(
            'options:ping',
            { body: 'x'.repeat(fileSizeToBytes('1mb').toNumber() + 1024) }
        );
        expect(answer).toMatchObject({ ok: true, data: 'pong' });
    }, 15_000);
});
