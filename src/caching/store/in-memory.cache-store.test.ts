import { describe, expect, it } from '@jest/globals';

import { CachedValue } from './cached-value.model';
import { InMemoryCacheStore } from './in-memory.cache-store';

function createCachedValue<V>(value: V, tags: string[]): CachedValue<V> {
    return {
        value,
        tags,
        createdAt: new Date()
    };
}

describe('InMemoryCacheStore', () => {
    it('returns undefined for missing keys', () => {
        const store: InMemoryCacheStore<string, number> = new InMemoryCacheStore();

        expect(store.get('missing')).toBeUndefined();
        expect(store.has('missing')).toBe(false);
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
            const singleEntryByteSize: number = Buffer.byteLength(JSON.stringify({ key: 'a', value: sampleValue }), 'utf8');

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