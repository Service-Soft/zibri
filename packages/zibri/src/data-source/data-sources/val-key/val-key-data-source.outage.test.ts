import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { ValKeyDataSource } from './val-key-data-source.model';
import { TestTimeouts } from '../../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../../__testing__/test-server/create-test-data-source.function';
import { createTestValKeyDataSource } from '../../../__testing__/test-server/create-test-val-key-data-source.function';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { inject } from '../../../di/inject.function';
import { Newable } from '../../../types/newable.type';
import { MigrationEntity } from '../../migration/migration-entity.model';
import { Repository } from '../../repository/repository';

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

// nothing showed that a running instance reads and writes again once valkey dropped its
// connections, which is what a restart or a failover of valkey does to every client
describe('an application whose valkey drops its connections', () => {
    beforeAll(async () => {
        server = await startTestServer({ dataSources: [frameworkDataSourceClass, valKeyDataSourceClass] });
    }, TestTimeouts.valKey.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.valKey.shutdown);

    it('reads again without a restart', async () => {
        // from the valkey data source itself: the one in memory records its migrations too
        const migrations: Repository<MigrationEntity> = inject(valKeyDataSourceClass).getRepository(MigrationEntity);
        const before: MigrationEntity[] = await migrations.findAll();

        await getServer().runInContainer(valKeyDataSourceClass, ['valkey-cli', 'CLIENT', 'KILL', 'TYPE', 'normal']);
        await getServer().runInContainer(valKeyDataSourceClass, ['valkey-cli', 'CLIENT', 'KILL', 'TYPE', 'pubsub']);

        expect(await migrations.findAll()).toEqual(before);
    });
});