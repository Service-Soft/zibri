# Auth core, sessions, 2FA, authorization, tenancy, rate limiting — code review

Extracted from the evaluation chapter [04-auth-core.md](../04-auth-core.md); `A` ids refer to its
findings. These are shape, duplication and style, with the evaluation's severity scale.
Cross-cutting: [09-architecture-and-code-quality.md](./09-architecture-and-code-quality.md).

### Q1. `AuthService` is 2 041 lines and carries four hand-written copies of the same decorator resolution — MINOR
*Filed 2026-10-21.*

`resolveIsLoggedInMetadata`, `resolveIsNotLoggedInMetadata` and `resolveRequire2faMetadata`
(`auth.service.ts:1692-1746,1749-1803,1912-1966`, modified) are the same sixty lines with the names swapped: read
route and controller check, read both skips, refuse three conflict pairs, warn about two useless skips, return in the
same precedence. The rework already wrote the generic form for permissions, `resolvePermissionMetadata` over
`DeclaredPermissionChecks` (`:1859-1909`); the other three were not moved onto it. Same for the per-request memo:
`memoized` (`:1603-1619`) serves principals, while `resolveMembership` (`:1365-1381`) and `resolveCredentialLimits`
(`:1408-1426`) re-implement the WeakMap-of-Map pattern by hand. Beyond duplication, the class mixes five concerns
(route metadata resolution at boot, runtime checks, identity linking and provider access, api keys, user
deactivation); the boot-time half (`resolveRouteAuth` and everything it calls) is a `RouteAuthResolver` waiting to be
its own service. CODE_STYLE: "group related functions into a utility class", "extend an existing helper rather than
adding a sibling".

