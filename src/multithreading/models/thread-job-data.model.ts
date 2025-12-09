import { BaseThreadJobWorkerData } from './base-thread-job-worker-data.model';

/**
 * The function values of the thread job data.
 * This is separated because this cannot be persisted in a data source.
 */
export type ThreadJobDataFunctions = {
    /**
     * What should happen when a message is received from the thread job.
     */
    onMessage?: (message: unknown) => void,
    /**
     * What should happen when the thread job completes.
     */
    onComplete?: () => void,
    /**
     * What should happen when the thread job was cancelled.
     */
    onCancel?: () => void,
    /**
     * What should happen when an error occurs inside the thread job.
     */
    onError?: (error: Error) => void
};

/**
 * Data that is needed to start a thread job.
 */
export type ThreadJobData<T extends BaseThreadJobWorkerData> = ThreadJobDataFunctions & {
    /**
     * Data that should be passed to the worker.
     */
    workerData: T,
    /**
     * Wether or not the job should use priority workers.
     * @default false
     */
    priority?: boolean,
    /**
     * The timeout after which the job should exit with an error.
     * @default one hour in ms.
     */
    timeout?: number
};