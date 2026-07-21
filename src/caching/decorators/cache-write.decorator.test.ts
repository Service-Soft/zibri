import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { CacheWrite } from './cache-write.decorator';
import { Cache } from './cache.decorator';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { Inject } from '../../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { type LoggerInterface } from '../../logging/logger.interface';
import { type MetricsServiceInterface } from '../../metrics/metrics-service.interface';
import { WriteThroughReadThroughCache } from '../cache/read-through/write-through-read-through.cache';
import { type CacheServiceInterface } from '../cache-service.interface';
import { InMemoryCacheStore } from '../store/in-memory.cache-store';

@Cache()
class WriteTestCache extends WriteThroughReadThroughCache<string, { id: string }, 'Cache Write Decorator Test Cache'> {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        protected readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.METRICS_SERVICE)
        protected readonly metricsService: MetricsServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.CACHE_SERVICE)
        protected readonly cacheService: CacheServiceInterface
    ) {
        super('Cache Write Decorator Test Cache', new InMemoryCacheStore(), 'all');
    }
}

class WriteService {
    @CacheWrite(WriteTestCache, (result: { id: string }) => result.id)
    // eslint-disable-next-line typescript/require-await
    async create(name: string): Promise<{ id: string }> {
        return { id: `id:${name}` };
    }
}

describe('CacheWrite decorator', () => {
    let server: StartedTestServer;

    beforeAll(async () => {
        server = await startTestServer({});
    }, 15000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    beforeEach(async () => {
        await inject(WriteTestCache).store.clear();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('writes the result of the decorated method into the cache', async () => {
        const service: WriteService = new WriteService();

        await expect(service.create('abc')).resolves.toEqual({ id: 'id:abc' });
        expect((await inject(WriteTestCache).store.get('id:abc'))?.value).toEqual({ id: 'id:abc' });
    });

    it('only builds the wrapped function once per instance', async () => {
        const cache: WriteTestCache = inject(WriteTestCache);
        // eslint-disable-next-line typescript/typedef
        const wrapWriteSpy = jest.spyOn(cache, 'wrapWrite');

        const service: WriteService = new WriteService();
        await service.create('a');
        await service.create('b');

        expect(wrapWriteSpy).toHaveBeenCalledTimes(1);
    });

    it('builds a separate wrapped function per instance', async () => {
        const cache: WriteTestCache = inject(WriteTestCache);
        // eslint-disable-next-line typescript/typedef
        const wrapWriteSpy = jest.spyOn(cache, 'wrapWrite');

        await new WriteService().create('a');
        await new WriteService().create('a');

        expect(wrapWriteSpy).toHaveBeenCalledTimes(2);
    });
});