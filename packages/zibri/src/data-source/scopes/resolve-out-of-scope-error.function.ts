import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { ForbiddenError } from '../../error-handling/errors/forbidden.error';
import { $ts } from '../../localization/translate.function';
import { AuditAction, AuditOutcome, AuditReason } from '../../logging/audit-event.model';
import { Newable } from '../../types/newable.type';

/**
 * Records a write refused for landing outside the caller's scope, and builds the error refusing it.
 * @param entityClass - The entity the write was to.
 * @returns The error to throw.
 */
export function resolveOutOfScopeError(entityClass: Newable<unknown>): ForbiddenError {
    // recorded, where a refused *read* is not: a read that comes back empty cannot be told apart
    // from a row that is simply not there - which is the property the 404 exists for - while a
    // write landing outside the scope is a caller stating what they intended
    inject(ZIBRI_DI_TOKENS.AUDIT_SERVICE).record({
        action: AuditAction.AUTHORIZATION,
        outcome: AuditOutcome.FAILURE,
        reason: AuditReason.OUT_OF_SCOPE
    });
    return new ForbiddenError(
        $ts`You cannot write a ${entityClass.name} outside what you are allowed to see.`
    );
}