# What Is Genuinely Good

This review is deliberately adversarial — the brief was to find reasons a large company would say
no. That framing understates the quality of a lot of the work, so this file states it plainly. It
also matters practically: several Tier-1 blockers are one decision away from being fixed *because*
the surrounding design is sound.

---

## Architecture and lifecycle

**Shutdown phase ordering is correct.** `src/application.ts:264-268` closes the HTTP server
*before* running `beforeAppShutdown` hooks, so data sources stay alive while requests drain. A
surprising number of mature frameworks get this backwards and tear down the database while
in-flight requests still need it. Per-hook timeouts and per-hook error isolation
(`Promise.all` plus individual try/catch, `:309-361`) are well designed.

**The application state machine is compile-checked.** `GlobalRegistry` uses exhaustive switches
over `AppState`, so invalid lifecycle transitions are caught by the type checker rather than
guessed at runtime.

**Fail-fast boot validation.** Route and version collision detection (`src/routing/router.ts:166-190,
348-404`) produces precise messages naming the conflicting versions; orphaned-controller detection
(`:136-149`) catches a real and common registration mistake; `validateEntitiesRegistered` and the
`allowDuplicate` / `allowOrphan` entity-ownership model
(`src/data-source/entity-ownership.function.ts`) turn a class of silent misconfiguration into a
startup error. The philosophy in `docs/data-source.md:182-183` — *"silently writing to the wrong
store is worse than not starting"* — is exactly right.

**AsyncLocalStorage request context.** `src/context/als.utilities.ts` is a clean implementation with
correct copy-on-write nesting for cache contexts (`:70-74`).

---

## Input handling

**Streaming body-size enforcement is done properly.** `src/parsing/json/json.body-parser.ts:66-84`
checks `Content-Length` *and* accumulates actual bytes, so a lying header cannot bypass the limit.
Multipart goes straight to disk rather than buffering in memory. This is the correct design and it
is not universal.

**Internal errors are masked by default.** `src/error-handling/error.utilities.ts:17-22` returns a
generic `InternalServerError` rather than leaking internals — the right default, applied
consistently. (The auth subsystem then opts back into verbose messages, which is the finding in
[03](./03-auth-and-security.md) §G2, but the framework default is correct.)

---

## Data layer design

**The where-filter DSL is fully typed against the entity.**
`src/data-source/models/where/where-filter.model.ts` maps each property type to its own filter
shape (`StringWhereFilter`, `NumberWhereFilter`, `ObjectArrayWhereFilter`, …) via conditional
types. Filtering on a `Date` field cannot accept `iLike`. This is genuinely better ergonomics than
most TypeScript ORMs offer.

**The JSONB filter support is ambitious and mostly correct.**
`PostgresTypeOrmWhereFilterConverter` handles nested object filters, array-element `EXISTS`
subqueries, relation-count subqueries, and many-to-many junction resolution. The SQL-construction
approach is the problem ([01](./01-data-layer.md) §C5), not the feature design.

**Entity ownership across multiple data sources** (`allowDuplicate`, `repositoryTokenFor`,
`@InjectRepository(Entity, DataSource)`) is a well-thought-through solution to a real problem that
most frameworks simply do not address.

**One decorator for ORM + validation + OpenAPI.** The `@Property.*` design genuinely removes the
triple-annotation boilerplate that NestJS requires. This is the framework's best single idea.

---

## Feature ambition

Several features are things enterprises actually want and rarely get from a framework:

- **Change sets** — automatic who/what/when tracking with rollback and reset semantics, including
  `rollbackToTimestamp` and per-change-set reset. The concurrency and atomicity gaps
  ([01](./01-data-layer.md) §M10–M12) are fixable; the design is right.
- **Encryption and hashing as property flags** — `@Property.string({ encryption: true })` with
  per-request strategy resolution is a genuinely elegant API for something usually done by hand.
- **XLIFF localisation with build-time extraction** — standards-based rather than bespoke.
- **API versioning wired into both migrations and endpoint resolution** — most frameworks treat
  versioning as a routing concern only.
- **Typed Handlebars inference** — a custom parser that infers the data shape a template requires
  is a real DX win, whatever its maintenance cost ([06](./06-tooling-ci-and-testing.md) §X3).
- **The invoicing plugin implements EN16931/XRechnung/Peppol conformance** — that is serious,
  unglamorous work most projects never attempt.

---

## Testing

**The test suite tests the real thing.** `startTestServer`
(`src/__testing__/test-server/start-test-server.function.ts`) boots an actual `ZibriApplication`
against real Postgres and Valkey testcontainers, on an ephemeral port, with real HTTP and real
websocket clients. Mocking is minimal. CI installs a real `postgresql-client-17`. The `reInit`
helper handles the awkward case of reconfiguring an app between tests while keeping containers
alive, and both `startTestServer` and `reInit` correctly tear down containers on a failed `init()`
(`:136-144`, `:209-219`) — a cleanup path most harnesses forget.

The problems here are that this asset is not exported ([06](./06-tooling-ci-and-testing.md) §T2)
and that it needs private-field access to work ([06](./06-tooling-ci-and-testing.md) §T1) — both of
which are *symptoms* of missing public API, not of a bad test strategy.

**Coverage is merged across split runs.** The `test:coverage:normal` / `:heavy` / `:merge` pipeline
using `nyc merge` is a careful solution to running `--runInBand` performance tests separately
without losing coverage data.

---

## Documentation structure

Covered in [07](./07-documentation-vs-code.md) Part 3: consistent "Key exports" tables, real
"See also" cross-links, file-pathed examples, and — in
`docs/data-source.md:100-116` — a genuinely candid limitations section that should be the template
for the rest.

---

## The overall read

The pattern across this entire review is consistent:

> **The design work is strong. The multi-process and adversarial-input dimensions are largely
> unexplored.**

Nearly every Tier-1 blocker is a single architectural decision, not a rewrite:

| Blocker | The fix |
|---|---|
| Cron fires on every replica | Pass `distributed` / `runCoordinator` to `cron.createTask` — the option already exists in the dependency |
| WebSocket broadcasts reach 1/N | Add a socket.io Redis/Valkey adapter — `@valkey/valkey-glide` is already a dependency |
| Mail queue sends N copies | `FOR UPDATE SKIP LOCKED` plus a `SENDING` state |
| Migrations race across replicas | One `pg_advisory_lock` |
| `synchronize` destroys columns | Flip the default to opt-in |
| CORS is `*` | One option on `ZibriApplicationSecurityOptions` |
| Routes open by default | One default-deny switch plus a boot-time warning listing unprotected routes |
| Every 5xx logs as "Global Error" | Stop nulling `globalError.stack` |
| Metrics OOM | Use `req.route?.path` first instead of `req.originalUrl` |

That list is a plausible quarter of work, not a rearchitecture. The items that genuinely require
redesign are the enterprise identity layer ([03](./03-auth-and-security.md) §H), the DI request
scope ([05](./05-di-metadata-and-packaging.md) §D2), and access-token revocation
([03](./03-auth-and-security.md) §A3).
