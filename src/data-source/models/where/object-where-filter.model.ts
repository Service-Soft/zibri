import { Where } from './where-filter.model';

/**
 * A filter for a object where property.
 */
export type ObjectWhereFilter<T extends Object> = {
    /**
     * The property needs to equal the value.
     */
    is: T | null,
    /**
     * A where condition that the property needs to match.
     */
    where?: never,
    /**
     * The property needs to be not this value.
     */
    not?: never,
    /**
     * The property should be one of the provided values.
     */
    oneOf?: never,
    /**
     * The property should NOT be one of the provided values.
     */
    notOneOf?: never
}
| {
    /**
     * The property needs to equal the value.
     */
    is?: never,
    /**
     * A where condition that the property needs to match.
     */
    where: Where<T>,
    /**
     * The property needs to be not this value.
     */
    not?: never,
    /**
     * The property should be one of the provided values.
     */
    oneOf?: never,
    /**
     * The property should NOT be one of the provided values.
     */
    notOneOf?: never
}
| {
    /**
     * The property needs to equal the value.
     */
    is?: never,
    /**
     * A where condition that the property needs to match.
     */
    where?: never,
    /**
     * The property needs to be not this value.
     */
    not?: T | null,
    /**
     * The property should be one of the provided values.
     */
    oneOf?: (T | null)[],
    /**
     * The property should NOT be one of the provided values.
     */
    notOneOf?: (T | null)[]
};