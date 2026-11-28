import { BaseEntity } from '../../entity/base-entity.model';
import { PropertyMetadata } from '../../entity/decorators/property.decorator';
import { coversEveryRow, UniqueGroup } from '../../entity/models/unique-declaration.model';
import { Where, WhereFilter } from '../models/where/where-filter.model';
import { IndexLookup, IndexValueEncoder } from './index-lookup.model';

/**
 * Finds which index declarations of an entity a filter can be answered from, for a driver that keeps
 * its own index entries rather than asking a database.
 */
export abstract class IndexLookupUtilities {

    /**
     * Collects the index declarations a filter can be answered from.
     *
     * An index answers a lookup by any leading part of itself, and a unique over every row is kept by
     * one over its columns in the order they are written. An entry is the whole combination of a
     * group's values, so every leading part of each is kept as a group of its own - which is what lets
     * an entity declare (tenantId, status) and nothing on tenantId alone, as it does on a sql store.
     * @param indexes - The declarations, a property carrying `index` being a group of one.
     * @param uniques - The unique declarations, whose leading parts are answered the same way.
     * @param properties - The properties of the entity, by key.
     * @returns The groups, each sorted, without duplicates and without a group naming an encrypted or
     * hashed property, the longest first so a filter is answered from the one that names most of it.
     */
    static resolveGroups(indexes: string[][], uniques: UniqueGroup[], properties: Record<string, PropertyMetadata>): string[][] {
        const seen: Set<string> = new Set();
        const leadingParts: (group: string[], length: number) => string[][] = (group, length) => Array
            .from({ length }, (_, i) => group.slice(0, i + 1));
        return [
            ...indexes.flatMap(group => leadingParts(group, group.length)),
            // the whole group is answered through the unique's own entries
            ...uniques.filter(group => coversEveryRow(group.where))
                .flatMap(group => leadingParts(group.properties, group.properties.length - 1))
        ]
            .sort((a, b) => b.length - a.length)
            .map(group => [...group].sort())
            .filter(group => group.every(key => !this.isTransformedOnWrite(properties[key])))
            .filter(group => {
                const id: string = group.join(',');
                if (seen.has(id)) {
                    return false;
                }
                seen.add(id);
                return true;
            });
    }

    /**
     * Finds the index declaration each branch of a filter names in full.
     * @param where - The filter.
     * @param groups - The declarations, as {@link resolveGroups} collects them.
     * @param encode - Encodes a value the filter names the way the entries hold it.
     * @returns A lookup per branch, or undefined when a branch names no declaration in full: such a
     * filter can match a row no entry it names holds.
     */
    static findLookups<T extends BaseEntity>(
        where: Where<T> | undefined,
        groups: string[][],
        encode: IndexValueEncoder
    ): IndexLookup[] | undefined {
        if (where == undefined || !groups.length) {
            return undefined;
        }
        const res: IndexLookup[] = [];
        for (const filter of Array.isArray(where) ? where : [where]) {
            const lookup: IndexLookup | undefined = this.findLookup(filter, groups, encode);
            if (lookup == undefined) {
                return undefined;
            }
            res.push(lookup);
        }
        return res;
    }

    /**
     * Finds the first index declaration a single filter names in full, and the entries it reads.
     * @param filter - One branch of the where filter.
     * @param groups - The declarations.
     * @param encode - Encodes a value the filter names the way the entries hold it.
     * @returns The declaration and its entries, or undefined when no declaration is named by values the
     * encoder takes. A declaration of one property may also be named by a `oneOf` of such values.
     */
    private static findLookup<T extends BaseEntity>(
        filter: WhereFilter<T>,
        groups: string[][],
        encode: IndexValueEncoder
    ): IndexLookup | undefined {
        const conditions: Record<string, unknown> = filter;
        for (const group of groups) {
            const [only] = group;
            const listed: string[] | undefined = group.length === 1 && only != undefined
                ? this.findEncodedOneOf(only, conditions[only], encode)
                : undefined;
            if (only != undefined && listed != undefined) {
                return { group, entries: listed.map(value => `${only}=${value}`) };
            }
            const values: (string | undefined)[] = group.map(key => encode(key, conditions[key]));
            if (values.every(value => value != undefined)) {
                return { group, entries: [group.map((key, i) => `${key}=${values[i]}`).join(':')] };
            }
        }
        return undefined;
    }

    // the values of a `oneOf` the encoder takes every one of, each of which is one entry
    private static findEncodedOneOf(key: string, condition: unknown, encode: IndexValueEncoder): string[] | undefined {
        if (typeof condition !== 'object' || condition == undefined || !('oneOf' in condition) || !Array.isArray(condition.oneOf)) {
            return undefined;
        }
        const listed: unknown[] = condition.oneOf;
        const values: (string | undefined)[] = listed.map(value => encode(key, value));
        return values.every(value => value != undefined) ? values : undefined;
    }

    // what is stored for an encrypted or hashed property is never the value a filter names
    private static isTransformedOnWrite(metadata: PropertyMetadata | undefined): boolean {
        return metadata != undefined
            && (('encryption' in metadata && metadata.encryption != undefined && metadata.encryption !== false)
                || ('hash' in metadata && metadata.hash != undefined && metadata.hash !== false));
    }
}