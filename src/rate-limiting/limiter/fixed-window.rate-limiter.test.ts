import assert from 'node:assert';

import { afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { FixedWindowRateLimiter, FixedWindowState } from './fixed-window.rate-limiter';
import { initDiContainer } from '../../di/init-di-container.function';
import { Ms } from '../../utilities/ms';
import { RateLimitResult } from '../rate-limit-result.model';
import { RateLimitReservationResult } from '../reservation/rate-limit-reservation-result.model';
import { InMemoryRateLimiterStore } from '../stores/in-memory.rate-limiter-store';

const NOW: number = 1_700_000_000_000;
const CAPACITY: number = 5;
const INTERVAL: number = 1000;

class TestFixedWindowLimiter extends FixedWindowRateLimiter {
    constructor() {
        super(INTERVAL, {
            name: 'test-fixed',
            capacity: CAPACITY,
            store: new InMemoryRateLimiterStore<FixedWindowState>(),
            maxReservationWaitMs: 5000,
            reservationGracePeriodMs: (w) => Math.max(5000, w),
            maxReservationCount: CAPACITY
        });
    }
}

describe('FixedWindowRateLimiter', () => {
    let limiter: TestFixedWindowLimiter;

    beforeAll(() => initDiContainer());

    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(NOW);
        limiter = new TestFixedWindowLimiter();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    describe('consume', () => {
        it('allows up to capacity in a single window', async () => {
            for (let i: number = 0; i < CAPACITY; i++) {
                expect((await limiter.consume('k', 1)).allowed).toBe(true);
            }
            expect((await limiter.consume('k', 1)).allowed).toBe(false);
        });

        it('resets count after window expires', async () => {
            await limiter.consume('k', CAPACITY);
            jest.setSystemTime(NOW + INTERVAL); // new window
            const res: RateLimitResult = await limiter.consume('k', 1);
            expect(res.allowed).toBe(true);
            expect(res.remaining).toBe(CAPACITY - 1);
        });

        it('remaining accounts for reserved slots', async () => {
            await limiter.reserve('k', 2);
            const res: RateLimitResult = await limiter.consume('k', 3);
            expect(res.allowed).toBe(true);
            expect(res.remaining).toBe(0); // 5 - 3 - 2 = 0
            // one more denied
            expect((await limiter.consume('k', 1)).allowed).toBe(false);
        });
    });

    describe('reservations', () => {
        it('reserve when capacity available is immediate', async () => {
            const res: RateLimitReservationResult = await limiter.reserve('k', 2);
            assert(res.allowed);
            expect(res.reservation.readyAtMs).toBe(NOW);
        });

        it('readyAtMs is next window boundary when current window full', async () => {
            await limiter.consume('k', CAPACITY);
            const res: RateLimitReservationResult = await limiter.reserve('k', 1);
            assert(res.allowed);
            expect(res.reservation.readyAtMs).toBe(NOW + INTERVAL); // next window start
        });

        it('readyAtMs is Infinity when reservedCount prevents fit even after reset', async () => {
            // Reserve 4, leaving 1 slot; then fill it with a regular consume.
            await limiter.reserve('k', 4);
            await limiter.consume('k', 1);

            // Use a limiter with no max wait so that infinity is allowed.
            // eslint-disable-next-line typescript/typedef
            const unlimitedLimiter = new class extends FixedWindowRateLimiter {
                constructor() {
                    super(INTERVAL, {
                        name: 'test-unlimited',
                        capacity: CAPACITY,
                        store: new InMemoryRateLimiterStore<FixedWindowState>(),
                        maxReservationWaitMs: undefined,
                        reservationGracePeriodMs: (w) => Math.max(5000, w),
                        maxReservationCount: CAPACITY
                    });
                }
            }();

            // Create the same state as before (we need to reserve again against the same key).
            // Since we have a fresh store, we must replicate the steps on the new limiter.
            await unlimitedLimiter.reserve('k', 4);
            await unlimitedLimiter.consume('k', 1);

            const res: RateLimitReservationResult = await unlimitedLimiter.reserve('k', 2);
            assert(res.allowed);
            expect(res.reservation.readyAtMs).toBe(Number.MAX_SAFE_INTEGER);
        });

        it('rejects reservation when reservedCount prevents fit even after reset', async () => {
            await limiter.reserve('k', 4);
            await limiter.consume('k', 1);
            const res: RateLimitReservationResult = await limiter.reserve('k', 2);
            expect(res.allowed).toBe(false);
            if (!res.allowed) {
                expect(res.reason).toBe('QUEUE_TOO_LONG');
            }
        });

        it('commit moves reserved to count in current window', async () => {
            const res: RateLimitReservationResult = await limiter.reserve('k', 3);
            assert(res.allowed);
            await limiter.commitReservation(res.reservation);
            const state: FixedWindowState | undefined = await limiter.config.store.get('k');
            expect(state?.count).toBe(3);
            expect(state?.reservedCount).toBe(0);
            // remaining = 5 - 3 = 2
            const consumeRes: RateLimitResult = await limiter.consume('k', 2);
            expect(consumeRes.allowed).toBe(true);
            expect(consumeRes.remaining).toBe(0);
        });

        it('cancel refunds reserved capacity', async () => {
            const res: RateLimitReservationResult = await limiter.reserve('k', CAPACITY);
            assert(res.allowed);
            await limiter.cancelReservation(res.reservation);
            for (let i: number = 0; i < CAPACITY; i++) {
                expect((await limiter.consume('k', 1)).allowed).toBe(true);
            }
        });

        it('expired reservation cleaned up, capacity refunded', async () => {
            const res: RateLimitReservationResult = await limiter.reserve('k', 3);
            assert(res.allowed);
            jest.setSystemTime(res.reservation.expiresAtMs + 1);
            await limiter.cleanup();
            for (let i: number = 0; i < CAPACITY; i++) {
                expect((await limiter.consume('k', 1)).allowed).toBe(true);
            }
        });
    });

    describe('state expiry', () => {
        it('eventually evicts a key that has gone fully idle', async () => {
            await limiter.consume('k', 1);
            // Far beyond any reasonable idle horizon, with no further
            // activity and no pending reservations for this key.
            jest.setSystemTime(NOW + Ms.YEAR);
            await limiter.cleanup();
            expect(await limiter.config.store.get('k')).toBeUndefined();
        });
    });
});