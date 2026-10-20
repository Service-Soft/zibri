import { type MetricsServiceInterface } from './metrics-service.interface.ts';
import { CronExpression } from '../cron/cron-expression.utilities.ts';
import { CronJob, InitialCronConfig } from '../cron/cron-job.model.ts';
import { Inject } from '../di/decorators/inject.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default.ts';

/**
 * CronJob that collects metrics.
 */
export class CollectMetricsCronJob extends CronJob {
    // eslint-disable-next-line jsdoc-js/require-jsdoc
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

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async onTick(): Promise<void> {
        this.logger.debug('collects metrics');
        await this.metricsService.collect();
    }
}