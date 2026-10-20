import { type TwoFactorCodeOptions } from './two-factor-code-options.model.ts';
import { repositoryTokenFor } from '../../../../di/decorators/inject-repository.decorator.ts';
import { Inject } from '../../../../di/decorators/inject.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../../../di/inject.function.ts';
import { RateLimiter } from '../../../../rate-limiting/decorators/rate-limiter.decorator.ts';
import { GcraRateLimiter, GcraState } from '../../../../rate-limiting/limiter/gcra.rate-limiter.ts';
import { RateLimitStateEntity } from '../../../../rate-limiting/stores/rate-limit-state-entity.model.ts';
import { InProcessRateLimiterLock } from '../../../../rate-limiting/stores/rate-limiter-lock.interface.ts';
import { RepositoryRateLimiterStore } from '../../../../rate-limiting/stores/repository.rate-limiter-store.ts';
import { Ms } from '../../../../utilities/ms.ts';

/**
 * How often a user is sent a two factor code by email or text message: once per `resendAfterMs` of
 * `TWO_FACTOR_CODE_OPTIONS`, for each user and channel.
 *
 * Counted in the data source, in `RateLimitStateEntity`, so the limit holds across every instance.
 */
@RateLimiter({ register: 'onUse' })
export class TwoFactorCodeRateLimiter extends GcraRateLimiter {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.TWO_FACTOR_CODE_OPTIONS)
        options: TwoFactorCodeOptions
    ) {
        super(
            options.resendAfterMs ?? Ms.MINUTE,
            {
                name: 'TwoFactorCodeRateLimiter',
                // the lock of this process only: every write is compared against the version it read,
                // which keeps the count right across instances, and the lock only keeps this process's
                // own writes from retrying against each other
                store: new RepositoryRateLimiterStore<GcraState>(
                    inject(repositoryTokenFor(RateLimitStateEntity)),
                    new InProcessRateLimiterLock(),
                    'TwoFactorCodeRateLimiter'
                ),
                capacity: 1,
                maxReservationWaitMs: undefined
            }
        );
    }
}