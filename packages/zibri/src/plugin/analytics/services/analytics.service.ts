import { type AnalyticsFunnelBy, type AnalyticsSourceModel } from 'zibri-contract';

import { ZibriApplication } from '../../../application/application';
import { CacheRestoreTagUtilities } from '../../../caching/cache-restore-tag.utilities';
import { type CacheServiceInterface } from '../../../caching/cache-service.interface';
import { Where, WhereFilter } from '../../../data-source/models/where/where-filter.model';
import { Repository } from '../../../data-source/repository/repository';
import { EntityWriteObserverRegistry } from '../../../data-source/write-observers/entity-write-observer.registry';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { Inject } from '../../../di/decorators/inject.decorator';
import { Injectable } from '../../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { BadRequestError } from '../../../error-handling/errors/bad-request.error';
import { OnAppInit } from '../../../global/on-app-init.interface';
import { getZonedDate } from '../../../localization/get-zoned-date.function';
import { ZonedDate } from '../../../localization/models/zoned-date.model';
import { $ts } from '../../../localization/translate.function';
import { type TenantServiceInterface } from '../../../tenancy/tenant-service.interface';
import { OmitStrict } from '../../../types/omit-strict.type';
import { PromiseUtilities } from '../../../utilities/promise.utilities';
import { UUIDUtilities } from '../../../utilities/uuid.utilities';
import { AnalyticsSiteVerificationUtilities } from '../analytics-site-verification.utilities';
import { AnalyticsSiteWriteObserver } from '../analytics-site.write-observer';
import { AnalyticsUserAgentUtilities } from '../analytics-user-agent.utilities';
import { ZIBRI_ANALYTICS_PLUGIN_DI_TOKENS } from '../analytics.tokens';
import { AnalyticsDay } from '../models/analytics-day.model';
import { AnalyticsEventRecord } from '../models/analytics-event-record.model';
import { AnalyticsEvent } from '../models/analytics-event.model';
import { AnalyticsFunnelSource } from '../models/analytics-funnel-source.model';
import { AnalyticsFunnelStep } from '../models/analytics-funnel-step.model';
import { AnalyticsFunnel } from '../models/analytics-funnel.model';
import { AnalyticsPageViewRecord } from '../models/analytics-page-view-record.model';
import { AnalyticsPageView } from '../models/analytics-page-view.model';
import { AnalyticsPage } from '../models/analytics-page.model';
import { type AnalyticsPluginOptions } from '../models/analytics-plugin-options.model';
import { AnalyticsRange } from '../models/analytics-range.model';
import { AnalyticsSite, AnalyticsSiteCreateData } from '../models/analytics-site.model';
import { AnalyticsSourceCount } from '../models/analytics-source-count.model';
import { AnalyticsSystem } from '../models/analytics-system.model';
import { BaseAnalyticsRecord } from '../models/base-analytics-record.model';
import { AnalyticsServiceInterface } from './analytics-service.interface';

/**
 * The properties of a record that hold its source.
 */
type SourceKey = 'referrer' | 'utmSource' | 'utmMedium' | 'utmCampaign' | 'utmTerm' | 'utmContent';

/**
 * The source of a record, as it is stored.
 */
type StoredSource = Pick<BaseAnalyticsRecord, SourceKey>;

/**
 * What a record is created with, beyond what its own entity adds: with its tenant, or null, always named, since it is
 * created across tenants.
 */
type BaseRecordData = OmitStrict<BaseAnalyticsRecord, 'id' | 'tenantId'> & {
    /**
     * The tenant of its site, or null for a site of no tenant.
     */
    tenantId: string | null
};

/**
 * The page views and entries of one group of a count, which `resolveDays` and `resolvePages` fold into one answer,
 * with what the group is: a day, or a page.
 */
type PageViewCounts<G extends object> = G & {
    /**
     * Every page view of the group.
     */
    pageViews: number,
    /**
     * The entries among them.
     */
    entries: number,
    /**
     * The first page views of their visitor among them.
     */
    firstVisits: number,
    /**
     * The page views with a visitor.
     */
    consentedPageViews: number,
    /**
     * The visitors among them, each counted once.
     */
    visitors: number
};

