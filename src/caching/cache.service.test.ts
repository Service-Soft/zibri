import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { type CacheServiceInterface } from './cache-service.interface';
import { CacheService } from './cache.service';
import { Cache } from './decorators/cache.decorator';
import { CachedValue } from './store/cached-value.model';
import { InMemoryCacheStore } from './store/in-memory.cache-store';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { Inject } from '../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { type LoggerInterface } from '../logging/logger.interface';
import { type MetricsServiceInterface } from '../metrics/metrics-service.interface';
import { WriteThroughReadThroughCache } from './cache/read-through/write-through-read-through.cache';

@Cache()
class UserTagCache extends WriteThroughReadThroughCache<string, string> {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER) protected readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.METRICS_SERVICE) protected readonly metricsService: MetricsServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.CACHE_SERVICE) protected readonly cacheService: CacheServiceInterface
    ) {
        super('User Tag Cache', new InMemoryCacheStore(), ['user']);
    }
}

@Cache()
class PostTagCache extends WriteThroughReadThroughCache<string, string> {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER) protected readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.METRICS_SERVICE) protected readonly metricsService: MetricsServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.CACHE_SERVICE) protected readonly cacheService: CacheServiceInterface
    ) {
        super('Post Tag Cache', new InMemoryCacheStore(), ['post']);
    }
}

@Cache()
class UserRegexCache extends WriteThroughReadThroughCache<string, string> {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER) protected readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.METRICS_SERVICE) protected readonly metricsService: MetricsServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.CACHE_SERVICE) protected readonly cacheService: CacheServiceInterface
    ) {
        super('User Regex Cache', new InMemoryCacheStore(), [/^user:/]);
    }
}

@Cache()
class PostRegexCache extends WriteThroughReadThroughCache<string, string> {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER) protected readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.METRICS_SERVICE) protected readonly metricsService: MetricsServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.CACHE_SERVICE) protected readonly cacheService: CacheServiceInterface
    ) {
        super('Post Regex Cache', new InMemoryCacheStore(), [/^post:/]);
    }
}

@Cache()
class UserPredicateCache extends WriteThroughReadThroughCache<string, string> {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER) protected readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.METRICS_SERVICE) protected readonly metricsService: MetricsServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.CACHE_SERVICE) protected readonly cacheService: CacheServiceInterface
    ) {
        super('User Predicate Cache', new InMemoryCacheStore(), [(tag: string) => tag.startsWith('user:')]);
    }
}

@Cache()
class OtherPredicateCache extends WriteThroughReadThroughCache<string, string> {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER) protected readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.METRICS_SERVICE) protected readonly metricsService: MetricsServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.CACHE_SERVICE) protected readonly cacheService: CacheServiceInterface
    ) {
        super('Other Predicate Cache', new InMemoryCacheStore(), [(tag: string) => tag.startsWith('other:')]);
    }
}

@Cache()
class AllTagsCache extends WriteThroughReadThroughCache<string, string> {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER) protected readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.METRICS_SERVICE) protected readonly metricsService: MetricsServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.CACHE_SERVICE) protected readonly cacheService: CacheServiceInterface
    ) {
        super('All Tags Cache', new InMemoryCacheStore(), 'all');
    }
}

@Cache()
class UnrelatedTagCache extends WriteThroughReadThroughCache<string, string> {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER) protected readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.METRICS_SERVICE) protected readonly metricsService: MetricsServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.CACHE_SERVICE) protected readonly cacheService: CacheServiceInterface
    ) {
        super('Unrelated Tag Cache', new InMemoryCacheStore(), ['unrelated']);
    }
}

function createCachedValue<V>(value: V, tags: string[]): CachedValue<V> {
    return { value, tags, createdAt: new Date() };
}

