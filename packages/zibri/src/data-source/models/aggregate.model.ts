import { BaseRepositoryOptions } from './options/base-repository-options.model';
import { Where } from './where/where-filter.model';
import { BaseEntity } from '../../entity/base-entity.model';

/**
 * The properties of an entity that hold a number, which a sum or an average is taken of.
 */
export type NumberKeysOf<T> = {
    [K in keyof T]-?: NonNullable<T[K]> extends number ? K : never
}[keyof T];

/**
 * The properties of an entity that hold a number or a date, which have a smallest and a largest value.
 */
export type OrderedKeysOf<T> = {
    [K in keyof T]-?: NonNullable<T[K]> extends number | Date ? K : never
}[keyof T];

/**
 * The properties of an entity rows can be grouped by: those holding a single plain value.
 */
export type GroupKeysOf<T> = {
    [K in keyof T]-?: NonNullable<T[K]> extends string | number | boolean | Date ? K : never
}[keyof T];

/**
 * What a value is taken over the rows.
 */
export type AggregateFunction = 'sum' | 'average' | 'minimum' | 'maximum' | 'count';

/**
 * Options for adding up what rows hold.
 */
export type AggregateOptions<T extends BaseEntity, G extends readonly GroupKeysOf<T>[] | undefined = undefined> = BaseRepositoryOptions<T> & {
    /**
     * The filter the rows are taken from.
     */
    where?: Where<T>,
    /**
     * The properties to take one value per group of, instead of one value over every row.
     *
     * The answer is then one row per group, holding the values the group shares and the value taken
     * over it, in no order.
     */
    groupBy?: G
};

/**
 * What a value taken over rows answers: the value, or one row per group holding the values the group
 * shares and the value under the name of what was taken.
 */
export type Aggregated<T, G, TName extends string, TValue> = [G] extends [undefined]
    ? TValue
    : G extends readonly (keyof T)[] ? (Pick<T, G[number]> & Record<TName, TValue>)[] : never;

/**
 * One group of rows and the value taken over it, as a driver answers it.
 */
export type AggregateRow = {
    /**
     * The values the rows of the group share, by property. Empty when the rows are not grouped.
     */
    group: Record<string, unknown>,
    /**
     * The value taken over them, as the store answered it. Undefined or null when there is none.
     */
    value: unknown
};