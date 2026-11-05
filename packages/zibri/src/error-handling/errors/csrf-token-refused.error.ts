import { ForbiddenError } from './forbidden.error';

/**
 * An error to throw when a request changing something carries a valid cookie session, and not the
 * csrf token that goes with it.
 *
 * Answers 403: the session is fine, and logging in again does not help.
 * The client reads the current token, such as from `GET /auth/csrf-token`, and sends it.
 */
// eslint-disable-next-line unicorn/custom-error-definition
export class CsrfTokenRefusedError extends ForbiddenError {}