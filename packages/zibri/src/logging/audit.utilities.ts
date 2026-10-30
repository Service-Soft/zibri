import { AuditReason } from './audit-event.model';
import { ErrorUtilities } from '../error-handling/error.utilities';
import { AccountDeactivatedError } from '../error-handling/errors/account-deactivated.error';
import { CredentialClonedError } from '../error-handling/errors/credential-cloned.error';
import { CredentialReusedError } from '../error-handling/errors/credential-reused.error';
import { EmailNotVerifiedError } from '../error-handling/errors/email-not-verified.error';
import { PasswordLockedError } from '../error-handling/errors/password-locked.error';

/**
 * What an audit event records about an attempt: why it was refused, whom it named, and whom it
 * turned out to be for.
 */
export abstract class AuditUtilities {
    /**
     * Whether a thrown error means the attempt was refused, or means something broke.
     *
     * Worth keeping apart: a user store that is down refuses every login exactly like a wrong
     * password does, and a trail that records the two the same way reads an outage as a credential
     * stuffing run.
     * @param error - What was thrown.
     * @returns The reason to record.
     */
    static resolveReason(error: unknown): AuditReason {
        if (error instanceof CredentialReusedError) {
            return AuditReason.TOKEN_REUSED;
        }
        if (error instanceof CredentialClonedError) {
            return AuditReason.CREDENTIAL_CLONED;
        }
        if (error instanceof AccountDeactivatedError) {
            return AuditReason.DEACTIVATED;
        }
        if (error instanceof PasswordLockedError) {
            return AuditReason.LOCKED;
        }
        if (error instanceof EmailNotVerifiedError) {
            return AuditReason.EMAIL_NOT_VERIFIED;
        }
        // unwrapped because `Promise.any` is how several methods get tried at once - that is a
        // refusal only if every one of them refused
        const errors: unknown[] = error instanceof AggregateError ? error.errors : [error];
        if (!errors.length) {
            // nothing was tried, so nothing refused - an empty AggregateError means the list of things
            // to try was empty, which is a configuration problem rather than a rejected caller
            return AuditReason.ERROR;
        }
        return errors.every(e => ErrorUtilities.isRefusal(e)) ? AuditReason.REFUSED : AuditReason.ERROR;
    }

    /**
     * The account a login attempt named, read off the credentials before anything checked them.
     *
     * `email` is the shape of a password, `username` the one of a directory, and credentials that
     * identify their users some other way record no subject rather than a wrong one.
     * @param credentials - Whatever was handed to the authenticator.
     * @returns The named account, or undefined if the credentials do not name one.
     */
    static resolveSubject(credentials: unknown): string | undefined {
        if (typeof credentials !== 'object' || credentials == undefined) {
            return undefined;
        }
        if ('email' in credentials && typeof credentials.email === 'string') {
            return credentials.email;
        }
        if ('username' in credentials && typeof credentials.username === 'string') {
            return credentials.username;
        }
        return undefined;
    }

    /**
     * The account a successful login turned out to be for.
     * @param authData - Whatever the strategy returned.
     * @returns The id of the account, or undefined if the returned data does not carry one.
     */
    static resolveUserId(authData: unknown): string | undefined {
        if (typeof authData !== 'object' || authData == undefined || !('userId' in authData)) {
            return undefined;
        }
        return typeof authData.userId === 'string' ? authData.userId : undefined;
    }
}