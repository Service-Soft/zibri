import { MetricsServiceInterface } from './metrics-service.interface';
import { CronJob, InitialCronConfig } from '../cron/cron-job.model';
import { Injectable } from '../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';

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

    private readonly metricsService: MetricsServiceInterface;

    constructor() {
        super();
        this.metricsService = inject(ZIBRI_DI_TOKENS.METRICS_SERVICE);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onTick(): Promise<void> {
        await this.logger.debug('scrapes metrics');
        await this.metricsService.collect();
    }
}