import { describe, expect, it } from '@jest/globals';

import { cacheKeyOf } from './cache-key.function';
import { AlsUtilities } from '../context/als.utilities';
import { UUIDUtilities } from '../utilities/uuid.utilities';

/**
 * What counts as the same cache key.
 *
 * Decided here and nowhere else, because it used to be decided in three places - the in memory
 * store, the valkey store and the single flight map - and only one of them was right.
 */
describe('cacheKeyOf', () => {
    it('leaves a string key as it is', () => {
        // the common case, and the one that has to stay readable in the valkey keyspace
        expect(cacheKeyOf('user:1')).toBe('user:1');
    });

    it('gives two objects with the same entries the same key', () => {
        expect(cacheKeyOf({ userId: 'u1', tenantId: 't1' })).toBe(cacheKeyOf({ userId: 'u1', tenantId: 't1' }));
    });

    it('does not care which order the entries were written in', () => {
        // two call sites building the same key from the same values would otherwise store it twice,
        // and each would read the other's writes as a miss
        expect(cacheKeyOf({ userId: 'u1', tenantId: 't1' })).toBe(cacheKeyOf({ tenantId: 't1', userId: 'u1' }));
    });

    it('sorts nested objects too, including ones inside arrays', () => {
        expect(cacheKeyOf({ filter: { b: 2, a: 1 } })).toBe(cacheKeyOf({ filter: { a: 1, b: 2 } }));
        expect(cacheKeyOf({ filters: [{ b: 2, a: 1 }] })).toBe(cacheKeyOf({ filters: [{ a: 1, b: 2 }] }));
    });

    it('keeps arrays in the order they were given', () => {
        // an array's order carries meaning - these are two different sorts, and one answer must not
        // be served for the other
        expect(cacheKeyOf({ orderBy: ['name', 'createdAt'] })).not.toBe(cacheKeyOf({ orderBy: ['createdAt', 'name'] }));
    });

    it('keys each tenant apart, and apart from no tenant', () => {
        const tenantA: string = UUIDUtilities.generate();
        const tenantB: string = UUIDUtilities.generate();
        const inA: string = AlsUtilities.runInTenant(tenantA, () => cacheKeyOf('user:1'));

        expect(inA).toBe(AlsUtilities.runInTenant(tenantA, () => cacheKeyOf('user:1')));
        expect(inA).not.toBe(AlsUtilities.runInTenant(tenantB, () => cacheKeyOf('user:1')));
        expect(inA).not.toBe(cacheKeyOf('user:1'));
        // and no key written outside every tenant can be mistaken for a tenant's
        expect(inA).not.toBe(cacheKeyOf(`${tenantA}:user:1`));
        expect(AlsUtilities.runInTenant(tenantA, () => cacheKeyOf({ id: 1 }))).not.toBe(cacheKeyOf({ id: 1 }));
    });

    it('tells different values apart', () => {
        expect(cacheKeyOf({ userId: 'u1' })).not.toBe(cacheKeyOf({ userId: 'u2' }));
        expect(cacheKeyOf({ userId: 'u1' })).not.toBe(cacheKeyOf({ tenantId: 'u1' }));
    });

    it('keeps a date as the date it is', () => {
        // reordering the properties of one would read the properties a Date does not keep its value
        // in, and every date would come out as the same empty object
        const first: Date = new Date('2026-01-01T00:00:00.000Z');
        const second: Date = new Date('2026-06-01T00:00:00.000Z');

        expect(cacheKeyOf({ since: first })).not.toBe(cacheKeyOf({ since: second }));
        expect(cacheKeyOf({ since: first })).toBe(cacheKeyOf({ since: new Date('2026-01-01T00:00:00.000Z') }));
    });

    it('handles a key that is not an object at all', () => {
        expect(cacheKeyOf(42)).toBe(cacheKeyOf(42));
        expect(cacheKeyOf(42)).not.toBe(cacheKeyOf('42'));
    });
});