import { UnauthorizedError } from './unauthorized.error';

/**
 * An error to throw when a one-time credential is presented after it has already been spent.
 *
 * A subclass rather than a different message, so that the audit trail can name what happened while
 * the response does not change at all: `name` stays `UnauthorizedError` and the message is whatever
 * the ordinary refusal says. Whoever presented a reused credential is precisely the party who should
 * not be told that reuse is what was noticed.
 *
 * The distinction it carries is worth having. A credential presented twice means it was either
 * stolen or is being replayed, and that is a different event from one that merely expired - both
 * answer 401, and without this they are the same line in the log.
 */
// unicorn/custom-error-definition wants `name` to match the class, and this is the one error where
// it must not: `name` is serialized into the response body, so naming it here would tell the holder
// of a reused credential exactly what was detected. Inheriting `UnauthorizedError` is the point.
// eslint-disable-next-line unicorn/custom-error-definition
export class CredentialReusedError extends UnauthorizedError {}