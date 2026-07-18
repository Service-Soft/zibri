# Metrics
Zibri contains a pretty basic metrics service. It collects up to 60 snapshots. If you need more than that you should use an external service, like prometheus.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `MetricsServiceInterface` | interface | Collects and reads metric snapshots |
| `ZIBRI_DI_TOKENS.METRICS_SERVICE` | DI token | Injects `MetricsServiceInterface` |
| `CollectMetricsCronJob` | class | Collects a metrics snapshot every 5 seconds |
| `Metric` | class | A single collected metric within a snapshot |
| `MetricsSnapshot` | type | A snapshot of all metrics at a point in time |

## Usage
### Collecting data
For collecting data the service provides a collect method:

```ts
import { MetricsServiceInterface, inject, ZIBRI_DI_TOKENS } from 'zibri';
// ...
const metricsService: MetricsServiceInterface = inject(ZIBRI_DI_TOKENS.METRICS_SERVICE);
await metricsService.collect();
// ...
```

You will however most likely use the provided `CollectMetricsCronJob` which collects a snapshot every 5 seconds.
See [registering cron jobs](./cron.md#registering-the-cron-job).

### Exposing a basic dashboard
By default, your project contains a `metrics.tsx` file that is used to display the data of the metrics service.

You can simply create a new controller and expose it there:

```ts
// src/controllers/metrics.controller.ts
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
```

Now you can navigate to `http://localhost:3000/metrics/dashboard` and see it in action.

There are also placeholders commented out in the `navbar.tsx` and the `home.tsx` files that link to this basic dashboard.

## See also
- [Rate limiting](./rate-limiting.md) — the dashboard example above reads rate limiter stats via `RateLimitingServiceInterface`
- [Caching](./caching.md) — the dashboard example above caches its rendered HTML with `@Cached`
- [Cron jobs](./cron.md) — registering `CollectMetricsCronJob` to collect snapshots automatically
