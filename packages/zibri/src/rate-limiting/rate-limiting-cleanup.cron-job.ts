import { type RateLimitingServiceInterface } from './rate-limiting-service.interface.ts';
import { CronExpression } from '../cron/cron-expression.utilities.ts';
import { CronJob, InitialCronConfig } from '../cron/cron-job.model.ts';
import { Inject } from '../di/decorators/inject.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default.ts';

/**
 * A cron job to cleanup expired rate limit data.
 */
export class RateLimitingCleanupCronJob extends CronJob {
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    readonly initialConfig: InitialCronConfig = {
        name: 'RateLimitingCleanupCronJob',
        cron: CronExpression.every(10, 'seconds').build(),
        runOnInit: false,
        // the default limiter store is in memory, so each instance has counters only it can expire.
        // Stays correct for a shared store too - cleanup is idempotent, it just runs more often, and
        // a run against one costs two operations plus one per key actually holding an abandoned
        // reservation. Running it everywhere is cheap enough not to need a mechanism to run it once.
        distributed: false
    };

    constructor(
        @Inject(ZIBRI_DI_TOKENS.RATE_LIMITING_SERVICE)
        private readonly rateLimitingService: RateLimitingServiceInterface
    ) {
        super();
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async onTick(): Promise<void> {
        await this.rateLimitingService.cleanup();
    }
}