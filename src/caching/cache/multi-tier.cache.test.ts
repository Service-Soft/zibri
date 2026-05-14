import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';

import { MultiTierCache } from './multi-tier.cache';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { Inject } from '../../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { type LoggerInterface } from '../../logging/logger.interface';
import { type MetricsServiceInterface } from '../../metrics/metrics-service.interface';
import { type CacheServiceInterface } from '../cache-service.interface';
import { InMemoryCacheStore } from '../store/in-memory.cache-store';
import { WriteThroughReadThroughCache } from './read-through/write-through-read-through.cache';
import { Cache } from '../decorators/cache.decorator';
import { CachedValue } from '../store/cached-value.model';

// ---------------------------------------------------------------------------
// Two simple tiers – both are plain WriteThroughReadThrough caches.
// ---------------------------------------------------------------------------
@Cache()
class FastCache extends WriteThroughReadThroughCache<string, number, 'Fast'> {

    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        protected readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.METRICS_SERVICE)
        protected readonly metricsService: MetricsServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.CACHE_SERVICE)
        protected readonly cacheService: CacheServiceInterface
    ) {
        super('Fast', new InMemoryCacheStore(), 'all');
    }
}

@Cache()
class SlowCache extends WriteThroughReadThroughCache<string, number, 'Slow'> {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        protected readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.METRICS_SERVICE)
        protected readonly metricsService: MetricsServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.CACHE_SERVICE)
        protected readonly cacheService: CacheServiceInterface
    ) {
        super('Slow', new InMemoryCacheStore(), 'all');
    }
}

// ---------------------------------------------------------------------------
// The multi‑tier cache under test – it uses FastCache and SlowCache.
// ---------------------------------------------------------------------------
@Cache()
class TestMultiTierCache extends MultiTierCache<string, number, [FastCache, SlowCache]> {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        protected readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.METRICS_SERVICE)
        protected readonly metricsService: MetricsServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.CACHE_SERVICE)
        protected readonly cacheService: CacheServiceInterface,
        @Inject(FastCache)
        fast: FastCache,
        @Inject(SlowCache)
        slow: SlowCache
    ) {
        super('TestMulti', [fast, slow]);
    }
}

describe('MultiTierCache – basic integration', () => {
    let server: StartedTestServer;

    beforeAll(async () => {
        server = await startTestServer({});
    }, 15000);

    afterAll(async () => {
        await server?.shutdown();
    });

    // ------------------------------------------------------------------
    // 1. read through: miss populates both tiers, next call hits fast tier
    // ------------------------------------------------------------------
    it('populates both tiers on wrap miss and returns from fast tier on second call', async () => {
        const multi: TestMultiTierCache = inject(TestMultiTierCache);
        const fast: FastCache = inject(FastCache);
        const slow: SlowCache = inject(SlowCache);

        // eslint-disable-next-line typescript/typedef, unusedImports/no-unused-vars
        const fn = jest.fn((_key: string) => Promise.resolve(42));
        // eslint-disable-next-line typescript/typedef
        const wrapped = multi.wrap(fn, key => key);

        // first call – miss, fn is invoked
        const first: number = await wrapped('alpha');
        expect(first).toBe(42);
        expect(fn).toHaveBeenCalledTimes(1);

        // both tiers now contain the value
        expect(await fast.store.get('alpha')).toHaveProperty('value', 42);
        expect(await slow.store.get('alpha')).toHaveProperty('value', 42);

        // second call – hit (fast tier), fn is NOT called again
        const second: number = await wrapped('alpha');
        expect(second).toBe(42);
        expect(fn).toHaveBeenCalledTimes(1);
    });

    // ------------------------------------------------------------------
    // 2. write through: populate both tiers with per‑tier options
    // ------------------------------------------------------------------
    it('wrapWrite populates all tiers and honours per‑tier ttl', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

        const multi: TestMultiTierCache = inject(TestMultiTierCache);
        const fast: FastCache = inject(FastCache);
        const slow: SlowCache = inject(SlowCache);

        // eslint-disable-next-line typescript/typedef
        const fn = (name: string): Promise<number> => Promise.resolve(name.length);

        // eslint-disable-next-line typescript/typedef
        const wrapped = multi.wrapWrite(
            fn,
            // keyFn – key comes from result + args (WR = true because both tiers are true)
            (res, name) => `user:${name}:${res}`,
            {
                perCache: {
                    // fast tier: 10‑second TTL
                    Fast: { ttl: 10_000 },
                    // slow tier: 60‑second TTL
                    Slow: { ttl: 60_000 }
                }
            }
        );

        await expect(wrapped('Alice')).resolves.toBe(5);

        const fastEntry: CachedValue<number> | undefined = await fast.store.get('user:Alice:5');
        const slowEntry: CachedValue<number> | undefined = await slow.store.get('user:Alice:5');

        expect(fastEntry?.value).toBe(5);
        expect(fastEntry?.expiresAt).toEqual(new Date('2026-01-01T00:00:10.000Z'));

        expect(slowEntry?.value).toBe(5);
        expect(slowEntry?.expiresAt).toEqual(new Date('2026-01-01T00:01:00.000Z'));

        jest.useRealTimers();
    });
});