/**
 * What a filter key takes: one value, or several that all have to hold.
 *
 * Several is what says "starts with rent and ends with 2026", which one pattern cannot. Only the
 * patterns take it - every other key says what it means once, since two bounds are the narrower of
 * the two and a list of allowed values is already a list.
 */
export type AllOf<T> = T | T[];

/**
 * The base where filter object.
 */
export type BaseWhereFilterObject<T> = {
    /**
     * The property needs to be not this value.
     */
    not?: T | null,
    /**
     * The property needs to be one of the values in the array.
     */
    oneOf?: (T | null)[],
    /**
     * The property needs to be NOT one of the values in the array.
     */
    notOneOf?: (T | null)[]
};

/**
 * A base where filter, shared by all property types.
 */
export type BaseWhereFilter<T, FilterObject extends BaseWhereFilterObject<T>> = T | null | FilterObject;