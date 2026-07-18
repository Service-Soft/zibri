/* eslint-disable jsdoc/require-jsdoc */
// eslint-disable-next-line unusedImports/no-unused-imports
import { parentPort, workerData } from 'node:worker_threads';

import { register as tsNodeRegister } from 'ts-node';

import { reportCompletion } from './helpers';
import { CacheStoreInterface } from '../../../caching/store/cache-store.interface';
import { InMemoryCacheStore } from '../../../caching/store/in-memory.cache-store';
import { InternalError } from '../../../error-handling/internal-error.model';
import type { BaseThreadJobWorkerData, BaseFunctionThreadJobWorkerData } from '../../models/base-thread-job-worker-data.model';
import type { ThreadJobFunction } from '../../models/thread-job-function.model';
import type { ThreadJobMessage } from '../../models/thread-job-message.model';

if (!parentPort) {
    throw new InternalError('Internal Error with the thread-job-worker: parentPort not available.');
}

const functionCache: CacheStoreInterface<string, ThreadJobFunction<unknown, unknown>> = new InMemoryCacheStore();

tsNodeRegister({ transpileOnly: true });

process.on('uncaughtException', (err) => {
    parentPort?.postMessage({ type: 'error', error: toError(err) });
});

process.on('unhandledRejection', (err) => {
    parentPort?.postMessage({ type: 'error', error: toError(err) });
});

const message: ThreadJobMessage = { type: 'initialization' };

parentPort.postMessage(message);

parentPort.on('message', (wData: BaseThreadJobWorkerData | BaseFunctionThreadJobWorkerData<unknown>) => {
    // @ts-ignore-next-line
    workerData = wData;

    if (isFunctionWorkerData(wData)) {
        void callFunction(wData);
        return;
    }

    // Clear the module from the cache, so that top level code is run again
    // and no state is kept between runs.
    if (require.cache[wData.filePath]) {
        // eslint-disable-next-line typescript/no-dynamic-delete
        delete require.cache[wData.filePath];
    }

    importWorkerFile(wData);
});

async function callFunction(wData: BaseFunctionThreadJobWorkerData<unknown>): Promise<void> {
    try {
        let fn: ThreadJobFunction<unknown, unknown> | undefined = (await functionCache.get(wData.func))?.value;
        if (fn == undefined) {
            fn = eval(`(${wData.func})`) as ThreadJobFunction<unknown, unknown>;
            await functionCache.set(wData.func, { createdAt: new Date(), tags: [], value: fn });
        }
        const result: unknown = await fn(wData.input);
        reportCompletion(result);
    }
    catch (error) {
        const message: ThreadJobMessage = { type: 'error', error: toError(error) };
        parentPort?.postMessage(message);
    }
}

function importWorkerFile(workerData: BaseThreadJobWorkerData): void {
    try {
        // eslint-disable-next-line typescript/no-require-imports
        require(workerData.filePath);
    }
    catch (error) {
        const message: ThreadJobMessage = { type: 'error', error: toError(error) };
        parentPort?.postMessage(message);
    }
}

function toError(value: unknown): Error {
    const error: Error = value instanceof Error ? value : new Error(`${value}`);
    return {
        name: error.name,
        message: error.message,
        stack: error.stack
    };
}

function isFunctionWorkerData<T>(value: unknown): value is BaseFunctionThreadJobWorkerData<T> {
    return value != undefined && typeof value === 'object'
        && !!(value as BaseFunctionThreadJobWorkerData<T>).func && typeof (value as BaseFunctionThreadJobWorkerData<T>).func === 'string';
}