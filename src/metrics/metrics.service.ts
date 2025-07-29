import { Registry, Counter, Histogram, collectDefaultMetrics, Gauge, MetricObjectWithValues, MetricValue } from 'prom-client';
import si from 'systeminformation';

import { CounterMetricName, GaugeMetricName, HistogramMetricName, MetricsServiceInterface, MetricsSnapshot } from './metrics-service.interface';
import { ZibriApplication } from '../application';
import { HttpRequest, HttpResponse } from '../http';
import { CounterInterface } from './counter.interface';
import { GaugeInterface } from './gauge.interface';
import { HistogramInterface } from './histogram.interface';
import { MetricType } from './metric-type.enum';
import { Metric } from './metric.model';
import { ScrapeMetricsCronJob } from './scrape-metrics.cron-job';
import { AssetServiceInterface } from '../assets';
import { inject, ZIBRI_DI_TOKENS } from '../di';

/**
 *
 */
class PromCounter implements CounterInterface {
    constructor(private readonly inner: Counter<string>) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    increase(labels: Record<string, string> = {}, v = 1): void {
        this.inner.inc(labels, v);
    }
}

/**
 *
 */
class PromGauge implements GaugeInterface {
    constructor(private readonly inner: Gauge<string>) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    increase(labels: Record<string, string> = {}, v = 1): void {
        this.inner.inc(labels, v);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    decrease(labels: Record<string, string> = {}, v = 1): void {
        this.inner.dec(labels, v);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    set(labels: Record<string, string>, v: number): void {
        this.inner.set(labels, v);
    }
}

/**
 *
 */
class PromHistogram implements HistogramInterface {
    constructor(private readonly inner: Histogram<string>) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    observe(labels: Record<string, string>, v: number): void {
        this.inner.observe(labels, v);
    }
}

/**
 * Default metrics service implementation of Zibri.
 */
export class PrometheusMetricsService implements MetricsServiceInterface {
    private readonly registry: Registry;
    private readonly counters: Map<string, Counter<string>> = new Map<string, Counter<string>>();
    private readonly gauges: Map<string, Gauge<string>> = new Map<string, Gauge<string>>();
    private readonly histograms: Map<string, Histogram<string>> = new Map<string, Histogram<string>>();
    private readonly metricSnapshots: MetricsSnapshot[] = [];

    constructor() {
        this.registry = new Registry();
        collectDefaultMetrics({ register: this.registry, eventLoopMonitoringPrecision: 10 });

        this.getCounter('http_requests_total', ['method', 'route', 'status_code']);
        this.getHistogram(
            'http_request_duration_ms', ['method', 'route', 'status_code'], [50, 100, 200, 500, 1000, 2000, 5000]
        );
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    attachTo(app: ZibriApplication): void {
        app.options.cronJobs.push(ScrapeMetricsCronJob);
        app.use((req, res, next) => {
            const start: number = performance.now();
            res.on('finish', () => {
                const durationInMs: number = performance.now() - start;
                this.measureFinishedRequest(req as HttpRequest, res, durationInMs);
            });
            next();
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    measureFinishedRequest(req: HttpRequest, res: HttpResponse, durationInMs: number): void {
        // eslint-disable-next-line typescript/no-unsafe-member-access
        const route: string = req.originalUrl ?? req.route?.path ?? req.path;
        const assetService: AssetServiceInterface = inject(ZIBRI_DI_TOKENS.ASSET_SERVICE);

        if (route.startsWith(assetService.assetsRoute)) {
            return;
        }

        this.getCounter('http_requests_total').increase({
            method: req.method,
            route,
            status_code: String(res.statusCode)
        });

        this.getHistogram('http_request_duration_ms').observe({
            method: req.method,
            route,
            status_code: String(res.statusCode)
        }, durationInMs);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    getCounter(name: CounterMetricName, labelNames?: string[]): PromCounter {
        if (!this.counters.has(name)) {
            this.counters.set(name, new Counter({ name, help: name, labelNames, registers: [this.registry] }));
        }
        // eslint-disable-next-line typescript/no-non-null-assertion
        return new PromCounter(this.counters.get(name)!);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    getGauge(name: GaugeMetricName, labelNames?: string[]): PromGauge {
        if (!this.gauges.has(name)) {
            this.gauges.set(name, new Gauge({ name, help: name, labelNames, registers: [this.registry] }));
        }
        // eslint-disable-next-line typescript/no-non-null-assertion
        return new PromGauge(this.gauges.get(name)!);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    getHistogram(name: HistogramMetricName, labelNames?: string[], buckets?: number[]): PromHistogram {
        if (!this.histograms.has(name)) {
            this.histograms.set(name, new Histogram({ name, help: name, labelNames, buckets, registers: [this.registry] }));
        }
        // eslint-disable-next-line typescript/no-non-null-assertion
        return new PromHistogram(this.histograms.get(name)!);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async collect(): Promise<void> {
        const stats: si.Systeminformation.NetworkStatsData[] = await si.networkStats();
        const { rx_bytes, tx_bytes } = stats[0];

        const json: MetricObjectWithValues<MetricValue<string>>[] = await this.registry.getMetricsAsJSON();
        const metrics: Metric[] = json.flatMap(m => m.values.map(s => ({
            name: m.name,
            type: m.type as unknown as Metric['type'],
            value: s.value,
            labels: s.labels
        })));
        metrics.push(
            {
                name: 'network_bytes_received_total',
                labels: {},
                type: MetricType.COUNTER,
                value: rx_bytes
            },
            {
                name: 'network_bytes_transmitted_total',
                labels: {},
                type: MetricType.COUNTER,
                value: tx_bytes
            }
        );
        this.metricSnapshots.push({
            metrics,
            timestamp: new Date(Math.floor(Date.now() / 1000) * 1000)
        });
        if (this.metricSnapshots.length > 60) {
            this.metricSnapshots.shift();
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    getMetricSnapshots(): MetricsSnapshot[] {
        return this.metricSnapshots;
    }
}