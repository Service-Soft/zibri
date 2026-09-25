import { AuditReason } from './audit-event.model';
import { CredentialReusedError } from '../error-handling/errors/credential-reused.error';
import { HttpError } from '../error-handling/errors/http.error';
import { HttpStatus } from '../http/http-status.enum';

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
    const errors: unknown[] = error instanceof AggregateError ? error.errors : [error];
    if (!errors.length) {
        // nothing was tried, so nothing refused - an empty AggregateError means the list of things
        // to try was empty, which is a configuration problem rather than a rejected caller
        return AuditReason.ERROR;
    }
    return errors.every(e => e instanceof HttpError && e.status < HttpStatus.INTERNAL_SERVER_ERROR)
        ? AuditReason.REFUSED
        : AuditReason.ERROR;
}