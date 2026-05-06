import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { WriteThroughReadThroughCache } from './write-through-read-through.cache';
import { flushMicrotasks } from '../../../__testing__/constants';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { Inject } from '../../../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { type LoggerInterface } from '../../../logging/logger.interface';
import { type MetricsServiceInterface } from '../../../metrics/metrics-service.interface';
import { Ms } from '../../../utilities/ms';
import { type CacheServiceInterface } from '../../cache-service.interface';
import { CacheService } from '../../cache.service';
import { Cache } from '../../decorators/cache.decorator';
import { CachedValue } from '../../store/cached-value.model';
import { InMemoryCacheStore } from '../../store/in-memory.cache-store';

@Cache()
class TestCache extends WriteThroughReadThroughCache<string, number, 'Test Cache'> {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        protected readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.METRICS_SERVICE)
        protected readonly metricsService: MetricsServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.CACHE_SERVICE)
        protected readonly cacheService: CacheServiceInterface
    ) {
        super('Test Cache', new InMemoryCacheStore(), 'all');
    }
}

@Cache()
class MinuteTtlTestCache extends WriteThroughReadThroughCache<string, number, 'Minute TTL Test Cache'> {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        protected readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.METRICS_SERVICE)
        protected readonly metricsService: MetricsServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.CACHE_SERVICE)
        protected readonly cacheService: CacheServiceInterface
    ) {
        super('Minute TTL Test Cache', new InMemoryCacheStore(), 'all', Ms.MINUTE);
    }
}

@Cache()
class MinuteTtlIdTestCache extends WriteThroughReadThroughCache<string, { id: string }, 'Minute TTL Id Test Cache'> {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        protected readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.METRICS_SERVICE)
        protected readonly metricsService: MetricsServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.CACHE_SERVICE)
        protected readonly cacheService: CacheServiceInterface
    ) {
        super('Minute TTL Id Test Cache', new InMemoryCacheStore(), 'all', Ms.MINUTE);
    }
}

@Cache()
class MainCacheTestCache extends WriteThroughReadThroughCache<string, { id: string }, 'Main Cache Test Cache'> {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        protected readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.METRICS_SERVICE)
        protected readonly metricsService: MetricsServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.CACHE_SERVICE)
        protected readonly cacheService: CacheServiceInterface
    ) {
        super('Main Cache Test Cache', new InMemoryCacheStore(), 'all');
    }
}

@Cache()
class AffectedCache1TestCache extends WriteThroughReadThroughCache<string, string, 'Affected Cache 1 Test Cache'> {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        protected readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.METRICS_SERVICE)
        protected readonly metricsService: MetricsServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.CACHE_SERVICE)
        protected readonly cacheService: CacheServiceInterface
    ) {
        super('Affected Cache 1 Test Cache', new InMemoryCacheStore(), ['invalidate-me']);
    }
}

@Cache()
class UnaffectedCache1TestCache extends WriteThroughReadThroughCache<string, string, 'Unaffected Cache 1 Test Cache'> {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        protected readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.METRICS_SERVICE)
        protected readonly metricsService: MetricsServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.CACHE_SERVICE)
        protected readonly cacheService: CacheServiceInterface
    ) {
        super('Unaffected Cache 1 Test Cache', new InMemoryCacheStore(), ['leave-me']);
    }
}

@Cache()
class OwnCacheTestCache extends WriteThroughReadThroughCache<string, void, 'Own Cache Test Cache'> {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        protected readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.METRICS_SERVICE)
        protected readonly metricsService: MetricsServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.CACHE_SERVICE)
        protected readonly cacheService: CacheServiceInterface
    ) {
        super('Own Cache Test Cache', new InMemoryCacheStore(), 'all');
    }
}

@Cache()
class UnaffectedCache2TestCache extends WriteThroughReadThroughCache<string, string, 'Unaffected Cache 2 Test Cache'> {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        protected readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.METRICS_SERVICE)
        protected readonly metricsService: MetricsServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.CACHE_SERVICE)
        protected readonly cacheService: CacheServiceInterface
    ) {
        super('Unaffected Cache 2 Test Cache', new InMemoryCacheStore(), ['keep-me']);
    }
}

@Cache()
class AbcCacheTestCache extends WriteThroughReadThroughCache<string, string, 'Abc Cache Test Cache'> {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        protected readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.METRICS_SERVICE)
        protected readonly metricsService: MetricsServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.CACHE_SERVICE)
        protected readonly cacheService: CacheServiceInterface
    ) {
        super('Abc Cache Test Cache', new InMemoryCacheStore(), ['tag:abc']);
    }
}

