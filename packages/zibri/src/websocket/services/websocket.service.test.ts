import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { io, Socket } from 'socket.io-client';
import { createInMemoryDataSource } from 'zibri-testing';

import { type WebsocketServiceInterface } from './websocket-service.interface';
import { TestTimeouts } from '../../__testing__/constants';
import { missingEntityPattern } from '../../__testing__/missing-entity-pattern.function';
import { JwtTestAuthController } from '../../__testing__/mocks/controllers/jwt-test-auth.controller';
import { JwtUser } from '../../__testing__/mocks/entities/jwt-user.entity';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { startAndStopTestServerWithout } from '../../__testing__/test-server/start-and-stop-test-server-without.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { PasswordCredentials, PasswordCredentialsCreateData } from '../../auth/authenticators/password/password-credentials.model';
import { Auth } from '../../auth/decorators/auth.decorator';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { defineProvider } from '../../di/models/di-provider.model';
import { type LoggerInterface } from '../../logging/logger.interface';
import { Response } from '../../open-api/decorators/response.decorator';
import { Controller } from '../../routing/decorators/controller.decorator';
import { Post } from '../../routing/decorators/post.decorator';
import { JsonUtilities } from '../../utilities/json.utilities';
import { Ms } from '../../utilities/ms';
import { WebsocketController } from '../decorators/websocket-controller.decorator';
import { WebsocketRoute } from '../decorators/websocket-route.decorator';
import { SocketIOWebsocketConnection } from '../models/connection/socket-io-websocket-connection.model';
import { WebsocketChannel } from '../models/websocket-channel.model';
import { WebsocketEvent } from '../models/websocket-event.enum';
import { WebsocketMessage } from '../models/websocket-message.model';

type LoginResponseBody = { accessToken: { value: string } };

@WebsocketController({ allowOrphan: true, eventPrefix: 'ws:' })
class TestWsController {
    @WebsocketRoute('echo')
    echo(): { handler: string } {
        return { handler: 'echo' };
    }
}

const NOTIFICATION_EVENT: string = 'notification';

@Controller('/notifications', { allowOrphan: true })
class NotificationController {
    @Response.empty()
    @Auth.skip()
    @Post('/')
    async notify(): Promise<void> {
        await inject(ZIBRI_DI_TOKENS.WEBSOCKET_SERVICE).sendToAll({
            event: NOTIFICATION_EVENT,
            message: { ok: true, data: 'hello', senderUserId: undefined, senderConnectionId: undefined },
            expectResponse: false,
            persist: false
        });
    }
}

let server: StartedTestServer;
let baseUrl: string;
let wsService: WebsocketServiceInterface<SocketIOWebsocketConnection>;
let channelRepo: Repository<WebsocketChannel>;
const clients: Socket[] = [];

// eslint-disable-next-line typescript/promise-function-async
function connectClient(url: string, accessToken?: string): Promise<Socket> {
    return new Promise((resolve, reject) => {
        // the handshake headers are what the auth middleware reads, exactly as it would on http
        const socket: Socket = io(url, {
            auth: { offset: 0 },
            extraHeaders: accessToken == undefined ? {} : { authorization: `Bearer ${accessToken}` }
        });
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

// first, for the reason on startAndStopTestServerWithout
describe('WebsocketService — starting', () => {
    it('refuses to start a websocket server without its entities, and names both', async () => {
        const start: Promise<void> = startAndStopTestServerWithout(
            [WebsocketChannel, WebsocketMessage],
            { websocketControllers: [TestWsController] }
        );

        await expect(start).rejects.toThrow(missingEntityPattern('WebsocketChannel', 'WebsocketService'));
        await expect(start).rejects.toThrow(missingEntityPattern('WebsocketMessage', 'WebsocketService'));
    }, TestTimeouts.inMemory.start);

    it('starts without its entities when nothing declares websockets', async () => {
        await expect(startAndStopTestServerWithout([WebsocketChannel, WebsocketMessage])).resolves.toBeUndefined();
    }, TestTimeouts.inMemory.start);

    // an application that only pushes - clients listening, its http routes broadcasting - declares no
    // websocket controller and no adapter data source on a single instance, which left its clients
    // nothing to connect to
    it('starts a server when told to without a websocket controller, and its clients receive what an http route sends', async () => {
        const pushing: StartedTestServer = await startTestServer({
            controllers: [NotificationController],
            dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories, allowOrphan: true })],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({ token: ZIBRI_DI_TOKENS.WEBSOCKET_OPTIONS_INPUT, useValue: { messageRetentionInMs: Ms.DAY, startServer: 'always' } })
            ]
        });
        try {
            const url: string = await pushing.start();
            const client: Socket = await connectClient(url);
            const received: Promise<WebsocketMessage> = waitForEvent(client, NOTIFICATION_EVENT);

            expect((await fetch(`${url}/notifications`, { method: 'POST' })).status).toBe(204);

            expect((await received).data).toBe('hello');
        }
        finally {
            for (const client of clients.splice(0)) {
                client.disconnect();
            }
            await pushing.shutdown();
        }
    }, TestTimeouts.inMemory.start);
});

