# Executive Summary — round 2

What a second due-diligence review finds in the tree the first round's rework produced. Grouped by
theme rather than by chapter, each entry linking to its finding. The one-table index of everything
this round filed is [10-whats-open.md](./10-whats-open.md).

---

## Verdict

The first round's six rejection grounds have closed as such: the framework coordinates across
instances, refuses the data-destroying defaults, carries enterprise identity, logs what it does and
drains on shutdown. What this round finds is of a different kind. Almost nothing here is a missing
subsystem; nearly everything is a subsystem that exists and has a hole in it that only shows up
against a real provider, a second instance, a production database, or a developer trying to build
something the sandbox does not.

Three findings are independently sufficient to reject, each small to fix:

1. **The built-in Google sign-in refuses every real Google user**, and the Microsoft one every
   Entra registration that was not told to add a claim, because the OIDC base demands `auth_time`
   in every ID token and the only test provider always issues it ([05 §I1](./05-identity-providers.md)).
2. **One multipart request ends the instance**: a file part named after an `Object.prototype`
   member throws inside a stream listener and nothing catches it ([03 §H1](./03-http-runtime-core.md)).
3. **The where language has four evaluators and the one deciding whether a write is allowed is not
   the one answering reads**, with no conformance test holding them together
   ([09 §Q3](./code-review/09-architecture-and-code-quality.md)). A structural CRITICAL rather than a live one:
   the class of bug the first round kept finding, still with nothing to stop the next instance.

Beneath those, the themes below each fail a standard enterprise review on their own. The first two
are the ones to lead with.

| Chapter | CRITICAL | MAJOR | MINOR | Quality items |
|---|---|---|---|---|
| [01 repository](./01-data-layer-repository.md) | 0 | 6 | 7 | 7 |
| [02 stores](./02-data-layer-stores.md) | 0 | 10 | 9 | 7 |
| [03 http runtime](./03-http-runtime-core.md) | 1 | 4 | 14 | 9 |
| [04 auth core](./04-auth-core.md) | 0 | 5 | 11 | 5 |
| [05 identity providers](./05-identity-providers.md) | 1 | 4 | 6 | 6 |
| [06 infrastructure](./06-infrastructure.md) | 0 | 11 | 14 | 9 (one MAJOR) |
| [07 di, packaging, tooling](./07-di-packaging-tooling.md) | 0 | 6 | 9 | 5 |
| [08 docs and dx](./08-docs-and-dx.md) | 0 | 16 (+4 table rows) | 9 (+19 rows) | |
| [09 architecture](./code-review/09-architecture-and-code-quality.md) (in [code-review/](./code-review/)) | 1 | 5 | 7 | |

---

## 1. The entity layer's authorization has doors around it

The first round moved row-level access from a route decorator to the entity and its repository, so
that a list handler's query is narrowed by what the caller may see. This round finds the paths that
do not pass through that narrowing:

- ~~**A row read through a relation is never narrowed by its own entity's scope** on either store,
  and the write side never checks a foreign key against the target's scope~~ **fixed**: every entity
  a call reaches through a relation is narrowed to the rows the caller may see, on every store and
  at every level, and a write pointing at a hidden row is refused ([01 §D1](./01-data-layer-repository.md)).
- ~~**Soft-deleted rows come back through relations and nested filters**; no `deleted` condition
  exists anywhere below `SoftDeleteRepository`~~ **fixed** with §D1 ([01 §D2](./01-data-layer-repository.md)).
- **`create` with `allowId` on an existing id is a save** past the update-side scope judgement,
  the tenant-move refusal and optimistic locking, while the docs promise a row "created with it"
  ([01 §D3](./01-data-layer-repository.md)).
- **The documented custom-repository pattern silently drops soft deletes and change sets**: the
  wrapper takes only the inner repository's driver, so `class UserRepository extends Repository<User>`
  over an injected soft-delete repository makes deleted users findable ([01 §D6](./01-data-layer-repository.md),
  [08 §X16](./08-docs-and-dx.md)).
- The scope decision itself runs on the in-process evaluator for writes and on SQL for reads
  ([09 §Q3](./code-review/09-architecture-and-code-quality.md)).

→ [01](./01-data-layer-repository.md), [09 §1](./code-review/09-architecture-and-code-quality.md)

## 2. Federation that does not survive contact with the providers it names

Every identity feature the first round asked for was built. Against the providers an enterprise
actually runs, the gaps are:

