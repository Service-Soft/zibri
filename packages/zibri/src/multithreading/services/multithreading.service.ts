import os from 'node:os';
// aliased because the global setTimeout is what schedules a job's own timeout further down, and a
// module that needs both cannot have them under one name
import { setTimeout as sleep } from 'node:timers/promises';
import { Worker } from 'node:worker_threads';

import { filter, firstValueFrom } from 'rxjs';

import { MultithreadingServiceInterface } from './multithreading-service.interface';
import { ThreadJob } from './thread-job';
import { ThreadJobWorker } from './thread-job-worker';
import { ZibriApplication } from '../../application/application';
import { AlsUtilities } from '../../context/als.utilities';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { Inject } from '../../di/decorators/inject.decorator';
import { Injectable } from '../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { InternalError } from '../../error-handling/internal-error.model';
import { OnAppInit } from '../../global/on-app-init.interface';
import { OnAppShutdown } from '../../global/on-app-shutdown.interface';
import { OnAppStart } from '../../global/on-app-start.interface';
import { KnownHeader } from '../../http/known-header.enum';
import { type LeaseServiceInterface } from '../../leases/lease-service.interface';
import { errorToLoggedError } from '../../logging/error-to-logged-error.function';
import { LoggedError } from '../../logging/logged-error.model';
import { type LoggerInterface } from '../../logging/logger.interface';
import { type TenantServiceInterface } from '../../tenancy/tenant-service.interface';
import { TraceContextUtilities } from '../../tracing/trace-context.utilities';
import { TraceSpanContext } from '../../tracing/trace-span-context.model';
import { TraceSpanKind } from '../../tracing/trace-span-kind.enum';
import { TraceSpanStatus } from '../../tracing/trace-span-status.enum';
import { TraceSpanInterface } from '../../tracing/trace-span.interface';
import { TracingUtilities } from '../../tracing/tracing.utilities';
import { OmitStrict } from '../../types/omit-strict.type';
import { FsUtilities, type FsPath } from '../../utilities/fs.utilities';
import { JsonUtilities } from '../../utilities/json.utilities';
import { PromiseUtilities, TimeoutError } from '../../utilities/promise.utilities';
import { isTsNodeInstalled, needsTsNode } from '../../utilities/register-ts-node.function';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { validateEntitiesRegistered } from '../../utilities/validate-entities-registered.function';
import { BaseFunctionThreadJobWorkerData, BaseThreadJobWorkerData } from '../models/base-thread-job-worker-data.model';
import { type MultithreadingOptions } from '../models/multithreading-options.model';
import { ThreadJobData, ThreadJobDataFunctions } from '../models/thread-job-data.model';
import { ThreadJobEntity } from '../models/thread-job-entity.model';
import { ThreadJobFunction } from '../models/thread-job-function.model';
import { ThreadJobMessage } from '../models/thread-job-message.model';
import { ThreadJobStartMessage } from '../models/thread-job-start-message.model';
import { ThreadJobStatus } from '../models/thread-job-status.enum';
import { RunQueuedThreadJobsCronJob } from '../run-queued-thread-jobs.cron-job';

/**
 * An error to throw during multithreading service initialization.
 */
class InitMultithreadingServiceError extends InternalError {
    constructor(message: string | string[]) {
        const messageArray: string[] = typeof message === 'string' ? [message] : message;
        super(['Error initializing multithreading service.', ...messageArray]);
        this.name = 'InitMultithreadingServiceError';
    }
}

/**
 * An error for a function handed to the path that persists its job.
 */
export class PersistedFunctionJobError extends InternalError {
    constructor() {
        super([
            'A queued thread job cannot carry a function.',
            'Queueing writes the job to a row and `requeueThreadJob` reads it back, so a function would',
            'have to be stored as source and turned back into code to run a second time - which makes',
            'write access to that table enough to run code in a worker.',
            'Use `run(fn, input)` for a function, which keeps the job in this process and never stores it,',
            'or move the work into a file and queue it by `filePath` if the job has to survive a restart.'
        ]);
        this.name = 'PersistedFunctionJobError';
    }
}

/**
 * How many waiting rows are considered for one free worker before giving up for this round.
 *
 * More than one because the oldest row may already be claimed by another instance, and the answer to
 * that is the next one rather than an idle worker. Bounded because every one of them is a claim
 * attempt, and a round that tries hundreds is a round that holds a worker idle while it does.
 */
const CANDIDATE_BATCH_SIZE: number = 10;

/**
 * How often the row is re-read while waiting for a job that is running somewhere else.
 */
const REMOTE_JOB_POLL_INTERVAL_IN_MS: number = 100;

/**
 * The statuses a job can be taken over in.
 *
 * `IN_PROGRESS` is in the list on purpose. It means an instance was running the job, and nothing on
 * the row says whether that instance still exists - so the row alone cannot answer it. The claim
 * does: a live owner renews it, and one that stopped existing lets it lapse.
 */
const CLAIMABLE_STATUSES: ThreadJobStatus[] = [
    ThreadJobStatus.IN_QUEUE,
    ThreadJobStatus.INTERRUPTED,
    ThreadJobStatus.IN_PROGRESS
];

/**
 * The statuses that mean the job is over, however it ended.
 */
const TERMINAL_STATUSES: ThreadJobStatus[] = [
    ThreadJobStatus.COMPLETED,
    ThreadJobStatus.FAILED,
    ThreadJobStatus.CANCELLED
];

/**
 * Names the claim on one job. Prefixed, because the key space is shared with every other lease.
 * @param jobId - The job being claimed.
 * @returns The lease key.
 */
function claimKeyFor(jobId: string): string {
    return `thread-job:${jobId}`;
}

/**
 * One thing that could be given to a free worker, whichever list it came out of.
 *
 * A function job never leaves this process and a queued job only exists as a row, so the two cannot
 * live in one list - but they are queued against the same pool and have to be ordered against each
 * other. This is the union that ordering happens over.
 */
type JobCandidate
    = | {
        /**
         * When the job was queued, which is what the two kinds are ordered by.
         */
        queuedAtMs: number,
        /**
         * A function job, waiting in this process.
         */
        job: ThreadJob<BaseFunctionThreadJobWorkerData<unknown>, unknown>
    }
    | {
        // eslint-disable-next-line jsdoc/require-jsdoc
        queuedAtMs: number,
        /**
         * A queued job, as it is stored. Still has to be claimed.
         */
        entity: ThreadJobEntity<BaseThreadJobWorkerData | BaseFunctionThreadJobWorkerData<unknown>, unknown>
    };

/**
 * Refuses worker data that carries a function where only a file path belongs.
 * @param workerData - The worker data to check.
 * @throws A PersistedFunctionJobError when the data carries stringified source.
 */
function validateNotAFunctionJob(workerData: BaseThreadJobWorkerData): void {
    if ('func' in workerData) {
        throw new PersistedFunctionJobError();
    }
}

