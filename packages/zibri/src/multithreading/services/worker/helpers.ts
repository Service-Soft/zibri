import { parentPort } from 'node:worker_threads';

import { errorToLoggedError } from '../../../logging/error-to-logged-error.function';
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