import { ErrorResponseBody } from './error-response-body.model';

/**
 * What a login that waits for a second factor is answered with, a 401 named 'SecondFactorRequiredError'.
 */
export type SecondFactorRequiredErrorBody = ErrorResponseBody & {
    /**
     * The one-time ticket the second factor is sent with.
     */
    ticket: string,
    /**
     * The names of the two factor methods the user can finish the login with, like 'otp'.
     */
    methods: string[]
};