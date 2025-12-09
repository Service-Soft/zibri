import { Controller, Inject, ZIBRI_DI_TOKENS, Metric, Get, Response, HtmlResponse, MetricsSnapshot, GlobalRegistry, MetricsServiceInterface } from 'zibri';

import renderBasePageTemplate from '../templates/pages/base-page.hbs';
import renderMetricsTemplate from '../templates/pages/metrics.hbs';

@Controller('/metrics')
export class MetricsController {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.METRICS_SERVICE)
        private readonly metricsService: MetricsServiceInterface
    ) {}

    @Get()
    @Response.array(Metric)
    get(): MetricsSnapshot[] {
        return this.metricsService.getMetricSnapshots();
    }

    @Response.html()
    @Get('/dashboard')
    dashboard(): HtmlResponse {
        const content: string = renderMetricsTemplate({
            name: GlobalRegistry.getAppData('name') ?? '-',
            version: GlobalRegistry.getAppData('version') ?? '-'
        });
        const html: string = renderBasePageTemplate({ base: { title: 'Metrics Dashboard' }, content });
        return HtmlResponse.fromString(html);
    }
}