---
keywords: [analytics, tracking, statistics, page views, visitors, funnel, utm, referrer, privacy, gdpr, first party analytics, sites, domains, multi tenant]
---

# Counting page views and visits
`ZibriAnalyticsPlugin` counts the page views and events of your sites, such as a sent contact form, without a third party. The pages of a site send them to two public routes of your application, which keep the day, the page, the source of the visit and a rough operating system, and never an address or a `User-Agent`. The sites counted are rows: your application counts its own, and each [tenant](../glossary.md#tenant) can add the sites it tracks, whose counts are its own. Routes behind permissions of their own answer the counts: per day, per page, per source, per operating system, and a funnel of the steps a visit takes.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `ZibriAnalyticsPlugin` | class | The plugin for counting page views and events |
| `AnalyticsController` | class | The routes of the analytics, below the path of your controller extending it |
| `ZIBRI_ANALYTICS_PLUGIN_DI_TOKENS` | DI token | The tokens of the plugin, see [configuring the plugin](#configuring-the-plugin) |
| `AnalyticsPluginOptionsInput`, `AnalyticsPluginOptions` | type, type | The time zone of the days and how long rows are kept, via `ZIBRI_ANALYTICS_PLUGIN_DI_TOKENS.OPTIONS_INPUT`. Required |
| `AnalyticsSite` | entity | A site counted once verified: its domain, the tenant its counts belong to or none, and its verification. Stored by `ZibriAnalyticsPlugin` |
| `ZIBRI_ANALYTICS_PERMISSIONS`, `ZibriAnalyticsPermissions` | constant, constant | The tenant permissions of the sites and the counts of a tenant, to spread into yours, and the same by name |
| `ZIBRI_ANALYTICS_PLATFORM_PERMISSIONS`, `ZibriAnalyticsPlatformPermissions` | constant, constant | The platform permissions of every site and its counts, to spread into yours, and the same by name |
| `AnalyticsServiceInterface`, `AnalyticsService` | interface, class | Keeps the sites, the page views and events, and counts them. Replaceable through `ZIBRI_ANALYTICS_PLUGIN_DI_TOKENS.ANALYTICS_SERVICE` |
| `AnalyticsSiteCreateData`, `NewAnalyticsSite` | type, class | What `createSite` of the analytics service takes, and what `POST /sites` takes |
| `AnalyticsSiteDetails`, `AnalyticsSiteVerificationRecord` | class, class | What the site routes answer: the site and the DNS record that verifies it |
| `AnalyticsSiteVerificationUtilities` | class | The value of the record that verifies a site, and a site as the routes answer it |
| `AnalyticsDnsServiceInterface`, `AnalyticsDnsService` | interface, class | Reads the TXT records a site is verified by, from the resolver of the system. Replaceable through `ZIBRI_ANALYTICS_PLUGIN_DI_TOKENS.DNS_SERVICE` |
| `AnalyticsRateLimiter` | class | Limits what one address sends to 60 page views and events a minute. Replaceable through `ZIBRI_ANALYTICS_PLUGIN_DI_TOKENS.RATE_LIMITER` |
| `AnalyticsCleanupCronJob` | cron job | Deletes the rows older than `retentionInMs`, daily. Registered for you |
| `AnalyticsSiteVerificationCronJob` | cron job | Reads the record of every verified site of a tenant again, daily, see [verifying a domain](#verifying-a-domain). Registered for you |
| `AnalyticsPageViewRecord`, `AnalyticsEventRecord`, `BaseAnalyticsRecord` | entity, entity, class | A page view and an event kept, and what both hold. Stored by `ZibriAnalyticsPlugin` |
| `AnalyticsPageView`, `AnalyticsEvent`, `AnalyticsSource` | class, class, class | What `POST /page-views` and `POST /events` take, and the source of a visit in them |
| `AnalyticsDay`, `AnalyticsPage`, `AnalyticsSourceCount`, `AnalyticsSystem` | class, class, class, class | What `GET /days`, `GET /pages`, `GET /sources` and `GET /systems` answer, one per row |
| `AnalyticsFunnel`, `AnalyticsFunnelStep`, `AnalyticsFunnelSource`, `AnalyticsFunnelBy` | class, class, class, type | What `GET /funnel` answers, a step it takes, its counts of one source, and whether it follows visits or visitors |
| `AnalyticsRange` | type | The days, the site and the tenant a count is of, as the analytics service takes them |
| `AnalyticsOperatingSystem` | enum | The rough operating system of a page view: `WINDOWS`, `MACOS`, `LINUX`, `IOS`, `ANDROID` or `OTHER` |

`zibri-contract` has the models of the routes for your frontend: `AnalyticsPageViewModel`, `AnalyticsEventModel`, `AnalyticsSourceModel`, `AnalyticsSiteModel`, `AnalyticsSiteVerificationRecordModel`, `NewAnalyticsSiteModel`, `AnalyticsDayModel`, `AnalyticsPageModel`, `AnalyticsSourceCountModel`, `AnalyticsSystemModel`, `AnalyticsFunnelModel`, `AnalyticsFunnelStepModel`, `AnalyticsFunnelSourceModel`, `AnalyticsFunnelBy`, `AnalyticsOperatingSystem` and the permissions.

## Setting it up
Add `new ZibriAnalyticsPlugin()` to the `plugins` of your application, see [registering a plugin](../application/plugin.md#registering-a-plugin), and `AnalyticsSite`, `AnalyticsPageViewRecord` and `AnalyticsEventRecord` to the `entities` of your data source.

Extend `AnalyticsController` with a `@Controller` of your own, at the path you choose:

```ts
// src/controllers/analytics.controller.ts
import { AnalyticsController, Controller } from 'zibri';

@Controller('/analytics', { versions: 'all' })
export class AppAnalyticsController extends AnalyticsController {}
```

Add it to the `controllers` of your application:

```ts
// src/application-options.base.ts
import { OmitStrict, ZibriAnalyticsPlugin, ZibriApplicationOptions } from 'zibri';

import { AppAnalyticsController } from './controllers/analytics.controller';

export const baseApplicationOptions: OmitStrict<ZibriApplicationOptions, 'dataSources'> = {
    name: 'Task Tracker',
    baseUrl: 'http://localhost:3000',
    version: '1.0.0',
    environment: 'development',
    plugins: [new ZibriAnalyticsPlugin()],
    controllers: [AppAnalyticsController],
    websocketControllers: [],
    defaultAuth: 'public',
    twoFactorAtLogin: 'never'
};
```

Name the time zone the days are counted in through `OPTIONS_INPUT`. It is required:

```ts
// src/providers.ts
import { defineProvider, DiProvider, ZIBRI_ANALYTICS_PLUGIN_DI_TOKENS } from 'zibri';

export const analyticsProviders: DiProvider<unknown>[] = [
    defineProvider({
        token: ZIBRI_ANALYTICS_PLUGIN_DI_TOKENS.OPTIONS_INPUT,
        useValue: { timezone: 'Europe/Berlin' }
    })
];
```

Spread `ZIBRI_ANALYTICS_PERMISSIONS` into your tenant permissions and `ZIBRI_ANALYTICS_PLATFORM_PERMISSIONS` into your platform permissions, see [declaring permissions](../auth/roles-and-permissions.md#declaring-permissions), and give them to the roles that manage the sites and read the counts:

```ts
// src/models/permissions.ts
import { DefinedPermissions, definePermissions, DefinedPlatformPermissions, definePlatformPermissions, ZIBRI_ANALYTICS_PERMISSIONS, ZIBRI_ANALYTICS_PLATFORM_PERMISSIONS, ZIBRI_PERMISSIONS, ZIBRI_PLATFORM_PERMISSIONS } from 'zibri';

const PERMISSIONS = [...ZIBRI_PERMISSIONS, ...ZIBRI_ANALYTICS_PERMISSIONS, 'invoices.read'] as const;
const PLATFORM_PERMISSIONS = [...ZIBRI_PLATFORM_PERMISSIONS, ...ZIBRI_ANALYTICS_PLATFORM_PERMISSIONS, 'tenants.manage'] as const;

export const Permissions: DefinedPermissions<typeof PERMISSIONS> = definePermissions(PERMISSIONS);
export const PlatformPermissions: DefinedPlatformPermissions<typeof PLATFORM_PERMISSIONS> = definePlatformPermissions(PLATFORM_PERMISSIONS);
```

A tenant role carrying `'analytics.*'` manages the sites of its tenant and reads their counts, and a platform role carrying it manages every site and reads every count. An application counting only its own sites needs the platform permissions alone. The pages of your site call the routes from the browser, so the `cors` of your application allows its origin, see [CORS](../application/app-settings.md#cors).

## Adding the sites
A page view or event is counted when a verified `AnalyticsSite` has its domain, and dropped otherwise. Create the sites of your application with the default data your application creates when it starts:

```ts
// src/create-default-sites.function.ts
import { AnalyticsServiceInterface, inject, ZIBRI_ANALYTICS_PLUGIN_DI_TOKENS } from 'zibri';

export async function createDefaultSites(): Promise<void> {
    const analytics: AnalyticsServiceInterface = inject(ZIBRI_ANALYTICS_PLUGIN_DI_TOKENS.ANALYTICS_SERVICE);
    // your own domain
    if (await analytics.findSite('example.com') == undefined) {
        await analytics.createSite({ domain: 'example.com', tenantId: null });
    }
}
```

`tenantId: null` makes a site of no tenant, one of the application itself, which is verified when it is created and counted at once. `createSite` stores the domain in lower case and without `www.`. A site counts its domain and the same domain with `www.` before it, in any case: the site `example.com` counts `example.com` and `www.example.com`, under `example.com`. Any other subdomain, such as `blog.example.com`, is a site of its own.

A site verified or removed is counted or dropped from the next page view on, on the instance writing it at once and on every other within seconds, however it is written: through the routes below, the analytics service, or the repository. The page views and events of a site whose [tenant is deactivated](../data/tenancy.md#deactivating-a-tenant) are answered `204` like any other and not kept.

The routes below manage the sites at runtime, such as for a tracking platform whose tenants each add the applications they track:

| Route | What | Permission |
|---|---|---|
| `GET /sites` | The sites of the tenant of the request, by domain. A request naming no tenant lists every site | `analytics.sites.manage` (tenant) or `analytics.sites.manage_all` (platform) |
| `POST /sites` | Adds a site: `domain` and, with the platform permission, `tenantId`. Answers the site with the record that verifies it | the same |
| `POST /sites/:id/verify` | Verifies a site by its DNS record, see [verifying a domain](#verifying-a-domain) | the same |
| `DELETE /sites/:id` | Removes a site. Its page views and events stay until `retentionInMs` deletes them | the same |

Each route takes either permission, which `@Auth.hasAnyLevelPermission` checks, see [accepting a permission of either level](../auth/roles-and-permissions.md#accepting-a-permission-of-either-level). The tenant permission manages the sites of the tenant of the request alone:

- `POST /sites` creates the site in the tenant of the request, always. A body naming another tenant, or `tenantId: null` for a site of no tenant, is refused with a `403`, and a request naming no tenant is refused with a `403` too
- `GET /sites` lists the sites of that tenant, without the sites of other tenants or of none
- `POST /sites/:id/verify` and `DELETE /sites/:id` verify and remove a site of that tenant, and answer a site of another tenant or of none with a `404`, as a site that does not exist

The platform permission manages every site. `POST /sites` creates a site in the tenant its `tenantId` names, of no tenant with `tenantId: null`, and in the tenant of the request, or of none, without `tenantId`. A `tenantId` no tenant has is refused with a `400`, when your application [declares its tenants](../data/tenancy.md#declaring-the-tenants). `POST /sites/:id/verify` and `DELETE /sites/:id` verify and remove any site.

A tenant has one site of a domain at most, and a site of no tenant is refused with a `400` for a domain a verified site has.

## Verifying a domain
A site of a tenant is counted once its tenant proved it controls the domain, so no tenant counts the visitors of a domain that is not theirs. The site starts unverified, with a random `verificationToken`, and the site routes answer the record that verifies it as `verificationRecord`:

```json
{
    "id": "8c1d2f6e-4b7a-4c3e-9f0d-2a6b5e1c7d84",
    "domain": "example.com",
    "tenantId": "3f0c1d52-8b6e-4c55-9a4f-2d1e7b9c4a10",
    "verifiedAt": null,
    "recordMissingSince": null,
    "verificationToken": "5b9e0c2a-7d41-4f6e-b8a3-1c2d3e4f5a6b",
    "verificationRecord": {
        "type": "TXT",
        "name": "example.com",
        "value": "analytics-site-verification=5b9e0c2a-7d41-4f6e-b8a3-1c2d3e4f5a6b"
    }
}
```

The tenant adds a TXT record with that value on the domain itself, not on `www.` or another subdomain, and calls `POST /sites/:id/verify` once it is published. The route reads the TXT records of the domain from DNS, and sends no request to the site. With the record found, it sets `verifiedAt` and answers the site, which is counted from the next page view on. Without it, it answers `400` naming the record that is missing, and the tenant tries again once the record is published. A resolver that cannot be reached answers `503`. Verifying a verified site answers it as it is.

Several tenants may claim one domain, each with a site and a token of its own. A domain is verified by one site at most: the first that verifies it with its record. Verifying another site of that domain answers `400`, and removing the verified site lets another claim verify it.

The record stays on the domain for as long as the site is counted, and the site routes answer it as `verificationRecord` once the site is verified too. `AnalyticsSiteVerificationCronJob` reads the record of every verified site of a tenant once a day:

- found: the site stays verified, and `recordMissingSince` is set back to `null`
- missing: `recordMissingSince` says since when, and the site keeps counting. Once the record is missing for `verificationRecordGraceInMs`, 7 days by default, the site loses its verification: `verifiedAt` is `null` again and its page views are dropped. Its token stays, so publishing the same record again and calling `POST /sites/:id/verify` counts it again
- unreadable, such as with a resolver that cannot be reached: nothing changes, and the next check reads it again

A site of no tenant is not checked.

## Sending page views and events
The pages of a site send one request per page view and per event, without cookies:

| Route | Takes |
|---|---|
| `POST /page-views` | `visitId`, `domain`, `path`, `language`, `entry`, `source` and, with consent, `visitorId` |
| `POST /events` | `visitId`, `domain`, `name`, `category`, `path`, `language`, `source` and, with consent, `visitorId` |

```json
{
    "visitId": "0b8e5f2c-6f0d-4c1e-9a4e-3f5d2c7b1a90",
    "domain": "example.com",
    "path": "/pricing",
    "language": "en",
    "entry": true,
    "source": { "referrer": "google.com", "utmCampaign": "spring" }
}
```

`visitId` is a random uuid the page draws for each visit, and `entry` is `true` on the first page view of the visit. `source` is where the visit came from: the host of the external referrer, without `www.`, and the `utm_*` parameters of the url it entered with, as `utmSource`, `utmMedium`, `utmCampaign`, `utmTerm` and `utmContent`. The page sends the source of the entry with every later page view and event of the visit.

Both routes answer `204` and are public whatever `defaultAuth` says. A page view or event of a domain no verified site has, of a site whose tenant is deactivated, or with a `User-Agent` of a bot, a crawler, a headless browser or a script, or without one, is answered the same and not kept. A page view belongs to the tenant of its site, or to none, whatever tenant the request names.

Every value is bounded, and a request breaking a bound answers `400` and keeps nothing:

| Value | Takes |
|---|---|
| `visitId`, `visitorId` | A uuid |
| `domain`, `referrer` | A host, such as `example.com` or `localhost:4200`, of at most 253 characters. A url is refused |
| `path` | A path starting with `/`, of at most 1000 characters. A path with a query or a hash is refused |
| `language` | Letters, digits and `-`, at most 35 characters |
| `name`, `category` | At most 100 characters |
| `utmSource`, `utmMedium`, `utmCampaign`, `utmTerm`, `utmContent` | At most 200 characters |

A body of more than 4 kilobytes answers `413`. One address sends at most 60 page views and events a minute, counted together, and the next answers `429`. The limit is per instance of your application, see [rate limiting](../endpoints/rate-limiting.md#sharing-limits-across-instances).

> [!WARNING]
> Behind a load balancer or ingress, set `security.trustProxy`, see [app settings](../application/app-settings.md). Without it, every visitor sends from the address of the proxy, and they share one limit.

## Counting visitors with consent
A visitor who consents is given a random uuid by the page, kept on their device as long as the consent lives, and sent as `visitorId`. It links the visits of one device. Without consent, no `visitorId` is sent, and a visitor who comes back, or reloads the page, is a new visit.

A page view whose `visitorId` no kept page view of the same tenant has is the first visit of its visitor. A visitor whose rows were deleted after `retentionInMs` counts as new again.

`GET /days` and `GET /pages` answer the visitors and first visits beside `consentedPageViews`, the page views that carried a `visitorId`. Both are counted among those alone, so compare them with `consentedPageViews` rather than with `pageViews`.

## Reading the counts
Each route takes `from` and `to`, the first and the last day counted, such as `2026-03-01`, and `domain` for one site, with or without `www.`. A day is the calendar day of the `timezone` of the plugin.

| Route | Answers | Permission |
|---|---|---|
| `GET /days` | Per day with page views, the earliest first: `pageViews`, `entries`, `consentedPageViews`, `visitors` and `firstVisits` | `analytics.days.read` or `analytics.days.read_all` |
| `GET /pages` | The same per `path` and `language`, the most viewed first | `analytics.pages.read` or `analytics.pages.read_all` |
| `GET /sources` | Per `source`, the most entered first: the `entries` of the visits from it, and their `events` | `analytics.sources.read` or `analytics.sources.read_all` |
| `GET /systems` | Per `operatingSystem`, the most viewed first: `pageViews` | `analytics.systems.read` or `analytics.systems.read_all` |
| `GET /funnel` | How many visits or visitors reached each of the given steps in order, overall and per source, see [following a funnel](#following-a-funnel) | `analytics.funnel.read` or `analytics.funnel.read_all` |

Each route takes its tenant permission or its platform permission, the one ending in `_all`. A request naming a tenant counts the sites of that tenant, with either permission. A request naming no tenant counts every site, of any tenant or of none, which the platform permission alone allows. A tenant is never answered the counts of a site of another tenant or of none: with the `domain` of one, it is answered nothing. A caller without the permission is answered `403`.

`entries` counts the visits, as each visit has one entry. A visit of a source without a referrer and without `utm_*` parameters, such as one typed in, has a `source` holding none of them.

## Following a funnel
`GET /funnel` takes the `steps` in order, as a JSON array in one query parameter, each step a `path` or an `event`:

```
GET /analytics/funnel?from=2026-03-01&to=2026-03-31&steps=[{"path":"/pricing"},{"event":"contact-form-sent"}]
```

It answers how many visits entered in the range, as `entered`, and how many of them then reached each step after the steps before it, as `reached`, in the order the rows arrived. `sources` holds the same per source of the visit, the most entered first. A funnel takes at most 10 steps, and a step naming both a path and an event, or neither, answers `400`.

With `by=visitor`, the funnel follows each visitor who consented across their visits, from their first entry in the range, by the source of that entry, such as a first visit from a search engine and a contact on a later visit. It covers the visitors who consented alone, and says `by: 'visitor'` in the answer. `by=visit` is the default.

A row counts when it is in the range: a visit that entered before `from` is not counted, and a step after `to` is not reached. The funnel reads every entry of the range and every page view and event matching a step, and holds them while it counts, so a range of many months of a busy site takes longer than the other routes.

## What is stored
For your privacy policy, a page view and an event keep:

- the tenant of the site, or none
- the day, in the `timezone` of the plugin, and the time it arrived
- the domain, the path and the language of the page, and the name and category of an event
- whether the page view entered the visit, and whether it was the first visit of its visitor
- the random `visitId` of the visit, which links the steps of one visit
- the random `visitorId`, only when the visitor consented, which links their visits
- the source of the visit: the host of the referrer and the `utm_*` parameters
- a rough operating system, one of Windows, macOS, Linux, iOS, Android and other

The address of the visitor and the `User-Agent` are not kept: the operating system is read from the `User-Agent` and the `User-Agent` dropped. No other identifier is kept, and a row has a random id of its own that names nobody. `AnalyticsCleanupCronJob` deletes the rows of every tenant once their day is older than `retentionInMs`, two years by default, every day. Deleting a tenant deletes its sites and their rows, see [deleting a tenant](../data/tenancy.md#deleting-a-tenant).

## Configuring the plugin
The tokens of `ZIBRI_ANALYTICS_PLUGIN_DI_TOKENS`. The plugin checks at startup that the required ones are provided.

| Token | Type | What it is |
|---|---|---|
| [`OPTIONS_INPUT`](#setting-it-up) | `AnalyticsPluginOptionsInput` | `timezone`, the time zone of the days. Required. `retentionInMs` is how long a row is kept, two years by default, or `'forever'`. `verificationRecordGraceInMs` is how long the record of a verified site may be missing before it loses its verification, 7 days by default |
| `OPTIONS` | `AnalyticsPluginOptions` | `OPTIONS_INPUT` as it is in effect. Read, not provided |
| `ANALYTICS_SERVICE` | `AnalyticsServiceInterface` | Keeps the sites, the page views and events, and counts them. `AnalyticsService` by default |
| [`DNS_SERVICE`](#verifying-a-domain) | `AnalyticsDnsServiceInterface` | Reads the TXT records a site is verified by. `AnalyticsDnsService` by default, asking the resolver of the system |
| [`RATE_LIMITER`](#sending-page-views-and-events) | `RateLimiterInterface` | What limits one address. `AnalyticsRateLimiter` by default, 60 a minute in memory |

## Requirements
Your data source declares these entities:

| Entity | Needed when |
|---|---|
| `AnalyticsSite`, `AnalyticsPageViewRecord`, `AnalyticsEventRecord` | The plugin is registered |
| `CacheInvalidation` | The plugin is registered, with `AnalyticsService` |

How large each table grows, and what deletes its rows, is in [framework tables](../data/framework-tables.md).

## See also
- [Plugins](../application/plugin.md) — registering a plugin, and writing your own
- [Roles and permissions](../auth/roles-and-permissions.md) — giving the permissions of the sites and the counts to a role
- [Tenants](../data/tenancy.md) — the tenant of a request, and what belongs to a tenant
- [Rate limiting](../endpoints/rate-limiting.md) — replacing the limiter, such as with one every instance shares
