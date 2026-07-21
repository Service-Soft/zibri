import { parentPort } from 'node:worker_threads';

import { Percentage } from '../../../types/percentage.type';
import { ThreadJobMessage } from '../../models/thread-job-message.model';

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
 */
export function reportError(error: Error): void {
    const message: ThreadJobMessage = {
        type: 'error',
        // name/message/stack are non-enumerable on Error instances, so they would be lost once the
        // reported error is JSON-serialized for persistence.
        error: toError(error)
    };
    parentPort?.postMessage(message);
}

// eslint-disable-next-line jsdoc/require-jsdoc
function toError(value: unknown): Error {
    const error: Error = value instanceof Error ? value : new Error(`${value}`);
    return {
        name: error.name,
        message: error.message,
        stack: error.stack
    };
}