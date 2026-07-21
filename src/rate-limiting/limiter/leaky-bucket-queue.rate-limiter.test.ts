import assert from 'node:assert';

import { beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { LeakyBucketQueueRateLimiter, LeakyBucketQueueState } from './leaky-bucket-queue.rate-limiter';
import { initDiContainer } from '../../di/init-di-container.function';
import { Ms } from '../../utilities/ms';
import { RateLimitResult } from '../rate-limit-result.model';
import { RateLimitReservationResult } from '../reservation/rate-limit-reservation-result.model';
import { RateLimitReservation } from '../reservation/rate-limit-reservation.model';
import { InMemoryRateLimiterStore } from '../stores/in-memory.rate-limiter-store';

const CAPACITY: number = 10; // maxQueueSize
const RATE: number = 5; // 5 units per interval
const INTERVAL: number = 1000; // 1 second

class TestLeakyBucketLimiter extends LeakyBucketQueueRateLimiter {
    constructor() {
        super(RATE, INTERVAL, CAPACITY, {
            name: 'test-leaky',
            capacity: CAPACITY,
            store: new InMemoryRateLimiterStore<LeakyBucketQueueState>(),
            maxReservationWaitMs: 10_000,
            reservationGracePeriodMs: (w) => Math.max(5000, w),
            maxReservationCount: CAPACITY
        });
    }
}

describe('LeakyBucketQueueRateLimiter', () => {
    let limiter: TestLeakyBucketLimiter;

    beforeAll(() => initDiContainer());
    beforeEach(() => {
        limiter = new TestLeakyBucketLimiter();
    });

    describe('consume', () => {
        it('allows requests within rate and queue size', async () => {
            const res: RateLimitResult = await limiter.consume('k', 1);
            expect(res.allowed).toBe(true);
        });

        it('rejects when queue size exceeded', async () => {
            // Fill queue to max size (10 units)
            for (let i: number = 0; i < CAPACITY; i++) {
                await limiter.consume('k', 1);
            }
            const res: RateLimitResult = await limiter.consume('k', 1);
            expect(res.allowed).toBe(false);
        });
    });

    describe('reservations', () => {
        it('reserve adds to queue and returns start time', async () => {
            const res: RateLimitReservationResult = await limiter.reserve('k', 2);
            expect(res.allowed).toBe(true);
            assert(res.allowed);
            expect(res.reservation.readyAtMs).toBeLessThanOrEqual(Date.now());
        });

        it('reserved items are scheduled after existing ones', async () => {
            jest.useFakeTimers();
            try {
                const now: number = Date.now();
                // Add a regular request first
                await limiter.consume('k', 3); // serviceTime = 3*200 = 600ms
                const res: RateLimitReservationResult = await limiter.reserve('k', 2);
                assert(res.allowed);
                // The first request finishes at NOW + 600ms, so the reservation starts then
                expect(res.reservation.readyAtMs).toBe(now + 600);
            }
            finally {
                jest.useRealTimers();
            }
        });

        it('cancel removes reservation and shortens schedule', async () => {
            const res1: RateLimitReservationResult = await limiter.reserve('k', 2);
            await limiter.reserve('k', 2); // second reservation
            assert(res1.allowed);
            // Cancel the first one
            await limiter.cancelReservation(res1.reservation);
            // Now the second reservation's start time should be earlier (right at now)
            const updated: RateLimitReservation | undefined = await limiter.getReservation(res1.reservation.id, 'k');
            // The canceled one is gone, so getReservation returns undefined
            expect(updated).toBeUndefined();
        });

        it('commit turns reservation into committed, still occupies slot', async () => {
            const res: RateLimitReservationResult = await limiter.reserve('k', 2);
            assert(res.allowed);
            await limiter.commitReservation(res.reservation);
            // Queue length should still be 2
            const state: LeakyBucketQueueState | undefined = await limiter.config.store.get('k');
            expect(state?.queue.reduce((sum, i) => sum + i.count, 0)).toBe(2);
            expect(state?.queue.every(i => i.committed)).toBe(true);
        });

        it('rejects a reservation that would exceed maxQueueSize', async () => {
            // Fill the queue to capacity via regular consumes, the same way
            // the 'rejects when queue size exceeded' consume() test does.
            for (let i: number = 0; i < CAPACITY; i++) {
                await limiter.consume('k', 1);
            }
            // The queue is already full - a reservation must be rejected
            // the same way a consume() call would be, not silently
            // appended past maxQueueSize.
            const res: RateLimitReservationResult = await limiter.reserve('k', 1);
            expect(res.allowed).toBe(false);
        });

        it('shifts a not-yet-started reservation earlier when an earlier one is cancelled', async () => {
            jest.useFakeTimers();
            try {
                const now: number = Date.now();
                // serviceTime for count=1 is 200ms (1000ms interval / 5 rate).
                const a: RateLimitReservationResult = await limiter.reserve('k', 1); // [now, now+200)
                const b: RateLimitReservationResult = await limiter.reserve('k', 1); // [now+200, now+400)
                assert(a.allowed && b.allowed);
                expect(a.reservation.readyAtMs).toBe(now);
                expect(b.reservation.readyAtMs).toBe(now + 200);

                await limiter.cancelReservation(a.reservation);

                // b was backlog-bound to a, not independently arrived - once
                // a is gone, b can start as soon as the server (now idle) is free.
                const updatedB: RateLimitReservation | undefined = await limiter.getReservation(b.reservation.id, 'k');
                expect(updatedB?.readyAtMs).toBe(now);
            }
            finally {
                jest.useRealTimers();
            }
        });

        it('does not move an already-started item when a later reservation is cancelled', async () => {
            jest.useFakeTimers();
            try {
                const now: number = Date.now();
                const b: RateLimitReservationResult = await limiter.reserve('k', 1); // [now, now+200)
                const c: RateLimitReservationResult = await limiter.reserve('k', 1); // [now+200, now+400)
                assert(b.allowed && c.allowed);

                // Advance so b is now in progress (started, not yet finished).
                jest.setSystemTime(now + 100);

                await limiter.cancelReservation(c.reservation);

                // b already started at `now` - cancelling c (which was behind
                // it) must not retroactively reschedule b to start "now" (100ms in).
                const state: LeakyBucketQueueState | undefined = await limiter.config.store.get('k');
                const bItem: { startMs: number, finishMs: number } | undefined = state?.queue.find(i => i.id === b.reservation.id);
                expect(bItem?.startMs).toBe(now);
                expect(bItem?.finishMs).toBe(now + 200);
            }
            finally {
                jest.useRealTimers();
            }
        });

        it('combines both: preserves an in-progress item and pulls a later one into the freed gap', async () => {
            jest.useFakeTimers();
            try {
                const now: number = Date.now();
                const a: RateLimitReservationResult = await limiter.reserve('k', 1); // [now, now+200)
                const b: RateLimitReservationResult = await limiter.reserve('k', 1); // [now+200, now+400)
                const c: RateLimitReservationResult = await limiter.reserve('k', 1); // [now+400, now+600)
                assert(a.allowed && b.allowed && c.allowed);

                // a is now in progress.
                jest.setSystemTime(now + 50);

                await limiter.cancelReservation(b.reservation);

                // a: untouched (already started).
                const state: LeakyBucketQueueState | undefined = await limiter.config.store.get('k');
                const aItem: { startMs: number, finishMs: number } | undefined = state?.queue.find(i => i.id === a.reservation.id);
                expect(aItem?.startMs).toBe(now);
                expect(aItem?.finishMs).toBe(now + 200);

                // c: pulled forward to start right when a finishes, filling
                // the gap that cancelling b left - not reset to "now" (50ms in).
                const updatedC: RateLimitReservation | undefined = await limiter.getReservation(c.reservation.id, 'k');
                expect(updatedC?.readyAtMs).toBe(now + 200);
            }
            finally {
                jest.useRealTimers();
            }
        });
    });

    describe('state expiry', () => {
        it('eventually evicts a key that has gone fully idle', async () => {
            jest.useFakeTimers();
            try {
                const now: number = Date.now();
                await limiter.consume('k', 1);
                // Far beyond any reasonable idle horizon - the queued item
                // has long since finished and no further activity occurred.
                jest.setSystemTime(now + Ms.YEAR);
                await limiter.cleanup();
                expect(await limiter.config.store.get('k')).toBeUndefined();
            }
            finally {
                jest.useRealTimers();
            }
        });
    });
});