import { InternalError } from '../../error-handling/internal-error.model.ts';
import { Newable } from '../../types/newable.type.ts';

/**
 * Thrown when the rows of a tenant are reached while no tenant is active.
 *
 * Nothing narrows such a call to one tenant, so it is refused rather than answered from all of them.
 * Run the work as a tenant, or pass `acrossTenants` when it really serves every tenant at once.
 */
export class NoActiveTenantError extends InternalError {
    constructor(entityClass: Newable<unknown>) {
        super([
            `The rows of "${entityClass.name}" belong to a tenant, and no tenant is active here.`,
            'Run this as a tenant, or pass "acrossTenants: true" when it serves every tenant at once.'
        ]);
        this.name = 'NoActiveTenantError';
    }
}