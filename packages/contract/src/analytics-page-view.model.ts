import { type AnalyticsSourceModel } from './analytics-source.model';

/**
 * A page view, as `POST /analytics/page-views` takes it.
 */
export type AnalyticsPageViewModel = {
    /**
     * A random uuid per visit, which links the page views and events of one visit.
     */
    visitId: string,
    /**
     * The host of the site, such as `example.com`. Counted only when the api allows it.
     */
    domain: string,
    /**
     * The path of the page, without query and hash, such as `/takeover`.
     */
    path: string,
    /**
     * The locale of the page, such as `de`.
     */
    language: string,
    /**
     * Whether this is the first page view of the visit.
     */
    entry: boolean,
    /**
     * Where the visit came from.
     */
    source: AnalyticsSourceModel,
    /**
     * A random uuid per device, sent only with the consent of the visitor.
     */
    visitorId?: string
};