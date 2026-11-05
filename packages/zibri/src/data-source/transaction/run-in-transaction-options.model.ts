import { StartTransactionOptions } from '../data-sources/data-source.interface';

/**
 * The options work is run in a transaction with.
 */
export type RunInTransactionOptions = StartTransactionOptions & {
    /**
     * How often the work is run at most: once, and again after each conflict that ended it, until it
     * has run this many times.
     */
    maxAttempts: number
};