import { CounterInterface } from '../metrics/counter.interface';
import { GaugeInterface } from '../metrics/gauge.interface';
import { HistogramInterface } from '../metrics/histogram.interface';

/**
 * Metrics regarding caching.
 */
export type CacheMetrics = {
    /**
     * How many times caches have been hit.
     */
    hits: CounterInterface,
    /**
     * How many times caches have been missed.
     */
    misses: CounterInterface,
    /**
     * How many times values have been written to caches.
     */
    writes: CounterInterface,
    /**
     * How many times values have been deleted from caches.
     */
    deletes: CounterInterface,
    /**
     * How many times cache invalidations have happened.
     */
    invalidations: CounterInterface,
    /**
     * How many times cache invalidations have failed.
     */
    invalidationFailures: CounterInterface,
    /**
     * How many times cached values have expired.
     */
    expiredEvictions: CounterInterface,
    /**
     * How many times errors occurred during caching.
     */
    errors: CounterInterface,
    /**
     * The current amount of inFlight cache operations.
     */
    inFlight: GaugeInterface,
    /**
     * The amount of cached values.
     */
    size: GaugeInterface,
    /**
     * The duration of the original functions.
     */
    sourceDuration: HistogramInterface,
    /**
     * The duration of cache operations.
     */
    storeDuration: HistogramInterface
};