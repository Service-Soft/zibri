import { describe, expect, it } from 'vitest';

import { CachedValue } from './cached-value.model.ts';
import { InMemoryCacheStore } from './in-memory.cache-store.ts';
import { Bytes } from '../../utilities/bytes.ts';
import { JsonUtilities } from '../../utilities/json.utilities.ts';

function createCachedValue<V>(value: V, tags: string[]): CachedValue<V> {
    return {
        value,
        tags,
        createdAt: new Date()
    };
}

/**
 * A cached value whose time to live has already run out.
 * @param value - The value to cache.
 * @returns The cached value, expired a second ago.
 */
function createExpiredValue<V>(value: V): CachedValue<V> {
    return {
        value,
        tags: [],
        createdAt: new Date(Date.now() - 2000),
        expiresAt: new Date(Date.now() - 1000)
    };
}

describe('InMemoryCacheStore', () => {
    it('holds enough by default to be worth having', () => {
        const store: InMemoryCacheStore<string, number> = new InMemoryCacheStore();

        // the old defaults were 500 entries and 750 KB, which a single page of any real response
        // fills - so the cache evicted what it had just written and the hit rate never left the floor
        expect(store.config.maxEntries).toBe(5000);
        expect(store.config.maxBytes).toBe(Bytes.MB * 25);
    });

    it('returns undefined for missing keys', () => {
        const store: InMemoryCacheStore<string, number> = new InMemoryCacheStore();

        expect(store.get('missing')).toBeUndefined();
        expect(store.has('missing')).toBe(false);
    });

    describe('object keys', () => {
        /**
         * What a key provider returning an object produces: a new object per call, equal to the last
         * one and never the same reference.
         */
        type UserKey = {
            /** Who the value belongs to. */
            userId: string,
            /** Which tenant they were read for. */
            tenantId: string
        };

        it('finds a value stored under an equal key rather than the identical one', () => {
            const store: InMemoryCacheStore<UserKey, number> = new InMemoryCacheStore();

            store.set({ userId: 'u1', tenantId: 't1' }, createCachedValue(1, []));

            // keyed by reference this misses every time, so the cache silently never hits - and the
            // valkey store, which resolves the key to a string, hits normally on the same declaration
            expect(store.get({ userId: 'u1', tenantId: 't1' })?.value).toBe(1);
            expect(store.has({ userId: 'u1', tenantId: 't1' })).toBe(true);
        });

        it('keeps different keys apart', () => {
            const store: InMemoryCacheStore<UserKey, number> = new InMemoryCacheStore();

            store.set({ userId: 'u1', tenantId: 't1' }, createCachedValue(1, []));
            store.set({ userId: 'u2', tenantId: 't1' }, createCachedValue(2, []));

            expect(store.get({ userId: 'u1', tenantId: 't1' })?.value).toBe(1);
            expect(store.get({ userId: 'u2', tenantId: 't1' })?.value).toBe(2);
            expect(store.size()).toBe(2);
        });

        it('overwrites rather than duplicating when the same key is stored twice', () => {
            const store: InMemoryCacheStore<UserKey, number> = new InMemoryCacheStore();

            store.set({ userId: 'u1', tenantId: 't1' }, createCachedValue(1, []));
            store.set({ userId: 'u1', tenantId: 't1' }, createCachedValue(2, []));

            expect(store.size()).toBe(1);
            expect(store.get({ userId: 'u1', tenantId: 't1' })?.value).toBe(2);
        });

        it('deletes by an equal key', () => {
            const store: InMemoryCacheStore<UserKey, number> = new InMemoryCacheStore();

            store.set({ userId: 'u1', tenantId: 't1' }, createCachedValue(1, []));
            store.delete({ userId: 'u1', tenantId: 't1' });

            expect(store.has({ userId: 'u1', tenantId: 't1' })).toBe(false);
            expect(store.size()).toBe(0);
        });
    });

    it('stores and retrieves values', () => {
        const store: InMemoryCacheStore<string, number> = new InMemoryCacheStore();

        store.set('a', createCachedValue(1, ['tag-a']));

        expect(store.get('a')?.value).toBe(1);
        expect(store.get('a')?.tags).toEqual(['tag-a']);
        expect(store.has('a')).toBe(true);
    });

    it('overwrites existing values for the same key', () => {
        const store: InMemoryCacheStore<string, number> = new InMemoryCacheStore();

        store.set('a', createCachedValue(1, ['tag-a']));
        store.set('a', createCachedValue(2, ['tag-b']));

        expect(store.get('a')?.value).toBe(2);
        expect(store.get('a')?.tags).toEqual(['tag-b']);
        expect(store.has('a')).toBe(true);
    });

    it('deletes values by key', () => {
        const store: InMemoryCacheStore<string, number> = new InMemoryCacheStore();

        store.set('a', createCachedValue(1, ['tag-a']));
        store.delete('a');

        expect(store.get('a')).toBeUndefined();
        expect(store.has('a')).toBe(false);
    });

    it('clears all values', () => {
        const store: InMemoryCacheStore<string, number> = new InMemoryCacheStore();

        store.set('a', createCachedValue(1, ['tag-a']));
        store.set('b', createCachedValue(2, ['tag-b']));

        store.clear();

        expect(store.get('a')).toBeUndefined();
        expect(store.get('b')).toBeUndefined();
        expect(store.has('a')).toBe(false);
        expect(store.has('b')).toBe(false);
    });

    it('invalidates only entries with matching tags', () => {
        const store: InMemoryCacheStore<string, number> = new InMemoryCacheStore();

        store.set('a', createCachedValue(1, ['tag-a', 'tag-common']));
        store.set('b', createCachedValue(2, ['tag-b']));
        store.set('c', createCachedValue(3, ['tag-common']));

        store.invalidateTags(['tag-common']);

        expect(store.get('a')).toBeUndefined();
        expect(store.get('b')?.value).toBe(2);
        expect(store.get('c')).toBeUndefined();
    });

    it('invalidates entries matching any provided tag', () => {
        const store: InMemoryCacheStore<string, number> = new InMemoryCacheStore();

        store.set('a', createCachedValue(1, ['tag-a']));
        store.set('b', createCachedValue(2, ['tag-b']));
        store.set('c', createCachedValue(3, ['tag-c']));

        store.invalidateTags(['tag-b', 'tag-c']);

        expect(store.get('a')?.value).toBe(1);
        expect(store.get('b')).toBeUndefined();
        expect(store.get('c')).toBeUndefined();
    });

    it('does nothing when invalidateTags receives no matching tags', () => {
        const store: InMemoryCacheStore<string, number> = new InMemoryCacheStore();

        store.set('a', createCachedValue(1, ['tag-a']));

        store.invalidateTags(['tag-x']);

        expect(store.get('a')?.value).toBe(1);
    });

    it('can handle invalidating an empty cache', () => {
        const store: InMemoryCacheStore<string, number> = new InMemoryCacheStore();

        expect(() => store.invalidateTags(['tag-a'])).not.toThrow();
    });

    it('keeps stored object references intact', () => {
        type Value = { name: string, nested: { id: number } };
        const store: InMemoryCacheStore<string, Value> = new InMemoryCacheStore();
        const value: Value = { name: 'x', nested: { id: 1 } };

        store.set('a', createCachedValue(value, ['tag-a']));

        expect(store.get('a')?.value).toBe(value);
    });

    describe('eviction on maxEntries overflow', () => {
        it('leastRecentlyUsed evicts the entry that was accessed longest ago', () => {
            const store: InMemoryCacheStore<string, number> = new InMemoryCacheStore({
                maxEntries: 2,
                removeOnOverflow: 'leastRecentlyUsed'
            });

            store.set('a', createCachedValue(1, []));
            store.set('b', createCachedValue(2, []));
            // touch 'a' so 'b' becomes the least recently used
            store.get('a');
            store.set('c', createCachedValue(3, []));

            expect(store.has('a')).toBe(true);
            expect(store.has('b')).toBe(false);
            expect(store.has('c')).toBe(true);
        });

        it('mostRecentlyUsed evicts the entry that was accessed most recently', () => {
            const store: InMemoryCacheStore<string, number> = new InMemoryCacheStore({
                maxEntries: 2,
                removeOnOverflow: 'mostRecentlyUsed'
            });

            store.set('a', createCachedValue(1, []));
            store.set('b', createCachedValue(2, []));
            // touch 'a' so it becomes the most recently used (moved to tail)
            store.get('a');
            store.set('c', createCachedValue(3, []));

            expect(store.has('a')).toBe(false);
            expect(store.has('b')).toBe(true);
            expect(store.has('c')).toBe(true);
        });

        it('firstInFirstOut evicts in insertion order regardless of access', () => {
            const store: InMemoryCacheStore<string, number> = new InMemoryCacheStore({
                maxEntries: 2,
                removeOnOverflow: 'firstInFirstOut'
            });

            store.set('a', createCachedValue(1, []));
            store.set('b', createCachedValue(2, []));
            // accessing 'a' must NOT change FIFO order
            store.get('a');
            store.set('c', createCachedValue(3, []));

            expect(store.has('a')).toBe(false);
            expect(store.has('b')).toBe(true);
            expect(store.has('c')).toBe(true);
        });

        it('leastFrequentlyUsed evicts the entry with the lowest access frequency', () => {
            const store: InMemoryCacheStore<string, number> = new InMemoryCacheStore({
                maxEntries: 2,
                removeOnOverflow: 'leastFrequentlyUsed'
            });

            store.set('a', createCachedValue(1, []));
            store.set('b', createCachedValue(2, []));
            // access 'a' repeatedly to raise its frequency above 'b'
            store.get('a');
            store.get('a');
            store.set('c', createCachedValue(3, []));

            expect(store.has('a')).toBe(true);
            expect(store.has('b')).toBe(false);
            expect(store.has('c')).toBe(true);
        });

        it('overwriting an existing key does not evict anything even at capacity', () => {
            const store: InMemoryCacheStore<string, number> = new InMemoryCacheStore({
                maxEntries: 2,
                removeOnOverflow: 'leastRecentlyUsed'
            });

            store.set('a', createCachedValue(1, []));
            store.set('b', createCachedValue(2, []));
            store.set('a', createCachedValue(10, []));

            expect(store.size()).toBe(2);
            expect(store.get('a')?.value).toBe(10);
            expect(store.get('b')?.value).toBe(2);
        });
    });

    describe('eviction on maxBytes overflow', () => {
        it('evicts entries once the estimated byte size would exceed maxBytes', () => {
            const sampleValue: CachedValue<string> = createCachedValue('a-value', []);
            const singleEntryByteSize: number = Buffer.byteLength(JsonUtilities.stringify({ key: 'a', value: sampleValue }), 'utf8');

            const store: InMemoryCacheStore<string, string> = new InMemoryCacheStore({
                maxEntries: 500,
                // room for exactly one entry of this size, not two
                maxBytes: singleEntryByteSize + 5,
                removeOnOverflow: 'leastRecentlyUsed'
            });

            store.set('a', createCachedValue('a-value', []));
            store.set('b', createCachedValue('b-value', []));

            expect(store.has('a')).toBe(false);
            expect(store.has('b')).toBe(true);
        });

        it('skips caching a single entry that alone exceeds the store capacity', () => {
            const store: InMemoryCacheStore<string, string> = new InMemoryCacheStore({
                maxEntries: 500,
                maxBytes: 1,
                removeOnOverflow: 'leastRecentlyUsed'
            });

            store.set('huge', createCachedValue('x'.repeat(1000), []));

            expect(store.has('huge')).toBe(false);
            expect(store.size()).toBe(0);
        });

        it('falls back to a fixed byte estimate when the value cannot be stringified', () => {
            const store: InMemoryCacheStore<string, unknown> = new InMemoryCacheStore({
                maxEntries: 500,
                maxBytes: 750 * 1024,
                removeOnOverflow: 'leastRecentlyUsed'
            });

            const circular: Record<string, unknown> = {};
            circular['self'] = circular;

            expect(() => store.set('circular', createCachedValue(circular, []))).not.toThrow();
            expect(store.get('circular')?.value).toBe(circular);
        });
    });

    describe('expiry', () => {
        it('reports a miss for an entry whose time to live has run out', () => {
            const store: InMemoryCacheStore<string, number> = new InMemoryCacheStore();

            store.set('a', createExpiredValue(1));

            expect(store.get('a')).toBeUndefined();
            expect(store.has('a')).toBe(false);
        });

        it('takes an expired entry out of the store rather than leaving it in the budget', () => {
            const store: InMemoryCacheStore<string, number> = new InMemoryCacheStore();

            store.set('a', createExpiredValue(1));
            store.get('a');

            expect(store.size()).toBe(0);
        });

        it('does not promote an expired entry over a live one on the read that finds it', () => {
            const store: InMemoryCacheStore<string, number> = new InMemoryCacheStore({
                maxEntries: 2,
                removeOnOverflow: 'leastRecentlyUsed'
            });

            store.set('dead', createExpiredValue(1));
            store.set('live', createCachedValue(2, []));

            // reading it is what used to keep it: recordAccess ran before anyone discovered the
            // entry was expired, so the dead entry became the most recently used one
            store.get('dead');
            store.get('dead');

            store.set('new', createCachedValue(3, []));

            expect(store.has('live')).toBe(true);
            expect(store.has('new')).toBe(true);
            expect(store.has('dead')).toBe(false);
        });

        it('frees the room an expired entry held for the next write', () => {
            const store: InMemoryCacheStore<string, number> = new InMemoryCacheStore({
                maxEntries: 2,
                removeOnOverflow: 'leastRecentlyUsed'
            });

            store.set('dead', createExpiredValue(1));
            store.set('live', createCachedValue(2, []));
            store.removeExpired();
            store.set('new', createCachedValue(3, []));

            // nothing live was evicted to make room, because the room was already there
            expect(store.has('live')).toBe(true);
            expect(store.has('new')).toBe(true);
        });

        describe('removeExpired', () => {
            it('removes every entry whose time to live has run out', () => {
                const store: InMemoryCacheStore<string, number> = new InMemoryCacheStore();

                store.set('a', createExpiredValue(1));
                store.set('b', createCachedValue(2, []));
                store.set('c', createExpiredValue(3));

                expect(store.removeExpired()).toBe(2);
                expect(store.size()).toBe(1);
                expect(store.get('b')?.value).toBe(2);
            });

            it('leaves an entry that has not expired yet alone', () => {
                const store: InMemoryCacheStore<string, number> = new InMemoryCacheStore();

                store.set('a', {
                    value: 1,
                    tags: [],
                    createdAt: new Date(),
                    expiresAt: new Date(Date.now() + 60000)
                });

                expect(store.removeExpired()).toBe(0);
                expect(store.get('a')?.value).toBe(1);
            });

            it('counts the expired entries a read removed before it ran', () => {
                const store: InMemoryCacheStore<string, number> = new InMemoryCacheStore();

                store.set('a', createExpiredValue(1));
                store.get('a');

                // whichever of the two finds an expired entry first, it left the store for the same
                // reason - so the number reported is how many expired, not how many this call swept
                expect(store.removeExpired()).toBe(1);
            });

            it('reports each expired entry once', () => {
                const store: InMemoryCacheStore<string, number> = new InMemoryCacheStore();

                store.set('a', createExpiredValue(1));
                store.get('a');
                store.removeExpired();

                expect(store.removeExpired()).toBe(0);
            });
        });
    });

    describe('recordAccess ordering differences', () => {
        it('firstInFirstOut does not reorder the list on get', () => {
            const store: InMemoryCacheStore<string, number> = new InMemoryCacheStore({
                maxEntries: 3,
                removeOnOverflow: 'firstInFirstOut'
            });

            store.set('a', createCachedValue(1, []));
            store.set('b', createCachedValue(2, []));
            store.set('c', createCachedValue(3, []));

            store.get('a');
            store.get('a');
            store.get('a');

            store.set('d', createCachedValue(4, []));

            // 'a' was inserted first, so it is evicted first regardless of access count
            expect(store.has('a')).toBe(false);
            expect(store.has('b')).toBe(true);
            expect(store.has('c')).toBe(true);
            expect(store.has('d')).toBe(true);
        });
    });
});