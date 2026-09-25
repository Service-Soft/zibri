import { Where } from '../../data-source/models/where/where-filter.model';
import { BaseEntity } from '../base-entity.model';

/**
 * Marks a filter as one that named the entity it is for.
 *
 * Declared and never assigned, so it exists only in the types: the one value carrying it is the one
 * `whereFor` returns, which is what makes going through it the only way to declare one.
 */
declare const declaredWhere: unique symbol;

/**
 * The rows a key covers, when it does not cover all of them.
 *
 * Kept as a filter over the base entity because the places that store one have no way to name the
 * class it was written for - `whereFor` is what checks it against that class, and the mark below is
 * what makes going through it the only way to write one down.
 */
export type KeyWhere = Where<BaseEntity> & {
    /**
     * Present in the type and in no value. See {@link declaredWhere}.
     */
    readonly [declaredWhere]: true
};

/**
 * Whether a property has to be unique, and among which rows.
 *
 * `true` is unique across the whole table. A `where` narrows that to the rows matching it, which is
 * what lets a value be taken by one row and free for every row the filter excludes.
 */
export type UniqueDeclaration = boolean | {
    /**
     * The rows the value has to be unique among.
     */
    where: KeyWhere
};

/**
 * A group of properties that is unique together.
 *
 * The shape every declaration is normalized to, whichever of the two places it was written in: a
 * property carrying `unique` is a group of one.
 */
export type UniqueGroup = {
    /**
     * The properties that are unique together, in the order they were declared.
     */
    properties: string[],
    /**
     * The rows they have to be unique among, or undefined for all of them.
     */
    where?: KeyWhere
};

/**
 * A group of properties declared unique together on the entity.
 */
export type UniqueGroupInput<TKey extends string> = {
    /**
     * The properties that are unique together. Order decides the name the constraint gets.
     */
    properties: TKey[],
    /**
     * The rows they have to be unique among, or undefined for all of them.
     */
    where?: KeyWhere
};

/**
 * Whether the given declaration asks for uniqueness at all.
 * @param unique - What the property declared.
 * @returns Whether it is unique, over all rows or over some.
 */
export function declaresUnique(unique: UniqueDeclaration | undefined): boolean {
    return unique !== false && unique != undefined;
}

/**
 * Reads the rows a unique declaration covers.
 * @param unique - What the property declared.
 * @returns The filter it named, or undefined when it covers every row.
 */
export function uniqueWhereOf(unique: UniqueDeclaration | undefined): KeyWhere | undefined {
    return typeof unique === 'object' ? unique.where : undefined;
}

/**
 * Whether a key covers every row of its table.
 *
 * A filter with no conditions in it is how a declaration says "all of them" out loud, which a soft
 * delete entity has to be able to do - and a key over every row is a plain constraint rather than a
 * partial one, whichever of the two ways it was written.
 * @param where - The filter the key was declared with, if any.
 * @returns True when no row is left out of it.
 */
export function coversEveryRow(where: KeyWhere | undefined): boolean {
    if (where == undefined) {
        return true;
    }
    // any branch, not every: the branches are an OR, so one that excludes nothing lets every row in
    const branches: object[] = Array.isArray(where) ? where : [where];
    return branches.some(branch => Object.keys(branch).length === 0);
}