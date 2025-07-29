import { ZibriApplication } from '../application';
import { HttpRequest, HttpResponse } from '../http';
import { CounterInterface } from './counter.interface';
import { GaugeInterface } from './gauge.interface';
import { HistogramInterface } from './histogram.interface';
import { Metric } from './metric.model';

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
export type HistogramMetricName = 'http_request_duration_ms' | string & {};

/**
 * A collected snapshot of all metrics.
 */
export type MetricsSnapshot = {
    /**
     * The time at which the snapshot was taken.
     */
    timestamp: Date,
    /**
     * All metrics at the timestamp.
     */
    metrics: Metric[]
};

/**
 * Interface for a metrics service.
 */
export interface MetricsServiceInterface {
    /**
     * Attaches the service to the Zibri application.
     */
    attachTo: (app: ZibriApplication) => void | Promise<void>,
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
     * Collect a snapshot of every metric’s current samples.
     * This will usually be called in regular intervals, eg. From a cron job.
     *
     * To retrieve the metrics use the getMetrics method.
     */
    collect: () => Promise<void>,
    /**
     * Returns all 60 buffered snapshots.
     *
     * IF YOU WANT A LONGER HISTORY YOU SHOULD USE AN EXTERNAL TOOL LIKE PROMETHEUS TO SCRAPE THE DATA.
     */
    getMetricSnapshots: () => MetricsSnapshot[]
}