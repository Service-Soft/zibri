import { getHeapStatistics } from 'node:v8';
import { type ResourceLimits } from 'node:worker_threads';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { MultithreadingServiceInterface } from './multithreading-service.interface';
import { MultithreadingService } from './multithreading.service';
import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { waitUntil } from '../../__testing__/wait-until.function';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { defineProvider } from '../../di/models/di-provider.model';
import { FsPath, FsUtilities } from '../../utilities/fs.utilities';
import { Ms } from '../../utilities/ms';
import { BaseFunctionThreadJobWorkerData, BaseThreadJobWorkerData } from '../models/base-thread-job-worker-data.model';
import { ThreadJobEntity } from '../models/thread-job-entity.model';
import { ThreadJobStatus } from '../models/thread-job-status.enum';

/**
 * A thread job row as the repository hands it back.
 */
type AnyThreadJobEntity = ThreadJobEntity<BaseThreadJobWorkerData | BaseFunctionThreadJobWorkerData<unknown>, unknown>;

const MAX_ATTEMPTS: number = 3;

const MEGABYTE: number = 1024 * 1024;

/**
 * What a thread of the service may hold on its heap.
 */
const WORKER_RESOURCE_LIMITS: { maxOldGenerationSizeMb: number } = { maxOldGenerationSizeMb: 64 };

/**
 * The young generation a thread gets with that, as docs/background-work/multithreading.md states it.
 */
const BOUNDED_YOUNG_GENERATION_IN_MB: number = 8;

// compiled fixtures, so that the worker carries no TypeScript compiler on the heap the limit is on
const computingWorker: FsPath = FsUtilities.getPath(__dirname, 'multithreading.service.test.worker.js');
const allocatingWorker: FsPath = FsUtilities.getPath(__dirname, 'multithreading.service.allocating.test.worker.js');
const heapWorker: FsPath = FsUtilities.getPath(__dirname, 'multithreading.service.heap.test.worker.js');
const computing: BaseThreadJobWorkerData & { amount: number } = { filePath: computingWorker, amount: 10 };

/**
 * The heap a thread reports it was given: as v8 sees it, and as node states its limits.
 */
type ReportedHeap = { heapLimitMb: number, limits: ResourceLimits };

// in memory, so that a row can be planted as a dead instance would have left it
const dataSourceClass: ReturnType<typeof createInMemoryDataSource> = createInMemoryDataSource({
    entities: defaultTestServerEntities,
    repositories: defaultTestServerRepositories
});

