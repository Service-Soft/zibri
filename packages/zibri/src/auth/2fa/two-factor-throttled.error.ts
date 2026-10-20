import { TooManyRequestsError } from '../../error-handling/errors/too-many-requests.error.ts';
import { $ts } from '../../localization/translate.function.ts';

/**
 * Thrown when a user has to wait before their next two factor code is checked.
 *
 * Answers `429` with a `Retry-After` header saying when the next code is checked.
 */
export class TwoFactorThrottledError extends TooManyRequestsError {
    override get retryAtMs(): number {
        return this.retryAt.getTime();
    }

    constructor(private readonly retryAt: Date, options?: ErrorOptions) {
        super($ts`Too many wrong two factor codes. Wait before trying again.`, undefined, options);
        this.name = 'TwoFactorThrottledError';
    }
}