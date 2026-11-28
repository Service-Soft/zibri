import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { type AnalyticsFunnelModel, type AnalyticsFunnelStepModel, type AnalyticsPageViewModel, type AnalyticsSiteModel } from 'zibri-contract';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { TestTimeouts } from '../../__testing__/constants';
import { JwtUser } from '../../__testing__/mocks/entities/jwt-user.entity';
import { MemberRoles } from '../../__testing__/mocks/entities/member-roles.enum';
import { Roles } from '../../__testing__/mocks/entities/roles.enum';
import { TestTenant } from '../../__testing__/mocks/entities/test-tenant.entity';
import { runWithApplicationClockAhead } from '../../__testing__/run-with-application-clock-ahead.function';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { DefaultTestServerMembershipRepository } from '../../__testing__/test-server/membership-repository';
import { defaultTestServerProviders, rolesAndPermissionsProviders, TestServerRole } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { type AuthServiceInterface } from '../../auth/auth-service.interface';
import { type Permission } from '../../auth/roles/permission.type';
import { type PlatformPermission } from '../../auth/roles/platform-permission.type';
import { ApiKeyAuthStrategy } from '../../auth/strategies/api-key/api-key.auth-strategy';
import { ApiKey } from '../../auth/strategies/api-key/api-key.model';
import { CreatedApiKey } from '../../auth/strategies/api-key/created-api-key.model';
import { JwtAuthStrategy } from '../../auth/strategies/jwt/jwt.auth-strategy';
import { CreateCronJobEntityData, CronJobEntity } from '../../cron/cron-job-entity.model';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { defineProvider, DiProvider } from '../../di/models/di-provider.model';
import { DiVariants } from '../../di/models/di-variant.model';
import { ServiceUnavailableError } from '../../error-handling/errors/service-unavailable.error';
import { $ts } from '../../localization/translate.function';
import { RateLimiter } from '../../rate-limiting/decorators/rate-limiter.decorator';
import { TokenBucketRateLimiter, TokenBucketState } from '../../rate-limiting/limiter/token-bucket.rate-limiter';
import { InMemoryRateLimiterStore } from '../../rate-limiting/stores/in-memory.rate-limiter-store';
import { Controller } from '../../routing/decorators/controller.decorator';
import { type TenantServiceInterface } from '../../tenancy/tenant-service.interface';
import { Newable } from '../../types/newable.type';
import { Ms } from '../../utilities/ms';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { AnalyticsCleanupCronJob } from './analytics-cleanup.cron-job';
import { AnalyticsSiteVerificationCronJob } from './analytics-site-verification.cron-job';
import { AnalyticsSiteVerificationUtilities } from './analytics-site-verification.utilities';
import { AnalyticsController } from './analytics.controller';
import { ZibriAnalyticsPlugin } from './analytics.plugin';
import { ZIBRI_ANALYTICS_PLUGIN_DI_TOKENS } from './analytics.tokens';
import { AnalyticsDay } from './models/analytics-day.model';
import { AnalyticsEventRecord } from './models/analytics-event-record.model';
import { AnalyticsOperatingSystem } from './models/analytics-operating-system.enum';
import { AnalyticsPageViewRecord } from './models/analytics-page-view-record.model';
import { AnalyticsPage } from './models/analytics-page.model';
import { AnalyticsSite } from './models/analytics-site.model';
import { AnalyticsSourceCount } from './models/analytics-source-count.model';
import { AnalyticsSystem } from './models/analytics-system.model';
import { BaseAnalyticsRecord } from './models/base-analytics-record.model';
import { ZibriAnalyticsPermissions, ZibriAnalyticsPlatformPermissions } from './models/zibri-analytics-permissions.model';
import { type AnalyticsDnsServiceInterface } from './services/analytics-dns-service.interface';
import { type AnalyticsServiceInterface } from './services/analytics-service.interface';

const WINDOWS_CHROME: string = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const IPHONE_SAFARI: string = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const GOOGLEBOT: string = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

// the site of the application the visitors send from, and one the rows of the query suites are kept apart by
const SITE: string = 'example.com';
const QUERIED_SITE: string = 'stats.example.com';

// two customers of a tracking platform, each counting sites of its own, and one who left, created by the first server
let acmeId: string = '';
let zenithId: string = '';
let dormantId: string = '';

const TENANT_PERMISSIONS: Permission[] = Object.values(ZibriAnalyticsPermissions);
const PLATFORM_PERMISSIONS: PlatformPermission[] = Object.values(ZibriAnalyticsPlatformPermissions);

const roles: TestServerRole[] = [
    { name: Roles.USER, level: 'platform', permissions: [], description: undefined },
    { name: Roles.ADMIN, level: 'platform', permissions: PLATFORM_PERMISSIONS, description: undefined },
    { name: MemberRoles.USER, level: 'tenant', permissions: [], description: undefined },
    { name: MemberRoles.ADMIN, level: 'tenant', permissions: TENANT_PERMISSIONS, description: undefined }
];

/**
 * A limiter roomy enough for every request of a suite, which all come from one address.
 */
@RateLimiter({ register: 'onUse' })
class RoomyRateLimiter extends TokenBucketRateLimiter {
    constructor() {
        super(Ms.MINUTE, { name: 'RoomyRateLimiter', store: new InMemoryRateLimiterStore<TokenBucketState>(), capacity: 10_000, maxReservationWaitInMs: undefined });
    }
}

@Controller('/analytics', { versions: 'all' })
class SiteAnalyticsController extends AnalyticsController {}

/**
 * The TXT records of the domains of the suite, which the DNS of the internet would answer: a test sends no request to
 * a resolver.
 */
class PublishedRecords implements AnalyticsDnsServiceInterface {
    /**
     * The domains whose records were asked for, in order.
     */
    readonly asked: string[] = [];

    /**
     * The domains whose resolver fails, as one that cannot be reached.
     */
    readonly failing: Set<string> = new Set();

    private readonly records: Map<string, string[]> = new Map();

    /**
     * Publishes a TXT record on a domain.
     * @param domain - The domain.
     * @param value - The value of the record.
     */
    publish(domain: string, value: string): void {
        this.records.set(domain, [...this.records.get(domain) ?? [], value]);
    }

    /**
     * Removes every TXT record of a domain.
     * @param domain - The domain.
     */
    withdraw(domain: string): void {
        this.records.delete(domain);
    }

    async resolveTxtRecords(domain: string): Promise<string[]> {
        this.asked.push(domain);
        if (this.failing.has(domain)) {
            throw new ServiceUnavailableError($ts`The DNS records of '${domain}' could not be read. Try again later.`);
        }
        return await Promise.resolve(this.records.get(domain) ?? []);
    }
}

const dns: PublishedRecords = new PublishedRecords();

// one class for every server of the file: a data source class that one of them does not declare is refused
const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
    entities: [...defaultTestServerEntities, ApiKey, TestTenant, AnalyticsSite, AnalyticsPageViewRecord, AnalyticsEventRecord],
    repositories: defaultTestServerRepositories
});

let server: StartedTestServer | undefined;
let baseUrl: string = '';

/**
 * The answer of a route.
 */
type Answer<T> = {
    status: number,
    body: T
};

/**
 * The analytics service of the running application.
 * @returns The service.
 */
function analyticsService(): AnalyticsServiceInterface {
    return inject(ZIBRI_ANALYTICS_PLUGIN_DI_TOKENS.ANALYTICS_SERVICE);
}

/**
 * Starts an application with the plugin, counting `example.com` as a site of no tenant, created the way the default
 * data of an application creates it.
 * @param providers - What it is given besides the plugin's options.
 * @returns The url it answers at.
 */
async function startWith(providers: DiProvider<unknown>[]): Promise<string> {
    server = await startTestServer({
        dataSources: [dataSourceClass],
        authStrategies: [JwtAuthStrategy, ApiKeyAuthStrategy],
        controllers: [SiteAnalyticsController],
        plugins: [new ZibriAnalyticsPlugin()],
        providers: [
            ...defaultTestServerProviders,
            ...rolesAndPermissionsProviders({ permissions: TENANT_PERMISSIONS, platformPermissions: PLATFORM_PERMISSIONS }, roles),
            defineProvider({ token: ZIBRI_ANALYTICS_PLUGIN_DI_TOKENS.OPTIONS_INPUT, useValue: { timezone: 'Europe/Berlin' } }),
            defineProvider({ token: ZIBRI_ANALYTICS_PLUGIN_DI_TOKENS.DNS_SERVICE, useValue: dns }),
            ...providers
        ]
    });
    const url: string = await server.start();
    // the servers of the file share their rows, as an application keeps its own from one start to the next
    if (acmeId === '') {
        const tenants: Repository<TestTenant> = inject(repositoryTokenFor(TestTenant));
        acmeId = (await tenants.create({ name: 'Acme' })).id;
        zenithId = (await tenants.create({ name: 'Zenith' })).id;
        dormantId = (await tenants.create({ name: 'Dormant' })).id;
    }
    if (await analyticsService().findSite(SITE) == undefined) {
        await analyticsService().createSite({ domain: SITE, tenantId: null });
    }
    return url;
}

