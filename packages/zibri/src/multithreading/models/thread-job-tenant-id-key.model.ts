/**
 * Where a worker keeps the tenant of the job it is running, on its `workerData`.
 *
 * A symbol for the reasons `THREAD_JOB_TRACE_CONTEXT_KEY` is one: no property of the data the job was
 * queued with, and the same one for a worker file that loads the framework as another module copy.
 */
export const THREAD_JOB_TENANT_ID_KEY: unique symbol = Symbol.for('zibri.threadJobTenantId');