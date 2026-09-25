import { AnyCache, isCache } from './cache/cache.interface';
import { MultiTierCache } from './cache/multi-tier.cache';
import { CacheExpiryCleanupCronJob } from './cache-expiry-cleanup.cron-job';
import { CacheInvalidationCronJob } from './cache-invalidation.cron-job';
import { CacheInvalidation, CreateCacheInvalidationData } from './cache-invalidation.model';
import { CacheServiceInterface } from './cache-service.interface';
import { matchesAnyTag } from './cache-tag-matchers';
import { ZibriApplication } from '../application/application';
import { Repository } from '../data-source/repository/repository';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { Inject } from '../di/decorators/inject.decorator';
import { Injectable } from '../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { getAllInstantiatedValues } from '../di/get-all-instantiated-values.function';
import { getDiTokenName } from '../di/get-di-token-name.function';
import { getRegisteredProvidersOfVariant } from '../di/get-registered-providers-of-variant.function';
import { inject } from '../di/inject.function';
import { DiProvider } from '../di/models/di-provider.model';
import { DiVariants } from '../di/models/di-variant.model';
import { InternalError } from '../error-handling/internal-error.model';
import { OnAppInit } from '../global/on-app-init.interface';
import { type LoggerInterface } from '../logging/logger.interface';
import { type CounterInterface } from '../metrics/counter.interface';
import { validateEntitiesRegistered } from '../utilities/validate-entities-registered.function';

/**
 * An error to throw during cache service initialization.
 */
class InitCacheServiceError extends InternalError {
    constructor(message: string | string[]) {
        const messageArray: string[] = typeof message === 'string' ? [message] : message;
        super(['Error initializing cache service.', ...messageArray]);
        this.name = 'InitCacheServiceError';
    }
}

/**
 * Default implementation of the cache service.
 */
@Injectable({ register: 'onUse' })
export class CacheService implements CacheServiceInterface, OnAppInit {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly caches: AnyCache[] = [];