> **Closed 2026-10-29 (user's decision: split it out).**
> - **Deduplicated:** the five check resolutions go through one `resolveCheckMetadata` over
>   `DeclaredChecks<Check>` (`models/declared-checks.model.ts`, `mv` of the permission-only
>   `DeclaredPermissionChecks`, now generic). The only difference between them was that
>   `@Auth.isLoggedIn.skip` warns of uselessness only under a `'public'` default, so that is the
>   one argument. `resolveMembership` and `resolveCredentialLimits` use `memoizedIn` like the
>   principals.
> - **Split:** the boot-time half is `RouteAuthService` behind `RouteAuthServiceInterface` and
>   `ZIBRI_DI_TOKENS.ROUTE_AUTH_SERVICE`: `resolveRouteAuth`, the new `resolveManualRouteAuth`, the
>   five check resolutions (synchronous now, as they always were), `requiresAuthentication`,
>   `requiresRouteAuthentication`, `validateRouteAuth`, `validatePermissionIsDeclared`, the redundant
>   skip warnings and the login gate. It reads `defaultAuth` in its `beforeAppInit`. `AuthService`
>   keeps the checks at runtime, and `checkRouteAccess` asks the new service for the declaration.
>   `auth.service.ts` 2715 → 2166 lines, `route-auth.service.ts` 430.
> - **Callers:** the route registry, the router, the OpenAPI service (through a getter, so a
>   subclass's constructor is unchanged) and the authorization server reach it through the token.
> - **Docs:** `auth.md` and `configuration.md` have its rows; `upgrading-to-3.md` says where the three
>   resolutions that 2.x had on `AuthServiceInterface` went.
> - **Tests:** no behavior changed. `open-api.service.test.ts`, `router.test.ts` and the docs checks
>   boot through the new token and stay green; `auth.service.test.ts` (whose resolution tests are
>   synchronous now), `default-auth.test.ts` and `route-metadata.evaluation.test.ts` are
>   container-backed, yours to run.

### Q2. `getCurrentUser` / `getCurrentMembership` do round trips under a `get` verb — MINOR
*Filed 2026-10-21.*

Both read the store, resolve the membership and compute permissions (`auth.service.ts:713-754,1304-1326`,
modified; `AuthServiceInterface` the same). CODE_STYLE's verb table reserves `get` for "the value is already there";
"a getter that walks an inheritance chain or reads a file is a `resolveX`, however cheap it looks". These are the
two most-called public names of the auth api and the rework is the moment to rename them (`resolveCurrentUser`),
which the repository's own rule about precise names over compatibility supports. Same family: `RateLimitKeys.perConnection`
reads the request context under a bare noun.

> **Closed 2026-10-29.** `resolveCurrentUser` and `resolveCurrentMembership` on `AuthServiceInterface`
> and `AuthService`, and `RateLimitKeys.resolveConnectionKey` and `resolveUserKey`; every caller,
> `rate-limiting.md`, `tenancy.md` and `upgrading-to-3.md` name them. `getCurrentUser` was in 2.x,
> so the upgrade guide says to call the new name; the other three are new in 3.x. A rename, so no
> new test: typecheck holds every caller, and `auth.service.test.ts` and the rate limiting suites
> run under the new names (container-backed, yours to run).

### Q3. Error swallowing on the critical path — MINOR (see A5)
*Filed 2026-10-21.*

`catch { // ignore; return undefined; }` in `JwtAuthStrategy.logout` and `CookieAuthStrategy.endFamily` is the
shape CODE_STYLE's "fix the cause" paragraph names: a guard that hides a wrong value. It is also what makes A5
possible, so it closes with it.

> **Closed 2026-10-29, by A5 (closed 2026-10-22).** Both catches are gone: `JwtAuthStrategy.logout`
> and `CookieAuthStrategy.endFamily` let a failing store through, each with the comment that a login
> left live is the caller's to record, and A5's tests hold it. Found when this item was picked up;
> nothing left to change.

### Q4. Two module-level functions in a service file — MINOR
*Filed 2026-10-21.*

`auditSubject` and `auditUserId` sit above the class in `auth.service.ts:95-118` (modified). CODE_STYLE: a
standalone function is for something that belongs to no group, and "when a second one appears next to it, they
become a class". `AuditUtilities` beside `auditReasonFor` (`logging/audit-reason-for.function.ts`, itself a lone
function) is the place.

> **Closed 2026-10-29.** `logging/audit.utilities.ts` (`mv` of `audit-reason-for.function.ts`)
> holds `AuditUtilities.resolveReason`, `resolveSubject` and `resolveUserId`; the two functions left
> `auth.service.ts`, and the eight callers of `auditReasonFor` and `zibri/internal` name the class.
> The behavior is held by the audit suites that already read the reasons and subjects.

### Q5. `RoleService` keeps per-tenant indexes in a tenant-scoped cache store reached through `runAs` — MINOR
*Filed 2026-10-21.*

`tenantIndexes` is an `InMemoryCacheStore` whose key is always the literal `'roles'`, and the tenant is supplied by
switching the active tenant around every access (`role.service.ts:126,758-823`, untracked). It works and is
commented, but a `Map<tenantId, TenantRoleIndex>` with an LRU bound would say the same thing without borrowing the
request's tenant context for a service-internal structure, and would not break if `InMemoryCacheStore` ever stopped
keying by the active tenant.

> **Closed 2026-10-29 (user's decision: an option of the store).** The LRU stays the
> `InMemoryCacheStore`'s: it takes `perTenant` in the new public `InMemoryCacheStoreConfig`, `true` by
> default, and `cacheKeyOf(key, perTenant)` leaves the active tenant out of a key that is not per
> tenant. `RoleService` keeps its indexes in a store with `perTenant: false` keyed by the tenant id,
> without `runAs`, and `inTenantIndexes` and the `'roles'` key are gone; `forgetTenantRoles` no longer
> awaits anything. Tests, red first: "per tenant" in `in-memory.cache-store.test.ts` (each tenant apart
> by default; with `perTenant: false` the key as it is, whichever tenant is active). The role suites
> and `cache.tenancy.test.ts` stay green. `caching.md` has the row.
