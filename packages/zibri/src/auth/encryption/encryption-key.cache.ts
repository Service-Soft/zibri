import { EncryptionKey } from './encryption-key.model';
import { WriteThroughReadThroughCache } from '../../caching/cache/read-through/write-through-read-through.cache';
import { CacheServiceInterface } from '../../caching/cache-service.interface';
import { Cache } from '../../caching/decorators/cache.decorator';
import { InMemoryCacheStore } from '../../caching/store/in-memory.cache-store';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { LoggerInterface } from '../../logging/logger.interface';
import { MetricsServiceInterface } from '../../metrics/metrics-service.interface';

@Cache({ register: 'onUse' })
// eslint-disable-next-line jsdoc/require-jsdoc
export class EncryptionKeyCache extends WriteThroughReadThroughCache<string, EncryptionKey, 'EncryptionKeyCache'> {

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected get logger(): LoggerInterface {
        return inject(ZIBRI_DI_TOKENS.LOGGER);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected get cacheService(): CacheServiceInterface {
        return inject(ZIBRI_DI_TOKENS.CACHE_SERVICE);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected get metricsService(): MetricsServiceInterface {
        return inject(ZIBRI_DI_TOKENS.METRICS_SERVICE);
    }

    constructor() {
        super('EncryptionKeyCache', new InMemoryCacheStore(), []);
    }
}