import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { MultiTierCache } from '../../caching/cache/multi-tier.cache';
import { WriteThroughReadThroughCache } from '../../caching/cache/read-through/write-through-read-through.cache';
import { type CacheServiceInterface } from '../../caching/cache-service.interface';
import { Cache } from '../../caching/decorators/cache.decorator';
import { CachedValue } from '../../caching/store/cached-value.model';
import { InMemoryCacheStore } from '../../caching/store/in-memory.cache-store';
import { ValKeyCacheStore } from '../../caching/store/val-key.cache-store';
import { PostgresDataSource } from '../../data-source/data-sources/postgres/postgres-typeorm-data-source.model';
import { ValKeyDataSource } from '../../data-source/data-sources/val-key/val-key-data-source.model';
import { Inject } from '../../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { type LoggerInterface } from '../../logging/logger.interface';
import { type MetricsServiceInterface } from '../../metrics/metrics-service.interface';
import { Newable } from '../../types/newable.type';
import { Bytes } from '../../utilities/bytes';
import { createTestDataSource } from '../test-server/create-test-data-source.function';
import { createTestValKeyDataSource } from '../test-server/create-test-val-key-data-source.function';
import { StartedTestServer, startTestServer } from '../test-server/start-test-server.function';

/**
 * Executable form of evaluation/04-infrastructure-subsystems.md sections 3.6, 3.8, 3.9, 3.10 and
 * 1.8.
 *
 * Single flight coalescing happens inside one process, so it is observable directly: call the
 * wrapper concurrently for the same key and count how often the origin actually ran. No source
 * inspection involved - an earlier version of this test grepped for /inFlight/i, matched the
 * metrics gauge named `inFlight`, and reported the finding as fixed while nothing had changed.
 *
 * 3.6 and 3.8 need a server two instances can share, so they drive a real valkey store rather than
 * a cache. The halves of 3.7 and 3.8 that belong to the in memory store need nothing to run against
 * and are held in that store's own tests - what a value is charged for, and what a read of an
 * expired entry does to the order eviction goes in.
 *
 * These describe the fixed behavior, which each of them now has. See ./README.md for the convention.
 */

@Cache()
class EvalTierCache extends WriteThroughReadThroughCache<string, number, 'EvalTierCache'> {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        protected readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.CACHE_SERVICE)
        protected readonly cacheService: CacheServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.METRICS_SERVICE)
        protected readonly metricsService: MetricsServiceInterface
    ) {
        super('EvalTierCache', new InMemoryCacheStore(), []);
    }
}

@Cache()
class EvalMultiTierCache extends MultiTierCache<string, number, [EvalTierCache]> {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        protected readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.METRICS_SERVICE)
        protected readonly metricsService: MetricsServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.CACHE_SERVICE)
        protected readonly cacheService: CacheServiceInterface,
        @Inject(EvalTierCache)
        tier: EvalTierCache
    ) {
        super('EvalMultiTierCache', [tier]);
    }
}

/**
 * The key an ordinary key provider builds: derived from the arguments, and a new object every call.
 */
type EvalObjectKey = {
    /** Who the value belongs to. */
    userId: string,
    /** Which tenant they were read for. */
    tenantId: string
};

@Cache()
class EvalObjectKeyTierCache extends WriteThroughReadThroughCache<EvalObjectKey, number, 'EvalObjectKeyTierCache'> {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        protected readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.CACHE_SERVICE)
        protected readonly cacheService: CacheServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.METRICS_SERVICE)
        protected readonly metricsService: MetricsServiceInterface
    ) {
        super('EvalObjectKeyTierCache', new InMemoryCacheStore(), []);
    }
}

@Cache()
class EvalObjectKeyMultiTierCache extends MultiTierCache<EvalObjectKey, number, [EvalObjectKeyTierCache]> {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        protected readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.METRICS_SERVICE)
        protected readonly metricsService: MetricsServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.CACHE_SERVICE)
        protected readonly cacheService: CacheServiceInterface,
        @Inject(EvalObjectKeyTierCache)
        tier: EvalObjectKeyTierCache
    ) {
        super('EvalObjectKeyMultiTierCache', [tier]);
    }
}

