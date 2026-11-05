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
import { ThreadJobCheckpoint } from '../models/thread-job-checkpoint.model';
import { ThreadJobEntity } from '../models/thread-job-entity.model';
import { ThreadJobStatus } from '../models/thread-job-status.enum';

// a job taken over ran again from the
// beginning, with nothing of how far it had got kept

/**
 * A thread job row as the repository hands it back.
 */
type AnyThreadJobEntity = ThreadJobEntity<BaseThreadJobWorkerData | BaseFunctionThreadJobWorkerData<unknown>, unknown>;

const JOB_CLAIM_IN_MS: number = 600;

const checkpointingWorker: FsPath = FsUtilities.getPath(__dirname, 'multithreading.service.checkpoint.test.worker.js');
const checkpointOnceWorker: FsPath = FsUtilities.getPath(__dirname, 'multithreading.service.checkpoint-once.test.worker.js');

// in memory, so that the claim can be taken away as another instance would take it
const dataSourceClass: ReturnType<typeof createInMemoryDataSource> = createInMemoryDataSource({
    entities: defaultTestServerEntities,
    repositories: defaultTestServerRepositories
});

describe('MultithreadingService, checkpoints', () => {
    let server: StartedTestServer;
    let multithreadingService: MultithreadingServiceInterface;
    let jobs: Repository<AnyThreadJobEntity>;
    let leases: Repository<Lease>;

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
                        jobClaimInMs: JOB_CLAIM_IN_MS,
                        maxAttempts: 5,
                        workerResourceLimits: {},
                        enableTsWorkerFiles: false
                    }
                }),
                defineProvider({ token: ZIBRI_DI_TOKENS.MULTITHREADING_SERVICE, useClass: MultithreadingService })
            ]
        });
        multithreadingService = inject(ZIBRI_DI_TOKENS.MULTITHREADING_SERVICE);
        jobs = inject(repositoryTokenFor(ThreadJobEntity));
        leases = inject(repositoryTokenFor(Lease));
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    it('resumes a job taken over from the last checkpoint stored, which the run that lost it cannot overwrite', async () => {
        const id: string = await multithreadingService.queueThreadJob({ workerData: { filePath: checkpointingWorker } });
        await waitUntil(async () => ((await jobs.findById(id)).checkpoint?.number ?? 0) >= 2, Ms.SECOND * 10);

        // what another instance does once the claim lapsed: takes it, and starts the job again
        await leases.deleteAll({ key: `thread-job:${id}` });
        await leases.create({ key: `thread-job:${id}`, expiresAt: new Date(Date.now() + Ms.MINUTE), heldBy: 'another-instance' });
        const takenOver: AnyThreadJobEntity = await jobs.updateById(id, { startedAtMs: Date.now(), threadId: 4242, attempts: 2 });
        const stored: ThreadJobCheckpoint<unknown> | null | undefined = takenOver.checkpoint;
        expect(stored?.state).toEqual({ next: stored?.number });

        // long enough for the run that lost the job to have tried storing several more, and to stop
        await sleep(JOB_CLAIM_IN_MS * 2);
        expect((await jobs.findById(id)).checkpoint).toEqual(stored);

        // and the instance that took it over stops existing in turn
        await leases.deleteAll({ key: `thread-job:${id}` });
        await jobs.updateById(id, { status: ThreadJobStatus.INTERRUPTED, threadId: null });
        await multithreadingService.startQueuedJobs();

        await waitUntil(async () => (await jobs.findById(id)).attempts === 3, Ms.SECOND * 10);
        // the progress of the checkpoint the run starts from, rather than nothing
        expect((await jobs.findById(id)).progress).toBe(stored?.progress);

        const done: AnyThreadJobEntity = await multithreadingService.waitForThreadJob(id);
        expect(done.status).toBe(ThreadJobStatus.COMPLETED);
        expect(done.result).toEqual({ resumed: stored, jobId: id, idempotencyKey: `${id}:${stored?.number}:mail` });
    }, 30000);

    it('starts a requeued job from the beginning, or from its checkpoint when asked to keep it', async () => {
        const first: AnyThreadJobEntity = await multithreadingService.runThreadJob({ workerData: { filePath: checkpointOnceWorker } });
        expect(first.status).toBe(ThreadJobStatus.COMPLETED);
        expect(first.result).toEqual({ resumed: null, idempotencyKey: `${first.id}:1:mail` });
        const stored: ThreadJobCheckpoint<unknown> = { progress: 50, state: { half: 'done' }, number: 1 };
        expect((await jobs.findById(first.id)).checkpoint).toEqual(stored);

        const fromTheBeginning: AnyThreadJobEntity = await multithreadingService.rerunThreadJob(first.id);
        expect(fromTheBeginning.result).toEqual({ resumed: null, idempotencyKey: `${first.id}:1:mail` });

        const resumed: AnyThreadJobEntity = await multithreadingService.rerunThreadJob(first.id, undefined, { keepCheckpoint: true });
        // the work after the checkpoint runs again under the key it had before
        expect(resumed.result).toEqual({ resumed: stored, idempotencyKey: `${first.id}:1:mail` });
    }, 30000);
});