function createCachedValue<V>(
    value: V,
    tags: string[],
    createdAt: Date,
    expiresAt?: Date
): CachedValue<V> {
    return {
        value,
        tags,
        createdAt,
        expiresAt
    };
}

describe('WriteThroughReadThroughCache', () => {
    let server: StartedTestServer;
    let cacheService: CacheService;

    beforeAll(async () => {
        server = await startTestServer({});
        cacheService = inject(ZIBRI_DI_TOKENS.CACHE_SERVICE) as CacheService;
    }, 15000);

    afterAll(async () => {
        await server?.shutdown();
    });

    beforeEach(() => {
        cacheService.caches.length = 0;
    });

    afterEach(async () => {
        await inject(TestCache).store.clear();
        await inject(MinuteTtlIdTestCache).store.clear();
        await inject(MinuteTtlTestCache).store.clear();
        await inject(MainCacheTestCache).store.clear();
        await inject(AffectedCache1TestCache).store.clear();
        await inject(UnaffectedCache1TestCache).store.clear();
        await inject(OwnCacheTestCache).store.clear();
        await inject(UnaffectedCache2TestCache).store.clear();
    });

    it('wrap returns a cached value without calling fn', async () => {
        const cache: WriteThroughReadThroughCache<string, number, string> = inject(TestCache);
        await cache.store.set('key:a', createCachedValue(123, ['tag-a'], new Date()));

        // eslint-disable-next-line typescript/typedef, unusedImports/no-unused-vars
        const fn = jest.fn((_id: string): number => 999);
        // eslint-disable-next-line typescript/typedef
        const wrapped = cache.wrap(fn, (id) => `key:${id}`);

        await expect(wrapped('a')).resolves.toBe(123);
        expect(fn).not.toHaveBeenCalled();
    });

    it('wrap deletes expired cached values and recomputes', async () => {
        const cache: WriteThroughReadThroughCache<string, number, string> = inject(TestCache);

        await cache.store.set(
            'key:a',
            createCachedValue(123, ['tag-a'], new Date('2025-01-01T00:00:00.000Z'), new Date('2025-01-01T00:00:01.000Z'))
        );

        // eslint-disable-next-line typescript/typedef
        const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(new Date('2025-01-01T00:00:02.000Z').getTime());
        // eslint-disable-next-line typescript/typedef, unusedImports/no-unused-vars
        const fn = jest.fn((_id: string): number => 999);
        // eslint-disable-next-line typescript/typedef
        const wrapped = cache.wrap(fn, (id) => `key:${id}`);

        await expect(wrapped('a')).resolves.toBe(999);

        expect(fn).toHaveBeenCalledTimes(1);
        expect((await cache.store.get('key:a'))?.value).toBe(999);

        nowSpy.mockRestore();
    });

    it('wrap stores a miss with resolved tags and default ttl', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));

        try {
            const cache: MinuteTtlIdTestCache = inject(MinuteTtlIdTestCache);

            // eslint-disable-next-line typescript/typedef
            const fn = (name: string): { id: string } => ({ id: `id:${name}` });
            // eslint-disable-next-line typescript/typedef
            const wrapped = cache.wrap(
                fn,
                (name) => `key:${name}`,
                {
                    tags: (result, name) => [`tag:${result.id}`, `name:${name}`]
                }
            );

            await expect(wrapped('abc')).resolves.toEqual({ id: 'id:abc' });

            const cached: CachedValue<{ id: string }> | undefined = await cache.store.get('key:abc');
            expect(cached).toBeDefined();
            expect(cached?.value).toEqual({ id: 'id:abc' });
            expect(cached?.tags).toEqual(['tag:id:abc', 'name:abc']);
            expect(cached?.createdAt).toEqual(new Date('2025-01-01T00:00:00.000Z'));
            expect(cached?.expiresAt).toEqual(new Date('2025-01-01T00:01:00.000Z'));
        }
        finally {
            jest.useRealTimers();
        }
    });

    it('wrap uses ttl from options over default ttl', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));

        try {
            const cache: MinuteTtlTestCache = inject(MinuteTtlTestCache);

            // eslint-disable-next-line typescript/typedef
            const fn = (id: string): number => id.length;
            // eslint-disable-next-line typescript/typedef
            const wrapped = cache.wrap(
                fn,
                (id) => `key:${id}`,
                {
                    ttl: Ms.SECOND * 5
                }
            );

            await expect(wrapped('abc')).resolves.toBe(3);

            const cached: CachedValue<number> | undefined = await cache.store.get('key:abc');
            expect(cached?.expiresAt).toEqual(new Date('2025-01-01T00:00:05.000Z'));
        }
        finally {
            jest.useRealTimers();
        }
    });

    it('wrapWrite invalidates matching caches and writes the result', async () => {
        const mainCache: MainCacheTestCache = inject(MainCacheTestCache);
        const affectedCache: AffectedCache1TestCache = inject(AffectedCache1TestCache);
        const unaffectedCache: UnaffectedCache1TestCache = inject(UnaffectedCache1TestCache);

        cacheService.caches.push(mainCache, affectedCache, unaffectedCache);

        await affectedCache.store.set('a1', createCachedValue('affected', ['invalidate-me'], new Date()));
        await unaffectedCache.store.set('b1', createCachedValue('safe', ['leave-me'], new Date()));

        // eslint-disable-next-line typescript/typedef
        const fn = (name: string): { id: string } => ({ id: `id:${name}` });
        // eslint-disable-next-line typescript/typedef
        const wrapped = mainCache.wrapWrite(
            fn,
            (result, name) => `${result.id}:${name}`,
            {
                invalidatesTags: ['invalidate-me'],
                tags: (result, name) => [`written:${result.id}`, `name:${name}`]
            }
        );

        await expect(wrapped('abc')).resolves.toEqual({ id: 'id:abc' });

        expect((await mainCache.store.get('id:abc:abc'))?.value).toEqual({ id: 'id:abc' });
        expect((await mainCache.store.get('id:abc:abc'))?.tags).toEqual(['written:id:abc', 'name:abc']);
        expect(await affectedCache.store.get('a1')).toBeUndefined();
        expect((await unaffectedCache.store.get('b1'))?.value).toBe('safe');
    });

    it('wrapWrite uses ttl from options over default ttl', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));

        try {
            const cache: MinuteTtlIdTestCache = inject(MinuteTtlIdTestCache);

            // eslint-disable-next-line typescript/typedef
            const fn = (name: string): { id: string } => ({ id: `id:${name}` });
            // eslint-disable-next-line typescript/typedef
            const wrapped = cache.wrapWrite(
                fn,
                (result, name) => `${result.id}:${name}`,
                {
                    ttl: (result, name) => result.id === `id:${name}` ? Ms.SECOND * 10 : Ms.SECOND
                }
            );

            await expect(wrapped('abc')).resolves.toEqual({ id: 'id:abc' });

            const cached: CachedValue<{ id: string }> | undefined = await cache.store.get('id:abc:abc');
            expect(cached?.expiresAt).toEqual(new Date('2025-01-01T00:00:10.000Z'));
        }
        finally {
            jest.useRealTimers();
        }
    });

    it('wrapDelete deletes its own key and invalidates matching caches', async () => {
        const cache: OwnCacheTestCache = inject(OwnCacheTestCache);
        const affectedCache: AffectedCache1TestCache = inject(AffectedCache1TestCache);
        const unaffectedCache: UnaffectedCache2TestCache = inject(UnaffectedCache2TestCache);

        cacheService.caches.push(cache, affectedCache, unaffectedCache);

        await cache.store.set('key:1', createCachedValue(undefined, ['own'], new Date()));
        await affectedCache.store.set('a1', createCachedValue('affected', ['invalidate-me'], new Date()));
        await unaffectedCache.store.set('b1', createCachedValue('safe', ['keep-me'], new Date()));

        // eslint-disable-next-line typescript/typedef, unusedImports/no-unused-vars
        const fn = jest.fn((_id: string): undefined => undefined);
        // eslint-disable-next-line typescript/typedef
        const wrapped = cache.wrapDelete(
            fn,
            (id: string) => `key:${id}`,
            {
                invalidatesTags: ['invalidate-me']
            }
        );

        await expect(wrapped('1')).resolves.toBeUndefined();

        expect(fn).toHaveBeenCalledWith('1');
        expect(await cache.store.get('key:1')).toBeUndefined();
        expect(await affectedCache.store.get('a1')).toBeUndefined();
        expect((await unaffectedCache.store.get('b1'))?.value).toBe('safe');
    });

    it('wrapInvalidate calls fn and then invalidates tags', async () => {
        const cache: TestCache = inject(TestCache);
        const affectedCache: AffectedCache1TestCache = inject(AffectedCache1TestCache);

        cacheService.caches.push(cache, affectedCache);

        await affectedCache.store.set('a1', createCachedValue('affected', ['invalidate-me'], new Date()));

        // eslint-disable-next-line typescript/typedef
        const fn = jest.fn((id: string): number => id.length);
        // eslint-disable-next-line typescript/typedef
        const wrapped = cache.wrapInvalidate(fn, { invalidatesTags: ['invalidate-me'] });

        await expect(wrapped('abc')).resolves.toBe(3);

        expect(fn).toHaveBeenCalledWith('abc');
        expect(await affectedCache.store.get('a1')).toBeUndefined();
    });

    it('wrapInvalidate supports tag providers based on args', async () => {
        const cache: TestCache = inject(TestCache);

        const affectedCache: AbcCacheTestCache = inject(AbcCacheTestCache);
        cacheService.caches.push(cache, affectedCache);

        await affectedCache.store.set('a1', createCachedValue('affected', ['tag:abc'], new Date()));

        // eslint-disable-next-line typescript/typedef
        const fn = (id: string): number => id.length;
        // eslint-disable-next-line typescript/typedef
        const wrapped = cache.wrapInvalidate(fn, { invalidatesTags: (id: string) => [`tag:${id}`] });

        await expect(wrapped('abc')).resolves.toBe(3);

        expect(await affectedCache.store.get('a1')).toBeUndefined();
    });

    it('dedupes concurrent wrap calls for the same key', async () => {
        const cache: WriteThroughReadThroughCache<string, number, string> = inject(TestCache);

        let resolveFn!: (value: number) => void;
        // eslint-disable-next-line typescript/typedef, unusedImports/no-unused-vars
        const fn = jest.fn((_id: string) => new Promise<number>(resolve => {
            resolveFn = resolve;
        }));

        // eslint-disable-next-line typescript/typedef
        const wrapped = cache.wrap(fn, (id) => `key:${id}`);
        // eslint-disable-next-line typescript/typedef
        const first = wrapped('a');
        // eslint-disable-next-line typescript/typedef
        const second = wrapped('a');

        await flushMicrotasks();

        expect(fn).toHaveBeenCalledTimes(1);

        resolveFn(123);

        await expect(first).resolves.toBe(123);
        await expect(second).resolves.toBe(123);
        expect((await cache.store.get('key:a'))?.value).toBe(123);
    });

    it('does not dedupe concurrent wrap calls for different keys', async () => {
        const cache: WriteThroughReadThroughCache<string, number, string> = inject(TestCache);

        let resolveA!: (value: number) => void;
        let resolveB!: (value: number) => void;

        // eslint-disable-next-line typescript/typedef
        const fn = jest.fn((id: string) => new Promise<number>(resolve => {
            if (id === 'a') {
                resolveA = resolve;
                return;
            }

            resolveB = resolve;
        }));

        // eslint-disable-next-line typescript/typedef
        const wrapped = cache.wrap(fn, (id: string) => `key:${id}`);
        // eslint-disable-next-line typescript/typedef
        const first = wrapped('a');
        // eslint-disable-next-line typescript/typedef
        const second = wrapped('b');

        await flushMicrotasks();

        expect(fn).toHaveBeenCalledTimes(2);

        resolveA(1);
        resolveB(2);

        await expect(first).resolves.toBe(1);
        await expect(second).resolves.toBe(2);

        expect((await cache.store.get('key:a'))?.value).toBe(1);
        expect((await cache.store.get('key:b'))?.value).toBe(2);
    });

    it('clears the in-flight entry after a rejected wrap call', async () => {
        const cache: WriteThroughReadThroughCache<string, number, string> = inject(TestCache);

        // eslint-disable-next-line typescript/typedef, unusedImports/no-unused-vars
        const fn = jest.fn((_id: string): number => {
            throw new Error('boom');
        });

        // eslint-disable-next-line typescript/typedef
        const wrapped = cache.wrap(fn, (id) => `key:${id}`);

        await expect(wrapped('a')).rejects.toThrow('boom');
        await expect(wrapped('a')).rejects.toThrow('boom');

        expect(fn).toHaveBeenCalledTimes(2);
    });

    it('returns cached values immediately after the first concurrent wrap completes', async () => {
        const cache: WriteThroughReadThroughCache<string, number, string> = inject(TestCache);

        let resolveFn!: (value: number) => void;
        // eslint-disable-next-line typescript/typedef, unusedImports/no-unused-vars
        const fn = jest.fn((_id: string) => new Promise<number>(resolve => {
            resolveFn = resolve;
        }));

        // eslint-disable-next-line typescript/typedef
        const wrapped = cache.wrap(fn, (id) => `key:${id}`);
        // eslint-disable-next-line typescript/typedef
        const first = wrapped('a');
        // eslint-disable-next-line typescript/typedef
        const second = wrapped('a');

        await flushMicrotasks();

        resolveFn(123);

        await expect(first).resolves.toBe(123);
        await expect(second).resolves.toBe(123);

        // eslint-disable-next-line typescript/typedef
        const third = wrapped('a');

        await flushMicrotasks();

        await expect(third).resolves.toBe(123);

        expect(fn).toHaveBeenCalledTimes(1);
    });
});