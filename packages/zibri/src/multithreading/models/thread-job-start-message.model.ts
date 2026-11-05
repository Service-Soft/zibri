import { BaseFunctionThreadJobWorkerData, BaseThreadJobWorkerData } from './base-thread-job-worker-data.model';
import { ThreadJobCheckpoint } from './thread-job-checkpoint.model';
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
    traceContext: TraceSpanContext,
    /**
     * The tenant the job was queued in, or undefined for a job of no tenant.
     */
    tenantId: string | undefined,
    /**
     * The id of the job.
     */
    jobId: string,
    /**
     * The last checkpoint the job stored, which this run resumes from, or undefined for none.
     */
    checkpoint: ThreadJobCheckpoint<unknown> | undefined
};