# Documentation vs. Code, and Documentation Gaps

The documentation is unusually good for structure and prose, and unusually unreliable for
correctness. This file separates the two problems: **claims the implementation does not support**,
and **topics that are not covered at all**.

---

## The finding under the findings

Sixteen of the twenty-two rows below were stale when they were re-checked. Not because anybody
answered them — because closing some *other* finding changed a required option or a type, and the
page demonstrating it was never revisited. `defaultAuth` became required, `CURRENT_REQUEST_CONTEXT`
widened to a union, `FsPath` became branded, `Repository`'s constructor grew to six arguments; each
of those left examples behind it that no longer describe anything that exists.

That is a process defect rather than a documentation defect, and it has a mechanical answer:
**`src/docs-examples.test.ts` compiles every documented example on every run.** A page is the unit —
roughly three in five blocks are excerpts of what came before them, so the blocks of one page are
assembled into one module, imports merged, and type checked against the framework's own source under
the compiler options `zi new` scaffolds. A diagnostic reports as `docs/<page>.md:<line>`.

Getting the thirty pages green found, in the docs, one block whose first statement was an assignment
with no right-hand side, one `@Param.query` missing a required option, one `FileResponse.fromPath`
handed a plain string where the branded `FsPath` is required, one controller-shaping example
referencing a class no page declares, one `HttpClientResponse<undefined>` that prose and annotation
agreed on and the method contradicts, and a `down()` migration that could not be written at all.
It also found three framework defects — [§F1](#f1-formdata-body-options-were-unreachable),
[§F2](#f2-two-documented-exports-were-not-exported) and
[§F3](#f3-a-rename-migration-could-not-be-reversed) — because an example that cannot compile is
sometimes the example being right about an api that is wrong.

---

## Part 1 — Claims the code does not support

**Status as of this round.** Citations are given against `packages/zibri/README.md`; the original
run predates the monorepo, so its `README.md:NN` line numbers pointed at a file that has since
moved.

| Claim | Source | Reality |
|---|---|---|
| ~~"durable event system that even survives restarts"~~ **the claim is now true** | `README.md:55` | Delivery was an in-process rxjs `Subject`; events never crossed processes, and the DB row was a log nothing polled. The event system was rebuilt around a dispatch poll every instance runs, a per-event lease deciding which replica dispatches, and the attempt count on the row rather than in the process. → [04](./04-infrastructure-subsystems.md) §1.4–1.5 |
| ~~"retried until every subscriber that was registered at emit time has **successfully** processed them"~~ **the claim is now true** | `docs/events.md:2` | The `EventSubscriberRun` row was written whether the hook succeeded or failed, then the event was marked `FINISHED` and deleted by the cleanup cron; failed subscribers were never retried after the in-call loop. A run now carries `PENDING_RETRY` until its attempts are spent, and the poll offers the event again. → [04](./04-infrastructure-subsystems.md) §2.4 |
| ~~"every emitted event and every subscriber's processing attempt is persisted"~~ **the doc was corrected instead** | `docs/events.md:2` | One row per subscriber per event, carrying how many attempts it has spent and what the last one failed with — the attempts are spread across polls and restarts, so no process knows it is running the third. That is what a reader needs and what the row holds, so the sentence now says it. The "Key exports" table had it right all along. |
| ~~"queuing support for thousands of mails"~~ **the claim is now true** | `README.md:37` | Ten rows per poll via three unlocked `SELECT`s, no claim or lock, no retry, no DLQ, and failed non-persisted mails deleted. Every mail is now claimed with a lease before it is sent and before the rate limiter is asked for tokens, and the claim is retained on error so a mail that failed mid-send is not re-sent by whoever polls next. → [04](./04-infrastructure-subsystems.md) §1.6, §2.2, §3.5 |
| ~~"highly customizable caching system with multi tier"~~ **the claim is now true** | `README.md:57` | Tag invalidation explicitly skipped `MultiTierCache`, so `@CacheInvalidate` against one silently did nothing. Multi tier caches now report the tags of their tiers and invalidate through to those tiers' stores. → [04](./04-infrastructure-subsystems.md) §1.8, §3.9 |
| ~~"advanced features like automatic reuse detection"~~ **the claim is now true** | `README.md:42` | Rotation was a non-atomic read-modify-write under `READ_COMMITTED` with no row lock, and the cookie-side handler minted a *fresh session* after detecting reuse. A conditional write now decides which caller rotated; the other finds the row already moved and destroys the family, which is what reuse detection is for. → [03](./03-auth-and-security.md) §B2–B3 |
| ~~"you will get warnings whenever there is something off. Like an endpoint that is marked to skip auth, although there isn't anything auth related to skip"~~ **the dangerous case is closed, by a required option rather than a warning** | `README.md:98` | The warning was the backwards one: nothing said anything about an endpoint with no auth metadata at all, which ran unauthenticated. `defaultAuth` is a required application option now, so what an unannotated route does is stated by the application rather than defaulted to open. A warning would have told you afterwards; a required option asks before there is anything to warn about. → [03](./03-auth-and-security.md) §A1 |
| ~~"giving you the specifics on *why* a dependency injection failed"~~ **the claim is now true** | `README.md:106` | A circular dependency produced `RangeError: Maximum call stack size exceeded` with no indication of which classes formed the cycle. It is a `CircularDependencyError` now, carrying the chain of token names that says how construction got there. → [05](./05-di-metadata-and-packaging.md) §D1, §D5 |
| ~~"All the public facing classes, interfaces and functions are as strictly typed as possible"~~ **closed down to the variance limit, with 05 §M3** | `README.md:88` The core `PropertyMetadata` union carries five `any`s and `app.use(...args: any[])` accepts anything. → [05](./05-di-metadata-and-packaging.md) §M3. **The compiler half of this row is closed**: `noUncheckedIndexedAccess` and five smaller options are on, and the framework compiles under them. `exactOptionalPropertyTypes` is a decision about what an optional property means rather than a check on the code, and is deliberately not among them — §M2. **Re-checked 2026-10-01:** `app.use` takes a `RequestHandler` through two typed overloads now (02 §M12), and the five `any`s left in `PropertyMetadata` are §M3's variance limit - `TKey` is invariant on `EncryptionStrategyInterface`, so `any` is the only type every strategy's instantiation is assignable to. That is "as strictly as possible" under the current encryption model; removing them is that model's change, named in §M3. |
| ~~`controllerClass` / `controllerMethod` are "the matched route, or `undefined` if routing hasn't resolved yet"~~ **the claim is now true** | `docs/request-context.md:32` | The only non-test `new HttpRequestContext(...)` call site (`src/routing/router.ts:465`) passed `undefined` for both, always. Consequently `HAS_2FA` returned `false` unconditionally and route-configured auth strategies were silently discarded by `CURRENT_USER` and `IS_LOGGED_IN`. The constructor no longer takes them; the route handler records the route it matched. → [02](./02-http-runtime-core.md) §M5 |
| ~~`CURRENT_USER` "runs the route's configured auth strategies"~~ **the claim is now true** | `docs/request-context.md:53` | Ran *all* strategies, whatever `@CurrentUser` named — and ignored its `required` too. |
| ~~`HAS_2FA` is "`false` if there's no matched route or no current user"~~ **the doc was corrected instead** | `docs/request-context.md:55` | `false` in every case. The token no longer consults a route at all: whether a second factor was presented is a fact about the request and the user, so the sentence describing it now says that. |
| ~~rate limiting is "per key (eg. per user or IP)"~~ **the claim is now true** | `docs/rate-limiting.md:2` | There was no supported way to key by IP — `keyFn` received controller-method arguments, not the request — and the default key was the literal string `'global'`, which is one bucket for every caller. `RateLimitKeys` names the choices now, and `perConnection` (the client address over http, the connection over a websocket) is the default. → [03](./03-auth-and-security.md) §E2 |
| ~~`ValKeyRateLimiterLock` presented as the multi-instance correctness answer~~ **closed with 03 §E4, and this row was the stale one** | `docs/rate-limiting.md` | **Re-checked 2026-10-01:** the lock is no longer the correctness answer and the page says so - a lock outside the process expires on its own, can expire while its section still runs, and the `version` every state carries is what makes that harmless (the second writer is refused and starts over). An unreachable store answers 503 or lets the call through, as `onStoreFailure` says, and is never a 500. What follows is the row as it was written. Still does not mention the 5 s TTL, the absence of fencing, the resulting lost updates, or that lock contention surfaces as a 500. → [03](./03-auth-and-security.md) §E4. **The surrounding criticism no longer applies:** the doc now has a "Sharing limits across instances" section that states the in-memory constraint plainly, gives the shared alternative, tabulates which lock to use when, and explains why `WATCH`/`MULTI`/`EXEC` is not a substitute. Re-checked against the current file — the earlier reading was of an older version. |
| ~~the `@RateLimited` example~~ **the example was corrected** | `docs/rate-limiting.md:75-88` | Demonstrated the no-`keyFn` single-bucket configuration that turns a limiter into a DoS amplifier. The page now has a "What a limit is counted per" section that shows the default, per user, one bucket for everyone, and a key built from the arguments, side by side. |
| ~~"By default scrypt and aes-256-gcm are used. If you want a different algorithm, override…"~~ **`ENCRYPTION_MASTER_OPTIONS` is documented** | `docs/encryption-and-hashing.md:58-59` | The mandatory `ENCRYPTION_MASTER_OPTIONS` was never mentioned anywhere, though `EncryptionService` throws `NoProviderError` without it. It is in the page's "Key exports" table and has a section of its own. |
| ~~the primary data-source example~~ **the example was corrected, and the option made required** | `docs/data-source.md` | Demonstrated `synchronize: true` — TypeORM auto-DDL — as the standard configuration, with no warning anywhere that this drops columns in production. `schemaManagement` is required on every sql data source now, and the page tabulates what each of `'synchronize'`, `'migrations'` and `'external'` does and when it is right. → [01](./01-data-layer.md) §C1 |
| ~~the migration example~~ **the example was corrected** | `docs/data-source.md` | Showed `down()` as `throw new Error('Not implemented yet.')`, while `runMigrations` executes `down()` automatically on any version downgrade. The page shows a real `down()` that undoes the rename, and says why writing one is worth it. Making that example compile is what turned up [§F3](#f3-a-rename-migration-could-not-be-reversed). → [01](./01-data-layer.md) §C3 |
| ~~the transaction example~~ **the claim is now true** | `docs/data-source.md` | The documented pattern was the one that leaked a pooled connection when `commit()` itself threw, because `TypeOrmTransaction` called `release()` after the commit rather than in a `finally`. It releases in a `finally`, and the documented pattern always reaches one of commit or rollback. → [01](./01-data-layer.md) §M6 |
| ~~the `subscribe` example, typed `EventServiceInterface<AppEvents>`~~ **the type parameter was removed** | `docs/events.md:26-30` | **Did not compile.** `ZIBRI_DI_TOKENS.EVENT_SERVICE` was typed `EventServiceInterface<Record<string, unknown>>`, and the two were not assignable in either direction because every method constrains `K extends keyof TEvents`. A DI token carries one type and hands every consumer that same type, so the parameter had to be instantiated at the token, which could only name the widest map there is — no consumer could narrow it back. The service is no longer generic: an application declares what it emits by merging into the `ZibriEventMap` interface, once, wherever it likes. **The framework compiles against that interface empty**, which is the case the first cut got wrong — see [§F4](#f4-the-framework-compiles-against-an-empty-event-map). |
| ~~"Batteries included … production-ready subsystems"~~ **the constraint is documented, and mostly no longer holds** | `README.md:31-32` | None of cron, events, the mail queue, websocket rooms or the mail rate limiter was safe above one replica, and no document in `docs/` stated it. Each of those now coordinates through the shared data source, and [`docs/replication.md`](../packages/zibri/docs/replication.md) is the page that says what running more than one instance requires and which failures are quiet. |
| "Requires Node.js >= 22" | `README.md:16` | **Fixed this round.** Every package declares `engines: { node: ">=24" }`, so the quick start's own first command answers `EBADENGINE` on the version it asks for. |
| "~1600 tests running in our pipeline" | `README.md:90` | **Fixed this round**, to "more than 2500". A static count of `it(`/`test(` blocks across the four packages is 2720, of which 20 are skipped and 37 are `.each` (so they expand to more at run time). The exact pipeline number needs a full run, which needs containers. |

No row of Part 1 remains open. The last two pointed at findings tracked elsewhere and both had closed
there without the rows following: `ValKeyRateLimiterLock`'s TTL and fencing with
[03](./03-auth-and-security.md) §E4, and the `any`s in the `PropertyMetadata` union down to the
variance limit with [05](./05-di-metadata-and-packaging.md) §M3.

---

## Framework defects the documentation found

Three of the examples that would not compile were right about an api that was wrong.

### F1 — form data body options were unreachable

`BodyMetadata` is a union of a json shape and a form data shape, and `BodyMetadataInput` was
`Partial<OmitStrict<BodyMetadata, …>>`. `Omit` over a union collapses to the keys every member
shares, so `limits` and `cleanupAfterMs` were silently dropped: they were documented, fully
implemented, and nothing accepted them. `@Body(X, { type: MimeType.FORM_DATA, limits: {…} })` — an
example on `docs/creating-endpoints.md` — did not compile. The input type distributes over the union
now.

Fixing it exposed why nobody had noticed. Both `Body()` and `Router.registerRoute` built the metadata
by spreading over one set of json defaults, so a json body carried `cleanupAfterMs` and `limits`
fields that mean nothing on it, and the decorator then had to `delete` the `baseMaxSize` *input* back
off the result. That construction is one `resolveBodyMetadata` now, built per kind, in a file of its
own so it stays internal — `body.decorator.ts` is re-exported whole, and this is the framework
filling in its own defaults rather than something a consumer calls.

### F2 — two documented exports were not exported

`Sha256HashStrategy` (documented for api-token hashing) and `CompressionOptions` (the type of
`ZIBRI_DI_TOKENS.COMPRESSION_OPTIONS`) both existed and neither was in `src/index.ts`. The same shape
as [05](./05-di-metadata-and-packaging.md) §M4, where the barrel and the real consumer surface
disagreed: a DI token naming a type that the package does not publish is a token nobody outside the
package can write a provider for.

### F3 — a rename migration could not be reversed

`changePropertyOfEntity` takes `oldProperty: keyof T | string & {}` — deliberately open, because the
name a migration renames *away from* is by definition not on the class any more. Its `newProperty.name`
was `keyof T` only. So `up()` typechecks and the `down()` that puts the old name back cannot be
written at all, which is exactly the asymmetry `docs/data-source.md`'s migration example runs into.
Both implementations already did `String(newProperty.name ?? oldProperty)`, so only the type was
wrong. Widened to match `oldProperty`, keeping the `keyof T` half so the entity's own properties are
still offered.

### F4 — the framework compiles against an empty event map

Found by the user running `npm run build -w zibri` after the round was reported green. Removing the
event service's type parameter left the internals keyed on `keyof ZibriEventMap`, including
`subscriptionForEvent: Record<keyof ZibriEventMap, …>`. **An empty interface has `keyof` of `never`,
so that is `Record<never, …>`, which has no key that can be read** — three errors, none of which
`tsc -p tsconfig.json` reports.

The reason it hid is worth more than the fix. `tsconfig.json` compiles `src` *with its tests*, and
three test files merge into `ZibriEventMap` to have events to subscribe to — so under the check this
project runs after every change, the map is never empty. `tsconfig.cjs.json` starts from
`files: ["src/index.ts", …]` and sees only what the barrel reaches, which is the framework as an
application gets it: map empty, `keyof` `never`. **The build is the only compilation that asks the
question the type was designed around.** It is in the verification block in
[README.md](./README.md#the-rework) now.

The fix keys the in-memory index by the type's *name* — `Map<string, Set<EventSubscription>>` — which
is what the runtime uses anyway: `emit` persists `String(type)` on the `Event` row, so the index and
the stored event now agree on what a type is, and the `{} as Record<…>` cast the field needed is
gone. The public signatures keep `K extends keyof ZibriEventMap`, so an application that declares no
events still cannot call `emit` — which is correct, and is the whole point of the interface.

---

## Part 2 — Missing documentation

`docs/` contains 32 files. An enterprise evaluator will look for the following and find nothing.

### Operations and deployment

- ~~**Deployment.** No Dockerfile guidance, no Kubernetes manifests, no readiness/liveness probe
  documentation (there are no such endpoints — [02](./02-http-runtime-core.md) §C3), no graceful
  shutdown or `terminationGracePeriodSeconds` guidance.~~ **Mostly closed.**
  [`docs/deployment.md`](../packages/zibri/docs/deployment.md) is the page, and it describes a shape
  that now exists rather than one a reader has to assemble: `zi new` writes the Dockerfile, and the
  probe endpoints the parenthesis said were absent are a generated controller — see
  [06 §C4](./06-tooling-ci-and-testing.md) for both, and [05 §P6](./05-di-metadata-and-packaging.md)
  for the four-folder layout the page opens with. The page covers the probes, the shutdown window
  they signal through, and why the stop signal has to reach node rather than a shell. **Kubernetes
  manifests stay absent on purpose**: a manifest is a deployment's own, and what the framework owes
  it is the two endpoints to poll and the shape of the image, which is what the page gives.
- ~~**Horizontal scaling.** Nothing. This is the single most consequential omission in the
  documentation set: the framework is single-instance by construction and no document says so.~~
  **Closed.** [`docs/replication.md`](../packages/zibri/docs/replication.md) is that document: what
  running more than one instance requires, what coordinates through the shared data source, and why
  the failures are quiet ones.
- ~~**Configuration and secrets management.** No environment-variable convention, no config schema,
  no guidance on where `JWT_ACCESS_TOKEN_SECRET` or `ENCRYPTION_MASTER_OPTIONS` should come from.~~
  **Answered by [06 §C4](./06-tooling-ci-and-testing.md).** The literal this bullet names was not a
  convention for where a secret comes from — it was the secret, hardcoded in the scaffold and
  published with the cli. A generated project reads its configuration from the environment now,
  `.env.example` is the convention, and `docs/getting-started.md` has the section. What is still
  missing is the *schema* half, an open bullet below.
- ~~**Connection pooling and database sizing.** `poolSize` defaults to 100
  ([01](./01-data-layer.md) §M7) and is never mentioned.~~ **Closed**: `docs/replication.md` states
  it, and states the thing that makes it a trap — the pool is per process, so what the database sees
  is the size times the replica count.
- ~~**Runbooks / troubleshooting.** Nothing on what to do when a cron job has been auto-disabled by
  `stopOnError` ([04](./04-infrastructure-subsystems.md) §2.1), which is a manual-recovery
  situation the framework creates by default.~~ **Closed for this case**: `docs/cron.md` says what
  `STOPPED_ON_ERROR` means, that it is a halt rather than a backoff, and that the job comes back at
  the next start. A runbook section as such is an open bullet below.
- **Configuration schema.** *Open, filed on 2026-10-15 from the configuration bullet above.* A
  generated project reads its configuration from the environment, and nothing validates a variable
  beyond it being present: a port that is not a number or a url that is not one fails wherever it is
  first used. Neither the docs nor the scaffold say how to describe and check one.
- **Runbooks.** *Open, filed on 2026-10-15 from the bullet above.* What to do when a cron job stopped
  on error, a backup was refused as interrupted, a restore could not be undone, an event failed, or a
  lease is held by an instance that is gone: each page states its own case, and no page gathers them
  for whoever is on call.

### Security

- ~~**Security hardening guide.** `cors` is a real application option now
  (`ZibriApplicationSecurityOptions`) rather than a middleware hardcoded to `*`, but no page
  documents it. Still nothing on TLS, `trust proxy`, or security headers beyond HSTS.~~ **Closed
  (2026-09-28), and most of it was stale.** `docs/app-settings.md` already covered CORS, the headers
  set on every response, HSTS and `trustProxy`. TLS now has a section in `docs/deployment.md`:
  it is terminated in front of the application, and `trustProxy` is what makes a forwarded https
  request count as one.
  **What was actually missing was the content security policy, and documenting it found three
  defects.** CSP had no page and no test, even though every html response and every svg file
  carries one.
  - **A cached page handed every visitor the same nonce.** The nonce was chosen when the page was
    rendered and written into both the script tag and the header. The caching example in
    `docs/caching.md` keeps the whole `HtmlResponse`, so one nonce was served for as long as the
    entry lived, although a nonce is only worth anything while it is new. The router now adds the
    request's own nonce to `script-src` as each response is written. A response keeps the nonce it
    was rendered with, and a string body has that one swapped for the new one.
  - **One directive silently blocked the framework's own script.** A response naming `scriptSrc`
    replaced the default's value, the request's nonce included, so the script
    `TsxUtilities.renderPage` injects stopped running with nothing reported. A named directive
    still replaces the default's (the user's choice), but the nonce is always added.
  - **The svg warning was inverted.** It warned "not of type svg" for exactly the svg files and
    never for the other files it describes.

  App-wide CSP was configured by replacing a `transient` DI factory that had to re-read the nonce
  itself. It is `DEFAULT_CSP_OPTIONS_INPUT` → `DEFAULT_CSP_OPTIONS` now, the same Input/Options
  pair the http client and localization use. The user chose that over moving CSP into
  `security.headers`. `routing/router.csp.test.ts` covers the whole path container-free in 8
  cases, and the cache case was red with only the body rewrite disabled.
  **A fourth came out of the nonce rule itself and is fixed too**: a browser that finds a nonce in
  `script-src` ignores `'unsafe-inline'` there, so adding one forbade the inline scripts a response
  allowed. A `script-src` listing `'unsafe-inline'` gets no nonce now, since the framework's script
  already runs under it.
- ~~**Threat model / secure defaults.** No statement that routes are open by default.~~ **Closed by
  removing the default**: `defaultAuth` is a required application option, so an application states
  what an unannotated route does rather than inheriting "open" from a document that never said so.
- ~~**Token lifetimes.** The 100-day refresh-token default is documented nowhere.~~ **Closed**:
  `docs/auth.md` documents the lifetimes and, more usefully, when to drop a rotated secret relative
  to them.
- ~~**`docs/auth.md` is 90 lines and omits**: `CookieAuthStrategy`, CSRF, 2FA and `@Auth.require2fa`,
  token lifetimes, secret configuration, the password-reset flow, rotation semantics, and the
  multi-strategy identity-mismatch hazard that line 36 actively recommends. Its "Key exports" table
  omits `Auth`, `CookieAuthStrategy` and `TwoFactorService` entirely.~~ **Closed**: `docs/auth.md` is
  563 lines and covers each of those, with `docs/two-factor.md` alongside it for the second factor.

### Observability

- Correlation ids are **closed**, by being replaced: a trace id is carried on every entry written
  while handling a request, continued from the caller's `traceparent` when one arrived, returned as
  `traceresponse` and repeated in a failed request's body — and `docs/logging.md` says so. Tracing
  has `docs/tracing.md` of its own. **Open**: still nothing on log aggregation or metric label
  cardinality ([02](./02-http-runtime-core.md) §C2).

### Lifecycle and change management

- ~~**Upgrade guides.** No migration path between major versions.~~ **Closed (2026-10-01).**
  `docs/upgrading-to-3.md`, one page per major. On the user's call it leaves out everything the
  compiler reports and covers only what compiles and still breaks, found by diffing the 2.5.0 and
  3.0.0 barrels and framework entities and by compiling the 2.5.0 sandbox against 3.0.0: number
  columns that `synchronize` drops and re-adds, new required columns, unique constraints renamed and
  added, refresh and reset tokens now hashed, OTP secrets now encrypted, bcrypt no longer a default
  strategy, optional peers no longer auto-installed (`pg` was a dependency), cron read in UTC, request
  limits, the `findAll` cap, the trace header, route labels. The schema and data part is not prose but
  **a migration to copy**, which needed helpers that did not exist and found four defects on the way:
  - `changePropertyOfEntity` dropped and re-added a column on a type change (typeorm's answer), and
    could not rename at all - it looked the old name up on the class, which only has the new one.
  - Migrations could not encrypt or hash: the services loaded their strategies in `onAppInit`, after
    migrations run. They load on first use now; an encryption strategy says `usableInMigrations`.
  - `BackupEntity.formatVersion` was a constant default, so adding the column labelled every 2.x
    backup as the format 3.0.0 reads.
  - `docs/getting-started.md` listed 7 of the optional peers too few.
  The helpers (`addPropertyToEntity`, `changePropertyOfEntity` with typed value conversion,
  `removePropertyFromEntity`, `createEntity`, `add/removeUniquesOfEntity`) never read the entity
  class, since a migration keeps running after the class changed; each part is written out or
  `'resolveFromEntity'`.
- ~~**Breaking-change policy.** No stated stability guarantees, no public-vs-internal API boundary.~~
  **Closed (2026-09-29)**: `docs/releases.md` - semver over each package's entry points, a
  deprecation for at least one minor before a removal, fixes for the newest major only. The release
  can switch to maintaining an older one without a change to it: a `release-<major>` branch
  publishes under `latest-<major>` and leaves the docs site and GitHub's "latest" alone.
- ~~**Changelog.** None.~~ **Closed** with [06](./06-tooling-ci-and-testing.md) §CD5: a root
  `CHANGELOG.md`, a section per version, and a release that refuses to publish without one.

### Performance

- ~~No benchmarks, no performance tuning guide, no documented complexity for `updateAll` /
  `deleteAll` (which materialize the full result set — [01](./01-data-layer.md) §M3), and no
  warning that ValKey `findAll` is an in-process full scan (this one *is* documented, at
  `docs/data-source.md:103-105` — a good counter-example).~~ **Closed (2026-10-01)**: `docs/costs.md`
  states what holds on every data source - a fixed number of round trips per call, `stream` paging,
  relations read once per result, the bounds, `deleteAll` holding what it deletes, bound encryption
  writing per row - and one table per shipped data source, the single place the docs name one,
  which is checked against measured counts. Benchmarks are [06](./06-tooling-ci-and-testing.md) §CI3.

### Developer experience

- ~~**Testing your own application.** Nothing at all — and the framework's own harness is not
  exported.~~ **Closed**: the harness is the `zibri-testing` package and `docs/testing.md` describes
  it. See [06](./06-tooling-ci-and-testing.md) §T2–T3; §T1's residue is two `readonly` casts.
- ~~**`docs/di.md`** never mentions scopes, circular dependencies, construction order, async
  providers, or the `emitDecoratorMetadata` toolchain constraint.~~ **Closed**: it covers each of
  them, including what a request scoped value does outside a request and what a cycle's error
  message looks like. The toolchain half closed separately and larger than this bullet frames it —
  the constraint is stated as a *requirement*, in `docs/getting-started.md` where a reader picks a
  toolchain, with the two injection styles and which compilers support each; see
  [05 §M1](./05-di-metadata-and-packaging.md).
- ~~**Architecture overview.** There is no document explaining how the pieces fit together —
  lifecycle hooks, DI, routing, request context — which is the first thing an architect asks for.~~
  **Closed (2026-10-01)**: `docs/architecture.md`, second in the published order after getting
  started. It holds no detail of its own - each section is the shape of one piece and a link to the
  page that has it: the options an application is made of, the container every framework service is
  replaceable in, what the framework does in each lifecycle step, a request's path from the pipeline
  phases through the router's steps to the error handler, the one `@Property` declaration that
  validation, OpenAPI, storage and the http client all read, the repository between a caller and a
  data source, and the work that runs outside a request under a lease. Written from the code rather
  than from the other pages: the router's order (version, access check, `Accept`, parameters,
  deadline, declared responses) and the boot order (data sources in `beforeAppInit`, routes
  registered in `onAppInit` and mounted in `onAppStart`) are read off `router.ts` and
  `application.ts`.

---

## Part 3 — What the documentation does well

Worth preserving, because the structure is genuinely better than most frameworks of this size:

- **Every doc has a "Key exports" table** mapping name → kind → purpose. This is a good pattern and
  is applied consistently.
- **Every doc has a "See also" section** with real cross-links, so the set reads as a graph rather
  than a pile.
- **Examples are concrete and file-pathed** (`// src/services/test.service.ts`), so a reader knows
  where code belongs — and, since this round, every one of them compiles against the framework's own
  source on every test run.
- **`docs/data-source.md`'s "Differences to a sql data source"** is exactly the kind of honest,
  specific limitations section the rest of the documentation needs — it states the ValKey in-process
  filtering, the non-isolated transactions, and the relation-resolution cost plainly. The gap it
  named is closed: the same candour now covers replication (a page of its own), `schemaManagement`
  (a required option with a table saying when each value is right), and going back past a migration
  (a section saying why booting refuses to revert and what the deliberate way back is).