/**
 * The tag the tier below declares, and the one invalidation is asked for.
 */
const evalCacheTag: 'eval-user' = 'eval-user';

@Cache()
class EvalTaggedTierCache extends WriteThroughReadThroughCache<string, number, 'EvalTaggedTierCache', 'eval-user'> {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        protected readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.CACHE_SERVICE)
        protected readonly cacheService: CacheServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.METRICS_SERVICE)
        protected readonly metricsService: MetricsServiceInterface
    ) {
        super('EvalTaggedTierCache', new InMemoryCacheStore(), ['eval-user']);
    }
}

@Cache()
class EvalTaggedMultiTierCache extends MultiTierCache<string, number, [EvalTaggedTierCache], 'eval-user'> {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        protected readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.METRICS_SERVICE)
        protected readonly metricsService: MetricsServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.CACHE_SERVICE)
        protected readonly cacheService: CacheServiceInterface,
        @Inject(EvalTaggedTierCache)
        tier: EvalTaggedTierCache
    ) {
        super('EvalTaggedMultiTierCache', [tier]);
    }
}

let server: StartedTestServer | undefined;

const dataSourceClass: Newable<PostgresDataSource> = createTestDataSource();
const valKeyDataSourceClass: Newable<ValKeyDataSource> = createTestValKeyDataSource();

let valKey: ValKeyDataSource;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [dataSourceClass, valKeyDataSourceClass] });
    valKey = inject(valKeyDataSourceClass);
}, 60000);

afterAll(async () => {
    // guarded so a failed beforeAll reports the real cause instead of a shutdown TypeError
    await server?.shutdown();
}, 30000);

describe('evaluation/04-infrastructure-subsystems 3.9 - multi tier cache', () => {

    it('runs the origin once when several callers miss the same key at the same time', async () => {
        const cache: EvalMultiTierCache = inject(EvalMultiTierCache);
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

        const results: number[] = await Promise.all([cached(), cached(), cached()]);

        expect(results).toEqual([42, 42, 42]);
        // MultiTierCache does not extend BaseCache, so it has no runSingleFlight: wrap() goes
        // straight from miss to `await fn(...args)`. A hot key expiring therefore sends every
        // concurrent request to the origin at once - the stampede the single tier caches guard
        // against.
        expect(originCalls).toBe(1);
    }, 30000);

    it('serves the second caller from the cache once the first has filled it', async () => {
        const cache: EvalMultiTierCache = inject(EvalMultiTierCache);
        let originCalls: number = 0;

        const cached: () => Promise<number> = cache.wrap(
            () => {
                originCalls++;
                return 7;
            },
            () => 'sequential-key'
        );

        expect(await cached()).toBe(7);
        expect(await cached()).toBe(7);

        // guards the test above: if this fails the cache is not caching at all, and the
        // single flight expectation would be measuring the wrong thing
        expect(originCalls).toBe(1);
    }, 30000);

    it('counts the hits and misses it declares counters for', async () => {
        const cache: EvalMultiTierCache = inject(EvalMultiTierCache);
        const metrics: MetricsServiceInterface = inject(ZIBRI_DI_TOKENS.METRICS_SERVICE);

        /**
         * Reads a counter of this cache as it stands right now.
         *
         * A counter is cumulative and this cache is used by the tests above, so what this test can
         * assert is what its own two calls added - an absolute value would be measuring the file.
         * @param name - The counter to read.
         * @returns Its current value, or zero while it has no sample yet.
         */
        async function counter(name: string): Promise<number> {
            await metrics.collect();
            // the snapshots are a history, so only the last one is now - searching across all of
            // them finds the oldest sample of the counter, which never changes
            return metrics.getMetricSnapshots().at(-1)?.metrics
                .find(m => m.name === name && m.labels['cache'] === 'EvalMultiTierCache')
                ?.value ?? 0;
        }

        const missesBefore: number = await counter('cache_misses_total');
        const hitsBefore: number = await counter('cache_hits_total');

        const cached: () => Promise<number> = cache.wrap(() => 1, () => 'metrics-key');
        await cached();
        await cached();

        // the counters were declared in initMetrics and never incremented, so the hit rate
        // dashboard of the flagship cache read a permanent zero - which is worse than having no
        // dashboard, because it looks like an answer
        expect(await counter('cache_misses_total') - missesBefore).toBe(1);
        expect(await counter('cache_hits_total') - hitsBefore).toBe(1);
    }, 30000);
});

