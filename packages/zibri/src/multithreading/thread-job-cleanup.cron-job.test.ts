import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { BaseFunctionThreadJobWorkerData, BaseThreadJobWorkerData } from './models/base-thread-job-worker-data.model';
import { ThreadJobEntity } from './models/thread-job-entity.model';
import { ThreadJobStatus } from './models/thread-job-status.enum';
import { MultithreadingServiceInterface } from './services/multithreading-service.interface';
import { MultithreadingService } from './services/multithreading.service';
import { ThreadJobCleanupCronJob } from './thread-job-cleanup.cron-job';
import { TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { CreateCronJobEntityData, CronJobEntity } from '../cron/cron-job-entity.model';
import { Repository } from '../data-source/repository/repository';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { defineProvider } from '../di/models/di-provider.model';
import { Ms } from '../utilities/ms';

/**
 * A thread job row as the repository hands it back.
 */
type AnyThreadJobEntity = ThreadJobEntity<BaseThreadJobWorkerData | BaseFunctionThreadJobWorkerData<unknown>, unknown>;

const RETENTION_IN_MS: number = Ms.DAY;

// in memory, so that the queue can be filled and swept without a container
const dataSourceClass: ReturnType<typeof createInMemoryDataSource> = createInMemoryDataSource({
    entities: defaultTestServerEntities,
    repositories: defaultTestServerRepositories
});

describe('ThreadJobCleanupCronJob', () => {
    let server: StartedTestServer;
    let multithreadingService: MultithreadingServiceInterface;
    let jobs: Repository<AnyThreadJobEntity>;

    /**
     * Writes a job row as the queue would have left it.
     * @param status - Where the job stands.
     * @param ageInMs - How long ago it was queued.
     * @returns The row.
     */
    async function createJob(status: ThreadJobStatus, ageInMs: number): Promise<AnyThreadJobEntity> {
        return await jobs.create({
            queuedAtMs: Date.now() - ageInMs,
            status,
            progress: 0,
            attempts: 1,
            priority: false,
            timeout: Ms.MINUTE,
            workerData: { filePath: 'nowhere.js' }
        });
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
                        defaultTimeoutMs: Ms.MINUTE,
                        defaultTimeoutPriorityMs: Ms.MINUTE,
                        jobClaimInMs: Ms.SECOND * 30,
                        maxAttempts: 3,
                        workerResourceLimits: {},
                        enableTsWorkerFiles: false
                    }
                }),
                defineProvider({ token: ZIBRI_DI_TOKENS.THREAD_JOB_RETENTION_IN_MS, useValue: RETENTION_IN_MS }),
                defineProvider({ token: ZIBRI_DI_TOKENS.MULTITHREADING_SERVICE, useClass: MultithreadingService })
            ]
        });
        multithreadingService = inject(ZIBRI_DI_TOKENS.MULTITHREADING_SERVICE);
        jobs = inject(repositoryTokenFor(ThreadJobEntity));
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    /**
     * Runs the cleanup job once, built by hand, because the test server runs no cron jobs.
     */
    async function runCleanup(): Promise<void> {
        const cleanup: ThreadJobCleanupCronJob = new ThreadJobCleanupCronJob(multithreadingService);
        const cronJobRepo: Repository<CronJobEntity, CreateCronJobEntityData> = inject(repositoryTokenFor(CronJobEntity));
        await cleanup.init(inject(ZIBRI_DI_TOKENS.LOGGER), cronJobRepo, async () => await Promise.resolve(true));
        await cleanup.onTick();
    }

    it('deletes the jobs that are over and older than the retention, and nothing else', async () => {
        const expired: AnyThreadJobEntity[] = await Promise.all([
            createJob(ThreadJobStatus.COMPLETED, RETENTION_IN_MS * 2),
            createJob(ThreadJobStatus.FAILED, RETENTION_IN_MS * 2),
            createJob(ThreadJobStatus.CANCELLED, RETENTION_IN_MS * 2)
        ]);
        const kept: AnyThreadJobEntity[] = await Promise.all([
            createJob(ThreadJobStatus.COMPLETED, Ms.HOUR),
            // owed however long ago it was queued
            createJob(ThreadJobStatus.IN_QUEUE, RETENTION_IN_MS * 2),
            createJob(ThreadJobStatus.INTERRUPTED, RETENTION_IN_MS * 2),
            createJob(ThreadJobStatus.IN_PROGRESS, RETENTION_IN_MS * 2)
        ]);

        await runCleanup();

        expect(await jobs.count({ where: { id: { oneOf: expired.map(j => j.id) } } })).toBe(0);
        expect(await jobs.count({ where: { id: { oneOf: kept.map(j => j.id) } } })).toBe(kept.length);
    });
});