/**
 * A site to count, as `POST /analytics/sites` takes it.
 */
export type NewAnalyticsSiteModel = {
    /**
     * The host of the site, such as `example.com`. Stored in lower case and without `www.`.
     */
    domain: string,
    /**
     * The tenant the site belongs to, or null for a site of no tenant. Only a caller holding
     * `analytics.sites.manage_all` names one other than the tenant of the request. Without it, the site belongs to
     * the tenant of the request, or to none when the request names none.
     */
    tenantId?: string | null
};