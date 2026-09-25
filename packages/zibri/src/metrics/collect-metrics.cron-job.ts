import { type MetricsServiceInterface } from './metrics-service.interface';
import { CronExpression } from '../cron/cron-expression.utilities';
import { CronJob, InitialCronConfig } from '../cron/cron-job.model';
import { Inject } from '../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';

/**
 * CronJob that collects metrics.
 */
export class CollectMetricsCronJob extends CronJob {
    // eslint-disable-next-line jsdoc/require-jsdoc
    initialConfig: InitialCronConfig = {
        name: 'Collect Metrics',
        cron: CronExpression.every(5, 'seconds').build(),
        runOnInit: false,
        // every instance has its own registry and its own host, so this has to run on all of them.
        // Electing one would silently leave every other instance uncollected.
        distributed: false
    };

    constructor(
        @Inject(ZIBRI_DI_TOKENS.METRICS_SERVICE)
        private readonly metricsService: MetricsServiceInterface
    ) {
        super();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onTick(): Promise<void> {
        this.logger.debug('collects metrics');
        await this.metricsService.collect();
    }
}