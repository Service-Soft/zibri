import { describe, expect, it } from '@jest/globals';
import { ContainerRuntimeClient, getContainerRuntimeClient } from 'testcontainers';
import { CONTAINER_PROCESS_LABEL } from 'zibri-testing';

import { createTestDataSource } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { startTestServer } from '../__testing__/test-server/start-test-server.function';
import { PostgresDataSource } from '../data-source/data-sources/postgres/postgres-typeorm-data-source.model';
import { MigrationEntity } from '../data-source/migration/migration-entity.model';
import { defineProvider } from '../di/models/di-provider.model';
import { OnAppInit } from '../global/on-app-init.interface';
import { Newable } from '../types/newable.type';

/**
 * What a test server leaves running when it cannot start the containers it was given.
 *
 * A container nothing holds keeps running until the process ends, and a docker call it is still
 * waiting on lands after its suite is gone, where it fails with an error about the docker client
 * rather than with the one that stopped the suite.
 */

// orphans allowed, since the application of the second case does not include them
const provisionedDataSourceClass: Newable<PostgresDataSource> = createTestDataSource({ entities: [MigrationEntity], allowOrphan: true });

// the database every postgres container already has, so creating it for the application is refused
const refusedDataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: [MigrationEntity],
    database: 'postgres',
    allowOrphan: true
});

/**
 * The containers this process started that are still running.
 * @returns Their ids.
 */
async function findOwnRunningContainers(): Promise<string[]> {
    const client: ContainerRuntimeClient = await getContainerRuntimeClient();
    return (await client.container.list())
        .filter(c => c.Labels[CONTAINER_PROCESS_LABEL] === String(process.pid))
        .map(c => c.Id);
}

const bootedDataSourceClass: Newable<PostgresDataSource> = createTestDataSource();

const failedStart: string = 'the start fails after its containers are gone';

/**
 * Takes this process's containers away from under the harness and then fails the start, so that
 * stopping them while cleaning up fails as well.
 */
class ContainerRemovingFailure implements OnAppInit {
    async onAppInit(): Promise<void> {
        const client: ContainerRuntimeClient = await getContainerRuntimeClient();
        for (const id of await findOwnRunningContainers()) {
            await client.container.stop(client.container.getById(id), { timeout: 0 });
            await client.container.remove(client.container.getById(id), { removeVolumes: true });
        }
        throw new Error(failedStart);
    }
}

describe('a test server whose containers cannot all be started', () => {
    it('stops the ones it started before reporting why', async () => {
        const runningBefore: string[] = await findOwnRunningContainers();

        await expect(startTestServer({ dataSources: [provisionedDataSourceClass, refusedDataSourceClass] }))
            .rejects.toThrow('Could not provision the role');

        expect(await findOwnRunningContainers()).toEqual(runningBefore);
    }, 60000);
});

describe('a test server whose start fails', () => {
    it('reports why it failed, even when cleaning up after it fails too', async () => {
        await expect(startTestServer({
            dataSources: [bootedDataSourceClass],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({ token: ContainerRemovingFailure, useClass: ContainerRemovingFailure })
            ]
        })).rejects.toThrow(failedStart);
    }, 60000);
});