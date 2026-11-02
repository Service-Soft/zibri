import { randomUUID } from 'node:crypto';
import { MessagePort, parentPort, workerData } from 'node:worker_threads';

import { InternalError } from '../../../error-handling/internal-error.model';
import { errorToLoggedError } from '../../../logging/error-to-logged-error.function';
import { TraceSpanContext } from '../../../tracing/trace-span-context.model';
import { Percentage } from '../../../types/percentage.type';
import { ThreadJobCheckpointAnswer } from '../../models/thread-job-checkpoint-answer.model';
import { THREAD_JOB_CHECKPOINT_KEY } from '../../models/thread-job-checkpoint-key.model';
import { ThreadJobCheckpoint } from '../../models/thread-job-checkpoint.model';
import { THREAD_JOB_ID_KEY } from '../../models/thread-job-id-key.model';
import { ThreadJobMessage } from '../../models/thread-job-message.model';
import { THREAD_JOB_TENANT_ID_KEY } from '../../models/thread-job-tenant-id-key.model';
import { THREAD_JOB_TRACE_CONTEXT_KEY } from '../../models/thread-job-trace-context-key.model';
import { ThreadJobCheckpointNotStoredError } from '../../thread-job-checkpoint-not-stored.error';

/**
 * The trace the running thread job is recorded under, called from within a worker file.
 *
 * Pass it on to whatever the job calls, so that the work there continues the job's trace - for example
 * the headers of an outgoing request, with `TraceContextUtilities.resolveHeaders(context)`, or the
 * trace id on a log line.
 * @returns The context, or undefined outside a thread job.
 */
export function getThreadJobTraceContext(): TraceSpanContext | undefined {
    const data: unknown = workerData;
    if (typeof data !== 'object' || data == undefined || !(THREAD_JOB_TRACE_CONTEXT_KEY in data)) {
        return undefined;
    }
    const context: unknown = data[THREAD_JOB_TRACE_CONTEXT_KEY];
    return isTraceSpanContext(context) ? context : undefined;
}

/**
 * The tenant the running thread job was queued in, called from within a worker file.
 *
 * A worker thread runs the jobs of every tenant, one after another, and what a job leaves behind
 * outside its own file is there for the next one. Key what a worker file keeps per tenant by this.
 * @returns The id of the tenant, or undefined for a job of no tenant and outside a thread job.
 */
export function getThreadJobTenantId(): string | undefined {
    const data: unknown = workerData;
    if (typeof data !== 'object' || data == undefined || !(THREAD_JOB_TENANT_ID_KEY in data)) {
        return undefined;
    }
    const tenantId: unknown = data[THREAD_JOB_TENANT_ID_KEY];
    return typeof tenantId === 'string' ? tenantId : undefined;
}

/**
 * Whether a value is a trace context, as it arrives on the other side of a thread.
 * @param value - The value.
 * @returns True when it holds the ids and the sampled flag of one.
 */
function isTraceSpanContext(value: unknown): value is TraceSpanContext {
    return typeof value === 'object' && value != undefined
        && 'traceId' in value && typeof value.traceId === 'string'
        && 'spanId' in value && typeof value.spanId === 'string'
        && 'sampled' in value && typeof value.sampled === 'boolean';
}

/**
 * How far a thread job has got, as `reportProgress` and `reportCheckpoint` take it.
 * @param done - How much of the work is done, such as the items handled so far.
 * @param total - How much work there is in all.
 * @returns The share done in whole percent, rounded down and from 0 to 100. 100 when there is no work,
 * and 0 when either count is not a number.
 */
export function resolveThreadJobProgress(done: number, total: number): Percentage {
    const share: number = total > 0 ? Math.floor(done / total * 100) : 100;
    const bounded: number = Math.min(100, Math.max(0, share));
    return isPercentage(bounded) ? bounded : 0;
}

/**
 * Whether a number is a whole percent from 0 to 100.
 * @param value - The number.
 * @returns True when it is.
 */
function isPercentage(value: number): value is Percentage {
    return Number.isInteger(value) && value >= 0 && value <= 100;
}

/**
 * Reports the given progress to the thread job service.
 * @param progress - The progress to report.
 */
export function reportProgress(progress: Percentage): void {
    const message: ThreadJobMessage = {
        type: 'progress',
        progress
    };
    parentPort?.postMessage(message);
}

/**
 * The id of the running thread job, called from within a worker file.
 * @returns The id, or undefined outside a thread job.
 */
export function getThreadJobId(): string | undefined {
    const data: unknown = workerData;
    if (typeof data !== 'object' || data == undefined || !(THREAD_JOB_ID_KEY in data)) {
        return undefined;
    }
    const jobId: unknown = data[THREAD_JOB_ID_KEY];
    return typeof jobId === 'string' ? jobId : undefined;
}

/**
 * The last checkpoint stored for the running thread job, called from within a worker file.
 *
 * A job taken over or started again after a restart runs its worker file from the top, and resumes
 * from what this returns.
 * @returns The checkpoint, or undefined when the job stored none and outside a thread job.
 */
