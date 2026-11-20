import assert from 'node:assert';

import { beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { initDiContainer } from '../../di/init-di-container.function';
import { GlobalRegistry } from '../../global/global-registry';
import { RateLimitResult } from '../rate-limit-result.model';
import { RateLimitReservationRejectionReason } from '../reservation/rate-limit-reservation-rejection-reason.enum';
import { RateLimitReservationResult, SuccessRateLimitReservationResult } from '../reservation/rate-limit-reservation-result.model';
import { RateLimitReservation } from '../reservation/rate-limit-reservation.model';
import { InMemoryRateLimiterStore } from '../stores/in-memory.rate-limiter-store';
import { SemaphoreRateLimiter, SemaphoreState } from './semaphore.rate-limiter';

const CAPACITY: number = 3;

class TestSemaphoreLimiter extends SemaphoreRateLimiter {
    constructor(maxPendingReservations?: number) {
        super({
            name: 'test-semaphore',
            capacity: CAPACITY,
            store: new InMemoryRateLimiterStore<SemaphoreState>(),
            reservationGracePeriodInMs: (w) => Math.max(5000, w),
            maxReservationCount: CAPACITY,
            maxPendingReservations
        });
    }
}

describe('SemaphoreRateLimiter', () => {
    let limiter: TestSemaphoreLimiter;

    beforeAll(() => {
        initDiContainer();
        GlobalRegistry.markAppAsCreated();
    });

    beforeEach(() => {
        limiter = new TestSemaphoreLimiter();
    });

    describe('consume and release', () => {
        it('acquires up to capacity', async () => {
            for (let i: number = 0; i < CAPACITY; i++) {
                expect((await limiter.consume('k', 1)).allowed).toBe(true);
            }
            expect((await limiter.consume('k', 1)).allowed).toBe(false);
        });

        it('release frees capacity', async () => {
            await limiter.consume('k', CAPACITY);
            await limiter.release('k', 1);
            const result: RateLimitResult = await limiter.consume('k', 1);
            expect(result.allowed).toBe(true);
            expect(result.remaining).toBe(0);
        });
    });

    describe('reservations', () => {
        it('reserve when capacity available is immediate', async () => {
            const res: RateLimitReservationResult = await limiter.reserve('k', 2);
            expect(res.allowed).toBe(true);
            assert(res.allowed);
            expect(res.reservation.readyAtMs).toBeLessThanOrEqual(Date.now());
        });

        it('reserve when no capacity returns Infinity readyAtMs', async () => {
            // fully occupy
            await limiter.consume('k', CAPACITY);
            const res: RateLimitReservationResult = await limiter.reserve('k', 1);
            expect(res.allowed).toBe(true);
            assert(res.allowed);
            // A semaphore can't estimate when a permit will free up, so an unready
            // reservation's readyAtMs is literally Infinity, not just "far away".
            expect(res.reservation.readyAtMs).toBe(Infinity);
        });

        it('release makes pending reservations ready', async () => {
            // exhaust capacity
            await limiter.consume('k', CAPACITY);
            const res: RateLimitReservationResult = await limiter.reserve('k', 1);
            assert(res.allowed);
            expect(res.reservation.readyAtMs).toBeGreaterThan(Date.now());

            // release one permit
            await limiter.release('k', 1);
            // now the reservation should be ready – we can check via getReservation
            const updated: RateLimitReservation | undefined = await limiter.getReservation(res.reservation.id, 'k');
            assert(updated);
            expect(updated.readyAtMs).toBeLessThanOrEqual(Date.now());
        });

        it('rejects a new reservation once maxPendingReservations are already queued for a key', async () => {
            // bound the queue depth to 1 pending reservation
            const strictLimiter: TestSemaphoreLimiter = new TestSemaphoreLimiter(1);
            await strictLimiter.consume('k', CAPACITY);

            const first: RateLimitReservationResult = await strictLimiter.reserve('k', 1);
            assert(first.allowed);
            expect(first.reservation.readyAtMs).toBe(Infinity);

            const second: RateLimitReservationResult = await strictLimiter.reserve('k', 1);
            expect(second.allowed).toBe(false);
            assert(!second.allowed);
            expect(second.reason).toBe(RateLimitReservationRejectionReason.QUEUE_TOO_LONG);
        });

        it('cancel reservation frees up reserved slots', async () => {
            // reserve 2, leaving 1 slot
            const res: RateLimitReservationResult = await limiter.reserve('k', 2);
            assert(res.allowed);
            // consume the remaining slot
            const result: RateLimitResult = await limiter.consume('k', 1);
            expect(result.allowed).toBe(true);
            // now capacity is full (1 current + 2 reserved = 3)
            expect((await limiter.consume('k', 1)).allowed).toBe(false);

            // cancel reservation
            await limiter.cancelReservation(res.reservation);
            // now one slot free
            const after: RateLimitResult = await limiter.consume('k', 1);
            expect(after.allowed).toBe(true);
        });

        it('commit keeps reserved slots consumed', async () => {
            const res: RateLimitReservationResult = await limiter.reserve('k', 2);
            assert(res.allowed);
            await limiter.commitReservation(res.reservation);
        });
    });

    // Add to semaphore test file
    describe('wrap with reserveIfUnavailable (semaphore)', () => {
        // eslint-disable-next-line typescript/no-explicit-any
        type TestFn = (...args: any[]) => Promise<string>;

        let wrappingLimiter: TestSemaphoreLimiter;
        let fn: jest.Mock<TestFn>;

        beforeEach(() => {
            wrappingLimiter = new TestSemaphoreLimiter();
            fn = jest.fn<TestFn>().mockResolvedValue('ok');
        });

        it('returns function result on successful consume', async () => {
            // eslint-disable-next-line typescript/typedef
            const wrapped = wrappingLimiter.wrap(fn);
            const result: string = await wrapped();
            expect(result).toBe('ok');
            expect(fn).toHaveBeenCalled();
        });

        it('returns reservation when semaphore is full and reserveIfUnavailable is true', async () => {
            // exhaust capacity
            for (let i: number = 0; i < CAPACITY; i++) {
                await wrappingLimiter.consume('global', 1);
            }
            // eslint-disable-next-line typescript/typedef
            const wrapped = wrappingLimiter.wrap(fn, { reserveIfUnavailable: true });
            const result: string | SuccessRateLimitReservationResult = await wrapped();
            expect(result).toHaveProperty('allowed', true);
            assert(typeof result === 'object');
            expect(result.reservation).toBeDefined();
            expect(fn).not.toHaveBeenCalled();
            // Clean up
            await wrappingLimiter.cancelReservation(result.reservation);
        });

        it('throws TooManyRequestsError if reserveIfUnavailable is true but reservation is rejected (e.g., max capacity exceeded)', async () => {
        // Create a strict semaphore with maxReservationCount less than capacity
            // eslint-disable-next-line typescript/typedef
            const strictLimiter = new class extends SemaphoreRateLimiter {
                constructor() {
                    super({
                        name: 'strict-sem',
                        capacity: CAPACITY,
                        store: new InMemoryRateLimiterStore<SemaphoreState>(),
                        reservationGracePeriodInMs: (w) => Math.max(5000, w),
                        maxReservationCount: 2 // only allow small reservations
                    });
                }
            }();
            // fill capacity
            for (let i: number = 0; i < CAPACITY; i++) {
                await strictLimiter.consume('global', 1);
            }
            // eslint-disable-next-line typescript/typedef
            const wrapped = strictLimiter.wrap(fn, { reserveIfUnavailable: true, countFn: () => 3 }); // request 3, exceeds max reservation size
            await expect(wrapped()).rejects.toThrow('Rate limit was reached');
            expect(fn).not.toHaveBeenCalled();
        });

        it('rejects committing a reservation before it is ready', async () => {
            for (let i: number = 0; i < CAPACITY; i++) {
                await wrappingLimiter.consume('global', 1);
            }
            // eslint-disable-next-line typescript/typedef
            const wrapped = wrappingLimiter.wrap(fn, { reserveIfUnavailable: true });
            const result: string | SuccessRateLimitReservationResult = await wrapped();
            assert(typeof result === 'object');
            assert(result.allowed);
            expect(result.reservation.readyAtMs).toBe(Infinity);

            // capacity is still fully consumed – committing now would push current past capacity
            await expect(wrappingLimiter.commitReservation(result.reservation)).rejects.toThrow();

            // clean up: the reservation is still open
            await wrappingLimiter.cancelReservation(result.reservation);
        });

        it('commit on returned reservation keeps capacity used once it becomes ready', async () => {
            for (let i: number = 0; i < CAPACITY; i++) {
                await wrappingLimiter.consume('global', 1);
            }
            // eslint-disable-next-line typescript/typedef
            const wrapped = wrappingLimiter.wrap(fn, { reserveIfUnavailable: true });
            const result: string | SuccessRateLimitReservationResult = await wrapped();
            assert(typeof result === 'object');
            assert(result.allowed);

            // free up a slot so the reservation becomes ready, then wait for it
            await wrappingLimiter.release('global', 1);
            await wrappingLimiter.waitForReservation(result.reservation, 1000);

            await wrappingLimiter.commitReservation(result.reservation);
            // capacity is now fully consumed again: 2 remaining + 1 committed = 3
            expect((await wrappingLimiter.consume('global', 1)).allowed).toBe(false);
        });
    });
});