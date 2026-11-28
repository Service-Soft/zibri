import { type AnalyticsFunnelBy } from 'zibri-contract';

import { Auth } from '../../auth/decorators/auth.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AnyLevelPermissions } from '../../auth/models/any-level-permissions.model';
import { type PlatformPermission } from '../../auth/roles/platform-permission.type';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { ForbiddenError } from '../../error-handling/errors/forbidden.error';
import { ValidationError } from '../../error-handling/errors/validation.error';
import { ValidationProblemCode } from '../../error-handling/validation-problem-code.enum';
import { HttpStatus } from '../../http/http-status.enum';
import { KnownHeader } from '../../http/known-header.enum';
import { $ts } from '../../localization/translate.function';
import { Response } from '../../open-api/decorators/response.decorator';
import { RateLimited } from '../../rate-limiting/decorators/rate-limited.decorator';
import { Body } from '../../routing/decorators/body.decorator';
import { Delete } from '../../routing/decorators/delete.decorator';
import { Get } from '../../routing/decorators/get.decorator';
import { Param } from '../../routing/decorators/param.decorator';
import { Post } from '../../routing/decorators/post.decorator';
import { type TenantServiceInterface } from '../../tenancy/tenant-service.interface';
import { AnalyticsSiteVerificationUtilities } from './analytics-site-verification.utilities';
import { ZIBRI_ANALYTICS_PLUGIN_DI_TOKENS } from './analytics.tokens';
import { AnalyticsDay } from './models/analytics-day.model';
import { AnalyticsEvent } from './models/analytics-event.model';
import { ANALYTICS_FUNNEL_BY } from './models/analytics-funnel-by.model';
import { AnalyticsFunnelStep } from './models/analytics-funnel-step.model';
import { AnalyticsFunnel } from './models/analytics-funnel.model';
import { AnalyticsLimits } from './models/analytics-limits.model';
import { AnalyticsPageView } from './models/analytics-page-view.model';
import { AnalyticsPage } from './models/analytics-page.model';
import { AnalyticsRange } from './models/analytics-range.model';
import { AnalyticsSiteDetails } from './models/analytics-site-details.model';
import { AnalyticsSite } from './models/analytics-site.model';
import { AnalyticsSourceCount } from './models/analytics-source-count.model';
import { AnalyticsSystem } from './models/analytics-system.model';
import { NewAnalyticsSite } from './models/new-analytics-site.model';
import { ZibriAnalyticsPermissions, ZibriAnalyticsPlatformPermissions } from './models/zibri-analytics-permissions.model';
import { type AnalyticsServiceInterface } from './services/analytics-service.interface';

const SITES_MANAGE: AnyLevelPermissions = {
    permission: ZibriAnalyticsPermissions.ANALYTICS_SITES_MANAGE,
    platformPermission: ZibriAnalyticsPlatformPermissions.ANALYTICS_SITES_MANAGE_ALL
};
const DAYS_READ: AnyLevelPermissions = {
    permission: ZibriAnalyticsPermissions.ANALYTICS_DAYS_READ,
    platformPermission: ZibriAnalyticsPlatformPermissions.ANALYTICS_DAYS_READ_ALL
};
const PAGES_READ: AnyLevelPermissions = {
    permission: ZibriAnalyticsPermissions.ANALYTICS_PAGES_READ,
    platformPermission: ZibriAnalyticsPlatformPermissions.ANALYTICS_PAGES_READ_ALL
};
const SOURCES_READ: AnyLevelPermissions = {
    permission: ZibriAnalyticsPermissions.ANALYTICS_SOURCES_READ,
    platformPermission: ZibriAnalyticsPlatformPermissions.ANALYTICS_SOURCES_READ_ALL
};
const SYSTEMS_READ: AnyLevelPermissions = {
    permission: ZibriAnalyticsPermissions.ANALYTICS_SYSTEMS_READ,
    platformPermission: ZibriAnalyticsPlatformPermissions.ANALYTICS_SYSTEMS_READ_ALL
};
const FUNNEL_READ: AnyLevelPermissions = {
    permission: ZibriAnalyticsPermissions.ANALYTICS_FUNNEL_READ,
    platformPermission: ZibriAnalyticsPlatformPermissions.ANALYTICS_FUNNEL_READ_ALL
};

