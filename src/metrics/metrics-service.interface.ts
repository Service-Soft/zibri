import { ZibriApplication } from '../application';
import { HttpRequest, HttpResponse } from '../http';
import { CounterInterface } from './counter.interface';
import { GaugeInterface } from './gauge.interface';
import { HistogramInterface } from './histogram.interface';
import { Metric } from './metric.model';

/**
 *
 */
export type CounterMetricName = 'http_requests_total' | string & {};

/**
 *
 */
export type GaugeMetricName = string;

/**
 *
 */
export type HistogramMetricName = 'http_request_duration_ms' | string & {};

/**
 *
 */
export type MetricsSnapshot = {
    /**
     *
     */
    timestamp: Date,
    /**
     *
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
     *
     */
    getMetricSnapshots: () => MetricsSnapshot[]
}