import { Transaction } from '../data-source/transaction/transaction.model';

/**
 * What one attempt at a piece of queued work is handed.
 */
export type QueuedWorkRun = {
    /**
     * Names the work, the same on every attempt, so that what it does elsewhere can be made safe to
     * repeat, such as the idempotency key of a payment.
     */
    runId: string,
    /**
     * Which attempt this is, starting at 1.
     */
    attempt: number,
    /**
     * Fires when the claim on the work is lost, after which whoever took it over runs it again.
     */
    signal: AbortSignal,
    /**
     * The transaction the attempt is recorded in, with `'transactional'` delivery. Undefined
     * otherwise.
     */
    transaction: Transaction | undefined
};