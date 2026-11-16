import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { MultithreadingService } from './multithreading.service';
import { ThreadJobWorker } from './thread-job-worker';
import { TestTimeouts } from '../../__testing__/constants';
import { describeThreadJob } from '../../__testing__/describe-thread-job.function';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { waitUntil } from '../../__testing__/wait-until.function';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { defineProvider } from '../../di/models/di-provider.model';
import { LeaseOptions } from '../../leases/lease-options.model';
import { LeaseService } from '../../leases/lease.service';
import { FsUtilities } from '../../utilities/fs.utilities';
import { Ms } from '../../utilities/ms';
import { BaseFunctionThreadJobWorkerData, BaseThreadJobWorkerData } from '../models/base-thread-job-worker-data.model';
import { ThreadJobEntity } from '../models/thread-job-entity.model';
import { ThreadJobStatus } from '../models/thread-job-status.enum';

/**
 * A thread job row as the repository hands it back.
 */
type AnyThreadJobEntity = ThreadJobEntity<BaseThreadJobWorkerData | BaseFunctionThreadJobWorkerData<unknown>, unknown>;

// longer than the test waits for the job, so a job posted to the dead worker fails the test rather than ending in time
const JOB_TIMEOUT_IN_MS: number = Ms.SECOND * 20;

/**
 * Holds the first claim on a thread job until the test lets it go: the worker the round took for the job is out of
 * the idle list by then, and the job is not running on it yet.
 */
let signalClaimAsked: () => void = () => undefined;
const claimAsked: Promise<void> = new Promise<void>(resolve => {
    signalClaimAsked = resolve;
});
let releaseClaim: () => void = () => undefined;
const claimReleased: Promise<void> = new Promise<void>(resolve => {
    releaseClaim = resolve;
});
let claimsHeld: number = 0;

class HeldLeaseService extends LeaseService {
    override async withLease<T>(options: LeaseOptions, fn: (lost: AbortSignal) => Promise<T>): Promise<T | undefined> {
        if (options.key.startsWith('thread-job:') && claimsHeld === 0) {
            claimsHeld++;
            signalClaimAsked();
            await claimReleased;
        }
        return await super.withLease(options, fn);
    }
}

// in memory, with a claim held from outside: the worker dies in the moment between being taken for a job and running
// it, as one killed for its memory or by a native crash can
describe('MultithreadingService, given a worker that dies while the job it was taken for is claimed', () => {
    let server: StartedTestServer;
    let multithreadingService: MultithreadingService;
    let jobs: Repository<AnyThreadJobEntity>;

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
                        enableTsWorkerFiles: false
                    }
                }),
                defineProvider({ token: ZIBRI_DI_TOKENS.MULTITHREADING_SERVICE, useClass: MultithreadingService }),
                defineProvider({ token: ZIBRI_DI_TOKENS.LEASE_SERVICE, useClass: HeldLeaseService })
            ]
        });
        multithreadingService = inject(ZIBRI_DI_TOKENS.MULTITHREADING_SERVICE) as MultithreadingService;
        jobs = inject(repositoryTokenFor(ThreadJobEntity));
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    it('runs the job on the worker replacing it, instead of posting it to the dead one', async () => {
        const workerData: BaseThreadJobWorkerData & { amount: number } = {
            filePath: FsUtilities.getPath(__dirname, 'multithreading.service.test.worker.js'),
            amount: 10
        };
        const job: AnyThreadJobEntity = await jobs.create({
            queuedAtMs: Date.now(),
            status: ThreadJobStatus.IN_QUEUE,
            priority: false,
            progress: 0,
            attempts: 0,
            timeoutInMs: JOB_TIMEOUT_IN_MS,
            workerData
        });

        // the way a completed job starts the next round: nobody waits for it
        void multithreadingService.startQueuedJobs();
        await claimAsked;
        const taken: ThreadJobWorker[] = multithreadingService['workers'];
        expect(taken.length).toBe(1);
        await taken[0]?.worker.terminate();
        // the exit is handled once its replacement is idle
        await waitUntil(() => multithreadingService['idleWorkers'].length === 1, Ms.SECOND * 5);
        releaseClaim();

        await waitUntil(
            async () => (await jobs.findById(job.id)).status === ThreadJobStatus.COMPLETED,
            Ms.SECOND * 10,
            async () => await describeThreadJob(jobs, job.id)
        );
        expect((await jobs.findById(job.id)).result).toEqual(55);
    }, Ms.SECOND * 30);
});