/**
 * Turns the error a worker reported back into a real one.
 *
 * The worker reports a `LoggedError`, because an `Error`'s own fields are not enumerable and would
 * be lost the moment the message crosses the thread boundary or the row is written. That shape is
 * right for the column and wrong for a caller, who asked for a function to run and expects to catch
 * what the signature promises - so it is rebuilt on the way out.
 * @param reported - The stored error.
 * @returns An Error carrying the same name, message and stack.
 */
function toThrownError(reported: LoggedError): Error {
    const error: Error = new Error(reported.paragraphs.join('\n'));
    error.name = reported.name;
    error.stack = reported.stackTrace.join('\n');
    return error;
}

/**
 * A service that handles multithreading.
 */
@Injectable({ register: 'onUse' })
export class MultithreadingService implements MultithreadingServiceInterface, OnAppInit, OnAppStart, OnAppShutdown {
    /**
     * The jobs this process's workers are running right now.
     *
     * Not the queue. What is waiting for a worker lives in the data source, where every instance can
     * see it - this is only what has been claimed and handed to a thread here, which is what an
     * incoming worker message has to be matched against.
     */
    private runningJobs: ThreadJob<BaseThreadJobWorkerData | BaseFunctionThreadJobWorkerData<unknown>, unknown>[] = [];
    /**
     * The function jobs waiting for a worker.
     *
     * The one thing that cannot be put in the data source: a function can only be stored as source,
     * and source read back out of a table and rebuilt is write access to that table becoming code
     * execution. So a `run` call waits here, in the process that made it, and is ordered against the
     * queued jobs when a worker frees up rather than being served before or after them.
     */
    private localQueue: ThreadJob<BaseFunctionThreadJobWorkerData<unknown>, unknown>[] = [];
    /**
     * The callbacks handed in with a job, which the row cannot carry.
     *
     * Kept by job id until the job is over, and only for a job that actually asked for one. They
     * fire on the instance that queued the job if it is also the one that runs it - another instance
     * has no way to call into this process, and pretending otherwise by dropping them silently on
     * one path and firing them on the other would be worse than the rule being plain.
     */
    private readonly pendingFunctions: Map<string, ThreadJobDataFunctions> = new Map();
    /**
     * The round of handing work to free workers that is running, if one is.
     */
    private selectionRound: Promise<void> | undefined;
    /**
     * The worker messages, exits, errors and timeouts whose handling has not finished yet.
     */
    private readonly eventsInHandling: Set<Promise<void>> = new Set();
    /**
     * Whether something asked for another round while one was running.
     */
    private selectionRequested: boolean = false;
    /**
     * The workers that are currently running.
     */
    private workers: ThreadJobWorker[] = [];
    /**
     * The workers that are currently idle.
     */
    private idleWorkers: ThreadJobWorker[] = [];
    /**
     * Where the pool is in its life, which is what decides the meaning of a worker exiting.
     *
     * While starting, an exit means the pool cannot be built and startup should say so. While
     * running, it is one worker that has to be replaced. While stopped, it is what was asked for -
     * and replacing a worker there would start threads as the process is trying to end.
     */
    private poolState: 'starting' | 'running' | 'stopped' = 'starting';
    private readonly threadJobWorkerFilePath: FsPath;

