import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { WriteInvalidateReadThroughArgsOnlyCache } from './write-invalidate-read-through-args-only.cache';
import { TestTimeouts } from '../../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { Inject } from '../../../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { type LoggerInterface } from '../../../logging/logger.interface';
import { type MetricsServiceInterface } from '../../../metrics/metrics-service.interface';
import { type CacheServiceInterface } from '../../cache-service.interface';
import { Cache } from '../../decorators/cache.decorator';
import { InMemoryCacheStore } from '../../store/in-memory.cache-store';

@Cache()
class RowCache extends WriteInvalidateReadThroughArgsOnlyCache<string, string, 'Row Cache'> {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        protected readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.METRICS_SERVICE)
        protected readonly metricsService: MetricsServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.CACHE_SERVICE)
        protected readonly cacheService: CacheServiceInterface
    ) {
        super('Row Cache', new InMemoryCacheStore(), 'all');
    }
}

/**
 * A read of the source that answers with what the row held when it started, once it is let go.
 */
type SlowRead = {
    /**
     * Resolves once the read has taken what the row holds.
     */
    started: Promise<void>,
    /**
     * Lets the read answer.
     */
    letGo: () => void,
    /**
     * The value the cache hands back for it.
     */
    result: Promise<string>
};

// a read that started before a write answers with what the row held then. Cached after the write,
// that old value was what every later read on the writing instance got
describe('a read of the source that a write overtakes', () => {
    let server: StartedTestServer;
    let row: string;

    /**
     * Starts a read of the row through the cache, held until it is let go.
     * @param tags - The tags the read caches its value under.
     * @returns The read.
     */
    function startSlowRead(tags: string[] = []): SlowRead {
        let letGo: () => void = () => undefined;
        let markStarted: () => void = () => undefined;
        const gate: Promise<void> = new Promise<void>(resolve => {
            letGo = resolve;
        });
        const started: Promise<void> = new Promise<void>(resolve => {
            markStarted = resolve;
        });
        const result: Promise<string> = inject(RowCache).wrap(async () => {
            const value: string = row;
            markStarted();
            await gate;
            return value;
        }, () => 'row', { tags })();
        return { started, letGo, result };
    }

    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories })]
        });
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    beforeEach(async () => {
        row = 'v0';
        await inject(RowCache).store.clear();
    });

    it('does not cache what it read before a write to its key', async () => {
        const read: SlowRead = startSlowRead();
        await read.started;
        row = 'v1';
        await inject(RowCache).wrapWrite(() => row, () => 'row')();
        read.letGo();
        expect(await read.result).toBe('v0');

        expect(await inject(RowCache).wrap(() => row, () => 'row')()).toBe('v1');
    });

    it('does not cache what it read before an invalidation of its tags', async () => {
        const read: SlowRead = startSlowRead(['rows']);
        await read.started;
        row = 'v1';
        await inject(RowCache).store.invalidateTags(['rows']);
        read.letGo();
        await read.result;

        expect(await inject(RowCache).wrap(() => row, () => 'row')()).toBe('v1');
    });
});