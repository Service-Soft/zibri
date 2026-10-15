import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import { io, Socket } from 'socket.io-client';

import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { defineProvider } from '../../di/models/di-provider.model';
import { UnauthorizedError } from '../../error-handling/errors/unauthorized.error';
import { $ts } from '../../localization/translate.function';
import { Ms } from '../../utilities/ms';
import { WebsocketController } from '../decorators/websocket-controller.decorator';
import { WebsocketRoute } from '../decorators/websocket-route.decorator';

/**
 * Only here to get the websocket server started.
 *
 * WebsocketService is registered 'onUse', so with no controller at all nothing ever injects it, its
 * onAppInit never runs and there is no socket.io server to hand a handshake to. None of these tests
 * send an event.
 */
@WebsocketController({ allowOrphan: true, eventPrefix: 'ws:' })
class HandshakeWsController {
    @WebsocketRoute('noop')
    noop(): { handler: string } {
        return { handler: 'noop' };
    }
}

type ConnectCheckMode = 'allow' | 'throws-internal' | 'throws-unauthorized';

type ConnectAttempt = { outcome: 'connected' } | { outcome: 'rejected', message: string };

const internalFailureMessage: string = 'the user directory this check needs is unreachable';

/**
 * How the user supplied isAllowedToConnect behaves on the next handshake.
 *
 * It is a real callback that really throws rather than a mock, because throwing is the whole point:
 * this is framework user code and the framework cannot assume it is well behaved.
 */
let connectCheckMode: ConnectCheckMode = 'allow';

let server: StartedTestServer;
let baseUrl: string;
const clients: Socket[] = [];

/**
 * Opens a connection and reports how it ended, refusing to wait forever.
 *
 * The timeout is the actual assertion of the finding. Socket.io does not catch a rejection thrown by
 * an async middleware, so before the fix next() was simply never called and the client sat there
 * until its own connect timeout - twenty seconds - with no error to react to. Three seconds is long
 * enough for a real handshake and far short of that, so a hang shows up as a failure here rather
 * than as a slow test.
 * @param url - The server to connect to.
 * @returns Whether the handshake succeeded, and the error message if it did not.
 */
// eslint-disable-next-line typescript/promise-function-async
function attemptConnect(url: string): Promise<ConnectAttempt> {
    return new Promise((resolve, reject) => {
        const socket: Socket = io(url, { auth: { offset: 0 } });
        clients.push(socket);

        const timeout: NodeJS.Timeout = setTimeout(
            () => reject(new Error('the handshake neither succeeded nor failed within 3s - it hung')),
            3000
        );

        socket.once('connect', () => {
            clearTimeout(timeout);
            resolve({ outcome: 'connected' });
        });
        socket.once('connect_error', (error: Error) => {
            clearTimeout(timeout);
            resolve({ outcome: 'rejected', message: error.message });
        });
    });
}

describe('WebsocketService handshake', () => {
    beforeAll(async () => {
        server = await startTestServer({
            websocketControllers: [HandshakeWsController],
            // spread rather than replaced: what is passed is what is used, so the defaults have to stay
            providers: [
                ...defaultTestServerProviders,
                defineProvider({
                    token: ZIBRI_DI_TOKENS.WEBSOCKET_OPTIONS_INPUT,
                    useFactory: () => ({
                        messageRetentionInMs: Ms.DAY,
                        timeoutInMs: Ms.SECOND * 5,
                        handlerInMs: Ms.SECOND * 30,
                        isAllowedToConnect: () => {
                            switch (connectCheckMode) {
                                case 'allow': {
                                    return true;
                                }
                                case 'throws-internal': {
                                    throw new Error(internalFailureMessage);
                                }
                                case 'throws-unauthorized': {
                                    throw new UnauthorizedError($ts`this account may not open a socket`);
                                }
                            }
                        }
                    })
                })
            ]
        });
        baseUrl = await server.start();
    }, 15000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    afterEach(async () => {
        connectCheckMode = 'allow';
        for (const client of clients.splice(0)) {
            client.disconnect();
        }
        await new Promise(resolve => setTimeout(resolve, 50));
    });

    // the control: without this a rejection below could just as well mean the fixture never connects
    it('lets a connection through when the check allows it', async () => {
        expect(await attemptConnect(baseUrl)).toEqual({ outcome: 'connected' });
    });

    it('fails the handshake instead of hanging when the check throws', async () => {
        connectCheckMode = 'throws-internal';
        const attempt: ConnectAttempt = await attemptConnect(baseUrl);
        expect(attempt.outcome).toBe('rejected');
    });

    it('does not put the reason for an internal failure on the wire', async () => {
        connectCheckMode = 'throws-internal';
        const attempt: ConnectAttempt = await attemptConnect(baseUrl);
        // the client is told the connection could not be established, not what broke inside the server
        expect(attempt).toEqual({ outcome: 'rejected', message: 'Could not establish the websocket connection' });
    });

    it('passes a thrown auth error through with its own message', async () => {
        connectCheckMode = 'throws-unauthorized';
        const attempt: ConnectAttempt = await attemptConnect(baseUrl);
        // an http error is a decision about this client, so it is the one thing worth telling them
        expect(attempt).toEqual({ outcome: 'rejected', message: 'this account may not open a socket' });
    });

    it('keeps serving other clients after a check has thrown', async () => {
        connectCheckMode = 'throws-internal';
        expect((await attemptConnect(baseUrl)).outcome).toBe('rejected');

        connectCheckMode = 'allow';
        expect(await attemptConnect(baseUrl)).toEqual({ outcome: 'connected' });
    });
});