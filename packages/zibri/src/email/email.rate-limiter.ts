import { type EmailConfigInput } from './models/email-config.model.ts';
import { Inject } from '../di/decorators/inject.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default.ts';
import { InternalError } from '../error-handling/internal-error.model.ts';
import { RateLimiter } from '../rate-limiting/decorators/rate-limiter.decorator.ts';
import { TokenBucketRateLimiter, TokenBucketState } from '../rate-limiting/limiter/token-bucket.rate-limiter.ts';
import { InMemoryRateLimiterStore } from '../rate-limiting/stores/in-memory.rate-limiter-store.ts';
import { Ms } from '../utilities/ms.ts';

/**
 * Default email service rate limiter of Zibri.
 */
@RateLimiter({ register: 'onUse' })
export class EmailRateLimiter extends TokenBucketRateLimiter {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.EMAIL_CONFIG)
        config: EmailConfigInput | undefined
    ) {
        if (!config) {
            throw new InternalError('no email config was provided for the token "ZIBRI_DI_TOKENS.EMAIL_CONFIG"');
        }
        super(
            Ms.HOUR,
            {
                name: 'EmailRateLimiter',
                store: new InMemoryRateLimiterStore<TokenBucketState>(),
                capacity: config.maxEmailsPerHour,
                maxReservationWaitMs: undefined
            }
        );
    }
}