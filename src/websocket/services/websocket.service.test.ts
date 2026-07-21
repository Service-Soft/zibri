import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { io, Socket } from 'socket.io-client';

import { type WebsocketServiceInterface } from './websocket-service.interface';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { Repository } from '../../data-source/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { type LoggerInterface } from '../../logging/logger.interface';
import { WebsocketController } from '../decorators/websocket-controller.decorator';
import { WebsocketRoute } from '../decorators/websocket-route.decorator';
import { SocketIOWebsocketConnection } from '../models/connection/socket-io-websocket-connection.model';
import { WebsocketChannel } from '../models/websocket-channel.model';
import { WebsocketEvent } from '../models/websocket-event.enum';
import { WebsocketMessage } from '../models/websocket-message.model';

@WebsocketController({ allowOrphan: true, eventPrefix: 'ws:' })
class TestWsController {
    @WebsocketRoute('echo')
    echo(): { handler: string } {
        return { handler: 'echo' };
    }
}

let server: StartedTestServer;
let baseUrl: string;
let wsService: WebsocketServiceInterface<SocketIOWebsocketConnection>;
let channelRepo: Repository<WebsocketChannel>;
const clients: Socket[] = [];

// eslint-disable-next-line typescript/promise-function-async
function connectClient(url: string): Promise<Socket> {
    return new Promise((resolve, reject) => {
        const socket: Socket = io(url, { auth: { offset: 0 } });
        clients.push(socket);
        socket.once('connect', () => resolve(socket));
        socket.once('connect_error', reject);
    });
}

// eslint-disable-next-line typescript/promise-function-async
function waitForEvent<T>(socket: Socket, event: string): Promise<T> {
    return new Promise(resolve => {
        socket.once(event, (payload: T) => resolve(payload));
    });
}

async function sendWsEvent(url: string, event: string, payload: unknown = {}): Promise<WebsocketMessage> {
    return new Promise((resolve, reject) => {
        const socket: Socket = io(url, { auth: { offset: 0 } });
        clients.push(socket);

        const timeout: NodeJS.Timeout = setTimeout(() => {
            reject(new Error('Timed out waiting for websocket response'));
        }, 5000);

        socket.once(WebsocketEvent.RESPONSE, (msg: WebsocketMessage, ack?: () => void) => {
            clearTimeout(timeout);
            ack?.();
            resolve(msg);
        });

        socket.once('connect', () => {
            socket.emit(event, payload);
        });

        socket.once('connect_error', err => {
            clearTimeout(timeout);
            reject(err);
        });
    });
}

async function findConnection(id: string): Promise<SocketIOWebsocketConnection> {
    const connections: SocketIOWebsocketConnection[] = await wsService.getConnections();
    const found: SocketIOWebsocketConnection | undefined = connections.find(c => c.id === id);
    if (!found) {
        throw new Error(`test setup: no server-side connection found for socket id "${id}"`);
    }
    return found;
}

function successMessage(data: unknown): { ok: true, data: unknown, senderUserId: undefined, senderConnectionId: undefined } {
    return { ok: true, data, senderUserId: undefined, senderConnectionId: undefined };
}

