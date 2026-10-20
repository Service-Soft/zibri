import { BadRequestError } from '../error-handling/errors/bad-request.error.ts';
import { $ts } from '../localization/translate.function.ts';
import { UUIDUtilities } from '../utilities/uuid.utilities.ts';

/**
 * Refuses the tenant a request names when it is not a uuid.
 *
 * Checked on what `resolveTenant` answered rather than inside it, so a tenant service an application
 * provides is held to it as well.
 * @param tenantId - What `resolveTenant` answered for the request.
 * @throws {BadRequestError} When the request names a tenant that is not a uuid.
 */
export function validateRequestTenant(tenantId: string | undefined): void {
    if (tenantId != undefined && !UUIDUtilities.isUuid(tenantId)) {
        throw new BadRequestError($ts`The tenant "${tenantId}" this request names is not a uuid.`);
    }
}