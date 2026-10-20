import { type BaseEntity } from '../base-entity.model.ts';

/**
 * The entity a relation property holds, whether it holds one of them or many.
 */
type RelatedEntityOf<TValue> = NonNullable<TValue> extends (infer TItem)[] ? NonNullable<TItem> : NonNullable<TValue>;

/**
 * The properties of an entity that hold other entities.
 *
 * Read off the declared type rather than off the metadata, because a type cannot ask a decorator
 * anything. What that costs is a property holding a plain object with an `id` of its own being
 * counted as a relation - the entity classes are the only things shaped like one in practice.
 */
export type RelationKeysOf<T> = {
    [K in keyof T]-?: NonNullable<T[K]> extends BaseEntity | BaseEntity[] ? K : never
}[keyof T];

/**
 * The properties of an entity that hold exactly one other entity.
 *
 * The distinction matters wherever the far side has to name one row: "which of the many" has no
 * answer, so a to many relation is not somewhere a single value can be reached through.
 */
export type ToOneRelationKeysOf<T> = {
    [K in keyof T]-?: NonNullable<T[K]> extends BaseEntity ? K : never
}[keyof T];

/**
 * The properties of an entity that hold a value of their own.
 *
 * Everything that is not another entity and is not a method, so the key of a relation and the key it
 * is stored as are told apart: `team` is a relation, `teamId` is a column.
 */
export type ColumnKeysOf<T> = {
    [K in keyof T]-?: NonNullable<T[K]> extends BaseEntity | BaseEntity[] ? never
        : NonNullable<T[K]> extends (...args: never[]) => unknown ? never
            : K
}[keyof T];

/**
 * The relations to resolve on the entities a read hands back.
 *
 * `true` is the relation and nothing below it. A relation of it is asked for by naming it in turn,
 * `{ album: { artist: true } }`, and every level is one read of its own - so what a tree asks for is
 * what it costs.
 *
 * Only what is named is resolved. A relation that is left out comes back unset rather than empty,
 * which is the difference between "nobody asked" and "there is nothing there".
 */
export type EntityRelations<T> = {
    [K in RelationKeysOf<T>]?: true | EntityRelations<RelatedEntityOf<T[K]>>
};

/**
 * What a read resolves, in the one shape a driver walks.
 *
 * A relation by its property name, holding the relations to resolve below it - so the empty map is
 * the relation on its own. The two ways a caller can write them and the ones a filter or an order
 * asks for on its own all arrive here, which is what lets them be put together before anything is
 * read and taken apart again afterwards.
 */
export type RelationTree = ReadonlyMap<string, RelationTree>;

/**
 * The relations to resolve on one row rather than on every row, by the id of that row.
 *
 * The same shape as a {@link RelationTree} and not one: its keys are row ids where a tree's are
 * property names. A write hands its rows back with the relations each row's own data wrote, and
 * those differ from row to row, which is the one place relations are not asked for in one piece.
 */
export type RelationTreeByRowId = ReadonlyMap<string, RelationTree>;