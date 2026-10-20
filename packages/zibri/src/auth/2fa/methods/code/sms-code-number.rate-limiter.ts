import { type SmsCodeLimits } from './sms-code-limits.model.ts';
import { repositoryTokenFor } from '../../../../di/decorators/inject-repository.decorator.ts';
import { Inject } from '../../../../di/decorators/inject.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../../../di/inject.function.ts';
import { InternalError } from '../../../../error-handling/internal-error.model.ts';
import { RateLimiter } from '../../../../rate-limiting/decorators/rate-limiter.decorator.ts';
import { TokenBucketRateLimiter, TokenBucketState } from '../../../../rate-limiting/limiter/token-bucket.rate-limiter.ts';
import { RateLimitStateEntity } from '../../../../rate-limiting/stores/rate-limit-state-entity.model.ts';
import { InProcessRateLimiterLock } from '../../../../rate-limiting/stores/rate-limiter-lock.interface.ts';
import { RepositoryRateLimiterStore } from '../../../../rate-limiting/stores/repository.rate-limiter-store.ts';
import { Ms } from '../../../../utilities/ms.ts';

/**
 * How many codes one phone number is sent by text message, whichever accounts ask for them:
 * `maxPerNumberPerDay` of `SMS_CODE_LIMITS`.
 *
 * Counted in the data source, in `RateLimitStateEntity`, so the limit holds across every instance.
 */
@RateLimiter({ register: 'onUse' })
export class SmsCodeNumberRateLimiter extends TokenBucketRateLimiter {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.SMS_CODE_LIMITS)
        limits: SmsCodeLimits | undefined
    ) {
        if (limits == undefined) {
            throw new InternalError('SmsCodeNumberRateLimiter needs ZIBRI_DI_TOKENS.SMS_CODE_LIMITS.');
        }
        super(
            Ms.DAY,
            {
                name: 'SmsCodeNumberRateLimiter',
                // the lock of this process only, for the reason given on TwoFactorCodeRateLimiter
                store: new RepositoryRateLimiterStore<TokenBucketState>(
                    inject(repositoryTokenFor(RateLimitStateEntity)),
                    new InProcessRateLimiterLock(),
                    'SmsCodeNumberRateLimiter'
                ),
                capacity: limits.maxPerNumberPerDay,
                maxReservationWaitMs: undefined
            }
        );
    }
}