import { AggregateFunction, AggregateRow } from './models/aggregate.model';
import { PropertyMetadata } from '../entity/decorators/property.decorator';
import { isRelationMetadata } from '../entity/models/is-relation-metadata.function';
import { InternalError } from '../error-handling/internal-error.model';
import { ModelRegistry } from '../global/model-registry/model.registry';
import { Newable } from '../types/newable.type';
import { JsonUtilities } from '../utilities/json.utilities';
import { MetadataUtilities } from '../utilities/metadata.utilities';

/**
 * A group of rows while it is being added up.
 */
type GroupOfRows = {
    /**
     * The values the rows of the group share, by property.
     */
    group: Record<string, unknown>,
    /**
     * The rows of the group.
     */
    rows: object[]
};

/**
 * Utilities for taking a value over rows: what may be taken of what, what a store's answer reads as,
 * and the answer itself for a store that holds its rows in this process.
 */
export abstract class AggregateUtilities {
    /**
     * Refuses a value taken of a property it cannot be taken of: a sum or an average of anything but
     * a number, a smallest or largest value of anything but a number or a date.
     * @param fn - What is taken.
     * @param property - The property.
     * @param entityClass - The entity.
     * @throws When the property holds nothing it can be taken of.
     */
    static validateAggregatedProperty(fn: AggregateFunction, property: string, entityClass: Newable<unknown>): void {
        const metadata: PropertyMetadata | undefined = MetadataUtilities.getModelProperties(entityClass)[property];
        const isNumber: boolean = metadata?.type === 'number' && metadata.format !== 'bignumber';
        if ((fn === 'sum' || fn === 'average') && !isNumber) {
            throw new InternalError(`${entityClass.name}.${property} holds no number, so it has no ${fn}.`);
        }
        if ((fn === 'minimum' || fn === 'maximum') && !isNumber && metadata?.type !== 'date') {
            throw new InternalError(`${entityClass.name}.${property} holds neither a number nor a date, so it has no ${fn}.`);
        }
    }

    /**
     * Refuses grouping rows by a property that holds no single plain value, or whose stored value is
     * not the value: an encrypted one is stored differently for every row.
     * @param groupBy - The properties.
     * @param entityClass - The entity.
     * @throws When a property cannot group rows.
     */
    static validateGroupKeys(groupBy: string[], entityClass: Newable<unknown>): void {
        const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(entityClass);
        const encrypted: ReadonlyMap<string, unknown> = ModelRegistry.get(entityClass).encryptionDescriptor.keys;
        for (const key of groupBy) {
            const metadata: PropertyMetadata | undefined = properties[key];
            const plain: boolean = metadata != undefined
                && !isRelationMetadata(metadata)
                && ['string', 'number', 'boolean', 'date'].includes(metadata.type)
                && !(metadata.type === 'number' && metadata.format === 'bignumber');
            if (!plain) {
                throw new InternalError(`${entityClass.name}.${key} cannot group rows: it holds no single plain value.`);
            }
            if (encrypted.has(key)) {
                throw new InternalError(
                    `${entityClass.name}.${key} cannot group rows: it is encrypted, and stored differently for every row.`
                );
            }
        }
    }

    /**
     * Reads what a store answered as the value it stands for: a number, a date, or a count.
     * @param fn - What was taken.
     * @param property - The property it was taken of. Undefined for a count.
     * @param value - The value as the store answered it.
     * @param entityClass - The entity.
     * @returns The value, undefined when there is none.
     */
    static resolveValue(fn: AggregateFunction, property: string | undefined, value: unknown, entityClass: Newable<unknown>): unknown {
        if (value == undefined) {
            return undefined;
        }
        if (fn === 'count' || property == undefined) {
            return Number(value);
        }
        return this.resolvePropertyValue(property, value, entityClass);
    }

    /**
     * Reads the values a group shares as the values they stand for.
     * @param group - The values as the store answered them, by property.
     * @param entityClass - The entity.
     * @returns The values.
     */
    static resolveGroup(group: Record<string, unknown>, entityClass: Newable<unknown>): Record<string, unknown> {
        return Object.fromEntries(Object.entries(group).map(([key, value]) => [
            key,
            value == undefined ? undefined : this.resolvePropertyValue(key, value, entityClass)
        ]));
    }
    /**
     * Takes a value over rows, per group when asked to, the way a sql database answers it: a row
     * holding no value is left out, and a group with no value to take answers undefined.
     * @param rows - The rows a filter matched.
     * @param fn - What is taken over them.
     * @param property - The property it is taken of. Unused for a count.
     * @param groupBy - The properties the rows are grouped by, none for one value over every row.
     * @returns One row per group, or a single row with an empty group when nothing groups them. No row
     * when there are no rows to group.
     */
    static resolveRows(rows: object[], fn: AggregateFunction, property: string | undefined, groupBy: string[]): AggregateRow[] {
        const groups: GroupOfRows[] = groupBy.length
            ? this.resolveGroups(rows, groupBy)
            : [{ group: {}, rows }];
        return groups.map(g => ({ group: g.group, value: this.resolveTaken(g.rows, fn, property) }));
    }

    /**
     * Reads one value a store answered as what the property holds: a sql database answers a sum as a
     * string where it may be past what a number holds, and a date in the form its driver chose.
     * @param property - The property.
     * @param value - The value as the store answered it.
     * @param entityClass - The entity.
     * @returns The value.
     */
    private static resolvePropertyValue(property: string, value: unknown, entityClass: Newable<unknown>): unknown {
        const metadata: PropertyMetadata | undefined = MetadataUtilities.getModelProperties(entityClass)[property];
        if (metadata?.type === 'date') {
            return value instanceof Date ? value : new Date(String(value));
        }
        if (metadata?.type === 'number') {
            return Number(value);
        }
        return value;
    }

    private static resolveGroups(rows: object[], groupBy: string[]): GroupOfRows[] {
        const byKey: Map<string, GroupOfRows> = new Map();
        for (const row of rows) {
            const group: Record<string, unknown> = Object.fromEntries(groupBy.map(key => [key, Reflect.get(row, key) ?? undefined]));
            const key: string = JsonUtilities.stringify(groupBy.map(k => group[k]));
            const known: GroupOfRows | undefined = byKey.get(key);
            if (known) {
                known.rows.push(row);
                continue;
            }
            byKey.set(key, { group, rows: [row] });
        }
        return [...byKey.values()];
    }

    private static resolveTaken(rows: object[], fn: AggregateFunction, property: string | undefined): unknown {
        if (fn === 'count') {
            return rows.length;
        }
        const held: unknown[] = rows.map((row): unknown => property == undefined ? undefined : Reflect.get(row, property));
        const values: (number | Date)[] = held.filter(
            (value): value is number | Date => typeof value === 'number' || value instanceof Date
        );
        if (!values.length) {
            return undefined;
        }
        switch (fn) {
            case 'sum': {
                return values.reduce((sum: number, value) => sum + Number(value), 0);
            }
            case 'average': {
                return values.reduce((sum: number, value) => sum + Number(value), 0) / values.length;
            }
            case 'minimum': {
                return values.reduce((min, value) => Number(value) < Number(min) ? value : min);
            }
            case 'maximum': {
                return values.reduce((max, value) => Number(value) > Number(max) ? value : max);
            }
        }
    }
}