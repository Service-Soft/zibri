import { TransactionConflictError } from './transaction-conflict.error';

/**
 * Thrown when a transaction waited for a row held by another transaction that, in turn, waited for
 * one this transaction held.
 *
 * Neither could go on, so this one was ended and the others were let through. Nothing it wrote is
 * applied, so running it again from the start is safe, and is what to do. Roll it back when it was
 * one you started.
 */
export class TransactionDeadlockError extends TransactionConflictError {
    constructor(options?: ErrorOptions) {
        super(
            'The transaction waited on another one that waited on it in turn,'
            + ' so it was ended and nothing it wrote was applied. Run it again.',
            options
        );
        this.name = 'TransactionDeadlockError';
    }
}