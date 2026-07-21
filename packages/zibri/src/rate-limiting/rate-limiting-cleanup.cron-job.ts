import { type RateLimitingServiceInterface } from './rate-limiting-service.interface';
import { CronExpression } from '../cron/cron-expression.utilities';
import { CronJob, InitialCronConfig } from '../cron/cron-job.model';
import { Inject } from '../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';

/**
 * A cron job to cleanup expired rate limit data.
 */
export class RateLimitingCleanupCronJob extends CronJob {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly initialConfig: InitialCronConfig = {
        name: 'RateLimitingCleanupCronJob',
        cron: CronExpression.every(10, 'seconds').build(),
        runOnInit: false
    };

    constructor(
        @Inject(ZIBRI_DI_TOKENS.RATE_LIMITING_SERVICE)
        private readonly rateLimitingService: RateLimitingServiceInterface
    ) {
        super();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onTick(): Promise<void> {
        await this.rateLimitingService.cleanup();
    }
}