import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import { io, Socket } from 'socket.io-client';
import { createInMemoryDataSource } from 'zibri-testing';

import { type WebsocketServiceInterface } from './websocket-service.interface';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { defineProvider, DiProvider } from '../../di/models/di-provider.model';
import { Ms } from '../../utilities/ms';
import { WebsocketController } from '../decorators/websocket-controller.decorator';
import { WebsocketRoute } from '../decorators/websocket-route.decorator';
import { SocketIOWebsocketConnection } from '../models/connection/socket-io-websocket-connection.model';
import { WebsocketAnswer } from '../models/websocket-answer.model';
import { WebsocketOptionsInput } from '../models/websocket-options.model';

@WebsocketController({ allowOrphan: true, eventPrefix: 'answers:' })
class AnswersWsController {
    @WebsocketRoute('noop')
    noop(): void {
        return;
    }
}

const dataSourceClass: ReturnType<typeof createInMemoryDataSource> = createInMemoryDataSource({
    entities: defaultTestServerEntities
});

const websocketOptions: WebsocketOptionsInput = {
    messageRetentionInMs: Ms.DAY,
    // short, because one case waits for a client that never answers
    timeoutInMs: 300,
    handlerInMs: 5000,
    isAllowedToConnect: () => true
};

const providers: DiProvider<unknown>[] = [
    ...defaultTestServerProviders,
    defineProvider({ token: ZIBRI_DI_TOKENS.WEBSOCKET_OPTIONS_INPUT, useValue: websocketOptions })
];

let server: StartedTestServer | undefined;
let baseUrl: string = '';
let websocketService: WebsocketServiceInterface<SocketIOWebsocketConnection>;
const clients: Socket[] = [];

/**
 * Opens a socket, which answers the event with what it is given, or stays silent without it.
 * @param answer - What the socket answers with.
 * @returns The connected socket.
 */
async function connectClient(answer?: unknown): Promise<Socket> {
    const socket: Socket = io(baseUrl, { auth: { offset: 0 }, autoConnect: false });
    clients.push(socket);
    socket.on('answers:asked', (_message: unknown, ack: (res: unknown) => void) => {
        if (answer !== undefined) {
            ack(answer);
        }
    });
    await new Promise<void>((resolve, reject) => {
        socket.once('connect', () => resolve());
        socket.once('connect_error', reject);
        socket.connect();
    });
    return socket;
}

/**
 * Asks every connection to answer, and waits for what they say.
 * @returns What they answered.
 */
async function askEveryone(): Promise<WebsocketAnswer[]> {
    return await websocketService.sendToAll({
        event: 'answers:asked',
        message: { ok: true, data: {}, senderUserId: undefined, senderConnectionId: undefined },
        expectResponse: true,
        persist: false
    });
}

beforeAll(async () => {
    server = await startTestServer({
        websocketControllers: [AnswersWsController],
        dataSources: [dataSourceClass],
        providers
    });
    baseUrl = await server.start();
    // eslint-disable-next-line typescript/no-unsafe-assignment
    websocketService = inject(ZIBRI_DI_TOKENS.WEBSOCKET_SERVICE);
}, 30000);

afterEach(async () => {
    for (const client of clients.splice(0)) {
        client.disconnect();
    }
    // until the server has let go of the closed connections, which the next case would ask too
    await new Promise(resolve => setTimeout(resolve, 50));
});

afterAll(async () => {
    await server?.shutdown();
}, 30000);

describe('what a send waiting for answers returns', () => {
    it('names the connection and the user of each answer', async () => {
        const first: Socket = await connectClient({ from: 'first' });
        const second: Socket = await connectClient({ from: 'second' });

        const answers: WebsocketAnswer[] = await askEveryone();

        expect(answers).toHaveLength(2);
        expect(answers).toEqual(expect.arrayContaining([
            { request: { from: 'first' }, connectionId: first.id, userId: undefined },
            { request: { from: 'second' }, connectionId: second.id, userId: undefined }
        ]));
    });

    it('lists a connection that does not answer in time, with the error as json', async () => {
        await connectClient({ from: 'answering' });
        const silent: Socket = await connectClient();

        const answers: WebsocketAnswer[] = await askEveryone();

        const failure: WebsocketAnswer | undefined = answers.find(a => a.connectionId === silent.id);
        expect(failure?.request.body).toEqual({
            error: expect.objectContaining({ name: 'Error', paragraphs: expect.arrayContaining(['operation has timed out']) })
        });
        // the form it travels between instances in: an Error would be written as {}
        expect(JSON.parse(JSON.stringify(failure))).toEqual(failure);
    });
});