/**
 * What the page views of a day are counted by.
 */
type DayGroup = {
    /**
     * The day, as `YYYY-MM-DD`.
     */
    day: string
};

/**
 * What the page views of a page are counted by.
 */
type PageGroup = {
    /**
     * The path of the page.
     */
    path: string,
    /**
     * The locale of the page.
     */
    language: string
};

/**
 * The page views of a group that share whether they entered and whether they were a first visit.
 */
type GroupedPageViews<G extends object> = {
    /**
     * The group, such as a day.
     */
    group: G,
    /**
     * Whether they entered their visit.
     */
    entry: boolean,
    /**
     * Whether they were the first of their visitor, null without one.
     */
    firstVisit?: boolean | null,
    /**
     * How many there are.
     */
    count: number
};

/**
 * The page views of one visitor in a group.
 */
type GroupedVisitor<G extends object> = {
    /**
     * The group, such as a day.
     */
    group: G,
    /**
     * How many page views the visitor has in it.
     */
    count: number
};

/**
 * The page views of one operating system, as the repository counts them.
 */
type OperatingSystemCount = Pick<AnalyticsPageViewRecord, 'operatingSystem'> & {
    /**
     * How many there are.
     */
    count: number
};

/**
 * The properties a funnel reads of every page view and event.
 */
type FunnelSelection = readonly ('visitId' | 'visitorId' | 'receivedAt' | SourceKey)[];

/**
 * One page view or event of a funnel, as far as the funnel reads it.
 */
type FunnelRow = {
    /**
     * When it arrived, in milliseconds.
     */
    at: number,
    /**
     * Whether it is the entry of its visit.
     */
    entry: boolean,
    /**
     * The path of a page view.
     */
    path: string | undefined,
    /**
     * The name of an event.
     */
    event: string | undefined,
    /**
     * The source of its visit.
     */
    source: StoredSource
};

/**
 * The funnel of one source, while it is counted.
 */
type FunnelCount = {
    /**
     * The source.
     */
    source: StoredSource,
    /**
     * The visits or visitors that entered.
     */
    entered: number,
    /**
     * How many reached each step.
     */
    reached: number[]
};

const SOURCE_KEYS: readonly SourceKey[] = ['referrer', 'utmSource', 'utmMedium', 'utmCampaign', 'utmTerm', 'utmContent'];

/**
 * The tag the sites are forgotten by, on every instance.
 */
const SITES_TAG: string = 'zibri.analytics-sites';

/**
 * What a host starts with that its site's domain leaves out.
 */
const WWW_PREFIX: string = 'www.';

/**
 * Default analytics service implementation of Zibri.
 */
@Injectable({ register: 'onUse' })
export class AnalyticsService implements AnalyticsServiceInterface, OnAppInit {
    // every site, by its domain, read once and again after any write to them: each page view looks its site up, and
    // the sites are few next to the page views. Undefined until the first page view, and after a write
    private sitesByDomain: Promise<ReadonlyMap<string, AnalyticsSite>> | undefined;

    constructor(
        @Inject(ZIBRI_ANALYTICS_PLUGIN_DI_TOKENS.OPTIONS)
        protected readonly options: AnalyticsPluginOptions
    ) {}

    // read when used rather than injected, for the reason MailingListService reads its repositories so: the plugin
    // names the entities that are missing, which it could not if building this had failed first

    /**
     * The repository of the sites.
     * @returns The repository.
     */
    protected get siteRepository(): Repository<AnalyticsSite> {
        return inject(repositoryTokenFor(AnalyticsSite));
    }

    /**
     * The repository of the page views.
     * @returns The repository.
     */
    protected get pageViewRepository(): Repository<AnalyticsPageViewRecord> {
        return inject(repositoryTokenFor(AnalyticsPageViewRecord));
    }

    /**
     * The repository of the events.
     * @returns The repository.
     */
    protected get eventRepository(): Repository<AnalyticsEventRecord> {
        return inject(repositoryTokenFor(AnalyticsEventRecord));
    }

    private get cacheService(): CacheServiceInterface {
        return inject(ZIBRI_DI_TOKENS.CACHE_SERVICE);
    }