- Google and Entra sign-ins refused ([05 §I1](./05-identity-providers.md), CRITICAL).
- An OIDC or SAML sign-in hands the application an email and a name and nothing else: no claims, no
  groups, no hook on a later sign-in, so provider roles cannot drive admission and a SCIM-provisioned
  user is joined to a federated identity only by unverified email ([05 §I2](./05-identity-providers.md)).
- Entra's pairwise `sub` means a mobile app's token never matches the web sign-in's identity
  ([05 §I3](./05-identity-providers.md)); a multi-tenant Entra registration cannot sign anyone in ([§I7](./05-identity-providers.md)).
- No OpenID Connect logout propagation of any kind, while SAML single logout was built in full
  ([05 §I4](./05-identity-providers.md)).
- The provider's MFA is invisible, so every `@Auth.require2fa` route re-enrols a user whose
  identity provider already enforced it ([05 §I5](./05-identity-providers.md)); and in the other
  direction **a login cannot be gated on a second factor at all**, and the planned "only if enrolled"
  option cannot work where the check is written ([04 §A1](./04-auth-core.md)).
- Container suites for client certificates behind nginx and Envoy, the Keycloak mobile token and
  the directory second round are still unrun, so those claims rest on in-memory fakes ([05](./05-identity-providers.md), Not reviewed).

→ [05](./05-identity-providers.md), [04 §A1](./04-auth-core.md)

## 3. Account security

- **Refresh rotation treats the ordinary multi-tab sequential refresh as credential theft**, logs the
  user out everywhere and raises a false token-reuse alert ([04 §A2](./04-auth-core.md)).
- **Password login has no per-account bound**; the only limiter is per address, in memory, per
  instance, and counts successful logins, so a corporate NAT shares twenty logins per ten minutes
  while distributed stuffing against one account is unbounded ([04 §A3](./04-auth-core.md)).
- The auth limiter keys IPv6 per address and a full store answers 503 to every newcomer, so one
  /64 locks everyone out of `/login` ([04 §A4](./04-auth-core.md)).
- **A logout that revoked nothing is audited as a success**, and no logout names its user: a
  regression of the audit trail the first round built ([04 §A5](./04-auth-core.md)).
- Access-token revocation and user revalidation are silent security defaults ([04 §A6](./04-auth-core.md));
  the reset request is a timing oracle ([§A7](./04-auth-core.md)); deleting a user leaves sessions,
  refresh tokens and api keys behind ([§A10](./04-auth-core.md)); roles have no inheritance, so every
  new permission needs a data migration before anybody passes its routes ([§A12](./04-auth-core.md)).

→ [04](./04-auth-core.md)

## 4. Multi-instance correctness, second round

The claims and leases exist. What a second instance still breaks:

- **A lease holder never learns its grant lapsed**, so a store outage longer than one lease
  duplicates every running thread job and event hook ([06 §F1](./06-infrastructure.md)); a cron run
  outliving its never-renewed five-minute grant is run again by the next pod that boots with
  catch-up set ([§F2](./06-infrastructure.md)).
- **The event poll pages the oldest fifty `CREATED` events without excluding the ones in retry
  backoff**, so fifty retrying events stall every event behind them; invisible on one tier, fatal on
  the documented web/worker split ([06 §F3](./06-infrastructure.md)).
- **An abandoned postgres transaction never finishes while a valkey one does**, so a `heldUntil`
  lease on postgres renews for the life of the process ([02 §S10](./02-data-layer-stores.md)).
- **One failed read of the pub/sub channel and an instance stops hearing the others for good**:
  broadcasts, response waits and ended-login notices are all lost on that instance
  ([02 §S11](./02-data-layer-stores.md), [03 §H18](./03-http-runtime-core.md)).
- A shutdown never finishes while one websocket client is connected ([03 §H2](./03-http-runtime-core.md));
  a mail attachment is a path on the queueing instance's disk and any instance may send it
  ([06 §F6](./06-infrastructure.md)); nothing carries an instance identity, `Lease.heldBy` being the
  shared application name ([§F12](./06-infrastructure.md)).
- The coordination polls fan out per instance: on the order of 150-200 queries per second against
  the primary at fifty idle instances, on tables declaring no index ([06 §F10](./06-infrastructure.md), [§F4](./06-infrastructure.md)).
- **The cluster and evaluation suites that hold all of the first round's Tier-1 fixes never run in
  CI** ([07 §T1](./07-di-packaging-tooling.md)).

→ [06](./06-infrastructure.md), [02 §S10](./02-data-layer-stores.md), [07 §T1](./07-di-packaging-tooling.md)

