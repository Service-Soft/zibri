import { Controller, Inject, ZIBRI_DI_TOKENS, Metric, Get, Response, MetricsSnapshot, MetricsServiceInterface, HtmlResponse, PreactUtilities, GlobalRegistry, CacheServiceInterface, Cached, RateLimitingServiceInterface } from 'zibri';

import { StaticPagesCache } from './page.controller';
import { MetricsPage } from '../templates/pages/metrics/metrics';

@Controller('/metrics', { versions: 'all' })
export class MetricsController {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.METRICS_SERVICE)
        private readonly metricsService: MetricsServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.CACHE_SERVICE)
        private readonly cacheService: CacheServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.RATE_LIMITING_SERVICE)
        private readonly rateLimitingService: RateLimitingServiceInterface
    ) {}

    @Response.array(Metric)
    @Get()
    get(): MetricsSnapshot[] {
        return this.metricsService.getMetricSnapshots();
    }

    @Cached(StaticPagesCache, () => StaticPagesCache.getPageKey('dashboard'))
    @Response.html()
    @Get('/dashboard')
    async dashboard(): Promise<HtmlResponse> {
        const version: string = GlobalRegistry.getAppData('version') ?? '-';
        const cacheNames: string[] = this.cacheService.caches.map(c => c.name);
        const rateLimiterNames: string[] = this.rateLimitingService.limiters.map(c => c.config.name);

        const html: string = await PreactUtilities.renderPage(
            MetricsPage,
            { version, cacheNames, rateLimiterNames, primary: '#0e456f', secondary: '#00b4d8' }
        );
        return HtmlResponse.fromString(html);
    }
}