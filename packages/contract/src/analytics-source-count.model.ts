import { type AnalyticsSourceModel } from './analytics-source.model';

/**
 * The visits and events of one source, as `GET /analytics/sources` answers them.
 */
export type AnalyticsSourceCountModel = {
    /**
     * The source. A visit without a referrer and without `utm_*` parameters has a source without any of them.
     */
    source: AnalyticsSourceModel,
    /**
     * The visits that came from the source.
     */
    entries: number,
    /**
     * The events of those visits.
     */
    events: number
};