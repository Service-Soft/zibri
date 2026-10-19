import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { Cache } from './cache.decorator';
import { Cached } from './cached.decorator';
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
class MultiplierCache extends WriteThroughReadThroughCache<string, number, 'Cached Decorator Test Cache'> {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        protected readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.METRICS_SERVICE)
        protected readonly metricsService: MetricsServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.CACHE_SERVICE)
        protected readonly cacheService: CacheServiceInterface
    ) {
        super('Cached Decorator Test Cache', new InMemoryCacheStore(), 'all');
    }
}

class MultiplierService {
    constructor(private readonly multiplier: number) {}

    @Cached(MultiplierCache, (id: string) => `key:${id}`)
    // eslint-disable-next-line typescript/require-await
    async compute(id: string): Promise<number> {
        return id.length * this.multiplier;
    }
}

describe('Cached decorator', () => {
    let server: StartedTestServer;

    beforeAll(async () => {
        server = await startTestServer({});
    }, 30000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    beforeEach(async () => {
        await inject(MultiplierCache).store.clear();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('caches the result of the decorated method', async () => {
        const service: MultiplierService = new MultiplierService(2);

        await expect(service.compute('abc')).resolves.toBe(6);
        expect((await inject(MultiplierCache).store.get('key:abc'))?.value).toBe(6);
    });

    it('only builds the wrapped function once per instance, even across many calls', async () => {
        const cache: MultiplierCache = inject(MultiplierCache);
        // eslint-disable-next-line typescript/typedef
        const wrapSpy = jest.spyOn(cache, 'wrap');

        const service: MultiplierService = new MultiplierService(2);

        await service.compute('a');
        await service.compute('b');
        await service.compute('c');

        expect(wrapSpy).toHaveBeenCalledTimes(1);
    });

    it('keeps `this`-bound state independent across different instances', async () => {
        const doubler: MultiplierService = new MultiplierService(2);
        // eslint-disable-next-line cspell/spellchecker
        const tripler: MultiplierService = new MultiplierService(3);

        await expect(doubler.compute('abc')).resolves.toBe(6);
        // eslint-disable-next-line cspell/spellchecker
        await expect(tripler.compute('abcd')).resolves.toBe(12);

        // different cache keys — no cross-instance contamination
        expect((await inject(MultiplierCache).store.get('key:abc'))?.value).toBe(6);
        expect((await inject(MultiplierCache).store.get('key:abcd'))?.value).toBe(12);
    });

    it('builds a separate wrapped function per instance', async () => {
        const cache: MultiplierCache = inject(MultiplierCache);
        // eslint-disable-next-line typescript/typedef
        const wrapSpy = jest.spyOn(cache, 'wrap');

        const first: MultiplierService = new MultiplierService(2);
        const second: MultiplierService = new MultiplierService(3);

        await first.compute('a');
        await second.compute('a');

        expect(wrapSpy).toHaveBeenCalledTimes(2);
    });

    describe('what its key provider may take', () => {
        it('takes fewer arguments than the method, typed as the method declares them', async () => {
            // the method's arguments were inferred from the provider as well, so one reading fewer of
            // them asked for a method taking only those, and did not compile
            class Service {
                @Cached(MultiplierCache, id => `key:${id.toUpperCase()}`)
                // eslint-disable-next-line typescript/require-await
                async compute(id: string, factor: number): Promise<number> {
                    return id.length * factor;
                }
            }

            await new Service().compute('abc', 3);

            expect((await inject(MultiplierCache).store.get('key:ABC'))?.value).toBe(9);
        });

        it('refuses a provider the method does not fit', () => {
            class Service {
                // @ts-expect-error - the provider reads a number where the method takes a string
                @Cached(MultiplierCache, (id: number) => `key:${id}`)
                // eslint-disable-next-line typescript/require-await
                async compute(id: string): Promise<number> {
                    return id.length;
                }
            }

            expect(Object.getOwnPropertyNames(Service.prototype)).toContain('compute');
        });
    });
});