// unicorn/custom-error-definition wants `name` set to match the class. It must not be, here: `name`
// is serialized into the response body, and a caller who gets a 503 has no business learning that
// the part which gave up was a rate limiter. Inheriting the name is the point.
/* eslint-disable unicorn/custom-error-definition */
import { ServiceUnavailableError } from '../../error-handling/errors/service-unavailable.error';
import { $ts } from '../../localization/translate.function';

/**
 * Thrown when a rate limiter cannot read or write its state at all.
 *
 * A limiter that cannot reach its store knows nothing about the caller, so it can neither say yes nor
 * say no. What happens then is what `onStoreFailure` on the limiter decides - this error is what the
 * default policy lets through.
 *
 * Answers 503: the request was fine, the limiter was not, and trying again is a reasonable thing for
 * the caller to do. The message says nothing about which limiter or which store; the limiter is on
 * `limiterName` and what actually failed is on `cause`, both of which are logged.
 */
// the message names neither, because an external error reaches the caller as written
export class RateLimitStoreUnavailableError extends ServiceUnavailableError {
    constructor(
        readonly limiterName: string,
        options?: ErrorOptions
    ) {
        super($ts`The request could not be handled right now, please try again.`, options);
    }
}