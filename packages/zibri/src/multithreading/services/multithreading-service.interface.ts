import { BaseFunctionThreadJobWorkerData, BaseThreadJobWorkerData } from '../models/base-thread-job-worker-data.model';
import { ThreadJobData, ThreadJobDataFunctions } from '../models/thread-job-data.model';
import { ThreadJobEntity } from '../models/thread-job-entity.model';
import { ThreadJobFunction } from '../models/thread-job-function.model';

/**
 * Definition for a service that handles multithreading.
 */
export interface MultithreadingServiceInterface {
    /**
     * Creates and queues a thread job with the given data.
     *
     * Names a file, because the job outlives the process: it is written to a row and can be requeued
     * long after this call. A function cannot be stored as anything but source, so it is `run`'s
     * business rather than this one's.
     * @param threadJobData - The data to create the thread job from.
     * @returns The id of the created thread job in the data source and queue.
     *
     * **This differs from the threadId, which is created by the os and set when the thread actually starts.**.
     */
    queueThreadJob: <WorkerData extends BaseThreadJobWorkerData>(
        threadJobData: ThreadJobData<WorkerData>
    ) => Promise<string> | string,
    /**
     * Queues a thread job for the given data and waits for its completion.
     * @param threadJobData - The data of the job to queue.
     * @returns The thread job.
     */
    runThreadJob: <WorkerData extends BaseThreadJobWorkerData, ResultType>(
        threadJobData: ThreadJobData<WorkerData>
    ) => Promise<ThreadJobEntity<WorkerData, ResultType>> | ThreadJobEntity<WorkerData, ResultType>,
    /**
     * Runs the given function on a separate thread. This will not persist the state in the data source.
     *
     * The function is handed to the worker as source and rebuilt there, so it sees its arguments and
     * the worker's globals and nothing else. A variable it captured from around itself is a
     * `ReferenceError` when it runs rather than an error where it was written - pass what it needs
     * through `input`.
     * @param func - The function that should be run in a separate thread.
     * @param input - The input value of the function.
     * @param timeout - A custom timeout for the task. Defaults to 5 minutes or an hour, depending on the priority.
     * @param priority - Whether or not the function should make use of priority workers or not. Defaults to **true**.
     * @returns The result value of the function passed.
     * @throws When either the function itself throws an error or something didn't work during parsing/evaluation.
     */
    run: <InputType, ResultType>(
        func: ThreadJobFunction<InputType, ResultType>,
        input: InputType,
        timeout?: number,
        priority?: boolean
    ) => Promise<ResultType> | ResultType,
    /**
     * Requeues a thread job that was already completed.
     * @param jobId - The id of the job to requeue.
     * @param data - Additional data for the job.
     */
    requeueThreadJob: (jobId: string, data?: ThreadJobDataFunctions) => Promise<void> | void,
    /**
     * Reruns a thread job that was already completed.
     * @param jobId - The id of the job to rerun.
     * @param data - Additional data for the job.
     * @returns The thread job.
     */
    rerunThreadJob: <WorkerData extends BaseThreadJobWorkerData, ResultType>(
        jobId: string,
        data?: ThreadJobDataFunctions
    ) => Promise<ThreadJobEntity<WorkerData, ResultType>> | ThreadJobEntity<WorkerData, ResultType>,
    /**
     * Waits for the thread job with the given id to complete.
     * @param jobId - The id of the thread job to wait for.
     * @returns The thread job.
     */
    waitForThreadJob: <
        ResultType,
        WorkerData extends BaseThreadJobWorkerData | BaseFunctionThreadJobWorkerData<unknown> = BaseThreadJobWorkerData
    >(
        jobId: string
    ) => Promise<ThreadJobEntity<WorkerData, ResultType>> | ThreadJobEntity<WorkerData, ResultType>,
    /**
     * Gives work to every worker that is free to take some.
     *
     * Queued jobs are rows, so what a worker takes next may have been queued by any instance, and
     * this is how one of them is found and claimed. Called for you: when a job is queued here, when
     * a worker finishes, when the application starts, and on a poll for everything else.
     *
     * Keeps going until a round finds nothing. Starting one job per call is only right while every
     * job arrives with a call of its own, and a poll that finds fifty waiting rows is one call.
     */
    startQueuedJobs: () => Promise<void> | void
}