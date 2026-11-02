import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import { io, Socket } from 'socket.io-client';
import { createInMemoryDataSource } from 'zibri-testing';

import { type WebsocketServiceInterface } from './websocket-service.interface';
import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { defineProvider, DiProvider } from '../../di/models/di-provider.model';
import { JsonUtilities } from '../../utilities/json.utilities';
import { Ms } from '../../utilities/ms';
import { BigNumber } from '../../utilities/number.utilities';
import { WebsocketController } from '../decorators/websocket-controller.decorator';
import { WebsocketRoute } from '../decorators/websocket-route.decorator';
import { SocketIOWebsocketConnection } from '../models/connection/socket-io-websocket-connection.model';
import { WebsocketEvent } from '../models/websocket-event.enum';
import { WebsocketMessage } from '../models/websocket-message.model';
import { WebsocketOptionsInput } from '../models/websocket-options.model';

/**
 * Values json has no form of its own for, each written the way the framework writes it everywhere else.
 */
type Values = {
    count: bigint,
    at: Date,
    amount: BigNumber,
    bytes: Buffer
};

/**
 * What a client receives for {@link Values}.
 */
type ReceivedValues = {
    count: string,
    at: string,
    amount: string,
    bytes: { type: 'Buffer', data: number[] }
};

/**
 * A fresh copy per send, so nothing one case does to it can reach the next.
 * @returns The values.
 */
function values(): Values {
    return {
        // past what a number holds exactly, so a bigint is the only way to have it
        count: 2n ** 64n,
        at: new Date('2026-01-02T03:04:05.000Z'),
        amount: new BigNumber('0.1'),
        bytes: Buffer.from([1, 2, 3])
    };
}

const received: ReceivedValues = {
    count: '18446744073709551616',
    at: '2026-01-02T03:04:05.000Z',
    amount: '0.1',
    bytes: { type: 'Buffer', data: [1, 2, 3] }
};

@WebsocketController({ allowOrphan: true, eventPrefix: 'payload:' })
class PayloadWsController {
    @WebsocketRoute('values')
    values(): Values {
        return values();
    }
}

const dataSourceClass: ReturnType<typeof createInMemoryDataSource> = createInMemoryDataSource({
    entities: defaultTestServerEntities,
    repositories: defaultTestServerRepositories
});

