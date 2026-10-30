import os from 'node:os';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { waitUntil } from '../__testing__/wait-until.function';
import { Repository } from '../data-source/repository/repository';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { defineProvider } from '../di/models/di-provider.model';
import { Lease } from '../leases/lease.model';
import { BaseFunctionThreadJobWorkerData, BaseThreadJobWorkerData } from '../multithreading/models/base-thread-job-worker-data.model';
import { ThreadJobEntity } from '../multithreading/models/thread-job-entity.model';
import { MultithreadingService } from '../multithreading/services/multithreading.service';
import { FsPath, FsUtilities } from '../utilities/fs.utilities';
import { Ms } from '../utilities/ms';

/**
 * A thread job row as the repository hands it back.
 */
type AnyThreadJobEntity = ThreadJobEntity<BaseThreadJobWorkerData | BaseFunctionThreadJobWorkerData<unknown>, unknown>;

const endlessWorker: FsPath = FsUtilities.getPath(__dirname, '..', 'multithreading', 'services', 'multithreading.service.endless.test.worker.js');

const dataSourceClass: ReturnType<typeof createInMemoryDataSource> = createInMemoryDataSource({
    entities: defaultTestServerEntities,
    repositories: defaultTestServerRepositories
});

/**
 * Reads who holds a grant, from inside the work it guards.
 * @param key - The grant to take.
 * @returns What its row says in `heldBy`.
 */
async function findHolderOfGrant(key: string): Promise<string | undefined> {
    return await inject(ZIBRI_DI_TOKENS.LEASE_SERVICE).withLease({ key, leaseInMs: Ms.MINUTE }, async () => {
        const lease: Lease = await inject(repositoryTokenFor(Lease)).findOne({ where: { key } });
        return lease.heldBy;
    });
}

// round 2's 06 §F12: every replica of a deployment shares its application name, which was all a
// grant recorded about its holder
describe('The instance an application runs as', () => {
    describe('when the deployment names it', () => {
        let server: StartedTestServer;

        beforeAll(async () => {
            server = await startTestServer({
                name: 'Api',
                dataSources: [dataSourceClass],
                providers: [
                    ...defaultTestServerProviders,
                    defineProvider({ token: ZIBRI_DI_TOKENS.INSTANCE_ID, useValue: 'pod-7f9c' }),
                    defineProvider({ token: ZIBRI_DI_TOKENS.MULTITHREADING_SERVICE, useClass: MultithreadingService })
                ]
            });
        }, TestTimeouts.inMemory.start);

        afterAll(async () => {
            await server?.shutdown();
        }, TestTimeouts.inMemory.shutdown);

        it('is recorded on a grant beside the application name', async () => {
            expect(await findHolderOfGrant('named-instance')).toBe('Api@pod-7f9c');
        });

        it('is recorded on the row of a thread job it runs, and on the claim of that job', async () => {
            const jobs: Repository<AnyThreadJobEntity> = inject(repositoryTokenFor(ThreadJobEntity));
            const id: string = await inject(ZIBRI_DI_TOKENS.MULTITHREADING_SERVICE).queueThreadJob({ workerData: { filePath: endlessWorker } });
            await waitUntil(async () => (await jobs.findById(id)).progress > 0, Ms.SECOND * 10);

            expect((await jobs.findById(id)).instanceId).toBe('pod-7f9c');
            const claim: Lease = await inject(repositoryTokenFor(Lease)).findOne({ where: { key: `thread-job:${id}` } });
            expect(claim.heldBy).toBe('Api@pod-7f9c');
        }, 30000);
    });

    describe('by default', () => {
        let server: StartedTestServer;

        beforeAll(async () => {
            server = await startTestServer({ name: 'Api', dataSources: [dataSourceClass] });
        }, TestTimeouts.inMemory.start);

        afterAll(async () => {
            await server?.shutdown();
        }, TestTimeouts.inMemory.shutdown);

        it('is the host and the process', async () => {
            expect(await findHolderOfGrant('default-instance')).toBe(`Api@${os.hostname()}:${process.pid}`);
        });
    });
});