import { InternalError } from '../../error-handling/internal-error.model.ts';

/**
 * Thrown when a transaction commits after the indexes or uniques of an entity it wrote changed.
 *
 * Nothing the transaction wrote is applied, so running it again from the start is safe, and is what
 * to do. It can only happen while a new version of the application is starting next to one still
 * serving, in the moment that version brings the indexes and uniques in line with its entities.
 */
export class KeyDeclarationsChangedError extends InternalError {
    constructor(options?: ErrorOptions) {
        super(
            'The indexes or uniques of an entity changed while the transaction ran, so nothing it wrote was applied. Run it again.',
            options
        );
        this.name = 'KeyDeclarationsChangedError';
    }
}