## 5. Operating the database

- **A restore drops every object in the schema**, whoever owns it, and nothing checks the schema
  holds only this data source's tables ([02 §S1](./02-data-layer-stores.md)).
- **Any index or constraint named `IDX_*` or `UQ_*` on an entity table is dropped at boot** with no
  log line, so a DBA's hand-made index disappears on the next deploy ([02 §S2](./02-data-layer-stores.md)).
- The docs recommend a connection pooler, and the data source's session-level state (statement
  timeout, trigram threshold, the schema advisory lock) breaks under transaction pooling
  ([02 §S3](./02-data-layer-stores.md)).
- Unique-violation and mistyped-value detection parse the server's **English** messages
  ([02 §S4](./02-data-layer-stores.md)); a serialization failure or deadlock is an untyped 500 nothing
  can retry, with no savepoints ([§S5](./02-data-layer-stores.md)).
- A valkey backup is a key walk rather than a snapshot and restores no index ([02 §S6](./02-data-layer-stores.md));
  a restore ignores migrations, key reconciliation and the other instances ([§S7](./02-data-layer-stores.md));
  the S3 transport takes static keys only ([§S8](./02-data-layer-stores.md)); valkey is standalone-only
  and the docs do not say so ([§S9](./02-data-layer-stores.md)); migrations have no checksum, generator
  or operator entry point ([§S14](./02-data-layer-stores.md)).
- A page costs six round trips and a `REPEATABLE READ` transaction ([01 §D4](./01-data-layer-repository.md)),
  and every transaction three to four statements before any work ([02 §S19](./02-data-layer-stores.md)):
  the user's "six round trips" item, explained.

→ [02](./02-data-layer-stores.md), [01 §D4](./01-data-layer-repository.md)

## 6. Observability and the audit trail

- **Every log entry of a request records the url with its query string**, so the mailing-list
  secret, subscribe tokens and OAuth codes land in the log table and the mail digest
  ([06 §F7](./06-infrastructure.md)).
- **The audit trail rides the ordinary log pipeline**, where it is the first thing dropped under
  buffer pressure and the first thing collapsed past the rate ([06 §F25](./06-infrastructure.md)).
- The uncaught exception that ends the process is the one log line never written, since nothing
  flushes the buffered logger on exit ([03 §H3](./03-http-runtime-core.md)).
- The background subsystems expose no metrics, so a stuck queue is invisible until a customer
  notices ([06 §F9](./06-infrastructure.md)); enrolling or removing a second factor is unaudited ([04 §A8](./04-auth-core.md)).

→ [06 §F7, §F9, §F25](./06-infrastructure.md), [03 §H3](./03-http-runtime-core.md)

## 7. Availability

The multipart crash ([03 §H1](./03-http-runtime-core.md)); a thread job that kills its host is taken
over and re-run without limit, by workers without resource limits ([06 §F5](./06-infrastructure.md));
the http client reads a non-ok body unbounded, a regression on the error path ([06 §F8](./06-infrastructure.md));
the full-store 503 on the auth limiter ([04 §A4](./04-auth-core.md)).

## 8. The cost of adopting and staying adopted

- **A generated project has no upgrade path**: 52 framework-coupled templates and about 1,600 lines
  of configuration are copied into user space once ([07 §T5](./07-di-packaging-tooling.md)).
- **`zibri-testing` cannot be loaded without `testcontainers` installed**, so a project generated
  from the registry fails at `npm test` ([07 §T2](./07-di-packaging-tooling.md)).
- The template compiler and translation extractor pin the application's TypeScript major
  ([07 §T6](./07-di-packaging-tooling.md)).
- Two DI promises the docs make do not hold: the request-scope capture check reads only the top
  construction frame, so an application-scoped service first built under a request keeps that
  request's tenant for the life of the process ([07 §T3](./07-di-packaging-tooling.md)); the
  documented field-initializer `inject()` of an async provider fails at boot with a misleading error
  ([§T4](./07-di-packaging-tooling.md)).
- What the repository cannot say: aggregates, projection, a raw query, an increment outside
  `upsert`, with a protected typeorm handle as the only escape ([01 §D5](./01-data-layer-repository.md)).
- A single-valued array query parameter is a 400 while the OpenAPI document promises the standard
  form ([03 §H4](./03-http-runtime-core.md)); a plugin cannot ship websocket controllers, two-factor
  methods, data sources or backup transports ([§H13](./03-http-runtime-core.md)).

