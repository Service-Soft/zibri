import { AnyCache, isCache } from './cache/cache.interface';
import { CacheServiceInterface } from './cache-service.interface';
import { matchesAnyTag } from './cache-tag-matchers';
import { Inject } from '../di/decorators/inject.decorator';
import { Injectable } from '../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { GlobalRegistry } from '../global/global-registry';
import { OnAppInit } from '../global/on-app-init.interface';
import { type LoggerInterface } from '../logging/logger.interface';
import { MultiTierCache } from './cache/multi-tier.cache';

/**
 * Default implementation of the cache service.
 */
@Injectable({ register: 'onUse' })
export class CacheService implements CacheServiceInterface, OnAppInit {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly caches: AnyCache[] = [];

    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        private readonly logger: LoggerInterface
    ) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onAppInit(): Promise<void> {
        if (GlobalRegistry.cacheClasses.length) {
            // eslint-disable-next-line stylistic/max-len
            await this.logger.info(`configures ${GlobalRegistry.cacheClasses.length} ${GlobalRegistry.cacheClasses.length > 1 ? 'caches' : 'cache'}:`);
        }

        for (const cacheClass of GlobalRegistry.cacheClasses) {
            const cache: AnyCache = inject(cacheClass);
            this.caches.push(cache);
            if (!isCache(cache)) {
                throw new Error(`Invalid class marked with @Cache: ${cacheClass.name} needs to implement CacheInterface`);
            }
            await this.logger.info(`  - ${cache.name}`);
        }

        for (const cacheInjectable of GlobalRegistry.injectables.map(i => inject(i.token)).filter(i => isCache(i))) {
            if (!this.caches.find(c => c.name === cacheInjectable.name)) {
                throw new Error(`The class "${cacheInjectable.constructor}" seems to be a cache but has not been decorated with @Cache()`);
            }
        }

        const duplicateCacheNames: AnyCache[] = this.caches.filter(
            c => this.caches.filter(internalC => internalC.name === c.name).length > 1
        );
        if (duplicateCacheNames.length) {
            throw new Error(
                [
                    'There are duplicate cache names:',
                    [...new Set(duplicateCacheNames)].map(s => `- ${s.name}`)
                ].join('\n')
            );
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async invalidateTags(tags: string[]): Promise<void> {
        // Only hit caches that actually declared these tags
        const affectedCaches: AnyCache[] = this.caches.filter(
            c => !(c instanceof MultiTierCache) && (c.tags === 'all' || matchesAnyTag(c.tags, tags))
        );
        await Promise.all(affectedCaches.map(c => c instanceof MultiTierCache ? undefined : c.store.invalidateTags(tags)));
    }
}