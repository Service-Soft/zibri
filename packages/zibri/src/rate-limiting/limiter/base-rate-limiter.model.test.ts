import assert from 'node:assert';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { RateLimitStoreFailurePolicy } from './rate-limiter-config.model';
import { SemaphoreRateLimiter, SemaphoreState } from './semaphore.rate-limiter';
import { TokenBucketRateLimiter, TokenBucketState } from './token-bucket.rate-limiter';
import { initDiContainer } from '../../di/init-di-container.function';
import { TooManyRequestsError } from '../../error-handling/errors/too-many-requests.error';
import { GlobalRegistry } from '../../global/global-registry';
import { HttpStatus } from '../../http/http-status.enum';
import { Ms } from '../../utilities/ms';
import { RateLimitReservationNotFoundError } from '../reservation/rate-limit-reservation-not-found.error';
import { RateLimitReservationResult } from '../reservation/rate-limit-reservation-result.model';
import { RateLimitReservation } from '../reservation/rate-limit-reservation.model';
import { InMemoryRateLimiterStore } from '../stores/in-memory.rate-limiter-store';
import { RateLimitStoreUnavailableError } from '../stores/rate-limit-store-unavailable.error';
import { BaseRateLimitState, RateLimiterStoreUpdateResult } from '../stores/rate-limiter-store.interface';

const CAPACITY: number = 10;

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

class BucketLimiter extends TokenBucketRateLimiter {
    constructor(
        store: CountingStore<TokenBucketState>,
        onStoreFailure: RateLimitStoreFailurePolicy = RateLimitStoreFailurePolicy.REJECT
    ) {
        super(Ms.MINUTE, {
            name: `base-rate-limiter-test-${Math.random()}`,
            capacity: CAPACITY,
            store,
            maxReservationWaitMs: Ms.MINUTE,
            onStoreFailure
        });
    }
}

/**
 * A real in memory store that counts what was asked of it, and can be told to stop answering.
 *
 * Counting is what the cleanup tests are actually about - what they guard is how *many*
 * store operations a run costs, which nothing about the resulting state can show. Failing on demand
 * is the only way to have a store that is down without one to be down.
 */
class CountingStore<TState extends BaseRateLimitState> extends InMemoryRateLimiterStore<TState> {
    atomicUpdateCalls: number = 0;
    deleteExpiredCalls: number = 0;

    private failure: Error | undefined;

    override atomicUpdate(key: string, updater: (current: TState | undefined) => TState): RateLimiterStoreUpdateResult<TState> {
        this.atomicUpdateCalls++;
        if (this.failure) {
            throw this.failure;
        }
        return super.atomicUpdate(key, updater);
    }

    override deleteExpired(now: number): void {
        this.deleteExpiredCalls++;
        super.deleteExpired(now);
    }

    /**
     * Forgets the counts, so a test can measure one cleanup run rather than everything before it.
     */
    reset(): void {
        this.atomicUpdateCalls = 0;
        this.deleteExpiredCalls = 0;
    }

    /**
     * Makes every following update fail, the way a data source that is gone would.
     * @param error - What the store fails with.
     */
    failWith(error: Error): void {
        this.failure = error;
    }

    /**
     * Ages every state past its expiry, without waiting for it.
     */
    expireEverything(): void {
        for (const state of this.entries().values()) {
            Object.assign(state, { expiresAtMs: Date.now() - 1 });
        }
    }

    /**
     * Ages every open reservation past its expiry, without waiting for it.
     */
    expireReservations(): void {
        for (const state of this.entries().values()) {
            for (const reservation of state.reservations) {
                Object.assign(reservation, { expiresAtMs: Date.now() - 1 });
            }
        }
    }
}

// one application per file, not per describe - markAppAsCreated refuses a second one
beforeAll(() => {
    initDiContainer();
    GlobalRegistry.markAppAsCreated();
});

