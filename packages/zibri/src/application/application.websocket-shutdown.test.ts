import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { io, Socket } from 'socket.io-client';
import { createInMemoryDataSource } from 'zibri-testing';

import { TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { defineProvider } from '../di/models/di-provider.model';
import { Ms } from '../utilities/ms';
import { WebsocketController } from '../websocket/decorators/websocket-controller.decorator';
import { WebsocketRoute } from '../websocket/decorators/websocket-route.decorator';

/**
 * How a shutdown goes with a websocket client still connected.
 *
 * A websocket never finishes on its own: the client holds it open for as long as the tab is. So a
 * drain that waits for every connection to end would wait for the client, and a client does not go
 * away because the server would like it to.
 */

@WebsocketController({ allowOrphan: true, eventPrefix: 'ws:' })
class EchoController {
    @WebsocketRoute('echo')
    echo(): { handler: string } {
        return { handler: 'echo' };
    }
}

const DRAIN_TIMEOUT_IN_MS: number = Ms.SECOND * 2;

async function connectClient(url: string): Promise<Socket> {
    return await new Promise((resolve, reject) => {
        const socket: Socket = io(url, { auth: { offset: 0 }, reconnection: false });
        socket.once('connect', () => resolve(socket));
        socket.once('connect_error', reject);
    });
}

describe('shutting down with a websocket client connected', () => {
    let server: StartedTestServer;
    let baseUrl: string;
    let client: Socket;

    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories })],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({ token: ZIBRI_DI_TOKENS.HTTP_DRAIN_TIMEOUT_IN_MS, useFactory: () => DRAIN_TIMEOUT_IN_MS })
            ],
            websocketControllers: [EchoController]
        });
        baseUrl = await server.start();
        client = await connectClient(baseUrl);
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        client.disconnect();
        await server.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    it('ends the connection and finishes within the drain timeout', async () => {
        const disconnected: Promise<void> = new Promise(resolve => {
            client.once('disconnect', () => resolve());
        });
        const started: number = Date.now();

        await server.shutdown();

        // well inside the timeout rather than at it: a websocket is ended as the drain begins, since
        // waiting on it buys nothing - there is no request on it that could finish
        expect(Date.now() - started).toBeLessThan(DRAIN_TIMEOUT_IN_MS);
        await disconnected;
        expect(client.connected).toBe(false);
    }, DRAIN_TIMEOUT_IN_MS + 5000);
});