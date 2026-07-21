import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { WriteInvalidateReadThroughArgsOnlyCache } from './write-invalidate-read-through-args-only.cache';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { Inject } from '../../../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { type LoggerInterface } from '../../../logging/logger.interface';
import { type MetricsServiceInterface } from '../../../metrics/metrics-service.interface';
import { type CacheServiceInterface } from '../../cache-service.interface';
import { CacheService } from '../../cache.service';
import { Cache } from '../../decorators/cache.decorator';
import { CachedValue } from '../../store/cached-value.model';
import { InMemoryCacheStore } from '../../store/in-memory.cache-store';

@Cache()
class MainCache extends WriteInvalidateReadThroughArgsOnlyCache<string, string, 'Write Invalidate Read Through Args Only Main Cache'> {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        protected readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.METRICS_SERVICE)
        protected readonly metricsService: MetricsServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.CACHE_SERVICE)
        protected readonly cacheService: CacheServiceInterface
    ) {
        super('Write Invalidate Read Through Args Only Main Cache', new InMemoryCacheStore(), 'all');
    }
}

@Cache()
class AffectedCache extends WriteInvalidateReadThroughArgsOnlyCache<string, string, 'Write Invalidate Read Through Args Only Affected Cache'> {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        protected readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.METRICS_SERVICE)
        protected readonly metricsService: MetricsServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.CACHE_SERVICE)
        protected readonly cacheService: CacheServiceInterface
    ) {
        super('Write Invalidate Read Through Args Only Affected Cache', new InMemoryCacheStore(), ['invalidate-me']);
    }
}

function createCachedValue<V>(value: V, tags: string[]): CachedValue<V> {
    return { value, tags, createdAt: new Date() };
}

describe('WriteInvalidateReadThroughArgsOnlyCache', () => {
    let server: StartedTestServer;
    let cacheService: CacheService;

    beforeAll(async () => {
        server = await startTestServer({});
        cacheService = inject(ZIBRI_DI_TOKENS.CACHE_SERVICE) as CacheService;
    }, 15000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    beforeEach(async () => {
        cacheService.caches.length = 0;
        await inject(MainCache).store.clear();
        await inject(AffectedCache).store.clear();
    });

    it('wrapWrite deletes the arg-derived key and invalidates matching caches in parallel', async () => {
        const mainCache: MainCache = inject(MainCache);
        const affectedCache: AffectedCache = inject(AffectedCache);
        cacheService.caches.push(mainCache, affectedCache);

        await mainCache.store.set('key:abc', createCachedValue('stale', ['own']));
        await affectedCache.store.set('a1', createCachedValue('affected', ['invalidate-me']));

        // eslint-disable-next-line typescript/typedef
        const fn = jest.fn((name: string): string => `written:${name}`);
        // eslint-disable-next-line typescript/typedef
        const wrapped = mainCache.wrapWrite(fn, (name) => `key:${name}`, { invalidatesTags: ['invalidate-me'] });

        await expect(wrapped('abc')).resolves.toBe('written:abc');

        expect(await mainCache.store.get('key:abc')).toBeUndefined();
        expect(await affectedCache.store.get('a1')).toBeUndefined();
    });

    it('setDirect deletes the given key', async () => {
        const cache: MainCache = inject(MainCache);
        await cache.store.set('key:abc', createCachedValue('stale', ['own']));

        await cache.setDirect('key:abc');

        expect(await cache.store.get('key:abc')).toBeUndefined();
    });
});