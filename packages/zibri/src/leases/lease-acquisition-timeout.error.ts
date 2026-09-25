import { InternalError } from '../error-handling/internal-error.model';

/**
 * Thrown when waiting for a grant ran out of patience.
 *
 * Only ever raised in 'wait' mode, and it has to be raised rather than reported: a caller that asked
 * to queue has said its work cannot proceed without the grant, so returning quietly would let it
 * carry on as if the work had been done. That is the exact failure this whole area is about - see
 * evaluation/10-leases-and-claims.md.
 *
 * In 'skip' mode there is nothing to throw about. Losing the race is the expected outcome on every
 * instance but one, and is reported by returning undefined.
 */
export class LeaseAcquisitionTimeoutError extends InternalError {
    constructor(key: string, waitedInMs: number) {
        super(`Waited ${waitedInMs}ms for the lease "${key}" and it was still held by another instance.`);
        this.name = 'LeaseAcquisitionTimeoutError';
    }
}