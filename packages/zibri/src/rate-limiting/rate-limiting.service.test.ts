import { afterAll, describe, expect, it } from '@jest/globals';

import { RateLimitingServiceInterface } from './rate-limiting-service.interface';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { CronJob } from '../cron/cron-job.model';
import { CronServiceInterface } from '../cron/cron-service.interface';
import { CronService } from '../cron/cron.service';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { DiProvider } from '../di/models/di-provider.model';
import { DiVariants } from '../di/models/di-variant.model';

/**
 * Minimal stand-in that satisfies `isRateLimiter`'s structural check without
 * pulling in a full algorithm implementation - only `config.name` matters
 * for the scenarios under test here.
 */
abstract class FakeRateLimiter {
    abstract readonly config: { name: string };
    // eslint-disable-next-line typescript/no-explicit-any
    consume(): any {
        throw new Error('not implemented');
    }
    // eslint-disable-next-line typescript/no-explicit-any
    reserve(): any {
        throw new Error('not implemented');
    }
    // eslint-disable-next-line typescript/no-explicit-any
    commitReservation(): any {
        throw new Error('not implemented');
    }
    // eslint-disable-next-line typescript/no-explicit-any
    cancelReservation(): any {
        throw new Error('not implemented');
    }
    // eslint-disable-next-line typescript/no-explicit-any
    wrap(): any {
        throw new Error('not implemented');
    }

    cleanup(): void {}

    getReservation(): undefined {
        return undefined;
    }
}

class FakeLimiterA extends FakeRateLimiter {
    readonly config: { name: string } = { name: 'limiter-a' };
    cleaned: boolean = false;

    override cleanup(): void {
        this.cleaned = true;
    }
}

class FakeLimiterB extends FakeRateLimiter {
    readonly config: { name: string } = { name: 'limiter-b' };
    cleaned: boolean = false;

    override cleanup(): void {
        this.cleaned = true;
    }
}

class FakeLimiterDuplicate1 extends FakeRateLimiter {
    readonly config: { name: string } = { name: 'clashing-name' };
}

class FakeLimiterDuplicate2 extends FakeRateLimiter {
    readonly config: { name: string } = { name: 'clashing-name' };
}

class FakeLimiterDuplicate3 extends FakeRateLimiter {
    readonly config: { name: string } = { name: 'clashing-name' };
}

class UndecoratedFakeLimiter extends FakeRateLimiter {
    readonly config: { name: string } = { name: 'undecorated' };
}

describe('RateLimitingService (via a real app boot)', () => {
    let server: StartedTestServer;

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    it('collects every class registered with @RateLimiter(), runs their cleanup, and schedules the cleanup cron job', async () => {
        const providers: DiProvider<unknown>[] = [
            ...defaultTestServerProviders,
            { token: FakeLimiterA, useClass: FakeLimiterA, variants: [DiVariants.RATE_LIMITER] },
            { token: FakeLimiterB, useClass: FakeLimiterB, variants: [DiVariants.RATE_LIMITER] },
            // The default test CronService is a no-op stub (its `schedule` never
            // actually records anything) - swap in the real implementation so
            // the cron job registration below can be observed.
            { token: ZIBRI_DI_TOKENS.CRON_SERVICE, useClass: CronService }
        ];

        server = await startTestServer({ providers });

        const rateLimitingService: RateLimitingServiceInterface = inject(ZIBRI_DI_TOKENS.RATE_LIMITING_SERVICE);
        expect(rateLimitingService.limiters.map(l => l.config.name).sort()).toEqual(
            expect.arrayContaining(['limiter-a', 'limiter-b'])
        );

        const cronService: CronServiceInterface = inject(ZIBRI_DI_TOKENS.CRON_SERVICE);
        expect(cronService.cronJobs.some((job: CronJob) => job.name === 'RateLimitingCleanupCronJob')).toBe(true);

        const limiterA: FakeLimiterA = inject(FakeLimiterA);
        const limiterB: FakeLimiterB = inject(FakeLimiterB);
        await rateLimitingService.cleanup();
        expect(limiterA.cleaned).toBe(true);
        expect(limiterB.cleaned).toBe(true);
    }, 30000);

    it('rejects app startup when a class structurally implements RateLimiterInterface but is missing @RateLimiter()', async () => {
        const providers: DiProvider<unknown>[] = [
            ...defaultTestServerProviders,
            { token: UndecoratedFakeLimiter, useClass: UndecoratedFakeLimiter, variants: [] }
        ];

        await expect(server.reInit({ providers })).rejects.toThrow(
            'seems to be a rate limiter but has not been decorated with @RateLimiter()'
        );
    }, 30000);

    it('rejects app startup when two different limiter classes share the same config.name', async () => {
        const providers: DiProvider<unknown>[] = [
            ...defaultTestServerProviders,
            { token: FakeLimiterDuplicate1, useClass: FakeLimiterDuplicate1, variants: [DiVariants.RATE_LIMITER] },
            { token: FakeLimiterDuplicate2, useClass: FakeLimiterDuplicate2, variants: [DiVariants.RATE_LIMITER] }
        ];

        await expect(server.reInit({ providers })).rejects.toThrow('There are duplicate rate limiter names');
    }, 30000);

    it('lists each duplicate name only once in the error, no matter how many limiters clash', async () => {
        const providers: DiProvider<unknown>[] = [
            ...defaultTestServerProviders,
            { token: FakeLimiterDuplicate1, useClass: FakeLimiterDuplicate1, variants: [DiVariants.RATE_LIMITER] },
            { token: FakeLimiterDuplicate2, useClass: FakeLimiterDuplicate2, variants: [DiVariants.RATE_LIMITER] },
            { token: FakeLimiterDuplicate3, useClass: FakeLimiterDuplicate3, variants: [DiVariants.RATE_LIMITER] }
        ];

        let thrown: Error | undefined;
        try {
            await server.reInit({ providers });
        }
        catch (error) {
            thrown = error as Error;
        }

        expect(thrown).toBeDefined();
        const occurrences: number = (thrown?.message.split('- clashing-name').length ?? 1) - 1;
        expect(occurrences).toBe(1);
    }, 30000);
});