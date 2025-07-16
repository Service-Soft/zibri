import { BaseWhereFilter } from './base-where-filter.model';

/**
 * A filter for a date where property.
 */
export type DateWhereFilter = BaseWhereFilter<Date> | {
    /**
     * The property needs to be not this value.
     */
    not?: Date,
    /**
     * The property needs to be one of the values in the array.
     */
    oneOf?: Date[],
    /**
     * The property needs to be NOT one of the values in the array.
     */
    notOneOf?: Date[],
    /**
     * The property needs to be after the value.
     */
    after?: Date,
    /**
     * The property needs to be before the value.
     */
    before?: Date
};