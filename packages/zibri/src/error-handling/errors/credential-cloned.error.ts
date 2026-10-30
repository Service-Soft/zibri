import { UnauthorizedError } from './unauthorized.error';

/**
 * An error to throw when a credential is presented by what looks like a copy of the device it lives
 * on, such as a passkey whose signature counter went backwards.
 *
 * The audit trail names what happened, and the response is that of an `UnauthorizedError`.
 */
// a subclass rather than a different message, for the reason `CredentialReusedError` gives
// eslint-disable-next-line unicorn/custom-error-definition
export class CredentialClonedError extends UnauthorizedError {}