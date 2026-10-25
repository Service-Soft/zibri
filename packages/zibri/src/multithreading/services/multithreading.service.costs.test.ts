import { setTimeout as sleep } from 'node:timers/promises';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource, RoundTripCounter } from 'zibri-testing';

import { type MultithreadingServiceInterface } from './multithreading-service.interface';
import { MultithreadingService } from './multithreading.service';
import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { defineProvider } from '../../di/models/di-provider.model';
import { Newable } from '../../types/newable.type';
import { FsUtilities } from '../../utilities/fs.utilities';
import { Ms } from '../../utilities/ms';
import { BaseFunctionThreadJobWorkerData, BaseThreadJobWorkerData } from '../models/base-thread-job-worker-data.model';
import { ThreadJobEntity } from '../models/thread-job-entity.model';
import { ThreadJobStatus } from '../models/thread-job-status.enum';

/**
 * What waiting for a thread job another instance runs costs, as calls on the store.
 */

/**
 * A thread job row as the repository hands it back.
 */
type AnyThreadJobEntity = ThreadJobEntity<BaseThreadJobWorkerData | BaseFunctionThreadJobWorkerData<unknown>, unknown>;

const roundTrips: RoundTripCounter = new RoundTripCounter();

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
    entities: defaultTestServerEntities,
    repositories: defaultTestServerRepositories,
    roundTrips
});

let server: StartedTestServer | undefined;

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
            defineProvider({ token: ZIBRI_DI_TOKENS.THREAD_JOB_RETENTION_IN_MS, useValue: 'forever' }),
            defineProvider({ token: ZIBRI_DI_TOKENS.MULTITHREADING_SERVICE, useClass: MultithreadingService })
        ]
    });
    // before the row is planted: the pool reads the queue once on start
    await server.start();
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.inMemory.shutdown);

describe('what waiting for a thread job costs', () => {
    it('reads the row of a job another instance runs a few times a minute, not ten times a second', async () => {
        const jobs: Repository<AnyThreadJobEntity> = inject(repositoryTokenFor(ThreadJobEntity));
        // running on another instance, which holds its claim
        const job: AnyThreadJobEntity = await jobs.create({
            queuedAtMs: Date.now(),
            startedAtMs: Date.now(),
            progress: 0,
            attempts: 1,
            priority: false,
            timeout: Ms.MINUTE,
            status: ThreadJobStatus.IN_PROGRESS,
            workerData: { filePath: FsUtilities.getPath('elsewhere.js') }
        });
        await inject(ZIBRI_DI_TOKENS.LEASE_SERVICE).withLease({ key: `thread-job:${job.id}`, leaseInMs: Ms.MINUTE }, async () => {
            const multithreadingService: MultithreadingServiceInterface = inject(ZIBRI_DI_TOKENS.MULTITHREADING_SERVICE);

            roundTrips.reset();
            const waiting: Promise<AnyThreadJobEntity> = Promise.resolve(multithreadingService.waitForThreadJob(job.id));
            await sleep(Ms.SECOND);

            expect(roundTrips.trips.filter(t => t.statement.startsWith('ThreadJobEntity.')).length).toBeLessThanOrEqual(2);

            // the other instance finishing it. Without its wake up, which only that instance sends,
            // the waiter still finds out by reading the row again
            await jobs.updateById(job.id, { status: ThreadJobStatus.COMPLETED, result: 42 });
            const ended: AnyThreadJobEntity = await waiting;
            expect(ended.status).toBe(ThreadJobStatus.COMPLETED);
        });
    }, 15000);
});