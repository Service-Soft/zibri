import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { CacheDelete } from './cache-delete.decorator.ts';
import { Cache } from './cache.decorator.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { Inject } from '../../di/decorators/inject.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../di/inject.function.ts';
import { type LoggerInterface } from '../../logging/logger.interface.ts';
import { type MetricsServiceInterface } from '../../metrics/metrics-service.interface.ts';
import { WriteThroughReadThroughCache } from '../cache/read-through/write-through-read-through.cache.ts';
import { type CacheServiceInterface } from '../cache-service.interface.ts';
import { CachedValue } from '../store/cached-value.model.ts';
import { InMemoryCacheStore } from '../store/in-memory.cache-store.ts';

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
        vi.restoreAllMocks();
    });

    it('deletes the resolved key after the decorated method runs', async () => {
        await inject(DeleteTestCache).store.set('key:abc', createCachedValue('stale', []));
        const service: DeleteService = new DeleteService();

        await expect(service.remove('abc')).resolves.toBe('removed:abc');
        expect(await inject(DeleteTestCache).store.get('key:abc')).toBeUndefined();
    });

    it('only builds the wrapped function once per instance', async () => {
        const cache: DeleteTestCache = inject(DeleteTestCache);
        // eslint-disable-next-line typescript-js/typedef
        const wrapDeleteSpy = vi.spyOn(cache, 'wrapDelete');

        const service: DeleteService = new DeleteService();
        await service.remove('a');
        await service.remove('b');

        expect(wrapDeleteSpy).toHaveBeenCalledTimes(1);
    });

    it('builds a separate wrapped function per instance', async () => {
        const cache: DeleteTestCache = inject(DeleteTestCache);
        // eslint-disable-next-line typescript-js/typedef
        const wrapDeleteSpy = vi.spyOn(cache, 'wrapDelete');

        await new DeleteService().remove('a');
        await new DeleteService().remove('a');

        expect(wrapDeleteSpy).toHaveBeenCalledTimes(2);
    });

    describe('what its key provider may take', () => {
        it('takes fewer arguments than the method, typed as the method declares them', async () => {
            // the method's arguments were inferred from the provider as well, so one reading fewer of
            // them asked for a method taking only those, and did not compile
            class Service {
                @CacheDelete(DeleteTestCache, id => `key:${id.toUpperCase()}`)
                // eslint-disable-next-line typescript/require-await
                async remove(id: string, reason: string): Promise<string> {
                    return `removed:${id}:${reason}`;
                }
            }
            await inject(DeleteTestCache).store.set('key:ABC', createCachedValue('stale', []));

            await new Service().remove('abc', 'outdated');

            expect(await inject(DeleteTestCache).store.get('key:ABC')).toBeUndefined();
        });

        it('refuses a provider the method does not fit', () => {
            class Service {
                // @ts-expect-error - the provider reads a number where the method takes a string
                @CacheDelete(DeleteTestCache, (id: number) => `key:${id}`)
                // eslint-disable-next-line typescript/require-await
                async remove(id: string): Promise<string> {
                    return id;
                }
            }

            expect(Object.getOwnPropertyNames(Service.prototype)).toContain('remove');
        });
    });
});