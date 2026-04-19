import { Controller, Inject, ZIBRI_DI_TOKENS, Metric, Get, Response, MetricsSnapshot, MetricsServiceInterface, HtmlResponse, PreactUtilities, GlobalRegistry } from 'zibri';

import { MetricsPage } from '../templates/pages/metrics';

@Controller('/metrics')
export class MetricsController {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.METRICS_SERVICE)
        private readonly metricsService: MetricsServiceInterface
    ) {}

    @Response.array(Metric)
    @Get()
    get(): MetricsSnapshot[] {
        return this.metricsService.getMetricSnapshots();
    }

    @Response.html()
    @Get('/dashboard')
    async dashboard(): Promise<HtmlResponse> {
        const version: string = GlobalRegistry.getAppData('version') ?? '-';
        const html: string = await PreactUtilities.renderPage(MetricsPage, { version, primary: '#0e456f', secondary: '#00b4d8' });
        return HtmlResponse.fromString(html);
    }
}