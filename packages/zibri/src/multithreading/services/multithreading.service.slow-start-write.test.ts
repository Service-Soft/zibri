import { setTimeout as sleep } from 'node:timers/promises';

import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

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
import { FsPath, FsUtilities } from '../../utilities/fs.utilities';
import { Ms } from '../../utilities/ms';
import { BaseFunctionThreadJobWorkerData, BaseThreadJobWorkerData } from '../models/base-thread-job-worker-data.model';
import { ThreadJobEntity } from '../models/thread-job-entity.model';
import { ThreadJobStatus } from '../models/thread-job-status.enum';
import { MultithreadingServiceInterface } from './multithreading-service.interface';
import { MultithreadingService } from './multithreading.service';

/**
 * A thread job row as the repository hands it back.
 */
type AnyThreadJobEntity = ThreadJobEntity<BaseThreadJobWorkerData | BaseFunctionThreadJobWorkerData<unknown>, unknown>;

/**
 * The repository for {@link AnyThreadJobEntity}.
 */
type ThreadJobRepository = Repository<AnyThreadJobEntity>;

let server: StartedTestServer;
let multithreadingService: MultithreadingServiceInterface;
let threadJobRepository: ThreadJobRepository;

/**
 * Holds back the write that records the start of a job, the way a round trip to a database server
 * holds it back. Every other write goes through at once.
 */
function delayStartWrites(): void {
    const updateById: ThreadJobRepository['updateById'] = threadJobRepository.updateById.bind(threadJobRepository);
    jest.spyOn(threadJobRepository, 'updateById').mockImplementation(async (id, data, options) => {
        if (data.startedAtMs != undefined) {
            await sleep(300);
        }
        return await updateById(id, data, options);
    });
}

/**
 * Holds back the answer to the write that records the start of a job, the way the way back of a round trip
 * to a database server holds it back: the row says the job started, and the pool does not know yet.
 */
function delayStartWriteAnswers(): void {
    const updateById: ThreadJobRepository['updateById'] = threadJobRepository.updateById.bind(threadJobRepository);
    jest.spyOn(threadJobRepository, 'updateById').mockImplementation(async (id, data, options) => {
        const updated: Awaited<ReturnType<ThreadJobRepository['updateById']>> = await updateById(id, data, options);
        if (data.startedAtMs != undefined) {
            await sleep(300);
        }
        return updated;
    });
}

// the in-memory data source writes in the same tick, which is why the main suite only showed this on
// postgres: whatever a run reports was checked against a row that did not say yet that it had started,
// and dropped as a write of a run some other instance had taken over
describe('MultithreadingService, when recording the start of a job is slow', () => {
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
    }, TestTimeouts.inMemory.start);

    afterEach(() => {
        jest.restoreAllMocks();
    });

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    it('keeps the progress a worker reports straight away', async () => {
        delayStartWrites();
        const filePath: FsPath = FsUtilities.getPath(__dirname, 'multithreading.service.progress.test.worker.ts');
        const jobId: string = await multithreadingService.queueThreadJob({ workerData: { filePath } });

        // the fixture reports 50 at once and completes two seconds later
        const deadline: number = Date.now() + (Ms.SECOND * 10);
        let midFlight: AnyThreadJobEntity = await threadJobRepository.findById(jobId);
        while (midFlight.progress !== 50 && midFlight.status !== ThreadJobStatus.COMPLETED && Date.now() < deadline) {
            await sleep(25);
            midFlight = await threadJobRepository.findById(jobId);
        }

        expect(midFlight.progress).toBe(50);
        expect(midFlight.status).toBe(ThreadJobStatus.IN_PROGRESS);
        await multithreadingService.waitForThreadJob(jobId);
    }, 15000);

    it('records the timeout of a job that is overdue at once', async () => {
        delayStartWrites();
        const filePath: FsPath = FsUtilities.getPath(__dirname, 'multithreading.service.test.worker.ts');
        const res: ThreadJobEntity<{ filePath: FsPath }, unknown> = await multithreadingService.runThreadJob({
            workerData: { filePath, amount: 45 },
            timeoutInMs: 1
        });

        expect(res.status).toBe(ThreadJobStatus.FAILED);
        expect(res.error?.name).toBe('TimeoutError');
    }, 15000);

    // the job counted as the worker's from the moment its start began to be recorded, before the worker was given
    // it: a worker ending meanwhile was taken for one that crashed running the job, which failed, without an error
    // and for good, where nothing had run it
    it('runs a job on the worker replacing one that ended while its start was recorded', async () => {
        delayStartWriteAnswers();
        const filePath: FsPath = FsUtilities.getPath(__dirname, 'multithreading.service.test.worker.js');
        // the class rather than the token, which types it without what the pool holds. One instance either way
        const pool: MultithreadingService = inject(MultithreadingService);
        const jobId: string = await multithreadingService.queueThreadJob({ workerData: { filePath, amount: 10 }, timeoutInMs: Ms.SECOND * 10 });

        // taken for the job, whose start is on its way to the row
        await waitUntil(() => pool['workers'].length === 1 && pool['runningJobs'].some(job => job.threadId === pool['workers'][0]?.threadId));
        await pool['workers'][0]?.worker.terminate();

        await waitUntil(
            async () => (await threadJobRepository.findById(jobId)).status === ThreadJobStatus.COMPLETED,
            Ms.SECOND * 10,
            async () => await describeThreadJob(threadJobRepository, jobId)
        );
        expect((await threadJobRepository.findById(jobId)).result).toEqual(55);
    }, 20000);

    // last in the file: it stops the pool
    it('does not hand a job to a worker once the pool stopped while its start was recorded', async () => {
        delayStartWrites();
        const filePath: FsPath = FsUtilities.getPath(__dirname, 'multithreading.service.endless.test.worker.js');
        // longer than the start write is held back, so a job handed over after all is still running
        // when its timeout writes to the row
        const id: string = await multithreadingService.queueThreadJob({ workerData: { filePath }, timeoutInMs: 600 });

        // the class rather than the token, which types it without the hook. One instance either way
        const shuttingDown: MultithreadingService = inject(MultithreadingService);
        expect(shuttingDown).toBe(multithreadingService);
        await shuttingDown.onAppShutdown();

        await sleep(Ms.SECOND * 1.5);
        expect((await threadJobRepository.findById(id)).error).toBeUndefined();
    }, 15000);
});