/**
 * Creates a site of a tenant, and verifies it by its record.
 * @param domain - The domain of the site.
 * @param tenantId - The tenant.
 * @returns The site, verified.
 */
async function createVerifiedSite(domain: string, tenantId: string): Promise<AnalyticsSite> {
    const site: AnalyticsSite = await analyticsService().createSite({ domain, tenantId });
    dns.publish(domain, AnalyticsSiteVerificationUtilities.getRecordValue(site.verificationToken ?? ''));
    return await analyticsService().verifySite(site.id, tenantId);
}

/**
 * A page view as a page of the site sends it.
 * @param changes - What it differs in.
 * @returns The page view.
 */
function pageView(changes: Partial<AnalyticsPageViewModel> = {}): AnalyticsPageViewModel {
    return {
        visitId: UUIDUtilities.generate(),
        domain: SITE,
        path: '/takeover',
        language: 'de',
        entry: true,
        source: { referrer: 'google.com', utmCampaign: 'spring' },
        ...changes
    };
}

/**
 * Sends a body to one of the routes the pages of a site call.
 * @param route - `page-views` or `events`.
 * @param body - The body.
 * @param userAgent - The `User-Agent` it is sent with. With null, the one fetch sends of its own.
 * @param tenantId - The tenant the request names, none when undefined.
 * @returns The status of the answer.
 */
async function send(
    route: 'page-views' | 'events',
    body: unknown,
    userAgent: string | null = WINDOWS_CHROME,
    tenantId?: string
): Promise<number> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (userAgent != null) {
        headers['user-agent'] = userAgent;
    }
    if (tenantId != undefined) {
        headers['x-tenant-id'] = tenantId;
    }
    const res: Response = await fetch(`${baseUrl}/analytics/${route}`, { method: 'POST', headers, body: JSON.stringify(body) });
    await res.body?.cancel();
    return res.status;
}

/**
 * The page views stored of a visit, in every tenant.
 * @param visitId - The visit.
 * @returns Its rows.
 */
async function findPageViews(visitId: string): Promise<AnalyticsPageViewRecord[]> {
    return await inject<Repository<AnalyticsPageViewRecord>>(repositoryTokenFor(AnalyticsPageViewRecord))
        .findAll({ where: { visitId }, acrossTenants: true });
}

/**
 * The events stored of a visit, in every tenant.
 * @param visitId - The visit.
 * @returns Its rows.
 */
async function findEvents(visitId: string): Promise<AnalyticsEventRecord[]> {
    return await inject<Repository<AnalyticsEventRecord>>(repositoryTokenFor(AnalyticsEventRecord))
        .findAll({ where: { visitId }, acrossTenants: true });
}

/**
 * The sites stored of the given domains, in every tenant.
 * @param domains - The domains.
 * @returns The sites.
 */
async function findStoredSites(domains: string[]): Promise<AnalyticsSite[]> {
    return await inject<Repository<AnalyticsSite>>(repositoryTokenFor(AnalyticsSite))
        .findAll({ where: { domain: { oneOf: domains } }, acrossTenants: true });
}

/**
 * Creates a user with roles of their own and in tenants, and an api key acting as them in every tenant they are a
 * member of.
 * @param platformRoles - The roles of their own.
 * @param memberships - The roles they hold, by tenant.
 * @param permissions - What the key may use, all their roles carry unless given.
 * @returns The key.
 */
async function createCaller(
    platformRoles: Roles[],
    memberships: Record<string, MemberRoles[]>,
    permissions?: (Permission | PlatformPermission)[]
): Promise<string> {
    const user: JwtUser = await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser))
        .create({ email: `${UUIDUtilities.generate()}@example.com`, roles: platformRoles });
    for (const [tenantId, memberRoles] of Object.entries(memberships)) {
        await inject<TenantServiceInterface>(ZIBRI_DI_TOKENS.TENANT_SERVICE)
            .runAs(tenantId, async () => await inject(DefaultTestServerMembershipRepository).create({ tenantId, userId: user.id, roles: memberRoles }));
    }
    const authService: AuthServiceInterface = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
    const created: CreatedApiKey = await authService.createApiKey(
        user.id,
        {
            name: 'analytics',
            permissions: permissions ?? await authService.resolveUserPermissions(user, undefined),
            expiresAt: undefined,
            tenantId: undefined,
            clientAuthentication: undefined,
            requireDpop: false
        },
        undefined
    );
    return created.key;
}

/**
 * Creates an api key of an operator of the application, holding platform permissions and no membership.
 * @param permissions - What the key may use.
 * @returns The key.
 */
async function createKey(permissions: PlatformPermission[]): Promise<string> {
    return await createCaller([Roles.ADMIN], {}, permissions);
}

/**
 * Calls a route of the analytics with an api key.
 * @param method - The method.
 * @param path - The path below the analytics, such as `sites`.
 * @param key - The api key to send, none when undefined.
 * @param tenantId - The tenant the request names, none when undefined.
 * @param body - The json body, none when undefined.
 * @returns The status and the body of the answer, undefined for one without a body.
 */
async function call<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    key: string | undefined,
    tenantId?: string,
    body?: unknown
): Promise<Answer<T>> {
    const headers: Record<string, string> = {};
    if (key != undefined) {
        headers['x-api-key'] = key;
    }
    if (tenantId != undefined) {
        headers['x-tenant-id'] = tenantId;
    }
    if (body != undefined) {
        headers['content-type'] = 'application/json';
    }
    const res: Response = await fetch(`${baseUrl}/analytics/${path}`, {
        method,
        headers,
        body: body == undefined ? undefined : JSON.stringify(body)
    });
    const text: string = await res.text();
    return { status: res.status, body: (text === '' ? undefined : JSON.parse(text)) as T };
}

/**
 * Asks a query route of the analytics.
 * @param route - The route, such as `days`.
 * @param parameters - Its query parameters.
 * @param key - The api key to send, none when undefined.
 * @param tenantId - The tenant the request names, none when undefined.
 * @returns The status and the body of the answer.
 */
async function query<T>(route: string, parameters: Record<string, string>, key: string | undefined, tenantId?: string): Promise<Answer<T>> {
    return await call<T>('GET', `${route}?${new URLSearchParams(parameters).toString()}`, key, tenantId);
}

/**
 * Stores a page view or event as the plugin does, on a day and at a time of the test's choosing.
 * @param changes - What it differs in.
 * @returns What every row is stored with.
 */
function record(changes: Partial<Omit<BaseAnalyticsRecord, 'id'>>): Omit<BaseAnalyticsRecord, 'id'> {
    const receivedAt: Date = changes.receivedAt ?? new Date('2026-03-01T10:00:00.000Z');
    return {
        tenantId: null,
        day: new Date(`${receivedAt.toISOString().slice(0, 10)}T00:00:00.000Z`),
        receivedAt,
        domain: QUERIED_SITE,
        path: '/',
        language: 'de',
        visitId: UUIDUtilities.generate(),
        visitorId: null,
        referrer: null,
        utmSource: null,
        utmMedium: null,
        utmCampaign: null,
        utmTerm: null,
        utmContent: null,
        operatingSystem: AnalyticsOperatingSystem.WINDOWS,
        ...changes
    };
}

/**
 * Stores page views as the plugin does, across tenants.
 * @param rows - Each page view, as `record` and with its entry and first visit.
 */
async function storePageViews(rows: (Partial<Omit<BaseAnalyticsRecord, 'id'>> & Pick<AnalyticsPageViewRecord, 'entry'> & Partial<Pick<AnalyticsPageViewRecord, 'firstVisit'>>)[]): Promise<void> {
    await inject<Repository<AnalyticsPageViewRecord>>(repositoryTokenFor(AnalyticsPageViewRecord))
        .createAll(rows.map(row => ({ firstVisit: null, ...record(row), entry: row.entry })), { acrossTenants: true });
}

/**
 * Stores events as the plugin does, across tenants.
 * @param rows - Each event, as `record` and with its name.
 */
