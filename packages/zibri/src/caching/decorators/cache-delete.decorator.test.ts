import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { CacheDelete } from './cache-delete.decorator';
import { Cache } from './cache.decorator';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { Inject } from '../../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { type LoggerInterface } from '../../logging/logger.interface';
import { type MetricsServiceInterface } from '../../metrics/metrics-service.interface';
import { WriteThroughReadThroughCache } from '../cache/read-through/write-through-read-through.cache';
import { type CacheServiceInterface } from '../cache-service.interface';
import { CachedValue } from '../store/cached-value.model';
import { InMemoryCacheStore } from '../store/in-memory.cache-store';

@Cache()
class DeleteTestCache extends WriteThroughReadThroughCache<string, string, 'Cache Delete Decorator Test Cache'> {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        protected readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.METRICS_SERVICE)
        protected readonly metricsService: MetricsServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.CACHE_SERVICE)
        protected readonly cacheService: CacheServiceInterface
    ) {
        super('Cache Delete Decorator Test Cache', new InMemoryCacheStore(), 'all');
    }
}

class DeleteService {
    @CacheDelete(DeleteTestCache, (id: string) => `key:${id}`)
    // eslint-disable-next-line typescript/require-await
    async remove(id: string): Promise<string> {
        return `removed:${id}`;
    }
}

function createCachedValue<V>(value: V, tags: string[]): CachedValue<V> {
    return { value, tags, createdAt: new Date() };
}

describe('CacheDelete decorator', () => {
    let server: StartedTestServer;

    beforeAll(async () => {
        server = await startTestServer({});
    }, 15000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    beforeEach(async () => {
        await inject(DeleteTestCache).store.clear();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('deletes the resolved key after the decorated method runs', async () => {
        await inject(DeleteTestCache).store.set('key:abc', createCachedValue('stale', []));
        const service: DeleteService = new DeleteService();

        await expect(service.remove('abc')).resolves.toBe('removed:abc');
        expect(await inject(DeleteTestCache).store.get('key:abc')).toBeUndefined();
    });

    it('only builds the wrapped function once per instance', async () => {
        const cache: DeleteTestCache = inject(DeleteTestCache);
        // eslint-disable-next-line typescript/typedef
        const wrapDeleteSpy = jest.spyOn(cache, 'wrapDelete');

        const service: DeleteService = new DeleteService();
        await service.remove('a');
        await service.remove('b');

        expect(wrapDeleteSpy).toHaveBeenCalledTimes(1);
    });

    it('builds a separate wrapped function per instance', async () => {
        const cache: DeleteTestCache = inject(DeleteTestCache);
        // eslint-disable-next-line typescript/typedef
        const wrapDeleteSpy = jest.spyOn(cache, 'wrapDelete');

        await new DeleteService().remove('a');
        await new DeleteService().remove('a');

        expect(wrapDeleteSpy).toHaveBeenCalledTimes(2);
    });
});