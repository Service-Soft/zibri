# Metrics
Your application records metrics about requests and about its background work, and keeps the last 60 snapshots of them. For a longer history, let Prometheus scrape them, see [scraping](#scraping).

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `MetricsServiceInterface` | interface | Records metrics, collects snapshots and answers a scrape |
| `ZIBRI_DI_TOKENS.METRICS_SERVICE` | DI token | Injects `MetricsServiceInterface` |
| `ZIBRI_DI_TOKENS.METRICS_REQUEST_DURATION_BUCKETS_IN_MS` | DI token | The buckets of `http_request_duration_seconds`, in milliseconds. Defaults to 50 up to 5000 |
| `PrometheusMetricsService` | class | The default `MetricsServiceInterface`. Replaceable through ZIBRI_DI_TOKENS.METRICS_SERVICE |
| `CounterInterface`, `GaugeInterface`, `HistogramInterface` | interface, interface, interface | What `getCounter`, `getGauge` and `getHistogram` return: a counter to increase, a gauge to set, a histogram to observe values in |
| `PromCounter`, `PromGauge`, `PromHistogram` | class, class, class | The counter, gauge and histogram `PrometheusMetricsService` returns |
| `CounterMetricName`, `GaugeMetricName`, `HistogramMetricName` | type, type, type | The name of a counter, a gauge or a histogram, with the names recorded for you suggested |
| `CollectMetricsCronJob` | cron job | Collects a metrics snapshot every 5 seconds. Registered for you |
| `Metric` | class | A single collected metric within a snapshot |
| `MetricType` | enum | Whether a `Metric` is a counter, a gauge or a histogram |
| `MetricsSnapshot` | class | A snapshot of all metrics at a point in time |
| `MetricsExposition` | type | The metrics in the text format Prometheus scrapes, with its content type |
| `MetricsCollector` | type | Work that sets gauges before the metrics are read |
| `ZIBRI_DI_TOKENS.METRICS_DATA_SOURCE_COLLECTOR_INTERVAL_IN_MS` | DI token | How often a collector reading the data source runs at most, such as the one counting a queue. Defaults to 30 seconds |

## Collecting data
`collect` takes a snapshot:

```ts
// src/services/metrics-snapshot.service.ts
import { MetricsServiceInterface, inject, ZIBRI_DI_TOKENS } from 'zibri';

export async function collectSnapshot(): Promise<void> {
    const metricsService: MetricsServiceInterface = inject(ZIBRI_DI_TOKENS.METRICS_SERVICE);
    await metricsService.collect();
}
```

`CollectMetricsCronJob` takes one every 5 seconds. It is registered for you.

## What a snapshot contains

Every counter, gauge and histogram the application registered, plus what the framework collects on
its own:

| Metric | Labels | Holds |
|---|---|---|
| `http_requests_total` | `method`, `route`, `status_code` | How many requests each route answered |
| `http_request_duration_seconds` | `method`, `route`, `status_code` | How long they took |
| `process_cpu_count` | | How many threads the machine can run in parallel |
| `process_*`, `nodejs_*` | | The standard Node.js process metrics: CPU time, memory, heap, event loop lag, handles and garbage collection |
| `network_bytes_received_total` | `interface` | Bytes that interface received |
| `network_bytes_transmitted_total` | `interface` | Bytes that interface transmitted |
| `cache_hits_total` | `cache` | How many calls each [cache](./caching.md) answered from its store |
| `cache_misses_total` | `cache` | How many calls ran the method |
| `cache_writes_total` | `cache` | How many values were written to it |
| `cache_deletes_total` | `cache` | How many entries were deleted from it |
| `cache_invalidations_total` | `cache` | How many tag invalidations reached it |
| `cache_invalidation_failures_total` | `cache` | How many of those failed |
| `cache_errors_total` | `cache`, `operation` | How many operations on it failed |
| `cache_in_flight` | `cache` | How many keys are being loaded right now |
| `cache_size` | `cache` | How many entries it holds |
| `cache_expired_evictions_total` | `cache` | How many entries left it for having expired |
| `cache_store_duration_seconds` | `cache`, `operation` | How long its store took |
| `cache_source_duration_seconds` | `cache`, `operation` | How long the cached method took |
| `rate_limit_allowed_total` | `limiter` | How many calls each [rate limiter](./rate-limiting.md) let through |
| `rate_limit_blocked_total` | `limiter` | How many it refused |
| `rate_limit_errors_total` | `limiter`, `operation` | How many of its calls and store operations failed |
| `rate_limit_active_keys` | `limiter` | How many keys its store holds |
| `rate_limit_active_reservations` | `limiter` | How many reservations are open |
| `rate_limit_decision_duration_seconds` | `limiter` | How long a decision took |
| `rate_limit_store_duration_seconds` | `limiter`, `operation` | How long its store took |
| `rate_limit_remaining_ratio` | `limiter` | How much of the capacity was left after a call, from 0 to 1 |
| `rate_limit_retry_after_seconds` | `limiter` | How long a refused caller had to wait |
| `cron_job_runs_total` | `job` | How many times each cron job ran on this instance |
| `cron_job_failures_total` | `job` | How many of those runs failed, after their retries |
| `cron_job_duration_seconds` | `job` | How long they took, retries included |
| `email_queue_depth` | `status` | How many mails are `QUEUED`, and how many `FAILED` |
| `email_queue_oldest_age_seconds` | | How long the oldest queued mail has waited |
| `event_queue_depth` | `status` | How many events are owed a run (`CREATED`), and how many `FAILED` |
| `event_queue_oldest_age_seconds` | | How long the oldest event owed a run has waited |
| `event_subscriber_runs` | `status` | How many subscriber runs wait for a retry (`PENDING_RETRY`), and how many `FAILED` |
| `thread_job_queue_depth` | `status` | How many thread jobs are `IN_QUEUE`, `IN_PROGRESS`, `INTERRUPTED` and `FAILED` |
| `thread_job_queue_oldest_age_seconds` | | How long the oldest queued thread job has waited |
| `thread_workers` | `state` | How many of this instance's workers are `busy`, and how many `idle` |
| `lease_renewal_failures_total` | | How many renewals of a [lease](./leases.md) failed on this instance |
| `leases_lost_total` | | How many leases this instance lost while its work still ran |
| `log_entries_dropped_total` | | How many log entries were dropped because the write queue was full |
| `audit_entries_pending` | | How many [audit entries](./audit.md) wait to be stored |

A queue's gauges are the deployment's: every instance reports the same numbers, counted at most every `METRICS_DATA_SOURCE_COLLECTOR_INTERVAL_IN_MS`. Each count reads the data source once on every instance, so a shorter interval makes the gauges fresher and costs the data source more. The cron, worker, lease, log, audit, cache and rate limiter metrics are each instance's own, except `cache_size` and `rate_limit_active_keys`, which count what the store holds. A queue gauge of a subsystem your application does not use is not reported.

`route` is the route template, such as `/invoices/:id`, so a path parameter stays out of the
label. A request that matched no route is counted as `<unmatched>`.

Every duration is in seconds, the way Prometheus names them, as a fraction where it is shorter.

`http_request_duration_seconds` counts the requests into buckets of 50, 100, 200, 500, 1000, 2000 and 5000 milliseconds. For an API that mostly answers within a few milliseconds, give it finer ones, in milliseconds:

```ts
// src/providers.ts
import { defineProvider, ZIBRI_DI_TOKENS } from 'zibri';

defineProvider({ token: ZIBRI_DI_TOKENS.METRICS_REQUEST_DURATION_BUCKETS_IN_MS, useValue: [5, 10, 25, 50, 100, 250, 1000] })
```

Each bucket is one more series for every route, method and status code.

The two network counters are collected once per interface and labeled with its name, so a query
names the interface it means. They are the counters of the machine the process runs on, so they
include traffic that is not the application's.

## Scraping
`resolveExposition` answers with every metric in the text format Prometheus scrapes. Serve it from a route of your own:

```ts
// src/controllers/scrape.controller.ts
import { Readable } from 'node:stream';

import { Controller, FileResponse, Get, Inject, MetricsExposition, MetricsServiceInterface, Response, ZIBRI_DI_TOKENS } from 'zibri';

@Controller('/scrape', { versions: 'all' })
export class ScrapeController {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.METRICS_SERVICE)
        private readonly metricsService: MetricsServiceInterface
    ) {}

    @Response.file()
    @Get()
    async scrape(): Promise<FileResponse> {
        const exposition: MetricsExposition = await this.metricsService.resolveExposition();
        return FileResponse.fromStream({ stream: Readable.from([exposition.body]), filename: 'metrics.txt', mimeType: exposition.contentType });
    }
}
```

Let Prometheus scrape every instance. A query sums the per instance metrics, for example `sum by (job) (rate(cron_job_failures_total[5m]))`, and takes the maximum of a queue's, for example `max(email_queue_depth{status="QUEUED"})`.

## Adding gauges of your own
A gauge that is counted rather than kept up to date as things happen is set by a collector. It runs before a snapshot is collected and before a scrape is answered, at most once every `minIntervalInMs`:

```ts
// src/services/order-metrics.service.ts
import { inject, MetricsServiceInterface, OnAppInit, Repository, ZIBRI_DI_TOKENS } from 'zibri';

import { Order } from '../models/order.model';

export class OrderMetrics implements OnAppInit {
    constructor(private readonly orders: Repository<Order>) {}

    onAppInit(): void {
        const metricsService: MetricsServiceInterface = inject(ZIBRI_DI_TOKENS.METRICS_SERVICE);
        metricsService.addCollector({
            name: 'open orders',
            minIntervalInMs: 'dataSource',
            collect: async () => {
                metricsService.getGauge('open_orders').set({}, await this.orders.count({ where: { status: 'open' } }));
            }
        });
    }
}
```

`'dataSource'` runs it at most every `METRICS_DATA_SOURCE_COLLECTOR_INTERVAL_IN_MS`, like the collectors counting the queues. A number of milliseconds sets an interval of its own, and `0` runs it on every read.

A collector that throws is logged, and its gauges keep what its last run set.

## Choosing labels
Every combination of label values a metric is given is a series of its own. The application keeps
each one for as long as it runs, and Prometheus stores each one it scrapes. A metric costs what its
number of series costs, and the traffic does not change that number as long as every label takes its
values from a short list your code knows:

```ts
// src/services/payment-metrics.service.ts
import { inject, ZIBRI_DI_TOKENS } from 'zibri';

export function countPayment(provider: 'stripe' | 'paypal', outcome: 'paid' | 'declined'): void {
    inject(ZIBRI_DI_TOKENS.METRICS_SERVICE).getCounter('payments_total', ['provider', 'outcome']).increase({ provider, outcome });
}
```

A label never holds what a request brings: an id, an email address, a URL or its query, a search term,
or the id of one [tenant](./glossary.md#tenant) among many. Each new value adds a series, so a caller sending new values
grows the memory of the application without end. Write such values into a [log entry](./logging.md)
instead, where a collector searches them, and count in the metric what they have in common.

The labels the framework writes take their values from your code: the route template, the name of
each cache, rate limiter and cron job, and a status out of a fixed list. A request that matched no
route is counted as `<unmatched>`, so a scan for unknown paths adds no series.

## Exposing a basic dashboard
A project made with `zi new` and the [`metricsDashboard` feature](./project-layout.md#choosing-the-features) contains a `metrics.tsx` page that shows the data of the metrics service. Serve it from a controller:

```ts
// src/controllers/metrics.controller.ts
import { Controller, Inject, ZIBRI_DI_TOKENS, Get, Response, MetricsSnapshot, MetricsServiceInterface, HtmlResponse, TsxUtilities, GlobalRegistry, CacheServiceInterface, Cached, RateLimitingServiceInterface } from 'zibri';

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

    @Response.array(MetricsSnapshot)
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

        const html: string = TsxUtilities.renderPage(
            MetricsPage,
            { version, cacheNames, rateLimiterNames, primary: '#0e456f', secondary: '#00b4d8' }
        );
        return HtmlResponse.fromString(html);
    }
}
```

The dashboard is at `http://localhost:3000/metrics/dashboard`.

`navbar.tsx` and `home.tsx` contain links to it, commented out.

## Requirements
| Package | Used for |
|---|---|
| `@prometheus-io/client` | Counters, gauges and histograms, the Node.js process metrics, and the text format Prometheus scrapes. You install it |
| `systeminformation` | The network counters of the machine. You install it |

## See also
- [Rate limiting](./rate-limiting.md) — the dashboard example above reads rate limiter stats via `RateLimitingServiceInterface`
- [Caching](./caching.md) — the dashboard example above caches its rendered HTML with `@Cached`
- [Cron jobs](./cron.md) — how `CollectMetricsCronJob` and other cron jobs run