const websocketOptions: WebsocketOptionsInput = {
    messageRetentionInMs: Ms.DAY,
    timeoutInMs: 5000,
    handlerTimeoutInMs: 5000,
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
 * Waits for one event, acknowledging it when the server asked for that.
 * @param socket - The socket to listen on.
 * @param event - The event to wait for.
 * @returns The message that came with it.
 */
async function waitForMessage(socket: Socket, event: string): Promise<WebsocketMessage> {
    return await new Promise<WebsocketMessage>((resolve, reject) => {
        const timeout: NodeJS.Timeout = setTimeout(() => reject(new Error(`timed out waiting for "${event}"`)), 5000);
        socket.once(event, (msg: WebsocketMessage, second?: string | (() => void)) => {
            clearTimeout(timeout);
            // a broadcast carries the offset connection state recovery resumes from, an emit that
            // waits for an answer carries the function to answer with
            if (typeof second === 'function') {
                second();
            }
            resolve(msg);
        });
    });
}

beforeAll(async () => {
    server = await startTestServer({
        websocketControllers: [PayloadWsController],
        dataSources: [dataSourceClass],
        providers
    });
    baseUrl = await server.start();
    // eslint-disable-next-line typescript/no-unsafe-assignment
    websocketService = inject(ZIBRI_DI_TOKENS.WEBSOCKET_SERVICE);
}, TestTimeouts.inMemory.start);

afterEach(() => {
    for (const client of clients.splice(0)) {
        client.disconnect();
    }
});

afterAll(async () => {
    await server?.shutdown();
}, 30000);

describe('what a websocket client receives', () => {

    it('is json when a handler answers with an event', async () => {
        const socket: Socket = await connectClient();
        const answer: Promise<WebsocketMessage> = waitForMessage(socket, WebsocketEvent.RESPONSE);

        socket.emit('payload:values', {});

        expect((await answer).data).toEqual(received);
    }, 15000);

    it('is the same json when a handler answers through an acknowledgement', async () => {
        const socket: Socket = await connectClient();

        // an acknowledgement is written by socket.io without the service in between, and a bigint
        // in it threw inside socket.io - so the answer never went out and the caller waited forever
        const answer: WebsocketMessage = await socket.timeout(5000).emitWithAck('payload:values', {}) as WebsocketMessage;

        expect(answer.data).toEqual(received);
    }, 15000);

    // a request is an object: `null` reached Object.keys and was answered and logged as a server
    // error, and a number or a list passed as a request naming nothing
    it.each<[string, unknown]>([
        // eslint-disable-next-line unicorn/no-null
        ['null', null],
        ['a number', 42],
        ['a list', []],
        ['a text', 'payload']
    ])('answers a message that is %s rather than an object as a bad request', async (_what, message) => {
        const socket: Socket = await connectClient();

        const answer: WebsocketMessage = await socket.timeout(5000).emitWithAck('payload:values', message) as WebsocketMessage;

        expect(answer).toMatchObject({ ok: false, status: 400 });
    }, 15000);

    it('is the same json when it is sent to everyone', async () => {
        const socket: Socket = await connectClient();
        const broadcast: Promise<WebsocketMessage> = waitForMessage(socket, 'payload:broadcast');

        await websocketService.sendToAll({
            event: 'payload:broadcast',
            message: { ok: true, data: values(), senderUserId: undefined, senderConnectionId: undefined },
            expectResponse: false,
            persist: false
        });

        expect((await broadcast).data).toEqual(received);
    }, 15000);

    it('is the same json when everyone is asked to answer', async () => {
        const socket: Socket = await connectClient();
        const broadcast: Promise<WebsocketMessage> = waitForMessage(socket, 'payload:asked');

        await websocketService.sendToAll({
            event: 'payload:asked',
            message: { ok: true, data: values(), senderUserId: undefined, senderConnectionId: undefined },
            expectResponse: true,
            persist: false
        });

        expect((await broadcast).data).toEqual(received);
    }, 15000);
});

// written to json and back by the service and then written again by socket.io, a message cost three
// passes over it. What a client receives is the same either way, so this measures a duration
describe('what sending a websocket message costs', () => {
    /**
     * Large enough that writing it is what sending it costs. Many small values with a bigint in each,
     * since a bigint is what socket.io's own json encoder throws on.
     */
    const largePayload: { rows: { id: string, name: string, amount: bigint, active: boolean, tags: string[] }[] } = {
        rows: Array.from({ length: 20000 }, (_, i) => ({
            id: `row-${i}`,
            name: `a name that is long enough to be worth writing out ${i}`,
            amount: BigInt(i) * 1000n,
            active: i % 2 === 0,
            tags: ['alpha', 'beta', 'gamma']
        }))
    };

    /**
     * How long a broadcast of each kind takes, the quickest of three. Each is received before the
     * next is sent, so no send is timed while the client in the same process still takes the last one
     * apart. The kinds take turns, so a machine that gets busier or quieter meanwhile slows all of
     * them alike.
     * @param socket - The client receiving them.
     * @param resolveDataOfEach - What each kind of message carries, resolved inside the timed send.
     * @returns The duration of each kind in milliseconds, in the order given.
     */
    async function resolveFastestBroadcastsInMs(socket: Socket, resolveDataOfEach: (() => unknown)[]): Promise<number[]> {
        const durations: number[][] = resolveDataOfEach.map(() => []);
        for (let attempt: number = 0; attempt < 3; attempt++) {
            for (const [index, resolveData] of resolveDataOfEach.entries()) {
                const arrived: Promise<WebsocketMessage> = waitForMessage(socket, 'payload:large');
                const start: number = performance.now();
                await websocketService.sendToAll({
                    event: 'payload:large',
                    message: { ok: true, data: resolveData(), senderUserId: undefined, senderConnectionId: undefined },
                    expectResponse: false,
                    persist: false
                });
                durations[index]?.push(performance.now() - start);
                await arrived;
            }
        }
        return durations.map(d => Math.min(...d));
    }

    // against the other candidate measured here and now, as a send under the same load, so this says
    // something about the framework rather than about the machine. Measured in process, the
    // serializing alone was slowed less by a busy machine than a send is, and the comparison read as
    // a regression
    it('writes a message once', async () => {
        const socket: Socket = await connectClient();
        const sends: (() => unknown)[] = [
            // what a send with nothing to write costs, a constant of the machine
            () => ({}),
            () => largePayload,
            // the round trip the service used to make before socket.io wrote the message once more
            () => JsonUtilities.parse(JsonUtilities.stringify(largePayload))
        ];
        // a first round of its own, so no measured send pays for compiling what it runs
        await resolveFastestBroadcastsInMs(socket, sends);

        const [overhead = 0, onePass = 0, threePasses = 0] = await resolveFastestBroadcastsInMs(socket, sends);

        // sendToAll writes the message synchronously for every client, so its time is the write's. The
        // third send differs from the second by the round trip alone, whatever the service does, so
        // it is a bar the service cannot move: about two passes, a parse costing nearly what a
        // stringify does. One pass stays under it and three go over it. A ratio of the two sends
        // could not tell them apart, since a service writing three times adds the same to both
        expect(onePass - overhead).toBeLessThan(threePasses - onePass);
    }, 60000);
});