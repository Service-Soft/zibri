import { ThreadJobStatus } from './thread-job-status.enum';
import { LoggedError } from '../../logging/logged-error.model';
import { Percentage } from '../../types/percentage.type';

/**
 * The internal thread job message types.
 */
export type ThreadJobMessage<T = unknown> = StatusMessage | ProgressMessage | CompletionMessage<T> | InitializationMessage | ErrorMessage;

/**
 * The message that is sent once on initialization.
 */
type InitializationMessage = {
    /**
     * The type of the message.
     */
    type: 'initialization'
};

/**
 * A message to change the status of the thread job.
 */
type StatusMessage = {
    /**
     * The type of the message.
     */
    type: 'status',
    /**
     * The status that should be set.
     */
    status: ThreadJobStatus
};

/**
 * A message to indicate that the thread job has failed.
 */
type ErrorMessage = {
    /**
     * The type of the message.
     */
    type: 'error',
    /**
     * The error that the thread job failed with.
     *
     * A `LoggedError` because it crosses a thread boundary and then goes into a column, and an
     * `Error` survives neither: its message, stack and cause are non-enumerable. It was typed
     * `Error` while carrying a flat object that was not one, so `instanceof Error` answered no
     * for a value the type promised was yes.
     */
    error: LoggedError,
    /**
     * Whether the worker is ending itself because of this.
     *
     * Set when the error reached the worker's `uncaughtException` or `unhandledRejection` handler,
     * which leaves it in a state nothing can reason about - so it reports and exits. The parent
     * needs to be told, because the job failing and the worker being reusable are otherwise the same
     * message: without this the worker goes back on the idle list for the moment it has left, and
     * the next job is posted to a thread that is already on its way out.
     */
    fatal: boolean
};

/**
 * A message to update the progress of the job.
 */
type ProgressMessage = {
    /**
     * The type of the message.
     */
    type: 'progress',
    /**
     * The progress as a percentage number.
     * Cannot be set to 100 as the CompletionMessage should be used for that.
     */
    progress: Percentage
};

/**
 * A message to indicate that the thread job was completed successfully.
 */
type CompletionMessage<T> = {
    /**
     * The type of the message.
     */
    type: 'completion',
    /**
     * The result of the thread job.
     */
    result: T
};