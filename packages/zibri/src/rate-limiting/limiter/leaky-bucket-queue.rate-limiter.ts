import assert from 'node:assert';

import { NumberUtilities } from '../../utilities/number.utilities';
import { RateLimitResult } from '../rate-limit-result.model';
import { BaseRateLimiter } from './base-rate-limiter.model';
import { RateLimiterConfigInput } from './rate-limiter-config.model';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { RateLimitReservationNotFoundError } from '../reservation/rate-limit-reservation-not-found.error';
import { RateLimitReservationRejectionReason } from '../reservation/rate-limit-reservation-rejection-reason.enum';
import { RateLimitReservationResult } from '../reservation/rate-limit-reservation-result.model';
import { RateLimitReservationError } from '../reservation/rate-limit-reservation.error';
import { RateLimitReservation } from '../reservation/rate-limit-reservation.model';
import { BaseRateLimitState } from '../stores/rate-limiter-store.interface';

/**
 * A single scheduled item in the leaky bucket queue.
 */
type ScheduledItem = {
    /**
     * The unique identifier of the item scheduled.
     */
    id: string,
    /**
     * The count of this item.
     */
    count: number,
    /**
     * When the request is allowed to proceed.
     */
    startMs: number,
    /**
     * When it finishes.
     */
    finishMs: number,
    /**
     * True for regular consume, false for pending reservations.
     */
    committed: boolean
};

/**
 * Persisted state for the leaky bucket queue.
 * Only the earliest time the server becomes free again is needed.
 */
export type LeakyBucketQueueState = BaseRateLimitState & {
    /**
     * Ordered queue of all future work (both committed and pending reservations).
     * The first item is the one currently being processed (if startMs <= now).
     */
    queue: readonly ScheduledItem[]
};

/**
 * A rate limiter that implements a leaky bucket as a virtual queue.
 *
 * The bucket has a maximum queueing time (`maxQueueTimeMs`), derived from
 * `maxQueueSize` and the fixed output rate (`maxRate` per `intervalInMs`).
 */
export class LeakyBucketQueueRateLimiter extends BaseRateLimiter<LeakyBucketQueueState> {
    /** Maximum time (ms) a request may be delayed. */
    private readonly maxQueueTimeMs: number;
    private readonly serviceTimePerUnitMs: number;

