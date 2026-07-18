import { CounterInterface } from '../metrics/counter.interface';
import { GaugeInterface } from '../metrics/gauge.interface';
import { HistogramInterface } from '../metrics/histogram.interface';

/**
 * Metrics regarding rate limiting.
 */
export type RateLimiterMetrics = {
    /**
     * The amount of rate limit requests that have been allowed (rate limit has not been hit yet).
     */
    allowed: CounterInterface,
    /**
     * The amount of rate limit requests that have been blocked (rate limit has been hit).
     */
    blocked: CounterInterface,
    /**
     * The amount of errors happening during rate limit.
     */
    errors: CounterInterface,
    /**
     * The current number of tracked identities.
     */
    activeKeys: GaugeInterface,
    /**
     * The current amount of reservations.
     */
    activeReservations: GaugeInterface,
    /**
     * The duration in ms it takes to decide whether or not to block the request.
     */
    decisionDuration: HistogramInterface,
    /**
     * The duration in ms it takes to store the state.
     */
    storeDuration: HistogramInterface,
    /**
     * The remaining percent until the rate limit is hit.
     */
    remainingPercent: HistogramInterface,
    /**
     * The time it takes before the request can be tried again.
     */
    retryAfterMs: HistogramInterface
};