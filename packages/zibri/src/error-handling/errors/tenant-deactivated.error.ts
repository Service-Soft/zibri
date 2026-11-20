import { $ts } from '../../localization/translate.function';
import { ForbiddenError } from './forbidden.error';

/**
 * An error to throw when work is started for a tenant that is deactivated, such as an email queued or an event
 * emitted in it.
 *
 * Answers 403: nothing is wrong with the caller, and nothing works for the tenant until it is reactivated.
 */
export class TenantDeactivatedError extends ForbiddenError {
    constructor(tenantId: string) {
        super($ts`The tenant "${tenantId}" is deactivated.`);
        this.name = 'TenantDeactivatedError';
    }
}