describe('MultithreadingService, bounding a job', () => {
    let server: StartedTestServer;
    let multithreadingService: MultithreadingServiceInterface;
    let jobs: Repository<AnyThreadJobEntity>;

    /**
     * Plants the row a killed instance leaves behind: running, with nothing holding its claim.
     * @param attempts - How often the job was started before.
     * @returns The row.
     */
    async function plantAbandonedJob(attempts: number): Promise<AnyThreadJobEntity> {
        return await jobs.create({
            queuedAtMs: Date.now() - Ms.MINUTE,
            startedAtMs: Date.now() - Ms.MINUTE,
            status: ThreadJobStatus.IN_PROGRESS,
            priority: false,
            progress: 40,
            attempts,
            timeoutInMs: Ms.HOUR,
            workerData: computing
        });
    }

    /**
     * Waits for the job's row to say it is over.
     * @param id - The job.
     * @returns The row.
     */
    async function waitForEnd(id: string): Promise<AnyThreadJobEntity> {
        await waitUntil(
            async () => [ThreadJobStatus.COMPLETED, ThreadJobStatus.FAILED].includes((await jobs.findById(id)).status),
            Ms.SECOND * 20
        );
        return await jobs.findById(id);
    }

    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [dataSourceClass],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({
                    token: ZIBRI_DI_TOKENS.MULTITHREADING_OPTIONS,
                    useValue: {
                        maxThreads: 1,
                        maxPriorityThreads: 0,
                        defaultTimeoutInMs: Ms.MINUTE,
                        defaultPriorityTimeoutInMs: Ms.MINUTE,
                        jobClaimInMs: Ms.SECOND * 30,
                        maxAttempts: MAX_ATTEMPTS,
                        workerResourceLimits: WORKER_RESOURCE_LIMITS,
                        enableTsWorkerFiles: false
                    }
                }),
                defineProvider({ token: ZIBRI_DI_TOKENS.MULTITHREADING_SERVICE, useClass: MultithreadingService })
            ]
        });
        multithreadingService = inject(ZIBRI_DI_TOKENS.MULTITHREADING_SERVICE);
        jobs = inject(repositoryTokenFor(ThreadJobEntity));
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    it('bounds the heap of a thread, which otherwise gets what the process has', async () => {
        const job: ThreadJobEntity<BaseThreadJobWorkerData, ReportedHeap> = await multithreadingService.runThreadJob({ workerData: { filePath: heapWorker } });

        expect(job.status).toBe(ThreadJobStatus.COMPLETED);
        // a few times the limit rather than the limit: v8 counts the young generation and the code
        // reservation it gives the thread on top of the old generation the limit bounds
        expect(job.result?.heapLimitMb).toBeGreaterThanOrEqual(WORKER_RESOURCE_LIMITS.maxOldGenerationSizeMb);
        expect(job.result?.heapLimitMb).toBeLessThan(getHeapStatistics().heap_size_limit / MEGABYTE / 4);
    }, 30000);

    // node gives a thread that reaches its limit sixteen megabytes to stop in, and a scavenge
    // promotes the survivors of a whole young generation into the old one at once. V8 sizes the
    // young generation for the machine, not for the limit: wide enough, one scavenge reaches past
    // that room and the thread takes the process with it rather than ending alone - seen in a full
    // test run, where this suite crashed its jest worker
    it('bounds the young generation of a thread along with its old one', async () => {
        const job: ThreadJobEntity<BaseThreadJobWorkerData, ReportedHeap> = await multithreadingService.runThreadJob({ workerData: { filePath: heapWorker } });

        expect(job.result?.limits).toMatchObject({
            maxOldGenerationSizeMb: WORKER_RESOURCE_LIMITS.maxOldGenerationSizeMb,
            maxYoungGenerationSizeMb: BOUNDED_YOUNG_GENERATION_IN_MB
        });
    }, 30000);

    it('fails a job that goes past the memory limit with the error, and replaces the worker', async () => {
        const allocating: string = await multithreadingService.queueThreadJob({ workerData: { filePath: allocatingWorker } });

        const failed: AnyThreadJobEntity = await waitForEnd(allocating);
        expect(failed.status).toBe(ThreadJobStatus.FAILED);
        expect(failed.error?.paragraphs.join('\n')).toContain('memory');

        // the pool is a single worker, so the next job only runs on its replacement
        const next: AnyThreadJobEntity = await multithreadingService.runThreadJob({ workerData: computing });
        expect(next.status).toBe(ThreadJobStatus.COMPLETED);
        expect(next.result).toBe(55);
    }, 30000);

    // the limit is only worth anything if the thread is what ends: node gives a thread past its limit
    // a little room to stop in, and a thread that allocates through that room takes the whole process
    // with it, which a single run of the job would show once in a while and this shows sooner
    it('ends every job that goes past the memory limit the same way, run after run', async () => {
        for (let run: number = 0; run < 20; run++) {
            const allocating: string = await multithreadingService.queueThreadJob({ workerData: { filePath: allocatingWorker } });

            const failed: AnyThreadJobEntity = await waitForEnd(allocating);
            expect({ run, status: failed.status, error: failed.error?.name }).toEqual({ run, status: ThreadJobStatus.FAILED, error: failed.error?.name });
            expect(failed.error?.paragraphs.join('\n')).toContain('memory');
        }
    }, 120000);

    it('counts the first start of a job', async () => {
        const job: AnyThreadJobEntity = await multithreadingService.runThreadJob({ workerData: computing });

        expect(job.attempts).toBe(1);
    }, 30000);

    it('takes an abandoned job over while it has starts left, counting the takeover', async () => {
        const abandoned: AnyThreadJobEntity = await plantAbandonedJob(MAX_ATTEMPTS - 1);

        await multithreadingService.startQueuedJobs();

        const completed: AnyThreadJobEntity = await waitForEnd(abandoned.id);
        expect(completed.status).toBe(ThreadJobStatus.COMPLETED);
        expect(completed.result).toBe(55);
        expect(completed.attempts).toBe(MAX_ATTEMPTS);
    }, 30000);

    it('fails an abandoned job that was started maxAttempts times instead of taking it over again', async () => {
        const abandoned: AnyThreadJobEntity = await plantAbandonedJob(MAX_ATTEMPTS);

        await multithreadingService.startQueuedJobs();

        const failed: AnyThreadJobEntity = await waitForEnd(abandoned.id);
        expect(failed.status).toBe(ThreadJobStatus.FAILED);
        expect(failed.error?.name).toBe('ThreadJobAttemptsExhaustedError');
        expect(failed.attempts).toBe(MAX_ATTEMPTS);
        // never started here: what the row kept of the last run is still there
        expect(failed.startedAtMs).toBe(abandoned.startedAtMs);
        expect(failed.progress).toBe(40);
        expect(failed.stoppedAtMs).toBeDefined();
    }, 30000);

    it('starts the count over when a failed job is requeued', async () => {
        const abandoned: AnyThreadJobEntity = await plantAbandonedJob(MAX_ATTEMPTS);
        await multithreadingService.startQueuedJobs();
        await waitForEnd(abandoned.id);

        await multithreadingService.requeueThreadJob(abandoned.id);

        const completed: AnyThreadJobEntity = await waitForEnd(abandoned.id);
        expect(completed.status).toBe(ThreadJobStatus.COMPLETED);
        expect(completed.attempts).toBe(1);
    }, 30000);
});