describe('CacheService', () => {
    let server: StartedTestServer;
    let cacheService: CacheService;

    beforeAll(async () => {
        server = await startTestServer();
        cacheService = inject(ZIBRI_DI_TOKENS.CACHE_SERVICE) as CacheService;
    }, 15000);

    afterAll(async () => {
        await server?.shutdown();
    });

    beforeEach(async () => {
        cacheService.caches.length = 0;
        await inject(UserTagCache).store.clear();
        await inject(PostTagCache).store.clear();
        await inject(UserRegexCache).store.clear();
        await inject(PostRegexCache).store.clear();
        await inject(UserPredicateCache).store.clear();
        await inject(OtherPredicateCache).store.clear();
        await inject(AllTagsCache).store.clear();
        await inject(UnrelatedTagCache).store.clear();
    });

    it('invalidates only caches whose declared tags match', async () => {
        const userCache: UserTagCache = inject(UserTagCache);
        const postCache: PostTagCache = inject(PostTagCache);

        cacheService.caches.push(userCache, postCache);

        await userCache.store.set('u1', createCachedValue('user-value', ['user']));
        await postCache.store.set('p1', createCachedValue('post-value', ['post']));

        await cacheService.invalidateTags(['user']);

        expect(await userCache.store.get('u1')).toBeUndefined();
        expect((await postCache.store.get('p1'))?.value).toBe('post-value');
    });

    it('invalidates caches with tag matchers based on regex', async () => {
        const userCache: UserRegexCache = inject(UserRegexCache);
        const postCache: PostRegexCache = inject(PostRegexCache);

        cacheService.caches.push(userCache, postCache);

        await userCache.store.set('u1', createCachedValue('user-value', ['user:1']));
        await postCache.store.set('p1', createCachedValue('post-value', ['post:1']));

        await cacheService.invalidateTags(['user:1']);

        expect(await userCache.store.get('u1')).toBeUndefined();
        expect((await postCache.store.get('p1'))?.value).toBe('post-value');
    });

    it('invalidates caches with tag matchers based on predicate functions', async () => {
        const userCache: UserPredicateCache = inject(UserPredicateCache);
        const otherCache: OtherPredicateCache = inject(OtherPredicateCache);

        cacheService.caches.push(userCache, otherCache);

        await userCache.store.set('u1', createCachedValue('user-value', ['user:1']));
        await otherCache.store.set('o1', createCachedValue('other-value', ['other:1']));

        await cacheService.invalidateTags(['user:1']);

        expect(await userCache.store.get('u1')).toBeUndefined();
        expect((await otherCache.store.get('o1'))?.value).toBe('other-value');
    });

    it('treats tag matchers as an optimization and only calls invalidateTags on affected caches', async () => {
        const allCache: AllTagsCache = inject(AllTagsCache);
        const postCache: PostTagCache = inject(PostTagCache);

        cacheService.caches.push(allCache, postCache);

        await allCache.store.set('a', createCachedValue('all-value', ['keep-me']));
        await postCache.store.set('p', createCachedValue('post-value', ['post']));

        // eslint-disable-next-line typescript/typedef
        const allInvalidateSpy = jest.spyOn(allCache.store, 'invalidateTags');
        // eslint-disable-next-line typescript/typedef
        const postInvalidateSpy = jest.spyOn(postCache.store, 'invalidateTags');

        await cacheService.invalidateTags(['user']);

        expect(allInvalidateSpy).toHaveBeenCalledTimes(1);
        expect(postInvalidateSpy).not.toHaveBeenCalled();

        expect((await allCache.store.get('a'))?.value).toBe('all-value');
        expect((await postCache.store.get('p'))?.value).toBe('post-value');
    });

    it('does nothing when no cache declares matching tags', async () => {
        const cache: UnrelatedTagCache = inject(UnrelatedTagCache);

        cacheService.caches.push(cache);
        await cache.store.set('x', createCachedValue('value', ['x']));

        await cacheService.invalidateTags(['different']);

        expect((await cache.store.get('x'))?.value).toBe('value');
    });
});