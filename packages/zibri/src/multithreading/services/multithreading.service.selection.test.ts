import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { MultithreadingServiceInterface } from './multithreading-service.interface';
import { MultithreadingService } from './multithreading.service';
import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { FindAllOptions } from '../../data-source/models/options/find-all-options.model';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { defineProvider } from '../../di/models/di-provider.model';
import { EntitySelection, Projected } from '../../entity/models/entity-selection.model';
import { FsUtilities } from '../../utilities/fs.utilities';
import { Ms } from '../../utilities/ms';
import { BaseFunctionThreadJobWorkerData, BaseThreadJobWorkerData } from '../models/base-thread-job-worker-data.model';
import { ThreadJobEntity } from '../models/thread-job-entity.model';
import { ThreadJobStatus } from '../models/thread-job-status.enum';

/**
 * A thread job row as the repository hands it back.
 */
type AnyThreadJobEntity = ThreadJobEntity<BaseThreadJobWorkerData | BaseFunctionThreadJobWorkerData<unknown>, unknown>;

/**
 * How long a job that a free worker could take at once may stay in the queue before that counts as never.
 */
const STARTS_WITHIN_MS: number = Ms.SECOND * 3;

// compiled, so that a job is over in a moment rather than once a compiler has loaded
const computing: BaseThreadJobWorkerData & { amount: number } = {
    filePath: FsUtilities.getPath(__dirname, 'multithreading.service.test.worker.js'),
    amount: 10
};

// the cron job that looks for queued jobs every two seconds is stubbed by the test server, so a job
// nothing else starts is never started here - which is what makes a lost start visible
describe('MultithreadingService, starting what is queued', () => {
    let server: StartedTestServer;
    let multithreadingService: MultithreadingServiceInterface;
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
                        defaultTimeoutInMs: Ms.MINUTE,
                        defaultPriorityTimeoutInMs: Ms.MINUTE,
                        jobClaimInMs: Ms.SECOND * 30,
                        maxAttempts: 3,
                        workerResourceLimits: {},
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
        jest.restoreAllMocks();
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    /**
     * Queues a job the way a row is queued, without asking the pool to look: the asking is what
     * the case below times.
     * @returns The id of the row.
     */
    async function queueRow(): Promise<string> {
        return (await jobs.create({
            queuedAtMs: Date.now(),
            status: ThreadJobStatus.IN_QUEUE,
            priority: false,
            progress: 0,
            attempts: 0,
            timeoutInMs: Ms.MINUTE,
            workerData: computing
        })).id;
    }

    /**
     * Waits for the job to be over, as long as a job a free worker could take at once may take.
     * @param id - The job.
     * @returns Its status by then.
     */
    async function statusAfterAWhile(id: string): Promise<ThreadJobStatus> {
        let status: ThreadJobStatus = (await jobs.findById(id)).status;
        const deadline: number = Date.now() + STARTS_WITHIN_MS;
        while (status !== ThreadJobStatus.COMPLETED && Date.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, 20));
            status = (await jobs.findById(id)).status;
        }
        return status;
    }

    // a selection round reads the table, finds nothing and ends. A job queued after that read asks
    // the pool to look again, and the round answers that by going once more - unless it was asked
    // between its last read and its end, where the request found a round still on and was lost
    // with it: the job stayed in the queue with a free worker beside it, until the next poll. That
    // gap is a microtask or two wide, and on postgres two answers arriving in one chunk put a queue
    // call right there. So the row is written as the round's last read answers, and the pool is
    // asked at every microtask depth after it, the way a queue call asks after its write
    it('starts a job queued as a selection round ends', async () => {
        const findAll: Repository<AnyThreadJobEntity>['findAll'] = jobs.findAll.bind(jobs);
        const findAllSpy: jest.SpiedFunction<Repository<AnyThreadJobEntity>['findAll']> = jest.spyOn(jobs, 'findAll');

        for (let depth: number = 0; depth < 12; depth++) {
            let reads: number = 0;
            let queued: Promise<string> | undefined;
            let asked: Promise<boolean> | undefined;
            // eslint-disable-next-line no-loop-func
            findAllSpy.mockImplementation(async <const S extends EntitySelection<AnyThreadJobEntity> | undefined = undefined>(
                options?: FindAllOptions<AnyThreadJobEntity, S>
            ): Promise<Projected<AnyThreadJobEntity, S>[]> => {
                const rows: Projected<AnyThreadJobEntity, S>[] = await findAll(options);
                // the round reads priority work first and normal work second, which is its last read
                reads++;
                if (reads !== 2) {
                    return rows;
                }
                const id: string = await queueRow();
                queued = Promise.resolve(id);
                asked = (async (): Promise<boolean> => {
                    for (let hop: number = 0; hop < depth; hop++) {
                        await Promise.resolve();
                    }
                    return await multithreadingService.startQueuedJobs();
                })();
                return rows;
            });

            await multithreadingService.startQueuedJobs();
            const id: string = await (queued ?? Promise.reject(new Error('the round never read the table')));
            await asked;
            findAllSpy.mockImplementation(findAll);

            expect({ depth, status: await statusAfterAWhile(id) }).toEqual({ depth, status: ThreadJobStatus.COMPLETED });
        }
    }, 120000);
});