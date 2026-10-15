import { AuditReason } from './audit-event.model';
import { ErrorUtilities } from '../error-handling/error.utilities';
import { AccountDeactivatedError } from '../error-handling/errors/account-deactivated.error';
import { CredentialClonedError } from '../error-handling/errors/credential-cloned.error';
import { CredentialReusedError } from '../error-handling/errors/credential-reused.error';

/**
 * Whether a thrown error means the attempt was refused, or means something broke.
 *
 * Worth keeping apart: a user store that is down refuses every login exactly like a wrong password
 * does, and a trail that records the two the same way reads an outage as a credential stuffing run.
 *
 * `AggregateError` is unwrapped because `Promise.any` is how several methods get tried at once - that
 * is a refusal only if every one of them refused.
 * @param error - What was thrown.
 * @returns The reason to record.
 */
export function auditReasonFor(error: unknown): AuditReason {
    if (error instanceof CredentialReusedError) {
        return AuditReason.TOKEN_REUSED;
    }
    if (error instanceof CredentialClonedError) {
        return AuditReason.CREDENTIAL_CLONED;
    }
    if (error instanceof AccountDeactivatedError) {
        return AuditReason.DEACTIVATED;
    }
    const errors: unknown[] = error instanceof AggregateError ? error.errors : [error];
    if (!errors.length) {
        // nothing was tried, so nothing refused - an empty AggregateError means the list of things
        // to try was empty, which is a configuration problem rather than a rejected caller
        return AuditReason.ERROR;
    }
    return errors.every(e => ErrorUtilities.isRefusal(e)) ? AuditReason.REFUSED : AuditReason.ERROR;
}