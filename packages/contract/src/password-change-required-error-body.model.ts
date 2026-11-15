import { ErrorResponseBody } from './error-response-body.model';

/**
 * What a login that waits for a new password is answered with, a 401 named 'PasswordChangeRequiredError'.
 */
export type PasswordChangeRequiredErrorBody = ErrorResponseBody & {
    /**
     * The one-time ticket the new password is sent with.
     */
    ticket: string
};