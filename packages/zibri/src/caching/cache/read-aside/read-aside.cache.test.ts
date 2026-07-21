import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { WriteAroundReadAsideCache } from './write-around-read-aside.cache';
import { flushMicrotasks } from '../../../__testing__/constants';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { Inject } from '../../../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { type LoggerInterface } from '../../../logging/logger.interface';
import { type MetricsServiceInterface } from '../../../metrics/metrics-service.interface';
import { type CacheServiceInterface } from '../../cache-service.interface';
import { Cache } from '../../decorators/cache.decorator';
import { CachedValue } from '../../store/cached-value.model';
import { InMemoryCacheStore } from '../../store/in-memory.cache-store';

@Cache()
class ReadAsideTestCache extends WriteAroundReadAsideCache<string, number, 'Read Aside Test Cache'> {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        protected readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.METRICS_SERVICE)
        protected readonly metricsService: MetricsServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.CACHE_SERVICE)
        protected readonly cacheService: CacheServiceInterface
    ) {
        super('Read Aside Test Cache', new InMemoryCacheStore(), 'all');
    }
}

function createCachedValue<V>(value: V, tags: string[], createdAt: Date, expiresAt?: Date): CachedValue<V> {
    return { value, tags, createdAt, expiresAt };
}

describe('ReadAsideCache', () => {
    let server: StartedTestServer;

    beforeAll(async () => {
        server = await startTestServer({});
    }, 15000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    beforeEach(async () => {
        await inject(ReadAsideTestCache).store.clear();
    });

    it('returns a cached value without calling fn on a hit', async () => {
        const cache: ReadAsideTestCache = inject(ReadAsideTestCache);
        await cache.store.set('key:a', createCachedValue(123, ['tag-a'], new Date()));

        // eslint-disable-next-line typescript/typedef, unusedImports/no-unused-vars
        const fn = jest.fn((_id: string): number => 999);
        // eslint-disable-next-line typescript/typedef
        const wrapped = cache.wrap(fn, (id) => `key:${id}`);

        await expect(wrapped('a')).resolves.toBe(123);
        expect(fn).not.toHaveBeenCalled();
    });

    it('calls fn on a miss and never populates the cache', async () => {
        const cache: ReadAsideTestCache = inject(ReadAsideTestCache);

        // eslint-disable-next-line typescript/typedef
        const fn = jest.fn((id: string): number => id.length);
        // eslint-disable-next-line typescript/typedef
        const wrapped = cache.wrap(fn, (id) => `key:${id}`);

        await expect(wrapped('abc')).resolves.toBe(3);
        expect(fn).toHaveBeenCalledTimes(1);

        // read-aside never writes back to the store on a miss
        expect(await cache.store.get('key:abc')).toBeUndefined();

        // calling again recomputes, since nothing was cached
        await expect(wrapped('abc')).resolves.toBe(3);
        expect(fn).toHaveBeenCalledTimes(2);
    });

    it('evicts an expired entry and still treats it as a miss without repopulating', async () => {
        await inject(ReadAsideTestCache).store.set(
            'key:a',
            createCachedValue(123, ['tag-a'], new Date('2025-01-01T00:00:00.000Z'), new Date('2025-01-01T00:00:01.000Z'))
        );

        const cache: ReadAsideTestCache = inject(ReadAsideTestCache);
        // eslint-disable-next-line typescript/typedef
        const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(new Date('2025-01-01T00:00:02.000Z').getTime());

        try {
            // eslint-disable-next-line typescript/typedef, unusedImports/no-unused-vars
            const fn = jest.fn((_id: string): number => 999);
            // eslint-disable-next-line typescript/typedef
            const wrapped = cache.wrap(fn, (id) => `key:${id}`);

            await expect(wrapped('a')).resolves.toBe(999);
            expect(fn).toHaveBeenCalledTimes(1);
            // the expired entry was evicted, and read-aside did not restore it
            expect(await cache.store.get('key:a')).toBeUndefined();
        }
        finally {
            nowSpy.mockRestore();
        }
    });

    it('dedupes concurrent misses for the same key via single-flight', async () => {
        const cache: ReadAsideTestCache = inject(ReadAsideTestCache);

        let resolveFn!: (value: number) => void;
        // eslint-disable-next-line typescript/typedef, unusedImports/no-unused-vars
        const fn = jest.fn((_id: string) => new Promise<number>(resolve => {
            resolveFn = resolve;
        }));

        // eslint-disable-next-line typescript/typedef
        const wrapped = cache.wrap(fn, (id) => `key:${id}`);
        // eslint-disable-next-line typescript/typedef
        const first = wrapped('a');
        // eslint-disable-next-line typescript/typedef
        const second = wrapped('a');

        await flushMicrotasks();
        expect(fn).toHaveBeenCalledTimes(1);

        resolveFn(123);

        await expect(first).resolves.toBe(123);
        await expect(second).resolves.toBe(123);
        // still never written to the store
        expect(await cache.store.get('key:a')).toBeUndefined();
    });
});