/* eslint-disable jsdoc/require-jsdoc */
import { TokenRecord } from '../../di/models/di-token.model';
import { InjectionToken } from '../../di/models/injection-token.model';
import { type RateLimiterInterface } from '../../rate-limiting/limiter/rate-limiter.interface';
import { AnalyticsPluginOptionsInput } from './models/analytics-plugin-options-input.model';
import { AnalyticsPluginOptions } from './models/analytics-plugin-options.model';
import { AnalyticsDnsServiceInterface } from './services/analytics-dns-service.interface';
import { AnalyticsServiceInterface } from './services/analytics-service.interface';

/**
 * The dependency injection tokens used by the ZibriAnalyticsPlugin.
 */
// eslint-disable-next-line typescript/typedef
export const ZIBRI_ANALYTICS_PLUGIN_DI_TOKENS = {
    OPTIONS_INPUT: analyticsToken<AnalyticsPluginOptionsInput>('zi.analytics.options_input'),
    OPTIONS: analyticsToken<AnalyticsPluginOptions>('zi.analytics.options'),
    ANALYTICS_SERVICE: analyticsToken<AnalyticsServiceInterface>('zi.analytics.analytics_service'),
    DNS_SERVICE: analyticsToken<AnalyticsDnsServiceInterface>('zi.analytics.dns_service'),
    // any for the reason ZIBRI_DI_TOKENS.AUTH_RATE_LIMITER is: a limiter of any algorithm fits
    // eslint-disable-next-line typescript/no-explicit-any
    RATE_LIMITER: analyticsToken<RateLimiterInterface<any>>('zi.analytics.rate_limiter')
} as const satisfies TokenRecord;

function analyticsToken<T = never>(k: `zi.analytics.${string}`): InjectionToken<T> {
    return new InjectionToken<T>(k);
}