/* eslint-disable jsdoc/require-jsdoc */
import { parentPort, workerData } from 'node:worker_threads';

import { reportCompletion, reportError } from './helpers';
import { loadWorkerFile } from './load-worker-file.function';
import { CacheStoreInterface } from '../../../caching/store/cache-store.interface';
import { InMemoryCacheStore } from '../../../caching/store/in-memory.cache-store';
import { InternalError } from '../../../error-handling/internal-error.model';
import type { TraceSpanContext } from '../../../tracing/trace-span-context.model';
import type { BaseThreadJobWorkerData, BaseFunctionThreadJobWorkerData } from '../../models/base-thread-job-worker-data.model';
import type { ThreadJobFunction } from '../../models/thread-job-function.model';
import type { ThreadJobMessage } from '../../models/thread-job-message.model';
import type { ThreadJobStartMessage } from '../../models/thread-job-start-message.model';
import { THREAD_JOB_TRACE_CONTEXT_KEY } from '../../models/thread-job-trace-context-key.model';

if (!parentPort) {
    throw new InternalError('Internal Error with the thread-job-worker: parentPort not available.');
}

const functionCache: CacheStoreInterface<string, ThreadJobFunction<unknown, unknown>> = new InMemoryCacheStore();

/**
 * Ends the worker after telling the parent why.
 *
 * Node's own guidance for `uncaughtException` is that the handler has to end the process: whatever
 * was half done when the throw happened stays half done, and here that state is shared with the next
 * tenant of this thread - module scope, the `functionCache` below, anything a job left behind.
 * Reporting and carrying on was handing that to the next job.
 *
 * Reported before exiting rather than left to the exit code, because the parent's exit handler can
 * only say the job failed - the message is what carries the error itself and reaches the job's
 * `onError`. The exit waits a turn of the loop so that message is actually delivered.
 * @param error - What could not be handled.
 */
function reportAndExit(error: Error): void {
    reportError(error, true);
    setImmediate(() => process.exit(1));
}

process.on('uncaughtException', (err) => {
    reportAndExit(err);
});

process.on('unhandledRejection', (err) => {
    const error: Error = err instanceof Error ? err : new Error(`${err}`);
    reportAndExit(error);
});

const message: ThreadJobMessage = { type: 'initialization' };

parentPort.postMessage(message);

parentPort.on('message', ({ workerData: wData, traceContext }: ThreadJobStartMessage) => {
    updateWorkerData(wData, traceContext);

    if (isFunctionWorkerData(wData)) {
        void callFunction(wData);
        return;
    }

    // running the file again for every job - including clearing it out of the module cache first,
    // so its top level code runs rather than being skipped as already loaded - is what loadWorkerFile
    // is. It is there rather than here because how a file is made to run again depends on what kind
    // of module it is, and only one of the two ways is a cache to clear.
    void importWorkerFile(wData);
});

async function callFunction(wData: BaseFunctionThreadJobWorkerData<unknown>): Promise<void> {
    try {
        let fn: ThreadJobFunction<unknown, unknown> | undefined = (await functionCache.get(wData.func))?.value;
        if (fn == undefined) {
            // `new Function` and not `eval`. Only the source crosses the thread boundary, so a
            // variable the function captured where it was written is gone either way - what differs
            // is what happens then. A direct `eval` runs the source in *this* scope, so such a name
            // can resolve against one of this module's own bindings and return an unrelated value
            // with no error. Built this way the function sees its arguments and the globals, which
            // is all that actually survived, and a captured name is the ReferenceError it should be.
            // the rule is right everywhere else - turning source into code is the job here, and the
            // only reason it is safe is that the source never came from anywhere but this process
            // eslint-disable-next-line typescript/no-implied-eval, typescript/no-unsafe-call
            fn = new Function(`return (${wData.func})`)() as ThreadJobFunction<unknown, unknown>;
            await functionCache.set(wData.func, { createdAt: new Date(), tags: [], value: fn });
        }
        const result: unknown = await fn(wData.input);
        reportCompletion(result);
    }
    catch (error) {
        const err: Error = error instanceof Error ? error : new Error(`${error}`);
        reportError(err);
    }
}

/**
 * Puts this job's data where the file about to run will look for it.
 *
 * `workerData` means "what this thread was started with", and a thread here runs many jobs - so it
 * has to say what the *current* one was started with instead. The object is emptied and refilled
 * rather than replaced, and that is the whole of why an es module worker file works.
 *
 * A commonjs or TypeScript file compiles `import { workerData }` to a property read where it is
 * used, so it would see a replacement too. An es module binds to the module's namespace, which node
 * builds once by copying the values out - a snapshot, so a later replacement is invisible to it and
 * every job after the first would read the first one's data. What the snapshot copies is a
 * reference, so what is inside the object is not a snapshot at all.
 *
 * The trace context goes under a symbol beside the data rather than into it, where
 * `getThreadJobTraceContext` reads it: a property the job never queued would show up in its keys.
 * @param wData - The data of the job that is about to run.
 * @param traceContext - The span the run of the job is recorded as.
 */
function updateWorkerData(wData: BaseThreadJobWorkerData | BaseFunctionThreadJobWorkerData<unknown>, traceContext: TraceSpanContext): void {
    const current: Record<string, unknown> = workerData as Record<string, unknown>;
    for (const key of Object.keys(current)) {
        // eslint-disable-next-line typescript/no-dynamic-delete
        delete current[key];
    }
    Object.assign(current, wData);
    Object.defineProperty(current, THREAD_JOB_TRACE_CONTEXT_KEY, { value: traceContext, configurable: true, enumerable: false });
}

async function importWorkerFile(workerData: BaseThreadJobWorkerData): Promise<void> {
    try {
        await loadWorkerFile(workerData.filePath);
    }
    catch (error) {
        const err: Error = error instanceof Error ? error : new Error(`${error}`);
        reportError(err);
    }
}

function isFunctionWorkerData<T>(value: unknown): value is BaseFunctionThreadJobWorkerData<T> {
    return value != undefined && typeof value === 'object'
        && !!(value as BaseFunctionThreadJobWorkerData<T>).func && typeof (value as BaseFunctionThreadJobWorkerData<T>).func === 'string';
}