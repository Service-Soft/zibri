import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInMemoryDataSource } from 'zibri-testing';

import { WriteThroughReadThroughCache } from './cache/read-through/write-through-read-through.cache.ts';
import { type CacheServiceInterface } from './cache-service.interface.ts';
import { Cache } from './decorators/cache.decorator.ts';
import { InMemoryCacheStore } from './store/in-memory.cache-store.ts';
import { defaultTestServerEntities } from '../__testing__/test-server/create-test-data-source.function.ts';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function.ts';
import { Inject } from '../di/decorators/inject.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default.ts';
import { inject } from '../di/inject.function.ts';
import { type LoggerInterface } from '../logging/logger.interface.ts';
import { type MetricsServiceInterface } from '../metrics/metrics-service.interface.ts';
import { TenantServiceInterface } from '../tenancy/tenant-service.interface.ts';
import { UUIDUtilities } from '../utilities/uuid.utilities.ts';

@Cache()
class TenancyTestCache extends WriteThroughReadThroughCache<string, string, 'TenancyTestCache'> {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        protected readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.CACHE_SERVICE)
        protected readonly cacheService: CacheServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.METRICS_SERVICE)
        protected readonly metricsService: MetricsServiceInterface
    ) {
        super('TenancyTestCache', new InMemoryCacheStore(), []);
    }
}

// in memory, so that the cache of a running application can be watched without a container
const dataSourceClass: ReturnType<typeof createInMemoryDataSource> = createInMemoryDataSource({
    entities: defaultTestServerEntities
});

describe('caches across tenants', () => {
    let server: StartedTestServer;
    let tenants: TenantServiceInterface;

    beforeAll(async () => {
        server = await startTestServer({ dataSources: [dataSourceClass] });
        tenants = inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);
    }, 30000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    it('keeps what each tenant cached under a key to that tenant, loading it at the same time included', async () => {
        const tenantA: string = UUIDUtilities.generate();
        const tenantB: string = UUIDUtilities.generate();
        let loads: number = 0;
        const cached: () => Promise<string> = inject(TenancyTestCache).wrap(
            async () => {
                loads++;
                // long enough for both tenants to be inside the load together
                await new Promise<void>(resolve => setTimeout(resolve, 50));
                return tenants.getActiveTenantId() ?? 'no tenant';
            },
            () => 'settings'
        );

        // at the same time, so a load one tenant started is not joined by the other
        const [ofA, ofB] = await Promise.all([tenants.runAs(tenantA, cached), tenants.runAs(tenantB, cached)]);
        expect([ofA, ofB]).toEqual([tenantA, tenantB]);

        // and later reads each find their own tenant's entry
        expect(await tenants.runAs(tenantB, cached)).toBe(tenantB);
        expect(await cached()).toBe('no tenant');
        expect(loads).toBe(3);
    });
});