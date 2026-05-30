# Metrics
Zibri contains a pretty basic metrics service. It collects up to 60 snapshots. If you need more than that you should use an external service, like prometheus.

## Collecting data
For collecting data the service provides a collect method:

```ts
import { MetricsServiceInterface, inject, ZIBRI_DI_TOKENS } from 'zibri';
// ...
const metricsService: MetricsServiceInterface = inject(ZIBRI_DI_TOKENS.METRICS_SERVICE);
await metricsService.collect();
// ...
```

You will however most likely use the provided `ScrapeMetricsCronJob` which collects a snapshot every 5 seconds.
See [registering cron jobs](./cron.md#registering-the-cron-job).

## Exposing a basic dashboard
By default, your project contains a `metrics.tsx` file that is used to display the data of the metrics service.

You can simply create a new controller and expose it there:

```ts
// src/controllers/metrics.controller.ts
import { Controller, Inject, PreactUtilities, ZIBRI_DI_TOKENS, Metric, Get, Response, HtmlResponse, MetricsSnapshot, GlobalRegistry, MetricsServiceInterface } from 'zibri';

import { MetricsPage } from '../templates/pages/metrics';

@Controller('/metrics')
export class MetricsController {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.METRICS_SERVICE)
        private readonly metricsService: MetricsServiceInterface
    ) {}

    // optional, to be used with an external tool like prometheus
    @Get()
    @Response.array(Metric)
    get(): MetricsSnapshot[] {
        return this.metricsService.getMetricSnapshots();
    }

    @Response.html()
    @Get('/dashboard')
    async dashboard(): Promise<HtmlResponse> {
        const version: string = GlobalRegistry.getAppData('version') ?? '-';
        const html: string = await PreactUtilities.renderPage(
            MetricsPage,
            { version, cacheNames, primary: '#0e456f', secondary: '#00b4d8' }
        );
        return HtmlResponse.fromString(html);
    }
}
```

Now you can navigate to `http://localhost:3000/metrics/dashboard` and see it in action.

There are also placeholders commented out in the `navbar.tsx` and the `home.tsx` files that link to this basic dashboard.