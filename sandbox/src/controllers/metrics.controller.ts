import { Controller, Inject, ZIBRI_DI_TOKENS, Metric, Get, Response, MetricsSnapshot, MetricsServiceInterface, HtmlResponse, PreactUtilities, GlobalRegistry, CacheServiceInterface, Cached } from 'zibri';

import { StaticPagesCache } from './page.controller';
import { MetricsPage } from '../templates/pages/metrics';

@Controller('/metrics')
export class MetricsController {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.METRICS_SERVICE)
        private readonly metricsService: MetricsServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.CACHE_SERVICE)
        private readonly cacheService: CacheServiceInterface
    ) {}

    @Response.array(Metric)
    @Get()
    get(): MetricsSnapshot[] {
        return this.metricsService.getMetricSnapshots();
    }

    @Cached(StaticPagesCache, () => 'dashboard')
    @Response.html()
    @Get('/dashboard')
    async dashboard(): Promise<HtmlResponse> {
        const version: string = GlobalRegistry.getAppData('version') ?? '-';
        const cacheNames: string[] = this.cacheService.caches.map(c => c.name);
        const html: string = await PreactUtilities.renderPage(
            MetricsPage,
            { version, cacheNames, primary: '#0e456f', secondary: '#00b4d8' }
        );
        return HtmlResponse.fromString(html);
    }
}