    private get tenantService(): TenantServiceInterface {
        return inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    onAppInit(app: ZibriApplication): void {
        // a site verified or deleted is counted or dropped from the next page view on, here at once and on every other
        // instance within seconds, however it was written: by the routes, the default data or deleting its tenant
        inject(EntityWriteObserverRegistry).register(
            AnalyticsSite,
            new AnalyticsSiteWriteObserver(async () => await this.cacheService.invalidateTags([SITES_TAG]))
        );
        // a restore of the application or of a tenant replaces sites past the repository, which tells nobody
        this.cacheService.registerInvalidationListener(
            app,
            AnalyticsService.name,
            tag => tag === SITES_TAG || CacheRestoreTagUtilities.isRestoreTag(tag),
            () => {
                this.sitesByDomain = undefined;
                return Promise.resolve();
            }
        );
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findSites(tenantId: string | undefined): Promise<AnalyticsSite[]> {
        // across tenants, with the tenant named: a tenant would otherwise read the sites of no tenant as well, which
        // are the application's and none of its own
        return await this.siteRepository.findAll({
            where: tenantId == undefined ? undefined : { tenantId },
            acrossTenants: true,
            order: { domain: 'ASC' },
            limit: 'all'
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findSite(host: string): Promise<AnalyticsSite | undefined> {
        return (await this.resolveSitesByDomain()).get(this.toSiteDomain(host));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async createSite(data: AnalyticsSiteCreateData): Promise<AnalyticsSite> {
        const domain: string = this.toSiteDomain(data.domain);
        if (data.tenantId == undefined) {
            // a site of no tenant is the application's, which only the platform permission or its own code creates, and
            // is verified at once. A domain is counted by one verified site at most
            await this.validateNoVerifiedSite(domain, undefined);
            return await this.siteRepository.create(
                { domain, tenantId: null, verifiedAt: new Date(), verificationToken: null },
                { acrossTenants: true }
            );
        }
        await this.validateTenantExists(data.tenantId);
        // several tenants may claim a domain, and the one holding its record verifies it. One tenant claims it once
        if (await this.siteRepository.exists({ where: { domain, tenantId: data.tenantId }, acrossTenants: true })) {
            throw new BadRequestError($ts`The tenant has a site of the domain '${domain}' already.`);
        }
        // across tenants, so that the site belongs to the tenant its data names rather than the active one
        return await this.siteRepository.create(
            { domain, tenantId: data.tenantId, verifiedAt: null, verificationToken: UUIDUtilities.generate() },
            { acrossTenants: true }
        );
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async verifySite(id: string, tenantId: string | undefined): Promise<AnalyticsSite> {
        const site: AnalyticsSite = await this.findManagedSite(id, tenantId);
        if (site.verifiedAt != undefined || site.verificationToken == undefined) {
            return site;
        }
        if (!await this.hasVerificationRecord(site.domain, site.verificationToken)) {
            const expected: string = AnalyticsSiteVerificationUtilities.getRecordValue(site.verificationToken);
            throw new BadRequestError($ts`The domain '${site.domain}' needs a TXT record with the value '${expected}'.`);
        }
        // checked once the record is found, so that the answer names what is missing first. Two sites of one domain
        // verified at the same moment both pass, as two roles of one name do
        await this.validateNoVerifiedSite(site.domain, site.id);
        return await this.siteRepository.updateById(site.id, { verifiedAt: new Date(), recordMissingSince: null }, { acrossTenants: true });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async recheckVerifiedSites(): Promise<number> {
        // a site of no tenant is the application's, verified by nobody's record
        const sites: AnalyticsSite[] = await this.siteRepository.findAll({
            where: { verifiedAt: { not: null }, tenantId: { not: null } },
            acrossTenants: true,
            limit: 'all'
        });
        const now: Date = new Date();
        const lost: boolean[] = await PromiseUtilities.allChunked(sites, async site => await this.recheckVerifiedSite(site, now));
        return lost.filter(Boolean).length;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async deleteSite(id: string, tenantId: string | undefined): Promise<void> {
        const site: AnalyticsSite = await this.findManagedSite(id, tenantId);
        await this.siteRepository.deleteById(site.id, { acrossTenants: true });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async recordPageView(pageView: AnalyticsPageView, userAgent: string | undefined): Promise<void> {
        const data: BaseRecordData | undefined = await this.resolveRecordData(pageView, userAgent);
        if (data == undefined) {
            return;
        }
        // the first page view of a visitor is the one no row of theirs in the tenant of the site is older than. Two
        // first page views arriving at once both count, which a visit sending one page view at a time does not do
        const firstVisit: boolean | null = pageView.visitorId == undefined
            ? null
            : !await this.pageViewRepository.exists({
                where: { visitorId: pageView.visitorId, tenantId: data.tenantId },
                acrossTenants: true
            });
        await this.pageViewRepository.create({ ...data, entry: pageView.entry, firstVisit }, { acrossTenants: true });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async recordEvent(event: AnalyticsEvent, userAgent: string | undefined): Promise<void> {
        const data: BaseRecordData | undefined = await this.resolveRecordData(event, userAgent);
        if (data == undefined) {
            return;
        }
        await this.eventRepository.create({ ...data, name: event.name, category: event.category ?? null }, { acrossTenants: true });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveDays(range: AnalyticsRange): Promise<AnalyticsDay[]> {
        const where: WhereFilter<AnalyticsPageViewRecord> = this.resolveWhere(range);
        const [counts, consented] = await Promise.all([
            this.pageViewRepository.count({ where, groupBy: ['day', 'entry', 'firstVisit'], acrossTenants: true }),
            this.pageViewRepository.count({
                where: { ...where, visitorId: { not: null } },
                groupBy: ['day', 'visitorId'],
                acrossTenants: true
            })
        ]);
        const days: Map<string, PageViewCounts<DayGroup>> = this.foldPageViewCounts(
            counts.map(row => ({ ...row, group: { day: this.formatDay(row.day) } })),
            consented.map(row => ({ ...row, group: { day: this.formatDay(row.day) } }))
        );
        return [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolvePages(range: AnalyticsRange): Promise<AnalyticsPage[]> {
        const where: WhereFilter<AnalyticsPageViewRecord> = this.resolveWhere(range);
        const [counts, consented] = await Promise.all([
            this.pageViewRepository.count({ where, groupBy: ['path', 'language', 'entry', 'firstVisit'], acrossTenants: true }),
            this.pageViewRepository.count({
                where: { ...where, visitorId: { not: null } },
                groupBy: ['path', 'language', 'visitorId'],
                acrossTenants: true
            })
        ]);
        const pages: Map<string, PageViewCounts<PageGroup>> = this.foldPageViewCounts(
            counts.map(row => ({ ...row, group: { path: row.path, language: row.language } })),
            consented.map(row => ({ ...row, group: { path: row.path, language: row.language } }))
        );
        return [...pages.values()].sort((a, b) => b.pageViews - a.pageViews);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveSources(range: AnalyticsRange): Promise<AnalyticsSourceCount[]> {
        const [entries, events] = await Promise.all([
            this.pageViewRepository.count({
                where: { ...this.resolveWhere(range), entry: true },
                groupBy: SOURCE_KEYS,
                acrossTenants: true
            }),
            this.eventRepository.count({ where: this.resolveWhere(range), groupBy: SOURCE_KEYS, acrossTenants: true })
        ]);
        const sources: Map<string, AnalyticsSourceCount> = new Map();
        for (const row of entries) {
            this.resolveSourceCount(sources, row).entries += row.count;
        }
        for (const row of events) {
            this.resolveSourceCount(sources, row).events += row.count;
        }
        return [...sources.values()].sort((a, b) => b.entries - a.entries);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveSystems(range: AnalyticsRange): Promise<AnalyticsSystem[]> {
        const counts: OperatingSystemCount[] = await this.pageViewRepository
            .count({ where: this.resolveWhere(range), groupBy: ['operatingSystem'], acrossTenants: true });
        return counts
            .map(row => ({ operatingSystem: row.operatingSystem, pageViews: row.count }))
            .sort((a, b) => b.pageViews - a.pageViews);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveFunnel(range: AnalyticsRange, steps: AnalyticsFunnelStep[], by: AnalyticsFunnelBy): Promise<AnalyticsFunnel> {
        // in code rather than in the data source: the order of the steps of a visit is a question about the rows of
        // each visit in turn, which no filter or count of a repository asks. Read are the entries of the range and
        // the rows matching a step, and nothing else, once each
        const rows: Map<string, FunnelRow[]> = await this.findFunnelRows(range, steps, by);

        const total: FunnelCount = { source: {}, entered: 0, reached: steps.map(() => 0) };
        const bySource: Map<string, FunnelCount> = new Map();
        for (const followed of rows.values()) {
            const ordered: FunnelRow[] = followed.sort((a, b) => a.at - b.at);
            const entryIndex: number = ordered.findIndex(row => row.entry);
            const entry: FunnelRow | undefined = ordered[entryIndex];
            if (entry == undefined) {
                continue;
            }
            const sourceKey: string = this.resolveSourceKey(entry.source);
            let count: FunnelCount | undefined = bySource.get(sourceKey);
            if (count == undefined) {
                count = { source: entry.source, entered: 0, reached: steps.map(() => 0) };
                bySource.set(sourceKey, count);
            }
            const reached: number = this.countReachedSteps(ordered.slice(entryIndex), steps);
            for (const funnel of [total, count]) {
                funnel.entered++;
                for (let step: number = 0; step < reached; step++) {
                    funnel.reached[step] = (funnel.reached[step] ?? 0) + 1;
                }
            }
        }

        return {
            by,
            steps,
            entered: total.entered,
            reached: total.reached,
            sources: [...bySource.values()]
                .map((count): AnalyticsFunnelSource => ({ ...count, source: this.toSource(count.source) }))
                .sort((a, b) => b.entered - a.entered)
        };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async deleteExpiredRows(): Promise<number> {
        if (this.options.retentionInMs === 'forever') {
            return 0;
        }
        const before: Date = new Date(Date.now() - this.options.retentionInMs);
        const [pageViews, events] = await Promise.all([
            this.pageViewRepository.deleteAll({ day: { before } }, { acrossTenants: true }),
            this.eventRepository.deleteAll({ day: { before } }, { acrossTenants: true })
        ]);
        return pageViews + events;
    }

    /**
     * What every record of a page view or event is created with, or nothing for one the plugin drops.
     * @param data - The page view or event.
     * @param userAgent - The `User-Agent` of the request, which is read and not kept.
     * @returns The data, in the tenant of its site, or undefined for a domain no site has or a bot.
     */
    protected async resolveRecordData(
        data: AnalyticsPageView | AnalyticsEvent,
        userAgent: string | undefined
    ): Promise<BaseRecordData | undefined> {
        if (AnalyticsUserAgentUtilities.isBot(userAgent)) {
            return undefined;
        }
        // the tenant is the site's, and never the one the request names: anybody sends a page view, with any header
        const site: AnalyticsSite | undefined = await this.findSite(data.domain);
        if (site == undefined) {
            return undefined;
        }
        // dropped like any other, so a visitor of the site of a deactivated tenant notices nothing. Read from memory, as
        // the tenant service keeps it for every request
        if (site.tenantId != undefined && await this.tenantService.resolveIsDeactivated?.(site.tenantId) === true) {
            return undefined;
        }
        const receivedAt: Date = new Date();
        const zoned: ZonedDate = getZonedDate(receivedAt, this.options.timezone);
        return {
            tenantId: site.tenantId ?? null,
            day: new Date(Date.UTC(zoned.year, zoned.month, zoned.day)),
            receivedAt,
            domain: site.domain,
            path: data.path,
            language: data.language,
            visitId: data.visitId,
            visitorId: data.visitorId ?? null,
            referrer: data.source.referrer ?? null,
            utmSource: data.source.utmSource ?? null,
            utmMedium: data.source.utmMedium ?? null,
            utmCampaign: data.source.utmCampaign ?? null,
            utmTerm: data.source.utmTerm ?? null,
            utmContent: data.source.utmContent ?? null,
            // checked above: a bot has none
            operatingSystem: AnalyticsUserAgentUtilities.resolveOperatingSystem(userAgent ?? '')
        };
    }

    /**
     * Resolves every site, by its domain: from memory, or read once however many page views ask at a time.
     * @returns The sites, by domain.
     */
    private async resolveSitesByDomain(): Promise<ReadonlyMap<string, AnalyticsSite>> {
        if (this.sitesByDomain != undefined) {
            return await this.sitesByDomain;
        }
        const reading: Promise<ReadonlyMap<string, AnalyticsSite>> = this.readSitesByDomain();
        this.sitesByDomain = reading;
        try {
            return await reading;
        }
        catch (error) {
            // not kept, so that the next page view reads again rather than failing until the next write
            if (this.sitesByDomain === reading) {
                this.sitesByDomain = undefined;
            }
            throw error;
        }
    }

    /**
     * Reads every verified site, of every tenant and of none: the sites the page views are counted by.
     * @returns The sites, by domain.
     */
    private async readSitesByDomain(): Promise<ReadonlyMap<string, AnalyticsSite>> {
        const sites: AnalyticsSite[] = await this.siteRepository.findAll({
            where: { verifiedAt: { not: null } },
            acrossTenants: true,
            limit: 'all'
        });
        return new Map(sites.map(site => [site.domain, site]));
    }

    /**
     * Resolves whether a domain has the record of a verification token.
     * @param domain - The domain.
     * @param token - The verification token of the site.
     * @returns Whether one of its TXT records has the value.
     */
    private async hasVerificationRecord(domain: string, token: string): Promise<boolean> {
        const expected: string = AnalyticsSiteVerificationUtilities.getRecordValue(token);
        const records: string[] = await inject(ZIBRI_ANALYTICS_PLUGIN_DI_TOKENS.DNS_SERVICE).resolveTxtRecords(domain);
        return records.some(record => record.trim() === expected);
    }

    /**
     * Checks the record of a verified site again, as `recheckVerifiedSites` describes.
     * @param site - The site.
     * @param now - When the check runs.
     * @returns Whether the site lost its verification.
     */
    private async recheckVerifiedSite(site: AnalyticsSite, now: Date): Promise<boolean> {
        if (site.verificationToken == undefined) {
            return false;
        }
        let found: boolean;
        try {
            found = await this.hasVerificationRecord(site.domain, site.verificationToken);
        }
        catch (error) {
            // neither found nor missing: a resolver that failed says nothing about the record, and the next check asks
            // again
            inject(ZIBRI_DI_TOKENS.LOGGER).warn(`could not read the DNS records of the analytics site ${site.domain}: ${String(error)}`);
            return false;
        }
        if (found) {
            if (site.recordMissingSince != undefined) {
                await this.siteRepository.updateById(site.id, { recordMissingSince: null }, { acrossTenants: true });
            }
            return false;
        }
        if (site.recordMissingSince == undefined) {
            await this.siteRepository.updateById(site.id, { recordMissingSince: now }, { acrossTenants: true });
            return false;
        }
        if (now.getTime() - site.recordMissingSince.getTime() < this.options.verificationRecordGraceInMs) {
            return false;
        }
        // the token stays, so publishing the same record again and verifying the site counts it again
        await this.siteRepository.updateById(site.id, { verifiedAt: null, recordMissingSince: null }, { acrossTenants: true });
        return true;
    }

    /**
     * Finds a site a caller manages: of their tenant, or any.
     * @param id - The id of the site.
     * @param tenantId - The tenant the site belongs to, or undefined for a site of any tenant or of none.
     * @returns The site.
     * @throws A NotFoundError for a site of another tenant or of none, as for one that does not exist.
     */
    private async findManagedSite(id: string, tenantId: string | undefined): Promise<AnalyticsSite> {
        // found with the tenant in the filter, so a site of another tenant or of none is not found
        return await this.siteRepository.findOne({ where: tenantId == undefined ? { id } : { id, tenantId }, acrossTenants: true });
    }

    /**
     * Refuses a domain a verified site has, other than the one given.
     * @param domain - The domain.
     * @param exceptId - The site being verified, if any.
     * @throws A BadRequestError when another verified site has the domain.
     */
    private async validateNoVerifiedSite(domain: string, exceptId: string | undefined): Promise<void> {
        const verified: AnalyticsSite | undefined = await this.siteRepository.findOne({
            where: { domain, verifiedAt: { not: null } },
            acrossTenants: true,
            required: false
        });
        if (verified != undefined && verified.id !== exceptId) {
            throw new BadRequestError($ts`The domain '${domain}' is verified by another site already.`);
        }
    }

    /**
     * Refuses a tenant the application does not have, when it declares its tenants.
     * @param tenantId - The tenant.
     * @throws A BadRequestError when the tenants are declared and none has the id.
     */
    private async validateTenantExists(tenantId: string): Promise<void> {
        // an application without an entity of its tenants knows them by their ids alone, and has nothing to check
        if (this.tenantService.findTenantEntityClass?.() == undefined) {
            return;
        }
        if (await this.tenantService.findTenant?.(tenantId) == undefined) {
            throw new BadRequestError($ts`The tenant '${tenantId}' does not exist.`);
        }
    }

    /**
     * The domain of the site a host is counted by: the host in lower case, without `www.`.
     * @param host - The host, such as `www.Example.com`.
     * @returns The domain, such as `example.com`.
     */
    private toSiteDomain(host: string): string {
        const lower: string = host.toLowerCase();
        return lower.startsWith(WWW_PREFIX) ? lower.slice(WWW_PREFIX.length) : lower;
    }

    /**
     * The filter of a range: its days, its tenant when it names one, and its domain when it names one.
     * @param range - The range.
     * @returns The filter, for either entity, to read across tenants.
     */
    private resolveWhere(range: AnalyticsRange): WhereFilter<BaseAnalyticsRecord> {
        // read across tenants with the tenant in the filter, as the sites are: a tenant would otherwise count the rows
        // of the sites of no tenant as well
        const where: WhereFilter<BaseAnalyticsRecord> = {
            day: { afterOrOn: this.toDay(range.from), beforeOrOn: this.toDay(range.to) },
            ...range.tenantId == undefined ? {} : { tenantId: range.tenantId },
            ...range.domain == undefined ? {} : { domain: this.toSiteDomain(range.domain) }
        };
        return where;
    }

    /**
     * Folds the counts of the groups of page views into one count per key.
     * @param counts - The page views by key, entry and first visit.
     * @param consented - The page views with a visitor, by key and visitor.
     * @returns The counts, by key.
     */
    private foldPageViewCounts<G extends object>(
        counts: GroupedPageViews<G>[],
        consented: GroupedVisitor<G>[]
    ): Map<string, PageViewCounts<G>> {
        const folded: Map<string, PageViewCounts<G>> = new Map();
        const resolve: (group: G) => PageViewCounts<G> = group => {
            const key: string = JSON.stringify(group);
            let count: PageViewCounts<G> | undefined = folded.get(key);
            if (count == undefined) {
                count = { ...group, pageViews: 0, entries: 0, consentedPageViews: 0, visitors: 0, firstVisits: 0 };
                folded.set(key, count);
            }
            return count;
        };
        for (const row of counts) {
            const count: PageViewCounts<G> = resolve(row.group);
            count.pageViews += row.count;
            count.entries += row.entry ? row.count : 0;
            count.firstVisits += row.firstVisit === true ? row.count : 0;
        }
        // one group per visitor and key, so the groups are the visitors
        for (const row of consented) {
            const count: PageViewCounts<G> = resolve(row.group);
            count.consentedPageViews += row.count;
            count.visitors++;
        }
        return folded;
    }

    /**
     * Reads what a funnel follows: the entries of the range and the rows matching one of its steps, by visit or by
     * visitor.
     * @param range - The range.
     * @param steps - The steps.
     * @param by - Whether the rows are followed by visit, or by visitor.
     * @returns The rows of each visit or visitor, in no order.
     */
    private async findFunnelRows(
        range: AnalyticsRange,
        steps: AnalyticsFunnelStep[],
        by: AnalyticsFunnelBy
    ): Promise<Map<string, FunnelRow[]>> {
        const where: WhereFilter<BaseAnalyticsRecord> = by === 'visitor'
            ? { ...this.resolveWhere(range), visitorId: { not: null } }
            : this.resolveWhere(range);
        const paths: string[] = steps.flatMap(step => step.path == undefined ? [] : [step.path]);
        const events: string[] = steps.flatMap(step => step.event == undefined ? [] : [step.event]);
        const select: FunnelSelection = ['visitId', 'visitorId', 'receivedAt', ...SOURCE_KEYS];

        const rows: Map<string, FunnelRow[]> = new Map();
        const add: (record: Pick<BaseAnalyticsRecord, 'visitId' | 'visitorId'>, row: FunnelRow) => void = (record, row) => {
            const key: string | null | undefined = by === 'visitor' ? record.visitorId : record.visitId;
            if (key == undefined) {
                return;
            }
            const followed: FunnelRow[] | undefined = rows.get(key);
            if (followed == undefined) {
                rows.set(key, [row]);
                return;
            }
            followed.push(row);
        };

        const pageViewWhere: Where<AnalyticsPageViewRecord> = paths.length
            ? [{ ...where, entry: true }, { ...where, path: { oneOf: paths } }]
            : { ...where, entry: true };
        const pageViews: AsyncIterable<Pick<AnalyticsPageViewRecord, FunnelSelection[number] | 'path' | 'entry'>> = this.pageViewRepository
            .stream({ where: pageViewWhere, select: [...select, 'path', 'entry'], acrossTenants: true });
        for await (const record of pageViews) {
            add(record, { at: record.receivedAt.getTime(), entry: record.entry, path: record.path, event: undefined, source: record });
        }
        if (events.length) {
            const eventWhere: WhereFilter<AnalyticsEventRecord> = { ...where, name: { oneOf: events } };
            const named: AsyncIterable<Pick<AnalyticsEventRecord, FunnelSelection[number] | 'name'>> = this.eventRepository
                .stream({ where: eventWhere, select: [...select, 'name'], acrossTenants: true });
            for await (const record of named) {
                add(record, { at: record.receivedAt.getTime(), entry: false, path: undefined, event: record.name, source: record });
            }
        }
        return rows;
    }

    /**
     * How many steps a visit or visitor reached in order, from its entry on.
     * @param ordered - Its rows from the entry on, the earliest first.
     * @param steps - The steps.
     * @returns How many of the steps it reached, each after the ones before it.
     */
    private countReachedSteps(ordered: FunnelRow[], steps: AnalyticsFunnelStep[]): number {
        let reached: number = 0;
        for (const row of ordered) {
            const step: AnalyticsFunnelStep | undefined = steps[reached];
            if (step == undefined) {
                break;
            }
            const matches: boolean = step.path == undefined ? row.event === step.event : row.path === step.path;
            if (matches) {
                reached++;
            }
        }
        return reached;
    }

    /**
     * Finds the count of the source of a row, creating it when it is the first of its source.
     * @param sources - The counts so far, by source.
     * @param row - A row holding a source.
     * @returns The count of its source.
     */
    private resolveSourceCount(sources: Map<string, AnalyticsSourceCount>, row: StoredSource): AnalyticsSourceCount {
        const key: string = this.resolveSourceKey(row);
        let count: AnalyticsSourceCount | undefined = sources.get(key);
        if (count == undefined) {
            count = { source: this.toSource(row), entries: 0, events: 0 };
            sources.set(key, count);
        }
        return count;
    }

    /**
     * The key a source is told apart by.
     * @param source - The source, as it is stored.
     * @returns The key.
     */
    private resolveSourceKey(source: StoredSource): string {
        return JSON.stringify(SOURCE_KEYS.map(key => source[key] ?? null));
    }

    /**
     * A source as it is answered: the values it holds, and none of those it does not.
     * @param stored - The source, as it is stored.
     * @returns The source.
     */
    private toSource(stored: StoredSource): AnalyticsSourceModel {
        const source: AnalyticsSourceModel = {};
        for (const key of SOURCE_KEYS) {
            const value: string | null | undefined = stored[key];
            if (value != undefined) {
                source[key] = value;
            }
        }
        return source;
    }

    /**
     * Midnight UTC of the day a date is on, which is how a record holds its day.
     * @param date - The date.
     * @returns The day.
     */
    private toDay(date: Date): Date {
        return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    }

    /**
     * A day as it is answered.
     * @param day - The day, as a record holds it.
     * @returns The day as `YYYY-MM-DD`.
     */
    private formatDay(day: Date): string {
        return day.toISOString().slice(0, 10);
    }
}