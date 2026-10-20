import { createHash } from 'node:crypto';

import { BaseEntity } from '../../entity/base-entity.model.ts';
import { PropertyMetadata } from '../../entity/decorators/property.decorator.ts';
import { EntityOrderUtilities } from '../../entity/models/entity-order.utilities.ts';
import { InternalError } from '../../error-handling/internal-error.model.ts';
import { Newable } from '../../types/newable.type.ts';
import { JsonUtilities } from '../../utilities/json.utilities.ts';
import { MetadataUtilities } from '../../utilities/metadata.utilities.ts';
import { FindAllOptions } from '../models/options/find-all-options.model.ts';
import { Where } from '../models/where/where-filter.model.ts';

/**
 * The property types a keyset read can continue through.
 *
 * "After this row" is a comparison, so a property whose values have no order cannot take part in
 * one. Booleans are left out for the same reason they make a poor order: two values cannot separate
 * rows, so the position would be decided entirely by whatever follows.
 */
const COMPARABLE_TYPES: Set<PropertyMetadata['type']> = new Set<PropertyMetadata['type']>(['string', 'number', 'date']);

/**
 * One property of the order a keyset read continues through.
 */
export type KeysetOrderKey = {
    /**
     * The property being ordered by.
     */
    property: string,
    /**
     * Which way it is ordered, which decides which side of the cursor the next page is on.
     */
    direction: 'ASC' | 'DESC',
    /**
     * What the property holds, which decides how a value is compared and how it survives the cursor.
     */
    type: 'string' | 'number' | 'date',
    /**
     * The search the property is ordered by similarity to, when it is.
     *
     * The cursor then still carries the value itself rather than its similarity: the next page is the
     * rows less similar to the search than that value is, which the store answers by comparing two
     * similarities it calculates itself.
     */
    similarTo: string | undefined
};

/**
 * Reads a direction out of what typeorm accepts as one.
 * @param value - The direction as the caller wrote it.
 * @returns The direction, or undefined when it is not one this can continue through.
 */
function directionOf(value: unknown): 'ASC' | 'DESC' | undefined {
    if (value === 'ASC' || value === 'asc' || value === 1) {
        return 'ASC';
    }
    if (value === 'DESC' || value === 'desc' || value === -1) {
        return 'DESC';
    }
    return undefined;
}

/**
 * Resolves the order a page was read in into the keys a cursor is built from.
 *
 * Every key is checked here rather than where it fails, because each way an order can be unusable
 * fails quietly: a nullable property drops the rows holding null out of the walk, since a comparison
 * with null is never true - the exact silent skipping a keyset read exists to prevent. A property
 * with no order to compare by, or a direction given as a nested object for a relation, has no
 * "after" at all.
 * @param entityClass - The entity being read, for what each property holds.
 * @param order - The resolved order of the read, ending in the primary key.
 * @returns One key per property of the order, in the order's own order.
 * @throws When the order cannot be continued through, naming the property and the reason.
 */
export function resolveKeysetOrder<T extends BaseEntity>(
    entityClass: Newable<T>,
    order: FindAllOptions<T>['order']
): KeysetOrderKey[] {
    if (order == undefined) {
        throw new InternalError(
            `${entityClass.name}: a keyset read needs an order to continue through, and this one has none.`
        );
    }

    const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(entityClass);
    const keys: KeysetOrderKey[] = [];

    for (const [property, value] of Object.entries(order)) {
        const metadata: PropertyMetadata | undefined = properties[property];
        if (metadata == undefined) {
            throw new InternalError(`${entityClass.name}.${property} is ordered by and is not a property of it.`);
        }
        if (!COMPARABLE_TYPES.has(metadata.type)) {
            throw new InternalError(
                `${entityClass.name}.${property} is a "${metadata.type}", which has no order to continue a keyset read through.`
                + ' Order by a string, a number or a date, or use findAllPaginated.'
            );
        }
        if (metadata.required === false) {
            throw new InternalError(
                `${entityClass.name}.${property} can hold null, so a keyset read ordered by it would pass over every row that does.`
                + ' Order by a property that is always set, or use findAllPaginated.'
            );
        }

        if (EntityOrderUtilities.isSimilarityOrder(value) && metadata.type === 'string') {
            // most similar first, which is descending
            keys.push({ property, direction: 'DESC', type: 'string', similarTo: value.similarTo });
            continue;
        }

        const direction: 'ASC' | 'DESC' | undefined = directionOf(value);
        if (direction == undefined) {
            throw new InternalError(
                `${entityClass.name}.${property} is ordered in a way a keyset read cannot continue through.`
                + ' Order by a property of the entity itself, ascending, descending or by similarity.'
            );
        }

        keys.push({ property, direction, type: metadata.type as 'string' | 'number' | 'date', similarTo: undefined });
    }

    return keys;
}

/**
 * Serializes a value so that two equal filters produce one string.
 *
 * Object keys are written in a fixed order, because two filters that differ only in the order they
 * were built in are the same filter and have to fingerprint the same.
 * @param value - The value to write.
 * @returns The value as a string that depends on its content and nothing else.
 */
function stableString(value: unknown): string {
    if (value == undefined) {
        return 'null';
    }
    if (value instanceof Date) {
        return value.toISOString();
    }
    if (Array.isArray(value)) {
        return `[${value.map(v => stableString(v)).join(',')}]`;
    }
    if (typeof value !== 'object') {
        return JsonUtilities.stringify(value) ?? 'null';
    }
    return `{${Object.entries(value)
        .sort(([a], [b]) => a < b ? -1 : 1)
        .map(([key, entry]) => `${key}:${stableString(entry)}`)
        .join(',')}}`;
}

/**
 * What a cursor is only valid for.
 *
 * A cursor names a position, and a position only means something inside the read that produced it.
 * The order is the obvious half. The filter is the half that has to be here for the cursor to be
 * safe: a page continues by replacing what the caller asked of the ordered properties with where the
 * cursor sits, which is a narrowing only because the row the cursor came from passed that same
 * filter. Carrying the filter into the fingerprint is what makes that true rather than assumed -
 * including the part of it an entity's scope contributed, so a cursor cannot be carried from one
 * caller's rows to another's.
 *
 * Hashed rather than carried, because the filter is the application's and a cursor is handed out. The
 * search an order by similarity compares with is hashed for the same reason: it is part of the order,
 * since a position among the rows most similar to one search is none among those similar to another.
 * @param keys - The order the read was made in.
 * @param where - The filter of the read, after scopes have narrowed it.
 * @returns A short fingerprint of the two.
 */
export function keysetFingerprint<T extends BaseEntity>(keys: KeysetOrderKey[], where: Where<T> | undefined): string {
    const order: string = keys.map(k => `${k.property}:${k.similarTo == undefined ? k.direction : 'similarTo'}`).join(',');
    // only where there is one, so that the fingerprint of every other order stays what it was and the
    // cursors already handed out for one stay valid
    const searches: string = keys.some(k => k.similarTo != undefined) ? `${stableString(keys.map(k => k.similarTo))}|` : '';
    const digest: string = createHash('sha256')
        .update(`${order}|${searches}${stableString(where)}`, 'utf8')
        .digest('base64url')
        .slice(0, 16);
    // the order stays readable so that a cursor refused for the wrong order can say which one it was
    // made for, which is the mistake this catches almost every time
    return `${order}|${digest}`;
}