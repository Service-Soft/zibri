import { describe, expect, it, vi, Mock } from 'vitest';

import { RateLimiterInterface } from './limiter/rate-limiter.interface.ts';
import { RateLimitingCleanupCronJob } from './rate-limiting-cleanup.cron-job.ts';
import { RateLimitingServiceInterface } from './rate-limiting-service.interface.ts';
import { BaseRateLimitState } from './stores/rate-limiter-store.interface.ts';

function fakeRateLimitingService(): RateLimitingServiceInterface & { cleanup: Mock<() => Promise<void>> } {
    return {
        limiters: [] as RateLimiterInterface<BaseRateLimitState>[],
        addLimiter: () => undefined,
        cleanup: vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    };
}

describe('RateLimitingCleanupCronJob', () => {
    it('delegates onTick to the rate limiting service\'s cleanup', async () => {
        const service: RateLimitingServiceInterface & { cleanup: Mock<() => Promise<void>> } = fakeRateLimitingService();
        const cronJob: RateLimitingCleanupCronJob = new RateLimitingCleanupCronJob(service);

        await cronJob.onTick();

        expect(service.cleanup).toHaveBeenCalledTimes(1);
    });

    it('propagates errors from the rate limiting service\'s cleanup', async () => {
        const service: RateLimitingServiceInterface & { cleanup: Mock<() => Promise<void>> } = fakeRateLimitingService();
        service.cleanup.mockRejectedValue(new Error('cleanup failed'));
        const cronJob: RateLimitingCleanupCronJob = new RateLimitingCleanupCronJob(service);

        await expect(cronJob.onTick()).rejects.toThrow('cleanup failed');
    });

    it('is configured to run every 10 seconds and not on init', () => {
        const service: RateLimitingServiceInterface = fakeRateLimitingService();
        const cronJob: RateLimitingCleanupCronJob = new RateLimitingCleanupCronJob(service);

        expect(cronJob.initialConfig.name).toBe('RateLimitingCleanupCronJob');
        expect(cronJob.initialConfig.runOnInit).toBe(false);
    });
});