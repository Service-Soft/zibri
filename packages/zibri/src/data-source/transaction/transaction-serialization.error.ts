import { TransactionConflictError } from './transaction-conflict.error';

/**
 * Thrown when a transaction of the isolation level `REPEATABLE READ` or `SERIALIZABLE` read rows that
 * another transaction changed meanwhile, in a way that level does not allow.
 *
 * It was ended, and nothing it wrote is applied, so running it again from the start is safe, and is
 * what to do. Roll it back when it was one you started.
 */
export class TransactionSerializationError extends TransactionConflictError {
    constructor(options?: ErrorOptions) {
        super(
            'The transaction read rows another one changed meanwhile, which its isolation level does not allow,'
            + ' so it was ended and nothing it wrote was applied. Run it again.',
            options
        );
        this.name = 'TransactionSerializationError';
    }
}