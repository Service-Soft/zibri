import { afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { AuthRateLimiter } from './auth.rate-limiter';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { initDiContainer } from '../di/init-di-container.function';
import { inject } from '../di/inject.function';
import { GlobalRegistry } from '../global/global-registry';
import { type LoggerInterface } from '../logging/logger.interface';
import { RateLimitStoreFailurePolicy } from '../rate-limiting/limiter/rate-limiter-config.model';
import { RateLimitStoreUnavailableError } from '../rate-limiting/stores/rate-limit-store-unavailable.error';
import { Ms } from '../utilities/ms';

/**
 * The auth limiter with room for two callers.
 * @param onStoreFailure - What a third caller gets.
 * @returns The limiter.
 */
function limiterWithRoomForTwo(onStoreFailure: RateLimitStoreFailurePolicy): AuthRateLimiter {
    return new AuthRateLimiter({ maxAttempts: 5, windowInMs: Ms.MINUTE * 10, maxKeys: 2, onStoreFailure });
}

/**
 * One attempt from the given address.
 * @param limiter - The limiter guarding the attempt.
 * @param address - Who is trying.
 * @returns What the guarded call answered.
 */
async function attemptFrom(limiter: AuthRateLimiter, address: string): Promise<string> {
    return await limiter.wrap(async () => await Promise.resolve('let in'), { keyFn: () => address })();
}

describe('AuthRateLimiter', () => {
    let error: jest.SpiedFunction<LoggerInterface['error']>;

    beforeAll(() => {
        initDiContainer();
        GlobalRegistry.markAppAsCreated();
    });

    beforeEach(() => {
        // the store reports being full once, which is the log line, not the test
        error = jest.spyOn(inject(ZIBRI_DI_TOKENS.LOGGER), 'error').mockReturnValue();
    });

    afterEach(() => {
        error.mockRestore();
    });

    it('lets a caller it has no room for through when told to, and says once that it is full', async () => {
        const limiter: AuthRateLimiter = limiterWithRoomForTwo(RateLimitStoreFailurePolicy.ALLOW);
        await attemptFrom(limiter, '203.0.113.1');
        await attemptFrom(limiter, '203.0.113.2');

        expect(await attemptFrom(limiter, '203.0.113.3')).toBe('let in');
        expect(await attemptFrom(limiter, '203.0.113.4')).toBe('let in');
        expect(error).toHaveBeenCalledTimes(1);
    });

    it('refuses a caller it has no room for when told to, and keeps counting the ones it holds', async () => {
        const limiter: AuthRateLimiter = limiterWithRoomForTwo(RateLimitStoreFailurePolicy.REJECT);
        await attemptFrom(limiter, '203.0.113.1');
        await attemptFrom(limiter, '203.0.113.2');

        await expect(attemptFrom(limiter, '203.0.113.3')).rejects.toBeInstanceOf(RateLimitStoreUnavailableError);
        expect(await attemptFrom(limiter, '203.0.113.1')).toBe('let in');
    });
});