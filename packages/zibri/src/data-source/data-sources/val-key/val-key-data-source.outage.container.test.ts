import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import type { GlideClient } from '@valkey/valkey-glide';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { TestTimeouts } from '../../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../../__testing__/test-server/create-test-data-source.function';
import { createTestValKeyDataSource } from '../../../__testing__/test-server/create-test-val-key-data-source.function';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { inject } from '../../../di/inject.function';
import { Newable } from '../../../types/newable.type';
import { MigrationEntity } from '../../migration/migration-entity.model';
import { Repository } from '../../repository/repository';
import { DataSourceInitializationError } from '../data-source-initialization.error';
import { ValKeyDataSource } from './val-key-data-source.model';
import { valKeyGlide } from './val-key-glide.function';

// the framework's own entities in memory, so that the valkey data source holds only what the case reads
const frameworkDataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
    entities: defaultTestServerEntities,
    repositories: defaultTestServerRepositories
});

const valKeyDataSourceClass: Newable<ValKeyDataSource> = createTestValKeyDataSource({ entities: [MigrationEntity] });

let server: StartedTestServer | undefined;

/**
 * Hands over the started server.
 * @returns The server.
 * @throws When the server did not start.
 */
function getServer(): StartedTestServer {
    if (server == undefined) {
        throw new Error('the server did not start');
    }
    return server;
}

/**
 * A data source of another application on the same server, connecting without the setup init does: that
 * registers the repositories of the data source, which an application that has started takes no more of.
 */
class ConnectingDataSource extends createTestValKeyDataSource({ allowOrphan: true }) {
    /**
     * Opens the connections of the data source.
     */
    async connect(): Promise<void> {
        await this.openConnections();
    }
}

beforeAll(async () => {
    server = await startTestServer({ dataSources: [frameworkDataSourceClass, valKeyDataSourceClass] });
}, TestTimeouts.valKey.start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.valKey.shutdown);

// the first connection was kept when the second, which the locks are renewed through, could not be opened: left
// open, and the data source counted as initialized, so that connecting again was refused
describe('a valkey data source whose second connection cannot be opened', () => {
    it('keeps neither connection, and connects once the server takes both', async () => {
        const dataSource: ConnectingDataSource = new ConnectingDataSource();
        dataSource.options = { ...inject(valKeyDataSourceClass).options };
        const clientClass: typeof GlideClient = valKeyGlide().GlideClient;
        const createClient: typeof GlideClient.createClient = clientClass.createClient.bind(clientClass);
        const opened: GlideClient[] = [];
        // what a server at its limit of clients does to the second connection, made certain
        const refusingTheSecond: jest.SpiedFunction<typeof GlideClient.createClient> = jest.spyOn(clientClass, 'createClient')
            .mockImplementation(async options => {
                if (opened.length === 1) {
                    throw new Error('the server takes no more clients');
                }
                const client: GlideClient = await createClient(options);
                opened.push(client);
                return client;
            });
        try {
            await expect(dataSource.connect()).rejects.toThrow('the server takes no more clients');
        }
        finally {
            refusingTheSecond.mockRestore();
        }

        expect(() => dataSource.connection).toThrow(DataSourceInitializationError);
        // closed, so that it answers nothing more
        await expect(opened[0]?.ping()).rejects.toThrow();

        await dataSource.connect();
        try {
            expect(await dataSource.connection.ping()).toBe('PONG');
        }
        finally {
            await dataSource.shutDown();
        }
    });
});

// nothing showed that a running instance reads and writes again once valkey dropped its
// connections, which is what a restart or a failover of valkey does to every client
describe('an application whose valkey drops its connections', () => {
    it('reads again without a restart', async () => {
        // from the valkey data source itself: the one in memory records its migrations too
        const migrations: Repository<MigrationEntity> = inject(valKeyDataSourceClass).getRepository(MigrationEntity);
        const before: MigrationEntity[] = await migrations.findAll();

        await getServer().runInContainer(valKeyDataSourceClass, ['valkey-cli', 'CLIENT', 'KILL', 'TYPE', 'normal']);
        await getServer().runInContainer(valKeyDataSourceClass, ['valkey-cli', 'CLIENT', 'KILL', 'TYPE', 'pubsub']);

        expect(await migrations.findAll()).toEqual(before);
    });
});