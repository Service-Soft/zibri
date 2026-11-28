import { type AnalyticsFunnelBy } from 'zibri-contract';

import { AnalyticsDay } from '../models/analytics-day.model';
import { AnalyticsEvent } from '../models/analytics-event.model';
import { AnalyticsFunnelStep } from '../models/analytics-funnel-step.model';
import { AnalyticsFunnel } from '../models/analytics-funnel.model';
import { AnalyticsPageView } from '../models/analytics-page-view.model';
import { AnalyticsPage } from '../models/analytics-page.model';
import { AnalyticsRange } from '../models/analytics-range.model';
import { AnalyticsSite, AnalyticsSiteCreateData } from '../models/analytics-site.model';
import { AnalyticsSourceCount } from '../models/analytics-source-count.model';
import { AnalyticsSystem } from '../models/analytics-system.model';

/**
 * Keeps the sites of the analytics plugin and their page views and events, and counts them.
 */
export interface AnalyticsServiceInterface {
    /**
     * Finds the sites of a tenant, or every site, of any tenant or of none, by their domain.
     * @param tenantId - The tenant, or undefined for every site.
     */
    findSites: (tenantId: string | undefined) => Promise<AnalyticsSite[]>,
    /**
     * Finds the verified site a host is counted by: the one of its domain, with or without `www.`, in any case.
     * @param host - The host, such as `www.example.com`.
     */
    findSite: (host: string) => Promise<AnalyticsSite | undefined>,
    /**
     * Creates a site, of the tenant its data names or of none, with its domain in lower case and without `www.`. A
     * site of no tenant is verified at once, one of a tenant gets a random verification token and is counted once
     * `verifySite` found its record. Refuses with a BadRequestError a tenant that does not exist, a domain the
     * tenant has a site of, and a site of no tenant of a domain a verified site has.
     */
    createSite: (data: AnalyticsSiteCreateData) => Promise<AnalyticsSite>,
    /**
     * Verifies a site by the TXT record `analytics-site-verification=<token>` on its domain, read through
     * `ZIBRI_ANALYTICS_PLUGIN_DI_TOKENS.DNS_SERVICE`. A site verified already is answered as it is.
     * @param id - The id of the site.
     * @param tenantId - The tenant the site belongs to, or undefined for a site of any tenant or of none. A site of
     * another is refused with a NotFoundError, as one that does not exist.
     * @returns The site, verified.
     * @throws A BadRequestError when the domain lacks the record, or another verified site has the domain.
     */
    verifySite: (id: string, tenantId: string | undefined) => Promise<AnalyticsSite>,
    /**
     * Checks the record of every verified site of a tenant again. A site whose record is found stays verified, and
     * forgets when it was found missing. A site whose record is missing is marked missing since now, and loses its
     * verification once it was missing for `verificationRecordGraceInMs` of the plugin, keeping its token. A site
     * whose records cannot be read is left as it is. Sites of no tenant are not checked.
     * @returns How many sites lost their verification.
     */
    recheckVerifiedSites: () => Promise<number>,
    /**
     * Deletes a site. Its page views and events are kept until they expire.
     * @param id - The id of the site.
     * @param tenantId - The tenant the site belongs to, or undefined for a site of any tenant or of none. A site of
     * another is refused with a NotFoundError, as one that does not exist.
     */
    deleteSite: (id: string, tenantId: string | undefined) => Promise<void>,
    /**
     * Keeps a page view, with the day and the rough operating system, in the tenant of its site. A page view of a
     * domain no verified site has, of a site whose tenant is deactivated, or from a bot, is dropped.
     */
    recordPageView: (pageView: AnalyticsPageView, userAgent: string | undefined) => Promise<void>,
    /**
     * Keeps an event, as `recordPageView` keeps a page view.
     */
    recordEvent: (event: AnalyticsEvent, userAgent: string | undefined) => Promise<void>,
    /**
     * Counts the page views of each day of the range that has any, the earliest first.
     */
    resolveDays: (range: AnalyticsRange) => Promise<AnalyticsDay[]>,
    /**
     * Counts the page views of each page and language of the range, the most viewed first.
     */
    resolvePages: (range: AnalyticsRange) => Promise<AnalyticsPage[]>,
    /**
     * Counts the visits and events of each source of the range, the most entered first.
     */
    resolveSources: (range: AnalyticsRange) => Promise<AnalyticsSourceCount[]>,
    /**
     * Counts the page views of each operating system of the range, the most viewed first.
     */
    resolveSystems: (range: AnalyticsRange) => Promise<AnalyticsSystem[]>,
    /**
     * Counts the visits, or the visitors who consented, that entered in the range, and how many of them reached
     * each step after the steps before it, overall and by source.
     */
    resolveFunnel: (range: AnalyticsRange, steps: AnalyticsFunnelStep[], by: AnalyticsFunnelBy) => Promise<AnalyticsFunnel>,
    /**
     * Deletes the page views and events older than the `retentionInMs` of the plugin, of every tenant.
     * @returns How many it deleted.
     */
    deleteExpiredRows: () => Promise<number>
}