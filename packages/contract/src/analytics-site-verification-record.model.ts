/**
 * The DNS record that verifies a site of the analytics: a TXT record on the domain of the site itself.
 */
export type AnalyticsSiteVerificationRecordModel = {
    /**
     * The type of the record, always `TXT`.
     */
    type: 'TXT',
    /**
     * The name the record is added under: the domain of the site, such as `example.com`.
     */
    name: string,
    /**
     * The value of the record, `analytics-site-verification=` followed by the token of the site.
     */
    value: string
};