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
 * The order to read entities in.
 *
 * A property of the entity itself, or of one entity it reaches - `{ album: { title: 'ASC' } }` - as
 * deep as the relations go. The keys are read in the order they were written: the first one that
 * separates two rows decides which comes first, and the ones after it decide what it left open.
 *
 * A string property can also be ordered by how similar it is to a search, see
 * SimilarityOrder.
 *
 * Ordering by a relation reads that relation, because there is no other way to compare by it. What
 * comes back is still only what `relations` asked for, so the row is unchanged by what it was sorted
 * on.
 *
 * A to many relation is not somewhere an order can reach through: "the album's title" names one
 * value and "the tracks' titles" names none in particular.
 */
export type EntityOrder<T> = {
    [K in ColumnKeysOf<T>]?: NonNullable<T[K]> extends string ? OrderDirection | SimilarityOrder : OrderDirection
} & {
    [K in ToOneRelationKeysOf<T>]?: EntityOrder<NonNullable<T[K]>>
};