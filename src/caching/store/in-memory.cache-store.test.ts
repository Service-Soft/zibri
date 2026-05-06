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
});