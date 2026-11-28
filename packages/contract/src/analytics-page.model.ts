/**
 * The page views of one page in one language, as `GET /analytics/pages` answers them.
 */
export type AnalyticsPageModel = {
    /**
     * The path of the page, such as `/takeover`.
     */
    path: string,
    /**
     * The locale of the page, such as `de`.
     */
    language: string,
    /**
     * Every page view of the page.
     */
    pageViews: number,
    /**
     * The visits that entered on the page.
     */
    entries: number,
    /**
     * The page views that carried a visitor id, which a visitor sends only with consent. `visitors` and
     * `firstVisits` are counted among these alone.
     */
    consentedPageViews: number,
    /**
     * The visitors who consented and viewed the page, each counted once.
     */
    visitors: number,
    /**
     * The visitors who consented and whose first page view the api kept is of the page.
     */
    firstVisits: number
};