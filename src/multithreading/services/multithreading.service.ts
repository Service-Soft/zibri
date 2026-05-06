import os from 'node:os';
import { Worker } from 'node:worker_threads';

import { filter, firstValueFrom } from 'rxjs';

import { MultithreadingServiceInterface } from './multithreading-service.interface';
import { ThreadJob } from './thread-job';
import { ThreadJobWorker } from './thread-job-worker';
import { type AssetServiceInterface } from '../../assets/asset-service.interface';
import { Repository } from '../../data-source/repository';
import { InjectRepository } from '../../di/decorators/inject-repository.decorator';
import { Inject } from '../../di/decorators/inject.decorator';
import { Injectable } from '../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { OnAppInit } from '../../global/on-app-init.interface';
import { OnAppShutdown } from '../../global/on-app-shutdown.interface';
import { type LoggerInterface } from '../../logging/logger.interface';
import { OmitStrict } from '../../types/omit-strict.type';
import { FsUtilities, FsPath } from '../../utilities/fs.utilities';
import { JsonUtilities } from '../../utilities/json.utilities';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { BaseFunctionThreadJobWorkerData, BaseThreadJobWorkerData } from '../models/base-thread-job-worker-data.model';
import { type MultithreadingOptions } from '../models/multithreading-options.model';
import { ThreadJobData, ThreadJobDataFunctions } from '../models/thread-job-data.model';
import { ThreadJobEntity } from '../models/thread-job-entity.model';
import { ThreadJobFunction } from '../models/thread-job-function.model';
import { ThreadJobMessage } from '../models/thread-job-message.model';
import { ThreadJobStatus } from '../models/thread-job-status.enum';

/**
 * A service that handles multithreading.
 */
@Injectable({ register: 'onUse' })
export class MultithreadingService implements MultithreadingServiceInterface, OnAppInit, OnAppShutdown {
    /**
     * All thread jobs.
     */
    private queue: ThreadJob<BaseThreadJobWorkerData, unknown>[] = [];
    /**
     * The workers that are currently running.
     */
    private workers: ThreadJobWorker[] = [];
    /**
     * The workers that are currently idle.
     */
    private idleWorkers: ThreadJobWorker[] = [];
    private readonly threadJobWorkerFilePath: FsPath;

