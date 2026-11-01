import os from 'node:os';

import type { Registry, Counter, Histogram, Gauge, MetricObjectWithValues, MetricValue } from '@prometheus-io/client';
import type { Systeminformation } from 'systeminformation';

import { CollectMetricsCronJob } from './collect-metrics.cron-job';
import { CounterInterface } from './counter.interface';
import { DurationHistogram } from './duration-histogram.model';
import { GaugeInterface } from './gauge.interface';
import { HistogramInterface } from './histogram.interface';
import { MetricType } from './metric-type.enum';
import { Metric } from './metric.model';
import { MetricsCollector } from './metrics-collector.model';
import { MetricsExposition } from './metrics-exposition.model';
import { CounterMetricName, GaugeMetricName, HistogramMetricName, MetricsServiceInterface } from './metrics-service.interface';
import { MetricsSnapshot } from './metrics-snapshot.model';
import { RuntimeMetrics } from './runtime-metrics.model';
import { ZibriApplication } from '../application/application';
import { type AssetServiceInterface } from '../assets/asset-service.interface';
import { Inject } from '../di/decorators/inject.decorator';
import { Injectable } from '../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { OnAppInit } from '../global/on-app-init.interface';
import { OnAppShutdown } from '../global/on-app-shutdown.interface';
import { HttpRequest } from '../http/http-request.model';
import { HttpResponse } from '../http/http-response.model';
import { MiddlewarePhase } from '../http/middleware-phase.enum';
import { RouteLabelUtilities } from '../http/route-label.utilities';
import { type LoggerInterface } from '../logging/logger.interface';
import { optionalPeer } from '../utilities/optional-peer.function';

// eslint-disable-next-line jsdoc/require-jsdoc
export class PromCounter implements CounterInterface {
    constructor(private readonly inner: Counter<string>) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    increase(labels: Record<string, string> = {}, v = 1): void {
        this.inner.inc(labels, v);
    }
}

// eslint-disable-next-line jsdoc/require-jsdoc
export class PromGauge implements GaugeInterface {
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

// eslint-disable-next-line jsdoc/require-jsdoc
export class PromHistogram implements HistogramInterface {
    constructor(private readonly inner: Histogram<string>) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    observe(labels: Record<string, string>, v: number): void {
        this.inner.observe(labels, v);
    }
}

/**
 * One default metric of `@prometheus-io/client`, which registers itself in the registry it is given.
 */
type DefaultMetric = (registry: Registry, config: object) => void;

/**
 * The default metrics of `@prometheus-io/client` that are read when they are collected, which is all
 * of them but the ones {@link RuntimeMetrics} measures.
 */
const PULLED_DEFAULT_METRICS: string[] = [
    'processCpuTotal',
    'processStartTime',
    'osMemoryHeap',
    'processOpenFileDescriptors',
    'processMaxFileDescriptors',
    'processResources',
    'processHandles',
    'processRequests',
    'heapSizeAndUsed',
    'heapSpacesSizeAndUsed',
    'version'
];

/**
 * What the optional peers of the metrics service are needed for, as the error of a missing one says.
 */
const PEER_FEATURE: string = 'Default metrics service implementation of Zibri.';

/**
 * A collector, with when it last ran.
 */
type RegisteredCollector = MetricsCollector & {
    /**
     * When it last started, or undefined before its first run.
     */
    lastRunAtMs: number | undefined
};

/**
 * Default metrics service implementation of Zibri.
 */
@Injectable({ register: 'onUse' })
export class PrometheusMetricsService implements MetricsServiceInterface, OnAppInit, OnAppShutdown {
    private readonly registry: Registry;
    private readonly counters: Map<string, Counter<string>> = new Map<string, Counter<string>>();
    private readonly gauges: Map<string, Gauge<string>> = new Map<string, Gauge<string>>();
    private readonly histograms: Map<string, Histogram<string>> = new Map<string, Histogram<string>>();
    private readonly metricSnapshots: MetricsSnapshot[] = [];
    private readonly collectors: RegisteredCollector[] = [];
    private readonly runtimeMetrics: RuntimeMetrics;
    private readonly requestDuration: DurationHistogram;

    // eslint-disable-next-line sonar/no-duplicate-string
    private get promClient(): typeof import('@prometheus-io/client') {
        return optionalPeer<typeof import('@prometheus-io/client')>('@prometheus-io/client', PEER_FEATURE);
    }

    private get si(): typeof import('systeminformation') {
        return optionalPeer<typeof import('systeminformation')>('systeminformation', PEER_FEATURE);
    }

