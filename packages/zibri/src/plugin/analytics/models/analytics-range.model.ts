/**
 * The days a query of the analytics counts, and the sites.
 */
export type AnalyticsRange = {
    /**
     * The first day, included.
     */
    from: Date,
    /**
     * The last day, included.
     */
    to: Date,
    /**
     * The host of one site, or undefined for every site of `tenantId`.
     */
    domain: string | undefined,
    /**
     * The tenant whose sites are counted, or undefined for every site the plugin counts, of any tenant or of none.
     */
    tenantId: string | undefined
};