describe('WebsocketService', () => {
    beforeAll(async () => {
        server = await startTestServer({ websocketControllers: [TestWsController] });
        baseUrl = await server.start();
        // eslint-disable-next-line typescript/no-unsafe-assignment
        wsService = inject(ZIBRI_DI_TOKENS.WEBSOCKET_SERVICE);
        channelRepo = inject(repositoryTokenFor(WebsocketChannel));
    }, 15000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    afterEach(async () => {
        for (const client of clients.splice(0)) {
            client.disconnect();
        }
        // give the server a moment to process the disconnects before the next test inspects connection state
        await new Promise(resolve => setTimeout(resolve, 50));
        jest.restoreAllMocks();
    });

    describe('message dispatch', () => {
        it('responds with a 404 for an unknown event', async () => {
            const msg: WebsocketMessage = await sendWsEvent(baseUrl, 'ws:does-not-exist');
            expect(msg.ok).toBe(false);
            expect(msg.status).toBe(404);
        });

        it('responds with a 400 when more than one argument is sent', async () => {
            const socket: Socket = await connectClient(baseUrl);
            const responsePromise: Promise<WebsocketMessage> = new Promise(resolve => {
                socket.once(WebsocketEvent.RESPONSE, (msg: WebsocketMessage, ack?: () => void) => {
                    ack?.();
                    resolve(msg);
                });
            });
            socket.emit('ws:echo', {}, {});
            const msg: WebsocketMessage = await responsePromise;
            expect(msg.ok).toBe(false);
            expect(msg.status).toBe(400);
        });

        it('dispatches a known event to its registered handler', async () => {
            const msg: WebsocketMessage = await sendWsEvent(baseUrl, 'ws:echo');
            expect(msg.ok).toBe(true);
            // eslint-disable-next-line typescript/no-explicit-any, typescript/no-unsafe-member-access
            expect((msg as any).data.handler).toBe('echo');
        });
    });

    describe('connection registry', () => {
        it('getConnections reflects currently connected clients', async () => {
            const before: number = (await wsService.getConnections()).length;
            const client: Socket = await connectClient(baseUrl);
            await new Promise(resolve => setTimeout(resolve, 50));
            expect((await wsService.getConnections()).length).toBe(before + 1);

            client.disconnect();
            await new Promise(resolve => setTimeout(resolve, 100));
            expect((await wsService.getConnections()).length).toBe(before);
        });

        it('findConnectionById returns the matching connection', async () => {
            const client: Socket = await connectClient(baseUrl);
            await new Promise(resolve => setTimeout(resolve, 50));
            const connection: SocketIOWebsocketConnection = await wsService.findConnectionById(client.id as string);
            expect(connection.id).toBe(client.id);
        });

        it('findConnectionById throws NotFoundError for an unknown id', () => {
            expect(() => wsService.findConnectionById('does-not-exist')).toThrow(/Could not find connection/);
        });

        it('findConnectionByUserId throws NotFoundError when no connection matches', () => {
            expect(() => wsService.findConnectionByUserId('does-not-exist')).toThrow(/Could not find connection/);
        });
    });

    describe('channels', () => {
        it('joinChannel adds the connection to the channel room and warns on a duplicate join', async () => {
            const channel: WebsocketChannel = await channelRepo.create({ name: `general-${Date.now()}`, userIds: [] });
            const client: Socket = await connectClient(baseUrl);
            await new Promise(resolve => setTimeout(resolve, 50));
            const connection: SocketIOWebsocketConnection = await findConnection(client.id as string);

            await wsService.joinChannel(connection, channel.id);

            const logger: LoggerInterface = inject(ZIBRI_DI_TOKENS.LOGGER);
            // eslint-disable-next-line typescript/typedef
            const warnSpy = jest.spyOn(logger, 'warn');

            await wsService.joinChannel(connection, channel.id);

            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('already joined'));
        });

        it('leaveChannel removes the connection so it no longer receives channel broadcasts', async () => {
            const channel: WebsocketChannel = await channelRepo.create({ name: `general-${Date.now()}`, userIds: [] });
            const client: Socket = await connectClient(baseUrl);
            await new Promise(resolve => setTimeout(resolve, 50));
            const connection: SocketIOWebsocketConnection = await findConnection(client.id as string);

            await wsService.joinChannel(connection, channel.id);
            await wsService.leaveChannel(connection, channel.id);

            const received: unknown[] = [];
            client.on('custom-event', (payload: unknown) => received.push(payload));

            await wsService.sendToChannel({
                channelId: channel.id,
                event: 'custom-event',
                message: successMessage({ hello: true }),
                expectResponse: false,
                persist: false
            });

            await new Promise(resolve => setTimeout(resolve, 100));
            expect(received).toHaveLength(0);
        });

        it('sendToChannel (fire-and-forget) broadcasts to every connection that joined the channel', async () => {
            const channel: WebsocketChannel = await channelRepo.create({ name: `general-${Date.now()}`, userIds: [] });
            const clientA: Socket = await connectClient(baseUrl);
            const clientB: Socket = await connectClient(baseUrl);
            await new Promise(resolve => setTimeout(resolve, 50));

            await wsService.joinChannel(await findConnection(clientA.id as string), channel.id);
            await wsService.joinChannel(await findConnection(clientB.id as string), channel.id);

            const receivedA: Promise<WebsocketMessage> = waitForEvent(clientA, 'custom-event');
            const receivedB: Promise<WebsocketMessage> = waitForEvent(clientB, 'custom-event');

            await wsService.sendToChannel({
                channelId: channel.id,
                event: 'custom-event',
                message: successMessage({ hello: true }),
                expectResponse: false,
                persist: false
            });

            await expect(receivedA).resolves.toMatchObject({ data: { hello: true } });
            await expect(receivedB).resolves.toMatchObject({ data: { hello: true } });
        });

        it('sendToChannel with expectResponse gathers an ack from every joined connection', async () => {
            const channel: WebsocketChannel = await channelRepo.create({ name: `general-${Date.now()}`, userIds: [] });
            const clientA: Socket = await connectClient(baseUrl);
            const clientB: Socket = await connectClient(baseUrl);
            await new Promise(resolve => setTimeout(resolve, 50));

            await wsService.joinChannel(await findConnection(clientA.id as string), channel.id);
            await wsService.joinChannel(await findConnection(clientB.id as string), channel.id);

            for (const client of [clientA, clientB]) {
                client.on('custom-event-ack', (_payload: unknown, ack: (res: unknown) => void) => {
                    ack({ received: true });
                });
            }

            const results: unknown[] = await wsService.sendToChannel({
                channelId: channel.id,
                event: 'custom-event-ack',
                message: successMessage({ hello: true }),
                expectResponse: true,
                persist: false
            });

            expect(results).toHaveLength(2);
        });
    });

    describe('sendToAll', () => {
        it('broadcasts (fire-and-forget) to every connected client', async () => {
            const clientA: Socket = await connectClient(baseUrl);
            const clientB: Socket = await connectClient(baseUrl);

            const receivedA: Promise<WebsocketMessage> = waitForEvent(clientA, 'global-event');
            const receivedB: Promise<WebsocketMessage> = waitForEvent(clientB, 'global-event');

            await wsService.sendToAll({
                event: 'global-event',
                message: successMessage({ hi: true }),
                expectResponse: false,
                persist: false
            });

            await expect(receivedA).resolves.toMatchObject({ data: { hi: true } });
            await expect(receivedB).resolves.toMatchObject({ data: { hi: true } });
        });
    });

    describe('disconnect', () => {
        it('force-disconnects the given connection', async () => {
            const client: Socket = await connectClient(baseUrl);
            await new Promise(resolve => setTimeout(resolve, 50));
            const connection: SocketIOWebsocketConnection = await findConnection(client.id as string);

            const disconnectPromise: Promise<string> = waitForEvent(client, 'disconnect');
            await wsService.disconnect(connection);

            await expect(disconnectPromise).resolves.toBeDefined();
        });
    });
});