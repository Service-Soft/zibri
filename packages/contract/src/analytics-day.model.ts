/**
 * The page views of one day, as `GET /analytics/days` answers them.
 */
export type AnalyticsDayModel = {
    /**
     * The day, as `YYYY-MM-DD`, in the time zone the api counts days in.
     */
    day: string,
    /**
     * Every page view of the day.
     */
    pageViews: number,
    /**
     * The page views that were the first of their visit, which is the number of visits that started on the day.
     */
    entries: number,
    /**
     * The page views that carried a visitor id, which a visitor sends only with consent. `visitors` and
     * `firstVisits` are counted among these alone.
     */
    consentedPageViews: number,
    /**
     * The visitors who consented and viewed a page on the day, each counted once.
     */
    visitors: number,
    /**
     * The visitors who consented and whose first page view the api kept is on the day.
     */
    firstVisits: number
};