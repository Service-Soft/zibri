import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MultithreadingServiceInterface } from './multithreading-service.interface.ts';
import { MultithreadingService, PersistedFunctionJobError } from './multithreading.service.ts';
import { ThreadJobWorker } from './thread-job-worker.ts';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers.ts';
import { startAndStopTestServerWithout } from '../../__testing__/test-server/start-and-stop-test-server-without.function.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { waitUntil } from '../../__testing__/wait-until.function.ts';
import { Repository } from '../../data-source/repository/repository.ts';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../di/inject.function.ts';
import { defineProvider } from '../../di/models/di-provider.model.ts';
import { CreateLeaseData, Lease } from '../../leases/lease.model.ts';
import { FsPath, FsUtilities } from '../../utilities/fs.utilities.ts';
import { Ms } from '../../utilities/ms.ts';
import { BaseFunctionThreadJobWorkerData, BaseThreadJobWorkerData } from '../models/base-thread-job-worker-data.model.ts';
import { MultithreadingOptions } from '../models/multithreading-options.model.ts';
import { ThreadJobEntity } from '../models/thread-job-entity.model.ts';
import { ThreadJobStatus } from '../models/thread-job-status.enum.ts';

let multithreadingService: MultithreadingServiceInterface;
let server: StartedTestServer;

/**
 * Refuses to run against a worker build that is older than the worker source.
 *
 * `MultithreadingService` starts its workers from `dist`, because that is what a consumer of the
 * published package runs. CI builds before it tests, so it is always looking at the current worker;
 * a local `npm run test:normal` does not, so an edit to anything under `worker/` is tested by
 * running the *previous* build of it. Nothing fails - the tests pass, against the old code.
 * @throws When the built worker is older than the newest file the worker is built from.
 */
function validateWorkerBuildIsCurrent(): void {
    const builtWorker: string = path.join(
        import.meta.dirname, '..', '..', '..', 'dist', 'multithreading', 'services', 'worker', 'thread-job.worker.js'
    );
    const sourceDir: string = path.join(import.meta.dirname, 'worker');
    const newestSource: number = readdirSync(sourceDir)
        .map(f => statSync(path.join(sourceDir, f)).mtimeMs)
        .reduce((acc, m) => Math.max(acc, m), 0);

    if (!existsSync(builtWorker) || statSync(builtWorker).mtimeMs < newestSource) {
        throw new Error(
            'The built thread job worker is older than its source, so these tests would run against the previous build.'
            + ' Run "npm run build -w zibri" first.'
        );
    }
}

/**
 * A thread job row as the repository actually hands it back.
 *
 * The entity is generic over its worker data and the token is not, so what `repositoryTokenFor`
 * resolves to is the union - narrowing it at the call site is the assignment TypeScript refuses.
 */
type AnyThreadJobEntity = ThreadJobEntity<BaseThreadJobWorkerData | BaseFunctionThreadJobWorkerData<unknown>, unknown>;

/**
 * The repository for {@link AnyThreadJobEntity}.
 */
type ThreadJobRepository = Repository<AnyThreadJobEntity>;

/**
 * How much work a job that has to still be running when the next line executes is given.
 *
 * The pool here is a single worker, which is the only arrangement in which the queue's order is
 * observable at all - with two workers the second job starts rather than waits. That makes every
 * test below depend on the first job outlasting the ones queued behind it, so it is given enough to
 * do that a database insert cannot overtake it. The tests assert that premise rather than trusting
 * it, because a blocker that finished early would make them pass without having tested anything.
 */
const blockingAmount: number = 38;

// first, for the reason on startAndStopTestServerWithout
describe('MultithreadingService — starting', () => {
    it('refuses to start without ThreadJobEntity, and names it', async () => {
        const start: Promise<void> = startAndStopTestServerWithout([ThreadJobEntity], {
            // the harness stubs the pool
            providers: [
                ...defaultTestServerProviders,
                defineProvider({ token: ZIBRI_DI_TOKENS.MULTITHREADING_SERVICE, useClass: MultithreadingService })
            ]
        });

        await expect(start).rejects.toThrow(/Error initializing MultithreadingService[\S\s]*ThreadJobEntity/);
    }, 30000);
});

