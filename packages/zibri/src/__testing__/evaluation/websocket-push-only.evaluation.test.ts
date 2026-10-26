import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { io, Socket } from 'socket.io-client';
import { createInMemoryDataSource } from 'zibri-testing';

import { Auth } from '../../auth/decorators/auth.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { defineProvider } from '../../di/models/di-provider.model';
import { Response } from '../../open-api/decorators/response.decorator';
import { Controller } from '../../routing/decorators/controller.decorator';
import { Post } from '../../routing/decorators/post.decorator';
import { Ms } from '../../utilities/ms';
import { WebsocketMessage } from '../../websocket/models/websocket-message.model';
import { TestTimeouts } from '../constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../test-server/providers';
import { StartedTestServer, startTestServer } from '../test-server/start-test-server.function';

/**
 * Executable form of evaluation/04-infrastructure-subsystems.md section 1.14.
 *
 * The websocket server started for an application declaring a websocket controller or an adapter
 * data source. One that only pushes - clients listening, the server broadcasting from its http
 * routes - declares neither on a single instance, and its clients found nothing to connect to.
 */

const event: string = 'notification';

@Controller('/notifications', { allowOrphan: true })
class NotificationController {
    @Response.empty()
    @Auth.skip()
    @Post('/')
    async notify(): Promise<void> {
        await inject(ZIBRI_DI_TOKENS.WEBSOCKET_SERVICE).sendToAll({
            event,
            message: { ok: true, data: 'hello', senderUserId: undefined, senderConnectionId: undefined },
            expectResponse: false,
            persist: false
        });
    }
}

let server: StartedTestServer | undefined;
let baseUrl: string;
let client: Socket | undefined;

beforeAll(async () => {
    server = await startTestServer({
        controllers: [NotificationController],
        dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories })],
        providers: [
            ...defaultTestServerProviders,
            defineProvider({
                token: ZIBRI_DI_TOKENS.WEBSOCKET_OPTIONS_INPUT,
                useValue: { messageRetentionInMs: Ms.DAY, startServer: 'always' }
            })
        ]
    });
    baseUrl = await server.start();
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    client?.disconnect();
    await server?.shutdown();
}, TestTimeouts.inMemory.shutdown);

describe('evaluation/04-infrastructure-subsystems 1.14 - an application that only pushes over websockets', () => {
    it('starts a websocket server when told to, and its clients receive what an http route sends', async () => {
        client = await new Promise<Socket>((resolve, reject) => {
            const socket: Socket = io(baseUrl, { auth: { offset: 0 }, reconnection: false });
            socket.once('connect', () => resolve(socket));
            socket.once('connect_error', reject);
        });
        const received: Promise<WebsocketMessage> = new Promise(resolve => {
            client?.once(event, (message: WebsocketMessage) => resolve(message));
        });

        expect((await fetch(`${baseUrl}/notifications`, { method: 'POST' })).status).toBe(204);

        expect((await received).data).toBe('hello');
    }, 15000);
});