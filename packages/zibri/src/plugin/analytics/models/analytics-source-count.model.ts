import { type AnalyticsSourceCountModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';
import { AnalyticsSource } from './analytics-source.model';

/**
 * The visits and events of one source, as `GET /sources` of the `AnalyticsController` answers them.
 */
export class AnalyticsSourceCount implements AnalyticsSourceCountModel {
    /**
     * The source. A visit without a referrer and without `utm_*` parameters has a source without any of them.
     */
    @Property.object({ cls: () => AnalyticsSource })
    source!: AnalyticsSource;

    /**
     * The visits that came from the source.
     */
    @Property.number({ format: 'integer' })
    entries!: number;

    /**
     * The events of those visits.
     */
    @Property.number({ format: 'integer' })
    events!: number;
}