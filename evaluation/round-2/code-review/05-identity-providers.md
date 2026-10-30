# Identity providers, directories, SCIM, authorization server, client certificates — code review

Extracted from the evaluation chapter [05-identity-providers.md](../05-identity-providers.md); `I` ids
refer to its findings. These are shape, duplication and style, with the evaluation's severity scale.
Cross-cutting: [09-architecture-and-code-quality.md](./09-architecture-and-code-quality.md).

### Q1. `ScimService` (1974 lines) and `BaseFederatedAuthenticator` (1201 lines) carry several concerns each — MINOR
`scim/scim.service.ts` (modified in the working tree) holds the resource routes, the bulk engine with its circle breaking (lines 528-659, 1694-1933), the value-index matching (667-791), two paging strategies (803-913), group-closure walks (1083-1174) and the versioning. The bulk engine and the value-sorted paging are pure enough to be `ScimBulkUtilities` / `ScimPagingUtilities` under CODE_STYLE's "group related functions into a utility class". `BaseFederatedAuthenticator` likewise mixes the protocol-neutral sign-in with cookie plumbing (`findCookie`, `setBindingCookie`, `clearCookie`, lines 1161-1201) that `resolveHttpContext` makes request-bound; a `FederatedBindingUtilities` would also let an application's own routes reuse the binding without extending the class.

