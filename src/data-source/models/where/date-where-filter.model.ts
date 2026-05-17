import { BaseWhereFilter, BaseWhereFilterObject } from './base-where-filter.model';

/**
 * The date where filter object.
 */
type DateFilterWhereObject = BaseWhereFilterObject<Date> & {
    /**
     * The property needs to be after the value.
     */
    after?: Date,
    /**
     * The property needs to be before the value.
     */
    before?: Date
};

/**
 * A filter for a date where property.
 */
export type DateWhereFilter = BaseWhereFilter<Date, DateFilterWhereObject>;