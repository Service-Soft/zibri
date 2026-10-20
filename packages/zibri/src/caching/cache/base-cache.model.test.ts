import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { WriteThroughReadThroughCache } from './read-through/write-through-read-through.cache.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { Inject } from '../../di/decorators/inject.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../di/inject.function.ts';
import { type LoggerInterface } from '../../logging/logger.interface.ts';
import { type MetricsServiceInterface } from '../../metrics/metrics-service.interface.ts';
import { type CacheServiceInterface } from '../cache-service.interface.ts';
import { CacheService } from '../cache.service.ts';
import { Cache } from '../decorators/cache.decorator.ts';
import { CachedValue } from '../store/cached-value.model.ts';
import { InMemoryCacheStore } from '../store/in-memory.cache-store.ts';

@Cache()
class BestEffortCache extends WriteThroughReadThroughCache<string, string, 'Base Cache Best Effort Cache'> {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        protected readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.METRICS_SERVICE)
        protected readonly metricsService: MetricsServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.CACHE_SERVICE)
        protected readonly cacheService: CacheServiceInterface
    ) {
        super('Base Cache Best Effort Cache', new InMemoryCacheStore(), 'all', undefined, 'bestEffort');
    }
}

@Cache()
class ThrowingCache extends WriteThroughReadThroughCache<string, string, 'Base Cache Throwing Cache'> {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        protected readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.METRICS_SERVICE)
        protected readonly metricsService: MetricsServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.CACHE_SERVICE)
        protected readonly cacheService: CacheServiceInterface
    ) {
        super('Base Cache Throwing Cache', new InMemoryCacheStore(), 'all', undefined, 'throw');
    }
}

function createCachedValue<V>(value: V, tags: string[]): CachedValue<V> {
    return { value, tags, createdAt: new Date() };
}

describe('BaseCache', () => {
    let server: StartedTestServer;
    let cacheService: CacheService;

    beforeAll(async () => {
        server = await startTestServer({});
        cacheService = inject(ZIBRI_DI_TOKENS.CACHE_SERVICE) as CacheService;
    }, 30000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    beforeEach(async () => {
        cacheService.caches.length = 0;
        await inject(BestEffortCache).store.clear();
        await inject(ThrowingCache).store.clear();
    });

    describe('onInvalidationFailure', () => {
        it('"bestEffort" (default) logs a warning and does not throw when invalidation fails', async () => {
            const cache: BestEffortCache = inject(BestEffortCache);
            // eslint-disable-next-line typescript-js/typedef
            const invalidateSpy = vi.spyOn(cacheService, 'invalidateTags').mockRejectedValue(new Error('invalidation backend down'));
            // eslint-disable-next-line typescript-js/typedef
            const warnSpy = vi.spyOn(cache['logger'], 'warn');

            try {
                // eslint-disable-next-line typescript-js/typedef
                const fn = vi.fn((id: string): string => `value:${id}`);
                // eslint-disable-next-line typescript-js/typedef
                const wrapped = cache.wrapInvalidate(fn, { invalidatesTags: ['some-tag'] });

                await expect(wrapped('a')).resolves.toBe('value:a');
                expect(warnSpy).toHaveBeenCalledWith(
                    'Cache invalidation failed, stale data may be served',
                    expect.objectContaining({ error: expect.any(Error) })
                );
            }
            finally {
                invalidateSpy.mockRestore();
            }
        });

        it('"throw" rethrows when invalidation fails', async () => {
            const cache: ThrowingCache = inject(ThrowingCache);
            // eslint-disable-next-line typescript-js/typedef
            const invalidateSpy = vi.spyOn(cacheService, 'invalidateTags').mockRejectedValue(new Error('invalidation backend down'));

            try {
                // eslint-disable-next-line typescript-js/typedef
                const fn = vi.fn((id: string): string => `value:${id}`);
                // eslint-disable-next-line typescript-js/typedef
                const wrapped = cache.wrapInvalidate(fn, { invalidatesTags: ['some-tag'] });

                await expect(wrapped('a')).rejects.toThrow('invalidation backend down');
                // the source fn still ran even though invalidation later failed
                expect(fn).toHaveBeenCalledWith('a');
            }
            finally {
                invalidateSpy.mockRestore();
            }
        });

        it('does not invalidate or fail when no tags are resolved', async () => {
            const cache: BestEffortCache = inject(BestEffortCache);
            // eslint-disable-next-line typescript-js/typedef
            const invalidateSpy = vi.spyOn(cacheService, 'invalidateTags');

            // eslint-disable-next-line typescript-js/typedef
            const fn = vi.fn((id: string): string => `value:${id}`);
            // eslint-disable-next-line typescript-js/typedef
            const wrapped = cache.wrapInvalidate(fn, { invalidatesTags: [] });

            await expect(wrapped('a')).resolves.toBe('value:a');
            expect(invalidateSpy).not.toHaveBeenCalled();
        });
    });

    describe('wrapDelete', () => {
        it('resolves and logs a warning if the store delete fails, without affecting tag invalidation', async () => {
            const cache: BestEffortCache = inject(BestEffortCache);
            await cache.store.set('key:a', createCachedValue('value', ['own']));

            // eslint-disable-next-line typescript-js/typedef
            const deleteSpy = vi.spyOn(cache.store, 'delete').mockImplementation(() => {
                throw new Error('store unavailable');
            });
            // eslint-disable-next-line typescript-js/typedef
            const warnSpy = vi.spyOn(cache['logger'], 'warn');

            try {
                // eslint-disable-next-line typescript-js/typedef, no-unused-vars
                const fn = vi.fn((_id: string): undefined => undefined);
                // eslint-disable-next-line typescript-js/typedef
                const wrapped = cache.wrapDelete(fn, (id) => `key:${id}`);

                await expect(wrapped('a')).resolves.toBeUndefined();
                expect(warnSpy).toHaveBeenCalledWith(
                    'Cache deletion failed after successful source delete',
                    expect.objectContaining({ error: expect.any(Error) })
                );
            }
            finally {
                deleteSpy.mockRestore();
            }
        });
    });

    describe('updateSizeGauge', () => {
        it('never surfaces a failure from store.size()', async () => {
            const cache: BestEffortCache = inject(BestEffortCache);
            // eslint-disable-next-line typescript-js/typedef
            const sizeSpy = vi.spyOn(cache.store, 'size').mockImplementation(() => {
                throw new Error('size unavailable');
            });

            try {
                // eslint-disable-next-line typescript-js/typedef
                const fn = (id: string): string => `value:${id}`;
                // eslint-disable-next-line typescript-js/typedef
                const wrapped = cache.wrap(fn, (id) => `key:${id}`);

                await expect(wrapped('a')).resolves.toBe('value:a');
            }
            finally {
                sizeSpy.mockRestore();
            }
        });
    });
});