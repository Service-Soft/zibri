import { FilterConfig } from './filter-config.type';

/**
 * The bounds of a range filter, both included. Either may be left out.
 */
export type FilterRange<V> = {
    /**
     * The smallest value a row may have.
     */
    from?: V,
    /**
     * The largest value a row may have.
     */
    to?: V
};

/**
 * The value of a filter of a list of `T` that filters as `C` says, the `filter` of a request: every property may be
 * left out, and a row needs to meet every one that has a value.
 * @example
 * type TaskFilter = FilterValue<Task, typeof taskFilter>;
 * const filter: TaskFilter = { title: 'invoice', priority: { from: 3 }, address: { city: 'Berlin' } };
 */
export type FilterValue<T, C extends FilterConfig<T>> = {
    -readonly [K in keyof C & keyof T]?: FilterValueOf<NonNullable<T[K]>, C[K]>
};

/**
 * The value of the filter of a property of type `V` that matches as `M` says.
 */
type FilterValueOf<V, M> = M extends 'equals'
    ? V
    : M extends 'iLike' | 'fuzzy'
        ? string
        : M extends 'oneOf' | 'includes'
            ? (V extends readonly (infer Item)[] ? Item : V)[]
            : M extends 'range'
                ? FilterRange<V>
                : M extends object
                    ? V extends readonly (infer Item)[]
                        ? NestedFilterValue<NonNullable<Item>, M>
                        : NestedFilterValue<V, M>
                    : never;

/**
 * The value of the filter of the properties inside a value of type `V`.
 */
type NestedFilterValue<V, M> = M extends FilterConfig<V> ? FilterValue<V, M> : never;