import { parentPort, workerData } from 'node:worker_threads';

import { errorToLoggedError } from '../../../logging/error-to-logged-error.function';
import { TraceSpanContext } from '../../../tracing/trace-span-context.model';
import { Percentage } from '../../../types/percentage.type';
import { ThreadJobMessage } from '../../models/thread-job-message.model';
import { THREAD_JOB_TRACE_CONTEXT_KEY } from '../../models/thread-job-trace-context-key.model';

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
 * @param error - The error to report.
 * @param fatal - Whether the worker is ending itself because of this, so the parent knows not to
 * hand it another job in the moment it has left.
 */
export function reportError(error: Error, fatal: boolean = false): void {
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