import { BaseWhereFilter, BaseWhereFilterObject } from './base-where-filter.model';
import { PropertiesHolding, PropertyReference } from './property-reference.model';
import { DataSourceTime } from '../data-source-time.model';

/**
 * What a date is compared with: a date, another date property of the entity `Of`, or the time of the
 * data source.
 */
type DateComparand<Of extends object> = Date | PropertyReference<PropertiesHolding<Of, Date>> | DataSourceTime;

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
 * with `propertyOf`, or the time of the data source with `dataSourceNow`.
 */
export type DateWhereFilter<Of extends object = object> = BaseWhereFilter<Date, DateFilterWhereObject<Of>>;