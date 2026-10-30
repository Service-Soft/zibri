import { describe, expect, it } from '@jest/globals';
import { ContainerRuntimeClient, getContainerRuntimeClient } from 'testcontainers';
import { CONTAINER_PROCESS_LABEL } from 'zibri-testing';

import { TestServerTimeouts, TestTimeouts } from '../__testing__/constants';
import { createTestDataSource } from '../__testing__/test-server/create-test-data-source.function';
import { createTestValKeyDataSource } from '../__testing__/test-server/create-test-val-key-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { PostgresDataSource } from '../data-source/data-sources/postgres/postgres-data-source.model';
import { ValKeyDataSource } from '../data-source/data-sources/val-key/val-key-data-source.model';
import { MigrationEntity } from '../data-source/migration/migration-entity.model';
import { defineProvider } from '../di/models/di-provider.model';
import { OnAppInit } from '../global/on-app-init.interface';
import { Newable } from '../types/newable.type';
import { JsonUtilities } from '../utilities/json.utilities';

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

/**
 * An event the container runtime reports about a container.
 */
type ContainerEvent = {
    /**
     * What happened, such as `exec_create: psql --username postgres`.
     */
    Action: string
};

// orphans allowed, since the applications of the cases above do not include it
const valKeyDataSourceClass: Newable<ValKeyDataSource> = createTestValKeyDataSource({ allowOrphan: true });

const bothTimeouts: TestServerTimeouts = TestTimeouts.resolveCombined('postgres', 'valKey');

// a boot that took a few seconds on its own took over forty in a full run: every container polled
// the container runtime with commands run inside it while it started, three every tenth of a second,
// and a health check every quarter of a second for as long as it ran, so each container starting
// beside it made the others slower
describe('the containers of a test server', () => {
    it('runs nothing in them while they start or run, except what creates the application\'s role', async () => {
        const client: ContainerRuntimeClient = await getContainerRuntimeClient();
        const recording: AbortController = new AbortController();
        const events: NodeJS.ReadableStream = await client.container.dockerode.getEvents({
            filters: { type: ['container'], event: ['exec_create'], label: [`${CONTAINER_PROCESS_LABEL}=${process.pid}`] },
            abortSignal: recording.signal
        });
        // a stream that broke while recording would leave commands out, and the case passing on that
        events.on('error', (error: Error) => {
            if (!recording.signal.aborted) {
                throw error;
            }
        });
        const commands: string[] = [];
        let unfinishedLine: string = '';
        events.on('data', (chunk: Buffer) => {
            const lines: string[] = `${unfinishedLine}${chunk.toString()}`.split('\n');
            unfinishedLine = lines.pop() ?? '';
            commands.push(...lines.filter(line => line.trim() !== '')
                .map(line => JsonUtilities.parse<ContainerEvent>(line).Action.replace('exec_create: ', '')));
        });

        const server: StartedTestServer = await startTestServer({ dataSources: [bootedDataSourceClass, valKeyDataSourceClass] });
        try {
            const health: unknown[] = await Promise.all((await findOwnRunningContainers())
                .map(async id => (await client.container.inspect(client.container.getById(id))).State.Health));
            expect(health).toEqual([undefined, undefined]);
        }
        finally {
            await server.shutdown();
            recording.abort();
        }

        expect(commands.map(command => command.split(' ')[0])).toEqual(['psql']);
    }, bothTimeouts.start + bothTimeouts.shutdown);
});