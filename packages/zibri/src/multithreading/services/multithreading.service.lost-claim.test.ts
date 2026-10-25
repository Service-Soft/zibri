import { setTimeout as sleep } from 'node:timers/promises';

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

const JOB_CLAIM_IN_MS: number = 600;
const TAKER_THREAD_ID: number = 4242;

const endlessWorker: FsPath = FsUtilities.getPath(__dirname, 'multithreading.service.endless.test.worker.js');
const computingWorker: FsPath = FsUtilities.getPath(__dirname, 'multithreading.service.test.worker.js');

// in memory, so that the claim can be taken away as another instance would take it. One class for
// both servers, since every data source class declared is one an application has to include
const dataSourceClass: ReturnType<typeof createInMemoryDataSource> = createInMemoryDataSource({
    entities: defaultTestServerEntities,
    repositories: defaultTestServerRepositories
});

/**
 * Starts an application with a single worker.
 * @param jobClaimInMs - How long a claim on a job lasts.
 * @returns The started server.
 */
async function startWithClaim(jobClaimInMs: number): Promise<StartedTestServer> {
    return await startTestServer({
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
                    jobClaimInMs,
                    maxAttempts: 3,
                    workerResourceLimits: {},
                    enableTsWorkerFiles: false
                }
            }),
            defineProvider({ token: ZIBRI_DI_TOKENS.MULTITHREADING_SERVICE, useClass: MultithreadingService })
        ]
    });
}

/**
 * Does what another instance does once the claim on a job lapsed: takes it, and starts the job again.
 * @param id - The job to take over.
 * @returns The row as the taker wrote it.
 */
async function takeOver(id: string): Promise<AnyThreadJobEntity> {
    const leases: Repository<Lease> = inject(repositoryTokenFor(Lease));
    const jobs: Repository<AnyThreadJobEntity> = inject(repositoryTokenFor(ThreadJobEntity));
    await leases.deleteAll({ key: `thread-job:${id}` });
    await leases.create({ key: `thread-job:${id}`, expiresAt: new Date(Date.now() + Ms.MINUTE), heldBy: 'another-instance' });
    return await jobs.updateById(id, {
        startedAtMs: Date.now(),
        threadId: TAKER_THREAD_ID,
        progress: 0,
        attempts: 2
    });
}

/**
 * Checks that the row still says what the taker wrote.
 * @param id - The job that was taken over.
 * @param takenOver - The row as the taker wrote it.
 */
async function expectOwnedByTaker(id: string, takenOver: AnyThreadJobEntity): Promise<void> {
    const afterwards: AnyThreadJobEntity = await inject(repositoryTokenFor(ThreadJobEntity)).findById(id);
    expect(afterwards.status).toBe(ThreadJobStatus.IN_PROGRESS);
    expect(afterwards.threadId).toBe(TAKER_THREAD_ID);
    expect(afterwards.startedAtMs).toBe(takenOver.startedAtMs);
    expect(afterwards.progress).toBe(0);
    expect(afterwards.attempts).toBe(2);
}

describe('MultithreadingService, losing the claim on a running job', () => {
    let server: StartedTestServer;
    let multithreadingService: MultithreadingServiceInterface;
    let jobs: Repository<AnyThreadJobEntity>;

    beforeAll(async () => {
        server = await startWithClaim(JOB_CLAIM_IN_MS);
        multithreadingService = inject(ZIBRI_DI_TOKENS.MULTITHREADING_SERVICE);
        jobs = inject(repositoryTokenFor(ThreadJobEntity));
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    it('stops its worker and writes nothing more to the row, which the instance that took the job over owns now', async () => {
        const id: string = await multithreadingService.queueThreadJob({ workerData: { filePath: endlessWorker } });
        await waitUntil(async () => (await jobs.findById(id)).progress > 0, Ms.SECOND * 10);
        const takenOver: AnyThreadJobEntity = await takeOver(id);

        // long enough for the next renewal to find the claim gone, and for a worker that was not
        // stopped to report progress several times over
        await sleep(JOB_CLAIM_IN_MS * 2);

        await expectOwnedByTaker(id, takenOver);

        // the pool is a single worker, so the next job only runs once the stopped one was replaced
        const next: AnyThreadJobEntity = await multithreadingService.runThreadJob({
            workerData: { filePath: computingWorker, amount: 10 } as BaseThreadJobWorkerData
        });
        expect(next.status).toBe(ThreadJobStatus.COMPLETED);
        expect(next.result).toBe(55);
    }, 30000);
});

describe('MultithreadingService, losing the claim on a running job before its next renewal', () => {
    let server: StartedTestServer;
    let multithreadingService: MultithreadingServiceInterface;
    let jobs: Repository<AnyThreadJobEntity>;

    beforeAll(async () => {
        // a claim renewed every twenty seconds, so no renewal falls inside the test: the instance goes
        // on believing it holds the claim, which is the window between a takeover and a renewal
        // noticing it that every instance has
        server = await startWithClaim(Ms.MINUTE);
        multithreadingService = inject(ZIBRI_DI_TOKENS.MULTITHREADING_SERVICE);
        jobs = inject(repositoryTokenFor(ThreadJobEntity));
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    it('writes nothing to the row the instance that took the job over owns, not even while it shuts down', async () => {
        const id: string = await multithreadingService.queueThreadJob({ workerData: { filePath: endlessWorker } });
        await waitUntil(async () => (await jobs.findById(id)).progress > 0, Ms.SECOND * 10);
        const takenOver: AnyThreadJobEntity = await takeOver(id);

        // the worker reports every 100 milliseconds
        await sleep(500);
        await expectOwnedByTaker(id, takenOver);

        // shutting down marks the jobs it was running as interrupted, which for this one would hand
        // the job of a live instance to the next one to look. The class rather than the token, which
        // types it without the hook. One instance either way
        const shuttingDown: MultithreadingService = inject(MultithreadingService);
        expect(shuttingDown).toBe(multithreadingService);
        await shuttingDown.onAppShutdown();
        await expectOwnedByTaker(id, takenOver);
    }, 30000);
});