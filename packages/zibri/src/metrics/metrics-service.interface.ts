import { CounterInterface } from './counter.interface';
import { GaugeInterface } from './gauge.interface';
import { HistogramInterface } from './histogram.interface';
import { MetricsCollector } from './metrics-collector.model';
import { MetricsExposition } from './metrics-exposition.model';
import { MetricsSnapshot } from './metrics-snapshot.model';
import { HttpRequest } from '../http/http-request.model';
import { HttpResponse } from '../http/http-response.model';

/**
 * Name of a counter metric.
 */
export type CounterMetricName = 'http_requests_total' | string & {};

/**
 * The name of a gauge metric.
 */
export type GaugeMetricName = string;

/**
 * The name of a histogram metric.
 */
export type HistogramMetricName = 'http_request_duration_seconds' | string & {};

/**
 * Interface for a metrics service.
 */
export interface MetricsServiceInterface {
    /**
     * Collects metrics about a finished request.
     */
    measureFinishedRequest: (req: HttpRequest, res: HttpResponse, durationInMs: number) => void | Promise<void>,
    /**
     * Create or retrieve a counter metric.
     */
    getCounter: (name: CounterMetricName, labelNames?: string[]) => CounterInterface,
    /**
     * Create or retrieve a gauge metric.
     */
    getGauge: (name: GaugeMetricName, labelNames?: string[]) => GaugeInterface,

    /**
     * Create or retrieve a histogram metric.
     */
    getHistogram: (name: HistogramMetricName, labelNames?: string[], buckets?: number[]) => HistogramInterface,
    /**
     * Adds work that brings gauges up to date before the metrics are read, by `collect` and by
     * `resolveExposition`.
     */
    addCollector: (collector: MetricsCollector) => void,
    /**
     * Collect a snapshot of every metric’s current samples.
     * This will usually be called in regular intervals, eg. From a cron job.
     *
     * To retrieve the metrics use the getMetricSnapshots method.
     */
    collect: () => Promise<void>,
    /**
     * Returns all 60 buffered snapshots.
     *
     * For a longer history, have Prometheus scrape what `resolveExposition` answers.
     */
    getMetricSnapshots: () => MetricsSnapshot[],
    /**
     * Resolves every metric in the text format a Prometheus server scrapes.
     */
    resolveExposition: () => Promise<MetricsExposition>
}