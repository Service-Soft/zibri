import { ThreadJob } from './thread-job';
import { ThreadJobWorker } from './thread-job-worker';
import { type LoggerInterface } from '../../logging/logger.interface';
import { BaseFunctionThreadJobWorkerData, BaseThreadJobWorkerData } from '../models/base-thread-job-worker-data.model';

/**
 * What handling the events of a pool's workers does to the pool and to its jobs, provided by the
 * service the pool belongs to.
 */
export type ThreadJobWorkerEvents = {
    /**
     * Where what a worker reports is logged.
     */
    logger: LoggerInterface,
    /**
     * Finds the job a worker is running.
     */
    findJob: (threadId: number) => ThreadJob<BaseThreadJobWorkerData | BaseFunctionThreadJobWorkerData<unknown>, unknown> | undefined,
    /**
     * Finds a worker of the pool, running or idle.
     */
    findWorker: (threadId: number) => ThreadJobWorker | undefined,
    /**
     * Writes what became of a job, to the job and to its row. Resolves to false when the write landed
     * on nothing, because another instance started the job since.
     */
    updateJob: (
        id: string,
        data: Partial<ThreadJob<BaseThreadJobWorkerData | BaseFunctionThreadJobWorkerData<unknown>, unknown>>
    ) => Promise<boolean>,
    /**
     * Calls back the code that queued a job, in the tenant it was queued in.
     */
    callBack: (
        job: ThreadJob<BaseThreadJobWorkerData | BaseFunctionThreadJobWorkerData<unknown>, unknown>,
        notify: () => void
    ) => Promise<void>,
    /**
     * Settles a job that is over, hands its worker back and hands the waiting jobs to free workers.
     */
    completeJob: (
        job: ThreadJob<BaseThreadJobWorkerData | BaseFunctionThreadJobWorkerData<unknown>, unknown>,
        threadId: number
    ) => Promise<void>,
    /**
     * Settles a job that is over without handing its worker back.
     */
    settleJob: (job: ThreadJob<BaseThreadJobWorkerData | BaseFunctionThreadJobWorkerData<unknown>, unknown>) => void,
    /**
     * Hands the waiting jobs to free workers.
     */
    startQueuedJobs: () => Promise<boolean>,
    /**
     * Takes a worker that ended without a job out of the pool.
     */
    replaceDeadWorker: (exitCode: number, threadId: number) => void
};