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

// compiled fixtures, so that the worker carries no TypeScript compiler on the heap the limit is on
const computingWorker: FsPath = FsUtilities.getPath(__dirname, 'multithreading.service.test.worker.js');
const allocatingWorker: FsPath = FsUtilities.getPath(__dirname, 'multithreading.service.allocating.test.worker.js');
const computing: BaseThreadJobWorkerData & { amount: number } = { filePath: computingWorker, amount: 10 };

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
                        workerResourceLimits: { maxOldGenerationSizeMb: 64 },
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