    /**
     * The published invalidations this instance has already applied.
     *
     * Pruned on every poll to the rows that still exist, so it cannot grow without bound - the rows
     * themselves are deleted once old enough.
     */
    private readonly appliedInvalidationIds: Set<string> = new Set();

    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        private readonly logger: LoggerInterface
    ) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    onAppInit(app: ZibriApplication): void {
        const cacheProviders: DiProvider<unknown>[] = getRegisteredProvidersOfVariant(DiVariants.CACHE);
        if (cacheProviders.length) {
            this.logger.info(`configures ${cacheProviders.length} ${cacheProviders.length > 1 ? 'caches' : 'cache'}:`);

            // instances tell each other about invalidations through a row, so the entity has to
            // exist. Only asked for when there is something to invalidate.
            validateEntitiesRegistered(CacheService.name, app, CacheInvalidation);
            if (!app.options.cronJobs.includes(CacheInvalidationCronJob)) {
                app.options.cronJobs.push(CacheInvalidationCronJob);
            }
            if (!app.options.cronJobs.includes(CacheExpiryCleanupCronJob)) {
                app.options.cronJobs.push(CacheExpiryCleanupCronJob);
            }
        }

        for (const provider of cacheProviders) {
            const cache: unknown = inject(provider.token);
            if (!isCache(cache)) {
                throw new InitCacheServiceError(
                    `Invalid class marked with @Cache: ${getDiTokenName(provider.token)} needs to implement CacheInterface`
                );
            }
            this.caches.push(cache);
            this.logger.info(`  - ${cache.name}`);
        }

        // among what the application has actually built, rather than everything registered. Asking
        // the second question means constructing every registered value to look at it - including
        // the ones an import registered and nothing wants - and a cache nothing has built is a cache
        // nothing is reading through.
        const caches: AnyCache[] = getAllInstantiatedValues().filter(i => isCache(i));
        for (const cache of caches) {
            if (!this.caches.find(c => c.name === cache.name)) {
                throw new InitCacheServiceError(
                    `The class "${cache.constructor.name}" seems to be a cache but has not been decorated with @Cache()`
                );
            }
        }

        const duplicateCacheNames: AnyCache[] = this.caches.filter(
            c => this.caches.filter(internalC => internalC.name === c.name).length > 1
        );
        if (duplicateCacheNames.length) {
            throw new InitCacheServiceError(
                [
                    'There are duplicate cache names:',
                    ...[...new Set(duplicateCacheNames)].map(s => `- ${s.name}`)
                ]
            );
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async invalidateTags(tags: string[]): Promise<void> {
        await this.invalidateTagsLocally(tags);

        // and tell the other instances, whose caches this one cannot reach. Published after the
        // local invalidation, so the instance that handled the write is never the stale one.
        await inject(repositoryTokenFor(CacheInvalidation)).create({ tags });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async applyPendingInvalidations(): Promise<void> {
        const repository: Repository<CacheInvalidation, CreateCacheInvalidationData> = inject(
            repositoryTokenFor(CacheInvalidation)
        );
        const published: CacheInvalidation[] = await repository.findAll({});

        // tracked by id rather than by timestamp: instances do not share a clock, and comparing one
        // instance's `at` against another's idea of now is how a notification gets missed entirely
        const currentIds: Set<string> = new Set(published.map(p => p.id));
        for (const id of this.appliedInvalidationIds) {
            if (!currentIds.has(id)) {
                this.appliedInvalidationIds.delete(id);
            }
        }

        const unseen: CacheInvalidation[] = published.filter(p => !this.appliedInvalidationIds.has(p.id));
        for (const invalidation of unseen) {
            this.appliedInvalidationIds.add(invalidation.id);
        }

        const tags: string[] = [...new Set(unseen.flatMap(i => i.tags))];
        if (tags.length) {
            await this.invalidateTagsLocally(tags);
        }

        // old enough that no running instance can still need them. One that was down for longer
        // starts with empty local caches, so there is nothing for it to have missed.
        const retentionInMs: number = inject(ZIBRI_DI_TOKENS.CACHE_INVALIDATION_RETENTION_IN_MS);
        await repository.deleteAll({ at: { before: new Date(Date.now() - retentionInMs) } });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async removeExpiredValues(): Promise<void> {
        const expired: CounterInterface = inject(ZIBRI_DI_TOKENS.METRICS_SERVICE)
            .getCounter('cache_expired_evictions_total', ['cache']);

        await Promise.all(this.caches.map(async (cache) => {
            // a multi tier cache has no store of its own - its tiers are caches in their own right
            // and are registered here beside it, so walking the list reaches each store once
            if (cache instanceof MultiTierCache) {
                return;
            }

            try {
                const removed: number = await cache.store.removeExpired();
                if (removed) {
                    expired.increase({ cache: cache.name }, removed);
                }
            }
            catch (error) {
                // the cache keeps working with expired entries in it, so this is worth knowing about
                // and not worth failing a scheduled run over
                this.logger.warn(`Cleaning up expired values out of "${cache.name}" failed`, { error });
            }
        }));
    }

    /**
     * Invalidates the given tags in this instance's own caches, telling nobody else.
     *
     * Separate from invalidateTags so that applying an invalidation another instance published does
     * not publish it a second time.
     * @param tags - The tags to invalidate.
     */
    private async invalidateTagsLocally(tags: string[]): Promise<void> {
        // Only hit caches that actually declared these tags. Multi tier caches are included: they
        // report the tags of their tiers, and invalidate through to those tiers' stores. Skipping
        // them - which this did, twice - made @CacheInvalidate against one silently do nothing.
        const affectedCaches: AnyCache[] = this.caches.filter(c => c.tags === 'all' || matchesAnyTag(c.tags, tags));

        await Promise.all(affectedCaches.map(async c => {
            if (c instanceof MultiTierCache) {
                await c.invalidateTags(tags);
                return;
            }
            await c.store.invalidateTags(tags);
        }));
    }
}