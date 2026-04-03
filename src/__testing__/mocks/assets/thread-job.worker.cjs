/* eslint-disable jsdoc/require-jsdoc */
/* eslint-disable no-use-before-define */
/* eslint-disable jsdoc/require-description */
const { parentPort } = require('node:worker_threads');
const { register } = require('ts-node');
// eslint-disable-next-line stylistic/max-len
const { BaseFunctionThreadJobWorkerData, BaseThreadJobWorkerData, ThreadJobFunction, ThreadJobMessage, reportCompletion, reportError } = require('zibri');

if (!parentPort) {
    throw new Error('Internal Error with the thread-job-worker: parentPort not available.');
}

register();

/** @type {ThreadJobMessage} */
const message = { type: 'initialization' };

parentPort.postMessage(message);

parentPort.on(
    'message',
    (
        /** @type {BaseThreadJobWorkerData | BaseFunctionThreadJobWorkerData<unknown>} */
        wData
    ) => {
        workerData = wData;

        if (isFunctionWorkerData(wData)) {
            void callFunction(wData);
            return;
        }

        // Clear the module from the cache
        if (wData.filePath.endsWith('.ts')) {
            /** @type {string[]} */
            const parts = wData.filePath.split('.ts');
            parts.splice(parts.length - 1, 1);
            wData.filePath = parts.join('') + '.js';
        }

        if (require.cache[require.resolve(wData.filePath)]) {
            delete require.cache[require.resolve(wData.filePath)];
        }

        void importWorkerFile(wData);
    }
);

async function callFunction(
    /** @type {BaseFunctionThreadJobWorkerData<unknown>} */
    wData
) {
    try {
        /** @type {ThreadJobFunction<unknown, unknown>} */
        const fn = eval(`(${wData.func})`);
        const result = await fn(wData.input);
        reportCompletion(result);
    }
    catch (error) {
        reportError(toError(error));
    }
}

async function importWorkerFile(
    /** @type {BaseThreadJobWorkerData} */
    workerData
) {
    try {
        await import(workerData.filePath);
    }
    catch (error) {
        reportError(toError(error));
    }
}

function toError(
    /** @type {unknown} */
    value
) {
    if (value instanceof Error) {
        return value;
    }
    return new Error(`${value}`);
}

function isFunctionWorkerData(
    /** @type {unknown} */
    value
) {
    return value != undefined && typeof value === 'object'
        && !!value.func && typeof value.func === 'string';
}