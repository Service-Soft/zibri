import { setTimeout as sleep } from 'node:timers/promises';

import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { MultithreadingServiceInterface } from './multithreading-service.interface';
import { MultithreadingService } from './multithreading.service';
import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { DeleteAllOptions } from '../../data-source/models/options/delete-all-options.model';
import { Where } from '../../data-source/models/where/where-filter.model';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { defineProvider } from '../../di/models/di-provider.model';
import { Lease } from '../../leases/lease.model';
import { FsPath, FsUtilities } from '../../utilities/fs.utilities';
import { Ms } from '../../utilities/ms';
import { BaseFunctionThreadJobWorkerData, BaseThreadJobWorkerData } from '../models/base-thread-job-worker-data.model';
import { ThreadJobEntity } from '../models/thread-job-entity.model';
import { ThreadJobStatus } from '../models/thread-job-status.enum';

/**
 * A thread job row as the repository hands it back.
 */
type AnyThreadJobEntity = ThreadJobEntity<BaseThreadJobWorkerData | BaseFunctionThreadJobWorkerData<unknown>, unknown>;

let server: StartedTestServer;
let multithreadingService: MultithreadingServiceInterface;
let threadJobRepository: Repository<AnyThreadJobEntity>;
let leaseRepository: Repository<Lease>;

const filePath: FsPath = FsUtilities.getPath(__dirname, 'multithreading.service.test.worker.ts');

/**
 * Holds back the write that hands the claim on a job back, the way a round trip to a database server
 * holds it back. Every other write goes through at once.
 */
function delayClaimReleases(): void {
    const deleteAll: Repository<Lease>['deleteAll'] = leaseRepository.deleteAll.bind(leaseRepository);
    jest.spyOn(leaseRepository, 'deleteAll').mockImplementation(async <R extends boolean = false>(
        where: Where<Lease>,
        options?: DeleteAllOptions<Lease, R>
    ): Promise<R extends true ? Lease[] : number> => {
        // a claim is handed back by its id, and cleared away by its key once it lapsed
        if (!Array.isArray(where) && 'id' in where) {
            await sleep(300);
        }
        return await deleteAll(where, options);
    });
}

// the cron job that looks for queued jobs every two seconds is stubbed by the test server, so a job
// nothing else starts is never started here
describe('MultithreadingService, requeueing a job', () => {
    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories })],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({
                    token: ZIBRI_DI_TOKENS.MULTITHREADING_OPTIONS,
                    useValue: {
                        maxThreads: 1,
                        maxPriorityThreads: 0,
                        defaultTimeoutInMs: Ms.HOUR,
                        defaultPriorityTimeoutInMs: Ms.MINUTE * 5,
                        jobClaimInMs: Ms.SECOND * 30,
                        maxAttempts: 3,
                        workerResourceLimits: {},
                        enableTsWorkerFiles: true
                    }
                }),
                defineProvider({ token: ZIBRI_DI_TOKENS.MULTITHREADING_SERVICE, useClass: MultithreadingService })
            ]
        });
        multithreadingService = inject(ZIBRI_DI_TOKENS.MULTITHREADING_SERVICE);
        threadJobRepository = inject(repositoryTokenFor(ThreadJobEntity));
        leaseRepository = inject(repositoryTokenFor(Lease));
    }, TestTimeouts.inMemory.start);

    afterEach(() => {
        jest.restoreAllMocks();
    });

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    it('runs a job requeued while the claim of its last run is still being handed back', async () => {
        delayClaimReleases();
        const jobId: string = await multithreadingService.queueThreadJob({ workerData: { filePath, amount: 10 } });
        expect((await multithreadingService.waitForThreadJob(jobId)).status).toBe(ThreadJobStatus.COMPLETED);

        // waiting ends with the job, which is before its claim is handed back
        const rerun: ThreadJobEntity<{ filePath: FsPath }, unknown> = await multithreadingService.rerunThreadJob(jobId);

        expect(rerun.status).toBe(ThreadJobStatus.COMPLETED);
        expect(rerun.result).toEqual(55);
    }, 10000);

    it('clears what the last run left on the row', async () => {
        const failed: AnyThreadJobEntity = await multithreadingService.runThreadJob({ workerData: { filePath, amount: 45 }, timeoutInMs: 1 });
        expect(failed.error?.name).toBe('TimeoutError');
        // what failed it fixed, which is what a job is usually requeued after
        await threadJobRepository.updateById(failed.id, { timeoutInMs: Ms.HOUR });

        const rerun: AnyThreadJobEntity = await multithreadingService.rerunThreadJob(failed.id);

        expect(rerun.status).toBe(ThreadJobStatus.COMPLETED);
        expect(rerun.error ?? undefined).toBeUndefined();
        // the thread is the one running the job, and nothing runs it once it ended
        expect(rerun.threadId ?? undefined).toBeUndefined();
        expect(rerun.stoppedAtMs).toBeGreaterThanOrEqual(rerun.startedAtMs ?? Number.POSITIVE_INFINITY);
    }, 15000);
});