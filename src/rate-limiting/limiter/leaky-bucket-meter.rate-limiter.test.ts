import assert from 'node:assert';

import { afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { LeakyBucketMeterRateLimiter, LeakyBucketMeterState } from './leaky-bucket-meter.rate-limiter';
import { initDiContainer } from '../../di/init-di-container.function';
import { RateLimitResult } from '../rate-limit-result.model';
import { RateLimitReservationResult } from '../reservation/rate-limit-reservation-result.model';
import { InMemoryRateLimiterStore } from '../stores/in-memory.rate-limiter-store';

const NOW: number = 1_700_000_000_000;
const CAPACITY: number = 10; // max water
const INTERVAL: number = 1000; // leak out full capacity every 1 second

class TestLeakyMeterLimiter extends LeakyBucketMeterRateLimiter {
    constructor() {
        super(INTERVAL, {
            name: 'test-meter',
            capacity: CAPACITY,
            store: new InMemoryRateLimiterStore<LeakyBucketMeterState>(),
            maxReservationWaitMs: 5000,
            reservationGracePeriodMs: (w) => Math.max(5000, w),
            maxReservationCount: CAPACITY
        });
    }
}

describe('LeakyBucketMeterRateLimiter', () => {
    let limiter: TestLeakyMeterLimiter;

    beforeAll(() => initDiContainer());

    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(NOW);
        limiter = new TestLeakyMeterLimiter();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    describe('consume', () => {
        it('allows request if water + count <= capacity after leak', async () => {
            const res: RateLimitResult = await limiter.consume('k', 5);
            expect(res.allowed).toBe(true);
            expect(res.remaining).toBe(5);
        });

        it('denies when water exceeds capacity', async () => {
            await limiter.consume('k', CAPACITY); // water = 10
            const res: RateLimitResult = await limiter.consume('k', 1);
            expect(res.allowed).toBe(false);
        });

        it('water leaks over time, freeing capacity', async () => {
            await limiter.consume('k', CAPACITY); // water = 10
            jest.setSystemTime(NOW + 500); // half leaked → water = 5
            const res: RateLimitResult = await limiter.consume('k', 5);
            expect(res.allowed).toBe(true);
            expect(res.remaining).toBe(0);
        });
    });

    describe('reservations', () => {
        it('reserve debits reservedWater, reducing available capacity', async () => {
            const res: RateLimitReservationResult = await limiter.reserve('k', 3);
            expect(res.allowed).toBe(true);
            // consume should see remaining 7
            const consumeRes: RateLimitResult = await limiter.consume('k', 7);
            expect(consumeRes.allowed).toBe(true);
            expect(consumeRes.remaining).toBe(0);
        });

        it('commit moves reservedWater to water', async () => {
            const res: RateLimitReservationResult = await limiter.reserve('k', 4);
            assert(res.allowed);
            await limiter.commitReservation(res.reservation);
            // water should now be 4, reservedWater 0
            const state: LeakyBucketMeterState | undefined = await limiter.config.store.get('k');
            expect(state?.water).toBe(4);
            expect(state?.reservedWater).toBe(0);
            // remaining capacity = 6
            const consumeRes: RateLimitResult = await limiter.consume('k', 6);
            expect(consumeRes.allowed).toBe(true);
            expect(consumeRes.remaining).toBe(0);
        });

        it('cancel refunds reservedWater', async () => {
            const res: RateLimitReservationResult = await limiter.reserve('k', CAPACITY);
            assert(res.allowed);
            await limiter.cancelReservation(res.reservation);
            // full capacity restored
            for (let i: number = 0; i < CAPACITY; i++) {
                expect((await limiter.consume('k', 1)).allowed).toBe(true);
            }
        });

        it('readyAtMs reflects time to leak enough water', async () => {
            // fill water to capacity
            await limiter.consume('k', CAPACITY);
            jest.setSystemTime(NOW + 200); // 2 units leaked → water = 8
            // reserve 5 units → total virtual = 8 + 5 = 13, excess = 3, leak rate = 0.01 units/ms → wait 300ms
            const res: RateLimitReservationResult = await limiter.reserve('k', 5);
            expect(res.allowed).toBe(true);
            assert(res.allowed);
            // readyAtMs should be NOW + 200 + 300 = NOW + 500
            expect(res.reservation.readyAtMs).toBe(NOW + 500);
        });

        it('expired reservations are cleaned up and capacity refunded', async () => {
            const res: RateLimitReservationResult = await limiter.reserve('k', 3);
            assert(res.allowed);
            jest.setSystemTime(res.reservation.expiresAtMs + 1);
            await limiter.cleanup();
            // capacity fully restored
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
            jest.setSystemTime(NOW + 1000 * 60 * 60 * 24 * 365);
            await limiter.cleanup();
            expect(await limiter.config.store.get('k')).toBeUndefined();
        });
    });
});