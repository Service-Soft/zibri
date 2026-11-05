import { constants, EventLoopUtilization, monitorEventLoopDelay, performance, PerformanceEntry, PerformanceObserver } from 'node:perf_hooks';

import type { Gauge, Histogram, Registry, Summary } from '@prometheus-io/client';

/**
 * The exports of `@prometheus-io/client`.
 */
type PromClient = typeof import('@prometheus-io/client');

/**
 * What monitors the delay of the event loop.
 */
type EventLoopDelayMonitor = ReturnType<typeof monitorEventLoopDelay>;

/**
 * How often the utilization of the event loop is measured.
 */
const UTILIZATION_INTERVAL_IN_MS: number = 100;

/**
 * What each kind of garbage collection is called in the `kind` label.
 */
const GC_KINDS: Record<number, string> = {
    [constants.NODE_PERFORMANCE_GC_MAJOR]: 'major',
    [constants.NODE_PERFORMANCE_GC_MINOR]: 'minor',
    [constants.NODE_PERFORMANCE_GC_INCREMENTAL]: 'incremental',
    [constants.NODE_PERFORMANCE_GC_WEAKCB]: 'weakcb'
};

/**
 * Builds one of the gauges the event loop lag is reported in.
 */
type LagGaugeFactory = (name: string, help: string, aggregator: 'min' | 'max' | 'average') => Gauge<string>;

/**
 * The lag and the utilization of the event loop, and how long garbage collection takes: the metrics
 * of the process that are measured continuously rather than read when they are collected.
 *
 * Under the names, help texts and buckets of the default metrics of `@prometheus-io/client`.
 */
export class RuntimeMetrics {
    private readonly gcDuration: Histogram<string>;
    private readonly lagSeconds: Gauge<string>;
    private readonly lag: Record<'min' | 'max' | 'mean' | 'stddev' | 'p50' | 'p90' | 'p99', Gauge<string>>;
    private readonly utilizationSummary: Summary<string>;
    private readonly utilizationHistogram: Histogram<string>;

    private gcObserver: PerformanceObserver | undefined;
    private loopDelay: EventLoopDelayMonitor | undefined;
    private utilizationTimer: NodeJS.Timeout | undefined;

