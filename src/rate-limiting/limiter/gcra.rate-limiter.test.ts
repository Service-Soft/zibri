import assert from 'node:assert';

import { afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { GcraRateLimiter, GcraState } from './gcra.rate-limiter';
import { initDiContainer } from '../../di/init-di-container.function';
import { Ms } from '../../utilities/ms';
import { RateLimitResult } from '../rate-limit-result.model';
import { RateLimitReservationResult } from '../reservation/rate-limit-reservation-result.model';
import { RateLimitReservation } from '../reservation/rate-limit-reservation.model';
import { InMemoryRateLimiterStore } from '../stores/in-memory.rate-limiter-store';

const NOW: number = 1_700_000_000_000;
const CAPACITY: number = 10;
const INTERVAL: number = 1000;

class TestGcraLimiter extends GcraRateLimiter {
    constructor() {
        super(INTERVAL, {
            name: 'test-gcra',
            capacity: CAPACITY,
            store: new InMemoryRateLimiterStore<GcraState>(),
            maxReservationWaitMs: 5000,
            reservationGracePeriodMs: (w) => Math.max(5000, w),
            maxReservationCount: CAPACITY
        });
    }
}

describe('GcraRateLimiter', () => {
    let limiter: TestGcraLimiter;

    beforeAll(() => initDiContainer());

    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(NOW);
        limiter = new TestGcraLimiter();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    describe('consume', () => {
        it('allows burst up to capacity', async () => {
            for (let i: number = 0; i < CAPACITY; i++) {
                expect((await limiter.consume('k', 1)).allowed).toBe(true);
            }
            expect((await limiter.consume('k', 1)).allowed).toBe(false);
        });

        it('recovers one token after emission interval', async () => {
            // exhaust burst
            await limiter.consume('k', CAPACITY);
            jest.setSystemTime(NOW + 100); // one emission interval (1000/10 = 100ms per token)
            const res: RateLimitResult = await limiter.consume('k', 1);
            expect(res.allowed).toBe(true);
            expect(res.remaining).toBe(0); // used the only available token
        });

        it('remaining accounts for reserved tokens', async () => {
            await limiter.reserve('k', 3);
            const res: RateLimitResult = await limiter.consume('k', 7);
            expect(res.allowed).toBe(true);
            expect(res.remaining).toBe(0);
        });
    });

    describe('reservations', () => {
        it('reserve reduces available capacity immediately', async () => {
            const res: RateLimitReservationResult = await limiter.reserve('k', 6);
            assert(res.allowed);
            const consumeRes: RateLimitResult = await limiter.consume('k', 4);
            expect(consumeRes.allowed).toBe(true);
            expect(consumeRes.remaining).toBe(0);
            // 5th token denied
            expect((await limiter.consume('k', 1)).allowed).toBe(false);
        });

        it('readyAtMs reflects wait for emission when tokens insufficient', async () => {
            await limiter.consume('k', CAPACITY); // burst exhausted
            const res: RateLimitReservationResult = await limiter.reserve('k', 3); // need 3 tokens → 300ms
            assert(res.allowed);
            expect(res.reservation.readyAtMs).toBe(NOW + 300);
        });

        it('commit advances TAT and keeps capacity consumed', async () => {
            const res: RateLimitReservationResult = await limiter.reserve('k', 5);
            assert(res.allowed);
            await limiter.commitReservation(res.reservation);
            // After commit, TAT should have moved forward by 500ms (5 tokens)
            const state: GcraState | undefined = await limiter.config.store.get('k');
            expect(state?.theoreticalArrivalTimeMs).toBe(NOW + 500);
            expect(state?.reservedCount).toBe(0);
            // Only 5 tokens left in the current window
            const consumeRes: RateLimitResult = await limiter.consume('k', 5);
            expect(consumeRes.allowed).toBe(true);
            expect(consumeRes.remaining).toBe(0);
        });

        it('cancel refunds reserved tokens and recalculates ready times', async () => {
            await limiter.consume('k', CAPACITY); // burst gone
            const res1: RateLimitReservationResult = await limiter.reserve('k', 3); // wait 300ms
            assert(res1.allowed);
            const res2: RateLimitReservationResult = await limiter.reserve('k', 4); // wait 700ms (3+4 tokens)
            assert(res2.allowed);
            expect(res1.reservation.readyAtMs).toBe(NOW + 300);
            expect(res2.reservation.readyAtMs).toBe(NOW + 700);

            // Cancel the first reservation
            await limiter.cancelReservation(res1.reservation);
            // Now second reservation's wait should shorten to 400ms (since only 4 tokens needed)
            const updated: RateLimitReservation | undefined = await limiter.getReservation(res2.reservation.id, 'k');
            assert(updated);
            expect(updated.readyAtMs).toBe(NOW + 400);
        });

        it('expired reservations are cleaned up and capacity refunded', async () => {
            const res: RateLimitReservationResult = await limiter.reserve('k', 4);
            assert(res.allowed);
            jest.setSystemTime(res.reservation.expiresAtMs + 1);
            await limiter.cleanup();
            // Full capacity should be restored
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