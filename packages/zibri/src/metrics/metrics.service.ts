import os from 'node:os';

import type { Registry, Counter, Histogram, Gauge, MetricObjectWithValues, MetricValue } from 'prom-client';
import type { Systeminformation } from 'systeminformation';

import { CollectMetricsCronJob } from './collect-metrics.cron-job.ts';
import { CounterInterface } from './counter.interface.ts';
import { GaugeInterface } from './gauge.interface.ts';
import { HistogramInterface } from './histogram.interface.ts';
import { MetricType } from './metric-type.enum.ts';
import { Metric } from './metric.model.ts';
import { CounterMetricName, GaugeMetricName, HistogramMetricName, MetricsServiceInterface, MetricsSnapshot } from './metrics-service.interface.ts';
import { ZibriApplication } from '../application/application.ts';
import { type AssetServiceInterface } from '../assets/asset-service.interface.ts';
import { Inject } from '../di/decorators/inject.decorator.ts';
import { Injectable } from '../di/decorators/injectable.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default.ts';
import { OnAppInit } from '../global/on-app-init.interface.ts';
import { HttpRequest } from '../http/http-request.model.ts';
import { HttpResponse } from '../http/http-response.model.ts';
import { MiddlewarePhase } from '../http/middleware-phase.enum.ts';
import { RouteLabelUtilities } from '../http/route-label.utilities.ts';
import { optionalPeer } from '../utilities/optional-peer.function.ts';

// eslint-disable-next-line jsdoc-js/require-jsdoc
class PromCounter implements CounterInterface {
    constructor(private readonly inner: Counter<string>) {}

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    increase(labels: Record<string, string> = {}, v = 1): void {
        this.inner.inc(labels, v);
    }
}

