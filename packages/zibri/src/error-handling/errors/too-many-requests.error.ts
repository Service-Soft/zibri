import { HttpError } from './http.error';
import { HttpStatus } from '../../http/http-status.enum';
import { TranslatedString } from '../../localization/models/translated-string.model';
import { $ts } from '../../localization/translate.function';
import { FailedRateLimitResult } from '../../rate-limiting/rate-limit-result.model';

/**
 * An error to throw when there have been too many requests in a too short amount of time.
 */
export class TooManyRequestsError extends HttpError {
    /**
     * When the caller may try again, as a unix timestamp in milliseconds, if that is known.
     * Maps to the {@link https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Retry-After | Retry-After} header.
     * @returns The timestamp, or undefined when nothing says when.
     */
    get retryAtMs(): number | undefined {
        return this.rateLimitResult?.retryAtMs;
    }

    constructor(message: TranslatedString | TranslatedString[], readonly rateLimitResult?: FailedRateLimitResult, options?: ErrorOptions) {
        super(message, HttpStatus.TOO_MANY_REQUESTS, $ts`Too Many Requests`, options);
        this.name = 'TooManyRequestsError';
    }
}