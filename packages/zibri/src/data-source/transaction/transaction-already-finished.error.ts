import { InternalError } from '../../error-handling/internal-error.model.ts';

/**
 * Thrown when a transaction is used after it has been committed or rolled back.
 *
 * Always a bug in the calling code rather than a condition to handle: a transaction that is over has
 * released whatever it was holding, so a write arriving now would either be silently dropped or land
 * outside the atomic batch it was meant to be part of.
 */
export class TransactionAlreadyFinishedError extends InternalError {
    constructor(options?: ErrorOptions) {
        super('The transaction has already been finished.', options);
        this.name = 'TransactionAlreadyFinishedError';
    }
}