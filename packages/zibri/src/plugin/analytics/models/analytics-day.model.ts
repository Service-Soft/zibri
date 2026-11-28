import { type AnalyticsDayModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';

/**
 * The page views of one day, as `GET /days` of the `AnalyticsController` answers them.
 */
export class AnalyticsDay implements AnalyticsDayModel {
    /**
     * The day, as `YYYY-MM-DD`, in the `timezone` of the plugin.
     */
    @Property.string()
    day!: string;

    /**
     * Every page view of the day.
     */
    @Property.number({ format: 'integer' })
    pageViews!: number;

    /**
     * The visits that started on the day.
     */
    @Property.number({ format: 'integer' })
    entries!: number;

    /**
     * The page views that carried a visitor id, which a visitor sends only with consent. `visitors` and
     * `firstVisits` are counted among these alone.
     */
    @Property.number({ format: 'integer' })
    consentedPageViews!: number;

    /**
     * The visitors who consented and viewed a page on the day, each counted once.
     */
    @Property.number({ format: 'integer' })
    visitors!: number;

    /**
     * The visitors who consented and whose first page view kept is on the day.
     */
    @Property.number({ format: 'integer' })
    firstVisits!: number;
}