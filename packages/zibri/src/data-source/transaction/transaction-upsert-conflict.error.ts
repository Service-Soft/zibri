import { TransactionConflictError } from './transaction-conflict.error';

/**
 * Thrown when an upsert in a transaction was refused for a unique key of the row its identity names,
 * because another transaction inserted that row while the upsert ran.
 *
 * The upsert could not go on to update the row in the same transaction, so the transaction was ended,
 * and nothing it wrote is applied. Running it again from the start updates the row, and is what to do.
 * Roll it back when it was one you started.
 */
export class TransactionUpsertConflictError extends TransactionConflictError {
    constructor(options?: ErrorOptions) {
        super(
            'Another transaction inserted the row an upsert names while it ran, so the transaction was ended'
            + ' and nothing it wrote was applied. Run it again.',
            options
        );
        this.name = 'TransactionUpsertConflictError';
    }
}