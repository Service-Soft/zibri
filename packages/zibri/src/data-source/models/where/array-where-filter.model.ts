import { Where, WhereFilterProperty } from './where-filter.model';

/**
 * A filter for an array where property.
 */
export type ArrayWhereFilter<ItemType> = null | ItemType[] | {
    /**
     * The property needs to be not this value.
     */
    not?: null | ItemType[],
    /**
     * The property needs to include the value.
     */
    includes?: ItemType[],
    /**
     * The properties items needs to be included in the value.
     */
    isIncludedIn?: ItemType[],
    /**
     * The length that this array needs to have.
     */
    length?: number,
    /**
     * The length of this array needs to be greater than the provided value.
     */
    lengthGreaterThan?: number,
    /**
     * The length of this array needs to be greater than or equal to the provided value.
     */
    lengthGreaterThanEquals?: number,
    /**
     * The length of this array needs to be lesser than the provided value.
     */
    lengthLesserThan?: number,
    /**
     * The length of this array needs to be lesser than or equal to the provided value.
     */
    lengthLesserThanEquals?: number,
    /**
     * A where condition that at least one of the items inside this array needs to match.
     */
    where?: never
}
| {
    /**
     * The property needs to be not this value.
     */
    not?: never,
    /**
     * The property needs to include the value.
     */
    includes?: never,
    /**
     * The properties items needs to be included in the value.
     */
    isIncludedIn?: never,
    /**
     * The length that this array needs to have.
     */
    length?: number,
    /**
     * The length of this array needs to be greater than the provided value.
     */
    lengthGreaterThan?: number,
    /**
     * The length of this array needs to be greater than or equal to the provided value.
     */
    lengthGreaterThanEquals?: number,
    /**
     * The length of this array needs to be lesser than the provided value.
     */
    lengthLesserThan?: number,
    /**
     * The length of this array needs to be lesser than or equal to the provided value.
     */
    lengthLesserThanEquals?: number,
    /**
     * A where condition that at least one of the items inside this array needs to match.
     */
    where: WhereFilterProperty<ItemType> | WhereFilterProperty<ItemType>[]
};

/**
 * A filter for an array of object items where property.
 */
export type ObjectArrayWhereFilter<ItemType extends object> = null | ItemType[] | {
    /**
     * The property needs to be not this value.
     */
    not?: null | ItemType[],
    /**
     * The property needs to include the value.
     */
    includes?: ItemType[],
    /**
     * The properties items needs to be included in the value.
     */
    isIncludedIn?: ItemType[],
    /**
     * The length that this array needs to have.
     */
    length?: number,
    /**
     * The length of this array needs to be greater than the provided value.
     */
    lengthGreaterThan?: number,
    /**
     * The length of this array needs to be greater than or equal to the provided value.
     */
    lengthGreaterThanEquals?: number,
    /**
     * The length of this array needs to be lesser than the provided value.
     */
    lengthLesserThan?: number,
    /**
     * The length of this array needs to be lesser than or equal to the provided value.
     */
    lengthLesserThanEquals?: number,
    /**
     * A where condition that at least one of the items inside this array needs to match.
     */
    where?: never
}
| {
    /**
     * The property needs to be not this value.
     */
    not?: never,
    /**
     * The property needs to include the value.
     */
    includes?: never,
    /**
     * The properties items needs to be included in the value.
     */
    isIncludedIn?: never,
    /**
     * The length that this array needs to have.
     */
    length?: number,
    /**
     * The length of this array needs to be greater than the provided value.
     */
    lengthGreaterThan?: number,
    /**
     * The length of this array needs to be greater than or equal to the provided value.
     */
    lengthGreaterThanEquals?: number,
    /**
     * The length of this array needs to be lesser than the provided value.
     */
    lengthLesserThan?: number,
    /**
     * The length of this array needs to be lesser than or equal to the provided value.
     */
    lengthLesserThanEquals?: number,
    /**
     * A where condition that at least one of the items inside this array needs to match.
     */
    where: Where<ItemType>
};