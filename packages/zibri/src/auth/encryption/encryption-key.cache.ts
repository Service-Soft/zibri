import { EncryptionKey } from './encryption-key.model.ts';
import { WriteThroughReadThroughCache } from '../../caching/cache/read-through/write-through-read-through.cache.ts';
import { CacheServiceInterface } from '../../caching/cache-service.interface.ts';
import { Cache } from '../../caching/decorators/cache.decorator.ts';
import { InMemoryCacheStore } from '../../caching/store/in-memory.cache-store.ts';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../di/inject.function.ts';
import { LoggerInterface } from '../../logging/logger.interface.ts';
import { MetricsServiceInterface } from '../../metrics/metrics-service.interface.ts';

@Cache({ register: 'onUse' })
// eslint-disable-next-line jsdoc-js/require-jsdoc
export class EncryptionKeyCache extends WriteThroughReadThroughCache<string, EncryptionKey, 'EncryptionKeyCache'> {

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    protected get logger(): LoggerInterface {
        return inject(ZIBRI_DI_TOKENS.LOGGER);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    protected get cacheService(): CacheServiceInterface {
        return inject(ZIBRI_DI_TOKENS.CACHE_SERVICE);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    protected get metricsService(): MetricsServiceInterface {
        return inject(ZIBRI_DI_TOKENS.METRICS_SERVICE);
    }

    constructor() {
        super('EncryptionKeyCache', new InMemoryCacheStore(), []);
    }
}