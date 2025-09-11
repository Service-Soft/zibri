import { parentPort } from 'node:worker_threads';

import { Percentage } from '../../../types';
import { ThreadJobMessage } from '../../models';

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
        error
    };
    parentPort?.postMessage(message);
}