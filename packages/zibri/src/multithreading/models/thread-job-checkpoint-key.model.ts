/**
 * Where a worker keeps the last checkpoint stored for the job it is running, on its `workerData`.
 *
 * A symbol for the reasons `THREAD_JOB_TRACE_CONTEXT_KEY` is one: no property of the data the job was
 * queued with, and the same one for a worker file that loads the framework as another module copy.
 * The second reason matters more here than for the others: `reportCheckpoint` writes it, and the copy
 * of the framework that does is not always the copy that started the job.
 */
export const THREAD_JOB_CHECKPOINT_KEY: unique symbol = Symbol.for('zibri.threadJobCheckpoint');