/**
 * The routes of the analytics, below the path of the controller that extends it: `POST /page-views` and
 * `POST /events`, which anybody may call, the sites, and the counts. The sites and each count are behind a permission
 * of `ZIBRI_ANALYTICS_PERMISSIONS`, for the sites of the tenant of the request, or of
 * `ZIBRI_ANALYTICS_PLATFORM_PERMISSIONS`, for every site.
 */
// no @Controller of its own, for the reason MailingListController has none: the application's class extending this
// one says where the routes are. Every decorator is on a route rather than the class, which the application's class
// would not inherit
export class AnalyticsController {
    // read when used rather than injected, for the reason MailingListController reads its service so
    private get analyticsService(): AnalyticsServiceInterface {
        return inject(ZIBRI_ANALYTICS_PLUGIN_DI_TOKENS.ANALYTICS_SERVICE);
    }

    private get tenantService(): TenantServiceInterface {
        return inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);
    }

    // sent by the pages of a site, by visitors who are nobody to the application, so public whatever the
    // application declared, and redundant on purpose for the reason the routes of MailingListController are. A page
    // view that is not counted is answered like one that is: the page has nothing to do about it, and a bot learns
    // nothing about what is dropped
    @Auth.skip({ allowRedundant: true })
    @RateLimited(ZIBRI_ANALYTICS_PLUGIN_DI_TOKENS.RATE_LIMITER)
    @Response.empty()
    @Post('/page-views')
    async recordPageView(
        @Body(AnalyticsPageView, { maxSize: AnalyticsLimits.BODY_MAX_SIZE })
        pageView: AnalyticsPageView,
        @Param.header(KnownHeader.USER_AGENT, { type: 'string', required: false })
        userAgent: string | undefined
    ): Promise<void> {
        await this.analyticsService.recordPageView(pageView, userAgent);
    }

    @Auth.skip({ allowRedundant: true })
    @RateLimited(ZIBRI_ANALYTICS_PLUGIN_DI_TOKENS.RATE_LIMITER)
    @Response.empty()
    @Post('/events')
    async recordEvent(
        @Body(AnalyticsEvent, { maxSize: AnalyticsLimits.BODY_MAX_SIZE })
        event: AnalyticsEvent,
        @Param.header(KnownHeader.USER_AGENT, { type: 'string', required: false })
        userAgent: string | undefined
    ): Promise<void> {
        await this.analyticsService.recordEvent(event, userAgent);
    }

    @Auth.hasAnyLevelPermission(SITES_MANAGE)
    @Response.array(AnalyticsSiteDetails)
    @Get('/sites')
    async findSites(
        @CurrentUser()
        user: CurrentUser
    ): Promise<AnalyticsSiteDetails[]> {
        const tenantId: string | undefined = this.resolveReadTenantId(user, SITES_MANAGE.platformPermission);
        const sites: AnalyticsSite[] = await this.analyticsService.findSites(tenantId);
        return sites.map(site => AnalyticsSiteVerificationUtilities.getDetails(site));
    }

    // with the tenant permission alone, a site is created in the tenant of the request and nowhere else, whatever the
    // body names: a site decides whose counts its page views become, so one in another tenant or in none would hand
    // the caller's visitors to somebody else, or the application's to the caller
    @Auth.hasAnyLevelPermission(SITES_MANAGE)
    @Response.object(AnalyticsSiteDetails)
    @Post('/sites')
    async createSite(
        @Body(NewAnalyticsSite)
        site: NewAnalyticsSite,
        @CurrentUser()
        user: CurrentUser
    ): Promise<AnalyticsSiteDetails> {
        const activeTenantId: string | undefined = this.tenantService.getActiveTenantId();
        // in the case the active tenant is in, which every uuid is stored in
        const named: string | null | undefined = site.tenantId?.toLowerCase() ?? site.tenantId;
        if (user.platformPermissions.includes(SITES_MANAGE.platformPermission)) {
            const tenantId: string | null = named === undefined ? activeTenantId ?? null : named;
            return AnalyticsSiteVerificationUtilities.getDetails(await this.analyticsService.createSite({ domain: site.domain, tenantId }));
        }
        if (activeTenantId == undefined || (named !== undefined && named !== activeTenantId)) {
            throw new ForbiddenError($ts`Only analytics.sites.manage_all creates a site of another tenant or of none.`);
        }
        const created: AnalyticsSite = await this.analyticsService.createSite({ domain: site.domain, tenantId: activeTenantId });
        return AnalyticsSiteVerificationUtilities.getDetails(created);
    }

    @Auth.hasAnyLevelPermission(SITES_MANAGE)
    @Response.error(HttpStatus.NOT_FOUND)
    @Response.object(AnalyticsSiteDetails)
    @Post('/sites/:id/verify')
    async verifySite(
        @Param.path('id', { type: 'string', format: 'uuid' })
        id: string,
        @CurrentUser()
        user: CurrentUser
    ): Promise<AnalyticsSiteDetails> {
        const verified: AnalyticsSite = await this.analyticsService.verifySite(id, this.resolveManagedTenantId(user));
        return AnalyticsSiteVerificationUtilities.getDetails(verified);
    }

    @Auth.hasAnyLevelPermission(SITES_MANAGE)
    @Response.error(HttpStatus.NOT_FOUND)
    @Response.empty()
    @Delete('/sites/:id')
    async deleteSite(
        @Param.path('id', { type: 'string', format: 'uuid' })
        id: string,
        @CurrentUser()
        user: CurrentUser
    ): Promise<void> {
        await this.analyticsService.deleteSite(id, this.resolveManagedTenantId(user));
    }

    @Auth.hasAnyLevelPermission(DAYS_READ)
    @Response.array(AnalyticsDay)
    @Get('/days')
    async resolveDays(
        @Param.query('from', { type: 'date' })
        from: Date,
        @Param.query('to', { type: 'date' })
        to: Date,
        @Param.query('domain', { type: 'string', required: false })
        domain: string | undefined,
        @CurrentUser()
        user: CurrentUser
    ): Promise<AnalyticsDay[]> {
        return await this.analyticsService.resolveDays(this.resolveRange(from, to, domain, user, DAYS_READ));
    }

    @Auth.hasAnyLevelPermission(PAGES_READ)
    @Response.array(AnalyticsPage)
    @Get('/pages')
    async resolvePages(
        @Param.query('from', { type: 'date' })
        from: Date,
        @Param.query('to', { type: 'date' })
        to: Date,
        @Param.query('domain', { type: 'string', required: false })
        domain: string | undefined,
        @CurrentUser()
        user: CurrentUser
    ): Promise<AnalyticsPage[]> {
        return await this.analyticsService.resolvePages(this.resolveRange(from, to, domain, user, PAGES_READ));
    }

    @Auth.hasAnyLevelPermission(SOURCES_READ)
    @Response.array(AnalyticsSourceCount)
    @Get('/sources')
    async resolveSources(
        @Param.query('from', { type: 'date' })
        from: Date,
        @Param.query('to', { type: 'date' })
        to: Date,
        @Param.query('domain', { type: 'string', required: false })
        domain: string | undefined,
        @CurrentUser()
        user: CurrentUser
    ): Promise<AnalyticsSourceCount[]> {
        return await this.analyticsService.resolveSources(this.resolveRange(from, to, domain, user, SOURCES_READ));
    }

    @Auth.hasAnyLevelPermission(SYSTEMS_READ)
    @Response.array(AnalyticsSystem)
    @Get('/systems')
    async resolveSystems(
        @Param.query('from', { type: 'date' })
        from: Date,
        @Param.query('to', { type: 'date' })
        to: Date,
        @Param.query('domain', { type: 'string', required: false })
        domain: string | undefined,
        @CurrentUser()
        user: CurrentUser
    ): Promise<AnalyticsSystem[]> {
        return await this.analyticsService.resolveSystems(this.resolveRange(from, to, domain, user, SYSTEMS_READ));
    }

    @Auth.hasAnyLevelPermission(FUNNEL_READ)
    @Response.object(AnalyticsFunnel)
    @Get('/funnel')
    async resolveFunnel(
        @Param.query('from', { type: 'date' })
        from: Date,
        @Param.query('to', { type: 'date' })
        to: Date,
        @Param.query('steps', { type: 'array', items: { type: 'object', cls: () => AnalyticsFunnelStep } })
        steps: AnalyticsFunnelStep[],
        @Param.query('by', { type: 'string', enum: ANALYTICS_FUNNEL_BY, required: false })
        by: AnalyticsFunnelBy | undefined,
        @Param.query('domain', { type: 'string', required: false })
        domain: string | undefined,
        @CurrentUser()
        user: CurrentUser
    ): Promise<AnalyticsFunnel> {
        // each step widens the rows the funnel reads, and an array query parameter declares no maximum of its own
        if (steps.length > AnalyticsLimits.FUNNEL_MAX_STEPS) {
            throw new ValidationError('query', 'steps', [
                {
                    key: 'steps',
                    code: ValidationProblemCode.MAX_LENGTH,
                    message: $ts`needs to be at most ${AnalyticsLimits.FUNNEL_MAX_STEPS} steps`
                }
            ]);
        }
        return await this.analyticsService.resolveFunnel(this.resolveRange(from, to, domain, user, FUNNEL_READ), steps, by ?? 'visit');
    }

    /**
     * The range a query counts: the days, the site it names, and the sites of the tenant of the request, or every
     * site for a request naming no tenant.
     * @param from - The first day.
     * @param to - The last day.
     * @param domain - The host of one site, if any.
     * @param user - The caller.
     * @param permissions - The permissions of the route.
     * @returns The range.
     */
    private resolveRange(
        from: Date,
        to: Date,
        domain: string | undefined,
        user: CurrentUser,
        permissions: AnyLevelPermissions
    ): AnalyticsRange {
        return { from, to, domain, tenantId: this.resolveReadTenantId(user, permissions.platformPermission) };
    }

    /**
     * The tenant whose sites a caller reads: the tenant of the request, or undefined for every site, of any tenant or
     * of none, which only the platform permission reads.
     * @param user - The caller.
     * @param platformPermission - The platform permission of the route.
     * @returns The tenant, or undefined for every site.
     * @throws A ForbiddenError for a request naming no tenant of a caller without the platform permission.
     */
    private resolveReadTenantId(user: CurrentUser, platformPermission: PlatformPermission): string | undefined {
        const tenantId: string | undefined = this.tenantService.getActiveTenantId();
        // @Auth.hasAnyLevelPermission lets a request naming no tenant through by the platform permission alone. Asked
        // again here, as the tenant permission reaching every site is the one thing these routes may never do
        if (tenantId == undefined && !user.platformPermissions.includes(platformPermission)) {
            throw new ForbiddenError($ts`You do not have permission to access this route.`);
        }
        return tenantId;
    }

    /**
     * The tenant whose sites a caller verifies and removes: undefined for any site with the platform permission, the
     * tenant of the request with the tenant permission alone.
     * @param user - The caller.
     * @returns The tenant, or undefined for any site.
     * @throws A ForbiddenError for a request naming no tenant of a caller without the platform permission.
     */
    private resolveManagedTenantId(user: CurrentUser): string | undefined {
        return user.platformPermissions.includes(SITES_MANAGE.platformPermission)
            ? undefined
            : this.resolveReadTenantId(user, SITES_MANAGE.platformPermission);
    }
}