→ [07](./07-di-packaging-tooling.md), [01 §D5](./01-data-layer-repository.md), [03](./03-http-runtime-core.md)

## 9. Developer experience and the documentation

The maintainers' first priority, and the chapter to read in full ([08](./08-docs-and-dx.md)).

- **The first example on 18 of 54 pages is unreadable**: the docs test merges imports per page, so
  the first block carries ten to twenty unused imports and imports of files that do not exist
  ([08 §X13](./08-docs-and-dx.md)). The test that guards the examples is what broke them.
- **About a third of the pages explain reasoning, history and store internals in an essay voice**,
  against the project's own documentation rule; the chapter quotes each and names the pages that are
  the standard to match ([08 §X8-X10](./08-docs-and-dx.md)). This is the user's own third bullet.
- Thirteen providers must be registered before a scaffolded application boots, and no page lists the
  124 tokens with type, default and whether they are required ([08 §X17, §X2](./08-docs-and-dx.md));
  33 framework entities are listed by hand with no page saying which feature needs which ([§X3](./08-docs-and-dx.md)).
- The scaffold is a web application with webpack, tailwind and a native dependency, with no API-only
  path ([08 §X14](./08-docs-and-dx.md)); every entity pays the tenant and base-class tax even in a
  single-tenant application ([§X15](./08-docs-and-dx.md)); a custom repository is six arguments of
  boilerplate ([§X16](./08-docs-and-dx.md)); a cron expression edited in code does nothing after the
  first boot, with no warning ([§X19](./08-docs-and-dx.md)).
- The public surface is the whole package, 968 exports under a semver promise ([08 §X20](./08-docs-and-dx.md),
  [07 §T16](./code-review/07-di-packaging-tooling.md), [09 §Q10](./code-review/09-architecture-and-code-quality.md));
  naming is consistent inside a subsystem and inconsistent across them, `_IN_MS` against `_MS`,
  `@Cache` against `@Cached`, positional transactions on services and an option on repositories
  ([08 §X21](./08-docs-and-dx.md), [09 §Q11-Q13](./code-review/09-architecture-and-code-quality.md)).
- No OpenAPI page, no validation page, no cross-field validator at all ([08 §X4, §X5](./08-docs-and-dx.md)).

→ [08](./08-docs-and-dx.md)

## 10. Architecture: what to restructure before many teams depend on it

The code review lives in [code-review/](./code-review/): one file per area holding that chapter's
quality items, and [09](./code-review/09-architecture-and-code-quality.md) as the cross-cutting
review with measurements. Its recommendations, in the order it makes them:

- **The repository is a five-deep forwarding stack** (60 forwarding methods, 55 lint disables) with
  role and membership policy at the storage seam, so a membership update is three reads and a write.
  Recommended: a framework-owned hook pipeline with one `afterWrite(before, after)` in place of the
  wrappers and the two near-duplicate reporters ([09 §Q1](./code-review/09-architecture-and-code-quality.md), [01 §Q2](./code-review/01-data-layer-repository.md)).
- **Replace typeorm with the framework's own thin layer over `pg`, incrementally, behind the driver
  seam the in-memory source already proves sufficient.** Typeorm today supplies the pool, a second
  copy of the metadata model, the simple half of `FindOptionsWhere`, `save` cascades and DDL
  helpers; upsert SQL, key and check reconciliation, column conversion, timeouts and cancellation,
  type parsing, json and array where, and error classification are all written beside it, and the
  options type is typeorm's. Confining it was weighed and costs about half the work for a third of
  the benefit. Order: reads and where-to-SQL, then writes and upsert, then DDL and migrations, with
  every shared `.cases.ts` run on the new store as a fourth runner ([09 §Q2](./code-review/09-architecture-and-code-quality.md), §1).
- **One where language, four semantics, no conformance test** ([09 §Q3](./code-review/09-architecture-and-code-quality.md)).
- **The persisted queue exists three times** (mail, thread jobs, events: three claim keys, three
  status enums, five or six copies of the backoff formula, three pollers), backups are a fourth
  without the pattern, and none of the polled tables declares an index. The user's own rule said the
  third copy is the trigger ([09 §Q5](./code-review/09-architecture-and-code-quality.md)).
- **The framework does not use its own event service**: subsystems call each other directly, two of
  them re-implement an after-commit bus, and user deletion, membership revocation and role changes
  are invisible to applications ([09 §Q6](./code-review/09-architecture-and-code-quality.md), [06 §Q4](./code-review/06-infrastructure.md)).
  Three polling buses where one notification system would do.
