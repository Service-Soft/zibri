import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import { io, Socket } from 'socket.io-client';
import { createInMemoryDataSource } from 'zibri-testing';

import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { AlsUtilities } from '../../context/als.utilities';
import { HttpRequestContext } from '../../context/request/http-request.context';
import { WebsocketRequestContext } from '../../context/request/websocket-request.context';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { defineProvider, DiProvider } from '../../di/models/di-provider.model';
import { HttpStatus } from '../../http/http-status.enum';
import { Ms } from '../../utilities/ms';
import { WebsocketController } from '../decorators/websocket-controller.decorator';
import { WebsocketRoute } from '../decorators/websocket-route.decorator';
import { WebsocketEvent } from '../models/websocket-event.enum';
import { WebsocketMessage } from '../models/websocket-message.model';
import { WebsocketOptionsInput } from '../models/websocket-options.model';

/**
 * What a handler reports about the message it ran in, once it is over.
 */
type HandlerRecord = {
    /**
     * Whether the signal of the message had fired by the time the handler finished.
     */
    signalAborted: boolean
};

/**
 * What the handlers below record, keyed by the event that wrote it.
 *
 * A handler the framework has stopped waiting for still runs, so what it did cannot travel on the
 * response - there was none, or it went out without it.
 */
const records: Map<string, HandlerRecord> = new Map();

/**
 * Waits, without holding the event loop open past the suite.
 * @param ms - How long to wait.
 */
async function wait(ms: number): Promise<void> {
    await new Promise<void>(resolve => {
        setTimeout(resolve, ms).unref();
    });
}

/**
 * The signal of the message this is running in.
 * @returns The signal.
 * @throws When there is no request running, which is a broken test rather than a failing one.
 */
function currentSignal(): AbortSignal {
    const context: HttpRequestContext | WebsocketRequestContext | undefined = AlsUtilities.getCurrentRequestContext();
    if (!context) {
        throw new Error('no request context');
    }
    return context.signal;
}

// 60ms, so a route that deliberately overruns costs the suite a fraction of a second. Every handler
// is either far inside it or far outside it
@WebsocketController({ allowOrphan: true, eventPrefix: 'dl:', timeoutInMs: 60 })
class DeadlineWsController {
    @WebsocketRoute('inherits')
    async inherits(): Promise<{ ok: boolean }> {
        await wait(400);
        records.set('inherits', { signalAborted: currentSignal().aborted });
        return { ok: true };
    }

    @WebsocketRoute('fast')
    async fast(): Promise<{ ok: boolean }> {
        await wait(5);
        records.set('fast', { signalAborted: currentSignal().aborted });
        return { ok: true };
    }

    @WebsocketRoute('own', { timeoutInMs: 1000 })
    async own(): Promise<{ ok: boolean }> {
        // longer than the controller's 60ms and well inside its own second
        await wait(200);
        return { ok: true };
    }

    @WebsocketRoute('none', { timeoutInMs: 'none' })
    async none(): Promise<{ ok: boolean }> {
        await wait(200);
        return { ok: true };
    }

    @WebsocketRoute('hangs-up', { timeoutInMs: 'none' })
    async hangsUp(): Promise<{ ok: boolean }> {
        // unbounded on purpose: what ends this one is the client going away, not a deadline
        await wait(600);
        records.set('hangs-up', { signalAborted: currentSignal().aborted });
        return { ok: true };
    }
}

// no deadline of its own, so its routes fall back to whatever the application says
@WebsocketController({ allowOrphan: true, eventPrefix: 'app:' })
class AppDefaultWsController {
    @WebsocketRoute('slow')
    async slow(): Promise<{ ok: boolean }> {
        await wait(400);
        return { ok: true };
    }
}

const dataSourceClass: ReturnType<typeof createInMemoryDataSource> = createInMemoryDataSource({
    entities: defaultTestServerEntities
});

const websocketOptions: WebsocketOptionsInput = {
    messageRetentionInMs: Ms.DAY,
    timeoutInMs: 5000,
    handlerInMs: 120,
    isAllowedToConnect: () => true
};

const providers: DiProvider<unknown>[] = [
    ...defaultTestServerProviders,
    defineProvider({ token: ZIBRI_DI_TOKENS.WEBSOCKET_OPTIONS_INPUT, useValue: websocketOptions })
];

