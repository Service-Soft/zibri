import { EntityOrder, OrderDirection } from './entity-order.model';
import { RelationTree } from './entity-relations.model';

/**
 * One property an order sorts by, and the way to reach it.
 */
export type OrderKey = {
    /**
     * The property names to follow from the entity, ending in the one being sorted by.
     *
     * One name for a property of the entity itself, and one more per relation it is reached through.
     */
    path: string[],
    /**
     * Which way that property is ordered.
     */
    direction: OrderDirection
};

/**
 * Utilities for the order a read is made in.
 */
export abstract class EntityOrderUtilities {
    /**
     * Reads an order into the properties it sorts by, in the order they decide anything.
     *
     * Flattened, because a property two relations down is sorted by exactly as one of the entity is
     * - the only difference is how far the value is reached through.
     * @param order - The order as the caller wrote it, or none.
     * @returns One key per property, in the order the keys were written.
     */
    static resolveKeys<T>(order: EntityOrder<T> | undefined): OrderKey[] {
        return this.keysOf(order, []);
    }

    /**
     * The relations an order has to reach through to compare anything.
     *
     * Read before the rows are, because there is no way to sort by a value that has not been
     * resolved - and taken off again afterwards, since ordering by a relation is not asking for it.
     * @param order - The order as the caller wrote it, or none.
     * @returns The tree of relations it names, which is empty when it names none.
     */
    static resolveRelations<T>(order: EntityOrder<T> | undefined): RelationTree {
        return this.relationsOf(order);
    }

    /**
     * Follows a key's path to the value it sorts by.
     * @param row - The row to read from.
     * @param path - The property names to follow.
     * @returns The value at the end of the path, or undefined when it stops short.
     */
    static valueAt(row: unknown, path: readonly string[]): unknown {
        let value: unknown = row;
        for (const key of path) {
            if (value == undefined || typeof value !== 'object') {
                return undefined;
            }
            const holder: Record<string, unknown> = value as Record<string, unknown>;
            value = holder[key];
        }
        return value;
    }

    /**
     * Reads the keys out of one level of an order.
     * @param value - The order at this level.
     * @param prefix - The relations already followed to reach it.
     * @returns The keys of this level and of everything below it.
     */
    private static keysOf(value: unknown, prefix: readonly string[]): OrderKey[] {
        if (value == undefined || typeof value !== 'object') {
            return [];
        }
        const res: OrderKey[] = [];
        const entries: [string, unknown][] = Object.entries(value);
        for (const [key, entry] of entries) {
            if (entry === 'ASC' || entry === 'DESC') {
                res.push({ path: [...prefix, key], direction: entry });
                continue;
            }
            res.push(...this.keysOf(entry, [...prefix, key]));
        }
        return res;
    }

    /**
     * Reads the relations out of one level of an order.
     * @param value - The order at this level.
     * @returns The tree of relations it reaches through.
     */
    private static relationsOf(value: unknown): RelationTree {
        const res: Map<string, RelationTree> = new Map();
        if (value == undefined || typeof value !== 'object') {
            return res;
        }
        const entries: [string, unknown][] = Object.entries(value);
        for (const [key, entry] of entries) {
            // a direction is a property of the entity and anything else is a way to one, which is
            // what makes a relation recognizable here without the metadata being read
            if (entry != undefined && typeof entry === 'object') {
                res.set(key, this.relationsOf(entry));
            }
        }
        return res;
    }
}