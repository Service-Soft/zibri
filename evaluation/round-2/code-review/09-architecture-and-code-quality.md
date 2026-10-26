# Architecture and code quality — round 2

*Read-only review of `packages/zibri/src` on branch `v3` as of 2026-10-21, working tree included (167
modified and several untracked files; every cited file that is modified or untracked says so).*
Method: the data layer was read file by file (`repository.ts`, the five driver wrappers, both repository
subclasses, `typeorm.repository-driver.ts`, both data source models, the three where evaluators, the
in-memory driver in `packages/testing`); everything else was measured with grep/awk and then read where
a number needed a reason. Measured: lines per directory and file, a path-resolved import graph between
the 39 top-level directories (4,231 file-level cross-directory imports, 506 directory pairs), casts and
`any`, eslint-disables by rule, comment density and long comment runs, cron jobs, timers, lease call
sites, `claimKeyFor` copies, positional `transaction` parameters, `?? default` policy settings, exported
names, and the wiring of every shared `.cases.ts` file to the stores it runs on. Not read: `plugin/`
(6,117 lines), `open-api/`, `localization/`, `document/`, `tsx/`, `handlebars/`, and the bodies of
`auth/scim/*` and `websocket.service.ts` beyond what a grep hit pointed at. The typeorm usage census
below folds in the store-side reviewer's line-by-line list; the items I cite with line numbers I
re-read, the rest is attributed. Total: 126,555 non-test source lines, 35% of them comment lines.

---

## 1. The data layer's shape and the ORM question

### What a plain `findById` passes through

For a soft-delete entity on Postgres, one `findById(id)` runs through these framework frames before a
statement reaches `pg` (all paths under `packages/zibri/src/`):

| # | Frame | What it adds |
|---|---|---|
| 1 | `change-sets/soft-delete-repository.ts:107` `findById` | nothing, delegates; exists only to widen the options type (its own comment says so) |
| 2 | `data-source/repository/repository.ts:1762` `findById` *(modified)* | `withinTimeout`, composes `{id}` into the caller's `where` through `ScopeWhereUtilities.applyToWhere`, converts "not found" into `NotFoundError` |
| 3 | `soft-delete-repository.ts:98` `findOne` | adds the `deleted` filter |
| 4 | `repository.ts:1790` `findOne` | `withinTimeout` again, `scopedWhere` (:388) → `resolveRestriction` (:433) → `TenantUtilities.resolveRestriction` + `resolveEntityScope` (`scopes/resolve-entity-scope.function.ts:27`, *modified*: two `authService.getCurrentUser/getCurrentMembership` lookups, two `inject()`s), `FuzzySearchUtilities.validateSearchable`, `dropImpossibleConditions` (387 lines of its own filter semantics), `toDriverFindOptions` |
| 5 | `driver/deadline-aware.repository-driver.ts:53` | checks the request's abort signal |
| 6 | `driver/role-validating.repository-driver.ts:116` *(untracked)* | pure forward on reads |
| 7 | `driver/role-reporting.repository-driver.ts:68` *(untracked)* | pure forward on reads |
| 8 | `driver/membership-reporting.repository-driver.ts:79` | pure forward on reads |
| 9 | `driver/traced.repository-driver.ts:86` | a span |
| 10 | `driver/typeorm.repository-driver.ts:175` `findOne` | `resolveWhere` → `dataSource.whereFilterToFindOptionsWhere` → `PostgresTypeOrmWhereFilterConverter` (982 lines, *modified*) on top of `TypeOrmWhereFilterConverter` (577) |
| 11 | `typeorm.repository-driver.ts:989` `run` + `:858` `onConnection` (+ `whileLimited`, `whileCancellable`) | error translation, statement timeout, cancellation, a query runner taken out of the pool per statement when a request is active |
| 12 | typeorm `manager.findOne` → query builder → `pg` | the statement |
| 13 | back up: `beforeReturn` hook (`data-source/hooks/hooks.default.ts:18`) | decrypt, remove excluded properties |

Twelve framework frames, of which three (6–8) are no-ops for every entity that is not a role, user or
membership, and two (1, 3) exist to re-declare a type. On a write the same three wrappers stop being
no-ops and each performs its own read first: a `save` of a membership row issues `RoleValidating.save`
→ `inner.find` (`role-validating.repository-driver.ts:85`), `MembershipReporting.save` → `inner.find`
(`membership-reporting.repository-driver.ts:45`), and above them `Repository.updateById` →
`exists` (`repository.ts:2128`), so one update is three reads and one write before the reporting
callbacks run. The role-level decision (`resolveLevel`, `role-validating.repository-driver.ts:312`)
resolves `USER_SERVICE` and `MEMBERSHIP_SERVICE` through `inject()` on every write of every entity, and
`roleService` is a getter calling `inject()` per call (`:77`); the repository reviewer measured the
per-statement injection cost separately (round-2 01 §Q3) and the 6 round trips of a plain
`findAllPaginated` (01 §D4), so neither is re-filed here.

### Q1. The repository is a five-deep decorator stack carrying entity-specific policy in the generic layer — MAJOR
*Filed 2026-10-21.*

The wrappers are built once per repository at `repository.ts:248-259` as
`DeadlineAware(RoleValidating(RoleReporting(MembershipReporting(Traced(driver)))))`. Each implements all
twelve methods of `RepositoryDriverInterface` (`driver/repository-driver.interface.ts:102-276`) by
forwarding: 5 × 12 = 60 forwarding methods, 55 of them carrying `// eslint-disable-next-line
jsdoc/require-jsdoc`, ~990 lines in total, of which the actual behaviour is roughly 150. Adding a
driver method means editing six files (the interface, five wrappers) plus the three real drivers.