describe('evaluation/04-infrastructure-subsystems 3.10 - single flight with an object key', () => {

    it('coalesces concurrent callers whose key provider returns a fresh object each time', async () => {
        const cache: EvalObjectKeyMultiTierCache = inject(EvalObjectKeyMultiTierCache);
        let originCalls: number = 0;

        const cached: () => Promise<number> = cache.wrap(
            async () => {
                originCalls++;
                await new Promise<void>(resolve => setTimeout(resolve, 50));
                return 42;
            },
            // a new object per call, which is what any key built from arguments is
            () => ({ userId: 'u1', tenantId: 't1' })
        );

        await Promise.all([cached(), cached(), cached()]);

        // the in flight map was keyed by reference, so two calls for the same thing were two
        // different keys and coalescing never happened for any key that was not a primitive
        expect(originCalls).toBe(1);
    }, 30000);

    it('serves a later caller from the cache under an equal object key', async () => {
        const cache: EvalObjectKeyMultiTierCache = inject(EvalObjectKeyMultiTierCache);
        let originCalls: number = 0;

        const cached: () => Promise<number> = cache.wrap(
            () => {
                originCalls++;
                return 7;
            },
            () => ({ userId: 'u2', tenantId: 't1' })
        );

        expect(await cached()).toBe(7);
        expect(await cached()).toBe(7);

        // the other half, and the worse one: the store was keyed by reference too, so an object key
        // never hit at all - while the same declaration on valkey, which resolves the key to a
        // string, hit normally. One declaration, two answers, depending on where it was stored
        expect(originCalls).toBe(1);
    }, 30000);
});

/**
 * The byte budget the stores below run under: far more than they write, so that what removes an
 * entry is the thing each test is about rather than the limit.
 */
const roomToSpare: number = Bytes.KB * 100;

/**
 * A store over the shared valkey, emptied before it is handed back.
 *
 * Every store built on one data source shares its key prefix, which is the point - it is how two
 * instances of an application see one cache - and it means they are one store across tests too. So
 * each test starts by clearing it, or it reads what the test before it left behind.
 * @returns The store, holding nothing.
 */
async function emptyValKeyStore(): Promise<ValKeyCacheStore<string, string>> {
    const store: ValKeyCacheStore<string, string> = new ValKeyCacheStore(valKey, {
        model: 'plain',
        maxBytes: roomToSpare,
        maxEntries: 1000
    });
    await store.clear();
    return store;
}

describe('evaluation/04-infrastructure-subsystems 3.6 - the byte counter of a shared store', () => {

    /**
     * Two stores over one valkey, which is what two instances of an application are: the values and
     * all three bookkeeping keys live on the server, and both write to them.
     * @returns The two stores, over a cache holding nothing.
     */
    async function twoInstancesSharingOneCache(): Promise<[ValKeyCacheStore<string, string>, ValKeyCacheStore<string, string>]> {
        return [
            await emptyValKeyStore(),
            new ValKeyCacheStore(valKey, { model: 'plain', maxBytes: roomToSpare, maxEntries: 1000 })
        ];
    }

    /**
     * A cached value with no expiry, so that nothing but the byte budget can remove it.
     * @param value - The value to cache.
     * @returns The cached value.
     */
    function permanent(value: string): CachedValue<string> {
        return { value, tags: [], createdAt: new Date() };
    }

    it('keeps counting right when both instances write the same key at once', async () => {
        const [first, second]: ValKeyCacheStore<string, string>[] = await twoInstancesSharingOneCache();

        // the counter used to be a read of the previous size followed by an increment by the
        // difference. Both instances read the same previous size, both added the whole new one, and
        // the store was then permanently over budget by everything the losers of those races added
        await Promise.all(
            Array.from({ length: 20 }, (_, i) => i).flatMap(i => [
                first.set('contended', permanent(`from-first-${i}`)),
                second.set('contended', permanent(`from-second-${i}`))
            ])
        );

        // one key was written, so the store holds one entry - and if the counter says otherwise, the
        // budget it guards is wrong by however far it drifted
        expect(await first.size()).toBe(1);
        for (let i: number = 0; i < 5; i++) {
            await first.set(`after-${i}`, permanent('still fits'));
        }

        // a store whose counter is too high evicts to get back under a limit it is not actually
        // over, and nothing ever brings the number back down - so these are gone as fast as they
        // are written, forever
        for (let i: number = 0; i < 5; i++) {
            expect((await first.get(`after-${i}`))?.value).toBe('still fits');
        }
    }, 30000);

    it('keeps counting right when both instances remove the same key at once', async () => {
        const [first, second]: ValKeyCacheStore<string, string>[] = await twoInstancesSharingOneCache();

        await first.set('doomed', permanent('value'));
        await Promise.all([first.delete('doomed'), second.delete('doomed')]);

        // the other direction of the same race: subtracting a size twice leaves the counter below
        // what the store holds, which turns the budget off rather than tightening it
        await first.set('kept', permanent('value'));
        expect(await first.size()).toBe(1);
        expect((await first.get('kept'))?.value).toBe('value');
    }, 30000);
});

