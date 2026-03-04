/* eslint-disable jsdoc/require-jsdoc */
import { parentPort } from 'node:worker_threads';

import { register } from 'ts-node';

import { reportCompletion } from './helpers';
import { BaseThreadJobWorkerData, BaseFunctionThreadJobWorkerData } from '../../models/base-thread-job-worker-data.model';
import { ThreadJobFunction } from '../../models/thread-job-function.model';
import { ThreadJobMessage } from '../../models/thread-job-message.model';

if (!parentPort) {
    throw new Error('Internal Error with the thread-job-worker: parentPort not available.');
}

register();

const message: ThreadJobMessage = { type: 'initialization' };

parentPort.postMessage(message);

parentPort.on('message', (wData: BaseThreadJobWorkerData | BaseFunctionThreadJobWorkerData<unknown>) => {
    // @ts-ignore-next-line
    workerData = wData;

    if (isFunctionWorkerData(wData)) {
        void callFunction(wData);
        return;
    }

    // Clear the module from the cache
    if (wData.filePath.endsWith('.ts')) {
        const parts: string[] = wData.filePath.split('.ts');
        parts.splice(parts.length - 1, 1);
        wData.filePath = parts.join('') + '.js';
    }

    if (require.cache[require.resolve(wData.filePath)]) {
        // eslint-disable-next-line typescript/no-dynamic-delete
        delete require.cache[require.resolve(wData.filePath)];
    }

    void importWorkerFile(wData);
});

async function callFunction(wData: BaseFunctionThreadJobWorkerData<unknown>): Promise<void> {
    try {
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const fn: ThreadJobFunction<unknown, unknown> = eval(`(${wData.func})`);
        const result: unknown = await fn(wData.input);
        reportCompletion(result);
    }
    catch (error) {
        const message: ThreadJobMessage = { type: 'error', error: toError(error) };
        parentPort?.postMessage(message);
    }
}

async function importWorkerFile(workerData: BaseThreadJobWorkerData): Promise<void> {
    try {
        await import(workerData.filePath);
    }
    catch (error) {
        const message: ThreadJobMessage = { type: 'error', error: toError(error) };
        parentPort?.postMessage(message);
    }
}

function toError(value: unknown): Error {
    if (value instanceof Error) {
        return value;
    }
    return new Error(`${value}`);
}

function isFunctionWorkerData<T>(value: unknown): value is BaseFunctionThreadJobWorkerData<T> {
    return value != undefined && typeof value === 'object'
        && !!(value as BaseFunctionThreadJobWorkerData<T>).func && typeof (value as BaseFunctionThreadJobWorkerData<T>).func === 'string';
}