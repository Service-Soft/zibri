import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { io, Socket } from 'socket.io-client';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { ZibriPlugin } from './plugin.model';
import { TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { waitUntil } from '../__testing__/wait-until.function';
import { Auth } from '../auth/decorators/auth.decorator';
import { DataSourceInterface } from '../data-source/data-sources/data-source.interface';
import { DataSource } from '../data-source/decorators/data-source.decorator';
import { MigrationEntity } from '../data-source/migration/migration-entity.model';
import { RepositoryClass } from '../data-source/repository/repository-class.type';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { defineProvider } from '../di/models/di-provider.model';
import { BaseEntity } from '../entity/base-entity.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';
import { Newable } from '../types/newable.type';
import { Ms } from '../utilities/ms';
import { WebsocketController } from '../websocket/decorators/websocket-controller.decorator';
import { WebsocketRoute } from '../websocket/decorators/websocket-route.decorator';
import { SocketIOWebsocketConnection } from '../websocket/models/connection/socket-io-websocket-connection.model';
import { WebsocketMessage } from '../websocket/models/websocket-message.model';
import { type WebsocketServiceInterface } from '../websocket/services/websocket-service.interface';

/**
 * What the plugin stores, in a data source of its own.
 */
@Entity({ tenant: 'shared' })
class PluginNotification extends BaseEntity {
    @Property.string()
    text!: string;
}

/**
 * The plugin's own data source, holding its entities and none of the framework's.
 */
@DataSource()
class NotificationsDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = [MigrationEntity, PluginNotification];
    override readonly repositories: RepositoryClass[] = [];
}

const pluginDataSourceClass: Newable<InMemoryDataSource> = NotificationsDataSource;

@WebsocketController({ eventPrefix: 'notifications:' })
class NotificationsWsController {
    @Auth.skip()
    @WebsocketRoute('count')
    async count(): Promise<number> {
        return await inject(repositoryTokenFor(PluginNotification)).count();
    }
}

/**
 * A feature shipped as a plugin: a websocket controller over a data source of its own.
 */
class NotificationsPlugin extends ZibriPlugin {
    override websocketControllers: Newable<unknown>[] = [NotificationsWsController];
    override dataSources: Newable<DataSourceInterface>[] = [pluginDataSourceClass];

    validate(): void {
        // brings everything it needs
    }
}

let server: StartedTestServer | undefined;
let baseUrl: string;

beforeAll(async () => {
    server = await startTestServer({
        plugins: [new NotificationsPlugin()],
        dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories })],
        providers: [
            ...defaultTestServerProviders,
            defineProvider({
                token: ZIBRI_DI_TOKENS.WEBSOCKET_OPTIONS_INPUT,
                useValue: { messageRetentionInMs: Ms.DAY, timeoutInMs: 5000, handlerTimeoutInMs: 5000, isAllowedToConnect: () => true }
            })
        ]
    });
    baseUrl = await server.start();
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.inMemory.shutdown);

// a plugin carried providers, controllers, cron jobs, body
// parsers, auth strategies and authenticators, and an application registered the rest by hand
describe('a plugin', () => {
    it('ships websocket controllers and data sources, which the application uses without naming them', async () => {
        await inject(repositoryTokenFor(PluginNotification)).create({ text: 'a task was assigned to you' });
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const wsService: WebsocketServiceInterface<SocketIOWebsocketConnection> = inject(ZIBRI_DI_TOKENS.WEBSOCKET_SERVICE);
        const socket: Socket = io(baseUrl, { auth: { offset: 0 }, autoConnect: false });
        try {
            await new Promise<void>((resolve, reject) => {
                socket.once('connect', () => resolve());
                socket.once('connect_error', reject);
                socket.connect();
            });
            await waitUntil(async () => (await wsService.getConnections()).some(c => c.id === socket.id));

            const answer: WebsocketMessage = await socket.timeout(3000).emitWithAck('notifications:count', { headers: {} }) as WebsocketMessage;

            expect(answer.status).toBe(200);
            expect(answer.data).toBe(1);
        }
        finally {
            socket.disconnect();
        }
    });
});