describe('evaluation/04-infrastructure-subsystems 3.8 - expired entries and the budget', () => {

    it('gives back the room an expired entry held without waiting to be asked for it again', async () => {
        const store: ValKeyCacheStore<string, string> = await emptyValKeyStore();

        for (let i: number = 0; i < 5; i++) {
            await store.set(`short-lived-${i}`, {
                value: 'value',
                tags: [],
                createdAt: new Date(),
                expiresAt: new Date(Date.now() + 100)
            });
        }
        expect(await store.size()).toBe(5);

        await new Promise<void>(resolve => setTimeout(resolve, 300));

        // the server drops the value when its time to live runs out and knows nothing about the
        // index, the sizes hash or the counter - so without a sweep the entries went on taking up
        // budget until somebody asked for those exact keys again, which for most keys is never
        expect(await store.removeExpired()).toBe(5);
        expect(await store.size()).toBe(0);
    }, 30000);

    it('reports an expired entry a read already removed rather than losing it', async () => {
        const store: ValKeyCacheStore<string, string> = await emptyValKeyStore();

        await store.set('read-first', {
            value: 'value',
            tags: [],
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + 100)
        });
        await new Promise<void>(resolve => setTimeout(resolve, 300));

        expect(await store.get('read-first')).toBeUndefined();

        // whichever of the two finds it first, one entry expired - a number that only counted the
        // sweeps would read near zero on exactly the caches whose keys are read often
        expect(await store.removeExpired()).toBe(1);
    }, 30000);
});

describe('evaluation/04-infrastructure-subsystems 1.8 - tag invalidation on a multi tier cache', () => {

    it('re-reads from the origin after the tag its value was stored under is invalidated', async () => {
        const cache: EvalTaggedMultiTierCache = inject(EvalTaggedMultiTierCache);
        const cacheService: CacheServiceInterface = inject(ZIBRI_DI_TOKENS.CACHE_SERVICE);
        let originCalls: number = 0;

        const cached: () => Promise<number> = cache.wrap(
            () => {
                originCalls++;
                return originCalls;
            },
            () => 'tagged-key',
            { EvalTaggedTierCache: { tags: () => [evalCacheTag] } }
        );

        expect(await cached()).toBe(1);
        // guard: without this the assertion below would pass on a cache that never stored anything
        expect(await cached()).toBe(1);

        await cacheService.invalidateTags([evalCacheTag]);

        // CacheService.invalidateTags filters MultiTierCache out twice - once in the filter that
        // picks affected caches and again in the map that invalidates them - so @CacheInvalidate
        // against a multi tier cache does nothing at all. A permissions change that invalidates
        // 'user' leaves every replica serving the old permissions until the ttl runs out.
        expect(await cached()).toBe(2);
        expect(originCalls).toBe(2);
    }, 30000);
});