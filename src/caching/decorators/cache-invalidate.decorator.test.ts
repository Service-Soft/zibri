import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { CacheInvalidate } from './cache-invalidate.decorator';
import { Cache } from './cache.decorator';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { Inject } from '../../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { type LoggerInterface } from '../../logging/logger.interface';
import { type MetricsServiceInterface } from '../../metrics/metrics-service.interface';
import { WriteThroughReadThroughCache } from '../cache/read-through/write-through-read-through.cache';
import { type CacheServiceInterface } from '../cache-service.interface';
import { CacheService } from '../cache.service';
import { CachedValue } from '../store/cached-value.model';
import { InMemoryCacheStore } from '../store/in-memory.cache-store';

@Cache()
class InvalidateAffectedCache extends WriteThroughReadThroughCache<string, string, 'Cache Invalidate Decorator Affected Cache'> {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        protected readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.METRICS_SERVICE)
        protected readonly metricsService: MetricsServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.CACHE_SERVICE)
        protected readonly cacheService: CacheServiceInterface
    ) {
        super('Cache Invalidate Decorator Affected Cache', new InMemoryCacheStore(), ['invalidate-me']);
    }
}

class InvalidateService {
    @CacheInvalidate(InvalidateAffectedCache, { invalidatesTags: ['invalidate-me'] })
    // eslint-disable-next-line typescript/require-await
    async bulkUpdate(): Promise<string> {
        return 'done';
    }
}

function createCachedValue<V>(value: V, tags: string[]): CachedValue<V> {
    return { value, tags, createdAt: new Date() };
}

describe('CacheInvalidate decorator', () => {
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
        await inject(InvalidateAffectedCache).store.clear();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('invalidates matching tags after the decorated method runs', async () => {
        const affectedCache: InvalidateAffectedCache = inject(InvalidateAffectedCache);
        cacheService.caches.push(affectedCache);
        await affectedCache.store.set('a1', createCachedValue('affected', ['invalidate-me']));

        const service: InvalidateService = new InvalidateService();
        await expect(service.bulkUpdate()).resolves.toBe('done');

        expect(await affectedCache.store.get('a1')).toBeUndefined();
    });

    it('only builds the wrapped function once per instance', async () => {
        const cache: InvalidateAffectedCache = inject(InvalidateAffectedCache);
        // eslint-disable-next-line typescript/typedef
        const wrapInvalidateSpy = jest.spyOn(cache, 'wrapInvalidate');

        const service: InvalidateService = new InvalidateService();
        await service.bulkUpdate();
        await service.bulkUpdate();

        expect(wrapInvalidateSpy).toHaveBeenCalledTimes(1);
    });
});