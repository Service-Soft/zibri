import { BaseWhereFilter, BaseWhereFilterObject } from './base-where-filter.model';
import { PropertiesHolding, PropertyReference } from './property-reference.model';

/**
 * What a date is compared with: a date, or another date property of the entity `Of`.
 */
type DateComparand<Of extends object> = Date | PropertyReference<PropertiesHolding<Of, Date>>;

/**
 * The date where filter object.
 */
type DateFilterWhereObject<Of extends object> = BaseWhereFilterObject<Date> & {
    /**
     * The property needs to be after the date.
     */
    after?: DateComparand<Of>,
    /**
     * The property needs to be before the date.
     */
    before?: DateComparand<Of>,
    /**
     * The property needs to be after or on the date.
     */
    afterOrOn?: DateComparand<Of>,
    /**
     * The property needs to be before or on the date.
     */
    beforeOrOn?: DateComparand<Of>
};

/**
 * A filter for a date where property. A comparison can name another date property of the entity `Of`
 * with `propertyOf`.
 */
export type DateWhereFilter<Of extends object = object> = BaseWhereFilter<Date, DateFilterWhereObject<Of>>;
