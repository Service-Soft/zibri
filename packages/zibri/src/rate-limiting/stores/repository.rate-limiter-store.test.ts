import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { RateLimitStateEntity } from './rate-limit-state-entity.model';
import { InProcessRateLimiterLock } from './rate-limiter-lock.interface';
import { BaseRateLimitState } from './rate-limiter-store.interface';
import { RepositoryRateLimiterStore } from './repository.rate-limiter-store';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { inject } from '../../di/inject.function';

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
 * @returns The store.
 */
function createStore(namespace: string): RepositoryRateLimiterStore<CountingState> {
    const repository: Repository<RateLimitStateEntity> = inject(repositoryTokenFor(RateLimitStateEntity));
    return new RepositoryRateLimiterStore<CountingState>(repository, new InProcessRateLimiterLock(), namespace);
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

    it('takes the namespace again in the next application, which builds its limiters anew', async () => {
        createStore('previews');

        await server.reInit();

        expect(() => createStore('previews')).not.toThrow();
    }, 30000);
});