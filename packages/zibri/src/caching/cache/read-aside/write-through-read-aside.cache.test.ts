import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { WriteThroughReadAsideCache } from './write-through-read-aside.cache';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { Inject } from '../../../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { type LoggerInterface } from '../../../logging/logger.interface';
import { type MetricsServiceInterface } from '../../../metrics/metrics-service.interface';
import { type CacheServiceInterface } from '../../cache-service.interface';
import { CacheService } from '../../cache.service';
import { Cache } from '../../decorators/cache.decorator';
import { InMemoryCacheStore } from '../../store/in-memory.cache-store';

@Cache()
class MainCache extends WriteThroughReadAsideCache<string, { id: string }, 'Write Through Read Aside Main Cache'> {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        protected readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.METRICS_SERVICE)
        protected readonly metricsService: MetricsServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.CACHE_SERVICE)
        protected readonly cacheService: CacheServiceInterface
    ) {
        super('Write Through Read Aside Main Cache', new InMemoryCacheStore(), 'all');
    }
}

describe('WriteThroughReadAsideCache', () => {
    let server: StartedTestServer;
    let cacheService: CacheService;

    beforeAll(async () => {
        server = await startTestServer({});
        cacheService = inject(ZIBRI_DI_TOKENS.CACHE_SERVICE) as CacheService;
    }, 15000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    beforeEach(async () => {
        cacheService.caches.length = 0;
        await inject(MainCache).store.clear();
    });

    it('wrapWrite writes the result to the cache synchronously before resolving', async () => {
        const cache: MainCache = inject(MainCache);

        // eslint-disable-next-line typescript/typedef
        const fn = (name: string): { id: string } => ({ id: `id:${name}` });
        // eslint-disable-next-line typescript/typedef
        const wrapped = cache.wrapWrite(fn, (result) => result.id);

        await expect(wrapped('abc')).resolves.toEqual({ id: 'id:abc' });

        // synchronous — no need to flush microtasks
        expect((await cache.store.get('id:abc'))?.value).toEqual({ id: 'id:abc' });
    });

    it('wrapWrite still resolves with the source value if the store write fails', async () => {
        const cache: MainCache = inject(MainCache);
        // eslint-disable-next-line typescript/typedef
        const setSpy = jest.spyOn(cache.store, 'set').mockImplementation(() => {
            throw new Error('store unavailable');
        });

        try {
            // eslint-disable-next-line typescript/typedef
            const fn = (name: string): { id: string } => ({ id: `id:${name}` });
            // eslint-disable-next-line typescript/typedef
            const wrapped = cache.wrapWrite(fn, (result) => result.id);

            await expect(wrapped('abc')).resolves.toEqual({ id: 'id:abc' });
        }
        finally {
            setSpy.mockRestore();
        }
    });

    it('setDirect stores the given value synchronously', async () => {
        const cache: MainCache = inject(MainCache);

        await cache.setDirect('id:direct', { id: 'id:direct' });

        expect((await cache.store.get('id:direct'))?.value).toEqual({ id: 'id:direct' });
    });

    it('setDirect swallows store failures', async () => {
        const cache: MainCache = inject(MainCache);
        // eslint-disable-next-line typescript/typedef
        const setSpy = jest.spyOn(cache.store, 'set').mockImplementation(() => {
            throw new Error('store unavailable');
        });

        try {
            await expect(cache.setDirect('id:direct', { id: 'id:direct' })).resolves.toBeUndefined();
        }
        finally {
            setSpy.mockRestore();
        }
    });
});