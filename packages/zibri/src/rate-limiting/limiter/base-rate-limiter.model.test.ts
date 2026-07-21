import assert from 'node:assert';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { SemaphoreRateLimiter, SemaphoreState } from './semaphore.rate-limiter';
import { initDiContainer } from '../../di/init-di-container.function';
import { GlobalRegistry } from '../../global/global-registry';
import { RateLimitReservationNotFoundError } from '../reservation/rate-limit-reservation-not-found.error';
import { RateLimitReservationResult } from '../reservation/rate-limit-reservation-result.model';
import { RateLimitReservation } from '../reservation/rate-limit-reservation.model';
import { InMemoryRateLimiterStore } from '../stores/in-memory.rate-limiter-store';

class TestLimiter extends SemaphoreRateLimiter {
    constructor(capacity: number) {
        super({
            name: `wait-for-reservation-test-${capacity}-${Math.random()}`,
            capacity,
            store: new InMemoryRateLimiterStore<SemaphoreState>(),
            reservationGracePeriodMs: (w) => Math.max(5000, w),
            maxReservationCount: capacity
        });
    }
}

// waitForReservation is implemented once, generically, on BaseRateLimiter -
// SemaphoreRateLimiter is used here only as a concrete, easy-to-control
// vehicle (readiness is driven explicitly via release(), not by elapsed time).
describe('BaseRateLimiter.waitForReservation', () => {
    beforeAll(() => {
        initDiContainer();
        GlobalRegistry.markAppAsCreated();
    });

    it('resolves immediately when the reservation is already ready', async () => {
        const limiter: TestLimiter = new TestLimiter(2);
        const res: RateLimitReservationResult = await limiter.reserve('k', 1);
        assert(res.allowed);

        await expect(limiter.waitForReservation(res.reservation, 1000)).resolves.toBeUndefined();
    });

    it('throws immediately when the reservation is already past its expiresAtMs', async () => {
        const limiter: TestLimiter = new TestLimiter(1);
        await limiter.consume('k', 1);
        const res: RateLimitReservationResult = await limiter.reserve('k', 1);
        assert(res.allowed);

        const expiredReservation: RateLimitReservation = { ...res.reservation, expiresAtMs: Date.now() - 1 };
        await expect(limiter.waitForReservation(expiredReservation, 1000)).rejects.toThrow('The given reservation is expired');
    });

    it('throws RateLimitReservationNotFoundError when the reservation no longer exists', async () => {
        const limiter: TestLimiter = new TestLimiter(1);
        const res: RateLimitReservationResult = await limiter.reserve('k', 1);
        assert(res.allowed);
        await limiter.cancelReservation(res.reservation);

        await expect(limiter.waitForReservation(res.reservation, 1000)).rejects.toThrow(RateLimitReservationNotFoundError);
    });

    describe('polling until ready', () => {
        let limiter: TestLimiter;

        afterAll(async () => {
            // avoid leaking a permanently-queued reservation across tests
            await limiter?.cleanup();
        });

        it('resolves once the reservation becomes ready, discovered via polling', async () => {
            limiter = new TestLimiter(1);
            await limiter.consume('k', 1);
            const res: RateLimitReservationResult = await limiter.reserve('k', 1);
            assert(res.allowed);
            expect(res.reservation.readyAtMs).toBe(Infinity);

            const waitPromise: Promise<void> = limiter.waitForReservation(res.reservation, 2000);
            // Free up capacity shortly after starting the wait, well within
            // the 100ms poll interval's reach.
            setTimeout(() => {
                void limiter.release('k', 1);
            }, 150);

            await expect(waitPromise).resolves.toBeUndefined();
        }, 10000);

        it('lets concurrent waiters for the same reservation resolve together', async () => {
            const strict: TestLimiter = new TestLimiter(1);
            await strict.consume('k', 1);
            const res: RateLimitReservationResult = await strict.reserve('k', 1);
            assert(res.allowed);

            const first: Promise<void> = strict.waitForReservation(res.reservation, 2000);
            const second: Promise<void> = strict.waitForReservation(res.reservation, 2000);
            setTimeout(() => {
                void strict.release('k', 1);
            }, 150);

            await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
            await strict.cleanup();
        }, 10000);
    });

    it('throws a timeout error when the reservation never becomes ready in time', async () => {
        const limiter: TestLimiter = new TestLimiter(1);
        await limiter.consume('k', 1); // permanently occupies the only permit
        const res: RateLimitReservationResult = await limiter.reserve('k', 1);
        assert(res.allowed);

        await expect(limiter.waitForReservation(res.reservation, 300)).rejects.toThrow();
        await limiter.cleanup();
    }, 5000);
});