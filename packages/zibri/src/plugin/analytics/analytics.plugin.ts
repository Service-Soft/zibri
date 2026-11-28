import { ZibriApplication } from '../../application/application';
import { CronJob } from '../../cron/cron-job.model';
import { NoProviderError } from '../../di/errors/no-provider.error';
import { inject } from '../../di/inject.function';
import { DiProvider } from '../../di/models/di-provider.model';
import { DiTokenProviderRecord, providersFromTokenRecord } from '../../di/models/di-token.model';
import { DiVariants } from '../../di/models/di-variant.model';
import { InternalError } from '../../error-handling/internal-error.model';
import { Newable } from '../../types/newable.type';
import { Ms } from '../../utilities/ms';
import { validateEntitiesRegistered } from '../../utilities/validate-entities-registered.function';
import { validateTokensRegistered } from '../../utilities/validate-tokens-registered.function';
import { ZibriPlugin } from '../plugin.model';
import { AnalyticsCleanupCronJob } from './analytics-cleanup.cron-job';
import { AnalyticsSiteVerificationCronJob } from './analytics-site-verification.cron-job';
import { AnalyticsRateLimiter } from './analytics.rate-limiter';
import { ZIBRI_ANALYTICS_PLUGIN_DI_TOKENS } from './analytics.tokens';
import { AnalyticsEventRecord } from './models/analytics-event-record.model';
import { AnalyticsPageViewRecord } from './models/analytics-page-view-record.model';
import { AnalyticsPluginOptionsInput } from './models/analytics-plugin-options-input.model';
import { AnalyticsPluginOptions } from './models/analytics-plugin-options.model';
import { AnalyticsSite } from './models/analytics-site.model';
import { AnalyticsDnsService } from './services/analytics-dns.service';
import { AnalyticsService } from './services/analytics.service';

/**
 * Plugin that counts the page views and events of your sites, without keeping an address or a `User-Agent`.
 */
export class ZibriAnalyticsPlugin extends ZibriPlugin {
    private readonly defaultDiProviders: DiTokenProviderRecord<typeof ZIBRI_ANALYTICS_PLUGIN_DI_TOKENS> = {
        // in which time zone the days are, only the application knows
        OPTIONS_INPUT: {
            useFactory: () => {
                throw new NoProviderError(ZIBRI_ANALYTICS_PLUGIN_DI_TOKENS.OPTIONS_INPUT, []);
            }
        },
        OPTIONS: {
            useFactory: () => {
                const input: AnalyticsPluginOptionsInput = inject(ZIBRI_ANALYTICS_PLUGIN_DI_TOKENS.OPTIONS_INPUT);
                const res: AnalyticsPluginOptions = { retentionInMs: Ms.YEAR * 2, verificationRecordGraceInMs: Ms.DAY * 7, ...input };
                return res;
            }
        },
        ANALYTICS_SERVICE: { useClass: AnalyticsService },
        DNS_SERVICE: { useClass: AnalyticsDnsService },
        RATE_LIMITER: { useClass: AnalyticsRateLimiter, variants: [DiVariants.RATE_LIMITER] }
    };

    override providers: DiProvider<unknown>[] = providersFromTokenRecord(ZIBRI_ANALYTICS_PLUGIN_DI_TOKENS, this.defaultDiProviders);

    override cronJobs: Newable<CronJob>[] = [AnalyticsCleanupCronJob, AnalyticsSiteVerificationCronJob];

    // eslint-disable-next-line jsdoc/require-jsdoc
    validate(app: ZibriApplication): void {
        validateEntitiesRegistered(this.constructor.name, app, AnalyticsSite, AnalyticsPageViewRecord, AnalyticsEventRecord);
        validateTokensRegistered(this.constructor.name, ZIBRI_ANALYTICS_PLUGIN_DI_TOKENS);

        const options: AnalyticsPluginOptions = inject(ZIBRI_ANALYTICS_PLUGIN_DI_TOKENS.OPTIONS);
        if (options.retentionInMs !== 'forever' && options.retentionInMs <= 0) {
            throw new InternalError(`${this.constructor.name} needs a retentionInMs above 0, or 'forever'.`);
        }
        if (options.verificationRecordGraceInMs <= 0) {
            throw new InternalError(`${this.constructor.name} needs a verificationRecordGraceInMs above 0.`);
        }
    }
}