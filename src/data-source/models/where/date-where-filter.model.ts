import { BaseWhereFilter, BaseWhereFilterObject } from './base-where-filter.model';

/**
 * The date where filter object.
 */
type DateFilterWhereObject = BaseWhereFilterObject<Date> & {
    /**
     * The property needs to be after the date.
     */
    after?: Date,
    /**
     * The property needs to be before the date.
     */
    before?: Date,
    /**
     * The property needs to be after or on the date.
     */
    afterOrOn?: Date,
    /**
     * The property needs to be before or on the date.
     */
    beforeOrOn?: Date
};

/**
 * A filter for a date where property.
 */
export type DateWhereFilter = BaseWhereFilter<Date, DateFilterWhereObject>;