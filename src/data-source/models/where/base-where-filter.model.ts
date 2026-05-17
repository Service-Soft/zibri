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