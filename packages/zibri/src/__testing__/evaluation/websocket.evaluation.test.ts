import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io, Socket } from 'socket.io-client';
import { createInMemoryDataSource } from 'zibri-testing';

import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../di/inject.function.ts';
import { defineProvider, DiProvider } from '../../di/models/di-provider.model.ts';
import { JsonUtilities } from '../../utilities/json.utilities.ts';
import { Ms } from '../../utilities/ms.ts';
import { WebsocketController } from '../../websocket/decorators/websocket-controller.decorator.ts';
import { WebsocketRoute } from '../../websocket/decorators/websocket-route.decorator.ts';
import { SocketIOWebsocketConnection } from '../../websocket/models/connection/socket-io-websocket-connection.model.ts';
import { WebsocketMessage } from '../../websocket/models/websocket-message.model.ts';
import { WebsocketOptionsInput } from '../../websocket/models/websocket-options.model.ts';
import { type WebsocketServiceInterface } from '../../websocket/services/websocket-service.interface.ts';
import { defaultTestServerEntities } from '../test-server/create-test-data-source.function.ts';
import { defaultTestServerProviders } from '../test-server/providers.ts';
import { StartedTestServer, startTestServer } from '../test-server/start-test-server.function.ts';

/**
 * Executable form of evaluation/04-infrastructure-subsystems.md section 3.11.
 *
 * A message was turned into json and back by the service, and then written again by socket.io, so
 * every send cost three passes over it. What a client receives is the same either way, which is why
 * the case that carries the finding measures a duration - the same shape as 02 M2's in
 * ./http-and-observability.evaluation.test.ts, for the same reason.
 */

const event: string = 'eval-websocket:broadcast';

/**
 * A message large enough that writing it is what sending it costs.
 *
 * Many small values rather than a few big ones, with a bigint in each, because a bigint is why the
 * round trip existed: socket.io's own encoder is plain json, which throws on one.
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

const dataSourceClass: ReturnType<typeof createInMemoryDataSource> = createInMemoryDataSource({
    entities: defaultTestServerEntities
});

const websocketOptions: WebsocketOptionsInput = {
    messageRetentionInMs: Ms.DAY,
    timeoutInMs: 5000,
    handlerInMs: 5000,
    isAllowedToConnect: () => true
};

// a websocket server is only started for an application that declares websockets, and this suite
// only ever sends
@WebsocketController({ allowOrphan: true, eventPrefix: 'eval-websocket:' })
class EvalWebsocketController {
    @WebsocketRoute('ping')
    ping(): string {
        return 'pong';
    }
}

const providers: DiProvider<unknown>[] = [
    ...defaultTestServerProviders,
    defineProvider({ token: ZIBRI_DI_TOKENS.WEBSOCKET_OPTIONS_INPUT, useValue: websocketOptions })
];

let server: StartedTestServer | undefined;
let websocketService: WebsocketServiceInterface<SocketIOWebsocketConnection>;
let client: Socket | undefined;

/**
 * Sends a message to everyone, without asking for answers and without storing it.
 * @param data - What the message carries.
 */
async function broadcast(data: unknown): Promise<void> {
    await websocketService.sendToAll({
        event,
        message: { ok: true, data, senderUserId: undefined, senderConnectionId: undefined },
        expectResponse: false,
        persist: false
    });
}

/**
 * Waits for the next broadcast to reach the client.
 * @returns The message it received.
 */
async function nextReceived(): Promise<WebsocketMessage> {
    return await new Promise<WebsocketMessage>((resolve, reject) => {
        const timeout: NodeJS.Timeout = setTimeout(() => reject(new Error('the broadcast never arrived')), 10000);
        client?.once(event, (msg: WebsocketMessage) => {
            clearTimeout(timeout);
            resolve(msg);
        });
    });
}

/**
 * How long the fastest of three runs of the given work takes.
 * @param work - The work to time.
 * @returns The duration in milliseconds.
 */
function fastestOfThree(work: () => void): number {
    let best: number = Number.POSITIVE_INFINITY;
    for (let i: number = 0; i < 3; i++) {
        const start: number = performance.now();
        work();
        best = Math.min(best, performance.now() - start);
    }
    return best;
}

/**
 * How long the fastest of three broadcasts of the given data takes, each one received before the next.
 * @param data - What the message carries.
 * @returns The duration in milliseconds.
 */
async function fastestOfThreeBroadcasts(data: unknown): Promise<number> {
    let best: number = Number.POSITIVE_INFINITY;
    for (let i: number = 0; i < 3; i++) {
        const received: Promise<WebsocketMessage> = nextReceived();
        const start: number = performance.now();
        await broadcast(data);
        best = Math.min(best, performance.now() - start);
        // received before the next one is sent, so no send is timed while the last is still
        // being taken apart by the client in the same process
        await received;
    }
    return best;
}

beforeAll(async () => {
    server = await startTestServer({
        websocketControllers: [EvalWebsocketController],
        dataSources: [dataSourceClass],
        providers
    });
    const baseUrl: string = await server.start();
    // eslint-disable-next-line typescript/no-unsafe-assignment
    websocketService = inject(ZIBRI_DI_TOKENS.WEBSOCKET_SERVICE);

    client = await new Promise<Socket>((resolve, reject) => {
        const socket: Socket = io(baseUrl, { auth: { offset: 0 } });
        socket.once('connect', () => resolve(socket));
        socket.once('connect_error', reject);
    });
}, 30000);

afterAll(async () => {
    client?.disconnect();
    await server?.shutdown();
}, 30000);

describe('evaluation/04-infrastructure-subsystems', () => {

    describe('3.11 - a websocket message must be written once', () => {

        it('delivers what one pass over the message produces', async () => {
            // a control, and the guard on the rewrite: handing socket.io the message as it is has
            // to deliver what the round trip used to, a bigint arriving as its digits included
            const received: Promise<WebsocketMessage> = nextReceived();

            await broadcast(largePayload);

            expect((await received).data).toEqual(JsonUtilities.parse(JsonUtilities.stringify(largePayload)));
        }, 30000);

        it('costs one pass rather than three', async () => {
            // both candidate implementations, measured on this machine at this moment: the one the
            // framework should be doing, and the round trip followed by socket.io's own write.
            // Comparing against the midpoint is what makes this a statement about the framework
            // rather than about how fast the machine running it happens to be
            const onePass: number = fastestOfThree(() => void JsonUtilities.stringify(largePayload));
            const threePasses: number = fastestOfThree(
                () => void JsonUtilities.stringify(JsonUtilities.parse(JsonUtilities.stringify(largePayload)))
            );

            // what a send costs with nothing worth writing, which is a constant of the machine
            // rather than of the implementation. Timed after a first send of each, or the measured
            // one pays for compiling everything on the way
            await fastestOfThreeBroadcasts({});
            await fastestOfThreeBroadcasts(largePayload);
            const overhead: number = await fastestOfThreeBroadcasts({});
            const sent: number = await fastestOfThreeBroadcasts(largePayload);

            // sendToAll writes the message synchronously, once for every client, so the time it
            // takes is the time the write takes
            expect(sent - overhead).toBeLessThan((onePass + threePasses) / 2);
        }, 60000);
    });
});