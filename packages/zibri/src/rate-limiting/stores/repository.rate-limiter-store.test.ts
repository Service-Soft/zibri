import { afterAll, afterEach, beforeAll, describe, expect, it, vi, MockInstance } from 'vitest';
import { createInMemoryDataSource } from 'zibri-testing';

import { RateLimitStateEntity } from './rate-limit-state-entity.model.ts';
import { InProcessRateLimiterLock } from './rate-limiter-lock.interface.ts';
import { BaseRateLimitState } from './rate-limiter-store.interface.ts';
import { RepositoryRateLimiterStore, RepositoryRateLimiterStoreOptions } from './repository.rate-limiter-store.ts';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { Repository } from '../../data-source/repository/repository.ts';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../di/inject.function.ts';
import { type LoggerInterface } from '../../logging/logger.interface.ts';
import { Ms } from '../../utilities/ms.ts';

/**
 * A state that counts, so that two stores writing to one row show up as a count neither wrote.
 */
type CountingState = BaseRateLimitState & {
    /**
     * How often it was written.
     */
    count: number
};

let server: StartedTestServer;

/**
 * Builds a store on the data source of the running application.
 * @param namespace - What keeps its state apart from that of every other store.
 * @param options - How the store behaves, or undefined for its defaults.
 * @returns The store.
 */
function createStore(namespace: string, options?: RepositoryRateLimiterStoreOptions): RepositoryRateLimiterStore<CountingState> {
    const repository: Repository<RateLimitStateEntity> = inject(repositoryTokenFor(RateLimitStateEntity));
    return new RepositoryRateLimiterStore<CountingState>(repository, new InProcessRateLimiterLock(), namespace, options);
}

/**
 * Counts one more write on a key.
 * @param store - The store to write to.
 * @param key - The rate limit key.
 * @returns The count after the write.
 */
async function countOn(store: RepositoryRateLimiterStore<CountingState>, key: string): Promise<number> {
    const res: { value: CountingState } = await store.atomicUpdate(key, current => ({
        expiresAtMs: Date.now() + 60_000,
        reservations: [],
        count: (current?.count ?? 0) + 1
    }));
    return res.value.count;
}

// evaluation/03-auth-and-security H21, found on the way: every limiter's state was kept under the bare
// key in one table, so two limiters keyed by user id counted on the same row
describe('RepositoryRateLimiterStore', () => {
    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [createInMemoryDataSource({ entities: [...defaultTestServerEntities, RateLimitStateEntity] })]
        });
    }, 30000);

    afterAll(async () => {
        await server.shutdown();
    }, 15000);

    it('keeps the state of each namespace apart, though they share a table and a key', async () => {
        const logins: RepositoryRateLimiterStore<CountingState> = createStore('logins');
        const uploads: RepositoryRateLimiterStore<CountingState> = createStore('uploads');

        expect(await countOn(logins, 'user:1')).toBe(1);
        expect(await countOn(logins, 'user:1')).toBe(2);
        expect(await countOn(uploads, 'user:1')).toBe(1);

        expect((await logins.get('user:1'))?.count).toBe(2);
        await uploads.delete('user:1');
        expect((await logins.get('user:1'))?.count).toBe(2);
    });

    it('reports only the keys and states of its own namespace', async () => {
        const reports: RepositoryRateLimiterStore<CountingState> = createStore('reports');
        const exports: RepositoryRateLimiterStore<CountingState> = createStore('exports');
        await countOn(reports, 'user:2');
        await countOn(exports, 'user:3');

        expect(await reports.keys()).toEqual(['user:2']);
        expect(await reports.size()).toBe(1);
        expect((await exports.getAll()).map(s => s.count)).toEqual([1]);
    });

    it('refuses a second store of a namespace in the same application', () => {
        createStore('searches');

        expect(() => createStore('searches')).toThrow(/"searches" already exists/);
    });

    describe('how many keys it holds', () => {
        afterEach(() => {
            vi.restoreAllMocks();
        });

        it('refuses a key it has never seen once it holds maxKeys, says so once, and keeps counting the keys it holds', async () => {
            // a caller cycling addresses used to grow the table at request rate, a row per address
            const store: RepositoryRateLimiterStore<CountingState> = createStore('sign-ups', { maxKeys: 2 });
            const logged: MockInstance<LoggerInterface['error']> = vi.spyOn(inject(ZIBRI_DI_TOKENS.LOGGER), 'error');
            await countOn(store, 'address:1');
            await countOn(store, 'address:2');

            await expect(countOn(store, 'address:3')).rejects.toThrow('The rate limiter store "sign-ups" is full at 2 keys.');
            await expect(countOn(store, 'address:4')).rejects.toThrow('is full at 2 keys');

            expect(logged).toHaveBeenCalledTimes(1);
            expect(await countOn(store, 'address:1')).toBe(2);
            expect(await store.get('address:3')).toBeUndefined();
        });

        it('takes a new key again once a count finds room', async () => {
            const store: RepositoryRateLimiterStore<CountingState> = createStore('invitations', { maxKeys: 1 });
            await countOn(store, 'address:1');
            await expect(countOn(store, 'address:2')).rejects.toThrow('is full at 1 keys');
            await store.delete('address:1');

            // the size is counted again at most every ten seconds, rather than on every new key
            const later: number = Date.now() + (11 * Ms.SECOND);
            vi.spyOn(Date, 'now').mockReturnValue(later);

            expect(await countOn(store, 'address:2')).toBe(1);
        });

        it('counts only the keys of its own namespace towards its limit', async () => {
            const crowded: RepositoryRateLimiterStore<CountingState> = createStore('crowded');
            await countOn(crowded, 'address:1');
            await countOn(crowded, 'address:2');
            const bounded: RepositoryRateLimiterStore<CountingState> = createStore('bounded', { maxKeys: 1 });

            expect(await countOn(bounded, 'address:1')).toBe(1);
        });
    });

    it('takes the namespace again in the next application, which builds its limiters anew', async () => {
        createStore('previews');

        await server.reInit();

        expect(() => createStore('previews')).not.toThrow();
    }, 30000);
});