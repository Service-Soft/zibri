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

### Q2. `getCurrentUser` / `getCurrentMembership` do round trips under a `get` verb — MINOR
*Filed 2026-10-21.*

Both read the store, resolve the membership and compute permissions (`auth.service.ts:713-754,1304-1326`,
modified; `AuthServiceInterface` the same). CODE_STYLE's verb table reserves `get` for "the value is already there";
"a getter that walks an inheritance chain or reads a file is a `resolveX`, however cheap it looks". These are the
two most-called public names of the auth api and the rework is the moment to rename them (`resolveCurrentUser`),
which the repository's own rule about precise names over compatibility supports. Same family: `RateLimitKeys.perConnection`
reads the request context under a bare noun.

### Q3. Error swallowing on the critical path — MINOR (see A5)
*Filed 2026-10-21.*

`catch { // ignore; return undefined; }` in `JwtAuthStrategy.logout` and `CookieAuthStrategy.endFamily` is the
shape CODE_STYLE's "fix the cause" paragraph names: a guard that hides a wrong value. It is also what makes A5
possible, so it closes with it.

### Q4. Two module-level functions in a service file — MINOR
*Filed 2026-10-21.*

`auditSubject` and `auditUserId` sit above the class in `auth.service.ts:95-118` (modified). CODE_STYLE: a
standalone function is for something that belongs to no group, and "when a second one appears next to it, they
become a class". `AuditUtilities` beside `auditReasonFor` (`logging/audit-reason-for.function.ts`, itself a lone
function) is the place.

### Q5. `RoleService` keeps per-tenant indexes in a tenant-scoped cache store reached through `runAs` — MINOR
*Filed 2026-10-21.*

`tenantIndexes` is an `InMemoryCacheStore` whose key is always the literal `'roles'`, and the tenant is supplied by
switching the active tenant around every access (`role.service.ts:126,758-823`, untracked). It works and is
commented, but a `Map<tenantId, TenantRoleIndex>` with an LRU bound would say the same thing without borrowing the
request's tenant context for a service-internal structure, and would not break if `InMemoryCacheStore` ever stopped
keying by the active tenant.
