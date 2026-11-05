import { InternalError } from '../../error-handling/internal-error.model';

/**
 * Thrown when the store ended a transaction because it conflicted with another one.
 *
 * Nothing the transaction wrote is applied, so running it again from the start is safe, and is what
 * to do: a data source's `runInTransaction` does that for you. Roll it back when it was one you
 * started.
 */
export abstract class TransactionConflictError extends InternalError {
    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = 'TransactionConflictError';
    }
}