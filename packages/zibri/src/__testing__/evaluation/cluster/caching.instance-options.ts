import { ClusterMark, clusterInstanceId, StartTestServerOptions } from 'zibri-testing';

import { MultiTierCache } from '../../../caching/cache/multi-tier.cache';
import { WriteThroughReadThroughCache } from '../../../caching/cache/read-through/write-through-read-through.cache';
import { type CacheServiceInterface } from '../../../caching/cache-service.interface';
import { Cache } from '../../../caching/decorators/cache.decorator';
import { InMemoryCacheStore } from '../../../caching/store/in-memory.cache-store';
import { ValKeyCacheStore } from '../../../caching/store/val-key.cache-store';
import { ValKeyDataSource, ValKeyOptions } from '../../../data-source/data-sources/val-key/val-key-data-source.model';
import { DataSource } from '../../../data-source/decorators/data-source.decorator';
import { Repository } from '../../../data-source/repository/repository';
import { InjectRepository } from '../../../di/decorators/inject-repository.decorator';
import { Inject } from '../../../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { BaseEntity } from '../../../entity/base-entity.model';
import { type LoggerInterface } from '../../../logging/logger.interface';
import { type MetricsServiceInterface } from '../../../metrics/metrics-service.interface';
import { Controller } from '../../../routing/decorators/controller.decorator';
import { Get } from '../../../routing/decorators/get.decorator';
import { Post } from '../../../routing/decorators/post.decorator';
import { Newable } from '../../../types/newable.type';
import { createTestDataSource, defaultTestServerEntities } from '../../test-server/create-test-data-source.function';
import { defaultTestValKeyEntities } from '../../test-server/create-test-val-key-data-source.function';

/**
 * What every instance of the caching cluster boots with.
 *
 * A real multi tier cache: an in-memory L1 in front of a valkey L2 that every instance shares. That
 * arrangement is the point of the test - a single tier cache on the valkey store alone would be
 * coherent across instances by itself, so it would prove nothing about the framework.
 *
 * Like every instance options module this is imported by the parent as well, so nothing at the top
 * level may assume it is running inside an instance.
 */

/**
 * The tag values are stored under, and the one invalidation is asked for.
 */
const cacheTag: 'cluster-counter' = 'cluster-counter';

/**
 * The kind of mark the origin counts. Each one written moves the value the origin returns.
 */
const originKind: string = 'cache-origin';

/**
 * The shared tier's keyspace.
 *
 * Fixed rather than taken from createTestValKeyDataSource, which generates a random prefix per call:
 * every instance loads this module for itself, so a random one would give each of them its own
 * keyspace and the shared tier would not be shared at all.
 */
const valKeyPrefix: string = 'cluster-cache';

@DataSource()
class ClusterValKeyDataSource extends ValKeyDataSource {
    override options: ValKeyOptions = {
        host: 'localhost',
        useTLS: false,
        keyPrefix: valKeyPrefix
    };
    entities: Newable<BaseEntity>[] = defaultTestValKeyEntities;
}

/**
 * L1. In this instance's memory, and reachable by nothing else.
 */
@Cache()
class ClusterLocalTierCache extends WriteThroughReadThroughCache<string, number, 'ClusterLocalTierCache', 'cluster-counter'> {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        protected readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.CACHE_SERVICE)
        protected readonly cacheService: CacheServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.METRICS_SERVICE)
        protected readonly metricsService: MetricsServiceInterface
    ) {
        super('ClusterLocalTierCache', new InMemoryCacheStore(), [cacheTag]);
    }
}

/**
 * L2. On the valkey server, so every instance reads and writes the same entries.
 */
@Cache()
class ClusterSharedTierCache extends WriteThroughReadThroughCache<string, number, 'ClusterSharedTierCache', 'cluster-counter'> {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        protected readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.CACHE_SERVICE)
        protected readonly cacheService: CacheServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.METRICS_SERVICE)
        protected readonly metricsService: MetricsServiceInterface
    ) {
        super('ClusterSharedTierCache', new ValKeyCacheStore(inject(ClusterValKeyDataSource), { model: 'plain' }), [cacheTag]);
    }
}

@Cache()
class ClusterMultiTierCache extends MultiTierCache<
        string,
        number,
        [ClusterLocalTierCache, ClusterSharedTierCache],
        'cluster-counter'
    > {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        protected readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.METRICS_SERVICE)
        protected readonly metricsService: MetricsServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.CACHE_SERVICE)
        protected readonly cacheService: CacheServiceInterface,
        @Inject(ClusterLocalTierCache)
        local: ClusterLocalTierCache,
        @Inject(ClusterSharedTierCache)
        shared: ClusterSharedTierCache
    ) {
        super('ClusterMultiTierCache', [local, shared]);
    }
}

/**
 * Reads a value through this instance's cache, moves it, and invalidates it.
 */
@Controller('/cluster-cache')
class ClusterCacheController {
    constructor(
        @InjectRepository(ClusterMark)
        private readonly markRepository: Repository<ClusterMark>
    ) {}

    /**
     * Reads the shared value through this instance's cache.
     * @returns How many origin marks exist, as this instance currently believes.
     */
    @Get('/value')
    async value(): Promise<number> {
        const cache: ClusterMultiTierCache = inject(ClusterMultiTierCache);

        const cached: () => Promise<number> = cache.wrap(
            async () => (await this.markRepository.findAll({ where: { kind: originKind } })).length,
            () => 'counter',
            {
                ClusterLocalTierCache: { tags: () => [cacheTag] },
                ClusterSharedTierCache: { tags: () => [cacheTag] }
            }
        );
        return await cached();
    }

    /**
     * Moves the shared value by writing one more origin mark.
     */
    @Post('/bump')
    async bump(): Promise<void> {
        await this.markRepository.create({
            instanceId: clusterInstanceId(),
            kind: originKind,
            tag: cacheTag,
            at: new Date()
        });
    }

    /**
     * Invalidates the tag, the way a write path would after changing the underlying data.
     */
    @Post('/invalidate')
    async invalidate(): Promise<void> {
        const cacheService: CacheServiceInterface = inject(ZIBRI_DI_TOKENS.CACHE_SERVICE);
        await cacheService.invalidateTags([cacheTag]);
    }
}

const options: StartTestServerOptions = {
    controllers: [ClusterCacheController],
    // this repository's own fixtures plus the mark table, the way every other suite here declares a
    // data source: importing the helper above registers JwtUser, and a registered entity no data
    // source declares is refused at boot
    dataSources: [createTestDataSource({ entities: [...defaultTestServerEntities, ClusterMark] }), ClusterValKeyDataSource]
};

export default options;