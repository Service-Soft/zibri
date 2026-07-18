import assert from 'node:assert';

import { afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { SlidingWindowCounterRateLimiter, SlidingWindowCounterState } from './sliding-window-counter.rate-limiter';
import { initDiContainer } from '../../di/init-di-container.function';
import { Ms } from '../../utilities/ms';
import { RateLimitResult } from '../rate-limit-result.model';
import { RateLimitReservationResult } from '../reservation/rate-limit-reservation-result.model';
import { InMemoryRateLimiterStore } from '../stores/in-memory.rate-limiter-store';

const NOW: number = 1_700_000_000_000;
const CAPACITY: number = 10;
const INTERVAL: number = Ms.SECOND; // 1-second windows

class TestSlidingWindowCounterLimiter extends SlidingWindowCounterRateLimiter {
    constructor() {
        super(INTERVAL, {
            name: 'test-sliding-counter',
            capacity: CAPACITY,
            store: new InMemoryRateLimiterStore<SlidingWindowCounterState>(),
            maxReservationWaitMs: Ms.SECOND * 5,
            reservationGracePeriodMs: (w) => Math.max(5000, w),
            maxReservationCount: CAPACITY
        });
    }
}

describe('SlidingWindowCounterRateLimiter', () => {
    let limiter: TestSlidingWindowCounterLimiter;

    beforeAll(() => {
        initDiContainer();
    });

    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(NOW);
        limiter = new TestSlidingWindowCounterLimiter();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    describe('consume – sliding window counter', () => {
        it('allows up to capacity within a single window', async () => {
            for (let i: number = 0; i < CAPACITY; i++) {
                expect((await limiter.consume('k', 1)).allowed).toBe(true);
            }
            expect((await limiter.consume('k', 1)).allowed).toBe(false);
        });

        it('uses weighted previous count when crossing window boundary', async () => {
            // Fill half the capacity in the first window
            await limiter.consume('k', 5); // currentCount = 5

            // Advance just into the next window
            jest.setSystemTime(NOW + INTERVAL);
            // Now previousCount = 5, currentCount = 0, weight = 1 (just at start)
            // estimated = 0 + 5*1 = 5, remaining = 5
            let result: RateLimitResult = await limiter.consume('k', 1);
            expect(result.allowed).toBe(true);
            expect(result.remaining).toBe(4); // consumed 1, so currentCount=1, estimated=1+5*1=6

            // Advance 500ms into the window (halfway)
            jest.setSystemTime(NOW + INTERVAL + 500);
            // weight = 1 - 500/1000 = 0.5
            // estimated = 1 + 5*0.5 = 3.5, remaining = 6.5 → floor 6
            result = await limiter.consume('k', 1);
            expect(result.allowed).toBe(true);
            expect(result.remaining).toBe(5); // currentCount=2, estimated=2+5*0.5=4.5, floor(10-4.5)=5
        });

        it('resetsAtMs points to the end of the current window', async () => {
            const result: RateLimitResult = await limiter.consume('k', 1);
            expect(result.resetsAtMs).toBe(NOW + INTERVAL);
        });

        it('retryAfterMs is the next window boundary when denied', async () => {
            // Fill the window completely
            for (let i: number = 0; i < CAPACITY; i++) {
                await limiter.consume('k', 1);
            }
            const denied: RateLimitResult = await limiter.consume('k', 1);
            expect(denied.allowed).toBe(false);
            assert(!denied.allowed);
            // retryAtMs should be the start of the next window (NOW + INTERVAL)
            expect(denied.retryAtMs).toBe(NOW + INTERVAL);
        });

        it('previous window weight decays over the new window, freeing capacity', async () => {
            // Fill completely in the first window
            for (let i: number = 0; i < CAPACITY; i++) {
                await limiter.consume('k', 1);
            }

            // Right at the start of the new window, previous window still fully counts → denied
            jest.setSystemTime(NOW + 1000);
            let result: RateLimitResult = await limiter.consume('k', 1);
            expect(result.allowed).toBe(false);

            // Halfway through the new window (500 ms), weight = 0.5, estimated = 0 + 10*0.5 = 5, capacity left ≈ 5
            jest.setSystemTime(NOW + 1500);
            result = await limiter.consume('k', 1);
            expect(result.allowed).toBe(true);
            expect(result.remaining).toBe(4); // consumed 1, currentCount=1, estimated=1+10*0.5=6, remaining=4

            // At the very end of the window (999 ms), weight ≈ 0.001, almost all capacity free
            jest.setSystemTime(NOW + 1999);
            result = await limiter.consume('k', 1);
            expect(result.allowed).toBe(true);
            expect(result.remaining).toBe(7); // currentCount=2, estimated≈2+10*0.001≈2.01, remaining≈7.99→ floor 7? Actually need precise calculation.
            // Let’s not over‑specify the exact remaining, just ensure it's high.
        });
    });

    describe('reservations', () => {
        it('reserve deducts from estimated capacity immediately', async () => {
            const res: RateLimitReservationResult = await limiter.reserve('k', 3);
            expect(res.allowed).toBe(true);
            // Consume 7 should now be allowed (10 - 3 reserved = 7 remaining)
            const result: RateLimitResult = await limiter.consume('k', 7);
            expect(result.allowed).toBe(true);
            expect(result.remaining).toBe(0);
            // One more denied
            expect((await limiter.consume('k', 1)).allowed).toBe(false);
        });

        it('commit keeps capacity consumed', async () => {
            const res: RateLimitReservationResult = await limiter.reserve('k', 4);
            expect(res.allowed).toBe(true);
            assert(res.allowed);
            await limiter.commitReservation(res.reservation);
            // Consume 6 should be allowed (capacity 10 - 4 committed = 6)
            const result: RateLimitResult = await limiter.consume('k', 6);
            expect(result.allowed).toBe(true);
            expect(result.remaining).toBe(0);
        });

        it('cancel refunds capacity', async () => {
            const res: RateLimitReservationResult = await limiter.reserve('k', 8);
            expect(res.allowed).toBe(true);
            assert(res.allowed);
            await limiter.cancelReservation(res.reservation);
            // Should be able to consume full capacity
            for (let i: number = 0; i < CAPACITY; i++) {
                expect((await limiter.consume('k', 1)).allowed).toBe(true);
            }
        });

        it('readyAtMs is now if capacity available immediately', async () => {
            const res: RateLimitReservationResult = await limiter.reserve('k', 5);
            expect(res.allowed).toBe(true);
            assert(res.allowed);
            expect(res.reservation.readyAtMs).toBe(NOW);
        });

        it('readyAtMs accounts for decay once oversubscribed count carries into the next window', async () => {
            // Fill the window completely (currentCount=10)
            for (let i: number = 0; i < CAPACITY; i++) {
                await limiter.consume('k', 1);
            }
            // Reserve 1 – no capacity left
            const res: RateLimitReservationResult = await limiter.reserve('k', 1);
            expect(res.allowed).toBe(true); // allowed because wait is within maxReservationWaitMs
            assert(res.allowed);
            // Crossing into the next window doesn't hard-reset the count: the
            // 10 consumed become the new window's previousCount, still fully
            // weighted right at the boundary. Availability only frees up once
            // enough of that weight has decayed: at NOW + INTERVAL + 100, the
            // carried-over count contributes 10 * 0.9 = 9, plus the 1 being
            // reserved, exactly filling the capacity of 10.
            expect(res.reservation.readyAtMs).toBe(NOW + INTERVAL + 100);
        });

        it('reserve accounts for the weighted previous-window count near a boundary', async () => {
            // Fill completely in the first window.
            for (let i: number = 0; i < CAPACITY; i++) {
                await limiter.consume('k', 1);
            }
            // Move to the very start of the next window - previous window
            // still counts (almost) fully via the weight, so there is no
            // real capacity for a new reservation yet. A plain consume()
            // here is denied (see the 'previous window weight decays...'
            // test above); a reservation must not be granted "now" either.
            jest.setSystemTime(NOW + INTERVAL);
            const res: RateLimitReservationResult = await limiter.reserve('k', 1);
            expect(res.allowed).toBe(true);
            assert(res.allowed);
            expect(res.reservation.readyAtMs).toBeGreaterThan(Date.now());
        });
    });
});