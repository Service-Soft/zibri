import { LoggedError } from '../logging/logged-error.model';

/**
 * How an attempt at a piece of queued work ended, with what its row holds afterwards.
 *
 * - `'succeeded'`: it is done.
 * - `'retrying'`: it failed, and is due again at `nextAttemptAt`.
 * - `'failed'`: it failed, and is not tried again.
 */
export type QueuedWorkOutcome = {
    /**
     * How it ended.
     */
    kind: 'succeeded' | 'retrying' | 'failed',
    /**
     * How many attempts were spent, this one included.
     */
    attempts: number,
    /**
     * When it is due again, null unless it is retried.
     */
    nextAttemptAt: Date | null,
    /**
     * What it failed with, null when it succeeded.
     */
    error: LoggedError | null
};
