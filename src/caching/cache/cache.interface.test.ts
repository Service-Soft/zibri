import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { isCache } from './cache.interface';
import { WriteThroughReadThroughCache } from './read-through/write-through-read-through.cache';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { Inject } from '../../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { type LoggerInterface } from '../../logging/logger.interface';
import { type MetricsServiceInterface } from '../../metrics/metrics-service.interface';
import { type CacheServiceInterface } from '../cache-service.interface';
import { Cache } from '../decorators/cache.decorator';
import { InMemoryCacheStore } from '../store/in-memory.cache-store';

@Cache()
class IsCacheTestCache extends WriteThroughReadThroughCache<string, string, 'Is Cache Test Cache'> {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        protected readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.METRICS_SERVICE)
        protected readonly metricsService: MetricsServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.CACHE_SERVICE)
        protected readonly cacheService: CacheServiceInterface
    ) {
        super('Is Cache Test Cache', new InMemoryCacheStore(), 'all');
    }
}

describe('isCache', () => {
    let server: StartedTestServer;

    beforeAll(async () => {
        server = await startTestServer({});
    }, 15000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    it('returns true for a real cache instance', () => {
        const cache: IsCacheTestCache = inject(IsCacheTestCache);
        expect(isCache(cache)).toBe(true);
    });

    it('returns false for null and undefined', () => {
        // eslint-disable-next-line unicorn/no-null
        expect(isCache(null)).toBe(false);
        expect(isCache(undefined)).toBe(false);
    });

    it('returns false for primitives', () => {
        expect(isCache('cache')).toBe(false);
        expect(isCache(42)).toBe(false);
        expect(isCache(true)).toBe(false);
    });

    it('returns false for an object missing a single required key', () => {
        const fake: unknown = {
            name: 'Fake Cache',
            tags: 'all',
            store: {},
            defaultTtl: undefined,
            onInvalidationFailure: undefined,
            wrap: (): void => undefined,
            wrapWrite: (): void => undefined,
            wrapDelete: (): void => undefined
            // wrapInvalidate intentionally omitted
        };

        expect(isCache(fake)).toBe(false);
    });

    it('returns true for a plain object that structurally matches all required keys', () => {
        const fake: unknown = {
            name: 'Fake Cache',
            tags: 'all',
            store: {},
            defaultTtl: undefined,
            onInvalidationFailure: undefined,
            wrap: (): void => undefined,
            wrapWrite: (): void => undefined,
            wrapDelete: (): void => undefined,
            wrapInvalidate: (): void => undefined
        };

        expect(isCache(fake)).toBe(true);
    });

    it('returns false for an empty object', () => {
        expect(isCache({})).toBe(false);
    });
});