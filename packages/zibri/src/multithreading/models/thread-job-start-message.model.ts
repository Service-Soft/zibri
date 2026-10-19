import { BaseFunctionThreadJobWorkerData, BaseThreadJobWorkerData } from './base-thread-job-worker-data.model';
import { TraceSpanContext } from '../../tracing/trace-span-context.model';

/**
 * What a worker is handed to run a job.
 */
export type ThreadJobStartMessage = {
    /**
     * The data the job was queued with, which the worker file reads as its `workerData`.
     */
    workerData: BaseThreadJobWorkerData | BaseFunctionThreadJobWorkerData<unknown>,
    /**
     * The span the run of the job is recorded as, for whatever the worker passes the trace on to.
     */
    traceContext: TraceSpanContext
};