export function getThreadJobCheckpoint<State>(): ThreadJobCheckpoint<State> | undefined {
    const data: unknown = workerData;
    return typeof data !== 'object' || data == undefined || !(THREAD_JOB_CHECKPOINT_KEY in data)
        ? undefined
        // stored as the job reported it, and the job says what its state is
        : data[THREAD_JOB_CHECKPOINT_KEY] as ThreadJobCheckpoint<State> | undefined;
}

/**
 * A key naming one effect of the work the running thread job does after its last checkpoint, called
 * from within a worker file.
 *
 * The same when that work runs again, after a takeover or a restart, and different for the work after
 * the next checkpoint. Hand it to whatever the effect goes to, for example as the `Idempotency-Key`
 * header of a request, so that it can tell the second time apart from a new effect.
 * @param name - Which effect of that work the key is for.
 * @returns The key: the job's id, the number of its last checkpoint and the name.
 * @throws When called outside a thread job.
 */
export function getThreadJobIdempotencyKey(name: string): string {
    const jobId: string | undefined = getThreadJobId();
    if (jobId == undefined) {
        throw new InternalError('getThreadJobIdempotencyKey can only be called from within a thread job.');
    }
    return `${jobId}:${getThreadJobCheckpoint()?.number ?? 0}:${name}`;
}

/**
 * Stores a checkpoint of the running thread job, called from within a worker file.
 *
 * The state is stored on the job's row together with the progress, and a run started after this, on
 * a takeover or after a restart, resumes from it through `getThreadJobCheckpoint`. Await it before
 * going on, so the work after it only starts once there is something to resume from.
 * @param progress - How far the job has got. It does not complete the job, even at 100.
 * @param state - What the job needs to go on from here. Stored as json.
 * @throws ThreadJobCheckpointNotStoredError when it is not stored: another run took the job over, or
 * the write failed. Let it end the run.
 * @throws When called outside a thread job.
 */
export async function reportCheckpoint<State>(progress: Percentage, state: State): Promise<void> {
    const port: MessagePort | null = parentPort;
    if (port == undefined || getThreadJobId() == undefined) {
        throw new InternalError('reportCheckpoint can only be called from within a thread job.');
    }
    // node's own rather than UUIDUtilities, which would load the entity metadata into every worker
    const checkpointId: string = randomUUID();
    const checkpoint: ThreadJobCheckpoint<State> = { progress, state, number: (getThreadJobCheckpoint()?.number ?? 0) + 1 };

    // listened for here rather than in the worker, because the framework this file is part of can be
    // a copy of its own, which the worker's listener would know nothing about
    const answered: Promise<void> = new Promise((resolve, reject) => {
        const onAnswer: (answer: unknown) => void = answer => {
            if (!isCheckpointAnswer(answer) || answer.checkpointId !== checkpointId) {
                return;
            }
            port.off('message', onAnswer);
            if (answer.type === 'checkpointNotStored') {
                reject(new ThreadJobCheckpointNotStoredError(answer.reason));
                return;
            }
            // what the next checkpoint is numbered from and the idempotency key counts by
            if (typeof workerData === 'object' && workerData != undefined) {
                Reflect.set(workerData, THREAD_JOB_CHECKPOINT_KEY, checkpoint);
            }
            resolve();
        };
        port.on('message', onAnswer);
    });
    const message: ThreadJobMessage = { type: 'checkpoint', checkpointId, checkpoint };
    port.postMessage(message);
    await answered;
}

/**
 * Whether a message the worker received answers a checkpoint.
 * @param value - The message.
 * @returns True when it says whether a checkpoint is stored.
 */
function isCheckpointAnswer(value: unknown): value is ThreadJobCheckpointAnswer {
    return typeof value === 'object' && value != undefined
        && 'type' in value && (value.type === 'checkpointStored' || value.type === 'checkpointNotStored')
        && 'checkpointId' in value && typeof value.checkpointId === 'string';
}

/**
 * Reports the completion of a thread job.
 * @param result - The result of the job.
 */
export function reportCompletion<T>(result?: T): void {
    const message: ThreadJobMessage = {
        type: 'completion',
        result
    };
    parentPort?.postMessage(message);
}

/**
 * Reports an error inside a thread job.
 * @param error - What was thrown, an `Error` or anything else.
 * @param fatal - Whether the worker is ending itself because of this, so the parent knows not to
 * hand it another job in the moment it has left.
 */
export function reportError(error: unknown, fatal: boolean = false): void {
    const message: ThreadJobMessage = {
        type: 'error',
        // name/message/stack are non-enumerable on Error instances, so they would be lost once the
        // reported error is JSON-serialized for persistence. `errorToLoggedError` is what the rest
        // of the framework stores a failure as, and it follows the `cause` chain, which the flat
        // shape this used to build dropped.
        error: errorToLoggedError(error instanceof Error ? error : new Error(`${String(error)}`)),
        fatal
    };
    parentPort?.postMessage(message);
}