async function storeEvents(rows: (Partial<Omit<BaseAnalyticsRecord, 'id'>> & Pick<AnalyticsEventRecord, 'name'>)[]): Promise<void> {
    await inject<Repository<AnalyticsEventRecord>>(repositoryTokenFor(AnalyticsEventRecord))
        .createAll(rows.map(row => ({ category: null, ...record(row), name: row.name })), { acrossTenants: true });
}

/**
 * A time on the first of March 2026, by minute.
 * @param minute - The minutes after ten o'clock.
 * @returns The time.
 */
function at(minute: number): Date {
    return new Date(Date.UTC(2026, 2, 1, 10, minute));
}

describe('the analytics plugin', () => {
    beforeAll(async () => {
        baseUrl = await startWith([
            defineProvider({
                token: ZIBRI_ANALYTICS_PLUGIN_DI_TOKENS.RATE_LIMITER,
                useClass: RoomyRateLimiter,
                variants: [DiVariants.RATE_LIMITER]
            })
        ]);
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    describe('managing the sites', () => {
        let operator: string;
        let acmeAdmin: string;
        let acmeMember: string;

        beforeAll(async () => {
            operator = await createKey([ZibriAnalyticsPlatformPermissions.ANALYTICS_SITES_MANAGE_ALL]);
            acmeAdmin = await createCaller([Roles.USER], { [acmeId]: [MemberRoles.ADMIN], [zenithId]: [MemberRoles.USER] });
            acmeMember = await createCaller([Roles.USER], { [acmeId]: [MemberRoles.USER] });
        });

        /**
         * Every site, as the platform permission lists them, by domain.
         * @returns The sites.
         */
        async function findEverySite(): Promise<Map<string, AnalyticsSiteModel>> {
            const { body } = await call<AnalyticsSiteModel[]>('GET', 'sites', operator);
            return new Map(body.map(site => [site.domain, site]));
        }

        it('creates a site of no tenant with the platform permission, its domain in lower case and without www.', async () => {
            const { status, body } = await call<AnalyticsSiteModel>('POST', 'sites', operator, undefined, { domain: 'WWW.Shop.Example.com' });

            expect(status).toBe(200);
            // verified at once, as only the platform permission creates it
            expect(body).toEqual({
                id: expect.any(String),
                domain: 'shop.example.com',
                tenantId: null,
                verifiedAt: expect.any(String),
                recordMissingSince: null,
                verificationToken: null,
                verificationRecord: null
            });
        });

        it('creates a site in the tenant the body names with the platform permission', async () => {
            const { status, body } = await call<AnalyticsSiteModel>(
                'POST',
                'sites',
                operator,
                undefined,
                { domain: 'zenith-shop.example.com', tenantId: zenithId }
            );

            expect(status).toBe(200);
            expect([body.tenantId, body.verifiedAt]).toEqual([zenithId, null]);
        });

        it('refuses a site of a tenant that does not exist with the platform permission', async () => {
            const unknown: Answer<unknown> = await call('POST', 'sites', operator, undefined, { domain: 'nobody.example.com', tenantId: UUIDUtilities.generate() });

            expect(unknown.status).toBe(400);
            expect(await findStoredSites(['nobody.example.com'])).toEqual([]);
        });

        it('creates a site in the tenant of the request with the tenant permission, unverified, with the record that verifies it', async () => {
            const unnamed: Answer<AnalyticsSiteModel> = await call('POST', 'sites', acmeAdmin, acmeId, { domain: 'acme-shop.example.com' });
            const named: Answer<AnalyticsSiteModel> = await call('POST', 'sites', acmeAdmin, acmeId, { domain: 'acme-blog.example.com', tenantId: acmeId });

            expect([unnamed.status, unnamed.body.tenantId]).toEqual([200, acmeId]);
            expect([named.status, named.body.tenantId]).toEqual([200, acmeId]);
            expect(unnamed.body).toEqual({
                id: expect.any(String),
                domain: 'acme-shop.example.com',
                tenantId: acmeId,
                verifiedAt: null,
                recordMissingSince: null,
                verificationToken: expect.any(String),
                verificationRecord: {
                    type: 'TXT',
                    name: 'acme-shop.example.com',
                    value: `analytics-site-verification=${unnamed.body.verificationToken}`
                }
            });
        });

        it('never creates a site of no tenant, or of another tenant, with the tenant permission, whatever the body says', async () => {
            const refused: [string | undefined, unknown][] = [
                // a site of the application, named by the body
                [acmeId, { domain: 'global-by-acme.example.com', tenantId: null }],
                // a site of another tenant, one the caller is a member of without the permission
                [acmeId, { domain: 'zenith-by-acme.example.com', tenantId: zenithId }],
                // a request naming no tenant, which the tenant permission never passes
                [undefined, { domain: 'untenanted-by-acme.example.com' }],
                [undefined, { domain: 'named-without-tenant-by-acme.example.com', tenantId: acmeId }],
                // a request naming the other tenant, where the caller does not hold the permission
                [zenithId, { domain: 'in-zenith-by-acme.example.com' }]
            ];

            for (const [tenantId, body] of refused) {
                expect((await call('POST', 'sites', acmeAdmin, tenantId, body)).status).toBe(403);
            }
            expect(await findStoredSites([
                'global-by-acme.example.com',
                'zenith-by-acme.example.com',
                'untenanted-by-acme.example.com',
                'named-without-tenant-by-acme.example.com',
                'in-zenith-by-acme.example.com'
            ])).toEqual([]);
        });

        it('refuses a second site of a domain in one tenant, and a site of no tenant of a domain a verified site has', async () => {
            expect((await call('POST', 'sites', acmeAdmin, acmeId, { domain: 'WWW.acme-shop.example.com' })).status).toBe(400);
            expect((await call('POST', 'sites', operator, undefined, { domain: `www.${SITE}` })).status).toBe(400);

            const stored: AnalyticsSite[] = await findStoredSites([SITE, 'acme-shop.example.com']);
            expect(stored.map(site => [site.domain, site.tenantId])).toEqual(expect.arrayContaining([[SITE, null], ['acme-shop.example.com', acmeId]]));
            expect(stored).toHaveLength(2);
        });

        it('lists the sites of the tenant of the request with the tenant permission, and every site with the platform permission', async () => {
            const ofAcme: Answer<AnalyticsSiteModel[]> = await call('GET', 'sites', acmeAdmin, acmeId);

            expect(ofAcme.status).toBe(200);
            expect(ofAcme.body.map(site => [site.domain, site.tenantId])).toEqual([
                ['acme-blog.example.com', acmeId],
                ['acme-shop.example.com', acmeId]
            ]);
            expect([...(await findEverySite()).keys()]).toEqual(expect.arrayContaining([
                SITE,
                'shop.example.com',
                'zenith-shop.example.com',
                'acme-shop.example.com',
                'acme-blog.example.com'
            ]));
            // a request naming no tenant lists every site, which the tenant permission never does
            expect((await call('GET', 'sites', acmeAdmin)).status).toBe(403);
        });

        it('removes a site of the tenant of the request alone with the tenant permission', async () => {
            const sites: Map<string, AnalyticsSiteModel> = await findEverySite();
            const ofZenith: string | undefined = sites.get('zenith-shop.example.com')?.id;
            const ofNoTenant: string | undefined = sites.get('shop.example.com')?.id;
            const ofAcme: string | undefined = sites.get('acme-blog.example.com')?.id;

            expect((await call('DELETE', `sites/${ofZenith}`, acmeAdmin, acmeId)).status).toBe(404);
            expect((await call('DELETE', `sites/${ofNoTenant}`, acmeAdmin, acmeId)).status).toBe(404);
            expect((await call('DELETE', `sites/${ofAcme}`, acmeAdmin, acmeId)).status).toBe(204);

            const left: Map<string, AnalyticsSiteModel> = await findEverySite();
            expect(left.has('zenith-shop.example.com')).toBe(true);
            expect(left.has('shop.example.com')).toBe(true);
            expect(left.has('acme-blog.example.com')).toBe(false);
        });

        it('removes a site of any tenant, or of none, with the platform permission', async () => {
            const sites: Map<string, AnalyticsSiteModel> = await findEverySite();

            expect((await call('DELETE', `sites/${sites.get('zenith-shop.example.com')?.id}`, operator)).status).toBe(204);
            expect((await call('DELETE', `sites/${sites.get('shop.example.com')?.id}`, operator)).status).toBe(204);

            const left: Map<string, AnalyticsSiteModel> = await findEverySite();
            expect(left.has('zenith-shop.example.com')).toBe(false);
            expect(left.has('shop.example.com')).toBe(false);
        });

        it('refuses a caller holding neither permission, and one who is not logged in', async () => {
            const site: string | undefined = (await findEverySite()).get('acme-shop.example.com')?.id;

            expect((await call('GET', 'sites', acmeMember, acmeId)).status).toBe(403);
            expect((await call('POST', 'sites', acmeMember, acmeId, { domain: 'member.example.com' })).status).toBe(403);
            expect((await call('DELETE', `sites/${site}`, acmeMember, acmeId)).status).toBe(403);
            expect((await call('GET', 'sites', undefined)).status).toBe(401);
            expect((await call('POST', 'sites', undefined, undefined, { domain: 'anonymous.example.com' })).status).toBe(401);
            expect(await findStoredSites(['member.example.com', 'anonymous.example.com'])).toEqual([]);
            expect((await findEverySite()).has('acme-shop.example.com')).toBe(true);
        });
    });

    describe('verifying the sites', () => {
        let operator: string;
        let acmeAdmin: string;
        let acmeMember: string;
        let zenithAdmin: string;

        beforeAll(async () => {
            operator = await createKey([ZibriAnalyticsPlatformPermissions.ANALYTICS_SITES_MANAGE_ALL]);
            acmeAdmin = await createCaller([Roles.USER], { [acmeId]: [MemberRoles.ADMIN], [zenithId]: [MemberRoles.USER] });
            acmeMember = await createCaller([Roles.USER], { [acmeId]: [MemberRoles.USER] });
            zenithAdmin = await createCaller([Roles.USER], { [zenithId]: [MemberRoles.ADMIN] });
        });

        it('counts nothing of a site of a tenant until it is verified', async () => {
            const created: Answer<AnalyticsSiteModel> = await call('POST', 'sites', acmeAdmin, acmeId, { domain: 'acme-store.example.com' });
            const sent: AnalyticsPageViewModel = pageView({ domain: 'acme-store.example.com' });

            expect(created.status).toBe(200);
            expect(await send('page-views', sent)).toBe(204);
            expect(await send('events', { ...sent, entry: undefined, name: 'contact-form-sent' })).toBe(204);

            expect(await findPageViews(sent.visitId)).toEqual([]);
            expect(await findEvents(sent.visitId)).toEqual([]);
        });

        it('answers what is missing without the record, and verifies the site once the record is published', async () => {
            const { body: site } = await call<AnalyticsSiteModel>('POST', 'sites', acmeAdmin, acmeId, { domain: 'acme-docs.example.com' });
            const value: string = `analytics-site-verification=${site.verificationToken}`;

            const missing: Answer<unknown> = await call('POST', `sites/${site.id}/verify`, acmeAdmin, acmeId);
            expect(missing.status).toBe(400);
            expect(JSON.stringify(missing.body)).toContain(value);
            expect((await findStoredSites(['acme-docs.example.com']))[0]?.verifiedAt).toBeNull();

            // a record of another value, and one on another domain, verify nothing
            dns.publish('acme-docs.example.com', 'analytics-site-verification=somebody-else');
            dns.publish('www.acme-docs.example.com', value);
            expect((await call('POST', `sites/${site.id}/verify`, acmeAdmin, acmeId)).status).toBe(400);

            dns.publish('acme-docs.example.com', value);
            const verified: Answer<AnalyticsSiteModel> = await call('POST', `sites/${site.id}/verify`, acmeAdmin, acmeId);
            expect(verified.status).toBe(200);
            // with its record still, which stays on the domain for as long as the site is counted
            expect(verified.body).toEqual({ ...site, verifiedAt: expect.any(String) });
            // verifying again answers the site as it is
            expect((await call<AnalyticsSiteModel>('POST', `sites/${site.id}/verify`, acmeAdmin, acmeId)).body.verifiedAt)
                .toBe(verified.body.verifiedAt);

            const sent: AnalyticsPageViewModel = pageView({ domain: 'www.acme-docs.example.com' });
            expect(await send('page-views', sent)).toBe(204);
            expect((await findPageViews(sent.visitId)).map(row => [row.domain, row.tenantId])).toEqual([['acme-docs.example.com', acmeId]]);
        });

        it('lets two tenants claim a domain, verifies the one holding the record, and refuses the other', async () => {
            const domain: string = 'contested.example.com';
            const ofAcme: Answer<AnalyticsSiteModel> = await call('POST', 'sites', acmeAdmin, acmeId, { domain });
            const ofZenith: Answer<AnalyticsSiteModel> = await call('POST', 'sites', zenithAdmin, zenithId, { domain });
            expect([ofAcme.status, ofZenith.status]).toEqual([200, 200]);

            dns.publish(domain, `analytics-site-verification=${ofZenith.body.verificationToken}`);
            expect((await call('POST', `sites/${ofAcme.body.id}/verify`, acmeAdmin, acmeId)).status).toBe(400);
            expect((await call('POST', `sites/${ofZenith.body.id}/verify`, zenithAdmin, zenithId)).status).toBe(200);

            // the record of the other claim, published later, does not take the domain over
            dns.publish(domain, `analytics-site-verification=${ofAcme.body.verificationToken}`);
            const taken: Answer<unknown> = await call('POST', `sites/${ofAcme.body.id}/verify`, acmeAdmin, acmeId);
            expect(taken.status).toBe(400);
            expect(JSON.stringify(taken.body)).toContain('verified by another site');

            const sent: AnalyticsPageViewModel = pageView({ domain });
            expect(await send('page-views', sent)).toBe(204);
            expect((await findPageViews(sent.visitId)).map(row => row.tenantId)).toEqual([zenithId]);
            expect((await findStoredSites([domain])).map(site => [site.tenantId, site.verifiedAt != undefined]))
                .toEqual(expect.arrayContaining([[acmeId, false], [zenithId, true]]));
        });

        it('counts a site of no tenant at once', async () => {
            expect((await call('POST', 'sites', operator, undefined, { domain: 'app.example.com' })).status).toBe(200);
            const sent: AnalyticsPageViewModel = pageView({ domain: 'app.example.com' });

            expect(await send('page-views', sent)).toBe(204);

            expect((await findPageViews(sent.visitId)).map(row => row.tenantId)).toEqual([null]);
        });

        it('verifies a site of the tenant of the request alone with the tenant permission, and any site with the platform permission', async () => {
            const ofZenith: AnalyticsSite = await analyticsService().createSite({ domain: 'zenith-only.example.com', tenantId: zenithId });
            const ofAcme: AnalyticsSite = await analyticsService().createSite({ domain: 'acme-only.example.com', tenantId: acmeId });
            dns.publish('zenith-only.example.com', AnalyticsSiteVerificationUtilities.getRecordValue(ofZenith.verificationToken ?? ''));
            dns.publish('acme-only.example.com', AnalyticsSiteVerificationUtilities.getRecordValue(ofAcme.verificationToken ?? ''));
            const ofNoTenant: AnalyticsSite | undefined = await analyticsService().findSite(SITE);

            // another tenant's site, and a site of no tenant, are not found in the tenant of the request
            expect((await call('POST', `sites/${ofZenith.id}/verify`, acmeAdmin, acmeId)).status).toBe(404);
            expect((await call('POST', `sites/${ofNoTenant?.id}/verify`, acmeAdmin, acmeId)).status).toBe(404);
            // a tenant the caller holds no permission in, a request naming no tenant, no permission and no login
            expect((await call('POST', `sites/${ofZenith.id}/verify`, acmeAdmin, zenithId)).status).toBe(403);
            expect((await call('POST', `sites/${ofAcme.id}/verify`, acmeAdmin)).status).toBe(403);
            expect((await call('POST', `sites/${ofAcme.id}/verify`, acmeMember, acmeId)).status).toBe(403);
            expect((await call('POST', `sites/${ofAcme.id}/verify`, undefined, acmeId)).status).toBe(401);
            expect((await findStoredSites(['zenith-only.example.com', 'acme-only.example.com'])).map(site => site.verifiedAt)).toEqual([null, null]);

            expect((await call('POST', `sites/${ofAcme.id}/verify`, acmeAdmin, acmeId)).status).toBe(200);
            expect((await call('POST', `sites/${ofZenith.id}/verify`, operator)).status).toBe(200);
        });
    });

    describe('checking the verified sites again', () => {
        const check: AnalyticsSiteVerificationCronJob = new AnalyticsSiteVerificationCronJob();
        let acmeAdmin: string;
        let kept: AnalyticsSite;
        let lapsing: AnalyticsSite;
        let returning: AnalyticsSite;
        let flaky: AnalyticsSite;

        beforeAll(async () => {
            const cronJobRepo: Repository<CronJobEntity, CreateCronJobEntityData> = inject(repositoryTokenFor(CronJobEntity));
            await check.init(inject(ZIBRI_DI_TOKENS.LOGGER), cronJobRepo, async () => await Promise.resolve(true));
            acmeAdmin = await createCaller([Roles.USER], { [acmeId]: [MemberRoles.ADMIN] });
            kept = await createVerifiedSite('kept.example.com', acmeId);
            lapsing = await createVerifiedSite('lapsing.example.com', acmeId);
            returning = await createVerifiedSite('returning.example.com', acmeId);
            flaky = await createVerifiedSite('flaky.example.com', acmeId);
        });

        /**
         * Runs the daily check, with the clock of the application ahead.
         * @param daysAhead - How many days after now the check runs.
         */
        async function runCheck(daysAhead: number): Promise<void> {
            await runWithApplicationClockAhead(Ms.DAY * daysAhead, async () => await check.onTick());
        }

        /**
         * The site as it is stored.
         * @param site - The site.
         * @returns Its row.
         */
        async function findStored(site: AnalyticsSite): Promise<AnalyticsSite | undefined> {
            return (await findStoredSites([site.domain])).find(stored => stored.id === site.id);
        }

        /**
         * Whether a page view of the site is counted.
         * @param site - The site.
         * @returns Whether its row was kept.
         */
        async function isCounted(site: AnalyticsSite): Promise<boolean> {
            const sent: AnalyticsPageViewModel = pageView({ domain: site.domain });
            expect(await send('page-views', sent)).toBe(204);
            return (await findPageViews(sent.visitId)).length === 1;
        }

        it('checks no site of no tenant, and leaves a site whose record is found, or cannot be read, as it is', async () => {
            dns.withdraw(lapsing.domain);
            dns.withdraw(returning.domain);
            dns.failing.add(flaky.domain);
            dns.asked.length = 0;

            await runCheck(0);

            expect(dns.asked).toEqual(expect.arrayContaining([kept.domain, lapsing.domain, returning.domain, flaky.domain]));
            expect(dns.asked).not.toContain(SITE);
            expect(dns.asked).not.toContain('app.example.com');
            expect(await findStored(kept)).toEqual(expect.objectContaining({ verifiedAt: kept.verifiedAt, recordMissingSince: null }));
            expect(await findStored(flaky)).toEqual(expect.objectContaining({ verifiedAt: flaky.verifiedAt, recordMissingSince: null }));
            expect(await isCounted(kept)).toBe(true);
        });

        it('keeps counting a site whose record is missing for less than the grace, and forgets when it was missing once it is found', async () => {
            // marked by the check before
            expect((await findStored(lapsing))?.recordMissingSince).toEqual(expect.any(Date));
            dns.publish(returning.domain, AnalyticsSiteVerificationUtilities.getRecordValue(returning.verificationToken ?? ''));

            await runCheck(3);

            expect(await findStored(lapsing)).toEqual(expect.objectContaining({ verifiedAt: lapsing.verifiedAt, recordMissingSince: expect.any(Date) }));
            expect((await findStored(returning))?.recordMissingSince).toBeNull();
            expect(await isCounted(lapsing)).toBe(true);
            expect(await isCounted(returning)).toBe(true);

            // missing again two days later, which starts the grace again
            dns.withdraw(returning.domain);
            await runCheck(5);
            expect((await findStored(returning))?.recordMissingSince).toEqual(expect.any(Date));
        });

        it('takes the verification of a site whose record was missing for the grace, a week by default, and keeps its token', async () => {
            await runCheck(7.01);

            expect(await findStored(lapsing)).toEqual(expect.objectContaining({ verifiedAt: null, recordMissingSince: null }));
            expect(await isCounted(lapsing)).toBe(false);
            // missing since the fifth day only
            expect((await findStored(returning))?.verifiedAt).toEqual(returning.verifiedAt);
            expect(await isCounted(returning)).toBe(true);
            // a resolver that cannot be reached counts as neither
            expect(await findStored(flaky)).toEqual(expect.objectContaining({ verifiedAt: flaky.verifiedAt, recordMissingSince: null }));
            expect(await isCounted(kept)).toBe(true);

            // answered as unverified, with the same record to add again
            const listed: AnalyticsSiteModel | undefined = (await call<AnalyticsSiteModel[]>('GET', 'sites', acmeAdmin, acmeId)).body
                .find(site => site.id === lapsing.id);
            expect(listed).toEqual(expect.objectContaining({
                verifiedAt: null,
                verificationToken: lapsing.verificationToken,
                verificationRecord: {
                    type: 'TXT',
                    name: lapsing.domain,
                    value: AnalyticsSiteVerificationUtilities.getRecordValue(lapsing.verificationToken ?? '')
                }
            }));
            dns.publish(lapsing.domain, AnalyticsSiteVerificationUtilities.getRecordValue(lapsing.verificationToken ?? ''));
            expect((await call('POST', `sites/${lapsing.id}/verify`, acmeAdmin, acmeId)).status).toBe(200);
            expect(await isCounted(lapsing)).toBe(true);
            dns.failing.delete(flaky.domain);
        });
    });

    describe('taking a page view', () => {
        it('stores the page view with its day and operating system, and nothing that names the visitor or their device', async () => {
            const sent: AnalyticsPageViewModel = pageView();
            expect(await send('page-views', sent, IPHONE_SAFARI)).toBe(204);

            const [stored, ...more] = await findPageViews(sent.visitId);
            expect(more).toEqual([]);
            expect(stored).toEqual({
                id: expect.any(String),
                tenantId: null,
                day: expect.any(Date),
                receivedAt: expect.any(Date),
                domain: SITE,
                path: '/takeover',
                language: 'de',
                entry: true,
                visitId: sent.visitId,
                visitorId: null,
                firstVisit: null,
                referrer: 'google.com',
                utmSource: null,
                utmMedium: null,
                utmCampaign: 'spring',
                utmTerm: null,
                utmContent: null,
                operatingSystem: AnalyticsOperatingSystem.IOS
            });
            // the day of the time zone of the plugin, as midnight UTC
            const berlinDay: string = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(stored?.receivedAt);
            expect(stored?.day.toISOString()).toBe(`${berlinDay}T00:00:00.000Z`);
            expect(JSON.stringify(stored)).not.toMatch(/Mozilla|iPhone|127\.0\.0\.1|::1/);
        });

        it('stores an event the same way', async () => {
            const visitId: string = UUIDUtilities.generate();
            const status: number = await send('events', {
                visitId, domain: SITE, name: 'contact-form-sent', category: 'contact', path: '/contact', language: 'en', source: {}
            });

            expect(status).toBe(204);
            const [stored] = await findEvents(visitId);
            expect(stored).toEqual(expect.objectContaining({
                tenantId: null,
                name: 'contact-form-sent',
                category: 'contact',
                path: '/contact',
                language: 'en',
                referrer: null,
                visitorId: null,
                operatingSystem: AnalyticsOperatingSystem.WINDOWS
            }));
            expect(JSON.stringify(stored)).not.toMatch(/Mozilla|127\.0\.0\.1|::1/);
        });

        it('marks the first page view of a visitor as their first visit, and no later one', async () => {
            const visitorId: string = UUIDUtilities.generate();
            const first: AnalyticsPageViewModel = pageView({ visitorId });
            const second: AnalyticsPageViewModel = pageView({ visitorId, visitId: first.visitId, entry: false, path: '/contact' });
            const later: AnalyticsPageViewModel = pageView({ visitorId });

            for (const sent of [first, second, later]) {
                expect(await send('page-views', sent)).toBe(204);
            }

            const stored: AnalyticsPageViewRecord[] = [...await findPageViews(first.visitId), ...await findPageViews(later.visitId)];
            expect(stored.map(row => [row.path, row.entry, row.firstVisit])).toEqual(expect.arrayContaining([
                ['/takeover', true, true],
                ['/contact', false, false],
                ['/takeover', true, false]
            ]));
            expect(stored.every(row => row.visitorId === visitorId)).toBe(true);
        });

        it('answers a bot, a headless browser, a script and an empty User-Agent like any other, and stores nothing', async () => {
            const sent: AnalyticsPageViewModel[] = [pageView(), pageView(), pageView(), pageView()];

            expect(await send('page-views', sent[0], GOOGLEBOT)).toBe(204);
            expect(await send('page-views', sent[1], 'Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/131.0.0.0 Safari/537.36')).toBe(204);
            expect(await send('page-views', sent[2], null)).toBe(204);
            expect(await send('page-views', sent[3], '')).toBe(204);

            for (const { visitId } of sent) {
                expect(await findPageViews(visitId)).toEqual([]);
            }
        });

        it('answers a domain no site has like any other, and stores nothing', async () => {
            const sent: AnalyticsPageViewModel = pageView({ domain: 'elsewhere.example.org' });

            expect(await send('page-views', sent)).toBe(204);
            expect(await send('events', { ...sent, name: 'contact-form-sent', entry: undefined })).toBe(204);

            expect(await findPageViews(sent.visitId)).toEqual([]);
            expect(await findEvents(sent.visitId)).toEqual([]);
        });

        it('counts the host of a site with www. and in any case as the site, and a subdomain as a site of its own', async () => {
            const sent: AnalyticsPageViewModel[] = [pageView({ domain: 'WWW.Example.com' }), pageView({ domain: 'Example.COM' })];
            const blog: AnalyticsPageViewModel = pageView({ domain: `blog.${SITE}` });

            for (const page of [...sent, blog]) {
                expect(await send('page-views', page)).toBe(204);
            }

            for (const { visitId } of sent) {
                expect((await findPageViews(visitId)).map(row => row.domain)).toEqual([SITE]);
            }
            expect(await findPageViews(blog.visitId)).toEqual([]);
        });

        it('keeps a page view and an event of the site of a tenant in that tenant, whatever tenant the request names', async () => {
            await createVerifiedSite('acme-landing.example.com', acmeId);
            const sent: AnalyticsPageViewModel = pageView({ domain: 'acme-landing.example.com' });
            const ofTheApplication: AnalyticsPageViewModel = pageView();

            expect(await send('page-views', sent, WINDOWS_CHROME, zenithId)).toBe(204);
            expect(await send('events', { ...sent, entry: undefined, name: 'contact-form-sent' }, WINDOWS_CHROME, zenithId)).toBe(204);
            expect(await send('page-views', ofTheApplication, WINDOWS_CHROME, zenithId)).toBe(204);

            expect((await findPageViews(sent.visitId)).map(row => row.tenantId)).toEqual([acmeId]);
            expect((await findEvents(sent.visitId)).map(row => row.tenantId)).toEqual([acmeId]);
            expect((await findPageViews(ofTheApplication.visitId)).map(row => row.tenantId)).toEqual([null]);
        });

        it('drops the page views of the site of a deactivated tenant, answered like any other', async () => {
            await createVerifiedSite('dormant.example.com', dormantId);
            const counted: AnalyticsPageViewModel = pageView({ domain: 'dormant.example.com' });
            expect(await send('page-views', counted)).toBe(204);
            await inject<TenantServiceInterface>(ZIBRI_DI_TOKENS.TENANT_SERVICE).deactivateTenant?.(dormantId);
            const dropped: AnalyticsPageViewModel = pageView({ domain: 'dormant.example.com' });

            expect(await send('page-views', dropped)).toBe(204);
            expect(await send('events', { ...dropped, entry: undefined, name: 'contact-form-sent' })).toBe(204);

            expect((await findPageViews(counted.visitId)).map(row => row.tenantId)).toEqual([dormantId]);
            expect(await findPageViews(dropped.visitId)).toEqual([]);
            expect(await findEvents(dropped.visitId)).toEqual([]);
        });

        it('counts a site from the page view after it is verified, and drops the page views of one removed, without a restart', async () => {
            const before: AnalyticsPageViewModel = pageView({ domain: 'new.example.com' });
            expect(await send('page-views', before)).toBe(204);
            const site: AnalyticsSite = await createVerifiedSite('new.example.com', zenithId);
            const during: AnalyticsPageViewModel = pageView({ domain: 'new.example.com' });
            expect(await send('page-views', during)).toBe(204);
            await analyticsService().deleteSite(site.id, zenithId);
            const after: AnalyticsPageViewModel = pageView({ domain: 'new.example.com' });
            expect(await send('page-views', after)).toBe(204);

            expect(await findPageViews(before.visitId)).toEqual([]);
            expect((await findPageViews(during.visitId)).map(row => row.tenantId)).toEqual([zenithId]);
            expect(await findPageViews(after.visitId)).toEqual([]);
        });

        it('refuses a value that is too long, a path with a query, a referrer that is a url and a visit that is no uuid', async () => {
            const refused: AnalyticsPageViewModel[] = [
                pageView({ path: `/${'a'.repeat(1000)}` }),
                pageView({ path: '/takeover?email=ada@example.com' }),
                pageView({ path: '/takeover#contact' }),
                pageView({ language: 'x'.repeat(36) }),
                pageView({ source: { utmSource: 'u'.repeat(201) } }),
                pageView({ source: { referrer: 'https://google.com/search?q=ada' } }),
                pageView({ visitId: 'ada' }),
                pageView({ visitorId: 'ada@example.com' })
            ];

            for (const sent of refused) {
                expect(await send('page-views', sent)).toBe(400);
            }
            expect(await send('events', { ...pageView(), entry: undefined, name: 'n'.repeat(101) })).toBe(400);
            for (const { visitId } of refused) {
                expect(await findPageViews(visitId)).toEqual([]);
            }
        });

        it('refuses a body larger than a page view takes', async () => {
            const sent: AnalyticsPageViewModel = pageView({ path: `/${'a'.repeat(5000)}` });

            expect(await send('page-views', sent)).toBe(413);
            expect(await findPageViews(sent.visitId)).toEqual([]);
        });
    });

    describe('answering the counts', () => {
        let key: string;
        const visitorA: string = UUIDUtilities.generate();
        const visitorB: string = UUIDUtilities.generate();
        const visitOfA: string = UUIDUtilities.generate();

        beforeAll(async () => {
            key = await createKey(PLATFORM_PERMISSIONS);
            await storePageViews([
                // the first of March: two visits without consent, and visitor A, who consented and enters once
                { day: new Date('2026-03-01'), entry: true, path: '/', referrer: 'google.com' },
                { day: new Date('2026-03-01'), entry: false, path: '/takeover', referrer: 'google.com' },
                { day: new Date('2026-03-01'), entry: true, path: '/takeover', language: 'en', operatingSystem: AnalyticsOperatingSystem.IOS },
                { day: new Date('2026-03-01'), entry: true, path: '/', visitId: visitOfA, visitorId: visitorA, firstVisit: true, utmSource: 'newsletter' },
                { day: new Date('2026-03-01'), entry: false, path: '/contact', visitId: visitOfA, visitorId: visitorA, firstVisit: false, utmSource: 'newsletter' },
                // the second: visitor A again, and visitor B for the first time
                { day: new Date('2026-03-02'), entry: true, path: '/', visitorId: visitorA, firstVisit: false, operatingSystem: AnalyticsOperatingSystem.IOS },
                { day: new Date('2026-03-02'), entry: true, path: '/', visitorId: visitorB, firstVisit: true, operatingSystem: AnalyticsOperatingSystem.ANDROID },
                // outside the range
                { day: new Date('2026-03-03'), entry: true, path: '/' },
                // another site, of a tenant
                { day: new Date('2026-03-01'), entry: true, path: '/', domain: 'other.example.com', tenantId: acmeId }
            ]);
            await storeEvents([
                { day: new Date('2026-03-01'), name: 'contact-form-sent', visitId: visitOfA, visitorId: visitorA, utmSource: 'newsletter' },
                { day: new Date('2026-03-01'), name: 'phone-clicked', referrer: 'google.com' }
            ]);
        });

        const range: Record<string, string> = { from: '2026-03-01', to: '2026-03-02', domain: QUERIED_SITE };

        it('answers the page views, entries and consenting visitors of each day', async () => {
            const { status, body } = await query<AnalyticsDay[]>('days', range, key);

            expect(status).toBe(200);
            expect(body).toEqual([
                { day: '2026-03-01', pageViews: 5, entries: 3, consentedPageViews: 2, visitors: 1, firstVisits: 1 },
                { day: '2026-03-02', pageViews: 2, entries: 2, consentedPageViews: 2, visitors: 2, firstVisits: 1 }
            ]);
        });

        it('answers the page views of each page and language, the most viewed first', async () => {
            const { body } = await query<AnalyticsPage[]>('pages', range, key);

            expect(body[0]).toEqual({ path: '/', language: 'de', pageViews: 4, entries: 4, consentedPageViews: 3, visitors: 2, firstVisits: 2 });
            // viewed once each, in no order between them
            expect(body.slice(1)).toEqual(expect.arrayContaining([
                { path: '/takeover', language: 'de', pageViews: 1, entries: 0, consentedPageViews: 0, visitors: 0, firstVisits: 0 },
                { path: '/takeover', language: 'en', pageViews: 1, entries: 1, consentedPageViews: 0, visitors: 0, firstVisits: 0 },
                { path: '/contact', language: 'de', pageViews: 1, entries: 0, consentedPageViews: 1, visitors: 1, firstVisits: 0 }
            ]));
            expect(body).toHaveLength(4);
        });

        it('answers the visits and events of each source, the most entered first', async () => {
            const { body } = await query<AnalyticsSourceCount[]>('sources', range, key);

            expect(body).toEqual(expect.arrayContaining([
                { source: {}, entries: 3, events: 0 },
                { source: { referrer: 'google.com' }, entries: 1, events: 1 },
                { source: { utmSource: 'newsletter' }, entries: 1, events: 1 }
            ]));
            expect(body).toHaveLength(3);
            expect(body[0]?.source).toEqual({});
        });

        it('answers the page views of each operating system', async () => {
            const { body } = await query<AnalyticsSystem[]>('systems', range, key);

            expect(body).toEqual([
                { operatingSystem: AnalyticsOperatingSystem.WINDOWS, pageViews: 4 },
                { operatingSystem: AnalyticsOperatingSystem.IOS, pageViews: 2 },
                { operatingSystem: AnalyticsOperatingSystem.ANDROID, pageViews: 1 }
            ]);
        });

        it('counts every site, of any tenant or of none, without a domain and with the platform permission', async () => {
            const { body } = await query<AnalyticsSystem[]>('systems', { from: '2026-03-01', to: '2026-03-01' }, key);

            // the rows the ingestion suite stored are of today, and the row of the tenant's site is of the first of March
            expect(body.reduce((sum, system) => sum + system.pageViews, 0)).toBe(6);
        });

        it('takes the domain of a site with www. and in any case', async () => {
            const { body } = await query<AnalyticsDay[]>('days', { ...range, domain: `WWW.${QUERIED_SITE.toUpperCase()}` }, key);

            expect(body.map(day => day.pageViews)).toEqual([5, 2]);
        });
    });

    describe('following a funnel', () => {
        let key: string;
        const site: string = 'funnel.example.com';
        const steps: AnalyticsFunnelStepModel[] = [{ path: '/takeover' }, { event: 'contact-form-sent' }];
        const google: string = 'google.com';
        const visitor: string = UUIDUtilities.generate();

        beforeAll(async () => {
            key = await createKey([ZibriAnalyticsPlatformPermissions.ANALYTICS_FUNNEL_READ_ALL]);
            const [complete, takeoverOnly, entryOnly, outOfOrder, firstOfVisitor, laterOfVisitor] = [1, 2, 3, 4, 5, 6]
                .map(() => UUIDUtilities.generate());
            await storePageViews([
                // from google: reaches both steps, and the first
                { domain: site, visitId: complete, entry: true, path: '/', referrer: google, receivedAt: at(0) },
                { domain: site, visitId: complete, entry: false, path: '/takeover', referrer: google, receivedAt: at(1) },
                { domain: site, visitId: takeoverOnly, entry: true, path: '/takeover', referrer: google, receivedAt: at(0) },
                // direct: reaches none, and sends the form before it sees the page
                { domain: site, visitId: entryOnly, entry: true, path: '/', receivedAt: at(0) },
                { domain: site, visitId: outOfOrder, entry: true, path: '/', receivedAt: at(0) },
                { domain: site, visitId: outOfOrder, entry: false, path: '/takeover', receivedAt: at(5) },
                // one visitor who consented: first from google, and back directly to get in touch
                { domain: site, visitId: firstOfVisitor, visitorId: visitor, entry: true, path: '/', referrer: google, receivedAt: at(10) },
                { domain: site, visitId: laterOfVisitor, visitorId: visitor, entry: true, path: '/takeover', receivedAt: at(30) }
            ]);
            await storeEvents([
                { domain: site, visitId: complete, name: 'contact-form-sent', referrer: google, receivedAt: at(2) },
                { domain: site, visitId: outOfOrder, name: 'contact-form-sent', receivedAt: at(3) },
                { domain: site, visitId: laterOfVisitor, visitorId: visitor, name: 'contact-form-sent', receivedAt: at(31) }
            ]);
        });

        const funnelQuery: (by?: string, funnelSteps?: AnalyticsFunnelStepModel[]) => Record<string, string> = (by, funnelSteps = steps) => ({
            from: '2026-03-01',
            to: '2026-03-01',
            domain: site,
            steps: JSON.stringify(funnelSteps),
            ...by == undefined ? {} : { by }
        });

        it('counts the visits that entered, and how many of them reached each step after the one before', async () => {
            const { status, body } = await query<AnalyticsFunnelModel>('funnel', funnelQuery(), key);

            expect(status).toBe(200);
            expect(body.by).toBe('visit');
            expect(body.steps).toEqual(steps);
            expect(body.entered).toBe(6);
            // the visit sending the form before it saw the page reached the first step only
            expect(body.reached).toEqual([4, 2]);
            // as many entered from each, in no order between them
            expect(body.sources).toEqual(expect.arrayContaining([
                { source: {}, entered: 3, reached: [2, 1] },
                { source: { referrer: google }, entered: 3, reached: [2, 1] }
            ]));
            expect(body.sources).toHaveLength(2);
        });

        it('follows a visitor who consented across their visits, by the source of their first visit', async () => {
            const { status, body } = await query<AnalyticsFunnelModel>('funnel', funnelQuery('visitor'), key);

            expect(status).toBe(200);
            expect(body.by).toBe('visitor');
            // the visits without consent are not visitors
            expect(body.entered).toBe(1);
            expect(body.reached).toEqual([1, 1]);
            expect(body.sources).toEqual([{ source: { referrer: google }, entered: 1, reached: [1, 1] }]);
        });

        it('refuses a step that names both a path and an event, or neither, no steps and too many', async () => {
            const refused: Record<string, string>[] = [
                funnelQuery(undefined, [{ path: '/', event: 'contact-form-sent' }]),
                funnelQuery(undefined, [{}]),
                funnelQuery(undefined, Array.from({ length: 11 }, () => ({ path: '/' }))),
                { from: '2026-03-01', to: '2026-03-01' },
                funnelQuery('everyone')
            ];

            for (const parameters of refused) {
                expect((await query('funnel', parameters, key)).status).toBe(400);
            }
        });
    });

    describe('keeping the counts of tenants apart', () => {
        const day: Record<string, string> = { from: '2026-04-01', to: '2026-04-01' };
        const funnel: Record<string, string> = { ...day, steps: JSON.stringify([{ path: '/pricing' }, { event: 'contact-form-sent' }]) };
        let acmeAdmin: string;
        let zenithAdmin: string;
        let operator: string;

        /**
         * A time on the first of April 2026, by minute.
         * @param minute - The minutes after ten o'clock.
         * @returns The time.
         */
        function inApril(minute: number): Date {
            return new Date(Date.UTC(2026, 3, 1, 10, minute));
        }

        beforeAll(async () => {
            acmeAdmin = await createCaller([Roles.USER], { [acmeId]: [MemberRoles.ADMIN] });
            zenithAdmin = await createCaller([Roles.USER], { [zenithId]: [MemberRoles.ADMIN] });
            operator = await createKey(PLATFORM_PERMISSIONS);
            const acmeVisit: string = UUIDUtilities.generate();
            const acme: Partial<Omit<BaseAnalyticsRecord, 'id'>> = { tenantId: acmeId, domain: 'acme.example.com', visitId: acmeVisit, referrer: 'google.com' };
            const zenith: Partial<Omit<BaseAnalyticsRecord, 'id'>> = {
                tenantId: zenithId,
                domain: 'zenith.example.com',
                utmSource: 'newsletter',
                operatingSystem: AnalyticsOperatingSystem.IOS
            };
            await storePageViews([
                { ...acme, entry: true, path: '/', receivedAt: inApril(0) },
                { ...acme, entry: false, path: '/pricing', receivedAt: inApril(1) },
                { ...zenith, entry: true, path: '/', receivedAt: inApril(0) },
                { ...zenith, entry: true, path: '/pricing', receivedAt: inApril(0) },
                { tenantId: null, domain: SITE, entry: true, path: '/', operatingSystem: AnalyticsOperatingSystem.ANDROID, receivedAt: inApril(0) }
            ]);
            await storeEvents([
                { ...acme, name: 'contact-form-sent', receivedAt: inApril(2) },
                { ...zenith, name: 'contact-form-sent', receivedAt: inApril(0) }
            ]);
        });

        it('answers a tenant the counts of its own sites alone, on every route', async () => {
            const acmeDays: AnalyticsDay[] = (await query<AnalyticsDay[]>('days', day, acmeAdmin, acmeId)).body;
            expect(acmeDays).toEqual([{ day: '2026-04-01', pageViews: 2, entries: 1, consentedPageViews: 0, visitors: 0, firstVisits: 0 }]);
            const pages: AnalyticsPage[] = (await query<AnalyticsPage[]>('pages', day, acmeAdmin, acmeId)).body;
            expect(pages.map(page => [page.path, page.pageViews])).toEqual(expect.arrayContaining([['/', 1], ['/pricing', 1]]));
            expect(pages).toHaveLength(2);
            const sources: AnalyticsSourceCount[] = (await query<AnalyticsSourceCount[]>('sources', day, acmeAdmin, acmeId)).body;
            expect(sources).toEqual([{ source: { referrer: 'google.com' }, entries: 1, events: 1 }]);
            const acmeSystems: AnalyticsSystem[] = (await query<AnalyticsSystem[]>('systems', day, acmeAdmin, acmeId)).body;
            expect(acmeSystems).toEqual([{ operatingSystem: AnalyticsOperatingSystem.WINDOWS, pageViews: 2 }]);
            const acmeFunnel: AnalyticsFunnelModel = (await query<AnalyticsFunnelModel>('funnel', funnel, acmeAdmin, acmeId)).body;
            expect([acmeFunnel.entered, acmeFunnel.reached]).toEqual([1, [1, 1]]);

            const zenithDays: AnalyticsDay[] = (await query<AnalyticsDay[]>('days', day, zenithAdmin, zenithId)).body;
            expect(zenithDays.map(row => [row.pageViews, row.entries])).toEqual([[2, 2]]);
            const zenithSystems: AnalyticsSystem[] = (await query<AnalyticsSystem[]>('systems', day, zenithAdmin, zenithId)).body;
            expect(zenithSystems).toEqual([{ operatingSystem: AnalyticsOperatingSystem.IOS, pageViews: 2 }]);
            const zenithFunnel: AnalyticsFunnelModel = (await query<AnalyticsFunnelModel>('funnel', funnel, zenithAdmin, zenithId)).body;
            expect([zenithFunnel.entered, zenithFunnel.reached]).toEqual([2, [1, 0]]);
        });

        it('answers a tenant nothing of a site of another tenant or of none, even when it names its domain', async () => {
            for (const domain of ['zenith.example.com', SITE]) {
                for (const route of ['days', 'pages', 'sources', 'systems']) {
                    const { status, body } = await query<unknown[]>(route, { ...day, domain }, acmeAdmin, acmeId);
                    expect([route, domain, status, body]).toEqual([route, domain, 200, []]);
                }
                const named: AnalyticsFunnelModel = (await query<AnalyticsFunnelModel>('funnel', { ...funnel, domain }, acmeAdmin, acmeId)).body;
                expect([domain, named.entered]).toEqual([domain, 0]);
            }
        });

        it('refuses a tenant\'s caller the counts of every site, and those of a tenant they are no member of', async () => {
            for (const route of ['days', 'pages', 'sources', 'systems', 'funnel']) {
                expect([route, (await query(route, funnel, acmeAdmin)).status]).toEqual([route, 403]);
                expect([route, (await query(route, funnel, acmeAdmin, zenithId)).status]).toEqual([route, 403]);
            }
        });

        it('answers the counts of every site, of any tenant or of none, with the platform permission', async () => {
            expect((await query<AnalyticsDay[]>('days', day, operator)).body.map(row => [row.pageViews, row.entries])).toEqual([[5, 4]]);
            expect((await query<AnalyticsDay[]>('days', { ...day, domain: 'zenith.example.com' }, operator)).body.map(row => row.pageViews))
                .toEqual([2]);
        });
    });

    describe('guarding the counts', () => {
        const routes: [string, Permission, PlatformPermission][] = [
            ['days', ZibriAnalyticsPermissions.ANALYTICS_DAYS_READ, ZibriAnalyticsPlatformPermissions.ANALYTICS_DAYS_READ_ALL],
            ['pages', ZibriAnalyticsPermissions.ANALYTICS_PAGES_READ, ZibriAnalyticsPlatformPermissions.ANALYTICS_PAGES_READ_ALL],
            ['sources', ZibriAnalyticsPermissions.ANALYTICS_SOURCES_READ, ZibriAnalyticsPlatformPermissions.ANALYTICS_SOURCES_READ_ALL],
            ['systems', ZibriAnalyticsPermissions.ANALYTICS_SYSTEMS_READ, ZibriAnalyticsPlatformPermissions.ANALYTICS_SYSTEMS_READ_ALL],
            ['funnel', ZibriAnalyticsPermissions.ANALYTICS_FUNNEL_READ, ZibriAnalyticsPlatformPermissions.ANALYTICS_FUNNEL_READ_ALL]
        ];
        const parameters: Record<string, string> = { from: '2026-03-01', to: '2026-03-01', steps: JSON.stringify([{ path: '/' }]) };

        it('answers each route with its own permission alone, at either level', async () => {
            for (const [route, permission, platformPermission] of routes) {
                const member: Record<string, MemberRoles[]> = { [acmeId]: [MemberRoles.ADMIN] };
                const tenantOwn: string = await createCaller([Roles.USER], member, [permission]);
                const tenantOthers: string = await createCaller([Roles.USER], member, TENANT_PERMISSIONS.filter(other => other !== permission));
                const platformOwn: string = await createKey([platformPermission]);
                const platformOthers: string = await createKey(PLATFORM_PERMISSIONS.filter(other => other !== platformPermission));

                expect([route, (await query(route, parameters, tenantOwn, acmeId)).status]).toEqual([route, 200]);
                expect([route, (await query(route, parameters, tenantOthers, acmeId)).status]).toEqual([route, 403]);
                expect([route, (await query(route, parameters, platformOwn)).status]).toEqual([route, 200]);
                expect([route, (await query(route, parameters, platformOthers)).status]).toEqual([route, 403]);
                expect([route, (await query(route, parameters, undefined)).status]).toEqual([route, 401]);
            }
        });
    });

    describe('cleaning up', () => {
        it('deletes the page views and events of every tenant older than the retention, two years by default', async () => {
            const site: string = 'retention.example.com';
            const old: Date = new Date(Date.now() - (Ms.YEAR * 2) - (Ms.DAY * 2));
            const recent: Date = new Date(Date.now() - (Ms.YEAR * 2) + (Ms.DAY * 2));
            await storePageViews([
                { domain: site, entry: true, day: old, receivedAt: old },
                { domain: site, entry: true, day: old, receivedAt: old, tenantId: acmeId },
                { domain: site, entry: true, day: recent, receivedAt: recent }
            ]);
            await storeEvents([
                { domain: site, name: 'phone-clicked', day: old, receivedAt: old },
                { domain: site, name: 'phone-clicked', day: old, receivedAt: old, tenantId: zenithId }
            ]);

            const cleanup: AnalyticsCleanupCronJob = new AnalyticsCleanupCronJob();
            const cronJobRepo: Repository<CronJobEntity, CreateCronJobEntityData> = inject(repositoryTokenFor(CronJobEntity));
            await cleanup.init(inject(ZIBRI_DI_TOKENS.LOGGER), cronJobRepo, async () => await Promise.resolve(true));
            await cleanup.onTick();

            const pageViews: AnalyticsPageViewRecord[] = await inject<Repository<AnalyticsPageViewRecord>>(repositoryTokenFor(AnalyticsPageViewRecord))
                .findAll({ where: { domain: site }, acrossTenants: true });
            const events: number = await inject<Repository<AnalyticsEventRecord>>(repositoryTokenFor(AnalyticsEventRecord))
                .count({ where: { domain: site }, acrossTenants: true });
            expect(pageViews.map(row => row.day)).toEqual([recent]);
            expect(events).toBe(0);
        });
    });
});

describe('the analytics plugin, limiting what one address sends', () => {
    beforeAll(async () => {
        baseUrl = await startWith([]);
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    it('takes 60 page views and events a minute from one address, together, and refuses the next', async () => {
        const statuses: number[] = [];
        for (let sent: number = 0; sent < 60; sent++) {
            statuses.push(await send(sent % 2 === 0 ? 'page-views' : 'events', sent % 2 === 0
                ? pageView()
                : { ...pageView(), entry: undefined, name: 'phone-clicked' }));
        }

        expect(statuses.filter(status => status !== 204)).toEqual([]);
        expect(await send('page-views', pageView())).toBe(429);
    });
});