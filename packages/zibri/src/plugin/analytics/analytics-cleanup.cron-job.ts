import { CronExpression } from '../../cron/cron-expression.utilities';
import { CronJob, InitialCronConfig } from '../../cron/cron-job.model';
import { inject } from '../../di/inject.function';
import { ZIBRI_ANALYTICS_PLUGIN_DI_TOKENS } from './analytics.tokens';

/**
 * Deletes the page views and events older than the `retentionInMs` of the analytics plugin, once a day.
 */
export class AnalyticsCleanupCronJob extends CronJob {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly initialConfig: InitialCronConfig = {
        name: 'Analytics Cleanup',
        cron: CronExpression.daily().build(),
        runOnInit: false
    };

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onTick(): Promise<void> {
        // read when used rather than injected, for the reason PaymentReconciliationCronJob reads its service so
        const removed: number = await inject(ZIBRI_ANALYTICS_PLUGIN_DI_TOKENS.ANALYTICS_SERVICE).deleteExpiredRows();
        this.logger.info(`removed ${removed} analytics rows`);
    }
}