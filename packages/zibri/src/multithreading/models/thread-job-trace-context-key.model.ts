/**
 * Where a worker keeps the trace context of the job it is running, on its `workerData`.
 *
 * A symbol, so that it is no property of the data the job was queued with - neither in its keys nor
 * in what it is written out as. From the global registry, so that the worker and a worker file that
 * loads the framework as another module copy find the same one.
 */
export const THREAD_JOB_TRACE_CONTEXT_KEY: unique symbol = Symbol.for('zibri.threadJobTraceContext');