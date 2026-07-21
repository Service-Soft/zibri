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
     * @param threadJobData - The data to create the thread job from.
     * @returns The id of the created thread job in the data source and queue.
     *
     * **This differs from the threadId, which is created by the os and set when the thread actually starts.**.
     */
    queueThreadJob: <WorkerData extends BaseThreadJobWorkerData | BaseFunctionThreadJobWorkerData<unknown>>(
        threadJobData: ThreadJobData<WorkerData>
    ) => Promise<string> | string,
    /**
     * Queues a thread job for the given data and waits for its completion.
     * @param threadJobData - The data of the job to queue.
     * @returns The thread job.
     */
    runThreadJob: <WorkerData extends BaseThreadJobWorkerData | BaseFunctionThreadJobWorkerData<unknown>, ResultType>(
        threadJobData: ThreadJobData<WorkerData>
    ) => Promise<ThreadJobEntity<WorkerData, ResultType>> | ThreadJobEntity<WorkerData, ResultType>,
    /**
     * Runs the given function on a separate thread. This will not persist the state in the data source.
     *
     ***IMPORTANT**: This uses "eval" in the thread worker, so make sure that the data passed is not malicious.
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
    rerunThreadJob: <WorkerData extends BaseThreadJobWorkerData | BaseFunctionThreadJobWorkerData<unknown>, ResultType>(
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
    ) => Promise<ThreadJobEntity<WorkerData, ResultType>> | ThreadJobEntity<WorkerData, ResultType>
}