// waitForReservation is implemented once, generically, on BaseRateLimiter -
// SemaphoreRateLimiter is used here only as a concrete, easy-to-control
// vehicle (readiness is driven explicitly via release(), not by elapsed time).
describe('BaseRateLimiter.waitForReservation', () => {
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

// cleanup and the store failure policy are implemented once on BaseRateLimiter. A token bucket is
// used here because it is the one that reaches the base wrap() unchanged, and because its
// reservations have a finite, predictable expiry.
describe('BaseRateLimiter.cleanup', () => {
    it('drops what expired without asking the store about it key by key', async () => {
        const store: CountingStore<TokenBucketState> = new CountingStore<TokenBucketState>();
        const limiter: TokenBucketRateLimiter = new BucketLimiter(store);

        for (const key of ['a', 'b', 'c']) {
            await limiter.consume(key, 1);
        }
        store.expireEverything();
        store.reset();

        await limiter.cleanup();

        expect(await store.keys()).toEqual([]);
        // the whole point of the rewrite: one bulk delete instead of a get plus an atomic update per
        // key, which against a shared store is a lock round trip each
        expect(store.deleteExpiredCalls).toBe(1);
        expect(store.atomicUpdateCalls).toBe(0);
    });

    it('touches only the keys that are holding capacity nobody is going to use', async () => {
        const store: CountingStore<TokenBucketState> = new CountingStore<TokenBucketState>();
        const limiter: TokenBucketRateLimiter = new BucketLimiter(store);

        // 'quiet' just counts, 'abandoned' has a reservation whose owner never came back
        await limiter.consume('quiet', 1);
        await limiter.consume('abandoned', CAPACITY);
        const res: RateLimitReservationResult = await limiter.reserve('abandoned', 2);
        assert(res.allowed);

        store.reset();
        await limiter.cleanup();
        expect(store.atomicUpdateCalls).toBe(0);

        store.expireReservations();
        store.reset();
        await limiter.cleanup();

        expect(store.atomicUpdateCalls).toBe(1);
        expect((await store.get('abandoned'))?.reservations).toEqual([]);
    });

    it('gives the capacity of an abandoned reservation back', async () => {
        const store: CountingStore<TokenBucketState> = new CountingStore<TokenBucketState>();
        const limiter: TokenBucketRateLimiter = new BucketLimiter(store);

        await limiter.consume('k', CAPACITY - 2);
        const res: RateLimitReservationResult = await limiter.reserve('k', 2);
        assert(res.allowed);

        // the reservation debited the last two immediately, so there is nothing left to consume
        expect((await limiter.consume('k', 1)).allowed).toBe(false);

        store.expireReservations();
        await limiter.cleanup();

        expect((await limiter.consume('k', 1)).allowed).toBe(true);
    });
});

describe('BaseRateLimiter store failure policy', () => {
    it('refuses the call with a 503 by default', async () => {
        const store: CountingStore<TokenBucketState> = new CountingStore<TokenBucketState>();
        const limiter: TokenBucketRateLimiter = new BucketLimiter(store);
        let ran: boolean = false;
        const limited: () => Promise<void> = limiter.wrap(() => {
            ran = true;
        });

        store.failWith(new Error('the data source is gone'));

        // not a 500: nothing about the request was wrong, and trying again is a reasonable thing for
        // the caller to do
        await expect(limited()).rejects.toThrow(RateLimitStoreUnavailableError);
        await expect(limited()).rejects.toMatchObject({ status: HttpStatus.SERVICE_UNAVAILABLE });
        expect(ran).toBe(false);
    });

    it('lets the call through when the limiter is configured to', async () => {
        const store: CountingStore<TokenBucketState> = new CountingStore<TokenBucketState>();
        const limiter: TokenBucketRateLimiter = new BucketLimiter(store, RateLimitStoreFailurePolicy.ALLOW);
        let ran: boolean = false;
        const limited: () => Promise<void> = limiter.wrap(() => {
            ran = true;
        });

        store.failWith(new Error('the data source is gone'));

        await expect(limited()).resolves.toBeUndefined();
        expect(ran).toBe(true);
    });

    it('still enforces the limit when the store answers', async () => {
        const store: CountingStore<TokenBucketState> = new CountingStore<TokenBucketState>();
        const limiter: TokenBucketRateLimiter = new BucketLimiter(store, RateLimitStoreFailurePolicy.ALLOW);
        const limited: () => Promise<void> = limiter.wrap(() => undefined, { keyFn: 'k' });

        for (let i: number = 0; i < CAPACITY; i++) {
            await limited();
        }

        // the policy is about a store that cannot answer, not about a limit that says no
        await expect(limited()).rejects.toThrow(TooManyRequestsError);
    });
});