- **The data layer depends upward on auth and tenancy**, and `MetadataUtilities` (89 statics
  reaching ten directories) makes the lowest layer depend on everything; 118 mutual directory pairs.
  Recommended: an allowed-edges architecture test ([09 §Q9](./code-review/09-architecture-and-code-quality.md)).
- Seventeen of the twenty-five cron jobs are the same expired-row sweeper ([09 §Q8](./code-review/09-architecture-and-code-quality.md),
  [06 §Q9](./code-review/06-infrastructure.md), [05 §Q3](./code-review/05-identity-providers.md)); auth policy constants are
  hardcoded in one method and DI tokens in the next ([09 §Q7](./code-review/09-architecture-and-code-quality.md), [04 §A15](./04-auth-core.md), [05 §I9](./05-identity-providers.md)).
- Against CODE_STYLE: 29 `as never` and 34 `as Where<T>` casts in production code, nine published
  JSDoc blocks citing `evaluation/…` paths, three timeout primitives, and a JSDoc lint rule that
  produces 1,514 of the 2,011 disables ([09 §4](./code-review/09-architecture-and-code-quality.md)).

→ [09](./code-review/09-architecture-and-code-quality.md)

---

## The user's own list, mapped

Where each bullet of [after-all-findings-fixed.md](../after-all-findings-fixed.md) was assessed.

| Bullet | Where |
|---|---|
| 1 generic systems benefiting each other | [09 §Q5, §Q6](./code-review/09-architecture-and-code-quality.md), [06 §Q4, §Q9](./code-review/06-infrastructure.md), [05 §Q3](./code-review/05-identity-providers.md), [01 §Q2](./code-review/01-data-layer-repository.md) |
| 2 spreading recovery evenly | [06 §Q7](./code-review/06-infrastructure.md) (assessment, no finding) |
| 3 docs, evaluation files and comments mixed up | [08 Part 3](./08-docs-and-dx.md), [09 §4](./code-review/09-architecture-and-code-quality.md) |
| 4 thread jobs at-least-once | [06 §Q8](./code-review/06-infrastructure.md), with [§F1, §F5](./06-infrastructure.md) |
| 5 cron-driven delay, distributed flag | [06 §Q8](./code-review/06-infrastructure.md) |
| 6 database reads, `findAllPaginated` round trips | [01 §D4](./01-data-layer-repository.md), [02 §S19](./02-data-layer-stores.md), [06 §F10](./06-infrastructure.md) |
| 7 evaluation tests into the normal suite | [07 §T1](./07-di-packaging-tooling.md) |
| 8 partial backups, resume, retry | [02 §S16, §S7](./02-data-layer-stores.md), [09 §Q5](./code-review/09-architecture-and-code-quality.md) |
| 9 `startConnection`/`linkIdentity` rename | [05 §Q4](./05-identity-providers.md) |
| 10 auth error messages recheck | [04 §A16, §A7](./04-auth-core.md), [05](./05-identity-providers.md) Already filed |
| 11 `prom-client` deprecated | [06 §F22](./06-infrastructure.md), [07 §T13](./07-di-packaging-tooling.md) |
| 12 hardcoded auth constants | [04 §A15](./04-auth-core.md), [05 §I9](./05-identity-providers.md), [09 §Q7](./code-review/09-architecture-and-code-quality.md) |
| 13 `require2fa` only if enrolled | [04 §A1](./04-auth-core.md): cannot work where the check is written |
| 14 backups and migrations | [02 §S7](./02-data-layer-stores.md) |
| 15 `RestoreNotUndoneError` impossible | [02 §S17](./02-data-layer-stores.md): cannot be; what can is narrower |
| 16 auto link/unlink deleted entities | [01 §D12](./01-data-layer-repository.md) |
| 17 validate role and permission names at startup | [04 §A12](./04-auth-core.md): exists for routes, assessed there |
| 18 SSO permission conversion | [05 §I2](./05-identity-providers.md) is the prerequisite |
| 19 size and start time of a built app | [07 §T14](./07-di-packaging-tooling.md) |

---

## What this round did not reach

Each chapter ends with a *Not reviewed* list. The larger gaps: the SCIM filter grammar and SOAP
utilities, DPoP internals, passkey internals, encryption and hash internals, websocket auth, the
real-proxy behaviour of client certificates (container suites unrun), the body of `upgrading-to-3.md`,
the published typedoc output, and actually running `zi new`. Nothing was executed, so every
performance figure is a reading of the code with its Verify note as the measurement to take.
