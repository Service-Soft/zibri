import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { createInMemoryDataSource, VALKEY_PORT, VALKEY_TEST_IMAGE } from 'zibri-testing';

import { ValKeyDataSource, ValKeyOptions } from './val-key-data-source.model';
import { TestTimeouts } from '../../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { BaseEntity } from '../../../entity/base-entity.model';
import { Newable } from '../../../types/newable.type';
import { RepositoryClass } from '../../repository/repository-class.type';

let server: StartedTestServer;
let clustered: StartedTestContainer;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories })] });
    clustered = await new GenericContainer(VALKEY_TEST_IMAGE)
        .withCommand(['valkey-server', '--cluster-enabled', 'yes'])
        .withExposedPorts(VALKEY_PORT)
        .start();
}, 60000);

afterAll(async () => {
    await clustered.stop();
    await server.shutdown();
}, TestTimeouts.inMemory.shutdown);

describe('a valkey data source pointed at a server in cluster mode', () => {
    it('refuses to start', async () => {
        const port: number = clustered.getMappedPort(VALKEY_PORT);

        class ClusteredDataSource extends ValKeyDataSource {
            readonly entities: Newable<BaseEntity>[] = [];
            readonly repositories: RepositoryClass[] = [];
            readonly options: ValKeyOptions = { host: clustered.getHost(), port, useTLS: false };
        }
        const dataSource: ClusteredDataSource = new ClusteredDataSource(
            inject(ZIBRI_DI_TOKENS.LOGGER),
            inject(ZIBRI_DI_TOKENS.AUTH_SERVICE)
        );

        // a single connection to one node of a cluster answers only the keys of that node's slots,
        // so the data source would start and then fail on the first write that lands elsewhere
        await expect(dataSource.init()).rejects.toThrow(/runs in cluster mode/);
    });
});