Three of the five wrappers are not cross-cutting at all. `RoleValidating`, `RoleReporting` and
`MembershipReporting` know the words `roles`, `level`, `tenantId`, `permissions`, `userId`
(`role-validating.repository-driver.ts:300`, `membership-reporting.repository-driver.ts:155`), read
them off untyped rows with `Reflect.get` (`:41-47`), and ask the auth and tenancy services which entity
they are wrapping. That is auth policy, written at the storage seam, in the generic data layer — and it
is why `data-source/` imports `auth/` 13 times and `tenancy/` 7 times (section 3). The header comments
give the reason (`role-validating.repository-driver.ts:65-67`: "every way a row is written reaches the
store through this seam, however the repository above it got there"), and the reason is right: a hook a
repository *can be given one of its own* (`beforeSave`/`beforeReturn`, injected through the constructor
at `repository.ts:241-242`) is not a seam the framework can rely on. But the conclusion drawn — wrap the
driver — is the expensive answer to "the repository has no framework-owned hook".

Responsibilities split across layers that belong together:

- **"What happened to which rows, after commit"** is computed twice, in two near-identical classes
  (`role-reporting.repository-driver.ts:129-162`, `membership-reporting.repository-driver.ts:146-180`):
  read before, write, diff, `transaction.afterCommit(handle)`, swallow and log. Both need the
  before-rows and both read them again; `RoleValidating` reads them a third time for its own check.
- **Scope on reads** lives in `Repository.scopedWhere` (SQL/filter side) while **scope on writes** is
  judged in-process by `WhereFilterEvaluator` (`repository.ts:223, 624, 644`) — one policy, two
  evaluators (see Q5).
- **Transactions** are opened in three places with the same try/commit/catch/rollback body:
  `repository.ts:2732-2751`, `typeorm.repository-driver.ts:815-833`, `val-key.repository-driver.ts:965`.
- **Timeouts** are applied per repository method (`withinTimeout`, 20+ call sites), then re-applied by
  the subclass on the same call (`change-set-repository.ts:96, 118`; the JSDoc at `repository.ts:2757`
  admits "the inner limit is then the same as the outer one").

**Recommended shape.** One `Repository` that owns an ordered pipeline of *framework* hooks, with the
driver doing only storage:

```
repository.find/write
  → policy hooks (tenant restriction, entity scope, soft-delete filter)   // compose the Where
  → beforeWrite hooks (defaults, encrypt, hash, role/membership validation)  // see the rows once
  → driver (traced, deadline-checked inside the driver's own `run`)
  → afterWrite(rows before, rows after, operation, transaction)             // one read-before, shared
  → afterReturn hooks (decrypt, exclude)
```

Concretely: (1) make `beforeSave`/`beforeReturn` lists the framework appends to rather than a single
function the data source hands in (`typeorm-base-data-source.model.ts:1063-1064` and the identical
`val-key-data-source.model.ts:670-671`); (2) add one framework-owned `afterWrite` hook that receives
`{ before: T[], after: T[], operation, transaction }` once, so `RoleReporting` and
`MembershipReporting` become two ten-line subscribers of it (and the cache-invalidation and websocket
tenancy code can subscribe to the same thing, see Q7); (3) fold `DeadlineAware` into the three drivers'
existing `run()` (the typeorm driver already has the abort signal in hand at
`typeorm.repository-driver.ts:862`); (4) keep `Traced` — it is the one genuinely cross-cutting wrapper —
or move the span into `run()` too. The soft-delete subclass then becomes a policy hook plus three option
types, and `ChangeSetRepository` an `afterWrite` subscriber that writes change sets in the same
transaction. Trade-off: hooks are less discoverable than a class per concern, and ordering has to be
stated once (a `priority` on the hook, or a fixed list in the repository) — which is a smaller thing to
hold than 60 forwarding methods. Alternative considered and rejected: a Proxy-based wrapper generator
would remove the 60 methods but keep the policy in the wrong layer.

The repository reviewer reached the same conclusion from the other side (round-2 01 §Q2: the five
wrappers and the two reporters are what one entity-write event would replace).

**Verify:** a test that counts frames (`new Error().stack` depth from a `beforeReturn` hook) and store
round trips through `RoundTripCounter` (`data-source/tests/repository-costs.cases.ts`) for `findById`,
`updateById` and a membership `save`, asserting ≤ 1 read before an update on a non-role entity; an
architecture test asserting no file under `data-source/` imports from `auth/` or `tenancy/`.

> **Closed 2026-10-26 (user's design: observers registered at boot; `DeadlineAware` and `Traced` stay
> wrappers).** Two parts of the recommended shape were already in place: the `ForwardingRepositoryDriver`
> base (01 code-review §Q2), and the hook lists under `REPOSITORY_HOOKS`. The three entity-specific
> wrappers are gone. One generic `WriteObservingRepositoryDriver` hands every write to the
> `EntityWriteObserver`s of its entity, which the services register in `onAppInit` with an
> `EntityWriteObserverRegistry` (internal, a provider per application, refusing a registration after
> `onAppInit`). An observer has a `validateWrite` before the write, a `handleWritten` once it is
> committed (logged, never failing the write), the `properties` it needs of an `updateAll` and the
> operations it `followsBefore`. The seam reads the rows a write changes once, shared by every
> observer. An entity nobody observes reads nothing and, once `onAppInit` is over, injects nothing.
> The rules moved to where they belong:
> - `RoleWriteObserver` in `auth/roles`;
> - `UserWriteObserver` in `auth/user`;
> - `MembershipWriteObserver` in `tenancy/membership`.
>
> `isRoleEntity` and `isMembershipEntity` were only asked by the wrappers and left the interfaces;
> `upgrading-to-3.md` no longer lists the latter. The chain is `DeadlineAware → WriteObserving →
> Traced → store`.
>
> Tests, red first: `write-observing.repository-driver.test.ts` (moved by `mv` from the membership
> reporter's file) asserts the call lists in memory:
> - an `updateAll` on memberships writing roles runs one aggregate (two before);
> - a role `updateById` reads the role once, as one aggregate (two reads before);
> - a role `deleteById` reads it once (twice before).
>
> The validator's suite moved to `auth/roles/role.write-observer.test.ts` unchanged. The frame-count
> half of the Verify was not written: the chain lost three frames, and a stack depth is the wrong
> thing to pin. The import half is 09 §Q9's test, since `data-source/` still imports auth in places
> §Q9 moves. Change sets as a subscriber are 09 §Q6's.

### What the big files are made of

`data-source/repository/repository.ts` — 2,959 lines, 1,159 of them comment lines (39%), *modified*.

| Lines | Responsibility |
|---|---|
| 1–200 | imports (81 of them), `WrittenUpdate`, `BulkUpdate`, `PreparedUpsert` types |
| 200–470 | class head, wrapper construction, find-option defaults, `scopedWhere`/`resolveRestriction` (tenant + scope composition) |
| 470–700 | tenant reference validation, scope-on-write checks via the in-process evaluator |
| 703–985 | `create`, owned rows (relations written beside the row), read-back options |
| 986–1595 | `upsert`/`upsertAll`: identity, conflict sets, encrypted bound values, lower-casing uuids, reachability (600 lines) |
| 1593–1760 | `createAll`, written-row recording for lease scope, id assignment |
| 1762–2110 | reads: `findById`, `findOne`, `findAll` (+ unbounded-read probe), `stream` (+ its own timeout handling), `findAllPaginated`, `findAllAfter` (keyset), `count`, `exists` |
| 2112–2420 | `updateById`, `saveUpdate`, `updateEach`, tenant-of-updated |
| 2417–2730 | `updateAll`, bound encrypted updates, owned rows under bulk update, `updateAllBound` |
| 2732–2780 | `inTransaction`, `withinTimeout` |
| 2781–2959 | `deleteById`, `deleteAll`, owned-row removal, reference checks |

What could be split out without changing behaviour: the upsert preparation (:986–1595, a
`UpsertPreparationUtilities` or a class of its own), the owned-relation write/remove half (:757–985,
:2884–2959, already half in `owned-relation.utilities.ts`), and the tenant/scope checks (:470–700) which
are policy. That leaves a ~1,200-line repository of CRUD + reads.

`data-source/driver/val-key.repository-driver.ts` — 2,978 lines (34% comments). Lines 388–640 save
paths and key checks; 641–860 reads, `updateAll` by holding candidate rows and re-reading; 861–1015
`upsert` under identity grants; 1088–1760 unique/secondary **index maintenance and reconciliation**
(`reconcileStoredKeys`, `buildKeys`, `dropBrokenUniques`, ~670 lines — a schema manager); 1765–1930
index lookups for filters; 1933–2390 **relation resolution** (to-one, owned, many-to-many, cascade);
2391–2560 field encoding, ordering, comparison; 2564–2978 key naming, pipelined reads, reply decoding.
This file is a storage engine (indexes, relations, ordering) written over hashes and sets.

`data-source/data-sources/postgres/postgres-typeorm-data-source.model.ts` — 2,544 lines (35%). 568–800
options, init, statement cancellation/limiting (`:724-756`), transactions with idle timeout; 790–1160
collation, trigram extension probing, trigram index reconciliation; 1165–1300 `schemaLock` (a second
one-connection typeorm `DataSource` for the advisory lock) and **hand-written upsert SQL with its own
`$N` renumbering** (`buildUpsertSql`, `appendParams`); 1340–1410 error classification by parsing pg
messages; 1407–1790 **backups** via `pg_dump`/`psql` child processes (380 lines); 1793–1910 relation →
typeorm schema options; 1909–2040 in-place column conversion and refused-value discovery; 2042–2300
**index/unique/check reconciliation** (`reconcileKeys`, CONCURRENTLY, NOT VALID/VALIDATE); 2306–2544
value transformers and column options. Four unrelated concerns (connection/statements, schema
reconciliation, backups, value mapping) in one class.

`data-source/data-sources/typeorm-base-data-source.model.ts` — 1,777 lines (39%). 318–640 options,
`init`, schema management validation; 647–960 **upsert orchestration** (`resolveUpsertStatements`,
`pairUpserted`, `selectReachableIds`); 963–1100 lifecycle, `getRepository` (repository construction,
60 lines duplicated verbatim in `val-key-data-source.model.ts:645-703`); 1098–1540 **migration
operations** (`addPropertyToEntity` … `mergeEntity`, `createEntity`, foreign keys, renamed join tables,
`ConnectionMetadataBuilder` reuse); 1539–1700 `createSchemaForEntity` (zibri metadata → typeorm
`EntitySchema`), validation.

`postgres-typeorm-where-filter.converter.ts` — 982 lines (*modified*). jsonb operator handlers emitting
raw SQL (:125–400), array handlers, relation-count and `= ANY($list)` handling, similarity, and the
parameter bookkeeping that typeorm's `Raw` needs. Half of the where model is SQL text already.

**Duplicated between the postgres and valkey paths** (beyond `getRepository`): `STREAM_BATCH_SIZE = 500`
(`typeorm.repository-driver.ts:44`, `val-key.repository-driver.ts:54`, and `50` in the in-memory driver
whose comment claims it "matches what the real drivers use");
`DEFAULT_TRANSACTION_IDLE_TIMEOUT_IN_MS = 10000` (`postgres-typeorm-data-source.model.ts:104`,
`val-key-data-source.model.ts:155`); `inTransaction` (three copies, above); the whole migration operation
surface implemented twice against `DataSourceInterface` (`data-source.interface.ts:151-188`); relation
resolution (valkey does it by id batches in process, postgres through typeorm joins); unique-key
reconciliation (both ~300-600 lines, both named `reconcileKeys`/`reconcileStoredKeys`); backup and
restore; the acquire/release/renew lua scripts in `val-key-data-source.model.ts:195-250` and again, with
different constants, in `rate-limiting/stores/val-key.rate-limiter-lock.ts` (see Q11).

### Q2. The typeorm dependency carries a double model and is bypassed for every store-specific guarantee — MAJOR
*Filed 2026-10-21.*

**What Zibri uses from typeorm** (57 distinct imported symbols across 13 production files, all under
`data-source/` except `entity/models/base-relation-metadata.model.ts` and `utilities/typeorm.utilities.ts`):
the `DataSource` lifecycle and its pg pool; `QueryRunner` connect/start/commit/rollback/release and
positional `query()` (44 raw `query(` calls in the postgres data source, one in the base); `EntitySchema`
built from Zibri's own decorators (`typeorm-base-data-source.model.ts:1597-1676`) and the metadata typeorm
derives from it, read back through `ColumnMetadata` to rebuild entities out of raw rows
(`utilities/typeorm.utilities.ts:46-61`); `synchronize()` for the prototype mode; the DDL helpers
(`Table`, `TableColumn`, `TableForeignKey`, create/add/change/drop/rename) under the migration API;
`FindOptionsWhere` with `And/Or/Not/Equal/Like/ILike/IsNull/MoreThan…/ArrayContains/Raw` as the target
of the where converter; `manager.find/findOne/save` (relations and cascades), query-builder
insert/update/delete with `returning('*')`, `getQueryAndParameters()`, `stream()`, `pessimistic_write`
locks; column `ValueTransformer`s; one `EntitySubscriberInterface` (statement timeout on transaction
start, `postgres-typeorm-data-source.model.ts:359`); `QueryFailedError`.

**What Zibri has reimplemented, bypassed or patched around** (store-side reviewer's list, the items with
line numbers re-read here): upsert SQL by hand because typeorm cannot express per-row `CASE` updates,
partial-index conflict targets or per-row conditions (`:1214-1300`); index, unique and check management
entirely by hand, declared to typeorm with `synchronize: false` so it leaves them alone
(`:1528-1534`, `:2042-2290`); in-place column type conversion because `changeColumn` drops and re-adds
(`:1909-1948`); statement timeouts, cancellation (a cast into the query runner's private connection to
read `processID`, `:113-123`, `:724-735`) and idle timeouts; `pg` type parsers merged in to stop
`numeric[]` becoming floats (`pg-type-parsers.function.ts`); a `FindOperator.transformValue`
workaround; the jsonb/array/relation-count/`= ANY` where layer as `Raw` SQL plus a distribution of
relation alternatives because typeorm only ORs at the top level; `whereInIds` avoided
(`typeorm.repository-driver.ts:976-987`); error classification by parsing English messages; a second
one-connection `DataSource` to hold a session advisory lock; join-table names recovered by building
metadata twice; backups through child processes. And: `PostgresOptions` is
`OmitStrict<PostgresConnectionOptions, …>` (`postgres-typeorm-data-source.model.ts:73`) — an application's
data source config *is* a typeorm type; `TypeOrmBaseDataSource` exports 12 abstract members typed in
`QueryRunner`, `TableColumn`, `ColumnType`, `EntitySchemaIndexOptions`, `TOQueryFailedError`, so an app
that extends `PostgresDataSource` sees typeorm in its own class; `TypeOrmTransaction.queryRunner` is
public. Only the `Migration` base (`data-source/migration/migration.model.ts`) is clean — it takes a
`Transaction`.

Net: typeorm supplies the pool, the metadata model (which Zibri already has a copy of in
`PropertyMetadata`/`EntityMetadata`, converted forward at `:1597` and read back at
`typeorm.utilities.ts:29-61`), the simple-operator half of `FindOptionsWhere`, `save` for relation
cascades, and the DDL helpers. Everything a store guarantee depends on is written beside it. That is the
"double model" cost: every property is described twice, every error is classified after typeorm has
already wrapped it, and the hard half of the where language is SQL strings carried inside a
`FindOperator` tree.

**Replacing typeorm with Zibri's own thin layer over `pg`.** What it removes: the 57 symbols; ~1,560
lines of converter that target `FindOptionsWhere` (the Raw SQL half stays, as SQL); the schema
round-trip (`createSchemaForEntity`, `propertyToTableColumnOptions`, `toEntities` over `ColumnMetadata`,
~400 lines); the subscriber, the `processID` cast, the transform-value workaround, the second
`DataSource` for the lock, the metadata-built-twice join-table recovery; a dependency of ~700k lines
whose own defects this codebase has four documented workarounds for; and typeorm types from the public
API (Q10). What it costs — each item judged against what already exists:

| To rebuild | What exists already | Estimate |
|---|---|---|
| DDL from metadata (`CREATE TABLE`, columns, enums, arrays, defaults, FKs, named uniques/indexes/checks) | `fullColumnTypeMapping`, `propertyToColumnOptions` (:2461-2544), `databaseDefaultFor`, `keyWhereToSql`, `uniqueConstraintName`/`indexName`/`checkConstraintName`, and the reconciliation code that already creates keys by hand | 600–900 lines; the reconciliation already owns keys, so DDL is tables and columns |
| Migration operations (`addPropertyToEntity` … `mergeEntity`) | implemented over `Table`/`TableColumn` helpers, 440 lines in the base + 250 in postgres | rewrite as plain `ALTER`; the valkey twin shows the operation set is small |
| Where → SQL for the simple operators | the postgres converter already emits SQL text for jsonb, arrays, counts, lists; `TypeOrmParameters` already numbers parameters | ~250 lines |
| Relation loading (joins + hydration) | the valkey driver resolves relations by id batches in process (`val-key.repository-driver.ts:2012-2360`); `RelationTree` is already the driver's input | one `WHERE id = ANY($1)` per relation level, which is also what typeorm does for most shapes; 400–600 lines, or a join builder later |
| `save` cascades, many-to-many join rows | the repository already writes owned rows itself (`repository.ts:800`); valkey writes join sets by hand (:2191-2290) | ~200 lines |
| Transactions, savepoints | `Transaction` model, `TypeOrmTransaction` is 75 lines | trivial over a `pg` client; savepoints are not offered today |
| Pooling | — | `pg-pool` directly; `extra` already reaches pg |
| Streaming | `pg-query-stream` is already the mechanism | unchanged |
| Type parsing | `pg-type-parsers.function.ts` | unchanged |
| Error classification | by message today | by `SQLSTATE` + `constraint` field from `pg`'s `DatabaseError`, which is strictly better |
| `synchronize` mode | typeorm's | DDL diff from metadata, or drop it and require migrations in every mode (the README already took `synchronize` out of the options type) |

Risk sits in two places: relation hydration edge cases (nested relations with `defaultRelations`, one-of
shapes) and the migration operations, both of which have shared case files (`nested-relations.cases.ts`,
`owned-relations.cases.ts`, `moved-entities.cases.ts`, `migration-helpers.cases.ts`) that run on three
stores already. Size: a pg driver would land near the valkey driver's 3,000 lines and replace ~6,900
typeorm-side lines (driver 1,027 + converters 1,559 + data sources 4,321).

**How to do it incrementally**: `RepositoryDriverInterface` and `DataSourceInterface` are already the
seam, and `packages/testing/src/in-memory-data-source/` is proof that a third implementation can be
written against them with the shared cases as the contract (26 `data-source/tests/*.cases.ts` + 3 where
case files + 2 migration case files). Build `PgDataSource` + `PgRepositoryDriver` beside the typeorm
pair; wire a fourth `*.pg.test.ts` runner per case file; move the sandbox to it; keep the typeorm pair
for one major version behind the same interfaces. Order: reads + where → SQL first (lowest risk, biggest
double-model removal), then writes/upsert (the SQL already exists), then DDL + migrations, then drop
`synchronize`.

**The alternative — keep typeorm but confine it** — means removing `FindOptionsWhere` from the driver
boundary (the converter would have to emit SQL anyway), removing typeorm types from the abstract data
source and `PostgresOptions`, and still describing every property twice and classifying every error after
the fact. That is roughly half the work for a third of the benefit, and it leaves the four workarounds.

**Recommendation: replace, incrementally, behind the existing seam.** The maintainers' DX priority is
the deciding argument: one metadata model, errors typed from `SQLSTATE`, a `PostgresOptions` of Zibri's
own, and a driver whose every line is reachable from the shared case files.

**Verify:** the shared case files green on a fourth store; a size budget on `data-source/` (today
24,179 lines) that the pg driver must come in under; `npm ls typeorm` empty in the published package.

### Q3. The where model has one language and four semantics, and the one that decides a security question is not the one that answers reads — CRITICAL
*Filed 2026-10-21.*

A `Where<T>` is interpreted by: (1) `TypeOrmWhereFilterConverter` + `PostgresTypeOrmWhereFilterConverter`
(1,559 lines, FindOperators plus raw SQL) for Postgres reads and writes; (2) `WhereFilterEvaluator`
(480 lines, in process) for the valkey driver (`val-key.repository-driver.ts:390`) and the in-memory
driver (`packages/testing/.../in-memory.repository-driver.ts:50`); (3) the same evaluator inside
`Repository` itself, on **every store including Postgres**, to decide whether a row being written is
inside the caller's scope (`repository.ts:223, 624, 644, 1481`); (4) `dropImpossibleConditions`
(`data-source/where/drop-impossible-conditions.function.ts`, 387 lines) which decides what a filter can
match from property metadata before any of the above sees it, and `ScopeWhereUtilities` (676 lines)
which composes filters and has to know which keys commute. The evaluator's header
(`where-filter.evaluator.ts:50-59`) documents null semantics that the typeorm converter re-derives in
comments of its own (`typeorm-where-filter.converter.ts:55-81`) — the two agree today because somebody
checked by hand.

On Postgres, (3) decides *write-side scope*: a row the SQL would hide from a caller's reads is accepted
or refused for writing by the in-process evaluator. A divergence between (1) and (3) is therefore not
"two stores answer differently" but "the same store reads one set and lets you write another" — a
tenant-isolation hole with no store boundary to blame.

What exists against this: 3 where case files (`item-where`, `null-values`, `all-of-filters`) and 26
repository case files, each run on the in-memory store (`*.test.ts`) and on postgres+valkey
(`*.postgres-valkey.test.ts`), three of them (`large-batches`, `released-unique`, `repository-costs`) only
on the real stores. That is store-conformance per feature, by hand-picked examples. What is missing:
**a conformance test between the evaluators themselves**, i.e. for a generated set of rows and
generated filters over every `WhereFilterKeys` × property type (string, number formats, date, boolean,
array, nested object/jsonb, one-of, relation count, null), assert
`ids(driver.find(where)) == ids(rows.filter(r => evaluator.matches(r, where)))` on each store. One
generative case file would cover the class rather than the instances, and would also pin
`dropImpossibleConditions` (a condition it drops must match no row under the evaluator).

**Recommended shape:** one `WhereSemantics` specification module that both the SQL emitters and the
evaluator are derived from or at least tested against — at minimum the generative conformance file above
in `data-source/where/`, run on all three stores. Longer term (with Q2), one SQL emitter and one
evaluator, both small, with the null/absent rules written once as data (a table of key × null-handling)
that both read.

**Verify:** the generative conformance case file, red on first run if any divergence exists; a test that
writes a row outside the caller's scope through `updateById` on Postgres and asserts the SQL read and the
in-process check agree for every scope shape the sandbox declares.

> **Closed 2026-10-21 with the conformance file, and the one divergence it found in process fixed.**
> `data-source/where/where-conformance.cases.ts` holds a `Probe` entity with a property of every kind
> (text, uuid, number, whole number, bigint, date, boolean, list of texts, json object, list of objects,
> value of several shapes, relation to many), 48 rows picked from small overlapping pools by a seeded
> generator, and some 400 filters over every key of every kind plus or-branches, several conditions,
> and values no row can hold. For each filter it holds the store's `findAll` to the evaluator's answer
> over the written rows - the evaluator fed the filter the way the repository hands it to a store,
> through `dropImpossibleConditions`, so the pin on that function is built in. A second block takes a
> sample of the filters as the entity's scope and, for 24 rows under each, holds `create` to `exists`
> under the same scope: a refused row is written past the scope so the read has one to answer about.
> Runs on the in-memory store here and on postgres and valkey through the `.postgres-valkey.test.ts`.
>
> Found and fixed in process: the write side judged the *raw* scope, where a read goes through
> `dropImpossibleConditions` first - so a scope spelling a uuid in upper case read rows it refused to
> write (the safe direction, but exactly the two-decisions hole). `validateWithinScope` now narrows the
> scope's branches the same way before the evaluator sees them. Red first on the write-side case with a
> uuid property added to the probe for it. What the sql reading answers against the evaluator is in the
> user's hands: the postgres and valkey run of the file is the first time the two are compared by
> generation rather than by hand-picked example, and a mismatch there is a finding of its own.
>
> The first postgres run found three, all in the sql reading: a `where` through a relation satisfied by
> a row with nothing related, a list of objects compared as a whole matching nothing, and a number with
> a fraction on a whole-number property failing the statement. Filed and closed as
> [01 §D14, §D15 and §D16](../01-data-layer-repository.md); the file grew the cases they were missing
> (the children side of the relation, with rows pointing at nothing) and holds a refusal on one side to a
> refusal on the other.

### Q4. The two data sources duplicate construction, constants and the migration surface — MINOR
*Filed 2026-10-21.*

`getRepository` is the same 60 lines in `typeorm-base-data-source.model.ts:1033-1095` and
`val-key-data-source.model.ts:645-703` (same three branches, same `as unknown as` casts, same cache
map); `DEFAULT_TRANSACTION_IDLE_TIMEOUT_IN_MS` and `STREAM_BATCH_SIZE` are declared per store;
`inTransaction` exists three times. A `BaseDataSource` holding `repositories`, `getRepository` (taking a
`createDriver(cls)` from the subclass) and the shared constants removes ~150 lines and the chance of the
in-memory driver's `50` drifting from `500` (it already has). **Verify:** a test asserting the three
drivers' batch size is one exported constant.

---

## 2. Generic systems that could replace hand-written code

**Leases.** 17 call sites go through `LeaseService` (`leases/lease.service.ts`), including the valkey
transaction's `keepAlive`/`hold` — the fold is complete. One ad-hoc lock survives:
`rate-limiting/stores/val-key.rate-limiter-lock.ts` with its own `LOCK_TTL_MS = 5000`,
`LOCK_RETRY_DELAY_MS = 5`, `MAX_LOCK_ATTEMPTS = 400`, its own release script (`:29-35`), and `SET NX`
(`:70`). 10 §10.4 recorded it as safe (writes commit inside the lock), which is true; it is still a
second fencing-token lock with a second set of lua scripts beside `val-key-data-source.model.ts:195-250`.

### Q5. The persisted queue exists three times, and the user's own rule said the third copy is the trigger — MAJOR
*Filed 2026-10-21.*

| | Mail | Thread jobs | Events |
|---|---|---|---|
| Entity + status | `Email.status` QUEUED/FAILED, `attempts`, `retryAt` (`email/models/email.model.ts:126`) | `ThreadJobEntity.status`, `queuedAtMs`, `startedAtMs`, `error: LoggedError` (`multithreading/models/thread-job-entity.model.ts:56-90`) | `EventSubscriberRun.status` SUCCEEDED/PENDING_RETRY/FAILED, `attempts`, `nextRetryAt`, `error: LoggedError` (`event/event-subscriber-run.model.ts:96-103`) |
| Claim key | `claimKeyFor` (`email/email.service.ts:50`) | `claimKeyFor` (`multithreading/services/multithreading.service.ts:122`) | `claimKeyFor` (`event/event.service.ts:41`) |
| Lease | `withLeases(..., 'retainOnError')` (`email.service.ts:200`) | `withLease(..., 'release')` (`:896`) | `withLease(..., 'retain')` (`:448`) |
| Backoff | `retryDelayInMs * 2 ** attempts` (`email.service.ts:271`) | — | `EVENT_RETRY_DELAY_IN_MS * 2 ** (attempts-1)` (`event.service.ts:571`) |
| Poller | `SendQueuedEmailsCronJob` every 5 s | `RunQueuedThreadJobsCronJob` every 2 s, `distributed: false` | `EventDispatchCronJob` every 5 s, `distributed: false` |
| Recovery | `recordFailedAttempt` | `abandonRun` | `recordResult` |

Plus `cron-job.model.ts:608` and `http-client.ts:924` for the fifth and sixth copy of
`base * 2 ** (attempt - 1)`. The backup system has no status column at all
(`backup/backup-entity.model.ts`), which is the user's "partial backups are abandoned" bullet: a fourth
queue written without the pattern. The memory note says "generic primitive deferred until a third copy";
the third copy is here and a fourth is wanted. Two more measurements that a shared primitive would
answer once: none of the four polled tables (`Email`, `ThreadJobEntity`, `Event`/`EventSubscriberRun`,
the cache invalidation rows) declares an index on the columns its poller filters by — `@Entity`'s
`indexes` is used by exactly one model in the framework, `auth/scim/scim-user-value.model.ts` — and the
thread job table is the one queue with no expired-row sweeper beside it (the infrastructure reviewer's
round-2 06 §Q9 has the per-table detail; the boot-time check of every framework `findAll` filter
against declared indexes it proposes belongs in the primitive's `onAppInit`). The "which replica holds
this" question (06 §F12: no instance identity exists in `src`, `Lease.heldBy` is the shared app name)
has the same single home.

**Recommended shape:** a `QueuedWork<T>` primitive in `data-source/` or its own directory — an entity
mixin (`status`, `attempts`, `nextAttemptAt`, `error: LoggedError`, `claimedBy`), one
`QueueService.poll(repository, { batch, leaseInMs, onCompletion, backoff })` that reads due rows, claims
them per row through `withLeases`, runs the handler, records the outcome and the next attempt, and one
`QueuePollCronJob` parameterised by the queue; mail, thread jobs, events and backup resources become
handlers. It also answers the user's "spread recovery evenly" bullet in one place rather than three, and
the "exactly once" question gets one answer. Trade-off: the three have real differences (mail claims
before rate limiting; events retain the grant as a ledger; thread jobs hold the grant for the run) — all
three are `onCompletion` values the lease already has, so the primitive carries a policy per queue rather
than a code path per queue. **Verify:** the three existing cluster suites (`cluster/mail`,
`cluster/events`, thread jobs) stay green through the fold; a size budget: three services shrink by the
lines the primitive gains.

> **Closed 2026-10-27.** Decisions (the user's): the full shape; the primitive internal, not a job
> queue for applications; at least once, at most once and transactional delivery with a stable run id;
> subscribers on every instance; backups queued and resumed; thread jobs on the shared columns only;
> `createBackup` queues and returns, renamed `queueBackup` after the close; a shutdown hands a backup
> over.
>
> `src/queue/`:
> - `QueuedWorkEntity` (public): `attempts`, `nextAttemptAt`, `error`, the columns every queue shares;
> - `QueueDefinition` and `QueueUtilities.poll`/`runClaimed` (on `zibri/internal`): the claim, the
>   attempt count, the doubling backoff, giving up, the wake-up at the retry, and the delivery
>   (`QueueDelivery`, public). A run gets `QueuedWorkRun` (public): `runId`, `attempt`, `signal`,
>   `transaction`. At most once records the attempt `FAILED` ("stopped before it finished") before it
>   runs. `QueuedWorkHandedBackError` skips recording, as a lost claim does;
> - `QueuePollCronJob`: passes until one finds nothing. Mail and backups use it; event dispatch
>   does not, since it hands events off without waiting, so draining would read the same page again.
>
> Per queue:
> - **mail**: on the core with a batch claim and the rate-limited batch as `runBatch`; `retryAt` →
>   `nextAttemptAt` plus `error` (the upgrade migration edited); the SMTP transport sends
>   `Message-ID: <id@sender domain>`, the same on every attempt;
> - **event runs**: selection, fan-out and settlement stay the event service's; each (event,
>   subscriber) attempt goes through `runClaimed`, `refresh` re-reading the run under the claim.
>   `EventSubscriberRun` on the shared columns (`nextRetryAt` → `nextAttemptAt`). Subscriber options
>   `delivery` and `runsOn: 'everyInstance'`; such a subscriber registers with `runsOn`, owes no run,
>   and hears emits elsewhere over the pub/sub channel `zibri.event-emitted`, published only when such a
>   registration exists. Hooks get the run as a third argument (`EventHook`);
> - **thread jobs**: `ThreadJobEntity` on the shared columns only. A job counts its starts, holds its
>   claim for the whole run and is not retried when it throws; forcing that into the core needed modes
>   only it would use;
> - **backups**: `BackupEntity.status` (`BackupStatus`), each `BackupResourceEntity` a queue row;
>   `queueBackup` returns the `RUNNING` backup and starts it, `waitForBackup` waits (`BackupFailedError`),
>   `RunQueuedBackupsCronJob` on every instance resumes what a stopped or dead instance left;
>   `BACKUP_MAX_ATTEMPTS` (3) and `BACKUP_RETRY_DELAY_IN_MS` (a minute). A shutdown hands the resource
>   back without counting it.
>
> On the way, cron's `distributed` became `runsOn: 'oneInstance' | 'everyInstance'` (`RunsOn`, shared
> with events); 2.x had no flag, so no upgrade entry. `EmailService` and `EventService` lost their
> lease service constructor parameter. Docs: new `background-work.md` (when to use which tool, what
> each guarantees), `events.md` ("Choosing how a hook is delivered", "Running on every instance"),
> `email.md`, `backup.md`, `cron.md`, `configuration.md`, the upgrade guide.
>
> Tests, red first:
> - `queue/queue.utilities.test.ts` (9);
> - `event/event.service.delivery.test.ts` (4: stable run id, transactional, at most once, every
>   instance);
> - `backup/backup-service.queue.test.ts` (4: queued and waited for, retried, failed with the
>   resource named, resumed);
> - `backup-service.shutdown.test.ts`, its backup half rewritten for the hand-over;
> - `email.service.retries.test.ts` with the error kept, `smtp.email-transport.test.ts` with the
>   Message-ID, the cron type case for `runsOn`;
> - `events.cluster.test.ts` gained the every-instance case across three replicas (container).
>
> `event.service.retry-backlog.test.ts` waits for its blocking hook to start, which now reads its run
> under the claim before it runs. The 37 container-suite calls of `queueBackup` wait for the backup.
> The size budget of the Verify was not measured: the services did not shrink by the primitive's
> lines, since each keeps its selection.

### Q6. The event service is not used by the framework itself; subsystems call each other directly, and two of them re-implement an after-commit bus — MAJOR
*Filed 2026-10-21.*

`ZIBRI_DI_TOKENS.EVENT_SERVICE` is referenced outside `event/` only in the DI defaults; no framework code
emits an event (the infrastructure reviewer measured the same from the application's side, round-2 06
§Q4: a user deleted, a membership revoked or a role changed is invisible to an application subscriber,
and `RoleService` invalidates its copies through the cache bus instead). Cross-subsystem notification
today: `AuthService.revokeApiKey/revokeApiKeys` →
`websocketService.disconnectEndedLogins` (`auth/auth.service.ts:600, 606`, *modified*);
`deactivateUser` → `userService.updateDeactivatedAt` + `endLogins` + `apiKeyService.revokeForUser`
(`:631-639`); `resolveRefreshUser` → `endAccess` via `transaction.afterFinish` (`:664-670`); role and
membership changes → `roleService.handleRolesChanged` / `membershipService.handleMembershipsChanged`
through the two reporting drivers (Q1), each with its own "read before, diff, `afterCommit`, log and
swallow" implementation. So the framework has: a persisted, polled, at-least-once event service for
applications; a hand-written synchronous after-commit bus for itself, twice; and direct method calls for
the rest. A subsystem added tomorrow (a tenant deleted, a user deleted) has to find and call every
interested service — the user's own bullet.

**Recommended shape:** not the persisted `EventService` for this (it is cross-process, polled every 5 s
and at-least-once, which is wrong for "disconnect this user's sockets now"), but the in-process
`afterWrite` hook from Q1 plus a small typed in-process `onEntityWritten(entityClass, handler)` that the
role service, membership service, websocket tenancy, cache invalidation and change sets subscribe to.
Each subscriber then decides whether to fan out cross-instance (the role service already does, through
its own mechanism). The persisted `EventService` stays what it is: the application's durable channel —
and the same `afterWrite` hook is where the framework can finally `emit` the user/membership/role events
06 §Q4 asks for, once, instead of each service remembering to.
**Verify:** an architecture test that no `*.service.ts` under `auth/` imports a websocket or tenancy
service for notification; the existing `websocket.service.ended-logins.test.ts` and
`websocket.service.tenancy.test.ts` (*modified*) green through the move.

> **Closed 2026-10-26 (user's design: the websocket observes rows; the websocket owns its tenant
> rooms; change sets stay a repository).** The in-process seam is §Q1's `WriteObservingRepositoryDriver`,
> not a second bus. The websocket registers three observers in `afterAppInit`, once the user and
> membership services have found their entities:
> - `EndedLoginWriteObserver` on each entity a strategy lists in its `credentialEntities`;
> - `DeactivatedUserWriteObserver` on the user entities;
> - `TenantRoomWriteObserver` on the membership entity.
>
> A strategy's `credentialEntities` is a new required member of `AuthStrategyInterface`: each entry
> is a `CredentialEntity` with the entity and whether a `'remove'` or an `'insert'` ends a credential.
> `JwtRevokedAccessToken` gained `userId` so an inserted revocation names its user. The auth service,
> the JWT strategy and the client access token strategy lost their nine `disconnectEndedLogins` calls.
> The membership service lost `handleMembershipsChanged`, and the websocket interface lost
> `updateTenantRooms`. `disconnectEndedLogins` stays public for logins kept outside a data source.
> `MembershipServiceInterface.findMembershipEntityClass` and `UserServiceInterface.getUserEntityClasses`
> are what the websocket reads.
>
> Changes to the seam:
> - `followsBefore` is a predicate on the operation and data, and optional;
> - `handleWritten` is told the operation and data;
> - a removal reads only `id` and the observers' properties;
> - registration closes after `afterAppInit`.
>
> `MembershipWriteObserver` only checks roles now, so an application without websockets reads no
> membership before writing it. Change sets stay `ChangeSetRepository`: a change set is part of the
> write, in its transaction, where an observer follows after commit. What applications hear of
> framework writes (user, membership, role events) is 06 §Q4's.
>
> Tests, red first (5):
> - `application/subsystem-imports.test.ts`: nothing under `auth/` or `tenancy/` imports the
>   websocket service or injects its token (three importers and one injector before);
> - `websocket.service.ended-logins.test.ts`: a socket closes when the application deletes refresh
>   tokens through the repository, and when it deactivates a user through `UserService`;
> - `write-observing.repository-driver.test.ts`: in an app without websockets, a membership
>   `updateAll` moving users and a membership delete each read nothing first.
>
> Kept green: a client access token revoked closes its socket (new case, was a direct call), and
> `websocket.service.tenancy.test.ts` gained the moved-memberships case with its single aggregate,
> which took over the reporting assertion the seam's test lost. Found on the way: a websocket
> handshake carries no parsed cookies, so a cookie login cannot authenticate a socket at all; no page
> claims it can, and it is left as a mention.

**Registries vs scattered metadata reads.** `ModelRegistry` exists and is read 20 times;
`MetadataUtilities.getModelProperties` is still called 107 times in production code, 11 of them in
`repository.ts` and 3 each in `scope-where.utilities.ts`, `tenant.utilities.ts` and the valkey driver —
per call, on the hot path, re-walking reflect metadata the registry already resolved once. The
repository reviewer's round-trip finding (01 §D4) is the store half; this is the CPU half. **MINOR;
Verify:** a test counting `Reflect.getMetadata` calls during one `findAll` (wrap `Reflect` in the test)
and asserting a constant.

**withinTimeout / operation limits vs hand-rolled timeouts.** Three timeout primitives coexist:
`OperationLimitUtilities.runWithin` (ALS-propagated, reaches statement timeouts; used by repositories and
migrations), `PromiseUtilities.withTimeout` (signal-based; used for event hooks at `event.service.ts:457`
with `?? Ms.SECOND * 30`), and `RequestDeadlineUtilities` (http). Hand-rolled: `http-client.ts:1029`
(its own `AbortController` + `setTimeout`), `websocket.service.ts:1144` (answers deadline),
`:1322` (credential expiry re-check), `multithreading.service.ts:1045` (worker timeout — justified, it is
a thread). The one that matters: an event hook that calls a repository runs under a timeout the
repository cannot see, so its statements are not limited; `runWithin` would propagate. **MINOR.**

**LoggedError vs raw error columns.** Consistent: thread jobs, event runs, payments and log contexts use
`LoggedError`; the only `error?: string` is an OAuth form field
(`auth/authenticators/federated/federated-callback-form.model.ts:24`), which is a protocol value, not a
log. No finding.

### Q7. Policy constants in auth are hardcoded in one method and DI tokens in the next — MINOR
*Filed 2026-10-21.*

91 module-level constants under `auth/`, 18 of them numeric policy: `PROOF_MAX_AGE_IN_MS`,
`NONCE_LIFETIME_IN_MS` (`auth/dpop/dpop.service.ts:32-37`), `MAX_ASSERTION_LIFETIME_IN_MS`
(`authorization-server.service.ts:71`), `ACCEPTED_CLOCK_SKEW_IN_MS`, `METADATA_MAX_AGE_IN_MS`
(`base-saml.authenticator.ts:86-91`), `FIRST_SIGN_IN_LEASE_IN_MS` (`base-ldap.authenticator.ts:40`),
`ACCESS_TOKEN_REFRESH_MARGIN_IN_MS = 60000` (`base-oauth.authenticator.ts:42`, a raw number where every
neighbour uses `Ms.MINUTE`), `CLIENT_SECRET_LIFETIME_IN_SECONDS` (`base-apple.authenticator.ts:29`),
`RECOVERY_CODE_COUNT/LENGTH`, SCIM `MAX_RESULTS = 200`, `DEFAULT_MAX_BULK_OPERATIONS = 1000`. Meanwhile
the OTP method's equivalents are tokens (`zi.otp_length`, `zi.otp_validation_window_in_ms`), and the
124-token `ZIBRI_DI_TOKENS` already has 16 `*_in_ms` tokens. Two conventions for one kind of knob.
**Recommendation:** not more tokens. The authenticators are `Base*` classes the application extends, so
the honest home is an abstract/overridable `options` member on each base class (the pattern
`schemaManagement` uses on the data source), typed per authenticator; the two SCIM limits belong on
`ScimControllerOptions`. Keep tokens for application-wide settings only. **Verify:** a test that
each `Base*Authenticator` exposes its lifetimes through its options type (compile-time, with
`@ts-expect-error` on a wrong key).

### Q8. Twenty-five cron jobs, seventeen of them the same cleanup job — MINOR
*Filed 2026-10-21.*

17 `*cleanup.cron-job.ts` files, 10 of them outside `auth/` (06 §Q9 lists them per table; 23–99 lines
each, 13 of them one `deleteAll` with a time predicate,
e.g. `logging/log-cleanup.cron-job.ts`, `email/email-cleanup.cron-job.ts`,
`auth/strategies/jwt/jwt-refresh-token-cleanup.cron-job.ts`), each registered by its service in
`onAppInit` (`leases/lease.service.ts:101-103` is the pattern). Five pollers (`cron-sync`,
`event-dispatch`, `run-queued-thread-jobs`, `send-queued-emails`, `cache-invalidation`) every 2–5 s per
instance. **Recommendation:** one `RetentionCronJob` driven by a declaration on the entity —
`@Entity({ retention: { expiredWhen: { expiresAt: { before: 'now' } }, after: Ms.DAY } })` — so the 13
trivial jobs become 13 one-line declarations an application can also use for its own tables, and the
pollers become instances of the queue primitive (Q5). The four non-trivial cleanups (backup staging,
form-data temp files, cache, rate limiting) stay as they are. **Verify:** a count test — the number of
registered cron jobs on the sandbox app drops from 25 to ≤ 12 without any retention case going red.

---

## 3. Layering and dependencies between subsystems

Fan-in by distinct importing directories (of 39): `di` 34, `error-handling` 34, `utilities` 33, `types`
32, `entity` 31, `global` 27, `logging` 24, `context` 23, `http` 23, `data-source` 23. Fan-out: `di` 32,
`auth` 28, `plugin` 23, `routing` 20, `data-source` 20. 2-cycles between top-level directories: 118
pairs are mutual. The ones that matter, with the file that causes them:

| Edge (wrong direction) | Imports | Where |
|---|---|---|
| `data-source → auth` | 13 | `driver/role-validating.repository-driver.ts` (6, untracked), `scopes/resolve-entity-scope.function.ts` (2), `repository/repository.ts`, `driver/role-reporting.repository-driver.ts`, `val-key-data-source.model.ts` |
| `data-source → tenancy` | 7 | the same three drivers/scope files |
| `data-source → change-sets` | 23 | `data-source.interface.ts:2-5` (`RepositoryTypeForEntity` names `SoftDeleteRepository`), both data sources' `getRepository` |
| `data-source → open-api` | 9 | `PaginationResult` lives in `open-api/pagination-result.model.ts` |
| `data-source → backup` | 1 | `DataSourceInterface extends BackupResourceInterface` |
| `utilities → auth/routing/websocket/backup` | 8/5/3/2 | all from `utilities/metadata.utilities.ts` (*modified*) |
| `entity → auth` | 9 | `entity-scope.model.ts` (`CurrentUser`), `string-property-metadata.model.ts`, `strategy-checked-input.model.ts` |
| `global → auth` | 11 | `model-registry/*encryption*` functions, `route-registry` |
| `context → auth` | 4 | `request/request-context-token.model.ts` |
| `error-handling → http` | 30 | every http error class imports the status enum; `http → error-handling` 4 |
| `logging → email` | 3 | `transport/log-to-email.function.ts` |

### Q9. The data layer depends upward on auth and tenancy, and `MetadataUtilities` is a hub that makes `utilities` depend on everything — MAJOR
*Filed 2026-10-21.*

Expected direction: `types → utilities → entity → data-source → {auth, tenancy, change-sets, …} →
application`. Today `data-source` imports `auth` and `tenancy` (through Q1's wrappers and the scope
resolver, which calls `authService.getCurrentUser` on every scoped read), `entity` imports `auth`
(`CurrentUser` in the scope context), and `utilities/metadata.utilities.ts` (698 lines, 89 static
members, imports from 10 directories including `auth`, `routing`, `websocket`, `backup`) is the reason
`utilities` has fan-out 13. `MetadataUtilities` is one class holding the metadata accessors of every
subsystem, so every subsystem's model types flow into the lowest layer. Three consequences: `tsc`'s
`design:paramtypes` collapse on import cycles (05 §D5 was exactly this: interfaces becoming `Object`);
the ESM move (memory: paused on `wip/migrate-to-esm`) will meet these cycles as TDZ errors; and the pg
driver of Q2 cannot be built as a package of its own while `data-source` reaches into `auth`.

**Recommended shape:** (1) `EntityScopeContext` and the scope callback move out of `data-source` into a
`scopes/` sibling that `auth` and `tenancy` register into (the repository calls a
`ScopeResolverInterface` token, defaulting to a no-op); (2) `PaginationResult` moves to `data-source`
(`open-api` is a consumer); (3) `RepositoryTypeForEntity` is computed by the subclasses registering a
factory, not by `data-source` naming `change-sets`; (4) `MetadataUtilities` splits per subsystem —
`RouteMetadataUtilities` in `routing/`, `WebsocketMetadataUtilities` in `websocket/`, etc. — leaving a
small generic reflect wrapper in `utilities/`; (5) `error-handling/errors/*` keep `HttpStatus` but the
enum moves to `error-handling` or `types`, breaking the 30/4 cycle. **Verify:** an architecture test
(`dependency-cruiser`-style, or the awk graph this review used, ~40 lines) asserting an allowed-edges
list between top-level directories, run in `test:normal`.

> **Closed 2026-10-26 (user's scope: the data layer first, runtime imports only, change sets move
> into `data-source`).** `application/subsystem-imports.test.ts` asserts that `data-source/` and
> `entity/` import at runtime only `context`, `data-source`, `di`, `entity`, `error-handling`,
> `global`, `localization`, `logging`, `parsing`, `tracing`, `types` and `utilities`. An import
> whose names are all marked `type` is erased by the compiler, so it makes no runtime cycle, no
> `design:paramtypes` collapse and no ESM temporal dead zone. Red first, it listed 66 runtime imports.
>
> Moves (with `mv`; the ~150 import paths were fixed with Edit by a subagent and checked by the
> typecheck):
> - `change-sets/` → `data-source/change-sets/`: soft delete and change sets are the data layer's own
>   repository kinds;
> - `PaginationResult` → `data-source/models/`;
> - `sem-ver.utilities` → `utilities/`;
> - `ValidationProblemCode` → `error-handling/`.
>
> Rewiring:
> - the user, membership and role marks and the kinds table → `data-source/repository/repository-kind.model.ts`,
>   which auth and tenancy import. The data layer reads them while registering repositories, before
>   anything could register them;
> - `UUID_REGEX` → `UUIDUtilities.STRICT_SHAPE`;
> - type-only imports marked `type`: backup, application, leases, the encryption and hash options,
>   open-api, http-client, routing, and the auth service interface in the two change-set repositories.
>
> The scope resolver and `removeRows` still reach auth, tenancy and users, through their tokens and
> type-only imports. That keeps 01 code-review §Q3's per-delete `USER_SERVICE` injection, which stays
> narrowed rather than moved. Out of this scope, filed red as §Q15 (`MetadataUtilities`) and §Q16 (the
> `error-handling` ↔ `http` cycle), in `__testing__/evaluation/subsystem-imports.evaluation.test.ts`.
> The data layer still sits in a runtime cycle through `utilities` until §Q15 closes. Type imports of
> auth remain, so a driver package of its own (§Q2) would still need auth's types.

### Q10. The barrel exports internals and typeorm-shaped surface beside the application API — MINOR
*Filed 2026-10-21.*

`index.ts` (*modified*) has 968 export lines. Among them, exported to applications with no marking:
`typeorm-base-data-source.model`, `postgres-typeorm-data-source.model`, `typeorm.repository-driver`,
both typeorm where converters, `where-filter.evaluator`, `typeorm-transaction.model` (:680-702); DI
internals `get-all-instantiated-values`, `get-registered-providers-of-variant`,
`get-dependency-stack-trace` (:383-387); model-registry internals `remove-exclude-properties`,
`restore-exclude-properties`, `set-default-values` (:505-507); `after-cursor-where.function`,
`index-name`/`unique-constraint-name`/`check-constraint-name` (:670-696). The in-memory driver in
`packages/testing` imports 40 of these (`in-memory.repository-driver.ts:1`), so a driver-author SPI
genuinely exists — it is just not told apart from the application API. A `./testing` subpath was
decided against (06 §T2), so the fix is not a subpath: group the barrel into labelled sections
(`// application API`, `// driver SPI`, `// internal, exported for packages/testing`) and move the
third group behind one `ZibriInternals` namespace export, so typedoc and autocomplete separate them.
**Verify:** `published-package.test.ts` (*modified*) asserts the count of top-level names that are
not in the application or SPI section.

> **Closed 2026-10-25 with 08 §X20**, by the subpath this item argued against: the argument was 06
> §T2's, which turned on test dependencies, and `zibri/internal` brings none. The driver SPI is part of
> the public API (writing a driver is documented); the helpers only the built-in drivers and the
> in-memory one use are on `zibri/internal`, and typedoc and autocomplete show `zibri` alone.

---

## 4. Code shape against CODE_STYLE.md

**Casts.** 510 code lines carry an `as <Type>` cast in 144 of 1,197 production files. The clusters:
`typeorm.repository-driver.ts` 24, `repository.ts` 22, `val-key.repository-driver.ts` 22,
`websocket.service.ts` 21, `typeorm-where-filter.converter.ts` 18, `http-client.ts` 15,
`di-container.ts` 15. By target: `as Record` 59, `as T` 37, **`as Where<T>` 34** (every
`{ id: { oneOf: ids } } as Where<T>` in the drivers and wrappers — the `Where<T>` type cannot be built
from a key the code knows is a property of `T`, which is the "model is wrong" case the style file
names), `as Function` 26, `as unknown as` 29 (`http-client.ts` 4, `di-container.ts` 4, both data
sources' `getRepository` 2 each), **`as never` 29 in production code** (`backup/backup.service.ts` 4,
the two rate limiter stores 4, `router.ts`, `versioning.service.ts`, `tracing/trace-span-context.model.ts`
…) against a style rule that says it is never the answer. `any`: 57 occurrences, 63
`typescript/no-explicit-any` disables; the clusters are the payment provider interface (8) and
`invoicing.tokens.ts` (4). Total `eslint-disable` comments: 2,011, of which 1,514 are
`jsdoc/require-jsdoc` — the wrappers of Q1 alone account for 55, and interface implementations in general
for most of the rest, which says the rule is configured for a shape the code does not have (an
implementing method inherits its doc). **MINOR as a whole; the `as Where<T>` family becomes a type fix
(`WhereFor<T, K>` helper or an `idsWhere(ids)` on the driver interface) and the 29 `as never` each
deserve the split-type treatment the style file prescribes.**

**Files holding several exported concepts.** 108 of 1,196 production files export two or more
classes/functions/enums: `pay-pal-client.ts` 8, `validation-problem.model.ts` 7,
`http/mime-type.helpers.ts` 6, `parsing/functions/parse-one-of.function.ts` 5 (a `.function.ts` with five
functions), `routing/param-metdata.helpers.ts` 4 (typo in the name, and `.helpers.ts` is not a suffix the
style file lists; three such files), `entity/decorators/property.decorator.ts` 4,
`di/decorators/inject-repository.decorator.ts` 4, `data-source/hooks/hooks.default.ts` 3 loose
functions that the style file would make a `HookUtilities`. Suffix-less files: `utilities/ms.ts`,
`utilities/bytes.ts`, `utilities/doubly-linked-list.ts`, `backup/backup-format.ts`,
`global/framework-copies.ts`. **MINOR.**

**Functions vs utility classes.** 48 `.function.ts` files are exported from the barrel; several sit in
groups that the style rule says become a class once a second one appears: `global/model-registry/`
holds `encrypt-encryption-properties`, `decrypt-encryption-properties`, `find-encrypted-values`,
`needs-re-encryption`, `hash-hash-properties`, `remove-exclude-properties`, `restore-exclude-properties`,
`set-default-values` — eight loose functions over one concept (what a model's property metadata does to
a row), and the two `exclude-properties` ones are imported by both the hooks and `ChangeSetRepository`.
`data-source/` top level holds `entity-ownership`, `index-name`, `unique-constraint-name`,
`check-constraint-name`, `literal-to-sql`, `validate-write-is-not-blind`, `run-in-lease-scope` as loose
functions beside `*.utilities.ts` classes. **MINOR.**

**Services reached by class.** 7 call sites: `inject(PasswordAuthenticator)` ×3
(`auth/auth.service.ts:785-796`), three rate limiters by class in the 2FA code methods, two conformance
services in the invoicing plugin. Authenticators and rate limiters are class-keyed by design, so only the
`PasswordAuthenticator` case is a service bypassing its token. **MINOR.**

**Setup outside `onAppInit`.** `HandlebarUtilities.init()` is a static init the application has to call
(`application/application.ts:342`); everything else goes through `onAppInit`. **MINOR.**

**Per-row loops over store calls.** None found by the `for … await repository.` grep in production code —
the rule holds; the per-row cost that remains is the one Q1 describes (wrappers reading before the
repository reads).

**Silent defaults on policy settings.** 46 `?? <number|Ms.X>` in production code. The policy-shaped
ones: event hook timeout `options.timeout ?? Ms.SECOND * 30` (`event.service.ts:457`); mail
`sendLeaseInMs ?? Ms.MINUTE`, `retryDelayInMs ?? Ms.MINUTE` (`email.service.ts:93-96`); api keys
`deleteExpiredAfterMs ?? Ms.DAY * 30` — a retention policy — and `recordUseAfterMs ?? Ms.HOUR`
(`api-key.service.ts:221-222`); 2FA code `expiresInMs ?? Ms.MINUTE * 10`; `withLease` `mode ?? 'skip'`
(`lease.service.ts:108`). Each is reasonable as a value and each is the "you forgot" ≡ "you said this"
case the style file refuses; the retention one is the strongest candidate for required. **MINOR.**

**JSDoc that names findings or internals (published).** 9 JSDoc blocks cite `evaluation/…` by path:
`leases/lease.service.ts:57`, `leases/held-lease.model.ts:27`, `leases/lease-options.model.ts:8`,
`leases/lease-acquisition-timeout.error.ts:9`, `leases/lease-service.interface.ts:14`,
`leases/lease.model.ts:15`, `event/event-subscriber-registration.model.ts:22`, `event/event.service.ts:567`,
`data-source/run-in-lease-scope.function.ts:16`. History in published JSDoc ("used to", "no longer",
"turned out"): e.g. `typeorm-base-data-source.model.ts:324` ("This used to be typeorm's `synchronize`"),
`application.ts:939`. Both are explicitly against the comment split in CODE_STYLE.md. **MINOR, but
mechanical:** a lint rule (`no-restricted-syntax` on JSDoc text matching `/evaluation\/|§|used to|no
longer/`) holds it.

**Comment verbosity.** 35% of all production lines are comments (44,756 of 126,151); the data layer runs
at 34–39% per file; 122 JSDoc blocks are 15 lines or longer; 69 inline `//` runs are 6 lines or longer,
the longest at `repository.ts:2113` (14 lines before `updateById`), `websocket.service.ts:362` (13),
`event.service.ts:435` (13), `email.service.ts:187` (13), `auth-controller.model.ts:410` (13). Reading
them: most are *decision* comments the style file asks for, but written as narrative — the 14-line one at
`repository.ts:2113` says in four paragraphs what "`exists` first, because `save` upserts and a missing
row must be a 404 (10 §10.2a); the condition is checked by the write, not here" says in two lines. The
driver-wrapper headers repeat each other's reasoning ("there is one seam here and fourteen up there",
`deadline-aware.repository-driver.ts:20`, `traced.repository-driver.ts:39`). **MINOR; the user's own
list already has it.** A measurable target: no inline run over 8 lines, no JSDoc over 12 without an
`@example`.

**Naming against the verb table.** `checkRouteAccess`, `checkAccess`, `checkIdentity`,
`checkAdditionalReservationLimits` (4) where the table says `validateX`. 15 `async getX` methods
(`getConsecutiveNumber`, `getReservation`, `getAll`, `getAccessToken`, `getTaxGroups` …) and, on the
auth service interface, `getCurrentUser`/`getCurrentMembership`, which perform a lookup and are called
on every scoped read (`resolve-entity-scope.function.ts:43-47`) — the table's `resolveX`. **MINOR.**

**Tests that mock what could run.** Not measured in depth; the memory notes and the 323 suites booting
`startTestServer` versus 162 referencing the in-memory source say the preference is already followed.
Not reviewed further.

---

## 5. Consistency of the public API

### Q11. Time units are spelled two ways across the public surface — MINOR
*Filed 2026-10-21.*

51 option/model properties end in `InMs`, 38 end in bare `Ms`. DI tokens are uniformly `*_in_ms` except
`zi.logger_flush_interval_ms`. Public examples of the second spelling: `HttpClientOptions.defaultTimeoutMs`
(`http-client/http-client-options.model.ts:43`), `openForMs` (circuit breaker),
`CronFailurePolicy.restartAfterMs`, `catchUpWithinMs`, `ApiKey*.recordUseAfterMs/deleteExpiredAfterMs`,
2FA `resendAfterMs`, log-to-email `minIntervalMs`, S3 transport `timeoutMs`; beside `timeoutInMs`,
`idleTimeoutInMs`, `sendLeaseInMs`, `retryDelayInMs`, `expiresInMs`, `leaseInMs`. One is a timestamp
convention (`…AtMs` is fine) and one is a duration convention; durations should be one spelling, and the
memory note "precise names over compat" says take the rename. Also `maxAgeInSeconds` vs `maxAgeSeconds`
both exist. **Verify:** a lint rule or a test over the exported option types' keys.

### Q12. Transactions are positional on services and an option on repositories — MINOR
*Filed 2026-10-21.*

50 service methods outside `data-source/` take `transaction: Transaction | undefined` as a positional
parameter (`auth.service.ts` 12, passkey 11, `role.service.ts` 4, federated 4 …), e.g.
`revokeApiKey(userId, apiKeyId, transaction)`, `deleteMembership(userId, tenantId, transaction)`, while
every repository method takes `options.transaction`, `withLease` takes `options.heldUntil`, and
`findAllPaginated(page, limit, options)` mixes positional and object. A caller moving from a repository
to a service changes convention. Recommend `options: { transaction? }` as the last parameter everywhere
a method can take one. **Verify:** a type test over the service interfaces.

### Q13. `Base` prefix is applied to some extension points and not others — MINOR
*Filed 2026-10-21.*

Extended-by-the-app classes named `Base*`: 22 (`BaseLdapAuthenticator`, `BaseScimProvisioner`,
`BaseFsBackupTransport`, `BaseRateLimiter`, `BaseCache`, `BaseEntity` …). Extended-by-the-app abstract
classes without it: `PostgresDataSource`, `ValKeyDataSource`, `TypeOrmBaseDataSource` (the prefix in the
middle), `CronJob`, `Migration`, `ZibriPlugin`, `CodeTwoFactorMethod`, the 12 `*Cache` strategy classes,
`ModelDescriptor`. The memory rule ("provider classes apps extend are `Base{Provider}`") is followed in
auth and backup and not in data sources, cron, migrations and plugins.

**Errors.** 14 classes extend `HttpError`, 33 extend `InternalError`, 3 extend `Error` directly
(`ExternalError`, `InternalError`, `HttpClientError`). A caller can discriminate by class and by
`HttpStatus`; store errors are typed (`UniqueConstraintViolationError`, `CheckConstraintViolationError`,
`StoredValueTypeMismatchError`, `QueryFailedError`). Consistent; no finding beyond Q2's note that the
classification is by message today.

**Decorator vocabulary.** 46 decorators; routing uses `@Get/@Post/@Put/@Patch/@Delete` + `@Controller`
+ `@Param/@Body/@Response`, websocket mirrors it (`@WebsocketController/@WebsocketRoute/@WebsocketBody`),
entity `@Entity/@Property`, auth `@Auth.*`, `@HasPermission/@HasPlatformPermission` (the `@HasRole`
pair is deleted in the working tree), caching `@Cache/@Cached/@CacheDelete/@CacheInvalidate/@CacheWrite`
— five cache decorators where the others are one namespace (`@Auth.*`). The DI ones (`@Inject`,
`@Injectable`, `@InjectRepository`) and the repo markers (`@UserRepo`, `@RoleRepo`, `@MembershipRepo`)
are consistent with each other. **MINOR:** fold the cache five into `@Cache.*` as `@Auth.*` is.

**`start…/confirm…` pairs.** `startSignIn/completeSignIn`, `startSignUp/completeSignUp`,
`startConnection/completeConnection` vs `confirmPasswordReset`, `confirmTwoFactorRegistration`,
`confirmSubscribeToList` — two verbs for the second half. The user's list already names the
`startLinkIdentity/confirmLinkIdentity` rename; pick `confirm` (or `complete`) once.

**`allowOrphan`** is used identically on `@Entity`, `@DataSource` and controllers — consistent.

### Q14. Published JSDoc carries the reasoning CODE_STYLE puts in `//` comments — MINOR
*Filed 2026-10-23, found by the 08 structure pass.*

CODE_STYLE splits the two audiences: JSDoc is published by typedoc and states what a thing does and
what a caller gets; why this approach and not the obvious one goes in an inline `//` comment. A grep
for the two plainest markers, `deliberately` and `on purpose` on a JSDoc line, finds 58 lines in 50
files of `zibri` and 3 lines in 2 files of `zibri-testing` (none in `zibri-tsx`). Examples:
`ServiceUnavailableError` ("Distinct from a 500 on purpose: nothing went wrong…",
`service-unavailable.error.ts:10`), `GatewayTimeoutError` (`:9`), `HttpClientOptions` ("Scoped to this
client rather than installed with `setGlobalDispatcher`, deliberately: …",
`http-client-options.model.ts:65`), `ZibriApplication`'s last lifecycle step (`application.ts:594`),
`register-ts-node.function.ts:63`, `promise.utilities.ts:37`.

Not every hit is wrong, and not every wrong block is a hit: "The process running it stopped on purpose"
(`thread-job-status.enum.ts:8`) describes behavior and stays; some hits sit on unexported symbols, which
typedoc does not publish; and reasoning phrased as "rather than X, because…" carries neither marker.
So each block is read, the part that tells a caller something stays, and the why moves to a `//`
comment beside the code it explains.

**Verify:** a test over the typedoc JSON output (`typedoc --json`) that no exported symbol's comment
contains `deliberately`, `on purpose` or `rather than`, with a short allowlist for the ones that
describe behavior. The docs-style test cannot do it: it reads `docs/`, not the published API.

### Q15. `MetadataUtilities` holds the metadata accessors of every subsystem — MINOR
*Filed 2026-10-26, split out of §Q9 (user's scope: the data layer first).*

`utilities/metadata.utilities.ts` imports at runtime from `auth`, `routing`, `websocket`, `backup`,
`data-source` and `open-api`, so every directory that imports it, the data layer included, sits in
a runtime cycle with all of them through `utilities`. §Q9's test checks direct edges only, which is
why the data layer passes while this cycle stays. Split it per subsystem: `RouteMetadataUtilities`
in `routing/`, `WebsocketMetadataUtilities` in `websocket/`, the auth accessors in `auth/`, and the
backup and data-source ones beside their decorators. Leave a small generic reflect wrapper in
`utilities/`. **Verify:** `__testing__/evaluation/subsystem-imports.evaluation.test.ts`, red
today with 17 runtime imports from `metadata.utilities.ts` and one from
`validate-entities-registered.function.ts` (of `application`), asserts that `utilities` imports at
runtime none of the subsystems built on it.

### Q16. `HttpStatus` ties `error-handling` and `http` into a cycle — MINOR
*Filed 2026-10-26, split out of §Q9.*

Every http error class in `error-handling/errors/` imports `HttpStatus` from `http/` (30 imports),
and `http/` imports `error-handling` (4). The evaluation test also finds `error-handler.ts` and
`error-handler.model.ts` importing the http request and response models, `KnownHeader`, `MimeType`
and `JsonMimeType`, and `method-not-allowed.error.ts` importing `HttpMethod`. So moving the enum is
half of it: the error handler, which writes the response, belongs in `http`, and the plain enums go
to `types` or `error-handling`. **Verify:** `__testing__/evaluation/subsystem-imports.evaluation.test.ts`
asserts that `error-handling` imports nothing of `http` at runtime (red today).

---

## Already filed

- 6 round trips in `findAllPaginated` and `inject()` per statement — round-2 01 §D4, §Q3 (referenced in
  Q1, not re-filed).
- Error classification by parsing English pg messages — round-2 02 §S4 (referenced in Q2).
- Comment and doc articulation — `after-all-findings-fixed.md` bullet 3 (measured in section 4).
- Partial backups abandoned — `after-all-findings-fixed.md` bullet 9 (folded into Q5 as the fourth queue).
- Hardcoded auth constants — `after-all-findings-fixed.md` bullet 13 (Q7 is the shape answer).
- Valkey transaction deadlock ending — 10 §10.6, deferred on purpose.
- No instance identity, framework emits no events, 17 sweepers, unindexed poll columns — round-2 06
  §F12/§Q4/§Q9 (referenced in Q5, Q6, Q8 with this review's own counts).

## Not reviewed

`plugin/` (6,117 lines: payment, invoicing, mailing list), `open-api/` beyond the barrel,
`localization/`, `document/`, `tsx/`, `handlebars/`, `backup/` internals beyond the entity, the bodies
of `auth/scim/*`, `auth/encryption/*` and `websocket.service.ts`; the `packages/cli` and `packages/tsx`
packages; test files beyond their wiring to case files; whether the four cross-directory import families
that look like cycles through `di/` (which is a registry of every service's token and is expected to
reach everything) ever form a runtime initialisation order problem under ESM.
