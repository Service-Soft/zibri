import { beforeAll, describe, expect, it, jest } from '@jest/globals';

import { RateLimited } from './rate-limited.decorator';
import { RateLimiter } from './rate-limiter.decorator';
import { initDiContainer } from '../../di/init-di-container.function';
import { inject } from '../../di/inject.function';
import { TooManyRequestsError } from '../../error-handling/errors/too-many-requests.error';
import { GlobalRegistry } from '../../global/global-registry';
import { Ms } from '../../utilities/ms';
import { TokenBucketRateLimiter, TokenBucketState } from '../limiter/token-bucket.rate-limiter';
import { InMemoryRateLimiterStore } from '../stores/in-memory.rate-limiter-store';

@RateLimiter()
class GenerousDecoratorTestLimiter extends TokenBucketRateLimiter {
    constructor() {
        super(Ms.SECOND, {
            name: 'generous-decorator-test-limiter',
            capacity: 1000,
            store: new InMemoryRateLimiterStore<TokenBucketState>(),
            maxReservationWaitMs: undefined
        });
    }
}

@RateLimiter()
class StrictDecoratorTestLimiter extends TokenBucketRateLimiter {
    constructor() {
        super(Ms.SECOND, {
            name: 'strict-decorator-test-limiter',
            capacity: 1,
            store: new InMemoryRateLimiterStore<TokenBucketState>(),
            maxReservationWaitMs: undefined
        });
    }
}

class GenerousController {
    callCount: number = 0;

    @RateLimited(GenerousDecoratorTestLimiter)
    // eslint-disable-next-line typescript/require-await
    async doWork(label: string): Promise<string> {
        this.callCount++;
        return `${label}-${this.callCount}`;
    }
}

class StrictController {
    @RateLimited(StrictDecoratorTestLimiter, { keyFn: () => 'strict-controller-key' })
    // eslint-disable-next-line typescript/require-await
    async doWork(): Promise<string> {
        return 'ok';
    }
}

class DynamicTokenController {
    @RateLimited(() => GenerousDecoratorTestLimiter, { keyFn: () => 'dynamic-token-key' })
    // eslint-disable-next-line typescript/require-await
    async doWork(): Promise<string> {
        return 'dynamic-ok';
    }
}

describe('RateLimited decorator', () => {
    beforeAll(() => {
        initDiContainer();
        GlobalRegistry.markAppAsCreated();
    });

    it('wraps the method so it still executes with the correct result and `this` binding', async () => {
        const controller: GenerousController = new GenerousController();
        const result: string = await controller.doWork('call');
        expect(result).toBe('call-1');
        expect(controller.callCount).toBe(1);
    });

    it('reuses the same wrapped function across repeated calls on the same instance', async () => {
        const limiter: GenerousDecoratorTestLimiter = inject(GenerousDecoratorTestLimiter);
        const wrapSpy: jest.Spied<typeof limiter.wrap> = jest.spyOn(limiter, 'wrap');
        wrapSpy.mockClear();

        const controller: GenerousController = new GenerousController();
        await controller.doWork('a');
        await controller.doWork('b');
        await controller.doWork('c');

        expect(wrapSpy).toHaveBeenCalledTimes(1);
        wrapSpy.mockRestore();
    });

    it('creates an independent wrapped function per instance', async () => {
        const limiter: GenerousDecoratorTestLimiter = inject(GenerousDecoratorTestLimiter);
        const wrapSpy: jest.Spied<typeof limiter.wrap> = jest.spyOn(limiter, 'wrap');
        wrapSpy.mockClear();

        const a: GenerousController = new GenerousController();
        const b: GenerousController = new GenerousController();
        await a.doWork('a');
        await b.doWork('b');

        expect(wrapSpy).toHaveBeenCalledTimes(2);
        wrapSpy.mockRestore();
    });

    it('resolves the limiter via a provider function that returns a DI token', async () => {
        const controller: DynamicTokenController = new DynamicTokenController();
        await expect(controller.doWork()).resolves.toBe('dynamic-ok');
    });

    it('propagates TooManyRequestsError once the underlying limiter is exhausted', async () => {
        const controller: StrictController = new StrictController();
        await expect(controller.doWork()).resolves.toBe('ok');
        await expect(controller.doWork()).rejects.toThrow(TooManyRequestsError);
    });
});