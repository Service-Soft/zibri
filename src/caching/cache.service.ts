import { AnyCache, isCache } from './cache/cache.interface';
import { CacheServiceInterface } from './cache-service.interface';
import { matchesAnyTag } from './cache-tag-matchers';
import { Inject } from '../di/decorators/inject.decorator';
import { Injectable } from '../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { getAllRegisteredTokens } from '../di/get-all-registered-tokens.function';
import { getDiTokenName } from '../di/get-di-token-name.function';
import { getRegisteredProvidersOfVariant } from '../di/get-registered-providers-of-variant.function';
import { inject } from '../di/inject.function';
import { DiProvider } from '../di/models/di-provider.model';
import { DiVariants } from '../di/models/di-variant.model';
import { OnAppInit } from '../global/on-app-init.interface';
import { type LoggerInterface } from '../logging/logger.interface';
import { MultiTierCache } from './cache/multi-tier.cache';
import { InternalError } from '../error-handling/internal-error.model';

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

    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        private readonly logger: LoggerInterface
    ) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onAppInit(): Promise<void> {
        const cacheProviders: DiProvider<unknown>[] = getRegisteredProvidersOfVariant(DiVariants.CACHE);
        if (cacheProviders.length) {
            await this.logger.info(`configures ${cacheProviders.length} ${cacheProviders.length > 1 ? 'caches' : 'cache'}:`);
        }

        for (const provider of cacheProviders) {
            const cache: unknown = inject(provider.token);
            if (!isCache(cache)) {
                throw new InitCacheServiceError(
                    `Invalid class marked with @Cache: ${getDiTokenName(provider.token)} needs to implement CacheInterface`
                );
            }
            this.caches.push(cache);
            await this.logger.info(`  - ${cache.name}`);
        }

        const caches: AnyCache[] = getAllRegisteredTokens()
            .map(t => inject(t))
            .filter(i => isCache(i));
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
        // Only hit caches that actually declared these tags
        const affectedCaches: AnyCache[] = this.caches.filter(
            c => !(c instanceof MultiTierCache) && (c.tags === 'all' || matchesAnyTag(c.tags, tags))
        );
        await Promise.all(affectedCaches.map(c => c instanceof MultiTierCache ? undefined : c.store.invalidateTags(tags)));
    }
}