describe('WebsocketService', () => {
    beforeAll(async () => {
        server = await startTestServer({
            websocketControllers: [TestWsController],
            // for /auth/login, so a socket can be opened as a real user rather than anonymously
            controllers: [JwtTestAuthController]
        });
        baseUrl = await server.start();
        // eslint-disable-next-line typescript/no-unsafe-assignment
        wsService = inject(ZIBRI_DI_TOKENS.WEBSOCKET_SERVICE);
        channelRepo = inject(repositoryTokenFor(WebsocketChannel));
    }, TestTimeouts.postgres.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.postgres.shutdown);

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

        it('findConnectionsByUserId is empty when no connection matches', async () => {
            expect(await wsService.findConnectionsByUserId('does-not-exist')).toEqual([]);
        });

        it('findConnectionsByUserId returns every connection of the user, and only those still open', async () => {
            const email: string = `connections-${Date.now()}@example.com`;
            const password: string = 'secure123';
            const user: JwtUser = await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser))
                .create({ email, roles: [] });
            await inject<Repository<PasswordCredentials, PasswordCredentialsCreateData>>(repositoryTokenFor(PasswordCredentials))
                .create({ password, userId: user.id });
            const loginRes: Response = await fetch(`${baseUrl}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JsonUtilities.stringify({ email, password })
            });
            expect(loginRes.status).toBe(200);
            const token: string = (await loginRes.json() as LoginResponseBody).accessToken.value;

            // two tabs of the same user, and an anonymous connection that belongs to nobody
            const first: Socket = await connectClient(baseUrl, token);
            const second: Socket = await connectClient(baseUrl, token);
            await connectClient(baseUrl);
            await new Promise(resolve => setTimeout(resolve, 50));

            const both: SocketIOWebsocketConnection[] = await wsService.findConnectionsByUserId(user.id);
            expect(both.map(c => c.id).sort()).toEqual([first.id, second.id].sort());

            first.close();
            await new Promise(resolve => setTimeout(resolve, 100));
            const remaining: SocketIOWebsocketConnection[] = await wsService.findConnectionsByUserId(user.id);
            expect(remaining.map(c => c.id)).toEqual([second.id]);
        }, 20000);
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

        it('puts a reconnecting user back into the channels they already belong to', async () => {
            const email: string = `restore-${Date.now()}@example.com`;
            const password: string = 'secure123';
            const user: JwtUser = await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser))
                .create({ email, roles: [] });
            await inject<Repository<PasswordCredentials, PasswordCredentialsCreateData>>(repositoryTokenFor(PasswordCredentials))
                .create({ password, userId: user.id });

            const loginRes: Response = await fetch(`${baseUrl}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JsonUtilities.stringify({ email, password })
            });
            expect(loginRes.status).toBe(200);
            const token: string = (await loginRes.json() as LoginResponseBody).accessToken.value;

            const channel: WebsocketChannel = await channelRepo.create({ name: `restore-${Date.now()}`, userIds: [] });

            // the first connection joins, which is what records the membership on the channel row
            const first: Socket = await connectClient(baseUrl, token);
            await new Promise(resolve => setTimeout(resolve, 50));
            await wsService.joinChannel(await findConnection(first.id as string), channel.id);
            first.close();

            // the second never asks to join. Membership is in the data source, but the room it is
            // delivered through only ever existed on the socket that has just gone away - which is
            // the same position a client is in after reconnecting to a different instance.
            const second: Socket = await connectClient(baseUrl, token);
            await new Promise(resolve => setTimeout(resolve, 50));
            const received: Promise<WebsocketMessage> = waitForEvent(second, 'restored-event');

            await wsService.sendToChannel({
                channelId: channel.id,
                event: 'restored-event',
                message: successMessage({ hello: true }),
                expectResponse: false,
                persist: false
            });

            await expect(received).resolves.toMatchObject({ data: { hello: true } });
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