let server: StartedTestServer | undefined;
let baseUrl: string = '';
const clients: Socket[] = [];

/**
 * Opens a socket and waits for it to be connected.
 * @returns The connected socket.
 */
async function connectClient(): Promise<Socket> {
    return await new Promise<Socket>((resolve, reject) => {
        const socket: Socket = io(baseUrl, { auth: { offset: 0 } });
        clients.push(socket);
        socket.once('connect', () => resolve(socket));
        socket.once('connect_error', reject);
    });
}

/**
 * Sends one event and waits for the answer to it.
 * @param event - The event to send.
 * @returns The message the server answered with.
 */
async function sendEvent(event: string): Promise<WebsocketMessage> {
    const socket: Socket = await connectClient();
    return await new Promise<WebsocketMessage>((resolve, reject) => {
        const timeout: NodeJS.Timeout = setTimeout(() => reject(new Error('timed out waiting for a websocket response')), 8000);
        socket.once(WebsocketEvent.RESPONSE, (msg: WebsocketMessage, ack?: () => void) => {
            clearTimeout(timeout);
            ack?.();
            resolve(msg);
        });
        socket.emit(event, {});
    });
}

beforeAll(async () => {
    server = await startTestServer({
        websocketControllers: [DeadlineWsController, AppDefaultWsController],
        dataSources: [dataSourceClass],
        providers
    });
    baseUrl = await server.start();
}, 30000);

afterEach(async () => {
    for (const client of clients.splice(0)) {
        client.disconnect();
    }
    await wait(50);
});

afterAll(async () => {
    await server?.shutdown();
}, 30000);

describe('a websocket handler that runs longer than its deadline', () => {

    it('answers with a 504 rather than leaving the caller waiting', async () => {
        const msg: WebsocketMessage = await sendEvent('dl:inherits');

        expect(msg.ok).toBe(false);
        expect(msg.status).toBe(HttpStatus.GATEWAY_TIMEOUT);
    }, 15000);

    it('answers before the handler has finished', async () => {
        const start: number = Date.now();

        await sendEvent('dl:inherits');

        // the handler waits 400ms and the deadline is 60ms
        expect(Date.now() - start).toBeLessThan(350);
    }, 15000);

    it('fires the signal of the message', async () => {
        records.delete('inherits');

        await sendEvent('dl:inherits');
        await wait(500);

        expect(records.get('inherits')).toEqual({ signalAborted: true });
    }, 15000);
});

describe('a websocket handler that finishes in time', () => {

    it('answers normally', async () => {
        const msg: WebsocketMessage = await sendEvent('dl:fast');

        expect(msg.ok).toBe(true);
    }, 15000);

    it('leaves the signal alone', async () => {
        records.delete('fast');

        await sendEvent('dl:fast');

        expect(records.get('fast')).toEqual({ signalAborted: false });
    }, 15000);
});

describe('which deadline a websocket route gets', () => {

    it('takes its own over its controller\'s', async () => {
        const msg: WebsocketMessage = await sendEvent('dl:own');

        // 200ms of work, 60ms on the controller, a second on the route
        expect(msg.ok).toBe(true);
    }, 15000);

    it('takes the application\'s when neither says anything', async () => {
        const msg: WebsocketMessage = await sendEvent('app:slow');

        expect(msg.ok).toBe(false);
        expect(msg.status).toBe(HttpStatus.GATEWAY_TIMEOUT);
    }, 15000);

    it('runs unbounded when the route says none', async () => {
        const msg: WebsocketMessage = await sendEvent('dl:none');

        // 200ms of work under an application that allows 120ms and a controller that allows 60ms
        expect(msg.ok).toBe(true);
    }, 15000);
});

describe('a client that goes away', () => {

    it('fires the signal of the messages still being handled for it', async () => {
        records.delete('hangs-up');
        const socket: Socket = await connectClient();
        socket.emit('dl:hangs-up', {});

        // long enough for the handler to have started, nowhere near its own 600ms
        await wait(100);
        socket.disconnect();

        await wait(800);
        // nothing else would ever notice: there is no response to fail to write, and the handler
        // has no deadline of its own
        expect(records.get('hangs-up')).toEqual({ signalAborted: true });
    }, 15000);
});