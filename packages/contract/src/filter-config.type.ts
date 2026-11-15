import { ArrayFilterMatch, BooleanFilterMatch, RangeFilterMatch, StringFilterMatch } from './filter-match.type';

/**
 * How the rows of a list of `T` can be filtered: for each property, how its value matches, nested like the model for
 * the properties of an object, of a relation and of the items of an array. The match has to fit the type of the
 * property, so `{ title: 'range' }` on a string doesn't compile.
 * @example
 * export const taskFilter = {
 *     title: 'iLike',
 *     priority: 'range',
 *     address: { city: 'equals' },
 *     tags: 'includes'
 * } as const satisfies FilterConfig<Task>;
 */
export type FilterConfig<T> = {
    [K in keyof T]?: FilterConfigOf<NonNullable<T[K]>>
};

/**
 * How a filter of a value of type `V` can match, or how the properties inside it can.
 */
type FilterConfigOf<V> = V extends Date
    ? RangeFilterMatch
    : V extends readonly (infer Item)[]
        ? ArrayItemFilterConfigOf<NonNullable<Item>>
        : V extends string
            ? StringFilterMatch
            : V extends number | bigint
                ? RangeFilterMatch
                : V extends boolean
                    ? BooleanFilterMatch
                    : V extends object
                        ? FilterConfig<V>
                        : never;

/**
 * How a filter of an array with items of type `Item` can match: by its values, or, for items that are objects, by the
 * properties of at least one of them.
 */
type ArrayItemFilterConfigOf<Item> = Item extends Date | string | number | bigint | boolean
    ? ArrayFilterMatch
    : Item extends object
        ? FilterConfig<Item>
        : never;