> **Closed 2026-10-29 (user's decision: split both).** No behavior changed. Each split moves steps
> into a `*Utilities` class beside the file, entry points first, with the state passed in.
> - **SCIM:** `ScimBulkUtilities.apply` holds the bulk engine:
>   - reading the operations and `failOnErrors`;
>   - the passes that resolve `bulkId:` references;
>   - breaking a circle, and completing it;
>   - the result and error of each operation.
>
>   It applies each operation through the `ScimServiceInterface` it is handed, which is the service
>   itself. `ScimPagingUtilities` holds `resolveStartIndex`, `resolveCount`, `toListBody`, and the two
>   ways to read a page of users: by a column (`resolveUserPage`), and by the value of an attribute
>   without one (`resolveValueSortedPage`). The service hands the page readers a `ScimUserPages` with
>   the repositories and its orphan and body steps. All three are on `zibri/internal`.
>   `scim.service.ts` 1981 → 1424 lines.
> - **Federated:** `FederatedBindingUtilities` (public, with a Key exports row in
>   `login-through-a-provider.md`) holds the binding cookie: `getCookieName`, `findCookie`,
>   `setCookie` and `clearCookie`, on the http request being handled. An application's own routes
>   can tie a login to the browser without extending `BaseFederatedAuthenticator`.
>   `base-federated.authenticator.ts` 1258 → 1216 lines.
> - **Tests:** the in-memory SCIM, OIDC, OAuth2, SAML, provider token and federated interface suites
>   stay green (226 tests). The container-backed ones, such as `base-keycloak.authenticator.test.ts`,
>   are yours to run.

### Q2. An orphaned JSDoc in `BaseOAuthAuthenticator` — MINOR
`oauth/base-oauth.authenticator.ts:486-491` is a JSDoc block ("Stops keeping the tokens of an identity ... @returns The tokens that were kept") followed directly by a second JSDoc for `unlinkUnusedIdentity`; the first belongs to `removeTokens` at line 503, which has none. Published typedoc attaches the wrong text or none.

> **Closed 2026-10-29.** The block sits on `removeTokens`, which had none; `unlinkUnusedIdentity`
> keeps its own.

### Q3. Four cleanup cron jobs with one shape — MINOR, from `after-all-findings-fixed.md` item 1
`FederatedCleanupCronJob` (four `deleteAll({ expirationDate: { before: now } })`, `federated/federated-cleanup.cron-job.ts:39-42`), `ApiKeyCleanupCronJob`, `JwtRevokedAccessTokenCleanupCronJob` and `TwoFactorCodeCleanupCronJob` all delete expired rows of an entity on a timer and are each pushed into `app.options.cronJobs` by whatever `init` happens to run (`base-federated.authenticator.ts:228-230`, `client-access-token.auth-strategy.ts:107-109`, `api-key.service.ts:101-103`). A declarative `expiresAt`/`expirationDate` marker on the entity with one framework sweeper is the generic system the user's list asks about, and would also give the `FederatedLoginAttempt` rows an attacker can mint at the rate limiter's budget a bound that does not depend on an authenticator having registered the job.

> **Closed 2026-10-29 with 06 §Q9 and 09 §Q8 (user's decision: a declaration on the entity).**
> - **The declaration:** `@Entity({ expiresBy: 'expirationDate' })` names the date property a row
>   expires by. It is checked against the class while compiling, and refused while starting when it
>   names no date property.
> - **The job:** `ExpiredRowsCleanupCronJob` (`cron/`) deletes, every hour, the rows of every entity
>   of every data source that declares it, once the date has passed by `dataSourceNow()`, across
>   tenants. It reads the data sources through `DataSourceServiceInterface.getDataSources` (new). The
>   cron service registers it when an entity declares `expiresBy`, so the federated rows are bounded
>   whether or not an authenticator registered anything.
> - **What it replaced:** 15 entities declare it. That is 12 of the auth layer (the four federated
>   ones, 2FA codes, reset and verification tokens, login tickets, both cookie sessions, JWT refresh
>   and revoked access tokens), plus mailing list confirmation tokens, `Lease` by `expiresAt` and `Log`
>   by `cleanupAt`. Their 11 jobs and the 11 registrations are gone.
> - **The data source's clock:** chosen for every entity, as the lease job used it. A grant still
>   held by that clock must not be deleted, and every instance shares it. Jobs that ran daily run
>   hourly.
> - **What stays:** the jobs with more than a date: API keys and passkeys through their services,
>   audit, thread jobs, failed mail and events with their retention tokens, websocket messages by
>   sequence, backup staging, form data files, the cache and rate limiting.
>
> 2.x had three of the removed jobs, so the upgrade migration deletes their stored rows (`Cleanup
> cookie auth sessions`, `Cleanup jwt refresh tokens`, `Log Cleanup`), and its table says so. Docs:
> "Deleting rows once they expire" in `data-source.md` with the job's Key exports row; the removed
> rows left `auth.md`, `two-factor.md`, `email-verification.md`, `authorization-server.md`,
> `leases.md` and `login-through-a-provider.md`; `framework-tables.md` names the new job.
>
> Tests, red first:
> - `cron/expired-rows-cleanup.cron-job.test.ts` (new, in memory, the real cron service): registered;
>   an application entity's rows deleted in two tenants with the live ones kept; the reset token
>   case of the removed job's test; every framework entity declaring its date;
> - `entity.decorator.test.ts`: the declaration kept, and a name that is no property and a number
>   property refused.
>
> The unit tests of the removed log, cookie session and refresh token jobs went, since the
> declaration and the job hold what they held. `logger.tenancy.test.ts` and `mailing-list.service.test.ts`
> run the new job. The reInit case of the reset token job's test held the harness, so it moved to
> `__testing__/test-server/start-test-server.function.test.ts` with the audit checkpoints' job.

### Q4. `startConnection` / `linkIdentity` naming — MINOR, from `after-all-findings-fixed.md` item 10
The user wants `startLinkIdentity` / `confirmLinkIdentity`. Reading the flow confirms the asymmetry is worse than the names: the chain is `startConnection` (answers a url) → `continueConnection` (the `connect` route, spends the code and starts the attempt) → `completeSignIn` with `attempt.userId` → `linkConnectedIdentity` (`base-federated.authenticator.ts:303-370, 448-451, 870-910`), while the registration chain is `resolveRegistration` → `linkIdentity` → `authenticate`. `linkIdentity` links from a *ticket* and `linkConnectedIdentity` from a *connection*; `completeConnection` on `AuthService` (`auth.service.ts:441-464`) belongs to passkeys and not to this chain at all. The rename should settle the two chains as `startLinkIdentity`/`confirmLinkIdentity` and name the passkey one apart.

> **Closed 2026-10-29, by 08 §X21 (closed 2026-10-25).** Found when this item was picked up: the
> two-step rule of §X21 settled both chains. The connection chain is `requestLinkIdentity` →
> `continueLinkIdentity` (the `connect` route) → `linkRequestedIdentity`, the passkey one
> `requestLinkIdentity`/`confirmLinkIdentity`, and the ticket step `linkTicketIdentity`. Nothing
> left to change.

### Q5. Name uniqueness and provider lookup are duplicated and run `inject` per request — MINOR
`validateName` exists twice with the same body (`base-federated.authenticator.ts:1112-1127`, `base-ldap.authenticator.ts:730-737`), one duck-typed and one `instanceof`; and `FederatedRouteUtilities.findAuthenticator` resolves every registered authenticator through `inject` and compares `name` on every callback, logout and metadata request (`federated-route.utilities.ts:369-371`), as does `ProviderTokenAuthStrategy.findAuthenticators` per request (`provider-token.auth-strategy.ts:135-140`). A registry of federated authenticators by name, built once in `AuthService.onAppStart` where the urls are already checked, would hold both.

> **Closed 2026-10-29.** `AuthService.onAppInit` builds the map by name once every authenticator is
> initialized, through `FederatedRouteUtilities.resolveAuthenticatorsByName`, which refuses a name
> that cannot be part of a url and two authenticators sharing one. `AuthServiceInterface` has
> `findFederatedAuthenticator(provider)`, which the routes, the url check at start and the provider
> logout read. `BaseFederatedAuthenticator.validateName` is gone, so the LDAP one, which checks
> directories among themselves, is the only copy. `ProviderTokenAuthStrategy.init` keeps its
> authenticators by issuer, and a request reads that map. Its "two take the same issuer" refusal
> falls out of building it. Tests, red first, in the in-memory
> `federated-authenticator.interface.test.ts`: two authenticators of the application's own sharing
> a name, and one named `Direct`. Both started, since only the base class checked. The OIDC, OAuth2
> and provider token suites stay green.

### Q6. `FederatedSignInError` reasons collapse into `expired` for errors that are not one — MINOR
`toFailure` sends any refusal that is not a `FederatedSignInError` to the error url as `expired` (`federated-route.utilities.ts:318`), including `UnauthorizedError('No user is linked to this sign-in.')` from `resolveUser` (`base-federated.authenticator.ts:1099-1105`) and a `BadRequestError` from a hook. The enum has `INVALID`; the fall-through should be a distinct value, and the audit reason already distinguishes them.

> **Closed 2026-10-29, as the user chose.** More fell through than the two named: the callback's
> handover runs `authService.login`, so a rate limit's 429 reached the error page as `expired` too.
> `FederatedLoginFailure` has two more values: `NOT_LINKED`, which both "no user is linked" refusals
> now throw as a `FederatedLoginError`, and `FAILED`, the fall-through. `toFailureCode` answers
> `refused` for a `ForbiddenError`, `expired` for any other `UnauthorizedError` (a code, ticket or
> proof that is no longer good), and `failed` for everything else. `login-through-a-provider.md`
> lists both values and says which error gives `refused`. Tests, red first, in the in-memory
> `base-oidc.authenticator.claims.test.ts`: a hook's `BadRequestError` lands on `failed`, and an
> identity whose user is gone on `not_linked` (both landed on `expired`).
