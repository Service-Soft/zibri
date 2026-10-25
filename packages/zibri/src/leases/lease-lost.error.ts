import { InternalError } from '../error-handling/internal-error.model';

/**
 * The reason the work under a grant is told the grant is gone.
 *
 * Raised by `renew` when the grant is no longer this instance's, and handed to the work as the
 * reason its signal aborts - whether the grant was taken away, or could not be renewed for longer
 * than it lives and may be anybody's now.
 */
export class LeaseLostError extends InternalError {
    constructor(name: string, cause?: unknown) {
        super(
            `The lease "${name}" was lost while its work was still running - another instance may be doing the same work now.`,
            { cause }
        );
        this.name = 'LeaseLostError';
    }
}