    constructor(
        @Inject(ZIBRI_DI_TOKENS.MULTITHREADING_OPTIONS)
        private readonly options: MultithreadingOptions,
        @Inject(ZIBRI_DI_TOKENS.ASSET_SERVICE)
        private readonly assetService: AssetServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        private readonly logger: LoggerInterface,
        @InjectRepository(ThreadJobEntity)
        private readonly threadJobEntityRepository: Repository<ThreadJobEntity<BaseThreadJobWorkerData, unknown>>
    ) {
        this.threadJobWorkerFilePath = FsUtilities.getPath(this.assetService.assetsPath, 'thread-job.worker.cjs');
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onAppInit(): Promise<void> {
        await this.validateInputs();

        await this.logger.info('initializes worker pool for multithreading');
        await this.logger.info(`  - ${this.options.maxThreads} normal thread job workers`);
        await this.logger.info(`  - ${this.options.maxPriorityThreads} priority thread job workers`);

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
    }

    private initWorker(priority: boolean): void {
        const worker: Worker = new Worker(this.threadJobWorkerFilePath);
        const threadJobWorker: ThreadJobWorker = new ThreadJobWorker(worker, priority, worker.threadId);

        worker.on('message', m => void this.handleWorkerMessage(m, threadJobWorker.threadId));
        worker.on('exit', code => void this.handleWorkerExit(code, threadJobWorker.threadId));
        worker.on('error', (error: Error) => void this.handleWorkerError(error, threadJobWorker.threadId));

        this.idleWorkers.push(threadJobWorker);
    }

    private async validateInputs(): Promise<void> {
        const workerFileExists: boolean = await FsUtilities.exists(this.threadJobWorkerFilePath);
        if (!workerFileExists) {
            throw new Error(`Could not start MultithreadingService: The worker file at ${this.threadJobWorkerFilePath} does not exist.`);
        }

        const availableThreads: number = os.availableParallelism();
        const maxThreads: number = this.options.maxThreads + this.options.maxPriorityThreads;

        if (maxThreads > availableThreads) {
            throw new Error(
                [
                    `The MultithreadingService was configured to start up to ${maxThreads}`,
                    `(${this.options.maxThreads} + ${this.options.maxPriorityThreads}) workers,`,
                    `but there are only ${availableThreads} threads available`
                ].join(' ')
            );
        }

        if (this.options.maxThreads < 1) {
            throw new Error(
                'The MultithreadingService was configured to have less than 1 thread available. It will not be able to execute anything.'
            );
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async queueThreadJob<WorkerData extends BaseThreadJobWorkerData, ResultType>(
        threadJobData: ThreadJobData<WorkerData>
    ): Promise<string> {
        const entityData: OmitStrict<ThreadJobEntity<WorkerData, ResultType>, 'id'> = {
            queuedAtMs: Date.now(),
            status: ThreadJobStatus.IN_QUEUE,
            priority: threadJobData.priority ?? false,
            progress: 0,
            workerData: threadJobData.workerData,
            timeout: threadJobData.timeout ?? this.getDefaultTimeout(threadJobData.priority ?? false)
        };

        const entity: ThreadJobEntity<BaseThreadJobWorkerData, unknown> = await this.threadJobEntityRepository.create(entityData);
        const threadJob: ThreadJob<BaseThreadJobWorkerData, unknown> = new ThreadJob(entity, 'job', threadJobData);
        this.queue.push(threadJob);
        await this.startJobs();

        return threadJob.id;
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
                filePath: '',
                func: func.toString(),
                input
            },
            timeout: timeout ?? this.getDefaultTimeout(priority)
        };

        const threadJob: ThreadJob<BaseThreadJobWorkerData, ResultType> = new ThreadJob(entityData, 'function');
        this.queue.push(threadJob);
        await this.startJobs();
        const finishedJob: ThreadJobEntity<BaseFunctionThreadJobWorkerData<InputType>, ResultType>
            = await this.waitForThreadJob(threadJob.id);

        if (finishedJob.status === ThreadJobStatus.COMPLETED) {
            return finishedJob.result as ResultType;
        }
        if (finishedJob.error) {
            throw finishedJob.error;
        }
        throw new Error(`Running the function "${func.name}" on a worker was not successful`);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async requeueThreadJob(jobId: string, data?: ThreadJobDataFunctions): Promise<void> {
        await this.threadJobEntityRepository.updateById(jobId, {
            error: undefined,
            progress: 0,
            queuedAtMs: Date.now(),
            status: ThreadJobStatus.IN_QUEUE,
            startedAtMs: undefined,
            stoppedAtMs: undefined
        });

        const entity: ThreadJobEntity<BaseThreadJobWorkerData, unknown> = await this.threadJobEntityRepository.findById(jobId);
        const threadJob: ThreadJob<BaseThreadJobWorkerData, unknown> = new ThreadJob(entity, 'job', data);
        this.queue.push(threadJob);
        await this.startJobs();
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
    async waitForThreadJob<ResultType, WorkerData extends BaseThreadJobWorkerData = BaseThreadJobWorkerData>(
        jobId: string
    ): Promise<ThreadJobEntity<WorkerData, ResultType>> {
        const foundJob: ThreadJob<BaseThreadJobWorkerData, unknown> | undefined = this.queue.find(j => j.id === jobId);
        if (!foundJob) {
            throw new Error(`No thread job with the id ${jobId} could be found in the queue.`);
        }
        await firstValueFrom(foundJob.completedSubject.pipe(filter(i => i)));

        if (foundJob.type === 'function') {
            const updatedJob: ThreadJob<BaseThreadJobWorkerData, unknown> | undefined = this.queue.find(j => j.id === jobId);
            this.queue = this.queue.filter(j => j.id !== jobId);
            return updatedJob as unknown as ThreadJobEntity<WorkerData, ResultType>;
        }

        return await this.threadJobEntityRepository.findById(jobId) as ThreadJobEntity<WorkerData, ResultType>;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onAppShutdown(): Promise<void> {
        await Promise.all([
            ...this.workers.map(w => w.worker.terminate()),
            ...this.idleWorkers.map(w => w.worker.terminate())
        ]);

        this.idleWorkers = [];
        this.workers = [];

        // queue will be empty because of the terminates.
        // this.queue = [];
    }

    private getDefaultTimeout(priority: boolean): number {
        return priority ? this.options.defaultTimeoutMs : this.options.defaultTimeoutPriorityMs;
    }

    private async startJobs(): Promise<void> {
        // check if a new job is available and can be started
        if (!this.idleWorkers.length) {
            return;
        }

        // eslint-disable-next-line stylistic/max-len
        const waitingJobs: ThreadJob<BaseThreadJobWorkerData, unknown>[] = this.queue.filter(job => job.status === ThreadJobStatus.IN_QUEUE);
        if (!waitingJobs.length) {
            return;
        }

        const waitingPriorityJobs: ThreadJob<BaseThreadJobWorkerData, unknown>[] = waitingJobs.filter(j => j.priority);

        if (waitingPriorityJobs.length) {

            // eslint-disable-next-line stylistic/max-len
            const waitingJob: ThreadJob<BaseThreadJobWorkerData, unknown> = waitingPriorityJobs.sort((a, b) => b.queuedAtMs - a.queuedAtMs)[0];

            const idlePriorityWorker: ThreadJobWorker | undefined = this.idleWorkers.find(w => w.priority);

            if (idlePriorityWorker) {

                this.idleWorkers = this.idleWorkers.filter(w => w.threadId !== idlePriorityWorker.threadId);

                this.workers.push(idlePriorityWorker);

                await this.startJob(waitingJob, idlePriorityWorker);

                return;

            }

            // Try to use a normal worker as a fallback when no priority workers are available.

            // pop can be used here as there are idle workers and all of them are not priority.

            const idleWorker: ThreadJobWorker = this.idleWorkers.pop() as ThreadJobWorker;

            this.workers.push(idleWorker);

            await this.startJob(waitingJob, idleWorker);

            return;

        }

        // only "normal", not priority jobs remain here
        const waitingJob: ThreadJob<BaseThreadJobWorkerData, unknown> = waitingJobs.sort((a, b) => b.queuedAtMs - a.queuedAtMs)[0];
        const idleWorker: ThreadJobWorker | undefined = this.idleWorkers.find(w => !w.priority);
        if (!idleWorker) {
            return;
        }

        this.idleWorkers = this.idleWorkers.filter(w => w.threadId !== idleWorker.threadId);
        this.workers.push(idleWorker);
        await this.startJob(waitingJob, idleWorker);
    }

    private async startJob(job: ThreadJob<BaseThreadJobWorkerData, unknown>, worker: ThreadJobWorker): Promise<void> {
        worker.worker.postMessage(job.workerData);
        // eslint-disable-next-line typescript/no-misused-promises
        worker.timeout = setTimeout(async () => {
            await this.updateThreadJobById(job.id, { error: new Error('Timeout') });
            await worker.worker.terminate();
        }, job.timeout);

        await this.updateThreadJobById(
            job.id,
            { startedAtMs: Date.now(), status: ThreadJobStatus.IN_PROGRESS, threadId: worker.threadId }
        );
    }

    private async handleWorkerMessage<MessageType>(message: MessageType, threadId: number): Promise<void> {
        await this.logger.debug(`got message from worker:\n${JsonUtilities.stringify(message, undefined, 2)}`);

        const job: ThreadJob<BaseThreadJobWorkerData, unknown> | undefined = this.getJobByThreadId(threadId);
        if (!job) {
            if (this.isThreadJobMessage(message) && message.type === 'initialization') {
                this.handleInitializationMessage(threadId);
            }
            return;
        }

        if (!this.isThreadJobMessage(message)) {
            job.onMessage?.(message);
            return;
        }

        switch (message.type) {
            case 'progress': {
                await this.updateThreadJobById(job.id, { progress: message.progress });
                if (message.progress === 100) {
                    await this.updateThreadJobById(
                        job.id,
                        { status: ThreadJobStatus.COMPLETED, threadId: undefined, stoppedAtMs: Date.now() }
                    );
                    job.onComplete?.();
                    await this.handleJobCompletion(job, threadId);
                }
                return;
            }
            case 'completion': {
                await this.updateThreadJobById(job.id, {
                    status: ThreadJobStatus.COMPLETED,
                    threadId: undefined,
                    stoppedAtMs: Date.now(),
                    progress: 100,
                    result: message.result
                });
                job.onComplete?.();
                await this.handleJobCompletion(job, threadId);
                return;
            }
            case 'status': {
                await this.updateThreadJobById(job.id, { status: message.status });
                return;
            }
            case 'error': {
                await this.updateThreadJobById(
                    job.id,
                    { status: ThreadJobStatus.FAILED, threadId: undefined, stoppedAtMs: Date.now(), error: message.error }
                );
                job.onError?.(message.error);
                await this.handleJobCompletion(job, threadId);
                return;
            }
            case 'initialization': {
                this.handleInitializationMessage(threadId);
            }
        }
    }

    private async handleJobCompletion<WorkerData extends BaseThreadJobWorkerData, ResultType>(
        job: ThreadJob<WorkerData, ResultType>,
        threadId: number
    ): Promise<void> {
        job.completedSubject.next(true);
        if (job.type === 'job') {
            this.queue = this.queue.filter(j => j.id !== job.id);
        }
        this.freeWorker(threadId);
        await this.startJobs();
    }

    private handleInitializationMessage(threadId: number): void {
        this.getWorkerByThreadId(threadId)?.isInitializingSubject.next(false);
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
            // try to recover the worker thread.
            this.initWorker(foundWorker.priority);
            return;
        }

        this.idleWorkers.push(foundWorker);
    }

    private getJobByThreadId(threadId: number): ThreadJob<BaseThreadJobWorkerData, unknown> | undefined {
        return this.queue.find(j => j.threadId === threadId);
    }

    private getWorkerByThreadId(threadId: number): ThreadJobWorker | undefined {
        return this.workers.find(w => w.threadId === threadId) ?? this.idleWorkers.find(w => w.threadId === threadId);
    }

    /**
     * This should only happen on shutdown.
     * To see where an error from the thread job is actually handled take a look at "handleWorkerMessage".
     * @param exitCode - The code that the worker exited with.
     * @param threadId - The thread id of the worker.
     */
    private async handleWorkerExit(exitCode: number, threadId: number): Promise<void> {
        const job: ThreadJob<BaseThreadJobWorkerData, unknown> | undefined = this.getJobByThreadId(threadId);
        if (!job) {
            return;
        }

        if (exitCode !== 0) {
            await this.updateThreadJobById(job.id, {
                stoppedAtMs: Date.now(),
                status: ThreadJobStatus.FAILED,
                threadId: undefined
            });

            await this.handleJobCompletion(job, threadId);
            return;
        }

        await this.updateThreadJobById(job.id, {
            stoppedAtMs: Date.now(),
            status: ThreadJobStatus.CANCELLED,
            threadId: undefined
        });

        job.onCancel?.();
        await this.handleJobCompletion(job, threadId);
    }

    /**
     * This should actually never happen, as the whole worker crashes and not just the current task.
     * That's why the provided "onError"-method from the threadJob data is not called.
     * To see where an error from the thread job is actually handled take a look at "handleWorkerMessage".
     * @param error - The error that crashed the worker.
     * @param threadId - The threadId of the worker that crashed.
     */

    private async handleWorkerError(error: Error, threadId: number): Promise<void> {
        const job: ThreadJob<BaseThreadJobWorkerData, unknown> | undefined = this.getJobByThreadId(threadId);
        if (!job) {
            return;
        }

        await this.updateThreadJobById(job.id, {
            stoppedAtMs: Date.now(),
            status: ThreadJobStatus.FAILED,
            error: error,
            threadId: undefined
        });

        await this.handleJobCompletion(job, threadId);
    }

    private async updateThreadJobById(id: string, data: Partial<ThreadJob<BaseThreadJobWorkerData, unknown>>): Promise<void> {
        const existingJob: ThreadJob<BaseThreadJobWorkerData, unknown> = this.queue[this.queue.findIndex(j => j.id === id)];
        this.queue[this.queue.findIndex(j => j.id === id)] = {
            ...existingJob,
            ...data
        };

        if (existingJob.type === 'job') {
            await this.threadJobEntityRepository.updateById(id, data);
        }
    }

    private isThreadJobMessage(value: unknown): value is ThreadJobMessage {
        return typeof value === 'object' && !!(value as ThreadJobMessage).type;
    }
}