// eslint-disable-next-line jsdoc-js/require-jsdoc
class PromGauge implements GaugeInterface {
    constructor(private readonly inner: Gauge<string>) {}

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    increase(labels: Record<string, string> = {}, v = 1): void {
        this.inner.inc(labels, v);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    decrease(labels: Record<string, string> = {}, v = 1): void {
        this.inner.dec(labels, v);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    set(labels: Record<string, string>, v: number): void {
        this.inner.set(labels, v);
    }
}

// eslint-disable-next-line jsdoc-js/require-jsdoc
class PromHistogram implements HistogramInterface {
    constructor(private readonly inner: Histogram<string>) {}

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    observe(labels: Record<string, string>, v: number): void {
        this.inner.observe(labels, v);
    }
}

/**
 * Default metrics service implementation of Zibri.
 */
@Injectable({ register: 'onUse' })
export class PrometheusMetricsService implements MetricsServiceInterface, OnAppInit {
    private readonly registry: Registry;
    private readonly counters: Map<string, Counter<string>> = new Map<string, Counter<string>>();
    private readonly gauges: Map<string, Gauge<string>> = new Map<string, Gauge<string>>();
    private readonly histograms: Map<string, Histogram<string>> = new Map<string, Histogram<string>>();
    private readonly metricSnapshots: MetricsSnapshot[] = [];

    // eslint-disable-next-line sonarjs/no-duplicate-string
    private get promClient(): typeof import('prom-client') {
        // eslint-disable-next-line sonarjs/no-duplicate-string
        return optionalPeer<typeof import('prom-client')>('prom-client', 'Default metrics service implementation of Zibri.');
    }

    private get si(): typeof import('systeminformation') {
        return optionalPeer<typeof import('systeminformation')>('systeminformation', 'Default metrics service implementation of Zibri.');
    }

    constructor(
        @Inject(ZIBRI_DI_TOKENS.ASSET_SERVICE)
        private readonly assetService: AssetServiceInterface
    ) {
        this.registry = new this.promClient.Registry();
        this.promClient.collectDefaultMetrics({ register: this.registry, eventLoopMonitoringPrecision: 10 });

        this.getCounter('http_requests_total', ['method', 'route', 'status_code']);
        this.getHistogram(
            'http_request_duration_ms', ['method', 'route', 'status_code'], [50, 100, 200, 500, 1000, 2000, 5000]
        );
        this.getGauge('process_cpu_count').set({ }, os.availableParallelism());
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    onAppInit(app: ZibriApplication): void {
        optionalPeer('systeminformation', 'Default metrics service implementation of Zibri.');

        if (!app.options.cronJobs.includes(CollectMetricsCronJob)) {
            app.options.cronJobs.push(CollectMetricsCronJob);
        }
        app.use((req, res, next) => {
            const start: number = performance.now();
            // 'close' rather than 'finish': finish only fires once a response has been written in
            // full, so a client that hung up and a request that died halfway were never counted at
            // all - invisible in the very metric that is supposed to show them. close fires for both,
            // and exactly once either way
            res.on('close', () => {
                const durationInMs: number = performance.now() - start;
                this.measureFinishedRequest(req as HttpRequest, res, durationInMs);
            });
            next();
        }, MiddlewarePhase.OBSERVABILITY);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    measureFinishedRequest(req: HttpRequest, res: HttpResponse, durationInMs: number): void {
        if (req.path.startsWith(this.assetService.assetsRoute)) {
            return;
        }

        const route: string = RouteLabelUtilities.resolveRouteLabel(req);

        // Prometheus/HTTP metrics convention expects the canonical uppercase method token, unlike our
        // lowercase HttpMethod enum values (same reasoning as HttpClient.buildRequestInit()).
        const method: string = req.method;
        const statusCode: string = String(RouteLabelUtilities.resolveStatusCode(res));

        this.getCounter('http_requests_total').increase({ method, route, status_code: statusCode });

        this.getHistogram('http_request_duration_ms').observe({ method, route, status_code: statusCode }, durationInMs);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    getCounter(name: CounterMetricName, labelNames: string[] = []): PromCounter {
        if (!this.counters.has(name)) {
            this.counters.set(name, new this.promClient.Counter({ name, help: name, labelNames, registers: [this.registry] }));
        }
        // eslint-disable-next-line typescript/no-non-null-assertion
        return new PromCounter(this.counters.get(name)!);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    getGauge(name: GaugeMetricName, labelNames: string[] = []): PromGauge {
        if (!this.gauges.has(name)) {
            this.gauges.set(name, new this.promClient.Gauge({ name, help: name, labelNames, registers: [this.registry] }));
        }
        // eslint-disable-next-line typescript/no-non-null-assertion
        return new PromGauge(this.gauges.get(name)!);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    getHistogram(name: HistogramMetricName, labelNames: string[] = [], buckets: number[] = []): PromHistogram {
        if (!this.histograms.has(name)) {
            this.histograms.set(name, new this.promClient.Histogram({ name, help: name, labelNames, buckets, registers: [this.registry] }));
        }
        // eslint-disable-next-line typescript/no-non-null-assertion
        return new PromHistogram(this.histograms.get(name)!);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async collect(): Promise<void> {
        // one entry per interface, and there can be none: a container with no interface of its own,
        // or a probe the host would not answer
        const stats: Systeminformation.NetworkStatsData[] = await this.si.networkStats();

        const json: MetricObjectWithValues<MetricValue<string>>[] = await this.registry.getMetricsAsJSON();
        const metrics: Metric[] = json.flatMap(m => m.values.map(s => ({
            name: 'metricName' in s && typeof s.metricName === 'string' ? s.metricName : m.name,
            type: m.type as unknown as Metric['type'],
            value: s.value,
            labels: s.labels
        })));
        // labelled by interface, so the answer to "how much traffic" is the query's to decide. One
        // unlabelled pair had to pick an interface to be about, and whichever one the probe happens
        // to enumerate first is a machine's loopback about as often as it is its uplink
        for (const network of stats) {
            metrics.push(
                {
                    name: 'network_bytes_received_total',
                    labels: { interface: network.iface },
                    type: MetricType.COUNTER,
                    value: network.rx_bytes
                },
                {
                    name: 'network_bytes_transmitted_total',
                    labels: { interface: network.iface },
                    type: MetricType.COUNTER,
                    value: network.tx_bytes
                }
            );
        }
        this.metricSnapshots.push({
            metrics,
            timestamp: new Date(Math.floor(Date.now() / 1000) * 1000)
        });
        if (this.metricSnapshots.length > 60) {
            this.metricSnapshots.shift();
        }
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    getMetricSnapshots(): MetricsSnapshot[] {
        return this.metricSnapshots;
    }
}