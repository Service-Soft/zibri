/**
 * Where a visit came from: the host of the external page that linked to its entry, and the `utm_*` parameters of the
 * url it entered with. Every page view and event of the visit carries the source of its entry.
 */
export type AnalyticsSourceModel = {
    /**
     * The host of the external referrer, such as `google.com`, without `www.`.
     */
    referrer?: string,
    /**
     * The `utm_source` parameter of the entry.
     */
    utmSource?: string,
    /**
     * The `utm_medium` parameter of the entry.
     */
    utmMedium?: string,
    /**
     * The `utm_campaign` parameter of the entry.
     */
    utmCampaign?: string,
    /**
     * The `utm_term` parameter of the entry.
     */
    utmTerm?: string,
    /**
     * The `utm_content` parameter of the entry.
     */
    utmContent?: string
};