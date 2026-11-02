import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';

import { MultiTierCache } from './multi-tier.cache';
import { TestTimeouts } from '../../__testing__/constants';
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
// Two simple tiers of WriteThroughReadThrough caches.
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
// The multi‑tier cache that will be tested, uses the FastCache and SlowCache from above.
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

/**
 * The key an ordinary key provider builds: derived from the arguments, and a new object every call.
 */
type ObjectKey = {
    /** Who the value belongs to. */
    userId: string,
    /** Which tenant they were read for. */
    tenantId: string
};

@Cache()
class ObjectKeyTierCache extends WriteThroughReadThroughCache<ObjectKey, number, 'ObjectKeyTier'> {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        protected readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.CACHE_SERVICE)
        protected readonly cacheService: CacheServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.METRICS_SERVICE)
        protected readonly metricsService: MetricsServiceInterface
    ) {
        super('ObjectKeyTier', new InMemoryCacheStore(), []);
    }
}

@Cache()
class ObjectKeyMultiTierCache extends MultiTierCache<ObjectKey, number, [ObjectKeyTierCache]> {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        protected readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.METRICS_SERVICE)
        protected readonly metricsService: MetricsServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.CACHE_SERVICE)
        protected readonly cacheService: CacheServiceInterface,
        @Inject(ObjectKeyTierCache)
        tier: ObjectKeyTierCache
    ) {
        super('ObjectKeyMulti', [tier]);
    }
}

/**
 * The tag the tier below declares, and the one invalidation is asked for.
 */
const CACHE_TAG: 'tagged-user' = 'tagged-user';

@Cache()
class TaggedTierCache extends WriteThroughReadThroughCache<string, number, 'TaggedTierCache', 'tagged-user'> {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        protected readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.CACHE_SERVICE)
        protected readonly cacheService: CacheServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.METRICS_SERVICE)
        protected readonly metricsService: MetricsServiceInterface
    ) {
        super('TaggedTierCache', new InMemoryCacheStore(), [CACHE_TAG]);
    }
}

@Cache()
class TaggedMultiTierCache extends MultiTierCache<string, number, [TaggedTierCache], 'tagged-user'> {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        protected readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.METRICS_SERVICE)
        protected readonly metricsService: MetricsServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.CACHE_SERVICE)
        protected readonly cacheService: CacheServiceInterface,
        @Inject(TaggedTierCache)
        tier: TaggedTierCache
    ) {
        super('TaggedMulti', [tier]);
    }
}

describe('MultiTierCache basic integration', () => {
    let server: StartedTestServer;

    beforeAll(async () => {
        server = await startTestServer({});
    }, TestTimeouts.postgres.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.postgres.shutdown);

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

        const first: number = await wrapped('alpha');
        expect(first).toBe(42);
        expect(fn).toHaveBeenCalledTimes(1);

        // both tiers now contain the value
        expect(await fast.store.get('alpha')).toHaveProperty('value', 42);
        expect(await slow.store.get('alpha')).toHaveProperty('value', 42);

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
            (res, name) => `user:${name}:${res}`,
            {
                perCache: {
                    // fast tier: 10‑second TTL
                    Fast: { ttlInMs: 10_000 },
                    // slow tier: 60‑second TTL
                    Slow: { ttlInMs: 60_000 }
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

    // a hot key expiring would otherwise send every concurrent request to the origin at once: the
    // stampede the single tier caches guard against
    it('runs the origin once when several callers miss the same key at the same time', async () => {
        const cache: TestMultiTierCache = inject(TestMultiTierCache);
        let originCalls: number = 0;

        const cached: () => Promise<number> = cache.wrap(
            async () => {
                originCalls++;
                // long enough that all three callers are inside the miss path together
                await new Promise<void>(resolve => setTimeout(resolve, 50));
                return 42;
            },
            () => 'single-flight-key'
        );

        expect(await Promise.all([cached(), cached(), cached()])).toEqual([42, 42, 42]);
        expect(originCalls).toBe(1);
    });

    // a counter declared and never incremented reads a permanent zero, which is worse than having no
    // dashboard because it looks like an answer
    it('counts the hits and misses it declares counters for', async () => {
        const cache: TestMultiTierCache = inject(TestMultiTierCache);
        const metrics: MetricsServiceInterface = inject(ZIBRI_DI_TOKENS.METRICS_SERVICE);

        /**
         * Reads a counter of this cache as it stands right now. Counters are cumulative and the cache
         * is used by the cases above, so what can be asserted is what this case's two calls added.
         * @param name - The counter to read.
         * @returns Its current value, or zero while it has no sample yet.
         */
        async function counter(name: string): Promise<number> {
            await metrics.collect();
            // the snapshots are a history, so only the last one is now
            return metrics.getMetricSnapshots().at(-1)?.metrics
                .find(m => m.name === name && m.labels['cache'] === 'TestMulti')
                ?.value ?? 0;
        }
        const missesBefore: number = await counter('cache_misses_total');
        const hitsBefore: number = await counter('cache_hits_total');

        const cached: () => Promise<number> = cache.wrap(() => 1, () => 'metrics-key');
        await cached();
        await cached();

        expect(await counter('cache_misses_total') - missesBefore).toBe(1);
        expect(await counter('cache_hits_total') - hitsBefore).toBe(1);
    });

    // a key built from arguments is a new object every call: keyed by reference, two calls for the
    // same thing would be two keys, coalescing nothing and never hitting
    it('coalesces and hits under an equal object key, however often the key is built anew', async () => {
        const cache: ObjectKeyMultiTierCache = inject(ObjectKeyMultiTierCache);
        let originCalls: number = 0;

        const cached: () => Promise<number> = cache.wrap(
            async () => {
                originCalls++;
                await new Promise<void>(resolve => setTimeout(resolve, 50));
                return 42;
            },
            () => ({ userId: 'u1', tenantId: 't1' })
        );

        await Promise.all([cached(), cached(), cached()]);
        expect(originCalls).toBe(1);
        expect(await cached()).toBe(42);
        expect(originCalls).toBe(1);
    });

    it('re-reads from the origin after the tag its value was stored under is invalidated', async () => {
        const cache: TaggedMultiTierCache = inject(TaggedMultiTierCache);
        let originCalls: number = 0;

        const cached: () => Promise<number> = cache.wrap(
            () => {
                originCalls++;
                return originCalls;
            },
            () => 'tagged-key',
            { TaggedTierCache: { tags: () => [CACHE_TAG] } }
        );
        expect(await cached()).toBe(1);
        // the control: without it the assertion below would pass on a cache that never stored anything
        expect(await cached()).toBe(1);

        await inject<CacheServiceInterface>(ZIBRI_DI_TOKENS.CACHE_SERVICE).invalidateTags([CACHE_TAG]);

        // a permissions change invalidating 'user' would otherwise leave every replica serving the
        // old permissions until the ttl runs out
        expect(await cached()).toBe(2);
    });
});