    constructor(
        @Inject(ZIBRI_DI_TOKENS.MULTITHREADING_OPTIONS)
        private readonly options: MultithreadingOptions,
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        private readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.LEASE_SERVICE)
        private readonly leaseService: LeaseServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.ZIBRI_PACKAGE_ROOT)
        packageRoot: FsPath
    ) {
        this.threadJobWorkerFilePath = FsUtilities.getPath(
            packageRoot,
            'dist',
            'cjs',
            'multithreading',
            'services',
            'worker',
            'thread-job.worker.js'
        );
    }

    /**
     * Calls back the code that queued a job, in the tenant it was queued in.
     *
     * What a worker reports arrives outside every tenant, so a callback would otherwise reach the rows
     * of no tenant only, and send what it sends to every tenant.
     * @param job - The job the callback belongs to.
     * @param notify - Calls the callback, if the job was queued with one.
     */
    private async callBackInTenantOf(
        job: ThreadJob<BaseThreadJobWorkerData | BaseFunctionThreadJobWorkerData<unknown>, unknown>,
        notify: () => void
    ): Promise<void> {
        if (job.tenantId == undefined) {
            notify();
            return;
        }
        const tenantService: TenantServiceInterface = inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);
        await tenantService.runAs(job.tenantId, () => {
            notify();
            return Promise.resolve();
        });
    }

    // read when used rather than injected, so that an application without the entity is told to
    // declare it by onAppInit, instead of failing on a repository token while this is built
    private get threadJobEntityRepository(): Repository<
        ThreadJobEntity<BaseThreadJobWorkerData | BaseFunctionThreadJobWorkerData<unknown>, unknown>
    > {
        return inject(repositoryTokenFor(ThreadJobEntity));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onAppInit(app: ZibriApplication): Promise<void> {
        // the queue lives in the table, and the pool below starts reading it as soon as the app starts
        validateEntitiesRegistered(MultithreadingService.name, app, ThreadJobEntity);
        await this.validateInputs();

        // every instance has its own workers to keep busy, so every instance has to look for work -
        // which is why this one is not distributed. Electing one would have a single instance poll
        // on behalf of a pool it cannot reach.
        if (!app.options.cronJobs.includes(RunQueuedThreadJobsCronJob)) {
            app.options.cronJobs.push(RunQueuedThreadJobsCronJob);
        }

        this.logger.info('initializes worker pool for multithreading');
        this.logger.info(`  - ${this.options.maxThreads} normal thread job workers`);
        this.logger.info(`  - ${this.options.maxPriorityThreads} priority thread job workers`);

        for (let i: number = 0; i < this.options.maxThreads; i++) {
            this.initWorker(false);
        }
        for (let i: number = 0; i < this.options.maxPriorityThreads; i++) {
            this.initWorker(true);
        }

        const workerPromises: Promise<boolean>[] = this.workers.map(w => firstValueFrom(w.isInitializingSubject.pipe(filter(i => !i))));
        // eslint-disable-next-line stylistic/max-len
        const idleWorkerPromises: Promise<boolean>[] = this.idleWorkers.map(w => firstValueFrom(w.isInitializingSubject.pipe(filter(i => !i))));
        await Promise.all([
            ...workerPromises,
            ...idleWorkerPromises
        ]);

        this.poolState = 'running';
    }

    /**
     * Starts working through whatever is queued, including what an earlier run left behind.
     *
     * On start rather than on init, so a pod that comes up and never becomes ready does not quietly
     * start running the backlog - the same reason scheduled work waits for this hook.
     *
     * There is no separate recovery step. A job another run left unfinished is in the same table as
     * one queued a moment ago and is selected the same way; what tells "abandoned" from "somebody
     * else is running it" is whether the claim on it is still being renewed, not how long ago it
     * started.
     */
    async onAppStart(): Promise<void> {
        await this.startQueuedJobs();
    }

    private initWorker(priority: boolean): void {
        // started with an empty object rather than with nothing, because that object is how each job
        // hands its data to the file it runs: the worker empties and refills it per job rather than
        // replacing it, which is what lets an es module worker file - whose import of it is a
        // snapshot taken once - still read the current job. Without it there is nothing to refill.
        //
        // Always an object: a queued job has to name the file it runs, and a `run` call carries the
        // caller's input inside `{ func, input }`, so a primitive input is a value in there rather
        // than the thing itself.
        const worker: Worker = new Worker(this.threadJobWorkerFilePath, { workerData: {} });
        const threadJobWorker: ThreadJobWorker = new ThreadJobWorker(worker, priority, worker.threadId);

        const threadId: number = threadJobWorker.threadId;
        worker.on('message', m => void this.trackWorkerEvent(this.handleWorkerMessage(m, threadId), threadId));
        worker.on('exit', code => void this.trackWorkerEvent(this.handleWorkerExit(code, threadId), threadId));
        worker.on('error', (error: Error) => void this.trackWorkerEvent(this.handleWorkerError(error, threadId), threadId));

        this.idleWorkers.push(threadJobWorker);
    }

    private async validateInputs(): Promise<void> {
        const workerFileExists: boolean = await FsUtilities.exists(this.threadJobWorkerFilePath);
        if (!workerFileExists) {
            throw new InitMultithreadingServiceError(`The worker file at ${this.threadJobWorkerFilePath} does not exist.`);
        }

        const availableThreads: number = os.availableParallelism();
        const maxThreads: number = this.options.maxThreads + this.options.maxPriorityThreads;

        if (maxThreads > availableThreads) {
            throw new InitMultithreadingServiceError(
                [
                    `The MultithreadingService was configured to start up to ${maxThreads}`,
                    `(${this.options.maxThreads} + ${this.options.maxPriorityThreads}) workers,`,
                    `but there are only ${availableThreads} threads available`
                ].join(' ')
            );
        }

        if (this.options.maxThreads < 1) {
            throw new InitMultithreadingServiceError(
                'The MultithreadingService was configured to have less than 1 thread available. It will not be able to execute anything.'
            );
        }

        // here rather than where a TypeScript file is finally loaded, which is the whole point of
        // the option existing: a worker file is named per job, so nothing else in this process ever
        // learns that a compiler will be wanted until a job wants one - and that can be days after
        // the deployment that left it out.
        if (this.options.enableTsWorkerFiles && !isTsNodeInstalled()) {
            throw new InitMultithreadingServiceError([
                'enableTsWorkerFiles is true, but the optional peer dependency "ts-node" is not installed,',
                'so a worker file written in TypeScript could not be compiled.',
                'Install it, or set multithreading.enableTsWorkerFiles to false if this deployment ships',
                'compiled worker files.'
            ]);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async queueThreadJob<WorkerData extends BaseThreadJobWorkerData, ResultType>(
        threadJobData: ThreadJobData<WorkerData>
    ): Promise<string> {
        // the types say this already, and a type stops nobody writing javascript - which is the
        // only kind of caller this matters for. A queued job is written to a row and read back by
        // `requeue`, so source that arrives here is source the worker would run again from the
        // database, and write access to that table would be enough to run code.
        validateNotAFunctionJob(threadJobData.workerData);
        this.validateWorkerFileCanBeLoaded(threadJobData.workerData);

        const entityData: OmitStrict<ThreadJobEntity<WorkerData, ResultType>, 'id'> = {
            queuedAtMs: Date.now(),
            status: ThreadJobStatus.IN_QUEUE,
            priority: threadJobData.priority ?? false,
            progress: 0,
            workerData: threadJobData.workerData,
            timeout: threadJobData.timeout ?? this.getDefaultTimeout(threadJobData.priority ?? false),
            ...this.resolveQueuedInTrace()
        };

        // the row is the queue. Nothing is kept here beyond the callbacks, which cannot be stored
        // and which only this instance could call anyway
        const entity: ThreadJobEntity<
            BaseThreadJobWorkerData | BaseFunctionThreadJobWorkerData<unknown>,
            unknown
        > = await this.threadJobEntityRepository.create(entityData);
        this.rememberFunctions(entity.id, threadJobData);

        // straight away rather than waiting for the next poll, because the common case is an
        // instance queueing work it has a free worker for right now
        await this.startQueuedJobs();

        return entity.id;
    }

    /**
     * Refuses a TypeScript worker file for a deployment that said it ships compiled ones.
     *
     * At the point the file is named, which is the earliest this can be answered, and in the
     * caller's own stack rather than inside a worker thread - so it is a refused call rather than a
     * queued row that fails later for a reason nothing in the request had.
     * @param workerData - The data of the job being queued.
     * @throws If the file is TypeScript and `enableTsWorkerFiles` is false.
     */
    private validateWorkerFileCanBeLoaded(workerData: BaseThreadJobWorkerData): void {
        if (this.options.enableTsWorkerFiles || !needsTsNode(workerData.filePath)) {
            return;
        }
        throw new InternalError([
            `The worker file ${workerData.filePath} is TypeScript, and multithreading.enableTsWorkerFiles is false.`,
            'Point the job at the compiled file, or set that option to true and install the optional peer',
            'dependency "ts-node".'
        ]);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async runThreadJob<WorkerData extends BaseThreadJobWorkerData, ResultType>(
        threadJobData: ThreadJobData<WorkerData>
    ): Promise<ThreadJobEntity<WorkerData, ResultType>> {
        const jobId: string = await this.queueThreadJob(threadJobData);
        return await this.waitForThreadJob<ResultType, WorkerData>(jobId);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async run<InputType, ResultType>(
        func: ThreadJobFunction<InputType, ResultType>,
        input: InputType,
        timeout?: number,
        priority: boolean = true
    ): Promise<ResultType> {
        const entityData: ThreadJobEntity<BaseFunctionThreadJobWorkerData<InputType>, ResultType> = {
            id: UUIDUtilities.generate(),
            queuedAtMs: Date.now(),
            status: ThreadJobStatus.IN_QUEUE,
            priority,
            progress: 0,
            workerData: {
                func: func.toString(),
                input
            },
            timeout: timeout ?? this.getDefaultTimeout(priority),
            ...this.resolveQueuedInTrace()
        };

        const threadJob: ThreadJob<BaseFunctionThreadJobWorkerData<InputType>, ResultType> = new ThreadJob(entityData, 'function');
        this.localQueue.push(threadJob as ThreadJob<BaseFunctionThreadJobWorkerData<unknown>, unknown>);
        await this.startQueuedJobs();
        const finishedJob: ThreadJobEntity<BaseFunctionThreadJobWorkerData<InputType>, ResultType>
            = await this.waitForThreadJob(threadJob.id);

        if (finishedJob.status === ThreadJobStatus.COMPLETED) {
            return finishedJob.result as ResultType;
        }
        if (finishedJob.error) {
            throw toThrownError(finishedJob.error);
        }
        throw new InternalError(`Running the function "${func.name}" on a worker was not successful`);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async requeueThreadJob(jobId: string, data?: ThreadJobDataFunctions): Promise<void> {
        // putting the row back in the queue *is* requeueing it now, so there is nothing else to do
        await this.threadJobEntityRepository.updateById(jobId, {
            error: undefined,
            progress: 0,
            queuedAtMs: Date.now(),
            status: ThreadJobStatus.IN_QUEUE,
            startedAtMs: undefined,
            stoppedAtMs: undefined,
            threadId: undefined,
            // the run that follows answers to whoever asked for it, not to whoever queued it first
            ...this.resolveQueuedInTrace()
        });
        this.rememberFunctions(jobId, data);
        await this.startQueuedJobs();
    }

    /**
     * The trace a job queued right now belongs to, as its row keeps it.
     * @returns The trace written as the headers would carry it, both null outside any trace.
     */
    private resolveQueuedInTrace(): Pick<ThreadJobEntity<BaseThreadJobWorkerData, unknown>, 'traceparent' | 'tracestate'> {
        const context: TraceSpanContext | undefined = TracingUtilities.getCurrentTraceContext();
        return {
            // eslint-disable-next-line unicorn/no-null
            traceparent: context == undefined ? null : TraceContextUtilities.resolveTraceparent(context),
            // eslint-disable-next-line unicorn/no-null
            tracestate: context?.traceState ?? null
        };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async rerunThreadJob<WorkerData extends BaseThreadJobWorkerData, ResultType>(
        jobId: string,
        data?: ThreadJobDataFunctions
    ): Promise<ThreadJobEntity<WorkerData, ResultType>> {
        await this.requeueThreadJob(jobId, data);
        return this.waitForThreadJob(jobId);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async waitForThreadJob<
        ResultType,
        WorkerData extends BaseThreadJobWorkerData | BaseFunctionThreadJobWorkerData<unknown> = BaseThreadJobWorkerData
    >(
        jobId: string
    ): Promise<ThreadJobEntity<WorkerData, ResultType>> {
        // waiting for a job is not the same thing as running it: a caller that has stopped waiting
        // leaves the job alone to finish and to record what it did, which is what the row is for
        const signal: AbortSignal | undefined = AlsUtilities.findCurrentRequestSignal();

        const localJob: ThreadJob<
            BaseThreadJobWorkerData | BaseFunctionThreadJobWorkerData<unknown>,
            unknown
        > | undefined = this.findLocalJob(jobId);

        if (localJob) {
            // the subscription outlives the wait when the signal fires, and ends with the job. That
            // is one subscription on a subject that is about to complete, against a poll that would
            // otherwise run for the whole of an hour long job
            await PromiseUtilities.withSignal(firstValueFrom(localJob.completedSubject.pipe(filter(i => i))), signal);

            if (localJob.type === 'function') {
                // never had a row to read back, and this is what has been keeping it alive
                this.runningJobs = this.runningJobs.filter(j => j.id !== jobId);
                return localJob as unknown as ThreadJobEntity<WorkerData, ResultType>;
            }
            return await this.threadJobEntityRepository.findById(jobId) as ThreadJobEntity<WorkerData, ResultType>;
        }

        // still waiting for a worker anywhere in the deployment, running on another instance, or
        // already over. The row is the only thing that knows, and no subject in this process will
        // ever fire for it - so it is read until it says the job ended.
        return await this.waitForRow(jobId, signal);
    }

    /**
     * Waits for a job this process is not the one running.
     *
     * "Not running it" is only true for as long as it is true: a job waiting for a worker anywhere
     * in the deployment may well be picked up here a moment later, and from then on this process
     * knows the instant it ends. So each pass looks again before it sleeps - otherwise a caller that
     * started waiting before its job was picked up would poll for the whole of a run happening in
     * front of it, and hear about the end up to one interval late.
     * @param jobId - The job to wait for.
     * @param signal - Ends the wait when the request that asked for it is over.
     * @returns The row, once it says the job is over.
     * @throws The signal's reason, when nobody is waiting for the job any more.
     */
    private async waitForRow<
        ResultType,
        WorkerData extends BaseThreadJobWorkerData | BaseFunctionThreadJobWorkerData<unknown> = BaseThreadJobWorkerData
    >(jobId: string, signal: AbortSignal | undefined): Promise<ThreadJobEntity<WorkerData, ResultType>> {
        let row: ThreadJobEntity<
            BaseThreadJobWorkerData | BaseFunctionThreadJobWorkerData<unknown>,
            unknown
        > = await this.threadJobEntityRepository.findById(jobId);

        while (!TERMINAL_STATUSES.includes(row.status)) {
            // checked inside the loop rather than only around it: this reads a row every interval
            // for as long as the job runs, and a default job is given an hour. Ending the wait
            // without ending the loop would leave that query running against nothing
            if (signal?.aborted === true) {
                throw signal.reason;
            }

            const localJob: ThreadJob<
                BaseThreadJobWorkerData | BaseFunctionThreadJobWorkerData<unknown>,
                unknown
            > | undefined = this.findLocalJob(jobId);

            if (localJob) {
                await PromiseUtilities.withSignal(firstValueFrom(localJob.completedSubject.pipe(filter(i => i))), signal);
                this.pendingFunctions.delete(jobId);
                return await this.threadJobEntityRepository.findById(jobId) as ThreadJobEntity<WorkerData, ResultType>;
            }

            await sleep(REMOTE_JOB_POLL_INTERVAL_IN_MS, undefined, { signal }).catch(() => undefined);
            row = await this.threadJobEntityRepository.findById(jobId);
        }

        this.pendingFunctions.delete(jobId);
        return row as ThreadJobEntity<WorkerData, ResultType>;
    }

    /**
     * Finds a job among the ones this process is running or holding.
     * @param jobId - The job to look for.
     * @returns The job, if this process has it.
     */
    private findLocalJob(
        jobId: string
    ): ThreadJob<BaseThreadJobWorkerData | BaseFunctionThreadJobWorkerData<unknown>, unknown> | undefined {
        return this.runningJobs.find(j => j.id === jobId) ?? this.localQueue.find(j => j.id === jobId);
    }

    /**
     * Keeps the callbacks a caller handed in, for as long as the job they belong to lasts.
     * @param jobId - The job they were given for.
     * @param data - What was handed in, which is usually nothing.
     */
    private rememberFunctions(jobId: string, data?: ThreadJobDataFunctions): void {
        if (!data?.onMessage && !data?.onComplete && !data?.onError && !data?.onCancel) {
            return;
        }
        this.pendingFunctions.set(jobId, data);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onAppShutdown(): Promise<void> {
        // before the terminates, because every one of them fires an exit - and an exit is otherwise
        // a worker to replace, which would start threads as the process is trying to end
        this.poolState = 'stopped';

        // a worker event being handled and a round of handing out work both read and write the
        // table, and the data source goes away once shutdown is over - a query still running then
        // is cut off underneath them. Waited for rather than abandoned, because both are short: a
        // round hands a job to a worker without waiting for it, and stops at the next job now that
        // the pool is stopped
        await Promise.allSettled([this.selectionRound, ...this.eventsInHandling]);

        await this.releaseUnfinishedJobs();

        await Promise.all([
            ...this.workers.map(w => w.worker.terminate()),
            ...this.idleWorkers.map(w => w.worker.terminate())
        ]);
        // and again for whatever a worker reported while the jobs were being released
        await Promise.allSettled(this.eventsInHandling);

        this.idleWorkers = [];
        this.workers = [];
    }

    /**
     * Hands unfinished work back before the workers are torn down.
     *
     * Not a drain: a thread job's default timeout is an hour and a pod's grace period is seconds, so
     * waiting is not on offer. What is, is leaving the row saying what actually happened, so the
     * next run takes the job back straight away instead of having to judge it by its timeout.
     *
     * `INTERRUPTED` rather than `IN_QUEUE`, because the job did run - `startedAtMs` and `progress`
     * are kept as the record of how far it got. Whatever picks it up sets them back.
     *
     * Only persisted jobs get the row. A `run` call is awaited by a caller in this process, and that
     * caller is going away too - but every job here is settled either way, because a job that is
     * still running holds a claim, and the claim is handed back when the work it wraps returns. Left
     * unsettled, each one would sit out the lease drain and then a full lease before anybody else
     * could take the work.
     */
    private async releaseUnfinishedJobs(): Promise<void> {
        const running: ThreadJob<BaseThreadJobWorkerData | BaseFunctionThreadJobWorkerData<unknown>, unknown>[] = [...this.runningJobs];

        await PromiseUtilities.allChunked(
            running.filter(j => j.type === 'job' && j.status === ThreadJobStatus.IN_PROGRESS),
            async job => {
                try {
                    await this.threadJobEntityRepository.updateById(
                        job.id,
                        { status: ThreadJobStatus.INTERRUPTED, threadId: undefined },
                        { acrossTenants: true }
                    );
                }
                catch (error) {
                    // never worth holding up a shutdown: the row keeps saying IN_PROGRESS, and
                    // whoever takes the claim over next finds it that way instead
                    this.logger.error(
                        new InternalError(`Could not mark thread job ${job.id} as interrupted while shutting down`, { cause: error })
                    );
                }
            }
        );

        for (const job of running) {
            this.settleJob(job);
        }
    }

    private getDefaultTimeout(priority: boolean): number {
        return priority ? this.options.defaultTimeoutPriorityMs : this.options.defaultTimeoutMs;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async startQueuedJobs(): Promise<void> {
        if (this.poolState === 'stopped') {
            return;
        }

        // one round at a time. A round reads the table before it takes a worker out of the idle
        // list, so two of them overlapping - a completion and the poll, which is the ordinary case -
        // would both see the same free worker and both post a job to it.
        if (this.selectionRound) {
            // and whatever asked while a round was running is answered by running another one after
            // it, rather than by that caller waiting for a round that has already read past its job
            this.selectionRequested = true;
            return;
        }

        this.selectionRound = this.runSelectionRounds();
        try {
            await this.selectionRound;
        }
        finally {
            this.selectionRound = undefined;
        }
    }

    /**
     * Hands work to free workers until there is nothing left to hand out or nobody left to take it.
     */
    private async runSelectionRounds(): Promise<void> {
        // the pool state is read before every job rather than once, because shutting down waits for
        // the round, and a round that went on starting jobs would keep it waiting
        do {
            this.selectionRequested = false;
            while (this.poolState !== 'stopped' && this.idleWorkers.length && await this.startNextJob()) {
                // filling one worker at a time until a round finds nothing to start
            }
        }
        while (this.selectionRequested && this.poolState !== 'stopped');
    }

    /**
     * Gives one free worker something to do, if there is anything it may take.
     * @returns Whether a worker was given a job.
     */
    private async startNextJob(): Promise<boolean> {
        const idlePriorityWorker: ThreadJobWorker | undefined = this.idleWorkers.find(w => w.priority);
        const idleWorker: ThreadJobWorker | undefined = this.idleWorkers.find(w => !w.priority);

        // priority work first, on a priority worker where there is one and on a normal worker
        // otherwise - the fallback is what keeps a reserved pool from being the reason work waits
        const workerForPriorityJob: ThreadJobWorker | undefined = idlePriorityWorker ?? idleWorker;
        if (workerForPriorityJob && await this.startOldest(true, workerForPriorityJob)) {
            return true;
        }

        // and normal work never takes a priority worker, which is the whole point of reserving one
        if (idleWorker && await this.startOldest(false, idleWorker)) {
            return true;
        }
        return false;
    }

    /**
     * Gives the worker the oldest thing it is allowed to take.
     *
     * Oldest first, which is what a queue means: served newest first, the job at the front is passed
     * over by every job that arrives after it, and under submission that does not stop it is never
     * served at all.
     * @param priority - Whether to look at priority jobs or at normal ones.
     * @param worker - The worker to give a job to.
     * @returns Whether the worker was given one.
     */
    private async startOldest(priority: boolean, worker: ThreadJobWorker): Promise<boolean> {
        const candidates: JobCandidate[] = await this.candidatesFor(priority);
        if (!candidates.length) {
            return false;
        }

        this.takeWorker(worker);
        for (const candidate of candidates) {
            if ('job' in candidate) {
                this.startLocalJob(candidate.job, worker);
                return true;
            }
            if (await this.claimAndRun(candidate.entity, worker)) {
                return true;
            }
        }

        // every row that was read had been claimed by somebody else by the time this asked for it,
        // which is the ordinary outcome when several instances have free workers at once
        this.giveWorkerBack(worker);
        return false;
    }

    /**
     * Everything the pool could start next, oldest first.
     * @param priority - Whether to look at priority jobs or at normal ones.
     * @returns The candidates, function jobs and rows ordered against each other.
     */
    private async candidatesFor(priority: boolean): Promise<JobCandidate[]> {
        const localJob: ThreadJob<BaseFunctionThreadJobWorkerData<unknown>, unknown> | undefined = this.localQueue
            .filter(j => j.priority === priority)
            .sort((a, b) => a.queuedAtMs - b.queuedAtMs)[0];

        const runningHere: string[] = this.runningJobs.map(j => j.id);
        const rows: ThreadJobEntity<
            BaseThreadJobWorkerData | BaseFunctionThreadJobWorkerData<unknown>,
            unknown
        >[] = await this.threadJobEntityRepository.findAll({
            where: { status: { oneOf: CLAIMABLE_STATUSES }, priority },
            order: { queuedAtMs: 'ASC' },
            take: CANDIDATE_BATCH_SIZE,
            // one pool serves every tenant, whichever of them asked for this round
            acrossTenants: true
        });

        return [
            ...localJob == undefined ? [] : [{ queuedAtMs: localJob.queuedAtMs, job: localJob }],
            // what this process is already running is in that list too, since a running job's row
            // says IN_PROGRESS and only its claim says who has it. Asking for our own back would
            // be refused, so it is dropped here rather than turned into a failed claim
            ...rows.filter(r => !runningHere.includes(r.id)).map(r => ({ queuedAtMs: r.queuedAtMs, entity: r }))
        ].sort((a, b) => a.queuedAtMs - b.queuedAtMs);
    }

    /**
     * Takes the claim on a queued job and runs it, if nobody else has it.
     *
     * The claim is held for exactly as long as the job runs, and renewed underneath - so an instance
     * that is working is never taken over, and one that stops existing is, as soon as its claim
     * lapses. That is what makes `IN_PROGRESS` a status another instance can act on: the row cannot
     * say whether its owner is still there, and the claim can.
     * @param entity - The job to take.
     * @param worker - The worker it would run on, already taken out of the idle pool.
     * @returns Whether this instance got the job.
     */
    private async claimAndRun(
        entity: ThreadJobEntity<BaseThreadJobWorkerData | BaseFunctionThreadJobWorkerData<unknown>, unknown>,
        worker: ThreadJobWorker
    ): Promise<boolean> {
        const job: ThreadJob<
            BaseThreadJobWorkerData | BaseFunctionThreadJobWorkerData<unknown>,
            unknown
        > = new ThreadJob(entity, 'job', this.pendingFunctions.get(entity.id));

        let signalClaimed: (claimed: boolean) => void = () => undefined;
        const claimed: Promise<boolean> = new Promise<boolean>(resolve => {
            signalClaimed = resolve;
        });

        // deliberately not awaited: whether this instance got the job has to be answered now, so the
        // selector can move on to the next worker while this one runs for as long as it runs
        void this.holdAndRun(job, worker, claimedNow => signalClaimed(claimedNow));

        return await claimed;
    }

    /**
     * Holds the claim on a job for the whole of its run.
     * @param job - The job to run.
     * @param worker - The worker to run it on, already taken out of the idle pool.
     * @param signalClaimed - Called with whether the claim was taken, as soon as that is known.
     */
    private async holdAndRun(
        job: ThreadJob<BaseThreadJobWorkerData | BaseFunctionThreadJobWorkerData<unknown>, unknown>,
        worker: ThreadJobWorker,
        signalClaimed: (claimed: boolean) => void
    ): Promise<void> {
        try {
            await this.leaseService.withLease(
                { key: claimKeyFor(job.id), leaseInMs: this.options.jobClaimInMs, mode: 'skip', onCompletion: 'release' },
                async () => {
                    signalClaimed(true);
                    await this.runToCompletion(job, worker);
                }
            );
        }
        catch (error) {
            await this.abandonRun(job, worker, error);
        }
        finally {
            // says "not claimed" only when nothing has answered yet - a promise that has already
            // been resolved does not change its mind
            signalClaimed(false);
        }
    }

    /**
     * Starts a function job, which is nobody else's to take.
     * @param job - The job to run.
     * @param worker - The worker to run it on, already taken out of the idle pool.
     */
    private startLocalJob(job: ThreadJob<BaseFunctionThreadJobWorkerData<unknown>, unknown>, worker: ThreadJobWorker): void {
        this.localQueue = this.localQueue.filter(j => j.id !== job.id);
        void this.runLocalJob(job, worker);
    }

    /**
     * Runs a function job, and makes sure the worker comes back if it cannot be run at all.
     * @param job - The job to run.
     * @param worker - The worker to run it on.
     */
    private async runLocalJob(job: ThreadJob<BaseFunctionThreadJobWorkerData<unknown>, unknown>, worker: ThreadJobWorker): Promise<void> {
        try {
            await this.runToCompletion(job, worker);
        }
        catch (error) {
            await this.abandonRun(job, worker, error);
        }
    }

    /**
     * Gives up on a job that could not be run, rather than losing the worker with it.
     *
     * For the failure that is not the job's: the row could not be written, the message could not be
     * posted. The job's own failures come back as worker messages and end up in its row - nothing
     * reaches here for those.
     *
     * A stopped pool is not one of them, and is deliberately silent. Shutting down settles every
     * running job so its claim is handed back, and handing one back is a write - to a data source
     * that is being taken away, from a process whose container may already be released. That write
     * failing is the shutdown, not the job, and there is by then nothing left to log it with.
     * @param job - The job that could not be run.
     * @param worker - The worker it would have run on.
     * @param error - What went wrong.
     */
    private async abandonRun(
        job: ThreadJob<BaseThreadJobWorkerData | BaseFunctionThreadJobWorkerData<unknown>, unknown>,
        worker: ThreadJobWorker,
        error: unknown
    ): Promise<void> {
        if (this.poolState === 'stopped') {
            return;
        }

        this.logger.error(new InternalError(`Thread job ${job.id} could not be run`, { cause: error }));
        this.settleJob(job);
        this.freeWorker(worker.threadId);
        await this.startQueuedJobs();
    }

    /**
     * Runs a job on a worker and returns when it is over, however it ended.
     *
     * What the claim is wrapped around, so "the work is finished" and "the claim is handed back" are
     * the same moment rather than two that can drift apart.
     * @param job - The job to run.
     * @param worker - The worker to run it on.
     */
    private async runToCompletion(
        job: ThreadJob<BaseThreadJobWorkerData | BaseFunctionThreadJobWorkerData<unknown>, unknown>,
        worker: ThreadJobWorker
    ): Promise<void> {
        // under the trace the job was queued in rather than the one running here: a job is started
        // by whichever call found a worker free - the poll, another job finishing, or a request that
        // queued something else - and none of those is what the job belongs to
        const queuedIn: TraceSpanContext | undefined = job.traceparent == undefined
            ? undefined
            : TraceContextUtilities.findSpanContext({
                [KnownHeader.TRACEPARENT]: job.traceparent,
                [KnownHeader.TRACESTATE]: job.tracestate ?? undefined
            });
        const span: TraceSpanInterface = TracingUtilities.startSpan('runThreadJob', {
            kind: TraceSpanKind.CONSUMER,
            root: queuedIn == undefined,
            parent: queuedIn,
            attributes: {
                'messaging.message.id': job.id,
                'code.file.path': 'filePath' in job.workerData ? job.workerData.filePath : undefined
            }
        });
        try {
            await TracingUtilities.runWithSpan(span, async () => {
                this.runningJobs.push(job);
                await this.startJob(job, worker, span.context);
                await firstValueFrom(job.completedSubject.pipe(filter(i => i)));
            });
        }
        catch (error) {
            span.recordError(error);
            span.end(TraceSpanStatus.ERROR);
            throw error;
        }
        // a job's own failure is a message from the worker rather than a throw here, so it is read
        // off the job once it is over. Cancelled or interrupted is not the job failing
        if (job.status === ThreadJobStatus.FAILED) {
            span.recordError(job.error == undefined ? new InternalError(`Thread job ${job.id} failed`) : toThrownError(job.error));
            span.end(TraceSpanStatus.ERROR);
            return;
        }
        span.end();
    }

    /**
     * Marks a worker as busy.
     * @param worker - The worker being given a job.
     */
    private takeWorker(worker: ThreadJobWorker): void {
        this.idleWorkers = this.idleWorkers.filter(w => w.threadId !== worker.threadId);
        this.workers.push(worker);
    }

    /**
     * Marks a worker as free again, having found nothing for it after all.
     * @param worker - The worker that was not given a job.
     */
    private giveWorkerBack(worker: ThreadJobWorker): void {
        this.workers = this.workers.filter(w => w.threadId !== worker.threadId);
        this.idleWorkers.push(worker);
    }

    private async startJob(
        job: ThreadJob<BaseThreadJobWorkerData | BaseFunctionThreadJobWorkerData<unknown>, unknown>,
        worker: ThreadJobWorker,
        traceContext: TraceSpanContext
    ): Promise<void> {
        const message: ThreadJobStartMessage = { workerData: job.workerData, traceContext };
        worker.worker.postMessage(message);
        worker.timeout = setTimeout(
            () => void this.trackWorkerEvent(this.stopOverdueJob(job, worker), worker.threadId),
            job.timeout
        );

        // progress goes back to zero because the job starts from the beginning: a job taken over
        // from an instance that stopped existing keeps how far *it* got on the row until here, which
        // is worth having while nothing is running it and wrong the moment something is
        await this.updateThreadJobById(
            job.id,
            { startedAtMs: Date.now(), status: ThreadJobStatus.IN_PROGRESS, threadId: worker.threadId, progress: 0 }
        );
    }

    /**
     * Stops a job that ran past its timeout.
     * @param job - The job that is overdue.
     * @param worker - The worker running it.
     */
    private async stopOverdueJob(
        job: ThreadJob<BaseThreadJobWorkerData | BaseFunctionThreadJobWorkerData<unknown>, unknown>,
        worker: ThreadJobWorker
    ): Promise<void> {
        try {
            await this.updateThreadJobById(job.id, { error: errorToLoggedError(new TimeoutError()) });
        }
        finally {
            // stopped whether or not the reason could be written down: the exit is what fails the
            // job and hands the thread back, and a job nobody stops runs for as long as it likes
            await worker.worker.terminate();
        }
    }

    /**
     * Handles something a worker did, where shutting down can wait for it.
     *
     * A worker's messages, its exit, its errors and its timeout all arrive through callbacks nothing
     * awaits, so a failure here would otherwise reach nobody. It is logged here instead.
     * @param handling - The handling of it, already started.
     * @param threadId - The thread it came from.
     */
    private async trackWorkerEvent(handling: Promise<void>, threadId: number): Promise<void> {
        this.eventsInHandling.add(handling);
        try {
            await handling;
        }
        catch (error) {
            this.logger.error(new InternalError(`Could not handle an event of thread job worker ${threadId}`, { cause: error }));
        }
        finally {
            this.eventsInHandling.delete(handling);
        }
    }

    private async handleWorkerMessage<MessageType>(message: MessageType, threadId: number): Promise<void> {
        this.logger.debug(`got message from worker:\n${JsonUtilities.stringify(message, undefined, 2)}`);

        const job: ThreadJob<
            BaseThreadJobWorkerData | BaseFunctionThreadJobWorkerData<unknown>,
            unknown
        > | undefined = this.getJobByThreadId(threadId);
        if (!job) {
            if (this.isThreadJobMessage(message) && message.type === 'initialization') {
                this.handleInitializationMessage(threadId);
            }
            return;
        }

        if (!this.isThreadJobMessage(message)) {
            await this.callBackInTenantOf(job, () => job.onMessage?.(message));
            return;
        }

        switch (message.type) {
            case 'progress': {
                if (message.progress !== 100) {
                    await this.updateThreadJobById(job.id, { progress: message.progress });
                    return;
                }
                try {
                    await this.updateThreadJobById(job.id, { progress: message.progress });
                    await this.updateThreadJobById(
                        job.id,
                        { status: ThreadJobStatus.COMPLETED, threadId: undefined, stoppedAtMs: Date.now() }
                    );
                    await this.callBackInTenantOf(job, () => job.onComplete?.());
                }
                finally {
                    await this.handleJobCompletion(job, threadId);
                }
                return;
            }
            case 'completion': {
                try {
                    await this.updateThreadJobById(job.id, {
                        status: ThreadJobStatus.COMPLETED,
                        threadId: undefined,
                        stoppedAtMs: Date.now(),
                        progress: 100,
                        result: message.result
                    });
                    await this.callBackInTenantOf(job, () => job.onComplete?.());
                }
                finally {
                    await this.handleJobCompletion(job, threadId);
                }
                return;
            }
            case 'status': {
                await this.updateThreadJobById(job.id, { status: message.status });
                return;
            }
            case 'error': {
                try {
                    await this.updateThreadJobById(
                        job.id,
                        { status: ThreadJobStatus.FAILED, threadId: undefined, stoppedAtMs: Date.now(), error: message.error }
                    );
                    await this.callBackInTenantOf(job, () => job.onError?.(toThrownError(message.error)));
                }
                finally {
                    if (message.fatal) {
                        // the worker is ending itself, so it must not go back on the idle list for the
                        // moment it has left - the next job would be posted to a thread already on its
                        // way out. Its exit is what takes it out of the pool and starts a replacement;
                        // the queue moves on with whatever other workers are free.
                        this.settleJob(job);
                        await this.startQueuedJobs();
                    }
                    else {
                        await this.handleJobCompletion(job, threadId);
                    }
                }
                return;
            }
            case 'initialization': {
                this.handleInitializationMessage(threadId);
            }
        }
    }

    /**
     * Settles a job that is over and hands its worker back.
     *
     * Every path that writes how a job ended calls this in a `finally`, so it runs whether or not
     * that write went through. A job whose ending could not be written keeps a row saying it is
     * running, with its claim handed back, so it is taken over and run again like the job of an
     * instance that stopped. Holding on to the worker instead stopped the whole pool behind it, and
     * the claim went on being renewed, so no other instance could take the job either.
     * @param job - The job that is over, however it ended.
     * @param threadId - The thread it ran on.
     */
    private async handleJobCompletion<WorkerData extends BaseThreadJobWorkerData | BaseFunctionThreadJobWorkerData<unknown>, ResultType>(
        job: ThreadJob<WorkerData, ResultType>,
        threadId: number
    ): Promise<void> {
        this.settleJob(job);
        this.freeWorker(threadId);
        await this.startQueuedJobs();
    }

    /**
     * Releases whoever is waiting on the job and takes it off the queue.
     *
     * Split out from {@link handleJobCompletion} because a worker that is ending itself settles its
     * job without being freed - it is not going to take another one.
     * @param job - The job that is over, however it ended.
     */
    private settleJob<WorkerData extends BaseThreadJobWorkerData | BaseFunctionThreadJobWorkerData<unknown>, ResultType>(
        job: ThreadJob<WorkerData, ResultType>
    ): void {
        job.completedSubject.next(true);
        // a function job is deliberately left where it is: it is the only copy of its own result,
        // with no row to read it back from, so it stays until whoever called `run` has taken it
        if (job.type === 'job') {
            this.runningJobs = this.runningJobs.filter(j => j.id !== job.id);
            this.pendingFunctions.delete(job.id);
        }
    }

    private handleInitializationMessage(threadId: number): void {
        this.getWorkerByThreadId(threadId)?.isInitializingSubject.next(false);
    }

    /**
     * Takes a worker that died without a job out of the pool, and starts one to take its place.
     *
     * The case a worker recovers from on its own is dying *while working*: the job completes with a
     * failure and the completion path frees the thread. A worker that dies while **idle** - killed for
     * its memory, a native crash, a signal from outside - completes nothing, so nothing used to notice
     * and the corpse stayed in `idleWorkers`. The next job picked it, posted a message to a terminated
     * thread, and waited for an answer that could not come. Every job after it did the same, until the
     * pool was entirely dead and submissions did nothing but time out - with no error anywhere,
     * because from the service's point of view nothing had failed.
     *
     * Only a worker that died while the pool was **running** is replaced. One that died while the pool
     * was still starting is what startup is waiting on, so it is told instead - letting the app refuse
     * to start rather than come up with a pool it cannot fill. One that died while stopping did so
     * because it was asked to.
     * @param exitCode - The code the worker exited with.
     * @param threadId - The thread id of the worker that exited.
     */
    private replaceDeadWorker(exitCode: number, threadId: number): void {
        const worker: ThreadJobWorker | undefined = this.getWorkerByThreadId(threadId);
        if (!worker) {
            return;
        }

        clearTimeout(worker.timeout);
        worker.timeout = undefined;
        this.workers = this.workers.filter(w => w.threadId !== threadId);
        this.idleWorkers = this.idleWorkers.filter(w => w.threadId !== threadId);

        switch (this.poolState) {
            case 'starting': {
                worker.isInitializingSubject.error(
                    new InternalError(`Worker ${threadId} exited with code ${exitCode} before initialization completed`)
                );
                return;
            }
            case 'stopped': {
                return;
            }
            case 'running': {
                this.logger.warn(`Thread job worker ${threadId} exited with code ${exitCode} while idle. Starting a replacement.`);
                this.initWorker(worker.priority);
                return;
            }
        }
    }

    private freeWorker(threadId: number): void {
        const foundWorker: ThreadJobWorker | undefined = this.getWorkerByThreadId(threadId);
        if (!foundWorker) {
            return;
        }

        clearTimeout(foundWorker.timeout);
        foundWorker.timeout = undefined;

        this.workers = this.workers.filter(w => w.threadId !== threadId);

        if (foundWorker.worker.threadId === -1) {
            // try to recover the worker thread - unless the pool is stopping, where a thread ending
            // is what was asked for and starting another one keeps the process alive
            if (this.poolState !== 'stopped') {
                this.initWorker(foundWorker.priority);
            }
            return;
        }

        this.idleWorkers.push(foundWorker);
    }

    private getJobByThreadId(
        threadId: number
    ): ThreadJob<BaseThreadJobWorkerData | BaseFunctionThreadJobWorkerData<unknown>, unknown> | undefined {
        return this.runningJobs.find(j => j.threadId === threadId);
    }

    private getWorkerByThreadId(threadId: number): ThreadJobWorker | undefined {
        return this.workers.find(w => w.threadId === threadId) ?? this.idleWorkers.find(w => w.threadId === threadId);
    }

    /**
     * Runs whenever a worker thread ends, which is not only on shutdown: a worker can be killed for
     * its memory, crash in native code, or be signalled from outside at any point.
     *
     * To see where an error from the thread job is actually handled take a look at "handleWorkerMessage".
     * @param exitCode - The code that the worker exited with.
     * @param threadId - The thread id of the worker.
     */
    private async handleWorkerExit(exitCode: number, threadId: number): Promise<void> {
        const job: ThreadJob<
            BaseThreadJobWorkerData | BaseFunctionThreadJobWorkerData<unknown>,
            unknown
        > | undefined = this.getJobByThreadId(threadId);
        if (!job) {
            this.replaceDeadWorker(exitCode, threadId);
            return;
        }

        if (exitCode !== 0) {
            try {
                await this.updateThreadJobById(job.id, {
                    stoppedAtMs: Date.now(),
                    status: ThreadJobStatus.FAILED,
                    threadId: undefined
                });
            }
            finally {
                await this.handleJobCompletion(job, threadId);
            }
            return;
        }

        try {
            await this.updateThreadJobById(job.id, {
                stoppedAtMs: Date.now(),
                status: ThreadJobStatus.CANCELLED,
                threadId: undefined
            });
            await this.callBackInTenantOf(job, () => job.onCancel?.());
        }
        finally {
            await this.handleJobCompletion(job, threadId);
        }
    }

    /**
     * This should actually never happen, as the whole worker crashes and not just the current task.
     * That's why the provided "onError"-method from the threadJob data is not called.
     * To see where an error from the thread job is actually handled take a look at "handleWorkerMessage".
     * @param error - The error that crashed the worker.
     * @param threadId - The threadId of the worker that crashed.
     */

    private async handleWorkerError(error: Error, threadId: number): Promise<void> {
        const job: ThreadJob<
            BaseThreadJobWorkerData | BaseFunctionThreadJobWorkerData<unknown>,
            unknown
        > | undefined = this.getJobByThreadId(threadId);
        if (!job) {
            const worker: ThreadJobWorker | undefined = this.getWorkerByThreadId(threadId);
            if (worker) {
                worker.isInitializingSubject.error(error);
            }
            return;
        }

        try {
            await this.updateThreadJobById(job.id, {
                stoppedAtMs: Date.now(),
                status: ThreadJobStatus.FAILED,
                error: errorToLoggedError(error),
                threadId: undefined
            });
        }
        finally {
            await this.handleJobCompletion(job, threadId);
        }
    }

    private async updateThreadJobById(
        id: string,
        data: Partial<ThreadJob<BaseThreadJobWorkerData | BaseFunctionThreadJobWorkerData<unknown>, unknown>>
    ): Promise<void> {
        const job: ThreadJob<
            BaseThreadJobWorkerData | BaseFunctionThreadJobWorkerData<unknown>,
            unknown
        > | undefined = this.findLocalJob(id);

        if (job) {
            // the job itself rather than a copy of it: what is being updated is the thing the run
            // and whoever is waiting on it are both holding
            Object.assign(job, data);
        }

        // a function job has no row, and never gets one. Everything else does, including a job this
        // process is not the one running - a status written from here is how the rest of the
        // deployment finds out what happened to it.
        if (job?.type === 'function') {
            return;
        }
        // across tenants, because what a worker reports arrives outside the tenant its job was queued
        // in - and the job was found by its id, which names one row whatever tenant it belongs to
        await this.threadJobEntityRepository.updateById(id, data, { acrossTenants: true });
    }

    private isThreadJobMessage(value: unknown): value is ThreadJobMessage {
        return typeof value === 'object' && !!(value as ThreadJobMessage).type;
    }
}