/**
 * Reasons that a rate limit reservation can be rejected.
 */
export enum RateLimitReservationRejectionReason {
    /**
     * The requested count exceeds the limiter's absolute capacity. This can
     * never succeed, no matter how long the caller is willing to wait.
     */
    EXCEEDS_CAPACITY = 'EXCEEDS_CAPACITY',
    /**
     * The requested count exceeds the configured maximum size for a single
     * reservation, even though it's within the limiter's absolute capacity.
     * A policy limit, not a structural one.
     */
    EXCEEDS_RESERVATION_LIMIT = 'EXCEEDS_RESERVATION_LIMIT',
    /**
     * Too many reservations are already queued ahead of this one for the
     * given key.
     */
    QUEUE_TOO_LONG = 'QUEUE_TOO_LONG'
}