import { CronExpression } from '../../cron/cron-expression.utilities';
import { CronJob, InitialCronConfig } from '../../cron/cron-job.model';
import { inject } from '../../di/inject.function';
import { ZIBRI_ANALYTICS_PLUGIN_DI_TOKENS } from './analytics.tokens';

/**
 * Checks the record of every verified site of a tenant once a day, and takes the verification of a site whose record
 * was missing for `verificationRecordGraceInMs` of the analytics plugin.
 */
export class AnalyticsSiteVerificationCronJob extends CronJob {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly initialConfig: InitialCronConfig = {
        name: 'Analytics Site Verification',
        cron: CronExpression.daily().build(),
        runOnInit: false
    };

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onTick(): Promise<void> {
        // read when used rather than injected, for the reason AnalyticsCleanupCronJob reads its service so
        const unverified: number = await inject(ZIBRI_ANALYTICS_PLUGIN_DI_TOKENS.ANALYTICS_SERVICE).recheckVerifiedSites();
        this.logger.info(`took the verification of ${unverified} analytics sites whose record is missing`);
    }
}