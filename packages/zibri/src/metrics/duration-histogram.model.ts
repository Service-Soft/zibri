import { HistogramInterface } from './histogram.interface';
import { type MetricsServiceInterface } from './metrics-service.interface';
import { Ms } from '../utilities/ms';

/**
 * A histogram of durations, observed in milliseconds and recorded in seconds.
 *
 * Seconds because that is the unit Prometheus names durations in, and the one the runtime metrics
 * already use. A float keeps the fractions of a millisecond, so nothing is lost by it.
 */
export class DurationHistogram implements HistogramInterface {
    private constructor(private readonly inner: HistogramInterface) {}

    /**
     * Resolves the histogram of the given name, registering it on first use.
     * @param metricsService - Where the histogram is registered.
     * @param name - The name of the histogram, which ends in its unit.
     * @param labelNames - The names of its labels.
     * @param bucketsInMs - The upper bounds of its buckets, in milliseconds.
     * @returns The histogram.
     */
    static resolve(
        metricsService: MetricsServiceInterface,
        name: `${string}_seconds`,
        labelNames: string[],
        bucketsInMs: number[]
    ): DurationHistogram {
        return new DurationHistogram(metricsService.getHistogram(name, labelNames, bucketsInMs.map(b => b / Ms.SECOND)));
    }

    /**
     * Observes a duration.
     * @param labels - The labels of the observation.
     * @param value - The duration, in milliseconds.
     */
    observe(labels: Record<string, string>, value: number): void {
        this.inner.observe(labels, value / Ms.SECOND);
    }
}