import { EntityOrder, OrderDirection, SimilarityOrder } from './entity-order.model';
import { RelationTree } from './entity-relations.model';
import { isRelationMetadata } from './is-relation-metadata.function';
import { InternalError } from '../../error-handling/internal-error.model';
import { Newable } from '../../types/newable.type';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { TrigramUtilities } from '../../utilities/trigram.utilities';
import { PropertyMetadata } from '../decorators/property.decorator';

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
     *
     * Descending for an order by similarity, which puts the most similar first.
     */
    direction: OrderDirection,
    /**
     * The search the value is compared with, when the property is ordered by how similar it is to one
     * rather than by the value itself.
     */
    similarTo: string | undefined
};

/**
 * Compares two values of the property one key of an order sorts by.
 *
 * Negative when the first sorts first, positive when the second does, 0 when the key leaves them tied.
 */
export type OrderComparator = (a: unknown, b: unknown) => number;

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
     * @param entityClass - The entity the order is for, which says which keys are relations.
     * @returns One key per property, in the order the keys were written.
     * @throws When the order names something that is neither a direction, a similarity, nor a relation
     * leading to one.
     */
    static resolveKeys<T>(order: EntityOrder<T> | undefined, entityClass: Newable<T>): OrderKey[] {
        return this.keysOf(order, MetadataUtilities.getModelProperties(entityClass), []);
    }

    /**
     * The relations an order has to reach through to compare anything.
     *
     * Read before the rows are, because there is no way to sort by a value that has not been
     * resolved - and taken off again afterwards, since ordering by a relation is not asking for it.
     * @param order - The order as the caller wrote it, or none.
     * @param entityClass - The entity the order is for, which says which keys are relations.
     * @returns The tree of relations it names, which is empty when it names none.
     */
    static resolveRelations<T>(order: EntityOrder<T> | undefined, entityClass: Newable<T>): RelationTree {
        return this.relationsOf(order, MetadataUtilities.getModelProperties(entityClass));
    }

    /**
     * Whether the given value of an order orders by similarity to a search.
     * @param value - The value an order holds for one property.
     * @returns True when it is a {@link SimilarityOrder}.
     */
    static isSimilarityOrder(value: unknown): value is SimilarityOrder {
        return typeof value === 'object' && value != undefined && 'similarTo' in value && typeof value.similarTo === 'string';
    }

    /**
     * Resolves how two values are compared for the given key of an order.
     *
     * A key ordering by similarity compares how similar each value is to its search, the most similar
     * first, and puts a value holding no text after every one that does - whichever way a value with
     * nothing in it would sort, it is similar to nothing. The similarities are remembered per value
     * for as long as the comparator is used, because a sort compares every value many times over.
     * @param key - The key of the order.
     * @param compareValues - How the store compares two values of a property ordered by the value itself.
     * @returns The comparison for that key, with its direction applied.
     */
    static resolveComparator(key: OrderKey, compareValues: OrderComparator): OrderComparator {
        const similarTo: string | undefined = key.similarTo;
        if (similarTo == undefined) {
            return (a, b) => key.direction === 'DESC' ? -compareValues(a, b) : compareValues(a, b);
        }

        const similarities: Map<string, number> = new Map();
        const similarityOf: (value: unknown) => number | undefined = value => {
            if (typeof value !== 'string') {
                return undefined;
            }
            let res: number | undefined = similarities.get(value);
            if (res == undefined) {
                res = TrigramUtilities.resolveSimilarity(value, similarTo);
                similarities.set(value, res);
            }
            return res;
        };
        return (a, b) => {
            const aSimilarity: number | undefined = similarityOf(a);
            const bSimilarity: number | undefined = similarityOf(b);
            if (aSimilarity == undefined) {
                return bSimilarity == undefined ? 0 : 1;
            }
            if (bSimilarity == undefined) {
                return -1;
            }
            return bSimilarity - aSimilarity;
        };
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
     * @param properties - The property metadata of the entity at this level.
     * @param prefix - The relations already followed to reach it.
     * @returns The keys of this level and of everything below it.
     * @throws When ordering is neither ASC, DESC or a similarity order.
     */
    private static keysOf(value: unknown, properties: Record<string, PropertyMetadata>, prefix: readonly string[]): OrderKey[] {
        if (value == undefined || typeof value !== 'object') {
            return [];
        }
        const res: OrderKey[] = [];
        const entries: [string, unknown][] = Object.entries(value);
        for (const [key, entry] of entries) {
            const path: string[] = [...prefix, key];
            if (entry === 'ASC' || entry === 'DESC') {
                res.push({ path, direction: entry, similarTo: undefined });
                continue;
            }
            // told apart by the metadata rather than by the shape, because a relation's entity may
            // well have a property called `similarTo` of its own
            const metadata: PropertyMetadata | undefined = properties[key];
            if (isRelationMetadata(metadata)) {
                res.push(...this.keysOf(entry, MetadataUtilities.getModelProperties(metadata.target()), path));
                continue;
            }
            if (this.isSimilarityOrder(entry)) {
                res.push({ path, direction: 'DESC', similarTo: entry.similarTo });
                continue;
            }
            throw new InternalError(
                `The order names "${path.join('.')}" with something that is neither "ASC", "DESC" nor { similarTo }.`
            );
        }
        return res;
    }

    /**
     * Reads the relations out of one level of an order.
     * @param value - The order at this level.
     * @param properties - The property metadata of the entity at this level.
     * @returns The tree of relations it reaches through.
     */
    private static relationsOf(value: unknown, properties: Record<string, PropertyMetadata>): RelationTree {
        const res: Map<string, RelationTree> = new Map();
        if (value == undefined || typeof value !== 'object') {
            return res;
        }
        const entries: [string, unknown][] = Object.entries(value);
        for (const [key, entry] of entries) {
            const metadata: PropertyMetadata | undefined = properties[key];
            if (isRelationMetadata(metadata)) {
                res.set(key, this.relationsOf(entry, MetadataUtilities.getModelProperties(metadata.target())));
            }
        }
        return res;
    }
}