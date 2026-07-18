import assert from 'node:assert';

import { afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { SlidingWindowLogRateLimiter, SlidingWindowLogState } from './sliding-window-log.rate-limiter';
import { initDiContainer } from '../../di/init-di-container.function';
import { Ms } from '../../utilities/ms';
import { RateLimitResult } from '../rate-limit-result.model';
import { RateLimitReservationResult } from '../reservation/rate-limit-reservation-result.model';
import { InMemoryRateLimiterStore } from '../stores/in-memory.rate-limiter-store';

const NOW: number = 1_700_000_000_000;
const CAPACITY: number = 5;
const INTERVAL: number = Ms.SECOND; // 1 second window

class TestSlidingWindowLimiter extends SlidingWindowLogRateLimiter {
    constructor() {
        super(INTERVAL, {
            name: 'test-sliding',
            capacity: CAPACITY,
            store: new InMemoryRateLimiterStore<SlidingWindowLogState>(),
            maxReservationWaitMs: Ms.SECOND * 5,
            reservationGracePeriodMs: (w) => Math.max(5000, w),
            maxReservationCount: CAPACITY
        });
    }
}

describe('SlidingWindowLogRateLimiter', () => {
    let limiter: TestSlidingWindowLimiter;

    beforeAll(() => {
        initDiContainer();
    });

    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(NOW);
        limiter = new TestSlidingWindowLimiter();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    describe('consume – basic sliding window', () => {
        it('allows up to capacity in the window', async () => {
            for (let i: number = 0; i < CAPACITY; i++) {
                expect((await limiter.consume('k', 1)).allowed).toBe(true);
            }
            // Next is denied
            expect((await limiter.consume('k', 1)).allowed).toBe(false);
        });

        it('slides the window to free slots as old events expire', async () => {
            // Consume all 5 at T=0
            for (let i: number = 0; i < CAPACITY; i++) {
                await limiter.consume('k', 1);
            }
            // Advance time past the window (1s)
            jest.setSystemTime(NOW + 1001);
            // Now all previous events are outside the window
            const result: RateLimitResult = await limiter.consume('k', 1);
            expect(result.allowed).toBe(true);
            expect(result.remaining).toBe(CAPACITY - 1);
        });

        it('correctly reports remaining slots considering time-based expiry', async () => {
            // Consume 3 at T=0
            for (let i: number = 0; i < 3; i++) {
                await limiter.consume('k', 1);
            }
            // At T=0, remaining = 2
            expect((await limiter.consume('k', 1)).remaining).toBe(1);

            // Advance 600ms – within the window, so no event expired yet.
            jest.setSystemTime(NOW + 600);
            // Still 1 event consumed just now, so remaining should be 1 (4 total in window)
            // Actually we consumed 4 so far, last one at T=600, remaining = 1
            expect((await limiter.consume('k', 1)).remaining).toBe(0);

            // Advance to 1001ms after start – the first 3 events at T=0 are expired.
            jest.setSystemTime(NOW + 1001);
            const result: RateLimitResult = await limiter.consume('k', 1);
            // Events: one at T=0? actually we consumed 4 at T=0? let's recount:
            // At T=0: consumed 3, then another at T=0 (the check for remaining). So 4 at T=0, one at T=600.
            // At T=1001, window is (1ms, 1001]. The four at T=0 are outside, one at T=600 is inside.
            // So capacity=5, one inside, remaining=4.
            expect(result.allowed).toBe(true);
            expect(result.remaining).toBe(3); // we just consumed one more, so now two inside? Actually after consumption we added one at T=1001, so total inside: T=600 (1) + T=1001 (1) = 2, remaining 3.
        });

        it('resetsAtMs points to the time the oldest event expires', async () => {
            await limiter.consume('k', 1); // T=0
            jest.setSystemTime(NOW + 200);
            await limiter.consume('k', 1); // T=200
            const result: RateLimitResult = await limiter.consume('k', 1); // T=200
            expect(result.resetsAtMs).toBe(NOW + INTERVAL); // oldest is at T=0, expires at T=1000
        });

        it('retryAfterMs calculates when enough slots become available', async () => {
            // Fill window completely at T=0
            for (let i: number = 0; i < CAPACITY; i++) {
                await limiter.consume('k', 1);
            }
            jest.setSystemTime(NOW + 300); // no events expired
            const denied: RateLimitResult = await limiter.consume('k', 1);
            // Need one slot to free: oldest timestamp is T=0, expires at T=1000.
            // So retryAtMs should be T=0 + 1000 = 1000.
            expect(denied.allowed).toBe(false);
            assert(!denied.allowed);
            expect(denied.retryAtMs).toBe(NOW + 1000);
        });
    });

    describe('reservations', () => {
        it('reserve deducts capacity immediately, affecting consume', async () => {
            // Reserve 2, then try to consume 4 – should only allow 3.
            const res: RateLimitReservationResult = await limiter.reserve('k', 2);
            expect(res.allowed).toBe(true);
            // Now consume up to 3
            for (let i: number = 0; i < 3; i++) {
                expect((await limiter.consume('k', 1)).allowed).toBe(true);
            }
            // 4th consume should fail
            expect((await limiter.consume('k', 1)).allowed).toBe(false);
        });

        it('committed reservation slots stay consumed, not double-counted', async () => {
            const res: RateLimitReservationResult = await limiter.reserve('k', 2);
            expect(res.allowed).toBe(true);
            assert(res.allowed);
            // Commit
            await limiter.commitReservation(res.reservation);

            // Consume 3 should succeed (since 2 reserved and committed, total capacity 5, so 3 left)
            for (let i: number = 0; i < 3; i++) {
                expect((await limiter.consume('k', 1)).allowed).toBe(true);
            }
            expect((await limiter.consume('k', 1)).allowed).toBe(false);
        });

        it('cancelled reservation restores capacity', async () => {
            const res: RateLimitReservationResult = await limiter.reserve('k', 3);
            expect(res.allowed).toBe(true);
            assert(res.allowed);
            await limiter.cancelReservation(res.reservation);

            // Should be able to consume full 5
            for (let i: number = 0; i < CAPACITY; i++) {
                expect((await limiter.consume('k', 1)).allowed).toBe(true);
            }
        });

        it('reservation readyAtMs reflects earliest slot availability', async () => {
            // Fill the window with 5 events at T=0.
            for (let i: number = 0; i < CAPACITY; i++) {
                await limiter.consume('k', 1);
            }
            // Advance to 200ms, then try to reserve 1 slot.
            jest.setSystemTime(NOW + 200);
            const res: RateLimitReservationResult = await limiter.reserve('k', 1);
            expect(res.allowed).toBe(true);
            assert(res.allowed);
            // The earliest slot will be when the oldest timestamp (T=0) expires: T=1000.
            expect(res.reservation.readyAtMs).toBe(NOW + 1000);
        });

        it('expired reservations are cleaned up and capacity refunded', async () => {
            const res: RateLimitReservationResult = await limiter.reserve('k', 5);
            expect(res.allowed).toBe(true);
            // Fast-forward past expiry (readyAtMs + grace period).
            // grace: max(5s, waitMs). waitMs = readyAtMs - now; now=0, readyAtMs=0, wait=0 -> grace 5000.
            jest.setSystemTime(NOW + 6000); // after expiry
            // Run cleanup
            await limiter.cleanup();
            // Capacity should be fully restored.
            for (let i: number = 0; i < CAPACITY; i++) {
                expect((await limiter.consume('k', 1)).allowed).toBe(true);
            }
        });
    });

    describe('state expiry', () => {
        it('sets expiresAtMs to exactly now + interval on the very first consume', async () => {
            await limiter.consume('k', 1);
            const state: SlidingWindowLogState | undefined = await limiter.config.store.get('k');
            assert(state);
            expect(state.expiresAtMs).toBe(NOW + INTERVAL);
        });

        it('does not let expiresAtMs grow unbounded across repeated consumes', async () => {
            // Several consumes spread out within the same window, all well
            // before the window's end.
            for (let i: number = 1; i <= 5; i++) {
                jest.setSystemTime(NOW + i * 100);
                await limiter.consume('k', 1);
            }
            const state: SlidingWindowLogState | undefined = await limiter.config.store.get('k');
            assert(state);
            // expiresAtMs should track "latest activity + interval", not
            // accumulate a full interval per call.
            expect(state.expiresAtMs).toBe(Date.now() + INTERVAL);
        });
    });
});