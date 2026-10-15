import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { MultithreadingServiceInterface } from './multithreading-service.interface';
import { MultithreadingService } from './multithreading.service';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function';
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

/**
 * The repository for {@link AnyThreadJobEntity}.
 */
type ThreadJobRepository = Repository<AnyThreadJobEntity>;

/**
 * What a write to a thread job row names.
 */
type ThreadJobUpdate = Parameters<ThreadJobRepository['updateById']>[1];

const computingWorker: FsPath = FsUtilities.getPath(__dirname, 'multithreading.service.test.worker.ts');

let server: StartedTestServer;
let multithreadingService: MultithreadingServiceInterface;
let threadJobRepository: ThreadJobRepository;

/**
 * Fails the next write to a thread job row that matches, the way a data source that is unreachable
 * for a moment fails it. Every write before and after it goes through.
 * @param matches - Which write to fail.
 */
function failNextWrite(matches: (data: ThreadJobUpdate) => boolean): void {
    const updateById: ThreadJobRepository['updateById'] = threadJobRepository.updateById.bind(threadJobRepository);
    const spy: jest.SpiedFunction<ThreadJobRepository['updateById']> = jest.spyOn(threadJobRepository, 'updateById')
        .mockImplementation(async (id, data, options) => {
            if (matches(data)) {
                spy.mockRestore();
                throw new Error('the data source is unreachable');
            }
            return await updateById(id, data, options);
        });
}

/**
 * Reads the status a job's row holds.
 * @param id - The job.
 * @returns Its status.
 */
async function resolveStatus(id: string): Promise<ThreadJobStatus> {
    return (await threadJobRepository.findById(id)).status;
}

// the pool is a single worker, so a worker that is never handed back stops every job after it -
// which is how each of these used to fail: not with an error, but with nothing running ever again
describe('MultithreadingService, when a thread job row cannot be written', () => {
    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities })],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({
                    token: ZIBRI_DI_TOKENS.MULTITHREADING_OPTIONS,
                    useValue: {
                        maxThreads: 1,
                        maxPriorityThreads: 0,
                        defaultTimeoutMs: Ms.HOUR,
                        defaultTimeoutPriorityMs: Ms.MINUTE * 5,
                        jobClaimInMs: Ms.SECOND * 30,
                        enableTsWorkerFiles: true
                    }
                }),
                defineProvider({ token: ZIBRI_DI_TOKENS.MULTITHREADING_SERVICE, useClass: MultithreadingService })
            ]
        });
        multithreadingService = inject(ZIBRI_DI_TOKENS.MULTITHREADING_SERVICE);
        threadJobRepository = inject(repositoryTokenFor(ThreadJobEntity));
    }, 30000);

    afterEach(() => {
        jest.restoreAllMocks();
    });

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    it('hands the worker back when the completion of a job cannot be recorded', async () => {
        failNextWrite(data => data.status === ThreadJobStatus.COMPLETED);

        const unrecorded: string = await multithreadingService.queueThreadJob({ workerData: { filePath: computingWorker, amount: 10 } });
        const next: string = await multithreadingService.queueThreadJob({ workerData: { filePath: computingWorker, amount: 10 } });

        await waitUntil(async () => await resolveStatus(next) === ThreadJobStatus.COMPLETED, Ms.SECOND * 10);

        // the row never learned that the job finished, and nothing holds a claim on it any more -
        // so it is taken over like the job of an instance that stopped, and run again
        await waitUntil(async () => await resolveStatus(unrecorded) === ThreadJobStatus.COMPLETED, Ms.SECOND * 10);
        expect((await threadJobRepository.findById(unrecorded)).result).toBe(55);
    }, 30000);

    it('hands the worker back when the end of a crashed worker cannot be recorded', async () => {
        failNextWrite(data => data.status === ThreadJobStatus.FAILED);

        const crashing: string = await multithreadingService.queueThreadJob({
            workerData: { filePath: FsUtilities.getPath(__dirname, 'multithreading.service.crashing.test.worker.ts') }
        });
        const next: string = await multithreadingService.queueThreadJob({ workerData: { filePath: computingWorker, amount: 10 } });

        await waitUntil(async () => await resolveStatus(next) === ThreadJobStatus.COMPLETED, Ms.SECOND * 10);
        await waitUntil(async () => await resolveStatus(crashing) === ThreadJobStatus.FAILED, Ms.SECOND * 10);
    }, 30000);

    it('stops a job past its timeout when the timeout cannot be recorded', async () => {
        failNextWrite(data => data.error?.name === 'TimeoutError');

        // enough work to take far longer than the wait below, so a job that is not stopped is
        // still running when the assertion gives up on it
        const overdue: string = await multithreadingService.queueThreadJob({
            workerData: { filePath: computingWorker, amount: 45 },
            timeout: 1
        });

        await waitUntil(async () => await resolveStatus(overdue) === ThreadJobStatus.FAILED, Ms.SECOND * 3);
    }, 30000);
});