describe('MultithreadingService', () => {
    beforeAll(async () => {
        validateWorkerBuildIsCurrent();
        server = await startTestServer({
            providers: [
                ...defaultTestServerProviders,
                defineProvider({
                    token: ZIBRI_DI_TOKENS.MULTITHREADING_OPTIONS,
                    // kept minimal (1 thread, no dedicated priority worker) so this also works on
                    // CI runners that may only expose a single CPU thread
                    useValue: {
                        maxThreads: 1,
                        maxPriorityThreads: 0,
                        defaultTimeoutMs: Ms.HOUR,
                        defaultTimeoutPriorityMs: Ms.MINUTE * 5,
                        jobClaimInMs: Ms.SECOND * 30,
                        enableTsWorkerFiles: true
                    }
                }),
                defineProvider({
                    token: ZIBRI_DI_TOKENS.MULTITHREADING_SERVICE,
                    useClass: MultithreadingService
                })
            ]
        });
        multithreadingService = inject(ZIBRI_DI_TOKENS.MULTITHREADING_SERVICE);
    }, 30000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    it('can run a ts worker file', async () => {
        const filePath: FsPath = FsUtilities.getPath(import.meta.dirname, 'multithreading.service.test.worker.ts');
        const res: ThreadJobEntity<{ filePath: FsPath }, unknown> = await multithreadingService.runThreadJob({ workerData: { filePath, amount: 40 } });
        expect(res.result).toEqual(102334155);
    });

    it('can run a js worker file', async () => {
        const filePath: FsPath = FsUtilities.getPath(import.meta.dirname, 'multithreading.service.test.worker.cjs');
        const res: ThreadJobEntity<{ filePath: FsPath }, unknown> = await multithreadingService.runThreadJob({ workerData: { filePath, amount: 40 } });
        expect(res.result).toEqual(102334155);
    });

    it('refuses a ts worker file when the deployment said it ships compiled ones', async () => {
        const filePath: FsPath = FsUtilities.getPath(import.meta.dirname, 'multithreading.service.test.worker.ts');
        const options: MultithreadingOptions = inject(ZIBRI_DI_TOKENS.MULTITHREADING_OPTIONS);

        options.enableTsWorkerFiles = false;
        try {
            // in the caller's own stack, before a row is written. The alternative is a queued job
            // that fails inside a worker thread whenever it happens to be picked up, for a reason
            // nothing about the call that queued it could show.
            await expect(multithreadingService.queueThreadJob({ workerData: { filePath, amount: 1 } }))
                .rejects.toThrow('enableTsWorkerFiles is false');
        }
        finally {
            options.enableTsWorkerFiles = true;
        }
    });

    it('can run an es module worker file, twice on the same thread', async () => {
        const filePath: FsPath = FsUtilities.getPath(import.meta.dirname, 'multithreading.service.esm.test.worker.mjs');

        const first: ThreadJobEntity<{ filePath: FsPath }, unknown> = await multithreadingService.runThreadJob({
            workerData: { filePath, amount: 21 }
        });
        expect(first.result).toEqual(42);

        // the second job is the whole point. A thread job is the top level code of the file it
        // names, and one thread runs many jobs - so the file has to be evaluated again every time.
        // An es module cannot be dropped from the module cache the way a commonjs one is, so this
        // job used to be handed a module that had already run: nothing was reported, and it sat
        // there until its timeout while the first job had worked perfectly.
        const second: ThreadJobEntity<{ filePath: FsPath }, unknown> = await multithreadingService.runThreadJob({
            workerData: { filePath, amount: 50 },
            timeout: Ms.SECOND * 10
        });
        expect(second.result).toEqual(100);
    }, 30000);

    it('marks the job as FAILED with the propagated error when the worker file throws synchronously', async () => {
        const filePath: FsPath = FsUtilities.getPath(import.meta.dirname, 'multithreading.service.throwing.test.worker.ts');
        const res: ThreadJobEntity<BaseThreadJobWorkerData, unknown> = await multithreadingService.runThreadJob({ workerData: { filePath } });

        expect(res.status).toBe(ThreadJobStatus.FAILED);
        expect(res.error?.paragraphs.join('\n')).toContain('worker fixture: intentional failure');
    }, 15000);

    it('marks the job as FAILED and recovers a fresh worker when the worker thread crashes outright', async () => {
        const filePath: FsPath = FsUtilities.getPath(import.meta.dirname, 'multithreading.service.crashing.test.worker.ts');
        const res: ThreadJobEntity<BaseThreadJobWorkerData, unknown> = await multithreadingService.runThreadJob({ workerData: { filePath } });

        expect(res.status).toBe(ThreadJobStatus.FAILED);

        // the pool should have recovered a replacement worker and still be able to run further jobs
        const followUpFilePath: FsPath = FsUtilities.getPath(import.meta.dirname, 'multithreading.service.test.worker.ts');
        const followUp: ThreadJobEntity<{ filePath: FsPath }, unknown> = await multithreadingService.runThreadJob({
            workerData: { filePath: followUpFilePath, amount: 10 }
        });
        expect(followUp.status).toBe(ThreadJobStatus.COMPLETED);
        expect(followUp.result).toEqual(55);
    }, 15000);

    it('replaces a worker that died while idle, instead of handing the corpse to the next job', async () => {
        const service: MultithreadingService = multithreadingService as MultithreadingService;
        const idleWorkers: ThreadJobWorker[] = service['idleWorkers'];
        expect(idleWorkers.length).toBeGreaterThan(0);

        // a worker killed for its memory, or by a native crash, while holding no job. Nothing
        // completes, so the path that recovers a crashed worker - which runs off job completion -
        // never runs, and the dead thread used to stay in the idle list
        await idleWorkers[0]?.worker.terminate();
        await new Promise<void>(resolve => {
            setTimeout(resolve, 500);
        });

        const filePath: FsPath = FsUtilities.getPath(import.meta.dirname, 'multithreading.service.test.worker.ts');
        const res: ThreadJobEntity<{ filePath: FsPath }, unknown> = await multithreadingService.runThreadJob({
            workerData: { filePath, amount: 10 },
            // without the replacement this posts to a terminated thread and waits for an answer that
            // cannot come. A short timeout is what makes that a failing test rather than a hanging
            // one - the real default is an hour, which is how the pool dies quietly in production
            timeout: Ms.SECOND * 10
        });

        expect(res.status).toBe(ThreadJobStatus.COMPLETED);
        expect(res.result).toEqual(55);
    }, 30000);

    it('fails the job with a timeout error when it does not complete in time', async () => {
        const filePath: FsPath = FsUtilities.getPath(import.meta.dirname, 'multithreading.service.test.worker.ts');
        const res: ThreadJobEntity<{ filePath: FsPath }, unknown> = await multithreadingService.runThreadJob({
            workerData: { filePath, amount: 45 },
            timeout: 1
        });

        expect(res.status).toBe(ThreadJobStatus.FAILED);
        expect(res.error?.name).toBe('TimeoutError');
    }, 15000);

    it('requeueThreadJob resets and reruns a completed job to completion again', async () => {
        const filePath: FsPath = FsUtilities.getPath(import.meta.dirname, 'multithreading.service.test.worker.ts');
        const jobId: string = await multithreadingService.queueThreadJob({ workerData: { filePath, amount: 10 } });
        const first: ThreadJobEntity<{ filePath: FsPath }, unknown> = await multithreadingService.waitForThreadJob(jobId);
        expect(first.status).toBe(ThreadJobStatus.COMPLETED);
        expect(first.result).toEqual(55);

        const rerun: ThreadJobEntity<{ filePath: FsPath }, unknown> = await multithreadingService.rerunThreadJob(jobId);
        expect(rerun.status).toBe(ThreadJobStatus.COMPLETED);
        expect(rerun.result).toEqual(55);
    }, 15000);

    it('reportProgress updates the job entity progress while the worker is still running', async () => {
        const filePath: FsPath = FsUtilities.getPath(import.meta.dirname, 'multithreading.service.progress.test.worker.ts');
        const jobId: string = await multithreadingService.queueThreadJob({ workerData: { filePath } });

        const threadJobRepo: ThreadJobRepository = inject(repositoryTokenFor(ThreadJobEntity));

        // polled rather than slept: before there is anything to read, the job has to be picked up, a
        // worker thread has to start and - for a typescript worker file - a compiler has to start
        // inside it. None of that is a fixed cost, so a fixed wait is either slower than it needs to
        // be or fails on a loaded machine, which is what it did. Giving up as soon as the job
        // completes rather than only at the deadline, so a missed window is reported as the 100 it
        // actually read instead of ten seconds later.
        const deadline: number = Date.now() + (Ms.SECOND * 10);
        let midFlight: AnyThreadJobEntity = await threadJobRepo.findById(jobId);
        while (midFlight.progress !== 50 && midFlight.status !== ThreadJobStatus.COMPLETED && Date.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, 25));
            midFlight = await threadJobRepo.findById(jobId);
        }

        expect(midFlight.progress).toBe(50);
        expect(midFlight.status).toBe(ThreadJobStatus.IN_PROGRESS);

        const completed: ThreadJobEntity<BaseThreadJobWorkerData, unknown> = await multithreadingService.waitForThreadJob(jobId);
        expect(completed.status).toBe(ThreadJobStatus.COMPLETED);
        expect(completed.progress).toBe(100);
        expect(completed.result).toBe('done');
    }, 15000);

    it('reportError marks the job as FAILED with the reported error', async () => {
        const filePath: FsPath = FsUtilities.getPath(import.meta.dirname, 'multithreading.service.report-error.test.worker.ts');
        const res: ThreadJobEntity<BaseThreadJobWorkerData, unknown> = await multithreadingService.runThreadJob({ workerData: { filePath } });

        expect(res.status).toBe(ThreadJobStatus.FAILED);
        expect(res.error?.paragraphs.join('\n')).toContain('worker fixture: reported via reportError()');
    }, 15000);

    it('refuses to queue a job that carries a function rather than a file', async () => {
        // the types say this already; what the check is for is the caller who is not reading them.
        // A queued job is written to a row and read back by requeue, so source arriving here is
        // source the worker would rebuild from the database - and write access to that table would
        // be enough to run code in a worker.
        const functionWorkerData: BaseThreadJobWorkerData = {
            func: '() => 1 + 1',
            input: undefined
        } as unknown as BaseThreadJobWorkerData;

        await expect(multithreadingService.queueThreadJob({ workerData: functionWorkerData }))
            .rejects.toThrow(PersistedFunctionJobError);

        // and the way to run a function is still there, because it never leaves this process
        await expect(multithreadingService.run((n: number) => n + 1, 41)).resolves.toBe(42);
    }, 15000);

    it('gives a rebuilt function nothing but its input, rather than the worker it landed in', async () => {
        // only the source crosses the thread boundary, so this capture does not - the name is all
        // that survives. `message` is deliberately a name the worker module has one of: a
        // module-level `const message: ThreadJobMessage = { type: 'initialization' }`. A direct eval
        // ran the source in that scope and would have found it, resolving to 'initialization' with
        // nothing to say anything had gone wrong. Rebuilt outside that scope the name is simply
        // absent, which is the error it always should have been.
        const message: { type: string } = { type: 'from the test' };

        // a real Error, not the flattened shape the row stores - `rejects.toThrow` is exactly the
        // assertion a caller would write, and it only counts a rejection that is an Error instance
        await expect(multithreadingService.run(() => message.type, undefined))
            .rejects.toThrow(/message is not defined/);

        // what it does get is what was passed to it
        await expect(multithreadingService.run((input: { a: number, b: number }) => input.a * input.b, { a: 6, b: 7 }))
            .resolves.toBe(42);
    }, 15000);

    it('gives the worker the job that has waited longest, not the one that just arrived', async () => {
        const filePath: FsPath = FsUtilities.getPath(import.meta.dirname, 'multithreading.service.test.worker.ts');
        const threadJobRepo: ThreadJobRepository = inject(repositoryTokenFor(ThreadJobEntity));

        // takes the only worker and keeps it, so everything queued after it has to wait
        const blockingId: string = await multithreadingService.queueThreadJob({ workerData: { filePath, amount: blockingAmount } });

        const completionOrder: number[] = [];
        const waitingIds: string[] = [];
        for (let i: number = 0; i < 3; i++) {
            waitingIds.push(await multithreadingService.queueThreadJob({
                workerData: { filePath, amount: 10 },
                onComplete: () => completionOrder.push(i)
            }));
        }

        // the premise, asserted rather than assumed: if the blocker had already finished, these
        // would have run one at a time as they arrived and their order would say nothing
        const waitingStatuses: ThreadJobStatus[] = await Promise.all(
            waitingIds.map(async id => (await threadJobRepo.findById(id)).status)
        );
        expect(waitingStatuses).toEqual([ThreadJobStatus.IN_QUEUE, ThreadJobStatus.IN_QUEUE, ThreadJobStatus.IN_QUEUE]);

        await waitUntil(() => completionOrder.length === 3, 30000);
        await waitUntil(async () => (await threadJobRepo.findById(blockingId)).status === ThreadJobStatus.COMPLETED, 30000);

        // oldest first. Selected newest first, the third job runs the moment a worker frees up and
        // the first one queued is passed over again by every job that arrives after it - so under
        // submission that does not stop, it never runs at all
        expect(completionOrder).toEqual([0, 1, 2]);
    }, 60000);

    it('orders a function job against the queued ones rather than before or after them', async () => {
        const filePath: FsPath = FsUtilities.getPath(import.meta.dirname, 'multithreading.service.test.worker.ts');

        // a function job cannot be stored - it exists only in this process - while a queued job
        // exists only as a row. They are still queued against the same single worker, so the one
        // that has waited longer goes first whichever of the two lists it is waiting in.
        await multithreadingService.queueThreadJob({
            workerData: { filePath, amount: blockingAmount },
            priority: true
        });

        const order: string[] = [];

        // the row goes first, and the function job a moment later. That way round on purpose: a
        // function job waits in this process, so an implementation that simply serves what it can
        // see locally before it looks at the table would pass the other way round without ordering
        // anything
        const queuedJob: Promise<void> = (async () => {
            await multithreadingService.runThreadJob({ workerData: { filePath, amount: 10 }, priority: true });
            order.push('queued');
        })();
        await new Promise<void>(resolve => {
            setTimeout(resolve, 50);
        });
        const functionJob: Promise<number> = (async () => {
            // busy for long enough that the order cannot come down to which of the two promises
            // resolves faster once its job is over - the queued one has a row to read back, so a
            // function that returned instantly would be reported first having run second
            const result: number = await multithreadingService.run(
                (n: number) => {
                    const until: number = Date.now() + 200;
                    while (Date.now() < until) {
                        // deliberately busy: this runs on a worker thread
                    }
                    return n + 1;
                },
                41
            );
            order.push('function');
            return result;
        })();

        await expect(functionJob).resolves.toBe(42);
        await queuedJob;

        expect(order).toEqual(['queued', 'function']);
    }, 60000);

    it('leaves a job alone while another instance is still holding its claim', async () => {
        const threadJobRepo: ThreadJobRepository = inject(repositoryTokenFor(ThreadJobEntity));
        const leaseRepo: Repository<Lease, CreateLeaseData> = inject(repositoryTokenFor(Lease));
        const filePath: FsPath = FsUtilities.getPath(import.meta.dirname, 'multithreading.service.test.worker.ts');

        // a row that says a job is being worked on. Which is all it says: an instance that is
        // running this and one that was killed while running it leave exactly the same row, and no
        // amount of reading it can tell them apart
        const workerData: BaseThreadJobWorkerData & { amount: number } = { filePath, amount: 10 };
        const heldByAnother: AnyThreadJobEntity = await threadJobRepo.create({
            queuedAtMs: Date.now() - Ms.MINUTE,
            startedAtMs: Date.now() - Ms.MINUTE,
            status: ThreadJobStatus.IN_PROGRESS,
            priority: false,
            progress: 50,
            // long since expired, and deliberately so: the timeout used to be what decided this, and
            // by that rule this job would be taken over right now
            timeout: Ms.SECOND,
            workerData
        });

        // what actually says somebody has it. Written directly, because the instance holding it is
        // supposed to be a different process - one that is alive, and is therefore renewing it
        await leaseRepo.create({
            key: `thread-job:${heldByAnother.id}`,
            expiresAt: new Date(Date.now() + (Ms.MINUTE * 5)),
            heldBy: 'another-instance'
        });

        await multithreadingService.startQueuedJobs();
        await new Promise<void>(resolve => {
            setTimeout(resolve, 500);
        });

        // untouched: not restarted, not marked as this instance's, not failed
        const afterwards: AnyThreadJobEntity = await threadJobRepo.findById(heldByAnother.id);
        expect(afterwards.status).toBe(ThreadJobStatus.IN_PROGRESS);
        expect(afterwards.progress).toBe(50);
        expect(afterwards.startedAtMs).toBe(heldByAnother.startedAtMs);

        // and once that instance is gone - its claim lapsed rather than renewed - the same job is
        // taken over, without its own timeout having anything to say about it
        await leaseRepo.deleteAll({ key: `thread-job:${heldByAnother.id}` });
        await multithreadingService.startQueuedJobs();
        await waitUntil(async () => (await threadJobRepo.findById(heldByAnother.id)).status === ThreadJobStatus.COMPLETED, 30000);
        expect((await threadJobRepo.findById(heldByAnother.id)).result).toEqual(55);
    }, 60000);

    // last in the file: it restarts the application, so everything above it is talking to the
    // container this replaces
    it('picks up work a previous run left behind, whether or not it had started', async () => {
        const threadJobRepo: ThreadJobRepository = inject(repositoryTokenFor(ThreadJobEntity));
        const filePath: FsPath = FsUtilities.getPath(import.meta.dirname, 'multithreading.service.test.worker.ts');
        const workerData: BaseThreadJobWorkerData & { amount: number } = { filePath, amount: 10 };

        // a row a process died holding. Its own timeout is deliberately an hour and nowhere near
        // spent: what makes it takeable is that no claim on it is being renewed, and a job that
        // still has time left is exactly the one an instance dying in the middle of leaves behind
        const abandoned: AnyThreadJobEntity = await threadJobRepo.create({
            queuedAtMs: Date.now() - Ms.MINUTE,
            startedAtMs: Date.now() - Ms.MINUTE,
            status: ThreadJobStatus.IN_PROGRESS,
            priority: false,
            progress: 50,
            timeout: Ms.HOUR,
            workerData
        });

        // and one that never started, from the same dead run
        const neverStarted: AnyThreadJobEntity = await threadJobRepo.create({
            queuedAtMs: Date.now() - Ms.MINUTE,
            status: ThreadJobStatus.IN_QUEUE,
            priority: false,
            progress: 0,
            timeout: Ms.HOUR,
            workerData
        });

        await server.reInit();
        // work is picked up on onAppStart, not onAppInit: a pod that comes up and never becomes
        // ready has no business working through the backlog
        await server.start();
        multithreadingService = inject(ZIBRI_DI_TOKENS.MULTITHREADING_SERVICE);

        const recoveredRepo: ThreadJobRepository = inject(repositoryTokenFor(ThreadJobEntity));
        await waitUntil(async () => (await recoveredRepo.findById(abandoned.id)).status === ThreadJobStatus.COMPLETED, 15000);
        await waitUntil(async () => (await recoveredRepo.findById(neverStarted.id)).status === ThreadJobStatus.COMPLETED, 15000);

        expect((await recoveredRepo.findById(abandoned.id)).result).toEqual(55);
        expect((await recoveredRepo.findById(neverStarted.id)).result).toEqual(55);
    }, 40000);

    it('replaces a worker that hit an uncaught exception instead of handing it the next job', async () => {
        const threadIdPath: FsPath = FsUtilities.getPath(import.meta.dirname, 'multithreading.service.thread-id.test.worker.ts');
        const before: ThreadJobEntity<BaseThreadJobWorkerData, number> = await multithreadingService.runThreadJob({
            workerData: { filePath: threadIdPath }
        });
        expect(before.status).toBe(ThreadJobStatus.COMPLETED);

        const filePath: FsPath = FsUtilities.getPath(import.meta.dirname, 'multithreading.service.uncaught.test.worker.ts');
        const failed: ThreadJobEntity<BaseThreadJobWorkerData, unknown> = await multithreadingService.runThreadJob({ workerData: { filePath } });

        // the error still reaches the job, which is why the worker reports before it exits - the
        // exit alone can only say that something went wrong, not what
        expect(failed.status).toBe(ThreadJobStatus.FAILED);
        expect(failed.error?.paragraphs.join('\n')).toContain('worker fixture: thrown where nothing can catch it');

        // and the thread it happened on is gone. Asserting that the *next* job merely runs proves
        // nothing: a worker that reports and carries on is still alive and still idle, so it takes
        // that job perfectly well - carrying whatever the throw left half done into it. The thread
        // id is what tells the two apart. The pool is one thread, so this is also the whole pool.
        const after: ThreadJobEntity<BaseThreadJobWorkerData, number> = await multithreadingService.runThreadJob({
            workerData: { filePath: threadIdPath }
        });
        expect(after.status).toBe(ThreadJobStatus.COMPLETED);
        expect(after.result).not.toBe(before.result);
    }, 30000);
});