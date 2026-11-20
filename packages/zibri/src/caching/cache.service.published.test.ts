import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { Inject } from '../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { type LoggerInterface } from '../logging/logger.interface';
import { type MetricsServiceInterface } from '../metrics/metrics-service.interface';
import { WriteThroughReadThroughCache } from './cache/read-through/write-through-read-through.cache';
import { type CacheServiceInterface } from './cache-service.interface';
import { Cache } from './decorators/cache.decorator';
import { InMemoryCacheStore } from './store/in-memory.cache-store';

/**
 * The tag the value is cached under.
 */
const NOTES_TAG: 'published-notes' = 'published-notes';

@Cache()
class PublishedNotesCache extends WriteThroughReadThroughCache<string, number, 'PublishedNotesCache', typeof NOTES_TAG> {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        protected readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.CACHE_SERVICE)
        protected readonly cacheService: CacheServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.METRICS_SERVICE)
        protected readonly metricsService: MetricsServiceInterface
    ) {
        super('PublishedNotesCache', new InMemoryCacheStore(), [NOTES_TAG]);
    }
}

// in memory, so that what an instance applies of what it published itself can be watched without a container
const dataSourceClass: ReturnType<typeof createInMemoryDataSource> = createInMemoryDataSource({
    entities: defaultTestServerEntities,
    repositories: defaultTestServerRepositories
});

/**
 * How often the value was read from its source rather than from the cache.
 */
let loads: number = 0;

async function readNotes(): Promise<number> {
    return await inject(PublishedNotesCache).wrap(
        () => {
            loads++;
            return loads;
        },
        () => 'notes',
        { tags: () => [NOTES_TAG] }
    )();
}

describe('CacheService - what an instance published itself', () => {
    let server: StartedTestServer | undefined;

    beforeAll(async () => {
        server = await startTestServer({ dataSources: [dataSourceClass] });
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    it('applies an invalidation it published once, when it published it, rather than again at the next poll', async () => {
        await readNotes();
        await inject(ZIBRI_DI_TOKENS.CACHE_SERVICE).invalidateTags([NOTES_TAG]);
        // filled again after the invalidation
        await readNotes();
        const filled: number = loads;

        await inject(ZIBRI_DI_TOKENS.CACHE_SERVICE).applyPendingInvalidations();

        await readNotes();
        expect(loads).toBe(filled);
    });
});