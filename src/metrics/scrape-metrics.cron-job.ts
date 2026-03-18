import { type MetricsServiceInterface } from './metrics-service.interface';
import { CronJob, InitialCronConfig } from '../cron/cron-job.model';
import { Inject } from '../di/decorators/inject.decorator';
import { Injectable } from '../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';

/**
 * CronJob that cleans up the temp folder of the form data body parser.
 */
@Injectable()
export class ScrapeMetricsCronJob extends CronJob {
    // eslint-disable-next-line jsdoc/require-jsdoc
    initialConfig: InitialCronConfig = {
        name: 'Scrape Metrics',
        cron: '*/5 * * * * *',
        runOnInit: false
    };

    constructor(
        @Inject(ZIBRI_DI_TOKENS.METRICS_SERVICE)
        private readonly metricsService: MetricsServiceInterface
    ) {
        super();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onTick(): Promise<void> {
        await this.logger.debug('scrapes metrics');
        await this.metricsService.collect();
    }
}