    constructor(
        promClient: PromClient,
        registry: Registry,
        private readonly eventLoopMonitoringPrecisionInMs: number
    ) {
        const registers: Registry[] = [registry];
        this.gcDuration = new promClient.Histogram({
            name: 'nodejs_gc_duration_seconds',
            help: 'Garbage collection duration by kind, one of major, minor, incremental or weakcb.',
            labelNames: ['kind'],
            buckets: [0.001, 0.01, 0.1, 1, 2, 5],
            registers
        });
        // the lag itself is measured as it is collected, and sets the other gauges from the monitor
        // on the way
        this.lagSeconds = new promClient.Gauge({
            name: 'nodejs_eventloop_lag_seconds',
            help: 'Lag of event loop in seconds.',
            aggregator: 'average',
            registers,
            collect: () => this.collectLag()
        });
        const lagGauge: LagGaugeFactory = (name, help, aggregator) => new promClient.Gauge({
            name,
            help,
            aggregator,
            registers
        });
        this.lag = {
            min: lagGauge('nodejs_eventloop_lag_min_seconds', 'The minimum recorded event loop delay.', 'min'),
            max: lagGauge('nodejs_eventloop_lag_max_seconds', 'The maximum recorded event loop delay.', 'max'),
            mean: lagGauge('nodejs_eventloop_lag_mean_seconds', 'The mean of the recorded event loop delays.', 'average'),
            stddev: lagGauge('nodejs_eventloop_lag_stddev_seconds', 'The standard deviation of the recorded event loop delays.', 'average'),
            p50: lagGauge('nodejs_eventloop_lag_p50_seconds', 'The 50th percentile of the recorded event loop delays.', 'average'),
            p90: lagGauge('nodejs_eventloop_lag_p90_seconds', 'The 90th percentile of the recorded event loop delays.', 'average'),
            p99: lagGauge('nodejs_eventloop_lag_p99_seconds', 'The 99th percentile of the recorded event loop delays.', 'average')
        };
        const utilizationHelp: string = 'Ratio of time the event loop is not idling in the event provider'
            + ' to the total time the event loop is running.';
        this.utilizationSummary = new promClient.Summary({
            name: 'nodejs_eventloop_utilization_summary',
            help: utilizationHelp,
            maxAgeSeconds: 60,
            ageBuckets: 5,
            percentiles: [0.01, 0.05, 0.5, 0.9, 0.95, 0.99, 0.999],
            registers
        });
        this.utilizationHistogram = new promClient.Histogram({
            name: 'nodejs_eventloop_utilization_histogram',
            help: utilizationHelp,
            buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 0.95, 0.99, 1],
            registers
        });
    }

    /**
     * Starts measuring.
     */
    start(): void {
        this.gcObserver = new PerformanceObserver(list => {
            for (const entry of list.getEntries()) {
                this.gcDuration.observe({ kind: this.resolveGcKind(entry) }, entry.duration / 1000);
            }
        });
        this.gcObserver.observe({ entryTypes: ['gc'] });

        this.loopDelay = monitorEventLoopDelay({ resolution: this.eventLoopMonitoringPrecisionInMs });
        this.loopDelay.enable();

        let previous: EventLoopUtilization = performance.eventLoopUtilization();
        let previousAt: number = performance.now();
        this.utilizationTimer = setInterval(() => {
            const current: EventLoopUtilization = performance.eventLoopUtilization();
            const now: number = performance.now();
            const utilization: number = performance.eventLoopUtilization(current, previous).utilization;
            // once for every interval that passed, so a loop blocked for a second weighs ten times
            // what an idle tick does
            const intervals: number = Math.round((now - previousAt) / UTILIZATION_INTERVAL_IN_MS);
            for (let i: number = 0; i < intervals; i++) {
                this.utilizationSummary.observe(utilization);
                this.utilizationHistogram.observe(utilization);
            }
            previous = current;
            previousAt = now;
        }, UTILIZATION_INTERVAL_IN_MS);
        // a measurement is never a reason to keep the process alive
        this.utilizationTimer.unref();
    }

    /**
     * Stops measuring, and lets go of everything that measured.
     */
    stop(): void {
        this.gcObserver?.disconnect();
        this.gcObserver = undefined;
        this.loopDelay?.disable();
        this.loopDelay = undefined;
        clearInterval(this.utilizationTimer);
        this.utilizationTimer = undefined;
    }

    // a gc entry says its kind in `detail`, which the entry types of node's typings do not carry
    private resolveGcKind(entry: PerformanceEntry): string {
        const detail: unknown = 'detail' in entry ? entry.detail : undefined;
        const kind: unknown = typeof detail === 'object' && detail != undefined && 'kind' in detail ? detail.kind : undefined;
        return typeof kind === 'number' ? GC_KINDS[kind] ?? '' : '';
    }

    // the lag of the next turn of the loop, and what the delay monitor recorded since it was last
    // collected
    private collectLag(): void {
        const start: [number, number] = process.hrtime();
        setImmediate(() => {
            const [seconds, nanoseconds] = process.hrtime(start);
            this.lagSeconds.set(seconds + (nanoseconds / 1e9));
        });
        if (!this.loopDelay) {
            return;
        }
        this.lag.min.set(this.loopDelay.min / 1e9);
        this.lag.max.set(this.loopDelay.max / 1e9);
        this.lag.mean.set(this.loopDelay.mean / 1e9);
        this.lag.stddev.set(this.loopDelay.stddev / 1e9);
        this.lag.p50.set(this.loopDelay.percentile(50) / 1e9);
        this.lag.p90.set(this.loopDelay.percentile(90) / 1e9);
        this.lag.p99.set(this.loopDelay.percentile(99) / 1e9);
        this.loopDelay.reset();
    }
}