    constructor(
        @Inject(ZIBRI_DI_TOKENS.ASSET_SERVICE)
        private readonly assetService: AssetServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.METRICS_REQUEST_DURATION_BUCKETS_IN_MS)
        requestDurationBucketsInMs: number[],
        @Inject(ZIBRI_DI_TOKENS.METRICS_DATA_SOURCE_COLLECTOR_INTERVAL_IN_MS)
        private readonly dataSourceCollectorIntervalInMs: number
    ) {
        this.registry = new this.promClient.Registry();
        // the client's default metrics one by one rather than through collectDefaultMetrics, which also
        // starts a gc observer, an event loop delay monitor and an interval that nothing can stop.
        // Every application built in one process added a set that outlived it - under jest every test
        // file, each keeping its file's environment alive. Those three are RuntimeMetrics, stopped on
        // shutdown; the rest are read when they are collected
        for (const name of PULLED_DEFAULT_METRICS) {
            optionalPeer<DefaultMetric>(`@prometheus-io/client/lib/metrics/${name}`, PEER_FEATURE)(this.registry, {});
        }
        this.runtimeMetrics = new RuntimeMetrics(this.promClient, this.registry, 10);

        this.getCounter('http_requests_total', ['method', 'route', 'status_code']);
        this.requestDuration = DurationHistogram.resolve(this, 'http_request_duration_seconds', ['method', 'route', 'status_code'], requestDurationBucketsInMs);
        this.getGauge('process_cpu_count').set({ }, os.availableParallelism());
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    onAppInit(app: ZibriApplication): void {
        optionalPeer('systeminformation', PEER_FEATURE);
        this.runtimeMetrics.start();

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

    // eslint-disable-next-line jsdoc/require-jsdoc
    onAppShutdown(): void {
        this.runtimeMetrics.stop();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
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

        this.requestDuration.observe({ method, route, status_code: statusCode }, durationInMs);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    getCounter(name: CounterMetricName, labelNames: string[] = []): PromCounter {
        if (!this.counters.has(name)) {
            this.counters.set(name, new this.promClient.Counter({ name, help: name, labelNames, registers: [this.registry] }));
        }
        // eslint-disable-next-line typescript/no-non-null-assertion
        return new PromCounter(this.counters.get(name)!);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    getGauge(name: GaugeMetricName, labelNames: string[] = []): PromGauge {
        if (!this.gauges.has(name)) {
            this.gauges.set(name, new this.promClient.Gauge({ name, help: name, labelNames, registers: [this.registry] }));
        }
        // eslint-disable-next-line typescript/no-non-null-assertion
        return new PromGauge(this.gauges.get(name)!);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    getHistogram(name: HistogramMetricName, labelNames: string[] = [], buckets: number[] = []): PromHistogram {
        if (!this.histograms.has(name)) {
            this.histograms.set(name, new this.promClient.Histogram({ name, help: name, labelNames, buckets, registers: [this.registry] }));
        }
        // eslint-disable-next-line typescript/no-non-null-assertion
        return new PromHistogram(this.histograms.get(name)!);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    addCollector(collector: MetricsCollector): void {
        this.collectors.push({ ...collector, lastRunAtMs: undefined });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveExposition(): Promise<MetricsExposition> {
        await this.runCollectors();
        return { contentType: this.registry.contentType, body: await this.registry.metrics() };
    }

    /**
     * Runs every collector whose interval has passed since its last run.
     */
    private async runCollectors(): Promise<void> {
        const now: number = Date.now();
        await Promise.all(this.collectors
            .filter(c => c.lastRunAtMs == undefined
                || now - c.lastRunAtMs >= (c.minIntervalInMs === 'dataSource' ? this.dataSourceCollectorIntervalInMs : c.minIntervalInMs))
            .map(async c => {
                // taken before the run, so a read arriving while it runs does not start a second one
                c.lastRunAtMs = now;
                try {
                    await c.collect();
                }
                catch (error) {
                    // the gauges keep what the last run set, and the read goes on: a data source that
                    // is down is exactly when the rest of the metrics are needed
                    const logger: LoggerInterface = inject(ZIBRI_DI_TOKENS.LOGGER);
                    logger.warn(`the metrics collector "${c.name}" failed: ${error instanceof Error ? error.message : String(error)}`);
                }
            }));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async collect(): Promise<void> {
        await this.runCollectors();
        // one entry per interface, and there can be none: a container with no interface of its own,
        // or a probe the host would not answer
        const stats: Systeminformation.NetworkStatsData[] = await this.si.networkStats();

        const json: MetricObjectWithValues<MetricValue<string>>[] = await this.registry.getMetricsAsJSON();
        const metrics: Metric[] = json.flatMap(m => m.values.map(s => ({
            name: 'metricName' in s && typeof s.metricName === 'string' ? s.metricName : m.name,
            type: m.type as unknown as Metric['type'],
            value: s.value,
            // spread rather than handed on: the client types every value's labels as present, and hands
            // the sum and count of an unlabelled summary over without any
            labels: { ...s.labels }
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

    // eslint-disable-next-line jsdoc/require-jsdoc
    getMetricSnapshots(): MetricsSnapshot[] {
        return this.metricSnapshots;
    }
}