    protected constructor(
        private readonly maxRate: number, // number of units allowed per interval
        private readonly intervalInMs: number, // time window for maxRate
        private readonly maxQueueSize: number, // maximum number of units that can be queued
        config: RateLimiterConfigInput<LeakyBucketQueueState>
    ) {
        super({
            reservationGracePeriodMs: (waitMs) => Math.max(5000, waitMs),
            maxReservationCount: config.capacity,
            ...config
        });
        this.maxQueueTimeMs = Math.ceil(
            NumberUtilities.multiply(maxQueueSize, intervalInMs)
                .dividedBy(maxRate)
                .toNumber()
        );
        this.serviceTimePerUnitMs = Math.ceil(
            NumberUtilities.divide(intervalInMs, maxRate).toNumber()
        );
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected initialAlgoState(now: number): LeakyBucketQueueState {
        return {
            queue: [],
            reservations: [], // inherited from BaseRateLimitState; unused here
            expiresAtMs: this.queueExpiresAtMs([], now)
        };
    }

    /**
     * The point at which this key becomes safe to evict from the store:
     * whichever is later of "idle for one interval" or the last scheduled
     * item's finish time, so a key is never expired while it still has
     * outstanding (committed or reserved) work.
     * @param queue - The (already-pruned) queue to base the expiry on.
     * @param now - The current time (ms since epoch).
     * @returns The timestamp (ms since epoch) at which this key expires.
     */
    private queueExpiresAtMs(queue: readonly ScheduledItem[], now: number): number {
        const latestFinish: number = queue.length ? queue[queue.length - 1].finishMs : now;
        return Math.max(now + this.intervalInMs, latestFinish);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected debitCapacity(state: LeakyBucketQueueState): LeakyBucketQueueState {
        // capacity is managed through the queue, not a separate counter
        return state;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected creditCapacity(state: LeakyBucketQueueState): LeakyBucketQueueState {
        // capacity is managed through the queue, not a separate counter
        return state;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected computeReadyAtMs(
        state: LeakyBucketQueueState,
        _reservations: RateLimitReservation[],
        _count: number,
        now: number
    ): number {
        // Insert a hypothetical item at the end of the queue and return its start time.
        const last: ScheduledItem | undefined = state.queue.at(state.queue.length - 1);
        const startTime: number = last ? Math.max(now, last.finishMs) : now;
        return startTime;
    }

    /**
     * Recomputes start/finish times for the queue after a removal (a
     * cancellation, or an expired reservation dropping out via cleanup).
     *
     * Already-finished items are dropped - they're done, and keeping them
     * around would make them count against `maxQueueSize` forever. Items
     * that have already started (`startMs <= now`) are left untouched: time
     * has already passed for them, they can't retroactively start earlier.
     * Items that haven't started yet are rescheduled to start as soon as the
     * server is free (which may now be earlier, since something ahead of
     * them was removed), but never before `now`.
     *
     * Note there's no need to separately floor a not-yet-started item's new
     * start at its own original arrival time: two items can only ever
     * survive here contiguously (each insertion either starts fresh once its
     * predecessor has already finished and been pruned, or is bound to that
     * predecessor's finish) - so collapsing the gap left by a removed item
     * is always exactly correct, never over-eager.
     * @param queue - The queue, with the removed item already excluded.
     * @param now - The current time (ms since epoch).
     * @returns The queue with start/finish times brought up to date.
     */
    private recomputeQueue(queue: readonly ScheduledItem[], now: number): ScheduledItem[] {
        let serverFreeAtMs: number = now;
        const newQueue: ScheduledItem[] = [];

        for (const item of queue) {
            if (item.finishMs <= now) {
                continue;
            }

            if (item.startMs <= now) {
                newQueue.push(item);
                serverFreeAtMs = Math.max(serverFreeAtMs, item.finishMs);
                continue;
            }

            const start: number = Math.max(serverFreeAtMs, now);
            const finish: number = start + (item.count * this.serviceTimePerUnitMs);
            newQueue.push({ ...item, startMs: start, finishMs: finish });
            serverFreeAtMs = finish;
        }

        return newQueue;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected recomputeReadyTimes(state: LeakyBucketQueueState, now: number): LeakyBucketQueueState {
        const newQueue: ScheduledItem[] = this.recomputeQueue(state.queue, now);

        // Update readyAtMs for pending reservations that are still in the queue
        const queueReadyMap: Map<string, number> = new Map(newQueue.filter(i => !i.committed).map(i => [i.id, i.startMs]));
        const newReservations: RateLimitReservation[] = state.reservations.map(r => ({
            ...r,
            readyAtMs: queueReadyMap.get(r.id) ?? r.readyAtMs
        }));

        // A pending reservation's own grace period can outlast the queue's
        // scheduled work, so never expire the state before that.
        const maxResExpiry: number = newReservations.length ? Math.max(...newReservations.map(r => r.expiresAtMs)) : 0;
        return {
            ...state,
            queue: newQueue,
            reservations: newReservations,
            expiresAtMs: Math.max(this.queueExpiresAtMs(newQueue, now), maxResExpiry)
        };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async consume(key: string, count: number): Promise<RateLimitResult> {
        const now: number = Date.now();
        const serviceTime: number = count * this.serviceTimePerUnitMs;

        let allowed: boolean = false;

        const { sizeChanged, value: state } = await this.measureStoreOperation(
            'atomicUpdate',
            () => this.config.store.atomicUpdate(
                key,
                (current) => {
                    const state: LeakyBucketQueueState = current ?? this.initialAlgoState(now);
                    const queue: ScheduledItem[] = [...state.queue];
                    const active: ScheduledItem[] = queue.filter(item => item.finishMs > now);

                    // Calculate start time for the new request
                    const last: ScheduledItem | undefined = active.at(active.length - 1);
                    const startTime: number = last ? Math.max(now, last.finishMs) : now;
                    const finishTime: number = startTime + serviceTime;

                    const newQueueLength: number = active.reduce((sum, item) => sum + item.count, 0) + count;

                    if (newQueueLength > this.maxQueueSize) {
                        allowed = false;
                        return { ...state, queue: active, expiresAtMs: this.queueExpiresAtMs(active, now) };
                    }

                    if (finishTime - now > this.maxQueueTimeMs) {
                        allowed = false;
                        return { ...state, queue: active, expiresAtMs: this.queueExpiresAtMs(active, now) };
                    }

                    allowed = true;
                    const newItem: ScheduledItem = {
                        id: UUIDUtilities.generate(),
                        count,
                        startMs: startTime,
                        finishMs: finishTime,
                        committed: true // regular request, cannot be cancelled
                    };
                    active.push(newItem);
                    return { ...state, queue: active, expiresAtMs: this.queueExpiresAtMs(active, now) };
                }
            )
        );

        if (sizeChanged) {
            void this.updateActiveKeysGauge();
        }

        if (!allowed) {
            const firstFinish: number = state?.queue[0]?.finishMs ?? now;
            return {
                allowed: false,
                limit: this.maxQueueSize,
                remaining: 0,
                resetsAtMs: firstFinish,
                retryAtMs: firstFinish
            };
        }

        const lastFinish: number = state.queue.at(state.queue.length - 1)?.finishMs ?? now;
        const remaining: number = Math.max(0, this.maxQueueSize - state.queue.reduce((sum, i) => sum + i.count, 0));
        return {
            allowed: true,
            limit: this.maxQueueSize,
            remaining,
            resetsAtMs: lastFinish
        };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected async doReserve(key: string, count: number): Promise<RateLimitReservationResult> {
        const id: string = UUIDUtilities.generate();

        try {
            let newReservation: RateLimitReservation | undefined;

            await this.config.store.atomicUpdate(
                key,
                (current) => {
                    const now: number = Date.now();
                    let state: LeakyBucketQueueState = current ?? this.initialAlgoState(now);
                    // Same pruning consume() applies - without it, long-finished
                    // items would count against maxQueueSize forever and would
                    // be treated as "active" by computeReadyAtMs.
                    const active: ScheduledItem[] = state.queue.filter(item => item.finishMs > now);
                    state = { ...state, queue: active };

                    // The ready time is determined by the current (active) queue
                    const readyAt: number = this.computeReadyAtMs(state, [], count, now);

                    if (!this.isWithinReservationHorizon(readyAt, now)) {
                        throw new RateLimitReservationError(
                            RateLimitReservationRejectionReason.QUEUE_TOO_LONG,
                            readyAt - now
                        );
                    }

                    const finishTime: number = readyAt + (count * this.serviceTimePerUnitMs);
                    const newQueueLength: number = active.reduce((sum, item) => sum + item.count, 0) + count;

                    if (newQueueLength > this.maxQueueSize || finishTime - now > this.maxQueueTimeMs) {
                        throw new RateLimitReservationError(
                            RateLimitReservationRejectionReason.QUEUE_TOO_LONG,
                            finishTime - now
                        );
                    }

                    // no‑op here, but kept for consistency
                    state = this.debitCapacity(state);

                    newReservation = {
                        id,
                        key,
                        count,
                        readyAtMs: readyAt,
                        expiresAtMs: readyAt + this.resolveGracePeriodMs(readyAt - now)
                    };

                    // Add to reservations (for cleanup / metrics)
                    const updatedReservations: RateLimitReservation[] = [...state.reservations, newReservation];

                    // Add to queue as a pending item
                    const newItem: ScheduledItem = {
                        id,
                        count,
                        startMs: readyAt,
                        finishMs: finishTime,
                        committed: false
                    };
                    const updatedQueue: ScheduledItem[] = [...state.queue, newItem];

                    return {
                        ...state,
                        reservations: updatedReservations,
                        queue: updatedQueue,
                        expiresAtMs: Math.max(this.queueExpiresAtMs(updatedQueue, now), newReservation.expiresAtMs)
                    };
                }
            );

            assert(newReservation);
            return { allowed: true, reservation: newReservation };
        }
        catch (error) {
            if (error instanceof RateLimitReservationError) {
                return {
                    allowed: false,
                    reason: error.reason,
                    estimatedWaitMs: error.estimatedWaitMs
                };
            }
            throw error;
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async commitReservation(reservationInput: RateLimitReservation): Promise<void> {
        await this.config.store.atomicUpdate(reservationInput.key, (current) => {
            if (!current) {
                throw new RateLimitReservationNotFoundError(reservationInput.key, reservationInput.id);
            }

            const queueIndex: number = current.queue.findIndex(item => item.id === reservationInput.id && !item.committed);
            if (queueIndex === -1) {
                throw new RateLimitReservationNotFoundError(reservationInput.key, reservationInput.id);
            }

            const updatedQueue: ScheduledItem[] = current.queue.map((item, i) => i === queueIndex ? { ...item, committed: true } : item);

            // Remove from reservations (it's no longer pending)
            const updatedReservations: RateLimitReservation[] = current.reservations.filter(r => r.id !== reservationInput.id);

            return { ...current, queue: updatedQueue, reservations: updatedReservations };
        });
        this.recordReservationClosed();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async cancelReservation(reservationInput: RateLimitReservation): Promise<void> {
        await this.config.store.atomicUpdate(reservationInput.key, (current) => {
            if (!current) {
                throw new RateLimitReservationNotFoundError(reservationInput.key, reservationInput.id);
            }

            const index: number = current.queue.findIndex(item => item.id === reservationInput.id && !item.committed);
            if (index === -1) {
                throw new RateLimitReservationNotFoundError(reservationInput.key, reservationInput.id);
            }

            const updatedReservations: RateLimitReservation[] = current.reservations.filter(r => r.id !== reservationInput.id);

            const now: number = Date.now();
            const withoutCancelled: ScheduledItem[] = current.queue.filter((_, i) => i !== index);
            const recalculatedQueue: ScheduledItem[] = this.recomputeQueue(withoutCancelled, now);

            // Also update readyAtMs in any remaining reservations to match the new queue
            const queueReadyMap: Map<string, number> = new Map(recalculatedQueue.filter(i => !i.committed).map(i => [i.id, i.startMs]));
            const updatedReservationsWithReady: RateLimitReservation[] = updatedReservations.map(r => ({
                ...r,
                readyAtMs: queueReadyMap.get(r.id) ?? r.readyAtMs
            }));

            const maxResExpiry: number = updatedReservationsWithReady.length
                ? Math.max(...updatedReservationsWithReady.map(r => r.expiresAtMs))
                : 0;

            return {
                ...current,
                queue: recalculatedQueue,
                reservations: updatedReservationsWithReady,
                expiresAtMs: Math.max(this.queueExpiresAtMs(recalculatedQueue, now), maxResExpiry)
            };
        });
        this.recordReservationClosed();
    }
}