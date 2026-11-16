import { ColumnKeysOf, ToOneRelationKeysOf } from './entity-relations.model';

/**
 * Which way a property is ordered.
 */
export type OrderDirection = 'ASC' | 'DESC';

/**
 * Orders a string property by how similar its value is to a search, the most similar first.
 *
 * Similar in the sense of `fuzzyLike`: the same measure a fuzzy search matches by, so a search and an
 * order over the same text agree about which rows come closest.
 * @example { name: { similarTo: 'Miller Holding' } }
 */
export type SimilarityOrder = {
    /**
     * The text the values are compared with.
     */
    similarTo: string
};

/**
 * How a property that holds a value of its own is ordered: a string also by similarity, and an object
 * also by the properties inside it.
 */
// a direction outside of the condition, so that it is one for every property even where the type of
// the property is not known yet, such as the id a read of any entity is ordered by last
type ColumnOrder<V> = OrderDirection | (V extends string ? SimilarityOrder
    : V extends Date | readonly unknown[] ? never
        : V extends object ? EntityOrder<V>
            : never);

/**
 * The order to read entities in.
 *
 * A property of the entity itself, of an object inside it - `{ address: { city: 'ASC' } }` - or of
 * one entity it reaches - `{ album: { title: 'ASC' } }` - as deep as the objects and relations go.
 * The keys are read in the order they were written: the first one that separates two rows decides
 * which comes first, and the ones after it decide what it left open.
 *
 * A string property can also be ordered by how similar it is to a search, see
 * SimilarityOrder.
 *
 * Ordering by a relation reads that relation, because there is no other way to compare by it. What
 * comes back is still only what `relations` asked for, so the row is unchanged by what it was sorted
 * on.
 *
 * A to many relation is not somewhere an order can reach through: "the album's title" names one
 * value and "the tracks' titles" names none in particular. An array is not either, for the same
 * reason.
 */
export type EntityOrder<T> = {
    [K in ColumnKeysOf<T>]?: ColumnOrder<NonNullable<T[K]>>
} & {
    [K in ToOneRelationKeysOf<T>]?: EntityOrder<NonNullable<T[K]>>
};