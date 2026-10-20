import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { io, Socket } from 'socket.io-client';
import { createInMemoryDataSource } from 'zibri-testing';

import { type WebsocketServiceInterface } from './websocket-service.interface.ts';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function.ts';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { waitUntil } from '../../__testing__/wait-until.function.ts';
import { Auth } from '../../auth/decorators/auth.decorator.ts';
import { Repository } from '../../data-source/repository/repository.ts';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../di/inject.function.ts';
import { defineProvider } from '../../di/models/di-provider.model.ts';
import { LogLevel } from '../../logging/log-level.enum.ts';
import { Log } from '../../logging/log.model.ts';
import { LoggerInterface } from '../../logging/logger.interface.ts';
import { Ms } from '../../utilities/ms.ts';
import { WebsocketController } from '../decorators/websocket-controller.decorator.ts';
import { WebsocketRoute } from '../decorators/websocket-route.decorator.ts';
import { SocketIOWebsocketConnection } from '../models/connection/socket-io-websocket-connection.model.ts';
import { WebsocketMessage } from '../models/websocket-message.model.ts';

const thrownMessage: string = 'websocket-distinctive-failure';

@WebsocketController({ allowOrphan: true, eventPrefix: 'failed-message:' })
class FailedMessageWsController {
    @Auth.skip()
    @WebsocketRoute('public')
    public(): string {
        return 'public';
    }

    @WebsocketRoute('private')
    private(): string {
        return 'private';
    }

    @Auth.skip()
    @WebsocketRoute('boom')
    boom(): string {
        throw new Error(thrownMessage);
    }
}

let server: StartedTestServer;
let baseUrl: string;
let wsService: WebsocketServiceInterface<SocketIOWebsocketConnection>;
const sockets: Socket[] = [];

/**
 * Opens a socket nobody is logged in on, once the server has registered it.
 * @returns The connected socket.
 */
async function connect(): Promise<Socket> {
    const socket: Socket = io(baseUrl, { auth: { offset: 0 }, autoConnect: false });
    sockets.push(socket);
    // every message the server sends expects an answer, so the client gives one
    socket.onAny((_event: string, _message: unknown, ack?: () => void) => {
        if (typeof ack === 'function') {
            ack();
        }
    });
    await new Promise<void>((resolve, reject) => {
        socket.once('connect', () => resolve());
        socket.once('connect_error', reject);
        socket.connect();
    });
    await waitUntil(async () => (await wsService.getConnections()).some(c => c.id === socket.id));
    return socket;
}

/**
 * Reads the errors that were logged, once the queue in front of the store has drained.
 * @returns Every log row on the error level.
 */
async function findLoggedErrors(): Promise<Log[]> {
    await inject<LoggerInterface>(ZIBRI_DI_TOKENS.LOGGER).flush();
    return await inject<Repository<Log>>(repositoryTokenFor(Log)).findAll({ where: { level: LogLevel.ERROR } });
}

describe('a websocket message', () => {
    beforeAll(async () => {
        server = await startTestServer({
            websocketControllers: [FailedMessageWsController],
            dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities })],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({
                    token: ZIBRI_DI_TOKENS.WEBSOCKET_OPTIONS_INPUT,
                    useValue: { messageRetentionInMs: Ms.DAY, timeoutInMs: 5000, handlerInMs: 5000, isAllowedToConnect: () => true }
                })
            ],
            defaultAuth: 'requireLogin'
        });
        baseUrl = await server.start();
        // eslint-disable-next-line typescript/no-unsafe-assignment
        wsService = inject(ZIBRI_DI_TOKENS.WEBSOCKET_SERVICE);
    }, 30000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    afterEach(() => {
        for (const socket of sockets.splice(0)) {
            socket.disconnect();
        }
    });

    // the control: the same socket is answered where no login is needed
    it('is answered on a route that needs no login', async () => {
        const socket: Socket = await connect();

        const answer: WebsocketMessage = await socket.timeout(3000).emitWithAck('failed-message:public', { headers: {} }) as WebsocketMessage;

        expect(answer.status).toBe(200);
    });

    it('is told it is not logged in before its socket is closed', async () => {
        const socket: Socket = await connect();
        const closed: Promise<string> = new Promise(resolve => socket.once('disconnect', resolve));

        const answer: WebsocketMessage = await socket.timeout(3000).emitWithAck('failed-message:private', { headers: {} }) as WebsocketMessage;

        // without the answer the client only sees its socket go away, and cannot tell a refused login
        // from a server that went down
        expect(answer.status).toBe(401);
        expect(await closed).toBe('io server disconnect');
    });

    it('that fails logs the error its route threw, with its message and its stack', async () => {
        const socket: Socket = await connect();

        const answer: WebsocketMessage = await socket.timeout(3000).emitWithAck('failed-message:boom', { headers: {} }) as WebsocketMessage;
        expect(answer.status).toBe(500);

        // the message and the stack are what an aggregator groups and fingerprints on, so a wrapper
        // named the same for every failure, with its stack blanked, makes them all one error
        const logged: Log | undefined = (await findLoggedErrors()).find(l => l.message.includes(thrownMessage));
        expect(logged?.context.error?.stackTrace?.length).toBeGreaterThan(0);
    });
});