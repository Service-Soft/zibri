import { TransactionConflictError } from './transaction-conflict.error';

/**
 * Thrown when a transaction lost locks on rows it wrote before it committed, on a store that locks
 * them itself, such as valkey: another transaction may have written those rows meanwhile.
 *
 * It was ended, and nothing it wrote is applied, so running it again from the start is safe, and is
 * what to do. Roll it back when it was one you started.
 */
export class TransactionLocksLostError extends TransactionConflictError {
    constructor(options?: ErrorOptions) {
        super(
            'The transaction lost locks on rows it wrote before it committed, so another one may have written them meanwhile.'
            + ' It was ended and nothing it wrote was applied. Run it again.',
            options
        );
        this.name = 'TransactionLocksLostError';
    }
}