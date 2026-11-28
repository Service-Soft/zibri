import { DefinedPermissions, definePermissions, DefinedPlatformPermissions, definePlatformPermissions } from './define-permissions.function';

/**
 * The tenant permissions the analytics plugin of Zibri checks, in the tenant a request acts in: managing the sites of
 * that tenant, and one per query route reading the counts of its sites: the page views per day, per page, the visits
 * per source, the page views per operating system and the funnel. Spread them into the tenant permissions of the
 * application.
 */
// eslint-disable-next-line typescript/typedef
export const ZIBRI_ANALYTICS_PERMISSIONS = [
    'analytics.sites.manage',
    'analytics.days.read',
    'analytics.pages.read',
    'analytics.sources.read',
    'analytics.systems.read',
    'analytics.funnel.read'
] as const;

/**
 * The platform permissions the analytics plugin of Zibri checks: managing every site, of any tenant or of none, and
 * one per query route reading the counts of every site. Spread them into the platform permissions of the application.
 */
// eslint-disable-next-line typescript/typedef
export const ZIBRI_ANALYTICS_PLATFORM_PERMISSIONS = [
    'analytics.sites.manage_all',
    'analytics.days.read_all',
    'analytics.pages.read_all',
    'analytics.sources.read_all',
    'analytics.systems.read_all',
    'analytics.funnel.read_all'
] as const;

/**
 * {@link ZIBRI_ANALYTICS_PERMISSIONS}, by name.
 */
export const ZibriAnalyticsPermissions: DefinedPermissions<typeof ZIBRI_ANALYTICS_PERMISSIONS>
    = definePermissions(ZIBRI_ANALYTICS_PERMISSIONS);

/**
 * {@link ZIBRI_ANALYTICS_PLATFORM_PERMISSIONS}, by name.
 */
export const ZibriAnalyticsPlatformPermissions: DefinedPlatformPermissions<typeof ZIBRI_ANALYTICS_PLATFORM_PERMISSIONS>
    = definePlatformPermissions(ZIBRI_ANALYTICS_PLATFORM_PERMISSIONS);