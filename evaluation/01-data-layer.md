# Data Layer — Data Sources, ORM, Repositories, Migrations, Change Sets, Backups

All paths relative to `packages/zibri/`.

---

## CRITICAL

### C1. `synchronize` is ON by default — schema auto-mutation in production — ~~CRITICAL~~ **FIXED**

> **Closed**, held by `schema-management.evaluation.test.ts`.
>
> `synchronize` is **gone from `PostgresOptions`** — the type omits it — and a data source now states
> `schemaManagement: 'synchronize' | 'migrations' | 'external'` as a required member. Deleting the
> option rather than flipping its default is the part that matters: a default can be overridden by
> whoever copies the wrong example, while a required member is a compile error until somebody decides.
>
> Closed by making the choice *required* rather than by picking one, the same shape as
> [03 A1](./03-auth-and-security.md#a1). Every value here is right for somebody, and the wrong one is
> only noticed after it has already dropped the column.
>
> `'migrations'` with no migrations is refused at boot rather than left to surface as a failing query,
> which is the one runtime case left to assert — the rest is caught by the compiler. `'external'` is
> what says an empty migration list is deliberate.

The original finding, for the record:

`src/data-source/data-sources/typeorm-base-data-source.model.ts:170-175`

```ts
// Only skip if synchronize has been explicitly set to false
if (this.options.synchronize === false) { return; }
await this.ds.synchronize();
```

TypeORM's `synchronize()` issues ALTER/DROP statements to make the database match the entity
classes. This is opt-**out**, not opt-in. Rename a property, deploy, and the old column plus its
data is dropped. It also runs *after* `runMigrations()` (line 168), so it can undo what a
migration just did.

`docs/data-source.md:55` and `:272` both show `synchronize: true` in the primary example, and no
document anywhere warns that this is unsafe in production.

### C2. Migrations have no lock — every replica migrates concurrently — **FIXED**

> **Closed.** `DataSourceInterface` gained `withLock`, and `init` now runs the whole schema
> setup block — `createMigrationTableIfNotExists`, `runMigrations` and `synchronize` — inside it.
> Postgres takes `pg_advisory_lock(hashtext('zibri.schema'))` on a single held connection; ValKey,
> which also runs migrations, uses `SET NX PX` with retry. Both bounded by
> `ZIBRI_DI_TOKENS.LOCK_TIMEOUT_IN_MS` so a stuck instance fails loudly instead of blocking
> every other boot silently.
>
> Proven by `src/__testing__/evaluation/cluster/migrations.cluster.test.ts`, three instances with
> `bootMode: 'simultaneous'` — the one place the harness uses it, and the reason it exists.
>
> **There were two races here, not one, and the original finding only named the migration.** The
> test first failed on `duplicate key value violates unique constraint "pg_type_typname_nsp_index"`
> — a *postgres catalog* index, from two instances running `synchronize()` and both issuing the
> same `CREATE TABLE`. The migration race had not even fired that run: the log line above the error
> read `skipped 1 migrations that have already been applied`, because one instance happened to win.
>
> Two consequences worth keeping. The migration race is *latent* underneath the synchronize one, so
> a test that only removed the lock from `runMigrations` would still look green until timing shifted.
> And the symptom of unguarded DDL is a unique violation on a postgres internal catalog index, which
> names nothing about the application and is close to unsearchable.

The original finding, for the record:

`src/data-source/migration/run-migrations.function.ts:36-58` reads the applied versions and then
runs. No advisory lock, no `SELECT ... FOR UPDATE`, no unique-constraint enforcement on
`MigrationEntity.version`.

A Kubernetes rolling deploy with three or more replicas has all three running the same DDL at
once → deadlocks, duplicate columns, or a failed boot.

### C3. Down-migrations run automatically on version downgrade — ~~CRITICAL~~ **FIXED**

> **Closed, and the detection logic never changed - only what it does.** An applied migration whose
> version is newer than the app used to be reverted at boot. It is now refused at boot, naming the
> migrations, and `revertMigrationsAfter(version)` on `DataSourceInterface` is the deliberate way
> back. `down()` and `runDown()` survive; they are simply no longer reachable from starting a
> process.
>
> **The design note below argued for something else, and the user's pushback was right.** It proposed
> dropping the app version as the source of truth and selecting migrations purely from the database's
> record, the way flyway and rails do. Two things defeated that:
>
> - **the app version is already this framework's compatibility axis.** `router.ts:164` resolves a
>   route's `versions: ['^latest']` against `GlobalRegistry.getAppData('version')`, and the websocket
>   service does the same. Routes declare which app versions they serve. Having the *schema* answer to
>   a different source of truth would have been the inconsistent choice, not the principled one.
> - **the comparison was to the wrong systems.** Flyway and liquibase are tools external to any one
>   application, so of course the database is their authority. The right analogue is Android Room,
>   where `@Database(version = N)` lives on the app, migrations bridge versions, and a database ahead
>   of the app is an **error it refuses to open** - never a silent revert. Version-as-contract and
>   never-auto-revert were never in tension; only auto-revert was ever the defect.
>
> **What refusing does and does not buy.** It stops an old instance *joining* a cluster whose schema
> has moved on, and it ends the revert/re-apply loop where pods of two versions fight over the schema
> across a rolling deploy. It cannot prevent the deploy window itself - the framework does not control
> the orchestrator, and every rolling update briefly runs both versions - so expand/contract is still
> what makes that window safe, and that is a documentation matter rather than something code can
> enforce.
>
> **The trap this had to avoid.** Refusing without a way back strands a rollback: deploy v2, it
> applies a migration, v2 is bad, v1 then refuses to start and neither version runs. So the revert
> shipped in the same change rather than being filed after it. The supported sequence is stop the
> newer instances, revert, deploy the older build - which is exactly "do not run mixed versions",
> spelled out as an operation.
>
> Two smaller things fixed on the way past: reverts now run **newest first** (the old loop went in
> declaration order, so a migration could be undone before the one it depended on), and refusing is
> decided from the *recorded* rows rather than from the build's migration list, so it also catches a
> database holding a migration this build never had - which is the actual rollback case.
>
> **Still open:** `version` is doing two jobs, identity and compatibility gate. Applied-ness is tested
> with `includes(m.version)`, so two migrations declared with the same version mean the second is
> treated as already applied and silently never runs, and `runDown`'s `deleteAll({ version })` would
> delete both records. Ordering is declaration order rather than the version. Filed as
> [M23](#m23-a-migrations-version-is-also-its-identity--major).
>
> **Held by `migration-downgrade.test.ts`**, which was missing until the evaluation suite's todos were
> audited: a 1.0.0 application restarting against a database holding a 2.0.0 migration it carries and
> a 2.1.0 one it does not refuses to start, names both, and runs no `down`.

The design note that produced the above, kept because the comparison is the useful part:

> **Nobody else auto-reverts.** Checked rather than assumed:
>
> | | Applies forward | Reverts |
> |---|---|---|
> | Flyway | `migrate`, everything unapplied, in order | `undo` — separate command, never on start |
> | Liquibase | `update` | `rollback` with an explicit count, tag or date |
> | Rails | `db:migrate` | `db:rollback`, explicit |
> | Django | `migrate` | `migrate <app> <earlier>`, explicit |
> | Prisma | `migrate deploy`, pending only | none; drift is an error, not an action |
> | EF Core | `Database.Migrate()` | `database update <previous>`, explicit |
>
> Two things are unanimous. Reverting is never a side effect of a process starting, and **none of
> them consult the application's version at all** - they compare what the build carries against what
> the database records. The kubernetes convention goes further: migrations run as a Job or
> initContainer *before* the rollout, not per pod at boot, and mixed-version pods are handled by
> expand/contract rather than by making the schema follow whoever restarted.
>
> **"Mixed versions might not work anyway" argues *for* this, not against it.** It is true that an
> old pod against a new schema is not guaranteed to be happy. But the two failure modes are not
> comparable:
>
> - *old pod, newer schema* — some of its queries may fail. Bounded to that pod, ends when it is
>   killed, nothing is lost. Frequently fine, since additive changes are invisible to it.
> - *old pod reverts* — mutates the schema the **healthy** pods are serving on, cluster-wide, and a
>   `down()` that drops a column takes the data with it. No restart recovers that.
>
> One pod misbehaving versus one pod breaking everyone else permanently. The asymmetry decides it
> even granting the premise entirely.
>
> And in a rolling deploy this is not a single event. Pods of both versions start repeatedly -
> restarts, scale events, liveness kills - so the old one reverts, the new one re-applies, the old one
> reverts again. Each cycle is real destructive ddl. The finding calls this "pods fight"; it is a
> loop, not a risk.
>
> **Where the note then went wrong.** It concluded from the table that the app version should stop
> deciding anything, and that selection should be purely "what the build carries that the database has
> not recorded". That was over-reading the evidence: the unanimity in the table is about *reverting*,
> and the systems in it are external tools with no application version to consult in the first place.
> The framework's own route versioning is the counter-example, and it is the one that counts. See the
> closing note above.

`src/data-source/migration/run-migrations.function.ts:50-53, 60-63`

Any migration whose version is greater than the current app version is **reverted at startup**.
During a rolling deploy or a rollback, an old pod boots and destroys the schema the new pods are
using. Blue/green with mixed versions makes pods fight (up → down → up → down).

`docs/data-source.md:304-306` shows `down()` implemented as
`throw new Error('Not implemented yet.')` — the documented example, so a rollback crashes at boot
instead.

### C4. `CREATE EXTENSION` on every boot requires superuser — ~~CRITICAL~~ **FIXED**

> **Closed.** `installTrigramExtension` issues `CREATE EXTENSION IF NOT EXISTS pg_trgm`, and postgres
> answers that for an installed extension without asking whether the role may create one. That covers
> the common enterprise setup: a managed postgres has the extension provisioned by somebody with the
> rights, and the application role has none.
>
> Missing *and* not creatable is now a warning rather than a raise. Refusing to start would take the
> whole application down over one filter operator, so the log line names `fuzzyLike` — the only thing
> that stops working — and tells the reader which statement to have run once.
>
> Held by `trigram-extension.evaluation.test.ts`, which landed with the fixture
> [C6](#c6-backup-means-the-app-process-holds-postgres-superuser-credentials-and-dumps-the-whole-cluster)'s
> todo needed. `zibri-testing` no longer connects a data source as the container's superuser: it
> creates the data source's role the way a managed postgres does, owning its database and holding
> nothing else, so **every container-backed suite now boots as a least-privilege role**. That alone
> does not reach this fix, because pg_trgm is a trusted extension and the owner of a database may
> install it. So the file takes CREATE on the database away from its own role after the first boot,
> then boots again twice: once with the extension installed (no warning), and once after dropping it
> (the boot goes ahead, warns naming `fuzzyLike`, and the extension is still absent).
>
> **The `pg_extension` pre-check is gone, confirmed by a container run on 2026-09-27.** Reading
> postgres's `CreateExtension` said `IF NOT EXISTS` returns on an existing extension before any
> privilege check, which made the pre-check a second way to say what the statement already says, and
> its doc comment claimed the opposite. With the pre-check in place the first case was green either
> way; without it, that case runs the statement as a role that may not create anything, and it is
> green. The case this fix actually changed is the missing-and-not-creatable one, which used to refuse
> to start.

The original finding, for the record:

`src/data-source/data-sources/postgres-typeorm-data-source.model.ts:84`

```ts
await this.ds.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
```

Unconditional, even if `fuzzyLike` is never used. Managed Postgres (RDS / Cloud SQL / Azure) with
a least-privilege application role cannot run this, so the app will not start. Most enterprise
DBAs do not grant extension or DDL rights to application roles at all.

### C5. SQL is built by string concatenation, not parameters — ~~CRITICAL~~ **FIXED**

> **Closed**, held by `sql-building.evaluation.test.ts` — all four vectors green, with both controls
> still green beside them so the reds meant what they said.
>
> Every value a caller supplied is now bound rather than written into the statement, through
> `Raw(sql, parameters)` and a new `TypeOrmParameters` collector. `toSqlLiteral` is **deleted**
> rather than corrected — a hand-rolled escaper is the finding, not a detail of it.
>
> `TypeOrmParameters` lives on the **shared** `TypeOrmWhereFilterConverter`, not on the postgres
> subclass. The `:name` placeholder is typeorm's own convention rather than any one dialect's — the
> mysql/mariadb driver scans for the identical pattern and emits `?` where postgres emits `$N` — so
> a second sql data source inherits this instead of repeating it. What is dialect specific is the
> sql around the placeholder, which is why the `::text` / `::jsonb` casts stayed behind.
>
> **The two sentinels survive, and that is the part worth keeping.** `$$COL$$` and `$alias$` were
> never the bug. Substituting a column into a finished statement is safe as soon as the statement
> holds nothing the caller wrote, so both remain, each behind a doc comment naming that as the
> condition it depends on. Only one of the four vectors needed the mechanism changed rather than
> starved of input.
>
> **The json key is bound too, not escaped.** A json key is not a sql identifier and does not have to
> be spellable as one — `line-items` is an ordinary key. The array element *alias* is the one thing
> that could not be bound, because an identifier is not a value, so it is generated from a counter
> instead of built out of the field name.
>
> **Parameter names have to be unique per query, not per condition.** Typeorm merges the parameters
> of every raw operator into one set, so two conditions reusing a name would mean the second silently
> deciding what the first compares against. The counter therefore lives on the converter and never
> resets.
>
> **Found while fixing, and not in this finding:** the five `array_length` handlers on the *base*
> converter concatenated their filter value the same way. They are typed as `number` and nothing
> checks that at runtime, so `{ tags: { length: <request value> } }` was the same vector one class up
> from the ones listed below. Bound now, which turns it into the database refusing a bad value.
>
> **What binding alone did not close.** Two of the four vectors use an id that is not a uuid. The
> `IN` list can no longer be rewritten, but postgres still parses the bound text as `uuid` and raises
> `22P02` — the open half of [M21](#m21-a-malformed-id-is-a-500--nothing-checks-the-id-against-the-format-it-declares--fixed),
> where the narrowing does not descend into a relation. `dropImpossibleConditions` now judges the
> entities a relation filter names, under the rule that settled M21: valkey filters in process and
> already answers `[]`, postgres errors, and the narrowing exists to make the two agree. The two
> operators are not symmetric — `includes` asks for a relation holding *all* of them, so one entity
> no row can be kills the branch; `isIncludedIn` is an allow list, so an impossible entry is one
> fewer permitted value.
>
> **Still open, deliberately.** An `isIncludedIn` allow list whose entries are *all* impossible is
> left exactly as it was. Narrowing it to `[]` would hand it to the converter's
> `entities.length === 0` short circuit, which answers `FALSE`, while the valkey evaluator's `.every`
> is vacuously **true** for a row with no related rows at all. That divergence is pre-existing and is
> a different finding; narrowing must not be the thing that changes an answer.
>
> **Also not covered**, and out of reach of this fix: table and column names still reach the
> statement as quoted identifiers built from entity metadata. They are declared in code rather than
> sent by a caller, and an identifier cannot be bound. `minSimilarityRatio` and the relation `length`
> value are likewise still written into the statement, on purpose — both are numbers by construction,
> and a `NaN` there fails loudly instead of quietly matching nothing.

`src/data-source/data-sources/where-converter/postgres-typeorm-where-filter.converter.ts`

- `:347-348` — `${jsonbAlias}->'${fieldKey}'`. The JSONB field key is interpolated into a SQL
  string literal with **zero escaping**. A key containing `'` breaks out.
- `:322` — `elem_${fieldKey}` used as a bare SQL identifier.
- `:212, :229, :259, :276` — ``entities.map(e => `'${e.id}'`)``. Entity ids interpolated with no
  escaping at all.
- `:396-413` — `toSqlLiteral` is a hand-rolled escaper that only doubles `'`.
- `:18` `ALIAS = '$$COL$$'` plus `:134` `sql.replaceAll(ALIAS, quotedAlias)`, and `$alias$` at
  `:172`. A *value* containing `$$COL$$` or `$alias$` rewrites the generated SQL.

The `:68` ratio bullet in the original write-up was **wrong** and has been dropped.
`parseFuzzyLikeFilter` computes `minSimilarity / 100`, which is a number or `NaN` whatever it is
given, so it cannot carry SQL. A `NaN` produces a failing statement, not an injected one.

The reachability claim was **also wrong**. `CrudController.findAll` takes `page` and `limit` and
nothing else (`src/routing/models/crud-controller.model.ts:82-89`), so no built-in route accepts a
filter. What makes this reachable is ordinary application code: an endpoint that turns a search box
or a facet into a `where` is the obvious way to write one, and at that point the *values* are
request input even though the keys are not. That is the whole surface — and it is enough, because
values are what `$$COL$$` and the id interpolation are read out of.

Even absent any of that, this is no defence in depth, and it defeats prepared-statement plan
caching entirely.

Held by `src/__testing__/evaluation/sql-building.evaluation.test.ts`. **All four vectors confirmed
red**, with both controls green — so quote doubling does hold for an ordinary value, and these are
about the specific inputs.

The id vector is the one to lead with, because the generated statement is the proof:

```sql
... AND "eval_sql_shipment"."id" IN ('') OR ('1'='1')) = 1
```

The `OR ('1'='1')` is appended to the `WHERE` clause. Postgres then rejects it on the *uuid* column
type — `invalid input syntax for type uuid: ""` — so on this entity the attempt errors rather than
returning every row. That is the column type refusing it, not the query builder: the structure of
the statement was already changed by the time it got there, and an entity with a `string` id has
nothing standing in the way.

The other three:

- `$$COL$$` in a value returns **0 rows instead of 1**, silently — the comparison became
  `label = "EvalSqlOrder"."metadata"` and no error is raised anywhere
- `$alias$` in an id is substituted the same way: `IN ('EvalSqlOrder.id')`
- a kebab-case JSONB key produces `AS elem_line-items` and a hard `syntax error at or near "-"`

### C6. Backup means the app process holds Postgres superuser credentials and dumps the whole cluster — ~~CRITICAL~~ **FIXED**

> **Closed**, held by `backup.evaluation.test.ts`. Six changes, all in one file, and two of them are
> not what the finding predicted.
>
> **The same over-reach turned out to sit one level further down, and the first container run is what
> found it.** The obvious fix is `pg_dump --schema <s> --clean --if-exists`: one database, one schema,
> and pg_dump's own list of drops for what it dumped. It failed on
>
> ```
> ERROR:  cannot drop schema public because other objects depend on it
> DETAIL:  extension uuid-ossp depends on schema public
> ```
>
> Naming a schema explicitly makes the *schema* one of the dumped objects, so `--clean` emits
> `DROP SCHEMA IF EXISTS public;` — and an application that stores its tables in a schema no more owns
> that schema than it owns the cluster its database sits in. It would have been wrong even if postgres
> had allowed it: the dumped tables default their ids to `public.uuid_generate_v4()`, so the drop takes
> the extension the restore then needs. **`--clean` is `pg_dumpall` in miniature** — a tool reaching
> past the thing it was asked about — which is why the fix is the same shape as the outer one rather
> than a flag adjustment.
>
> So `--clean` is gone and the dump is **purely constructive**: no `DROP` of any kind. The restore
> clears the tables it is about to recreate itself, as the first statement inside psql's own
> transaction, scoped to ordinary tables and skipping any that belong to an extension. Two things fall
> out of that. `--schema` is no longer needed to keep `DROP EXTENSION` out — nothing is dropped — so
> the dump covers the whole database again, and no object kind can silently fall out of a backup
> because it was not a table. And an artifact holding a `DROP` per table is a loaded gun once it is
> copied somewhere; removing what is already there is now a decision taken against the target the
> restore was actually pointed at, which is asserted by its own test.
>
> `pg_dumpall` of the cluster became `pg_dump` of the one database this data source addresses. Root
> credentials are no longer required: a backup covers the
> objects the application owns, so it runs with the application's own credentials, and
> `rootUsername`/`rootPw` demote to an override for a separate backup role. Setting one without the
> other is now refused at boot instead of half applied.
>
> **The worst part of this was not in the finding, and the produced artifact is the proof.** A stored
> dump opened with:
>
> ```sql
> CREATE ROLE postgres;
> ALTER ROLE postgres WITH SUPERUSER ... PASSWORD 'SCRAM-SHA-256$4096:QsF2IZ+iiiH4SBf1JkIUjw==$...';
> ```
>
> Every login role on the server, with its password verifier, written by `BaseFsBackupTransport` into a
> plain file — and by any other transport into whatever bucket it targets. The finding argued about
> the credentials going *in* to the backup process. What actually happened is that credentials came
> back *out* of it, into an artifact that is copied off-host and kept for years. That is the assertion
> the test leads with.
>
> **"Restore is very likely broken" was wrong, and what is true instead is worse.** psql honours the
> `\connect` in a cluster dump, so the restore did run. But nothing set `ON_ERROR_STOP`, and psql
> exits 0 whatever the statements did — so a restore that applied nothing was indistinguishable from
> one that worked, and the caller went on to serve traffic against a database it believed it had just
> repaired. `--set ON_ERROR_STOP=1 --single-transaction` is what makes the exit code mean something.
>
> The same `\connect` made `-d <database>` decorative: it overrides the target psql was pointed at, so
> restoring a dump into a differently named database silently wrote to the name the dump remembered.
> Dumping one database is what fixes that, not an argument change.
>
> `backupData.pipe(child.stdin)` is now guarded. The EPIPE the finding names is no longer hypothetical
> once errors are fatal — psql aborting on the first bad statement closes stdin while the dump is
> still being written — so the write error is absorbed and the exit code raised instead, since that is
> the one that says why psql stopped.
>
> **On `PGPASSWORD`.** The child no longer inherits `process.env`. That was the larger leak and the
> finding did not name it: `{ ...process.env, PGPASSWORD }` handed the dump child the jwt secret, the
> encryption master keys and the smtp credentials, none of which libpq reads. It now gets `PATH`, the
> locale variables, and every `PG*` variable already set — that last one deliberately, because
> `PGSSLMODE`/`PGSSLROOTCERT` is how tls to a managed postgres is configured and dropping them would
> turn a verified connection into a refused one. Held by `backup.evaluation.test.ts` through a stub
> `pg_dump` earlier on `PATH` that prints the names it was given: a planted `JWT_SECRET` is absent,
> `PGSSLMODE` survives, and nothing outside `PATH`, the locale and `PG*` arrives.
>
> **`PGPASSFILE` was decided against.** It is libpq's preferred channel, but a 0600 file and
> `/proc/<pid>/environ` sit behind the same uid boundary, so it buys a temp file that has to be
> cleaned up after a crash and no boundary that was not already there. What did move the needle is
> that the password is no longer the *cluster superuser's*.
>
> **The binaries are checked at boot.** `pg_dump` and `psql` are a runtime-image dependency that
> nothing declared; the moment it was discovered by accident was the moment a restore was needed.
> `validateBackupConfiguration` now starts each one and refuses to boot by name if it cannot.
>
> **Least privilege is held, not only "no root credentials required".** `zibri-testing` provisions the
> data source's role as the owner of its database with neither SUPERUSER nor CREATEROLE (see
> [C4](#c4-create-extension-on-every-boot-requires-superuser--critical-fixed)), so every case above
> runs as that role. *takes and restores a backup as a role with neither SUPERUSER nor CREATEROLE*
> asks the server to confirm it first. The contract the todo asked to have stated: the role **owns the
> database**, which is what lets a dump read every object and a restore replace them.
>
> **Still not covered.** `--no-owner`,
> `--no-acl` and `--no-comments` mean the artifact carries schema and data but not the grants and
> comments around them, which is a trade rather than a fix. Client-tool version against server version
> is unchecked. The restore clears every ordinary table in the database, so a schema shared with
> another application's tables is not an arrangement it survives — and if a future entity model emits
> an object kind that is not a table, the restore fails loudly on it rather than silently skipping it,
> which is the failure mode to prefer but still a failure. And a restore replaces the objects it
> dumps, so it still needs ddl rights on the application's own tables — no design removes that, and
> the finding's complaint was superuser, not ddl.

The original finding, for the record:

`src/data-source/data-sources/postgres-typeorm-data-source.model.ts:88-94, 118-174`

- `validateBackupConfiguration` *requires* `rootUsername` / `rootPw`.
- `createBackupData` shells out to **`pg_dumpall`** — every database on the server plus global
  roles, not just this app's.
- `restoreBackup` pipes that into `psql -d <database>`. A `pg_dumpall` stream contains `\connect`
  and `CREATE ROLE` statements and is not a valid single-database restore. Restore is very likely
  broken.
- `:162` `backupData.pipe(child.stdin)` with no `stdin.on('error')` — `psql` exiting early raises
  EPIPE as an unhandled stream error and crashes the process.
- `PGPASSWORD` in the child env is readable via `/proc/<pid>/environ`.
- Requires `pg_dumpall` / `psql` binaries in the runtime image; undocumented.

---

## MAJOR

### M1. No optimistic locking, no version column, anywhere — ~~MAJOR~~ **FIXED**

`src/entity/base-entity.model.ts:6-12` — `BaseEntity` is `{ id: string }` only. No `version`, no
`createdAt` / `updatedAt`. No `version: true` option in any property metadata, no `SELECT FOR
UPDATE` helper, no compare-and-swap. Concurrent `updateById` on the same row is a guaranteed
silent lost update.

**FIXED, and the version column is declined.**

Two parts of the finding turned out to be wrong. There *is* a compare-and-swap: `updateById` takes a
`where` that is applied as part of the write, and its own documentation describes this exact
scenario. And there is a `SELECT FOR UPDATE` — `updateAll` has taken row locks since M20. So the gap
was never that nothing could express a conditional write; it was that nothing made one mandatory,
which leaves the safe path the one you have to remember.

**A version column is the wrong unit.** A counter is a token for the whole row, so it conflicts on
any concurrent write: two people editing a company's name and its phone number would be told they
clashed when nothing they touched overlapped. What clashes is a property, which means comparing
values rather than a token — and the value that matters is the one the editor was looking at, which
the server does not have. By the time the update arrives, reading the property returns the value
*including* the other write. So it has to come back from the caller, which is what `where` already
is. It also expresses what a counter cannot: guarding on a property you read but are not writing —
`discount` changed because of a `price` that must not have moved.

That leaves the declaration with nothing to fill in, only something to insist on.
`@Property.string({ optimisticLocking: true })` refuses an update naming that property unless the
filter names it too, on `updateById` and `updateAll` alike. Every branch of an OR filter has to name
it, because a filter is only as locked as its weakest branch. Naming it with no value — `{ name: undefined }` — is
how a caller says it means to overwrite regardless, told apart from having forgotten by the key being
present rather than the value being set, so a filter that was built and came out empty is still
refused. Both where converters already skip an undefined value, so the escape hatch needed nothing.

**A failed condition is answered by what the caller may see.** The two cases are genuinely different
— a row that changed under you is worth reading again, a row that was never yours is not — and
collapsing them into one answer throws away the useful half. Telling them apart *by which condition
failed* would be an existence oracle on every scoped entity, so that is not how it is done: the row
is read again with the caller's own condition dropped and the entity's scope still applied. Visible
means it changed, which is a `ConflictError`; invisible means `NotFoundError`, the same answer a row
that does not exist gets. What decides the answer is exactly what the caller was already allowed to
read, so nothing is disclosed that a plain `findById` would not have disclosed.

Still open: `upsert`'s `onConflict` is an update that the declaration does not reach, and the refusal
happens at write time rather than at startup — nothing at boot can tell which call sites will write
which property.

### M2. No way to declare a database index — ~~MAJOR~~ **FIXED**

- `src/entity/decorators/entity.decorator.ts:13-36` — `EntityMetadata` is
  `{tableName, allowOrphan, allowDuplicate, defaultOrder, defaultRelations}`.
- `src/entity/models/string-property-metadata.model.ts:87-135` has `unique` but **no `index`**.
  No composite index, no partial index, no covering index, no check constraint, no schema name.
- `postgres-typeorm-data-source.model.ts:281-349` (`propertyToColumnOptions`) never emits an index.
- The migration API (`data-source.interface.ts:84-107`) offers only `addPropertyToEntity` and
  `changePropertyOfEntity` — there is no raw-DDL escape hatch on the interface.

You cannot index your database through Zibri.

**FIXED**, for the two forms that carry the weight. `index: true` on a string, number, date or
boolean property, and `indexes: [['tenantId', 'status']]` on the entity for a lookup spanning
several — the same two places `unique` is declared, so there is one shape to learn rather than two.
`unique` itself lives only on string and number, which is right for uniqueness and wrong for
indexing: the most common index after a foreign key is on a date, so the type set is wider than its
model.

Both forms are merged into one list by a `KeyDescriptor` in the `ModelRegistry`, resolved once per
class, and the schema takes its `indices` from there under a deterministic `idx_{table}_{columns}`
name — the same reason `uniqueConstraintName` exists, since a migration adding or dropping one has
to name what the schema created.

Building it turned up something the finding did not name. `uniqueGroupFor` read only the entity's
`uniques`, so a property declared `unique: true` was unique in the database but could not identify a
row for an `upsert` — the fix being to name the column a second time under the entity, which reads as
redundant and was load-bearing. The valkey driver already disagreed, treating a property `unique` as
a group of one when it built its indexes. Both now read the descriptor, so what counts as unique is
decided in one place, and `uniqueGroupFor` no longer walks the property metadata on every upsert.

> **That fix only ever worked on valkey.** The paragraph above made the identity *resolve*, and its
> test asserted exactly that and nothing further. On postgres the upsert then named its conflict target
> `uq_{table}_{column}` - the name `uniqueConstraintName` gives - while the schema had created the
> property's constraint as the orm's own column unique, under a generated hash, because only the
> entity's `uniques` were handed to the schema by name. Every upsert identified by a property's
> `unique` failed on "constraint does not exist". Found by the scoped upsert cases of
> [03 §A2](./03-auth-and-security.md), whose entity happened to declare its unique on the property.
> The schema now names every unique covering all rows from the descriptor, the property's own
> included, and the postgres column no longer declares one of its own - which it would have done as
> well, a second constraint beside the named one. **A database built before this carries the hashed
> constraint**; nothing has shipped with it, so it is redefined in place rather than migrated.
> `declared-indexes.test.ts` now asserts the constraint by name, that there is only one, and runs the
> upsert the resolution exists for.

Still open, deliberately: covering indexes and check constraints, and a `where` on an `index` — only
`unique` takes one, because only it had something asking. The partial *unique* landed with
[M13](#m13-soft-delete-plus-unique-is-unusable--fixed), as the portable `Where<T>` this entry
called for rather than as a raw SQL predicate; what it needed on top of the filter was a way to write
one down that a schema can be built from, since `WhereFilterConverter` produces a TypeORM
`FindOptionsWhere` and a predicate has to be sql. Also open is the startup check for a declaration
that another one already covers: an index that is a leading part of another, or a unique group
covering a column that is unique alone.

### M3. `updateAll` / `deleteAll` materialize the whole result set — ~~MAJOR~~ **FIXED**

`src/data-source/repository.ts:236-250`

```ts
const toUpdate = (await this.findAll({ where, ...options })).map(t => ({ id: t.id, ...data }));
await this.driver.save(toUpdate, ...);
return await this.findAll({ where, ...options });   // full re-query
```

Two full SELECTs plus a per-row save. `deleteAll` (`:273-283`) has the same shape. On
`ChangeSetRepository.updateAll` (`src/change-sets/change-set-repository.ts:106-111`) it becomes
**three** full SELECTs plus N change-set inserts. There is no `UPDATE ... WHERE` pushdown, so
`UPDATE t SET x=1 WHERE tenant=$1` over a million rows will OOM the pod.

**FIXED**, both halves, and they are different problems.

The statements come down to two. The write is one `UPDATE ... WHERE id = ANY(...)` rather than a
`save` per row — `save` is the primitive for writing rows that each carry their own values, which is
what the bound-encryption branch needs and the wrong shape for writing one value to all of them. The
select that precedes it stays, because it is what takes the row locks, but it reads **ids** instead
of entities: nothing about what a row currently holds decides anything on this path. `deleteAll` is
the same shape — its read cannot go, because the delete hook runs per entity, but the removal is now
one statement instead of one per row. Measured rather than timed, by counting what the driver issues:
300 rows went from 306 statements to 2.

One change still costs a statement per row, and has to: a relation is not a column on the row being
written. A many-to-many lives in a join table whose rows belong to one owner each, so an update
statement cannot express it and `save` is what writes it. The driver asks typeorm's own relation
metadata which of the two a change is, because it is typeorm's update builder that cannot express
the one — what counts as a relation has to be its answer rather than a second opinion.

**The return shape is the other half, and the count is now the default.** A bulk write knows how many
entities it changed without looking at any of them, so `updateAll` and `deleteAll` answer with that,
and `returnUpdated` / `returnDeleted` read them back for the callers that want them. The default is
the affordable one deliberately: what you get without thinking about it should be the shape that
cannot be forced to hold a table, and asking for the entities is then a deliberate act with a bound
on it — the same ten thousand M4 put on an unbounded `findAll`, checked before anything is written so
that being refused costs nothing. All six of the framework's own callers wanted `.length` and now say
so; the one that genuinely wants the rows is claiming work, and it asks.

`saveUpdateAll` draws the distinction the guard needs: a change set is written from the entities that
were updated whether or not anyone asked for them, so reading them back is not the same question as
handing them out, and only the caller's own ask is bounded.

Still open: `deleteAll` reads every matching entity even when only the count was wanted, because the
delete hook runs per entity and a hook is replaceable. Skipping that read when nothing needs it means
knowing that the configured hook does nothing for a delete, which the descriptors can answer and the
repository currently does not ask.

### M4. No default limit on `findAll` — ~~MAJOR~~ **FIXED**

`src/data-source/repository.ts:182-186`. `take` is optional and there is no configurable maximum.
One `findAll()` on a large table streams the whole table into the heap.

**FIXED**, though not with a default limit, which is the wrong shape for it. A default limit trims
silently, and a caller that loops over a trimmed result does part of its work — half the mails sent,
half the rows migrated — with nothing to say so. Silence is what makes that worse than the heap it
saves: an OOM is at least loud.

So a `findAll` that names no limit is read as a claim that the result fits, and the claim is checked.
One row past the cap is asked for, and getting it back is proof there was something beyond it, so the
call is refused with an error naming the entity and the ways to say what it meant. `take` becomes
`number | 'all'`: a number bounds the read, `'all'` is the unbounded read stated on purpose. Ten
thousand is the cap — not a memory figure, since ten thousand rows is a few megabytes, but the point
past which asking for everything has stopped meaning it. High matters: being refused is a hard
failure, and a cap that trips on ordinary work would be worse than the unbounded read it replaces.

The bound applies to the framework's own reads too, which is where it earned itself. Ten internal
call sites read without a limit; the ones that genuinely need every row now say `take: 'all'` and can
be found by searching for it — a backup sync deciding which backups are unrecorded, a rollback that
would otherwise land a row somewhere it never was, the rate limiter's own state rows, a reconnecting
socket's missed messages. The bulk write paths say it too, and there the annotation is the finding:
`deleteAll`, `updateAll` and the change-set reads pull every matching row into memory because a value
bound to its row cannot be written by one statement. That is M3, now marked at the four places it
happens rather than only described here.

### M5. `findAllPaginated` is not snapshot-consistent — **FIXED**

`src/data-source/repository.ts:195-209` — items and `count` are two separate statements outside
any transaction by default. Under concurrent writes the total and the page disagree; rows are
skipped or duplicated across pages.

> **FIXED, and the half the entry names was the smaller one.** The two statements are one
> `driver.findAndCount` now, and the skipping and duplicating had a second cause that no transaction
> would have touched.
>
> **A page was never ordered.** `toDriverFindOptions` passed `options.order ?? defaultOrder`, and
> `defaultOrder` is optional — four framework entities declare one and nothing requires it — so the
> ordinary paginated read reached the store as `LIMIT/OFFSET` with no `ORDER BY` at all. Which rows
> a page holds then depends on where each row happens to sit, and postgres answers an update by
> writing a new version of the row elsewhere: a table being written to reorders itself under the
> walk, so a row comes back on a later page and one that was never read is passed over. **No
> concurrent writer is needed for this** — the second page of an idle table is entitled to overlap
> the first. Where an order *was* declared it was usually a single column, and `createdAt` stops
> being a total order the moment two rows share a timestamp.
>
> Every read that takes part of its result — `findAllPaginated`, and `findAll` with a `take` or a
> `skip`, since "the first 20" is just as arbitrary — is ordered by primary key after whatever the
> caller asked for. The caller's order still decides the order; the key decides only what the
> caller's order left open. An unbounded read is left alone: it hands back everything that matched,
> so no position depends on anything, and an order nobody asked for is a sort the store has to do.
>
> **The snapshot is the driver's answer, not the repository's**, for the same reason `stream`'s
> cursor is. Wrapping the pair in a transaction at the repository would have been one code path that
> is wrong on both stores at once: at postgres's default READ COMMITTED every *statement* takes a new
> snapshot, so the two would have been as far apart inside a transaction as outside one, and valkey
> ignores isolation levels and logs a warning for each — every paginated read would have warned and
> gained nothing. The postgres driver takes a REPEATABLE READ transaction of its own when the caller
> passed none, which is the level at which one transaction sees one version of the database. Valkey
> and the in-memory driver read the matching rows once and window that, which is both the closest
> they can come to one moment and cheaper than what they did before — a filtered `count` on valkey is
> a second whole `find`.
>
> **What no per-call fix reaches** is a walk across separate requests: page 2 is asked for after page
> 1 came back, and a row inserted in between belongs somewhere. That is `findAllAfter`, built in the
> round after this one — a cursor naming the row the last page ended at, so that every row present
> when the walk starts is handed back exactly once however much is written meanwhile. It is a second
> method rather than an option on this one, because a page number and a cursor both say where the
> window starts and no call can honour both; the same reason AWS, Stripe and Relay all offer cursors
> *instead of* page numbers rather than beside them.
>
> The work turned out to be a type widening rather than new query machinery. "After this row" over
> several properties is an OR of ANDs, which `Where<T>` already expresses — an array of branches is
> an OR and several properties in one branch are an AND — so no driver learned anything new. What
> was missing was ordered comparison on strings, and only in the *type*: all three where-converters
> dispatch on the operator name, and `after`/`before` were already there for dates. The primary key
> is a uuid string, so without it a keyset read had no tiebreaker at all.
>
> Two decisions inside that are worth keeping. The comparison uses **each store's own text
> ordering** rather than a forced byte collation, because the filter has to agree with the `ORDER BY`
> it is walking - forcing `COLLATE "C"` on one and not the other breaks the walk outright and drops
> the index that makes keyset worth having. And a cursor carries a **fingerprint of the order and the
> resolved filter**, hashed rather than embedded: the branch's condition replaces the caller's on an
> ordered property, which is a narrowing only because the row the cursor came from passed that same
> filter - so a cursor from a different filter, or from another caller's scope, is refused rather
> than trusted.

### M6. Transactions are threaded by hand; a pool leak is one missing `finally` away — ~~MAJOR~~ **FIXED**

> **Found already closed while triaging this list.** `TypeOrmTransaction` releases the query runner
> in a `finally` on both paths, and `transaction.test.ts` carries a case named for the exact failure
> this describes — *"releases the pooled connection when the commit itself throws"*. The row was
> stale rather than open.
>
> What the entry also asks for — a `runInTransaction(cb)` helper — exists as
> `Repository.inTransaction`, which uses the caller's transaction when there is one and takes its
> own when there is not. It is what closed [M11](#m11-the-audit-trail-is-not-atomic-with-the-change-it-audits--major-fixed).
> There is still no AsyncLocalStorage propagation, and that is deliberate rather than missing: a
> transaction that travels invisibly is one nobody can see the extent of.

- `src/data-source/transaction/transaction.model.ts:8-17` — a `Transaction` is only
  `{commit, rollback}`.
- `src/data-source/transaction/typeorm-transaction.model.ts:12-21` — `release()` is called *after*
  `commitTransaction()` / `rollbackTransaction()` with **no try/finally**, so a throwing commit
  never releases the QueryRunner.
- `typeorm-base-data-source.model.ts:186-201` acquires a pooled connection per transaction.

There is no `runInTransaction(cb)` helper and no AsyncLocalStorage propagation, so every
repository call must be handed `{ transaction }` manually — forget it once and that statement
silently runs outside the transaction. The documented pattern (`docs/data-source.md:239-251`) is
exactly the leak-prone one.

**PARTLY FIXED.** Two of the three are closed; the helper is still open by decision.

The throwing commit is fixed: `TypeOrmTransaction.commit` and `.rollback` now release in a
`finally`. `ValKeyTransaction` already did this for its grants, so the typeorm one was the outlier.

The larger half of the finding was not the one it names. Threading `{ transaction }` by hand is
explicit and stays — a helper does not change it, and only ambient propagation would, which trades a
forgotten argument for a stray read silently joining a transaction nobody meant it to join. What is
actually unrecoverable is a transaction that reaches **neither** a commit nor a rollback: it holds a
pooled connection, and on valkey a grant on every row it wrote, for the life of the process. The pool
is fixed size, so enough of them and no query anywhere is served again; a valkey grant is worse still,
because it is renewed rather than lapsing and lives outside the process, so no replica can write those
rows again until this one restarts.

`src/data-source/transaction/abandoned-transaction.test.ts` and `abandoned-val-key-transaction.test.ts`
fill a pool, and hold a row, with transactions abandoned exactly as a missing `catch` abandons them.
Both were red.

Both are now bounded by an idle timeout, given per transaction through `StartTransactionOptions`
rather than configured globally, so a transaction that waits on something slow between two of its
writes raises its own without loosening it for everything else. Ten seconds by default — an order of
magnitude over the longest gap the save hooks produce, where an ordinary gap is a few hundred
milliseconds. Idle rather than age is what makes it safe for a long migration: work resets it.

Postgres delegates to `idle_in_transaction_session_timeout`, issued as `SET LOCAL` inside the
transaction so it reverts with it rather than outliving it on a pooled connection. Terminating the
backend does return the pool slot, which the test confirms. Valkey has no server-side equivalent and
carries its own timer, which exposed a race the timer itself created: a rollback firing from a timer
can now interleave with an `add` that is awaiting its grant, and a grant arriving after the drain was
registered into an emptied map and renewed forever. `claim` hands back a grant that arrives after the
transaction ended.

The `runInTransaction(cb)` helper is **declined**, and the reason is not that the boilerplate is
tolerable. Threading `{ transaction }` by hand is what lets a method take one optionally and start
its own when it is given none: a caller that already holds a transaction passes it down and the
method joins it, which is the shape `Repository.inTransaction` already uses internally. A helper
cannot see that a transaction is already open, so it would start a second one inside the first —
savepoints, or a silent nesting bug, in place of a convenience. The three internal copies are the
price of that, and they are the ones that can see their own callers.

### M7. `poolSize: 100` default — ~~MAJOR~~ **FIXED**

`postgres-typeorm-data-source.model.ts:56-58`. Twenty pods × 100 = 2000 connections; stock
Postgres `max_connections` is 100. The first scale-out event takes the database down. No pooler
guidance in the docs.

**FIXED.** The default is 20 — what one instance can keep genuinely busy, and five times below the
value that produced the finding. The number is not only a budget: a database peaks at roughly two to
three times its core count in active connections and gets *slower* beyond that, as the backends
contend rather than work, so a pool this size is a limit worth having on one machine as much as on
twenty. `docs/replication.md` says which way it is counted — per process, so the database sees the
pool times the replica count — and points at a pooler rather than a larger number for a deployment
that outgrows it, since the ceiling belongs to the server.

Fixing it surfaced a coupling that the old default hid. `PromiseUtilities.allChunked` runs fifty
items at once by default, and eight of its ten call sites end in a query — change sets on every bulk
write, key rotation and re-encryption at boot, event dispatch, backup restore, rate limiter refunds.
At `poolSize: 100` the chunk was the only thing bounding database concurrency, because the pool
bounded nothing; the framework's own fan-out was doing the pool's job. Now the pool does it.

The two numbers relate but should not be equal. A chunk is a barrier — `Promise.all` per chunk — so
a chunk sized to exactly fill the pool leaves every connection idle waiting for the slowest item in
the batch, where a queue behind the pool hands each freed connection its next item at once. Far above
the pool buys nothing on the database, since it cannot run more than the pool, and costs the heap,
since everything queued is held until its turn. At or somewhat above is the range, and 50 against 20
sits in it. Both are documented together in `docs/replication.md`, because raising the pool alone
leaves the chunks where they were.

### M8. Every number column is `DECIMAL`, round-tripped through strings — **FIXED**

> **Closed by making the property say what kind of number it is, which turned the performance half
> into the smaller one.** `format` is `'number' | 'integer' | 'bigint' | 'bignumber'` now, defaults
> to `number`, and each of the four maps to the column that holds it: `double precision`, `integer`,
> `bigint`, `numeric`. The counters, durations and status codes that make up almost all of the
> framework's own sixty-seven number properties stop sitting in an arbitrary precision `numeric`.
>
> **The precision bug closes as a consequence rather than by a check.** The entry asks for the
> `Number(v)` on the way out to stop losing digits above 2^53, and the obvious fix was to refuse a
> value that does not round-trip. That was declined for a better one: every format is now stored as
> something its own type holds *exactly*, so there is no read that can lose anything. A `bigint`
> comes back as a `bigint`, an exact decimal as a `BigNumber`, and a `double precision` column into
> the double a javascript number already is. The wrong answer is not caught, it is unreachable.
>
> **What that costs is that the declared type has to match the format**, since a property whose
> format says `bigint` hands back a `bigint` whatever it was declared as. Checked in two places,
> because neither reaches the whole of it:
> - At declaration time, off the type TypeScript emits for the property. That covers every required
>   property and `foo?: number`, and refuses the contradiction where it is written.
> - Against the value, for the rest. `foo?: number | null` compiles to `Object`, which says nothing
>   — and that union is what five of the framework's eight optional number properties use. Silent
>   there rather than guessing, and the value is refused on the way in instead.
>
> A compile error needs the value type in the decorator's signature, which legacy property
> decorators do not carry: the prototype has no type for the field. Standard decorators do, through
> `ClassFieldDecoratorContext<This, Value>` — a concrete thing
> [05 §M1](./05-di-metadata-and-packaging.md) would buy.
>
> **`BigNumber` had to become a value to be checkable.** It was `export type BigNumber = BigNumberJs`,
> and a type alias is not something `emitDecoratorMetadata` can name — every `bignumber` property
> would have been unreadable. It re-exports the class now, so the name means both things.
>
> **Filters widen where storing does not.** A filter compares rather than stores, so a bound on a
> `bignumber` may be written as a plain number or a `bigint`: both fit in an exact decimal, and
> requiring `new BigNumber(0)` on every "cannot be negative" filter buys nothing. It does not go the
> other way, because a `bigint` holds values a double does not.
>
> Comparison itself had to be built, and it fixes a defect nobody had filed: the valkey evaluator
> compared numbers with `<` and `===`, and `1n === 1` is false while `1n < 1` is also false — read
> together, that says one is greater than the other. `NumberUtilities.compare` puts both sides
> through an exact decimal, so every pairing of the three shapes compares by value.
>
> **The default changed what an undeclared number is stored as** — `numeric` to `double precision`.
> Exact becomes inexact for anyone who was relying on the old default without saying so, which is
> the reason the default is *named* `number`: it is what a javascript number already was on the way
> in and out. Saying `bignumber` is how the old storage is kept.
>
> **Residue:** the framework's own sixty-seven declarations were left at the default rather than
> given the format each of them wants. They are counters and status codes in a double now instead of
> in a `numeric`, which is better than before and not what `integer` is for.

`postgres-typeorm-data-source.model.ts:46` (`number: 'decimal'`) and `:315-335` (transformer
`to: String(v)`, `from: Number(v)`). No int/bigint/smallint mapping unless `format` is set.
`Number(v)` silently loses precision above 2^53, and `DECIMAL` indexes and aggregates far slower
than `bigint`.

### M9. No DB-level column defaults are ever emitted — ~~MAJOR~~ **FIXED**

> **Closed by deriving it rather than by adding an option.** The obvious shape was a second
> `databaseDefault` property option — it is what the evaluation test asserted — and it was declined:
> `DefaultPropertyValue<T>` already accepts a constant as well as a function, so a literal-only
> option would have been a second way to say something the first way already said, with the two
> free to disagree. A constant `default` becomes the column's default now; a function does not,
> because a column cannot run one.
>
> **The split is the content, not the mechanism.** `() => new Date()` and
> `async () => (await currentUser())?.id` are functions of *when* and *who*, which no column knows.
> Emitting the value such a default happened to produce at class-evaluation time would be a wrong
> answer that looks like a right one — every row defaulting to the moment the process booted. So a
> function is left exactly where it was, and what a constant buys is the case the finding is about:
> the writes the application never runs.
>
> **The test moved with the design.** It had asserted `toHaveProperty('databaseDefault')`, which is
> a design nobody is building — the suite's own rule is that a red test is evidence only while the
> finding still wants what it asserts. It reads the live schema through the query runner instead,
> for the column the entity declares a constant on and for the one it declares a function on.

`postgres-typeorm-data-source.model.ts:295, 305, 312, 331, 345` all force `default: undefined`.
Defaults exist only in application code, so any write not going through Zibri — psql, another
service, a data migration, a replica bootstrap — produces NULLs.

### M10. Bulk change-set writes lose the acting user — ~~MAJOR~~ **FIXED**

> **Confirmed, and still live when it was re-checked.** The field is `createdBy` now. What is worth
> keeping is why it survived: the object is built inside `entitiesPriorChanges.map(async e => …)`,
> whose return type was inferred rather than stated, and an inferred object literal is not checked
> for excess properties — so `createdByUserId` was a key that belonged to nothing, silently dropped
> on the way to a column that stayed null. The callback now declares
> `Promise<CreateChangeSetData>`, which makes the literal fresh against that type; the same mistake
> is `TS2353` at the line that makes it.
>
> **The test is the other half.** `on create` had asserted the actor from the beginning — on the
> singular path, which was the one that was right. The bulk paths had no assertion at all, which is
> how a field name nobody read could stay wrong. Both bulk paths assert it now, and on *every* row
> rather than on one: a null actor on any row is the auditor's question going unanswered for that
> row. Both go through an authenticated route, because who made a change is read from the request —
> driven from a test body there is no user, and the assertion would pass on whatever it did.

`src/change-sets/change-set-repository.ts:413` writes `createdByUserId: userId`, but the entity
field is `createdBy` (`src/change-sets/models/change-set.model.ts:29`). Singular writes use the
correct name (`change-set-repository.ts:376`).

Every `createAll` / `updateAll` / `deleteAll` therefore records an audit row with a null actor —
precisely the field an auditor asks for.

### M11. The audit trail is not atomic with the change it audits — ~~MAJOR~~ **FIXED**

> **Partly closed already, in the one place nobody would have looked.** `updateAll` had taken a
> transaction over the read, the write and the change sets since the bulk-update work, with a
> comment naming exactly this risk. Every other path still wrote the two as independent statements.
> That asymmetry is worse than the uniform bug: the same class wrote some audit rows atomically and
> some not, and nothing in any signature said which.
>
> Every path that writes a change set now takes one — `create`, `createAll`, `updateById`, soft
> `deleteById`, soft `deleteAll`, `resetSingleChangeSet`, `rollbackToTimestamp` and
> `rollbackAllToTimestamp`; the four remaining methods delegate into those. `Repository.inTransaction`
> already existed and already did the right thing: it uses the caller's transaction when there is
> one and takes its own when there is not, so nothing about passing your own changed.
>
> **Two of them are atomic over more than a pair.** `resetSingleChangeSet` performs three writes —
> the row, the change set recording the reset, and the deletion of the change set being undone — and
> a reset that wrote the row and then failed to delete what it undid would offer that change set to
> be undone a second time. `rollbackToTimestamp` walks several resets, so without one transaction
> over all of them a failure partway leaves the row between two change sets, which is a state
> nothing recorded and nothing can name.
>
> **A hard delete takes none, deliberately**: it writes no change set, so there is nothing for the
> write to be atomic with.
>
> The test injects the failure at the change set repository, which is a collaborator the repository
> is constructed with rather than any part of what is under test. There is no way to produce it with
> data — a change set is built out of the entity that was just written, so anything the change set
> cannot store the entity could not either.

`src/change-sets/change-set-repository.ts:87-111` — `super.create(...)` then `createChangeSet(...)`
as two separate statements. Unless the caller happens to pass a transaction, a crash between them
leaves a mutation with no audit record, or an audit record whose entity write was rolled back.
For a feature sold as compliance tooling, the write and its audit row must share a transaction by
construction.

### M12. Write amplification on change-set and soft-delete entities — ~~MAJOR~~ **FIXED**

> **Two of its three claims had already closed, and the entry had not been revisited** — the third
> round running where that was true.
> - *"`getCreatedBy()` calls `getCurrentUser` on every single write"*: `getCurrentUser` is memoized
>   per request context, so a request resolves who is acting once however many rows it writes.
>   Outside a request there is no context to ask about at all.
> - *"`updateById` = findById + (save + findById)"*: `saveUpdate` was split out of `updateById`
>   precisely so a subclass does not read the same row twice, and `ChangeSetRepository` uses it.
>
> **What survived is the soft delete, and it was reading the row twice.** `deleteById` read it for
> the guard, then called `updateById`, whose `ChangeSetRepository` half read it again for a change
> set's before state — a change set that `deleted` is excluded from, so it was never written. It
> goes through `saveUpdate` now with the row it already holds. What that needed was `withDeleted` on
> the read after the write: the write is what makes the row invisible, so the guard would otherwise
> answer that the row this call just deleted is gone. That is also what the `try`/`catch` around
> `NotFoundError` in `SoftDeleteRepository.updateById` existed for.
>
> **A one-row soft delete costs nine statements, measured.** The entry guessed "six to eight" and
> was close, but the composition is the useful part and it is mostly not what the entry names: the
> transaction is two of them, typeorm's `save` reads the row itself to decide insert from update,
> the change set is an insert plus its `changes` relation, and only one of the nine was the
> duplicate read fixed here. That is why the test measures a soft delete against an ordinary update
> of the same entity rather than against a number — an absolute bound would have been asserting the
> cost of typeorm's internals.
>
> **What it compares is the reads, and the first attempt compared every statement.** An ordinary
> update costs one statement more than a soft delete of the same entity, and for a reason the finding
> is not about: a change set lists the properties that changed, `deleted` is the one property a soft
> delete changes, and it is excluded — so the update writes a change row and the delete writes none.
> Both read the row three times, which is the number this finding is about. Found by running the
> suite against a container, where nine and ten are what the two actually cost.
>
> **The read-back after every write has closed too, in a later round, and it was one statement short
> of what the entry above says.** `updateAll({ returnUpdated: true })` was three statements — a
> locking select, the update, and a select to read them back — which is why routing the read-back
> through it would have saved nothing. It is one now: `UPDATE … WHERE … RETURNING *` selects rows by
> a filter, writes them, and reports which ones it wrote, which is the whole of what that operation
> promises. So a plain `updateById` went from **four statements to two** — the guard that tells a
> missing row from a write that changed nothing, and the write. The other two were the read-back and
> a select nobody had filed: typeorm's `save` is an upsert, so it read the row itself to decide
> insert from update, immediately after `updateById` had read it.
>
> **What made it a driver change rather than a rewiring is the mapping.** The orm turns rows into
> entities for a read and not for a write, so `UpdateResult.raw` arrives as database column names
> carrying database values — no json parsed, no number given back the precision its column keeps.
> The driver walks the same column metadata the orm's own read path walks, which is what makes the
> row a write hands back and the row a read hands back the same object. `json-column-values` asserts
> exactly that, on both stores, because it is the file that already pins what those values are.
>
> **The first cut of that mapping had a bug, and it was found by being asked rather than by a test.**
> Join columns were skipped by asking whether a column carries a relation — but typeorm *mutates the
> entity's own declared column* when a relation names it as its join column, rather than adding a
> second one beside it, so a declared `teamId` carries a relation and would have been dropped from
> every update while every read returns it. The discriminator is `isVirtual`, which is typeorm's own
> answer to the same question, in a comment three lines from the code that reads it: a virtual column
> is one the orm invented for a relation, and writing it onto the entity produces a half resolved
> relation where a read produces nothing.
>
> **One thing a write cannot report, and it is not a column.** A relation lives in rows beside this
> one, so a caller who asks for relations, or an entity that reads some by default, gets the row read
> once the write has landed. That is a fallback in the repository rather than in a driver, because
> which relations to resolve is the entity's declaration rather than the store's business.
>
> **Two gaps came out of asking what else the read-back had been doing**, and neither was this
> finding. `updateById` took no `relations` at all, so an entity that declared no `defaultRelations`
> could never be handed one back from a write; and `create` resolved the relations *its own data
> named* rather than the ones the entity declares, so `create({ occupant, teamId })` answered with no
> `team` where `findById` resolves one. Both are the same rule stated once now — a written row is the
> row finding it by its id would give — on one `WriteRelationsOptions` that `create`, `updateById`
> and `upsert` share. The bulk calls were left out of it here, on the grounds that they have no bound
> on how many rows they answer with; that reasoning was wrong and
> [§M29](#m29-a-bulk-write-hands-back-rows-a-read-of-the-same-rows-would-not--minor-fixed) has since
> taken it back — resolving relations for a result is one read for the whole batch rather than one
> per row, so the three bulk calls share that option too.
>
> **A third came out of the compiler.** `ChangeSetRepository` forwarded the caller's create options
> into the change set's *own* repository, so the moment those options gained a typed `relations` the
> mismatch became an error — and `allowId` had been travelling that way all along. Only the
> transaction belongs to a row recording a change.
>
> **Then the user asked what every method costs, which is its own section below** — see
> [What each repository call costs](#what-each-repository-call-costs). Writing it found three more
> pieces of work whose result was thrown away, all of them hook passes rather than statements, and
> two findings that were filed rather than fixed there: [§M29](#m29-a-bulk-write-hands-back-rows-a-read-of-the-same-rows-would-not--minor-fixed)
> and [§M30](#m30-the-default-encryption-key-is-created-by-a-read-followed-by-a-write--minor-fixed),
> both since closed, the second along with the two it turned out to be sitting on.
>
> **One thing this got wrong survived to the container run**: an update filtered by nothing. A
> caller passing `{}` means every row, which the repository allows on purpose, but the one statement
> path handed the empty filter to the query builder — which refuses a write whose criteria render
> empty, because that is also the shape of a filter that silently evaporated. It cannot tell the two
> apart and the caller can, so the statement is now built with no `WHERE` at all when the filter
> names no condition. **Reachable only through a filter that is empty by the time it arrives**, which
> is why every test with a real filter passed.
>
> **The premise this broke was written into the driver interface**, which said no store has a single
> operation that selects rows by a filter and reports which ones it changed, and had the repository
> open a transaction on that basis. Postgres has one; valkey does not. So the transaction became the
> driver's to take when it needs one — the rule `upsert` already stated two methods below, now the
> same for both write operations. Keeping it required would have wrapped `BEGIN` and `COMMIT` around
> a single statement, which is one read saved and two round trips spent.
>
> **Valkey kept its claim-then-write dance and lost a read anyway**, on both halves. Its write knows
> which rows it wrote, so `save` hands them back instead of a fourth read finding them again. And a
> filter naming nothing but ids skips the second evaluation entirely: an id is the one thing a filter
> can say that a write cannot make untrue, so there is nothing to re-check once the rows are held.
> Without that, single-row updates on valkey would have paid for postgres's improvement.

`ChangeSetRepository.updateById` (`:99-104`) = findById + (`Repository.updateById` = save +
findById) + `getCreatedBy()` + change-set insert. `getCreatedBy()` (`:453-464`) calls
`authService.getCurrentUser(...)` on **every single write**. `SoftDeleteRepository.deleteById`
(`src/change-sets/soft-delete-repository.ts:157-168`) layers another findById + updateById +
createChangeSet on top. A one-row soft delete is roughly six to eight round trips.

### M13. Soft delete plus `unique` is unusable — **FIXED**

`unique` (`string-property-metadata.model.ts:110`) emits a plain UNIQUE constraint. A soft-deleted
row keeps occupying the value, so a user can never re-register with an email they previously
deleted. The standard fix is a partial unique index (`WHERE deleted = false`) — which M2 says you
cannot express.

> **Closed by making the declaration say which rows it covers**, at both places one can be written:
> `unique: { where: whereFor<Account>({ deleted: false }) }` on the property, and
> `uniques: [{ properties: ['tenantId', 'email'], where: … }]` on the entity. That is the portable
> `Where<T>` M2 named, so this closes M2's partial-unique remainder with it.
>
> **On a soft delete entity the answer is required, and a declaration that does not give one is
> refused where it is written.** This is the part worth arguing about, because no comparable framework
> does it - typeorm, rails, django, ef core and sequelize all take a raw sql predicate and none of them
> applies one to soft deletes on its own. They cannot: in every one of them soft delete is a plugin or
> a convention rather than something the framework owns. Zibri owns it - `SoftDeleteRepository`
> already folds `deleted: false` into every read, and into `count` and `exists` since
> [M14](#m14-the-repository-is-missing-the-operations-a-real-app-needs--partially-fixed) - so
> uniqueness would be the one place the rule does not reach.
>
> **Defaulting it would have been wrong, though.** Both answers are ordinary: an address a deleted
> account no longer holds is what lets somebody register again, and an address that stays taken is how
> deleting an account stops being a way to shed its history. Two legitimate values means the option is
> required rather than defaulted, and `where: {}` is how the second is written down. The refusal
> arrives at declaration time, beside `assertGroupsAddSomething`, so it costs nothing at runtime and
> cannot be reached by a deployment that happened not to exercise the path.
>
> **The predicate is deliberately a fragment of what `Where` can express** - a property against a
> string, number, boolean or null. A schema predicate cannot carry a parameter, so it is written into
> the statement; anything richer is something the database has to prove immutable before it will index
> on it. The values are escaped even though a declaration is developer-written, because
> [C5](#c5-a-filter-value-could-rewrite-the-statement-it-was-filtered-with) is what that assumption
> looks like when it stops holding, and a declaration built out of configuration is one refactor away.
>
> **Both stores enforce it, which is what M22 established the standard for.** On postgres a covering
> key stays a constraint and a partial one is created as a unique index carrying the predicate, under
> the same `uq_` name a migration would refer to. On valkey a row the filter excludes is not written
> into the unique index at all, so it holds no value - which is also how a row leaves the index by
> being soft deleted rather than by changing what it holds.
>
> **What this does not cover.** A partial key cannot be an `upsert` target: a conflict is resolved
> against a constraint, and a key over part of a table is an index, so the identity does not name the
> row to change. That is refused rather than mis-resolved. Covering indexes and check constraints stay
> open under M2, and `index` does not take a `where` yet - only `unique` does, because only it had
> something asking for one.

### M14. The repository is missing the operations a real app needs — ~~PARTIALLY FIXED~~ **FIXED**

> **The cursor was the last of them, and M4 is what made it owed.** Bounding an unbounded `findAll`
> was right, and it left `take: 'all'` as the only way past the bound — which is the same unbounded
> read the bound exists to refuse, now spelled deliberately. `stream` is the actual way past it: the
> result is walked rather than held, so there is nothing left to outgrow.
>
> **It is on `RepositoryDriverInterface` rather than built above it**, for the reason `schemaLock`
> is: a repository cannot page around a store that has a cursor without giving up what the cursor is
> for, and a data source that offered no way to walk a large table would leave its callers with a
> gap nothing above it can fill. Postgres opens a real cursor; valkey reads its id set once and the
> rows behind it a batch at a time. The cost is a required method on a documented extension point,
> so `InMemoryDataSource` implements it too.
>
> **The cursor cost a dependency, and the shape of it was the interesting part.** Typeorm opens a
> postgres cursor through `pg-query-stream`, which nothing here had. A plain peer dependency was
> wrong for a reason worth writing down: npm installs a non-optional peer *whether or not the
> consumer uses the feature*, so a deployment whose only data source is valkey would have been made
> to carry a postgres driver's streaming support. It is an **optional** peer, and `PostgresDataSource`
> refuses to initialize without it — optional decides who installs it, not whether it is needed, and
> declaring a postgres data source declares `stream` along with everything else postgres does. The
> check sits next to `ensureTrigramExtension`, which is the other thing that data source asks about
> its environment at boot. It throws where that one warns, because the trigram extension costs one
> filter operator and this costs the only way to read a table that does not fit in memory — found,
> otherwise, by the nightly job that reads it.
>
> **The cursor carries ids, and the rows come back through `find`.** Hydrating a streamed row here
> would mean repeating what typeorm does turning a result set into entities — transformers included,
> and `number` is stored as `DECIMAL` and read back through one, so a hand-hydrated row would carry
> strings where every other path carries numbers. What the cursor is still doing the work of is
> deciding *which* rows: fixed when the query runs, where paging re-asks on every page and lets rows
> shift across the boundaries.
>
> **A stream has no order, on any data source.** Ordering means comparing all of the rows, and a
> store that filters in the application would have to hold every one of them to do it — the thing a
> stream exists not to do. So `StreamOptions` omits `order` along with `take` and `skip`, rather
> than accepting an order and refusing it at runtime on one data source: the type says it once, and
> the valkey check that would otherwise have said it later does not need to exist.
>
> **Three of the listed absences landed as side effects of the lease work**, none of them filed here
> at the time: `upsert` with `onConflict` and an atomic `increment` (step 4 of
> [the two primitives](./10-leases-and-claims.md#order)), and `SELECT FOR UPDATE`, which is how
> `updateAll` became atomic in step 6.
>
> **`count` and `exists` are there now, and M4 is what made them urgent.** Bounding an unbounded
> `findAll` closed a hole in the heap and opened one in the surface: `findAll(...).length` was how you
> counted a table, and above ten thousand rows that call now throws, so *how many are there* had no
> answer at all at exactly the size where it starts to matter. Both were cheap - `count` was already
> on `RepositoryDriverInterface` and implemented by both drivers, and `CountOptions` had been declared
> and exported without ever being used - so what was missing was the method, not the machinery.
>
> **Neither goes through `findOne` or `findAll`, deliberately.** `exists` asks the driver for one row
> with `relations: []` and throws it away: going through `findOne` would join the entity's default
> relations, decrypt its encrypted properties and strip its excluded ones, to produce an object whose
> only use is being compared against undefined. Counting through `count` rather than through a read is
> the same argument at the other end - a filter matching a million rows reads a million of them to
> report the number.
>
> It asks for that row through the driver's `find` with `take: 1` rather than through its `findOne`,
> which the first run of the test found: typeorm refuses a `findOne` carrying no conditions outright
> (*"You must provide selection conditions in order to find a single row"*), and the call this exists
> for - *is there anything here yet* - is exactly the one that carries none. Nothing else in the
> repository had reached that, because `FindOneOptions.where` is required.
>
> **Both narrow through the entity's scopes, which is the part worth testing.** A count taken from the
> caller's filter alone reports how many rows *exist* rather than how many they may *see*, and on a
> per-tenant entity that is a row count of somebody else's data. `findAllPaginated`'s total had
> exactly that bug once. `SoftDeleteRepository` overrides both for the same reason it overrides every
> read: a count that ignores `deleted` is worse than a `findAll` that does, because nothing about a
> number says which rows it stands for.
>
> **Still absent: a bulk-insert fast path, a cursor or stream, and a query timeout.** The stream is
> the substantial one and stays open on purpose - it needs a cursor on the driver interface, and the
> valkey driver has no equivalent to answer with, so it is a data source contract question rather than
> a method. It is also what M4's refusal points a caller at, so it is the next thing this finding owes.

Per `docs/data-source.md:153-163` the full surface is find / create / update / delete. Absent:
`count`, `exists`, `upsert` / `onConflict`, atomic `increment`, a bulk-insert fast path,
cursor or stream for large result sets, `SELECT FOR UPDATE`, query timeout.
`save()` (`src/data-source/driver/typeorm.repository-driver.ts:25-31`) is TypeORM's `save`, which
does a read-before-write per entity — there is no `INSERT` fast path at all.

### M15. ValKey data source filters in Node, one round trip per row — **FIXED**

> **The general case closed 2026-10-03, with the user's choices: an index is complete once a migration
> says so, and the rollout gap is documented.** What was left was a filter on anything not unique.
> It waited on M2: until an entity could declare an index there was nothing to opt into, and reading
> every row for an undeclared lookup is what a database does too. Now valkey keeps a set of ids for
> each value of every index declaration, under `{prefix}:{table}:index:{columns}:{values}`, on every
> write. A filter whose every branch names every column of a declaration with plain values (or a
> `oneOf` of plain values, for a declaration of one column) reads only those rows. The rows are
> still judged by the whole filter, so a stale entry costs a read and never a wrong answer.
>
> **A missing entry would be a wrong answer, so an index is read only once it is complete.** A row
> stored before the index existed has no entry, and unlike a unique a non-unique index cannot treat
> a miss as "read everything". So an index is read only after `addIndexesOfEntity`, a new migration
> method on every store, has indexed the stored rows and marked it complete. On postgres it creates
> the index, which also closes a gap of its own: there was no way to add an index to an entity that
> already existed. `createEntity` marks an entity's indexes complete, and `removeIndexesOfEntity`
> drops them. The gap the user chose to document rather than close: instances still running the
> previous version write rows without entries, so the migration runs once they are gone, as the
> method's JSDoc and `docs/data-source.md` say.
>
> **Found on the way: a migration rewriting values left valkey's unique indexes behind.**
> `changePropertyOfEntity`, `addPropertyToEntity` and `removePropertyFromEntity` rewrite stored rows
> without going through the driver. So a converted unique value stayed taken by a row that no longer
> held it, and the new value was free for a duplicate. The rewrites now hand the driver each row
> before and after, and it moves every unique and index entry, enforcing uniques as a save does. Held
> by `val-key-data-source.test.ts`, red before the fix. `removeUniquesOfEntity` and
> `removeIndexesOfEntity` share the code that drops their keys.
>
> **Found on the way: on postgres, changing a property dropped the unique that covers it alone.**
> Read back from the database, such a column says it is unique; built from the migration it never
> does, since uniques are migrated by their own helpers. TypeORM's `changeColumn` took that
> difference for dropping the constraint. So a migration that only renamed or converted a property
> declared `uniques: [['code']]` left it unenforced. The changed column now keeps the uniqueness that
> is stored. It surfaced as the M38 case failing on postgres too, and is held, red before the fix,
> by "keeps the unique an entity declares enforced on a property a migration changed", a shared case
> that runs on every store.
>
> **Found by the shared migration case: [§M38](#m38-a-unique-only-a-migration-names-is-enforced-on-postgres-only--fixed).**
>
> The remark below about one round trip per row is out of date: rows are read in pipelines of a
> thousand. Held by `val-key-data-source.test.ts`, which shows the index read. A row no read can parse
> makes the filter fail before `addIndexesOfEntity` and succeed after, and the index stays true across
> an update and a delete. Also by three new shared cases in `migration-helpers.cases.ts` (in-memory
> here, postgres and valkey in their suite).

> **A unique lookup no longer reads every row.** Only a filter pinning the *id* used to avoid the
> scan, so `findOne({ where: { key } })` on a unique column read the whole entity and filtered in
> process. Anything declared unique — a property with `unique`, or a group in the entity's `uniques`
> — is now indexed under `{prefix}:{tableName}:unique:{…}` and resolved directly.
>
> Found by needing it rather than by planning it: moving the rate limiter's key off the row id
> (see [M21](#m21-a-malformed-id-is-a-500--nothing-checks-the-id-against-the-format-it-declares--fixed))
> would otherwise have turned every rate limit check on the request hot path into a full scan.
>
> **The index is a shortcut, never an authority.** A miss falls back to reading every row, because a
> row stored before its index existed carries no entry and must not be reported absent — so this can
> only ever be faster, never wrong, and needs no migration. Both index writes are set operations, so
> they commute with each other exactly like the id set does and neither takes a grant.
>
> **Still open:** the general case. A filter on anything not declared unique still loads every row of
> the entity and filters in process, and reads are still one round trip per row.
>
> The index was built to make a unique lookup *fast*, and it is also what makes the value unique —
> see [M22](#m22-unique-is-enforced-on-postgres-and-ignored-on-valkey--major-fixed), which this is
> what surfaced and which enforces the declaration by reading this index under a grant.

`src/data-source/data-sources/val-key-data-source.model.ts:96-103` (docstring) and
`docs/data-source.md:103-105` state it plainly: *"a `findAll` loads the entities of that type and
applies the where filter in process."*

`:480-501` does `smembers` on the entire id set, then `hgetall` **sequentially in a `for` loop** —
one round trip per row. `scanKeys` (`:511-523`) accumulates every matching key in memory, and
`restoreBackup` (`:400-403`) `del`s them all in a single command.

### M16. ValKey restore destroys before it validates — ~~MAJOR~~ **FIXED**

`val-key-data-source.model.ts:573-594` (the line numbers moved since the review) deletes every
existing key first, then streams the backup in. A malformed line, a truncated stream or a network
blip mid-restore leaves the store wiped and partially restored, with no staging step and no
rollback.

Held by `src/__testing__/evaluation/valkey-durability.evaluation.test.ts`, which takes a real
backup and then feeds it back through a stream that fails after its first line.

**Confirmed**, against a green control proving a complete restore works. The result is worse than
"partially restored": the read comes back **empty**, not with the one row the first line carried.
An entity is stored as several keys — the row hashes *and* a `:ids` index set — and all of them are
deleted before a single line is read. Whichever key the truncated stream happened to restore, the
index that makes rows findable was gone with the rest. So a failed restore can leave data
physically present and completely unreachable, which is a worse state to debug than an empty store.

> **Closed.** The backup is now restored into a staging namespace and only swapped in once the whole
> stream has arrived, so a cut stream, a line that will not parse or a key that will not restore
> leaves what is stored exactly as it was - the staged keys are dropped and the error is passed on.
> The swap itself is one atomic batch, deleting what was there and renaming the staged keys into
> place, so no reader sees half the old state and half the new one. The `:ids` index can no longer
> outlive the rows it points at, because nothing is deleted until every replacement is known good.



### M17. ValKey transactions apply part of their work outside the transaction — ~~MAJOR~~ **FIXED**

`val-key-data-source.model.ts:496-500`

```ts
// removing a field cannot be buffered, it would be applied before the batch of the transaction
await this.client.hdel(key, res.remove);
```

The field deletion executes immediately, outside the batch. Roll back a `changePropertyOfEntity`
migration and the old field is gone anyway. The code comments the data-loss window rather than
closing it.

Worse than "the old field is gone": the *new* field is the buffered half, so a rollback discards
the write and keeps the delete. The value ends up under neither name — the rename does not fail
back to its starting state, it destroys the only copy. `changePropertyOfEntity`
(`:499-526`) is the only caller that passes `remove`, so a rolled-back rename migration is the
whole exposure, which is exactly when a rollback is most likely.

Held by `src/__testing__/evaluation/valkey-durability.evaluation.test.ts` (current lines
`:674-679`). **Confirmed**: after a rolled-back rename the property reads back `undefined`, against
a green control proving the rename works when it commits. The value is under neither name, exactly
as narrowed above.

> **Closed**, and the comment was the bug. Removing a field *can* be buffered - `Batch.hdel` exists
> and always did - so the premise that it had to be issued immediately was simply wrong. The
> transaction gained a `hashDelete` write alongside `hashSet`: it takes the same row grant, buffers
> into the same batch, and is discarded by the same rollback. The overlay tracks removals separately
> from writes, because a removed field is not a field written to nothing, so a read inside the
> transaction sees the rename as it will land.
>
> The lesson generalizes past this entry: a comment explaining why a correctness hole cannot be
> closed deserves the same scrutiny as the hole. This one had been read and left alone repeatedly,
> including by the review that filed it.

### M18. `fuzzyLike` cannot use an index, and JSONB casts throw on bad data — **FIXED**

`postgres-typeorm-where-filter.converter.ts:63-68, 103-109` emits `similarity(col, 'x') >= r` with
no `%` operator, so no GiST/GIN trgm index is usable — and M2 means no such index can be declared
anyway. Every fuzzy search is a sequential scan.

`getJsonbCast` (`:419-446`) casts JSONB text to `::numeric` / `::timestamptz`. A single row whose
JSON holds a non-numeric string makes the whole query throw at runtime instead of not matching.

> **The cast half is closed, and it closed by keeping the throw rather than removing it.** The
> obvious fix is to guard the cast so a wrong-typed value yields NULL, which sql already reads as no
> match. That was declined: a row that cannot be compared is not a row that failed the comparison,
> and reading it as one shrinks the answer to every filter touching the property — quietly, and by
> exactly the rows worth knowing about. What was wrong was never the failing, it was that postgres
> answers with the value alone (`invalid input syntax for type numeric: "abc"`), which reads like the
> query is broken rather than like one row is.
>
> So the cast now carries a marker naming the property it was emitted for, and a failure becomes
> `JsonValueTypeMismatchError`: *"Sensor.reading.value is declared as a number, but a row holds
> "not-a-number"."* The marker is a sql comment written beside the cast rather than a second walk of
> the filter in the error path, because the second walk would have to agree with the first forever
> with nothing holding it to that. Spotting the failure is asked of the data source and building the
> error is done by the driver, which is the seam `violatedUniqueProperties` already established — the
> three sql states involved also answer for a malformed uuid anywhere else in the statement, so it is
> the marker rather than the state that makes it a json question.
>
> **The residue is the other store**, and it is named rather than closed: an entity there is one
> document, so a declaration that changed after the rows were written leaves the same mistyped values
> behind on *every* property rather than only the ones inside an object. `WhereFilterEvaluator`
> compares them loosely instead — `toComparable` falls back to a string — so the same row is a hard
> error on one store and a quiet wrong answer on the other. Refusing it there means threading a
> property path through the evaluator and tightening `equals` and `compare`, which is a wider and
> riskier change than this finding filed, and a different problem: this one is about a column type
> that says only "json", that one is about a store that validates nothing on the way out.
>
> **The fuzzy half closed too, and the declaration it needed turned out to be one nobody makes.**
> The row's own framing — an index can be declared, therefore declare one — was the wrong shape. The
> type of a where filter offers `fuzzyLike` on *every* string property, so a flag for opting a column
> into being searchable would have left the offer standing everywhere it was not set, which is the
> finding again with a smaller blast radius. **Every string property is searchable and carries a
> trigram index**, and `fuzzySearchable: false` is the opt *out*, for a column written far more often
> than it is read.
>
> That inverts what a refusal means. Four kinds of string can be read off the declaration as holding
> nothing a similarity says anything about — a uuid, one of an `enum`, a `hash`ed value, an
> `encryption`ed one — and each of those is now refused rather than answered, because there the type
> offering `fuzzyLike` is the defect. So a `fuzzyLike` that is accepted is one an index answers, and
> the only silent scan left is a string inside a json document, which has no column to index and is
> named in the docs rather than left to be discovered. The rule lives in `FuzzySearchUtilities` and
> is asked once per query in `Repository.scopedWhere` — above both stores, so they refuse alike, and
> not in the evaluator, which runs per row.
>
> **The ddl seam is `synchronize: false`.** Typeorm's index options carry no access method and no
> operator class, which the entry has right; what it misses is that the schema builder skips an index
> declared that way in *both* `dropOldIndices` and `createNewIndices`. So the index is declared to the
> orm as none of its business and created by `PostgresDataSource` itself, inside the same schema lock
> that runs `synchronize`, through a new `afterSchemaSetup` beside the existing `beforeMigrations`.
> Owning it means dropping it too: a property that stops being searchable leaves an index nothing else
> would remove, so the reconciliation is both ways, and the indices are named `trgm_…` so the data
> source can tell its own from everybody else's. A schema owned by migrations or from outside gets a
> warning naming the columns and the `CREATE INDEX` to write, the same shape as the collation warning
> next to it.
>
> **The query side is the conjunct the entry describes, plus the boundary it does not.** `%` takes no
> argument — it asks for the server's `pg_trgm.similarity_threshold` — so it can be added only where
> it lets through everything the ratio does, and *at* the threshold that depends on whether the
> operator includes it. Postgres documents `%` as *greater than* its threshold and implements it as
> greater or equal, and those two answers differ for exactly the default search, whose similarity is
> the default threshold. So it is measured rather than believed: with the threshold set to 1 inside a
> rolled-back transaction, two identical strings are the one probe that tells them apart.
>
> **The threshold itself is pinned rather than read**, which is what makes any of this documentable.
> The connection asks for `pg_trgm.similarity_threshold = searchesFromSimilarity`, so the boundary
> between an indexed search and a table read is a number the application names instead of a fact about
> the deployment. It is asked for in the connection's startup settings, so it covers what this
> application runs and nothing else, and the boot probe reads back whatever actually took — a pooler
> that drops the setting is reported rather than assumed away.
>
> **That boundary is per data source and the filter's default is not**, which is the distinction worth
> keeping: `searchesFromSimilarity` decides only which searches an index answers, while
> `DEFAULT_MIN_SIMILARITY` decides which rows a filter naming no `minSimilarity` matches. Making the
> second one per data source would mean one filter returning different rows depending on where the
> entity is stored — the same failure as ordering text by the runtime's locale, one chapter over.
>
> **What is not covered**: an index over several columns, a search across them, and any ordering by
> similarity. `fuzzyLike` still answers a question about one column at a time.
>
> **The residue closed too (2026-09-28), found-bug sweep item 7.** The evaluator now carries the
> path of the property it is matching and, before any key that compares — the value itself, `not`,
> `oneOf`, `notOneOf`, the orderings, the same set the converter casts for — refuses a number, date
> or boolean property holding something else. Asking for `null` compares nothing and still answers,
> which is what postgres does too: `hasJsonValue` needs no cast. The refusal needed the read side to
> stop hiding the value first. Both in-process stores read a top-level number through `Number()` and
> a date through `new Date()`, so a mistyped one arrived as NaN or an invalid date — a different
> value that silently failed every comparison, and one the error could not have named. They now hand
> back what is stored when it does not read as the declared type, the way a value inside an object
> already came back. The in-memory store's `Number()` was also a bug on its own: a `bignumber`
> column came back as a double, where valkey used `readNumber`. Both now go through `parseNumber`,
> and the number-format cases became shared (`number-formats.cases.ts`) so the in-memory store runs
> them.
>
> The error became `StoredValueTypeMismatchError` (breaking rename), since on a store holding a row
> as one document it now names top-level properties that are not json to anyone reading the model.
> `mistypedJsonValue` takes the entity name and returns the whole path, so there is one shape and one
> path convention. The shared `mistyped-values.cases.ts` runs on all three stores; the top-level
> half runs only where a column takes any value, because postgres cannot hold one. What still differs
> is leniency at the edge: postgres reads `'yes'` as a boolean and `'1e5'` as a number, the evaluator
> refuses both, and V8 reads a few strings as dates that postgres would not.

### M20. There is no conditional update anywhere in the repository layer — ~~MAJOR~~ **FIXED**

`repository.ts:236-250` is a read-modify-write. Two callers both `findAll` the same rows, both
`save`, and both believe they won. There is no `UPDATE ... WHERE`, no row lock, and no affected-row
count, so the compare-and-swap that every lease, queue claim and optimistic-concurrency check is
built on is not available at all. `RepositoryDriverInterface` exposes only `save`, `find`,
`findOne`, `count` and `remove` — the operation does not exist at the driver level either.

This is not theoretical, but the original write-up overstated where it bites. Re-examined against
the fixes that have since landed:

- the **cron lease** and the **event subscriber run** are keyed by something that does not exist
  yet — a scheduled execution, a run of a subscriber — so the row *is* the claim. A unique `INSERT`
  is the correct shape there, not a workaround, and a conditional update would have nothing to act
  on.
- **invoice numbering** is a counter, closed with `atomicUpsert`
  (`INSERT … ON CONFLICT … DO UPDATE … RETURNING`), which is its own primitive rather than a
  substitute for this one.
- the **mail queue** ([04 §1.6](./04-infrastructure-subsystems.md)) is the real case. The `Email`
  row already exists in `QUEUED`, and claiming it is exactly `UPDATE … WHERE status='QUEUED'` with
  an affected-row count. Because that does not exist, the fix grew a second entity —
  `EmailSendClaim` — whose only job is to be a row that *can* be uniquely inserted.

So the gap has cost one extra table rather than shaping every fix, and the mail claim is the
concrete requirement this operation should be designed against.

**Why it is not simply a missing feature.** Adding `UPDATE ... WHERE` to the driver would hold for
plain Postgres repositories and silently *not* hold elsewhere:

- `ChangeSetRepository.updateAll` (`change-set-repository.ts:107`) reads the rows before the write
  to compute its diff. A conditional update destroys the before-state, so change-set entities can
  never use one.
- The ValKey driver has no server-side conditional update, so it would fall back to
  read-modify-write and not be atomic — while presenting the same API.

A contract that is atomic for some entities and some data sources, with nothing in the signature to
say which, would be a worse trap than the current honest limitation. If this is added it belongs as
a separate, narrowly named operation that states plainly that it bypasses change-set tracking, and
it should be designed against a concrete requirement rather than speculatively.

**What was done instead.** `DataSourceInterface.withLock(key, fn)` makes a read-modify-write safe by
excluding other writers for the duration, rather than by making the write itself conditional. It is
implemented on both data sources (postgres advisory locks, valkey `SET NX PX`), works across
instances, and is keyed so callers only wait for each other when they touch the same thing.
`docs/data-source.md` documents it as the supported way to make your own writes safe.

Invoice numbering was fixed with `withLock` first and **no longer uses it** — a lock and a
transaction have independent lifetimes, so the counter escaped the exclusive window the moment a
caller passed its own transaction. It now uses `atomicUpsert`, where the database holds its own row
lock until commit. See [10 §10.4](./10-leases-and-claims.md); that sequence is the strongest
argument in this document for why the *narrow* primitive beats the general lock.

**This entry lost its justification** — see [10, The two primitives](./10-leases-and-claims.md#the-two-primitives).

The argument above ran: the mail queue must claim an existing `QUEUED` row, that is
`UPDATE … WHERE status='QUEUED'`, and no such operation exists. Under the lease model the mail queue
does not claim by updating at all, so the concrete requirement is gone.

What remains is still real: `updateAll` is a read-modify-write where two callers both believe they
won, which is a defect for **users** regardless of what the framework does internally, and a
compare-and-set is what optimistic locking (§M1) would be built on.

**The fix falls out of the lease model rather than needing its own design.** `updateAll` becomes
atomic on both stores by four mechanisms — a single `UPDATE … WHERE … RETURNING *` for a plain
predicate on Postgres, `SELECT … FOR UPDATE` for one needing a join, and the transaction's lease on
ValKey whether or not the caller supplied the transaction. The caller cannot tell which ran.

Two intermediate designs are recorded because both look plausible and both are traps. Making
`updateAll` atomic *before* ValKey transactions hold leases fails, because a method on both drivers
can only carry a guarantee both can keep. `atomicUpsert`'s **optional on
`RepositoryDriverInterface`** shape fails the other way — it makes a capability data-source
specific, so `NumberInvoices` on a ValKey data source throws at the first invoice. The lease model
avoids both: the guarantee is uniform, only the mechanism differs.

The one limit that survives is narrower than either: no mechanism here covers **phantoms** — rows
that begin matching the filter after the read. Only `SERIALIZABLE` does. That is a documented limit
of `updateAll`, not a defect.

That closes the practical gap without pretending the repository can do something it cannot. A
conditional update is still the better primitive where it applies — it does not serialize readers —
so this entry stays open.

> **Closed.** `updateAll` is now one operation on the driver rather than a read and a write
> orchestrated by the repository, and each store closes the window its own way — `SELECT ... FOR
> UPDATE` on postgres, holding the candidate rows and reading them again on valkey. Callers cannot
> tell which ran and are not asked for a transaction; one is taken for the operation when they did
> not pass one. See [10, build order step 6](./10-leases-and-claims.md), including the entity-wide
> grant this document expected valkey to need and which turned out to be unnecessary, and the silent
> soft delete bug the change uncovered. Phantoms remain the one documented limit.

Encryption is **not** the obstacle, contrary to the obvious guess: `getDefaultBeforeSaveHook`
operates on the update payload alone, and `updateAll` already applies it once and writes the same
ciphertext to every matched row.

> **Partially closed.** The return value was a separate, unrelated bug and is fixed. The second
> `findAll` re-ran the *original* filter against the *new* data, so
> `updateAll({ status: 'QUEUED' }, { status: 'SENT' })` returned `[]` — indistinguishable from
> "updated nothing", inverting any `if (!updated.length)` guard. It now reads back by the ids it
> matched. The missing conditional update above stands.

### M19. `not: null` is wrong — on every column type, not just JSONB — **FIXED**

Filed as a JSONB problem. It was worse than that: **`{ not: null }` matched nothing at all, on any
column.**

`typeorm-where-filter.converter.ts:48` was `not: (value) => Not(value)`, so `{ not: null }` became
`Not(null)` and then SQL `column != NULL` — never true, for any row. The neighbouring `is` handler
special-cases null to `IsNull()`; `not` did not. So the natural way to ask for "rows that have a
value" silently returned an empty set, and every caller reading that as "none of them qualify" drew
the opposite conclusion from the truth.

> **The base converter is fixed** — `not: null` now becomes `Not(IsNull())`.
>
> Found by regression: `event.service.test.ts` started failing when `EventService` began asking for
> subscriber runs with `finishedAt: { not: null }`. The query returned nothing, so every event
> looked permanently unfinished. A pre-existing bug that nothing had happened to depend on.

The originally filed half: `postgres-typeorm-where-filter.converter.ts:39-50`, where
`is: null` becomes `jp = 'null'::jsonb` (JSON null) but `not: null` becomes `jp IS NOT NULL` (SQL
NULL). They are not complements — a row holding JSON null matches both. The consistent form is
`jp IS DISTINCT FROM 'null'::jsonb`, which also handles SQL NULL. Left alone here because it changes
JSONB query results and belongs with a test that pins the intended semantics of `is: null` first.

> **Closed with M18's cast half, and the test came first as the entry asked — which is what showed
> the suggested fix to be wrong.** `IS DISTINCT FROM 'null'::jsonb` answers *true* for a key that is
> absent, so it makes `not: null` match rows that have no value, which is the opposite of what it
> asks. The semantics that had to be pinned first: **a key that is absent and a key holding json null
> are the same thing**, because a value left undefined is not written at all, so a caller cannot
> produce one rather than the other. That is not a preference — it is what the other store already
> does, where every handler tests `value == undefined` and the two questions are exact complements.
>
> So both are built from one condition, `(jp IS NOT NULL AND jp <> 'null'::jsonb)`: `not: null` is
> it, `is: null` and the bare `null` shorthand are its negation.
>
> **A second defect fell out of pinning that**, and it is the one that would have shipped silently.
> Once absent counts as null, `{ reading: { where: { value: null } } }` starts matching every row with
> *no reading at all* — the column reads NULL, the key inside it reads NULL, and the question about a
> value gets answered by a row that has nothing to hold one. The evaluator refuses that outright
> (`matchesNestedWhere` requires the object to be there), so the nested condition is now guarded by
> the same "has a value" test, and a row without the object answers neither half. `jsonb_array_elements`
> got the guard too, since it raises on a column holding the json scalar null where an absent one
> returns no rows.

### M21. A malformed id is a 500 — nothing checks the id against the format it declares — **FIXED**

`GET /invoices/not-a-uuid` answers **500**. Not 404, not 400.

`@Property.string` already sets `format: 'uuid'` whenever `primary` is true
(`property.decorator.ts:91`), so `BaseEntity.id` does declare its shape, and the Postgres data source
emits a matching `uuid` column (`postgres-typeorm-data-source.model.ts:429-431`). Nothing reads the
declaration back. `findById` (`repository.ts:356`) hands the string to the driver unexamined,
Postgres refuses it with `invalid input syntax for type uuid`, and that surfaces as
`QueryFailedError`, an `InternalError` rather than an `HttpError` — which `toHttpError`
(`error.utilities.ts:17-22`) turns into a generic `InternalServerError`.

Three consequences, in order of how much they matter:

- **Every 500 is logged at error level, and unauthenticated traffic can produce them at will.**
  `QueryFailedError` builds its message by interpolating the parameters back into the query text
  (`query-failed.error.ts:17-23`), so a request nobody authenticated writes a full SQL statement into
  the stream operators alert on. The body the client gets is the generic one, so nothing leaks
  outward — the cost is the error stream, and 03 G1's audit trail sits in the same place.
- **The status is wrong in the direction that blames the server.** A client that mistypes an id is
  told the server broke. `GET /resource/:id` is the most common route shape there is, so this is
  reachable in essentially every application built on the framework.
- **A conformance suite, a gateway or a generated client hits it immediately.** So does any scanner.

The per-endpoint workaround exists and works: `@Param.path('id', { type: 'string', format: 'uuid' })`
validates and gives a 400, since `validatePathParam` (`validation.service.ts:128-137`) runs the same
string validation as everywhere else. But `Param.path` defaults to `{ type: 'string' }`
(`param.decorator.ts:91`), so the safe form is opt-in at every route — remembered rather than
guaranteed, which is the shape 03 A2 has just finished arguing against for ownership.

Found while closing 03 A2, not in the original review — a scope test used a deliberately malformed id
to prove non-enumeration and got a 500. It predates that work and was left for a pass of its own.

> **Closed at the repository, and the finding above had the cause wrong.** The first read of this said
> the format was missing from the metadata and belonged there. It is already there —
> `@Property.string` has set `format: 'uuid'` for a primary property all along. What was missing is
> anything that reads it back before the value leaves for the store.
>
> **What decided the shape: the two data sources already disagreed.** ValKey filters in process
> (`val-key-data-source.model.ts:138-139`), so `findAll({ where: { userId: 'garbage' } })` answers `[]`
> there. Postgres types the column and fails. Same call, same declaration, two answers — so this is
> not a new rule being invented, it is the store-independent one being enforced where it belongs.
> `dropImpossibleConditions` (`where/drop-impossible-conditions.function.ts`) runs in `scopedWhere`,
> the seam every read and every bulk write already narrows through, so `findAll`, `findOne`,
> `findAllPaginated`, `updateAll` and `deleteAll` are covered together.
>
> `findById` is covered by the same pass rather than by a check of its own: it reads through `findOne`,
> so a mistyped path parameter is a 404 with **no query issued**, and `updateById` / `deleteById`
> inherit that in turn. A dedicated id check was written first and then deleted — it was a second way
> to say what the general rule already says.
>
> **It only ever narrows.** A value is dropped where dropping it can only remove rows: a bare
> equality, or one entry out of `oneOf` or an OR array. `oneOf: ['garbage', realId]` keeps `realId`
> rather than dropping the whole condition, and a property left with no option at all is what makes
> the branch match nothing. **Negations are not touched at all** — a value the column cannot hold is
> one that every row differs from, so acting on `not` or `notOneOf` would *widen* the filter, and a
> filter that got wider is how a caller sees rows they asked not to see. `{ userId: { not: 'garbage' } }`
> therefore still reaches the driver and still fails there, which is no worse than before and refuses
> to trade a 500 for a leak.
>
> **The uuid check is deliberately looser than the validation of the same format.**
> `UUIDUtilities.isUuid` accepts any 8-4-4-4-12 hex string, where the `format: 'uuid'` validation
> applied to incoming values pins the version and variant digits to what the rfc defines. The two
> answer different questions. Refusing an unusual uuid at the edge costs one request; failing to
> recognize one here would report a row that *is in the table* as absent — a v7 id, or a nil uuid,
> written by something other than `UUIDUtilities.generate`. Where the two disagree, the loose one has
> to be the one guarding a read.
>
> **What it costs, stated plainly:** the declaration is now trusted. On a store that does not enforce
> it, a row holding a value its own property says is impossible becomes unfindable through that
> property. That is the price of enforcing a declaration anywhere, and it is the direction that fails
> closed.
>
> **The relation half closed with [C5](#c5-sql-is-built-by-string-concatenation-not-parameters)**,
> which needed it: binding an id stops it rewriting the statement but leaves postgres parsing it as a
> uuid, so the two halves of that vector had to be fixed together. `includes` and `isIncludedIn` are
> judged by the ids of the entities they name — see C5 for why the two are not symmetric.
>
> **Still open:** the negations above, and a filter reaching a uuid column through an *object*
> property, where the narrowing still does not descend. Both are the same defect one level down, and
> neither is reachable from the common shape — a path parameter or a query parameter naming an id.
> One narrower case joined them: an `isIncludedIn` list on a relation whose entries are all
> impossible, left alone on purpose because emptying it would change the answer rather than narrow
> it.
>
> **This fix had a defect of its own, found by running the suite rather than by reading it.** It
> assumed every entity id is a uuid, because `@Property.string({ primary: true })` sets
> `format: 'uuid'` — while the framework itself wrote rows under ids like `user:42`, through
> `create(…, { allowId: true })`. Those rows were written, listed, and then never found again: the
> narrowing discarded every `where: { id: … }` naming them. `RepositoryRateLimiterStore` was doing
> exactly this, so **rate limiting on a shared store silently stopped reading its own state**, and a
> cluster fixture had the same shape. Any application using a slug or an external id would have had
> it too, with no error anywhere.
>
> The declaration is now enforced rather than assumed: `assignId` refuses an id that the id property
> says it cannot hold, so this fails at the write that chose the value instead of at every later
> read. The two entities that needed chosen keys name them with a property of their own, which is
> what they were describing anyway — `RateLimitStateEntity.key` and `ValKeyCounter.name`.
>
> **The lesson worth keeping:** a narrowing that trusts a declaration is only as good as whatever
> makes the declaration true, and nothing did. Enforcement and inference had to ship together.
>
> **Closed 2026-10-02, both remaining halves.** The negations are refused rather than narrowed, by
> the user's choice: `not` or a `notOneOf` entry naming a value a uuid property cannot hold throws a
> `BadRequestError` naming the property's place in the filter, on every store. Dropping the value was
> the other candidate - every row differs from it, and valkey answered every row - and was declined
> for the reason given above: on a store that does not type its columns a row holding such a value
> can exist, and widening would hand it to a caller who excluded it. Refusing never widens and never
> reaches the store, and the three stores agree by refusing. The descent turned out to be one level
> narrower than written: an *object* property filters through jsonb text without a cast, so postgres
> never raised there and every store already answered alike. The 500 was the relation to one entity -
> `{ team: { where: { id } } }`, `is`, `oneOf` - which reaches the target's uuid column through a join.
> Those are narrowed now, a `where` by the target's own properties and to any depth, entities by
> their id. The deliberately untouched `isIncludedIn` case above stays as it was.
>
> **Two defects found by the user's first run, both pre-existing.** Postgres never answered an OR
> inside a relation's `where` (`{ owner: { where: [a, b] } }`): typeorm ORs only at the top level, so
> the array was read as an object whose keys are its indexes. The converter now moves such an OR to
> the top, `[{ owner: { where: a } }, { owner: { where: b } }]`, to any depth. Writing the case for
> it showed the in-process stores had the mirror image: valkey and in-memory resolved only the first
> level of the relations a filter names, so a filter two relations down was judged against a relation
> nobody read and matched nothing. Both resolve the filter's whole tree now, through
> `EntityRelationsUtilities.resolveFilterTree`. Held by a case in `nested-relations.cases.ts`, red on
> in-memory before the fix. Held by
> `drop-impossible-conditions.test.ts` (now booting an in-memory application, since a refusal is a
> translated message), two cases in `uuid-values.cases.ts` that run on all three stores, and a case
> in the M21 block of `data-layer.evaluation.test.ts`.

### M23. A migration's version is also its identity — ~~MAJOR~~ **FIXED**

`src/data-source/migration/run-migrations.function.ts`

`Migration.version` answers two different questions, and it cannot answer both:

- **which app versions this schema state belongs to** — the compatibility gate, and the thing
  [C3](#c3-down-migrations-run-automatically-on-version-downgrade--critical-fixed) is built on
- **which migration this is** — applied-ness is `appliedVersions.includes(m.migration.version)` and
  `runDown` deletes its record with `deleteAll({ version })`

Two migrations declared with the same version is the ordinary case for two schema changes shipping in
one release, and it breaks both readings. The second migration is treated as already applied the
moment the first records itself, so **it silently never runs** — no error, no log line, just a schema
missing half of what the release said it would do. Reverting either one deletes both records.

Ordering is a third thing the version is *not* doing: migrations run in the order the data source
declares them, so a version is not what sequences them either.

The fix is a separate identity — the class name is already recorded in `MigrationEntity.name` and is
the obvious candidate — with `version` keeping only the compatibility meaning. That is a change to
what the migration table means, so existing rows have to be considered.

> **Closed as the entry suggests, and the last sentence turned out to cost nothing.** `runUp` was
> already writing `name: this.constructor.name` on every row, so moving applied-ness from the version
> to the name needed no backfill and no data migration: every record that exists already carries its
> identity. What did have to change is the schema *asserting* the bug — `MigrationEntity.version` was
> declared `unique: true`, which says one migration per version, which is the thing the entry says is
> the ordinary case.
>
> **The revert path had a second half the entry does not mention.** `runDown` deleted its record with
> `deleteAll({ version })`, so reverting one change of a release removed the records of all of them —
> the entry names this. What it does not name is the *order*: `revertMigrationsAfter` sorted the
> applied records by version, descending. Once several migrations share a version that is not a total
> order, and the ordering matters precisely there, because a later change of a release is the one
> most likely to build on an earlier one.
>
> **Reverse declaration order, not `ranAt`.** Migrations are applied in the order the data source
> lists them, so reversing that list is reverse application order — and `revertMigrationsAfter`
> already refuses unless this build carries every recorded migration, so it always has the whole list
> to reverse. A timestamp was the alternative and was declined: two migrations of one release run
> back to back and can share a millisecond, so a tie is undefined exactly where the ordering is for.
> A monotonic sequence column would be exact under any deploy history and is the one option that
> would have needed a backfill.
>
> **What the class name costs**: renaming a migration class after it has shipped makes it look
> unapplied, and it runs again. An explicit id declared beside the version was the alternative and
> was declined for making every author declare two things where one already existed — and a
> duplicated id would fail the same silent way the version does today.

### M22. `unique` is enforced on postgres and ignored on valkey — ~~MAJOR~~ **FIXED**

> **Closed**, held by `valkey-durability.evaluation.test.ts` and `repository-error-handling.test.ts`.
>
> **It was closed against other writers, and not against itself.** `createAll` carrying the same
> value twice stored both rows: `saveThrough` writes the entries with `Promise.all`, so every claim
> read the index before any of them had written to it and each one saw a value nobody held. The
> comment above that loop had the reasoning that made it invisible - *"the single key they share -
> the id set - only ever has members added"* - which is true of the id set and precisely wrong about
> a unique index key, the one key whose whole purpose is that at most one row may hold a value.
>
> Fixed by taking the claim out of the concurrent pass and running it one row at a time. **The rows
> are still written together**: what is serialized is only `saveUniqueIndexes`, which does nothing at
> all for an entity that declares nothing unique, so nothing that was concurrent before pays for
> this. A violation still leaves nothing behind - a save with anything to enforce always runs inside
> a transaction, every write above it is buffered there, and `rollback` discards them.
>
> The index [M15](#m15-valkey-data-source-filters-in-node-one-round-trip-per-row--partially-fixed)
> built to make a unique lookup fast is what enforces it. A save reads the index key under a grant on
> it and refuses the write with a `UniqueConstraintViolationError` when another id is already there.
> The grant is the part that makes it an answer rather than a guess: an index cannot say who holds a
> value until it has been read, and a grant taken after the read would leave that answer already
> stale — the same reason `upsert` claims its key before looking.
>
> **What it costs, and who pays.** A grant lives on a transaction, so `save` takes one of its own when
> the entity declares anything unique. Everything else keeps writing exactly as directly as before: an
> entity declaring nothing unique pays nothing, and neither does an update that leaves the value
> alone, because the index write is skipped when the value did not change. Only a save actually
> *taking a value up* pays the grant and the read.
>
> **Both options the finding named turned out to be the wrong shape.** It offered "a read before every
> write of a row carrying a unique property" or "enforce only inside `upsert`", and then ruled the
> second one out. The answer is narrower than the first: a read before every write that *takes a value
> up*. Giving one up needs nothing, because removals commute — two rows letting go of different values
> never have to be ordered against each other — which is the same argument that left the id set free.
>
> **The half nobody filed: which error.** Enforcing on valkey only closes the finding if both stores
> then refuse the same declaration the *same way*. Postgres raised a `QueryFailedError` carrying sql;
> anything valkey threw would have been a second thing to catch, and `unique` is declared on the
> entity precisely so an application does not have to know which store it is talking to. So
> `UniqueConstraintViolationError` is thrown by both, names the properties that are taken, and keeps
> the failed query as its `cause` so the sql is still there to read.
>
> Spotting a violation, on the other hand, *is* dialect specific — postgres reports sql state 23505
> and names the columns in its detail, mysql reports 1062 and names the key in its message — so
> `violatedUniqueProperties` is abstract on the typeorm base data source rather than baked into the
> shared driver, next to `buildUpsertSql` for the same reason.
>
> **The rate limiter's `catch` now names what it is catching.** Item 0's comment is true on both
> stores, and the bare `catch` it sat behind is not: a store that is unreachable is not contention, and
> retrying it twice more only turned the real cause into *"written by another instance 3 times in a
> row"*.
>
> **Not covered:** a row written before this index existed carries no entry, so the write path cannot
> see it — the same gap the read side answers by falling back to reading every row, and it closes for a
> row the next time that row is written. And a row *giving up* a value in a transaction that has not
> committed yet still holds the index entry, so a concurrent write of that value is refused where
> postgres would have blocked and then allowed it. A spurious conflict, never a duplicate.
>
> One more, inherited rather than introduced: two multi-row saves taking up the same values in
> opposite orders hold one index key each and wait for the other. Postgres blocks on the same pair and
> reports a deadlock; here the acquisition times out instead, which is `ValKeyTransaction`'s standing
> difference — *"a cycle of transactions waiting on each other's keys is resolved by the acquisition
> timing out rather than by being detected"*. Claiming a save's index keys in a fixed order up front,
> the way `updateAll` sorts the rows it holds, is what would remove it.

The original finding, for the record:

One declaration, two meanings, with nothing at the call site saying which one applies.

- **Postgres enforces it.** `postgres-typeorm-data-source.model.ts:382-412` spreads the property
  metadata into `EntitySchemaColumnOptions`, whose `unique` typeorm turns into a column constraint,
  and `typeorm-base-data-source.model.ts:631` turns each group in the entity's `uniques` into a named
  table constraint. A second row carrying the same values is refused by the database.
- **ValKey enforces neither.** `ValKeyRepositoryDriver.save` writes the row hash, the id set, the
  unique index and the relation sets. Nothing reads the index to refuse a write, so the second row is
  simply stored.

This is the divergence-between-two-implementations shape that
[10 §10.1](./10-leases-and-claims.md) names: the kind a test suite exercising only one store never
sees. It is also the same *class* as [M21](#m21-a-malformed-id-is-a-500--nothing-checks-the-id-against-the-format-it-declares--fixed)
one level over — a declaration the read side trusts and the write side never made true. That is now
two instances, which is what makes it worth stating as a rule rather than as a bug.

**What it costs today, in order of how much it matters:**

0. **The rate limiter depends on it in writing, and the dependency is in framework code rather than
   a consumer's.** `repository.rate-limiter-store.ts:138-143` catches a failing `create` and comments
   *"the key is unique and the row has no other constraint, so the only thing this can collide with is
   the same key being created by someone else"*. On valkey there is no constraint to fail, so the
   second create succeeds and the limit ends up split across two rows — `findOne` answers with one of
   them, and a limiter that should have refused a caller lets them through. A rate limit that
   under-counts does so exactly during a burst, which is the only time it matters.

   **What makes this narrower than it sounds, and sharper.** `atomicUpdate` holds a lock per key, so
   two first-time creates are normally serialized and no duplicate arises. The case that reaches it is
   the lock lapsing under its holder — which is [03 §E4](./03-auth-and-security.md) and
   [10 §10.1](./10-leases-and-claims.md), and precisely what the `version` column on the row was added
   to survive. **The version guard covers the read-modify-write and has no equivalent for the first
   insert**: there is no row yet to carry a version, so on postgres the unique constraint is what
   stands in for it, and on valkey nothing does. Found by `val-key-data-source.test.ts`'s
   *loses no update even when the lock does not hold*, which is the one test that removes the lock on
   purpose.

1. **`upsert`'s premise can be false at runtime.** `unique-group-for.function.ts:10-14` states the
   contract: an identity that is not declared unique "can match more than one row, and an operation
   that has to pick between them is a read followed by a decision - the thing an upsert exists to
   avoid". The *declaration* is checked when `upsert` is called; the *fact* never is. On valkey a
   duplicate therefore makes `upsert` silently pick one of the matches, which is exactly the
   read-then-decide it was built to replace.
2. **A unique lookup returns an arbitrary row.** `findOne({ where: { key } })` answers with whichever
   of the duplicates comes first.
3. **The [M15](#m15-valkey-data-source-filters-in-node-one-round-trip-per-row--partially-fixed) index
   degrades rather than corrupts.** Two ids land in the one set and both are handed to the filter as
   candidates, so a duplicate is survivable — wrong answer, not broken store.

**Why it surfaced now:** nothing on valkey had ever needed to look a unique value up, so nothing had
occasion to notice. The index is the first thing that reads them.

**Why the severity moved:** filed as a divergence between two stores, which reads like a portability
problem. Item 0 makes it a correctness one in shipped framework code, on the write path of the
component whose whole job is to refuse callers.

**Why this is filed rather than fixed in passing.** Enforcing it means a read before every write of a
row carrying a unique property, plus a grant over the index key so two replicas cannot both find it
free. The machinery exists — that is precisely the grant-before-read `upsert` already does — but the
cost lands on the write path of *every* save of *every* entity with a unique property, which is a
tradeoff to decide deliberately rather than to absorb inside another change. The narrower option is
to enforce only inside `upsert`, where the premise is actually depended on, and to leave a plain
`save` unchecked; that is cheaper and closes 1 without closing 2.

**That narrower option has since stopped being enough.** Item 0 arrives through `create`, not through
`upsert`, so enforcing only inside `upsert` would leave the framework's own rate limiter depending on
a guarantee it still does not get. Either the check goes on the write path of every save of an entity
carrying a unique property, or the rate limiter stops relying on the constraint and claims the key
some other way — a lease taken over the key before the create, which is the same primitive
[10](./10-leases-and-claims.md) settled on and the one thing already known to survive a lock that
lapsed under its holder.

### M24. `upsert` cannot see relations, on the way in or on the way out — ~~MAJOR~~ **FIXED**

> **Confirmed from a second call site**, and not by reading: making
> [04 §2.4](./04-infrastructure-subsystems.md#24-a-permanently-failing-subscriber-marks-the-event-finished--major-fixed)
> write its ledger row with `upsert` instead of `create` produced
> `"EventSubscriberRun" has no property "event"` — the same failure this section predicts, one
> subsystem away, on a create shape the types accepted. The fix there was local, and is the shape the
> finding recommends: `EventSubscriberRunCreateData` now names `eventId` rather than the relation, so
> the create data says what a single statement can write. That is one entity opting out of the
> ambiguity rather than the ambiguity being resolved, and this stays open.

> **Closed, and neither store had to change - the repository above them did.** The translation from a
> relation to the foreign key it resolves to now happens in `Repository.upsert`, before the driver
> sees anything, so both stores get one answer by construction. That is also what makes the
> disagreement the entry names go away rather than be settled in one store's favour.
>
> **The two stores were not disagreeing on purpose.** `ValKeyRepositoryDriver.applyToOneRelation`
> already resolved a `belongsToOne` or `manyToOne` to its join column while saving, which is why
> valkey accepted what postgres threw on. Postgres's `upsert` builds one statement and maps every
> create key through `findColumnWithPropertyName`, which has nothing to return for a relation. So one
> store had the behaviour and the other had never learned it.
>
> **The line is which relations live in this row, not which are convenient.** `belongsToOne` and
> `manyToOne` hold the foreign key here, so naming one is the same write as naming the column - one
> statement, still atomic. The other three keep their key on the row at the other end or in a join
> table, so writing one means writing rows beside this one, and statements around the
> insert-or-update reopen the window `upsert` exists to close. Those are refused, by name, with the
> reason.
>
> **Refusing all relations was recommended first and was wrong.** The user pushed back with "can we
> not create the relations - is the problem only the update part?", and the answer is that the
> problem is neither: it is that an upsert is one statement while `create` goes through
> `manager.save`, which is free to issue several. TypeORM's own `InsertQueryBuilder` settles the
> line in the same place - it maps owner-side relations to join columns through
> `referencedColumn.getEntityValue` and never cascades.
>
> **TypeORM's `upsert` was considered as a replacement for `buildUpsertSql` and cannot be one.**
> `orUpdate` emits `col = EXCLUDED.col` or `col = :param`; both write a value known before the
> statement runs, and neither can express `col = col + 1`. That is what this `upsert` exists for -
> `InvoiceNumberService` allocates invoice numbers with `{ number: { increment: 1 } }`, and its own
> comment spells out what a read-modify-write costs there. A hybrid that used typeorm's upsert for
> `set`-only conflicts would be more code, not less, since the hand-built path still has to exist.
>
> **The way out is a read after the write**, honouring `relations` and falling back to
> `defaultRelations` the way every other read does. Typing the result without them was the
> alternative and was declined: it makes every caller that wants the whole entity do two round trips
> and know to.

`repository.ts:304-321`, `typeorm-base-data-source.model.ts:331-387`,
`val-key.repository-driver.ts:224-266`

Every read takes `relations` and falls back to the entity's `defaultRelations`
(`repository.ts:129-142`, `find-all-options.model.ts:20`). `upsert` takes `BaseRepositoryOptions`,
which carries a transaction and `unscoped` and nothing else, so there is no way to ask for one — and
the entity's own `defaultRelations` are never consulted either. An entity that every other query
returns with its relations resolved comes back from an `upsert` without them, and the property is not
typed as optional, so reading through it is a `TypeError` rather than a compile error.

The way out is the smaller half. **The two data sources disagree about the way in.**

- Postgres maps every key of `create` and of `onConflict` to a column through
  `findColumnWithPropertyName` (`:345-351`, `:368-374`). A relation is not a column, and the
  framework's own entities declare the foreign key as a property of its own
  (`change-sets/models/change.model.ts:30-36`), so nothing carries the relation's property name and
  the call throws `"Change" has no property "changeSet"` — an `InternalError`, a 500 that reads as a
  framework bug, for something the caller wrote.
- ValKey routes both paths through `save`, which resolves a to-one relation given as a full entity to
  its foreign key (`:136-142`, `toFields` → `applyToOneRelation`) and writes to-many and many-to-many
  relations as keys of their own. The same call is accepted and stored.

Nothing in the types says which of those a caller gets: `CreateData` defaults to `DeepPartial<T>` and
`AtomicUpdate<T>` ranges over `keyof T` (`atomic-update.model.ts:21-23`), so a relation property
typechecks against both.

**The two halves do not have the same fix, which is the part worth recording.** Reading the relations
back is a second query whose row id is already known by then, so the only open question is whether
`upsert` runs it or the caller does — and `defaultRelations` being skipped where every other read
honors it is a defect either way. Accepting relation *data* is not that cheap: what makes the postgres
upsert atomic is that it is one statement, and one statement is one table, so a cascading insert
cannot join it without giving up the guarantee the operation exists for. On that reading **valkey is
the wrong side of this divergence** — it makes a relation write look supported, and it is supported
there only because its upsert is assembled out of ordinary saves. So the choice is to refuse a
relation property in `create`/`onConflict` on both stores with an error that names it, or to accept it
on both and document that only the foreign key is ever written. Refusing keeps the operation honest
about being a single statement.

### M25. An `Error` stored in a column keeps `{}` of it — ~~MAJOR~~ **FIXED**

> Both columns are `LoggedError` now, the shape `EventSubscriberRun.error` already used and the one
> `LogContext.error` has always stored — so all three records of a failure agree, and `paragraphs`
> carries the `cause` chain the flat shape dropped.
>
> **The fix this finding proposes does not work, which is worth more than the fix that did.** It
> suggests the property decorator refuse an `Error` typed column, and `emitDecoratorMetadata` looks
> like it hands over exactly that. Measured: `design:type` is `Error` for a bare `error?: Error`,
> and `Object` for both `Error | null` and `Error | undefined`, because TypeScript emits `Object`
> for every union. **Both real defects were `Error | null`** — the reflection a decorator can reach
> is blind to precisely the shape this occurs in, and a guard built on it would have passed while
> the two columns it was written for stayed broken.
>
> So the guard reads source instead: `serialized-error-columns.test.ts` scans every
> `@Property.unknown` declaration in `src` and refuses one whose type mentions `Error`. It found the
> two this finding names and nothing else, which is also the evidence the scan is looking in the
> right place.
>
> **One wart went with it.** The worker's `{ name, message, stack }` was typed `Error` while not
> being one, so `instanceof Error` answered no for a value the type promised was yes. The message,
> the column and the in-memory `ThreadJob` are all `LoggedError` now, and `toThrownError` rebuilds a
> real `Error` at the one boundary that owes the caller one — `runThreadJobFunction`'s rejection.
>
> Three of the five write sites were storing a real `Error`: the job timeout, the worker crash
> handler, and eight assignments in the PayPal provider.



`multithreading/models/thread-job-entity.model.ts:63-64`,
`plugin/payment/models/payment.model.ts:52-53`

Both declare `@Property.unknown({ required: false }) error?: Error | null`. On postgres `unknown`
maps to `jsonb` (`postgres-typeorm-data-source.model.ts:136`), and an `Error`'s `message`, `stack`
and `cause` are all non-enumerable — so what reaches the column is `{}`. The row records that
something failed and nothing whatever about what. Both are the only record of their failure:
`ThreadJobEntity.error` is what a job that died leaves behind, and `Payment.error` is what a failed
charge leaves behind.

Nothing warns. The property is typed `Error`, the write succeeds, and the value is only discovered to
be empty by reading it back — which is why this survived: every test asserting on one of these
columns checks that it is *defined*, and `{}` is defined.

The framework already has the answer and uses it for logs: `LoggedError`
(`logging/logged-error.model.ts`) is a plain `{ name, paragraphs, stackTrace }` that survives
serialization and follows the `cause` chain, produced by `errorToLoggedError`. `LogContext.error`
stores exactly that. Cron takes the other route, `ErrorUtilities.unknownToErrorString` into a
`string` column (`cron/cron-job.model.ts:503`), which is enough when only the message matters.

Found while fixing [04 §2.4](./04-infrastructure-subsystems.md), whose
`EventSubscriberRun.error` had the same declaration and is now a `LoggedError` — so the third
instance is closed and these two are not. What would stop it recurring is the property decorator
refusing `Error` for a serialized column, since the type is the thing that reads as safe.

> **The other end of the same problem, found the same way and fixed.** The thread job worker does not
> have this defect — `helpers.ts` flattens what it catches to `{ name, message, stack }` precisely
> *because* those fields are not enumerable, which is the right call for a column. But the flattened
> shape is typed `Error` and handed straight back to callers: `run` rejected with it and `onError`
> received it, so `instanceof Error` was false for a value the signature promised was one, and
> `docs/multithreading.md`'s "rejects with an error" was not true.
>
> Found by writing `rejects.toThrow()` in a test — jest counts a rejection as thrown only when it is
> an `Error` instance (`expect/build/index.js:1819`), so it reported *"Received function did not
> throw"* about a promise that had rejected. That is the assertion any consumer would write, and it
> is a good illustration of the cost: the value is wrong in exactly the way that makes the ordinary
> check for it silently fail.
>
> `MultithreadingService` rebuilds a real `Error` from the stored shape on the way out. The column
> keeps the flat one, which is what it is for.

### M26. Nested defaults, encryption, hashing and exclusion silently stop propagating across a relation cycle — ~~MAJOR~~ **FIXED**

> **The heading was stale, not the finding** — this closed with `model-registry.test.ts` and is in
> the executive summary's closed table; only the marker here was missed.
>
> A placeholder still goes into the cache before the descriptors run, because a cycle has to find
> *something* there. What changed is that a build no longer has to be right the first time.
> `ModelRegistry` tracks how deep it is (`buildDepth`) and what it built on the way
> (`building`), and when the outermost build unwinds, `settle()` re-runs every descriptor over all
> of them until the nested-key count stops growing. Order therefore stops deciding the outcome: the
> class that was reached while its partner was still a placeholder gets another pass once the
> partner is real.
>
> **A fixpoint rather than a second pass**, because one extra pass only fixes a cycle of length two.

- `src/global/model-registry/model.registry.ts:62-85` — `buildInPlace` caches the placeholder
  **before** running the descriptor updates, so a class reached again while it is still being built
  is observed empty.
- `default-descriptor.ts:48-59`, `encryption-descriptor.ts:47-58`, `hash-descriptor.ts:47-58`,
  `exclude-descriptor.ts:46-58` — all four register a nested descriptor only
  `if (nested.hasAnything())`, evaluated at build time.

Two entities that reference each other are a cycle, and every relation with an `inverseSide` is one.
Which of the two is resolved first decides which edge survives:

- `ModelRegistry.get(Backup)` first → `BackupResourceEntity` is finished by the time
  `Backup.resources` is looked at, `hasAnything()` is true, the edge is registered.
- `ModelRegistry.get(BackupResourceEntity)` first → `Backup` is built from inside it, sees the empty
  placeholder for `BackupResourceEntity`, registers nothing — **and that is cached for the life of
  the process.**

In the second order, `setDefaultValues(backup)` never descends into `backup.resources`. A nested row
reaches the insert without its declared `default`, and a `NOT NULL` column fails somewhere that
names neither the entity nor the decorator. The same gate guards the other three descriptors, so the
same ordering decides whether a nested `encryption: true` value is written encrypted or in plaintext,
whether a nested `hash: true` value is hashed, and whether a nested `exclude: true` value is
serialized into a response. Nothing warns, and nothing about the entity declaration is wrong.

It is order-dependent in the strict sense: no entity, decorator or option changes the outcome, only
which class something happens to ask for first. That is decided by data source registration order,
by which repository is injected first, and by anything that touches the registry during boot — which
is why adding an unrelated `ModelRegistry.get()` to schema building was enough to flip it.

The `hasAnything()` guard is what breaks it, and it is also the only reason the walkers terminate
today: one edge of every cycle is always missing, so the descriptor graph is always acyclic by
accident. A correct graph for `A → B → C → A` has all three edges, and then a **cyclic object graph**
— which TypeORM produces when both sides of a relation are loaded — walks forever.

**FIXED**, both halves, because neither is safe alone.

`ModelRegistry` settles the build before handing it back. When the outermost `get()` finishes, every
class built during it is re-run until nothing changes. `hasAnything()` only ever turns from false to
true, so the pass is monotone and reaches a fixed point in at most as many rounds as the longest
chain. It runs at startup as part of resolving a class, not per operation, and only over the classes
that build actually touched.

The eight walkers over `nestedKeys` carry a set of the objects they have already visited. That is
what makes the now-correct cyclic graph safe, and it is a correctness fix in its own right: visiting
the same object twice through two paths would encrypt an already-encrypted value a second time.

### M27. A value stored as json comes back as whatever json could carry — MAJOR, **FIXED**

> **The cache half is closed, and it took a second defect with it that was worse than the one filed.**
>
> A serializing store is now told what it holds: `ValKeyCacheStore` takes a required `model`, which
> is either a class carrying `@Property` declarations or the literal `'plain'` for a value with no
> shape to read. The store reads a value back through `parseObject`, the same metadata walk a request
> body goes through — so a cached `Date` is a `Date` again, and a `bigint` and an exact decimal come
> back as themselves. **`CachedValue` was already a decorated model** and the store was already
> hand-restoring its own two timestamps, which is the whole finding in miniature: the mechanism
> existed, applied to two fields somebody remembered, and to nothing else.
>
> Required rather than optional on the user's call, and the compiler then did the survey: nine call
> sites had to say what they hold, which is the list of everything that was silently relying on the
> old behaviour. The in-memory store takes no model, because it never serializes.
>
> **The second defect: a class does not survive json, and the router was dispatching on one.**
> `parseObject` restores *values*, never instances — it returns the parsed object with its
> properties converted, and never calls a constructor. So a `HtmlResponse` out of a shared cache was
> a plain object, `result instanceof HtmlResponse` answered no, and the page was served as a json
> body. That is the framework's own documented caching example: `docs/caching.md` recommends a
> `ValKeyCacheStore` for sharing between instances, over a cache of exactly that type.
>
> Fixed by making identity a value rather than a prototype: `SelfDescribing` declares
> `readonly className`, both response wrappers implement it, and the router's seven `instanceof`
> checks are `isHtmlResponse` / `isFileResponse`. The property is `exclude`d, so it stays wiring. A
> `CacheModel` must be a class whose instances are self-describing, which makes the round trip
> answerable by construction rather than by remembering.
>
> The model type is `DeclaringClass` rather than `Newable` on purpose: nothing constructs it, and
> requiring a public constructor would have refused both response wrappers, which keep theirs private
> so they are only built through their factories.
>
> `fs.backup-transport.ts` reads a `BackupEntity` through `parseObject` now too, so a backup's
> timestamps are dates rather than the strings json wrote.
>
> **The json columns are closed too, and the first read of them here was wrong.** Grouping
> `@Property.object()` with `@Property.unknown()` as "the half with no metadata to consult" was a
> mistake: an object property names a class, an array property names its items, and `parseObject` /
> `parseArray` already walk exactly those declarations, dates and number formats included. The
> metadata was there. Nothing called it on the read path — a `jsonb` column carried no transformer at
> all, so the driver's `JSON.parse` result went back untouched, and valkey's `fromStorableValue`
> returned `object` and `array` unchanged.
>
> Both data sources now restore through that walk, and both write through one `toJsonValue`, which
> converts what json cannot carry — a date, a bigint, an exact decimal — all the way down rather than
> at the top level only. A bigint inside a json column is written as its digits instead of throwing.
>
> **`@Property.unknown()` is where it stops, deliberately.** A property that describes nothing leaves
> nothing to read a date or a decimal by, so what json held is what comes out. That is the boundary
> the user drew and it is the right one: the declaration says "no idea what this is", and the answer
> matches the question. It is written down in `docs/data-source.md` rather than left to be discovered.
>
> **The number arrays were the same defect one type over.** An array of numbers is a real
> `bigint[]` / `numeric[]` column, and that branch attached no transformer either, so its elements
> came back as the text the driver read. Covered now by the same test.
>
> **A transformer was not enough for an array of exact decimals, and only a container said so.** The
> client reads `numeric[]` with one `parseFloat` per element (`pg-types/lib/textParsers.js:189`), so
> `12345678901234567890.123456789` arrived as `12345678901234567000` — the digits were gone before
> any transformer could see the value. A single `numeric` survives because that type has no parser
> registered at all and arrives as text, which is the shape an exact decimal is read from. The
> connection now reads that one array type as `text[]` and hands each element over in the shape a
> scalar already has; every other type still goes through the client's own parser. `bigint[]` was
> never affected — its parser hands back text for anything a double cannot tell apart.
>
> **And the blanket stringify turned out to cost writes.** `numberColumnTransformer` was turning every
> number into text, including the two formats a javascript number holds exactly. TypeORM compares the
> transformed value against the hydrated one with `===` to decide which columns changed
> (`SubjectChangedColumnsComputer.js:132-151`), so `"21.5" === 21.5` was false and **every number
> column was rewritten on every save**, touched or not. Only `BigNumber` actually needs converting —
> pg's `prepareValue` ends in `val.toString()`, so a bigint is already sent as exact text, while a
> `BigNumber` is an object with no `toPostgres` and would go to postgres as quoted json. Narrowing it
> to that one case makes three of the four formats compare equal again. Caught by the user asking why
> a plain number was being stringified at all.

**Found while closing [§M8](#m8-every-number-column-is-decimal-round-tripped-through-strings--fixed),
by asking where else a type that json cannot hold could leak. It is older and wider than that
finding, and it is not about numbers.**

A property whose value is stored *as json* — `@Property.unknown()` and `@Property.object()`, which
become `jsonb` on postgres and a json field on valkey — is written with `JSON.stringify` and read
with `JSON.parse`. Json has no bigint, no decimal and no date, so what comes back is not what went
in, and nothing on the read side knows enough to put it back.

The columns this affects today are all framework-owned: `Change.previousValue` and `Change.newValue`
(`change-sets/models/change.model.ts:20,26`), `ThreadJobEntity.workerData` and
`ThreadJobEntity.result` (`multithreading/models/thread-job-entity.model.ts:74,79`), and every
consumer entity that declares one.

**Measured rather than assumed** (`node`, against the repository's own `bignumber.js`):

| value inside a json-stored object | written as | read back as |
|---|---|---|
| `10n` | **throws** — `Do not know how to serialize a BigInt` | — |
| `new BigNumber('10.5')` | `"10.5"` | `string` |
| `new Date(0)` | `"1970-01-01T00:00:00.000Z"` | `string` |

So there are two different failures wearing one cause. A **bigint refuses to be written at all**,
which is loud and lands at the write rather than at the read. A **BigNumber and a Date are written
happily and come back as strings**, which is silent — and `Date` has been doing that since long
before numbers had formats.

**The valkey cache store is the same defect with the halves swapped**, and this one is silent for
bigint too. `val-key.cache-store.ts:180` writes with `JsonUtilities.stringify`, which carries a
replacer turning a bigint into its digits; `:418` reads with `JsonUtilities.parse`, which takes no
reviver. So the write side was taught about bigint and the read side never was: a cached entity's
`bigint` property comes back as a string, and the caller is holding something whose type says
otherwise. The multi-tier cache inherits it.

**Why the number formats did not fix this.** A number *property* now round-trips exactly on both
stores, because the driver knows its metadata and can put the value back — `readNumber` is what does
it. A value nested inside a json column has no metadata: the column's declared type is `unknown`,
which is the whole point of it. The two are not the same problem and the second does not follow from
the first.

**What a fix has to decide**, because none of it is obvious:

- **Where the type information comes from.** A reviver needs to know that this string was a date and
  that one was a decimal. Either the value is written self-describing (a tagged envelope, which
  changes what is in the column and what anything else reading that database sees), or the property
  declares the shape it holds — which is `@Property.object({ cls })` territory and does not exist
  for `unknown` by construction.
- **Whether a bigint should keep throwing.** It is the only one of the three that fails loudly, and
  loud is better than a string. A fix that makes it writable makes it silent unless the reviver is
  built first.
- **The cache is the easier half and still needs an answer**: `JsonUtilities.parse` could take the
  reviver that matches its own `stringify` replacer, which at least makes the two symmetric — but a
  reviver keyed on "looks like digits" would turn a genuine string of digits into a bigint, which is
  worse than what it fixes.

**Not a regression, and the surface is measured rather than guessed.** Every other boundary a value
crosses was checked and is covered: request bodies, query, path, header and form-data params all go
through the metadata-driven `parseObject`/`parseNumber`; **the http client's responses go through the
same path** (`parsing/json/json.body-parser.ts:30` — `parseObject(rawBody, modelClass)`) and are
validated after it; responses out are `JsonUtilities.stringify`, which the open api document now
describes correctly (`type: string`, `format: int64` / `decimal`); backups are `pg_dump` text.
Filtering *was* broken by the number formats — a `BigNumber` filter value is an object, so both
filter processors read it as a filter with operators on it and reported the field `s` as an unknown
key — and that is fixed, beside `Date`, in both.

[§M25](#m25-an-error-stored-in-a-column-keeps--of-it--major-fixed) is the same column type failing a
different way, and its lesson applies here: the guard that looks like it should work — reading the
declared type off `design:type` — is blind to `T | null`, which is the shape these columns actually
use.

---

### M28. Text is ordered by one locale for the whole application — MINOR, **open**

*Filed by this work on 2026-09-18, while closing [05 §M5](./05-di-metadata-and-packaging.md)'s scope
merge.*

Which text sorts after which used to be whatever each store happened to do — the in-process evaluator
compared with the runtime's own `localeCompare`, postgres with the collation of whatever database it
was pointed at — so one filter, one `order` and one keyset walk answered differently on the two
stores, and differently again on a database created with another collation. That is closed: text is
ordered by the application's `defaultLocale`, held by `LocalizeServiceInterface.compareText` in
process and by an `<locale>-x-icu` collation on every postgres text column, with the collation
declared **on the column** so ordered reads keep their index.

What stays open is that the order is per application rather than per request. A product serving
Swedish and German users stores one of the two orders and lists names that way for both; the
application has to say so (`textOrder: 'defaultLocale'`), and startup refuses until it does, so
nothing about it is silent — but a caller cannot ask for their own.

Building it means naming the collation in every statement that orders or compares text, which
TypeORM's `FindOptionsOrder` cannot express at all, so ordering would move onto a query builder. The
cost is the reason it is not built: an ordinary index no longer serves an ordered read once the
statement names a different collation, so every listing pays a sort. A per-collation index per
supported locale is the way out and is a schema decision, not a framework one.

### M29. A bulk write hands back rows a read of the same rows would not — MINOR, **FIXED**

*Filed by this work on 2026-09-18, while closing [§M12](#m12-write-amplification-on-change-set-and-soft-delete-entities--major-fixed)'s
read-back half.*

`create`, `updateById` and `upsert` hand back the row that finding it by its id would give: every
column, and the relations the caller asked for or the entity reads by default. Their bulk siblings do
not. `createAll` resolves the relations *its own data named* and nothing else, and
`updateAll({ returnUpdated: true })` and `deleteAll({ returnDeleted: true })` resolve none at all — so
an entity declaring `defaultRelations` is handed back whole by one call and half by the other, with
nothing saying which is which.

The reason it was left is the reason it is not obviously a defect. A bulk call has no bound on how
many rows it answers with — `validateReturnIsBounded` caps it at what `findAll` caps a read at, which
is ten thousand — and resolving a relation is a read per row. Making the two consistent by resolving
them would put a per-row read behind a call whose whole point is that it is one statement; making
them consistent by *not* resolving them would take relations away from the singular calls, where the
cost is one read and a caller reading through an unresolved property is the bug
[§M24](#m24-upsert-cannot-see-relations-on-the-way-in-or-on-the-way-out--major-fixed) closed.

So the decision is which of three: resolve per row and document the cost, offer it as an option that
defaults to off, or keep the asymmetry and say so in `docs/data-source.md` — which is what is written
there now, on `UpdateAllOptions` and on the page. It is filed rather than taken because it is a
question about what a bulk write *is*, and the round that found it was about something else.

> **Closed, and the paragraph above is wrong about the thing the decision rested on.** Resolving a
> relation is not a read per row. It is one read for the whole batch — `WHERE id IN (…)`, the same
> statement `findAll` resolves a hundred rows' relations in — so making the bulk calls agree with the
> singular ones costs one statement each, not one per row. That is the cost `create` with relations
> already pays, and this file's own table had it written down two sections below while the entry
> reasoned from the opposite. **A cost read off a call's shape rather than off the code is how an
> entry talks itself out of a fix that was never expensive.**
>
> The second thing it is wrong about is what the code did. **`deleteAll({ returnDeleted: true })` was
> already resolving `defaultRelations`**, and had been all along: it reads its rows on the way out
> because the delete hook runs per entity, and that read is a `findAll`, which applies them. So the
> asymmetry was two calls rather than three, and the page said something about a third that was not
> true of it.
>
> All three take the relations option the singular writes take now, and fall back to
> `defaultRelations` the same way. The bound is unchanged, because it was always the right one:
> `validateReturnIsBounded` counts before the write, so the read that follows cannot be asked for
> more than fits, and a caller who wants a count still pays for nothing.
>
> **The read goes through the driver rather than through `findAll`, and that is the part worth
> keeping.** A soft delete's `deleteAll` is an `updateAll` writing `deleted: true`, and `findAll` on
> that repository is overridden to hide exactly the rows it just wrote — so re-finding them would
> have answered "no rows" for every soft-deleted entity that reads a relation by default, change sets
> included. Re-finding is the wrong question anyway: the write already narrowed these rows by every
> scope a read narrows by, and what is left to do is resolve their relations, not decide again
> whether the caller may see them. A row the read then cannot find is an `InternalError` rather than
> a quietly shorter list.
>
> Rows come back in the order they were written, which is the order the caller passed, so the read's
> own order is discarded and the two lists are paired by id.

### M31. `upsert` cannot resolve a conflict against a key covering part of a table — MINOR, **FIXED**

*Filed by this work on 2026-09-18, on the way into [§M30](#m30-the-default-encryption-key-is-created-by-a-read-followed-by-a-write--minor-fixed),
which needs it.*

> **Closed, and the limitation was documented rather than unknown** — the code refused it by name and
> `docs/data-source.md` said so in a sentence of its own. What nobody had asked is whether it was a
> limitation of postgres or of the statement this builds.
>
> It is the statement. `ON CONFLICT ON CONSTRAINT <name>` takes a constraint, and a key covering part
> of a table is an index, which has no name a statement can use — but postgres *infers* an index from
> the columns plus the predicate it was created with, and that form has been there all along. The
> conflict target is now one of two shapes, and the partial one is written with the same
> `keyWhereToSql` the index's own predicate was written with, so the two strings cannot drift: a
> predicate that did not match would describe a different index, and no index means no conflict.
>
> **The other two stores had the same hole and it was not in their sql.** Both looked the conflicting
> row up by the identity alone, so a key over the open rows would find a cancelled one and update it
> instead of inserting beside it. That rule — which row an identity may land on — is shared now, for
> the reason `uniqueGroupFor` is: a store answering it differently makes the same call insert on one
> and update on the other.
>
> **Found while reading, and fixed with it: `upsert` built its returned entity by copying raw values
> onto it.** No column transformer, so a json document came back unparsed and a number without the
> precision its column keeps; and no `isVirtual` filter, so a relation whose key the entity does not
> declare had its property overwritten with a raw uuid. That is the same walk
> [§M12](#m12-write-amplification-on-change-set-and-soft-delete-entities--major-fixed) needed for
> `RETURNING *`, so both go through one now.
>
> **What it still cannot do** is resolve against a key whose filter is not equality against a
> literal, because that is what a schema predicate can hold at all - `keyWhereToSql` refuses the rest
> where the schema is built, long before an upsert names it.
>
> **The cases written here later found a second half of the same mistake, on the read side**, when
> the user ran them against a container: see
> [§M33](#m33-a-key-covering-part-of-a-table-is-read-as-if-it-listed-every-row--major-fixed). This
> entry got the write side right on all three stores and never asked what else that index is used
> for.

`uniqueConstraintFor` (`typeorm-base-data-source.model.ts`) threw for any identity whose unique group
carried a `where`, and `docs/data-source.md` recorded it as a rule rather than a gap.

### M32. Every unnamed encryption writes another strategy row, once the table holds one that is not the default — MAJOR, **FIXED**

*Filed by this work on 2026-09-19, found while restructuring
[§M30](#m30-the-default-encryption-key-is-created-by-a-read-followed-by-a-write--minor-fixed).*

> **Not a race. No concurrency involved at all** — one extra strategy row and one extra encryption
> key per `encrypt` call, forever, and nothing says so.
>
> `findDefaultStrategy` answered two questions at once: which strategy to encrypt with, and which row
> belongs to it. It answered the second by looking for `status === DEFAULT`, so a table holding
> strategy rows of which none is the default made it return "no row" — and the branch handling that
> creates one. The created row is `ACTIVE`, so the next call asks again, and gets the same answer.
>
> **One call is enough to get there**: the first encryption a deployment performs naming its strategy
> explicitly (`encrypt(value, { strategy: X })`) writes an `ACTIVE` row and no default. Everything
> unnamed after it writes its own.
>
> It is silent because nothing downstream breaks. Every value carries the id of the key it was
> encrypted with, so `decrypt` keeps working; what grows is two tables, and what is lost is any
> meaning to "the strategy in use".
>
> **Closed by asking the two questions separately.** The strategy is chosen by status, as it should
> be; the row is found by what identifies it - name and version - which is also what
> [§M30](#m30-the-default-encryption-key-is-created-by-a-read-followed-by-a-write--minor-fixed)'s
> unique declaration now enforces. Both fixes are the same restructuring, which is why they landed
> together.
>
> **Reachable in a test only from a cold service**, because it turns on what the very first
> encryption of a process does. The suite starts a server per case, and empties the two tables after
> each one - the in-memory store belongs to its data source class, so a second class is a second data
> source the application never declared.

`findDefaultStrategy` (`encryption.service.ts`) returned `{ strategy, entity }` with the entity
resolved by status, and three of `encrypt`'s branches created a row when it came back undefined.

### M30. The default encryption key is created by a read followed by a write — MINOR, **FIXED**

*Filed by this work on 2026-09-18, while auditing what the repository does per call.*

`EncryptionService.findOrCreateDefaultKeyForStrategy` looks for a key with `DEFAULT` status, takes the
first key if there is none, and creates one if there are none at all. That is a read followed by a
write with nothing held across it, which is the exact shape
[§M20](#m20-there-is-no-conditional-update-anywhere-in-the-repository-layer--major) and `upsert` exist
to close: two callers encrypting at once, on a strategy whose key does not exist yet, both find
nothing and both create one.

**What it costs today is not a duplicate key, it is a serialized loop.** `Repository.updateAllBound`
runs its per-row `beforeSave` **sequentially**, and its comment says why: *"the hook may reach the
encryption service, which creates the default key on first use and must not do so twice"*. That is a
caller working around a service's missing guarantee, and it is on the path that already warns about
being expensive — a bulk update of an encrypted, row-bound property, one write per row by necessity,
with the hook work serialized on top for a race that happens once in the lifetime of a strategy.

The fix belongs to the service rather than to its callers: an in-flight promise per strategy that
everyone awaits, so the key is created once however many callers arrive together, plus the atomic
write the shape asks for. Then `updateAllBound` becomes `PromiseUtilities.allChunked`, and the next
subsystem to touch encryption cannot forget the rule, because there is no rule left to remember.

> **Closed, and two things about the entry above were wrong.** The first: it is not one read-then-write
> but four. `encrypt` created the strategy row in three separate branches and the key in a fourth, and
> the flag meant to guard the first — `hasCreatedInitialDefaultStrategy` — was set *after* its own
> awaits, so two callers both read it as false. That flag is gone; there is one place a strategy's
> row and first key come into being now, and everything arriving while it runs waits on that one
> promise rather than starting its own.
>
> The second: `upsert` could not express the key's identity at all, because "the default key of this
> strategy" is a key over part of the table. That became
> [§M31](#m31-upsert-cannot-resolve-a-conflict-against-a-key-covering-part-of-a-table--minor-fixed),
> closed first and on its own, so this could be built on a primitive that exists rather than one
> described in a plan.
>
> **The in-flight promise covers a process and the unique declarations cover a deployment**, which is
> the split worth keeping: the promise is what makes eight simultaneous encryptions do one write, and
> the constraint is what makes two *instances* doing that write land on one row. Neither alone is
> enough, and the second is what let `updateAllBound` stop serializing its hook loop — the thing this
> finding was filed for.
>
> **The conflict path writes the identity back to itself on the strategy, and the status on the key.**
> Both are deliberate no-ops: a conflict here means somebody else created the row, and what this
> needs from the statement is that row rather than an edit to it. On the key it matters more than
> style — writing the generated value over an existing default key's value is writing over the only
> thing that can read back everything already encrypted with it.
>
> **The strategy's constraint is an upgrade note rather than a migration**: a deployment that already
> holds duplicate strategy rows fails to apply it, which is the honest outcome, since those
> duplicates are the defect and choosing which of them is the real one is not the framework's call.
> [§M32](#m32-every-unnamed-encryption-writes-another-strategy-row-once-the-table-holds-one-that-is-not-the-default--major-fixed)
> is how a deployment came to have them, and was found while restructuring this.

### M33. A key covering part of a table is read as if it listed every row — MAJOR, **FIXED**

*Filed by this work on 2026-09-19, found by the user running
[§M31](#m31-upsert-cannot-resolve-a-conflict-against-a-key-covering-part-of-a-table--minor-fixed)'s
shared cases against a container. Valkey only.*

> **A filter on a property whose key covers part of the table answered about that part alone.** Two
> rows hold the same room, one cancelled and one open; `count({ where: { room } })` said one.
>
> The valkey driver keeps an index per unique declaration, value to id, and reads a filter through it
> when the filter names everything the declaration does — a shortcut that turns a scan into one
> lookup. **A partial key indexes partial rows**, on purpose: §M31 is what made the write side leave
> the rows a key does not cover out of its index, because that is the whole of what a partial unique
> means. Nothing told the read side, so the shortcut answered "the covered row holding this value"
> to a question that asked for every row holding it, and the rows it dropped were exactly the ones
> the key was declared to leave alone.
>
> Only a key over every row shortcuts a filter now. The fallback was always a full read, so the fix
> costs a scan on the filters that used to take the shortcut and nothing else.
>
> **The shape to take from it**: that index already had a "a miss is not an answer" rule written on
> it, because a row predating the declaration carries no entry and concluding "no such row" would
> hide it. A partial key makes a *hit* not an answer either, which is the same sentence one step
> further on and nobody wrote it. **An index narrowed by a predicate stops being usable as a lookup
> for anything that does not name that predicate.**
>
> Found because the invariant was written as shared cases rather than per store: postgres answers it
> from real sql and the in-memory store scans, so both were green and only valkey was not. It has a
> case of its own now — a read, rather than a count checked on the way past an upsert.

`uniqueKeyForFilter` (`val-key.repository-driver.ts`) walked every group in `uniqueGroups`, partial
ones included, and `idsFromUniqueFilter` returned its members as the candidate ids.

### M34. A call reaching more rows than a statement binds values for fails on postgres alone — MAJOR, **FIXED**

*Filed by this work on 2026-09-28, while sweeping defects found on the way. Postgres only; its fix
turned up two more.*

> **Postgres binds at most 65535 values per statement**, and four places built a statement whose
> values grew with the rows: `upsertAll` (every value of every row, two per changed column per row, and
> on a scoped entity every row's identity again), `createAll` (typeorm's `save` was never given its
> `chunk` option), `deleteAll` and the locked `updateAll` path (`whereInIds`, one value per row), and
> every `oneOf`/`notOneOf` (one value per element — which the read-back of a bulk write is). Valkey
> and the in-memory store answered all of it. So `deleteAll` of a log table was a cleanup job that
> worked until the table was worth cleaning up.
>
> **A list is one value now**: `= ANY($1)` with the list as an array, so a statement binds one value
> however long the list is, and stays one statement and one snapshot. `whereInIds` goes through the
> same converter. **A multi-row write is split** into statements under the limit, in one transaction
> so it still lands whole: `save`'s `chunk` for `createAll`, and statements halved until they fit for
> `upsertAll`, since how many values a row binds is the dialect's to say and differs per row. The limit
> is `maxBoundValuesPerStatement` on the data source's options, defaulted per dialect. **The scoped
> upsert's "may this row change" check no longer repeats every identity**: it asks about the one row
> the conflict landed on, correlated by id, against the scope alone — row-independent, and one primary
> key probe per conflicting row rather than a select over every identity.
>
> **Found by the fix: the stores disagreed about a missing value.** Postgres's `IN (NULL)` never
> matched, so `oneOf: ['a', null]` missed rows the evaluator found; and `NOT IN` never kept a row
> without a value, where the evaluator's `notOneOf` did — while its `not` did not. The user decided
> **a missing value is a value**: `not: 'a'` and `notOneOf: ['a']` find it on every store, naming
> `null` leaves it out. The scope utilities already folded `not: x` into `notOneOf: [x]`, which was
> only sound once the two agreed.
>
> **Found by the test: the evaluator's `oneOf` was quadratic.** It asked every row about every listed
> value, so valkey reading back 70000 written rows by id made 4.9 billion comparisons. A list of
> values compared by identity is read into a set once per list. The in-memory store's own quadratic
> scans (the unique check and the upsert lookup) are its stated design for test-sized data, so the
> 70000-row cases run on postgres and valkey only.

> **Valkey had its own form of it, found by the first container run**: `save` and `remove` started
> every row's round trips at once, and the client refuses past the requests it holds in flight
> (`Reached maximum inflight requests` on a 70000-row `createAll`). They are chunked now. Its
> `upsertAll` was also quadratic twice over, once the rows actually conflicted: every identity was
> read as one filter of 70000 branches, judged against every row, and each row was then paired by
> judging every row found. The identities are read through the key's index once and paired by their
> values, each row judged by its own filter alone. The two upsert cases had passed on valkey only
> because the failed `createAll` left them nothing to upsert, so they now check the batch's length.
>
> **The second run found the deeper one: a valkey transaction held one lease per key it wrote.** Each
> was its own `LeaseService.hold` with its own renewal timer and its own release script, so a 70000-row
> write committed and then sent 70000 releases at once — and one running longer than a renewal
> interval would have sent 70000 renewals the same way. A transaction's grants are one lease now: every
> key is taken under one token, and renewed and released by scripts that loop over up to 1000 keys a
> call. The per-key `SET NX` stays, since a claim may have to queue for another transaction.
>
> **The third run was green, and what was left was one round trip per key** (at the user's prompt to go
> store-native, as the postgres fixes had). Claims are now one script call per 1000 keys: it takes the
> keys in sorted order and stops at the first one somebody else holds, so a claimer holds a sorted
> prefix and waits on the next key exactly as it did taking them one call each — the ordering the
> upsert's deadlock freedom rests on is kept, and every claim sorts, where only the upsert and
> `updateAll` did before. A save claims its rows and a delete its rows once up front; a save's unique
> indexes are claimed together and read in one pipeline, then checked in order in memory against the
> transaction's overlay, so a batch naming one value twice is still caught. Rows and sets are read by
> pipelines of 1000 (`readRows`/`readSets`) where each was one request.
>
> **Found on the way: postgres deadlocked where valkey waited.** A batch upsert locks each row it
> conflicts with as the statement reaches it, in the caller's order, so two `upsertAll`s naming the
> same rows in opposite orders met half way and postgres aborted one. Valkey sorted its claims and
> both landed. The statement's rows are now sorted by identity (the rows still come back in the
> caller's order, paired by identity). `upsert-all.cases.ts` runs the two opposite-order batches on
> every store.

`large-batches.postgres-valkey.test.ts` and `null-values.cases.ts` hold both.

### M35. A uuid written in upper case is a different id on two stores — MINOR, **FIXED**

*Filed by this work, from the sweep of defects found on the way; moved here from 11 on 2026-10-01.*

A uuid written in upper case was stored as written on valkey and in memory, and compared by value on
postgres, so one filter answered two ways about the same rows.

> **Fixed.** Every write and every filter lowercases a uuid, on every store. A string primary key that
> does not declare `format: 'uuid'` is refused at declaration, so there is no id left whose case the
> framework does not know how to treat.

### M36. `unique` cannot be declared on an encrypted property — MINOR, **open (deferred)**

*Filed by this work on 2026-10-01, while closing [06 §CI3](./06-tooling-ci-and-testing.md).*

A unique declaration compares stored values, and one value encrypted under two keys is two stored
values. So even a deterministic strategy lets duplicates in across every key rotation, and the
rotation job would then fail on them. `unique` on an encrypted property is refused at declaration for
now, and on a hashed one at startup when its resolved strategy is not deterministic.

What would allow it is a **blind index**: a hidden column per such property holding an HMAC of the
value under an index key of its own, which does not rotate with the data keys; the unique on that
column; and filters on the property rewritten to it on every store. No extra round trips, an HMAC
per write and per filter. The open part is rotating the index key, which means rewriting the column.

### M38. A unique only a migration names is enforced on postgres only — **FIXED**

*Filed by this work on 2026-10-03, while closing [§M15](#m15-valkey-data-source-filters-in-node-one-round-trip-per-row--fixed). Fixed the same day.*

> **Fixed by taking indexes and uniques out of migrations altogether.** Unlike a property change,
> keeping an index or a unique needs nothing but the entity: there is nothing to know about what
> came before. So every store now brings them in line with what the entities declare at every start,
> inside the schema lock and after the migrations, and `addUniquesOfEntity`, `removeUniquesOfEntity`,
> `addIndexesOfEntity` and `removeIndexesOfEntity` are gone. A migration can no longer name a unique
> the entity does not declare, which is what this finding was. Decided with the user:
>
> - **Uniques too.** A start that finds stored rows breaking a declared unique refuses, naming the
>   values, and a migration removes the duplicates. Valkey takes the broken unique off its list
>   before throwing, so writes made while it is down do not half-enforce it.
> - **Postgres builds `CONCURRENTLY`** on a connection of its own, outside a transaction, and turns a
>   full unique into a constraint under a short lock timeout. Invalid leftovers of a failed build are
>   dropped first. Only under `schemaManagement: 'migrations'`; `'synchronize'` leaves it to TypeORM.
>   Owned are the names zibri gives (`uq_`, `idx_`, `trgm_` per table) and TypeORM's `UQ_`/`IDX_`
>   defaults, which 2.x left behind; junction tables and `REL_` are left alone.
> - **Valkey writes follow a stored list** of the uniques and indexes (`{prefix}:{table}:keys`),
>   read in the pipeline that already reads the rows, so no round trip is added. Writes apply through
>   a script that refuses when the list changed since; a write the driver owns retries, one inside a
>   caller's transaction fails with `KeyDeclarationsChangedError`. An index is read only once its
>   identity is in the built set.
> - **An older release refuses to start** once a newer one changed the keys. Every start that changes
>   them records its version under the migration name `zibri:indexes-and-uniques`, which the existing
>   "database is ahead" check reads. Reverting migrations to an older version removes the record.
>
> Held by `key-reconciliation.cases.ts` on every store (in-memory here; postgres and valkey in
> `key-reconciliation.postgres.test.ts` and `key-reconciliation.valkey.test.ts`): a unique and an index a
> release declares over rows stored before it, a unique the next release drops, a partial unique whose
> rows change, a start refused over duplicates, and an older release refused. The case this finding
> was filed under went with the helpers it tested.
>
> **Found on the way: two partial uniques over the same columns shared their valkey keys.** A key
> named only the columns, so `email` unique among active rows and `email` unique among archived ones
> refused each other's values. A partial unique's key now carries a hash of its filter, and so does
> its postgres name. Held by the "rows it covers change" case.
>
> **Found on the way: valkey and in-memory counted null as a value under a unique.** Two rows without
> a code collided on `code = null`, where SQL lets any number of them through. Both now read a null
> as no value. Held by `nullable-unique.cases.ts`, red before the fix on in-memory; valkey and
> postgres in `nullable-unique.postgres-valkey.test.ts`, waiting on a container run.
>
> **Found on the way: `@Entity` refused an optional property in `uniques`, `indexes`, `defaultOrder`
> and `defaultRelations`.** The names were checked by requiring the class to be a `Record` of them,
> which makes each one required. They are now checked against `keyof` the instance, which keeps a
> misspelled name refused, and the message names it. Held by type tests in `entity.decorator.test.ts`.

`addUniquesOfEntity` with a group the entity does not declare creates a constraint on postgres, which
the database enforces from then on. Valkey indexes the stored rows under it, and the in-memory store
checks them, but both enforce what the *entity* declares on every write afterwards. So a second row
with the same value is refused on postgres and accepted on the other two. Held, red, by "keeps a
unique property unique under the values a migration converted it to" in `migration-helpers.cases.ts`
(red on in-memory and valkey; green on postgres once the dropped unique noted under M15 was fixed). Waiting on a decision: the stores remember what a
migration added, or a migration may only add what the entity declares.

### M37. A date property stores an instant, whatever the value means — **open (deferred)**

*Filed by this work; decided against fixing for now on 2026-08-20, moved here from 11 on 2026-10-01.*

Every temporal value is a JS `Date`, which is an instant and carries no zone, so `getDate()` and its
siblings silently apply the host machine's zone. Three kinds of value share the one type:

- an **instant** (`createdAt`, a log timestamp), where the zone is presentational;
- an **instant plus a zone** (a cron job's next run, a scheduled event), where the zone is intrinsic —
  `CronJobEntity` already stores it by hand;
- a **calendar date** (an invoice date, a birthday), which has no instant at all, so nothing should be
  able to shift it — `YYYY-MM-DD` is its honest storage.

Rendering takes the locale and zone as arguments in the meantime. A real fix touches `@Property.date`,
the column mapping, validation, OpenAPI, http and websocket serialization, sorting and every existing
date field, which is why it was deferred. `Temporal` (`Instant`, `ZonedDateTime`, `PlainDate`) is the
standard shape for it. Two machine-zone reads are known and survive on purpose: the invoice number's
year counter and the logger's timestamp.

### M39. Nothing routes a read to a replica, and one postgres option already does, unexamined — MINOR, **open**

*Split out of the MINOR list's multi-tenancy entry on 2026-10-13.*

No data source can send reads to a replica. A replica lags behind its primary, so which reads may
go there is a consistency decision, not a configuration detail: a read the same request just wrote,
the pre-read a scoped update is judged by, the row a lease or an `upsert` re-reads.

**Postgres already does it, without zibri knowing.** `PostgresOptions` is TypeORM's connection
options minus three keys, so `replication: { master, slaves }` is accepted as it is. TypeORM then
runs every select it builds without a query runner on a replica
(`SelectQueryBuilder` asks `defaultReplicationModeForReads()`, which answers `"slave"`). Which of the
driver's reads that reaches has not been checked, and nothing holds it in a test. Valkey's
`readFrom` is passed through the same way, and has nothing to act on while `addresses` is built from
one `host`.

The decision it waits on, offered on 2026-10-13 and not yet taken:

- reads outside a transaction go to a replica until the request or job has written, then to the
  primary; transactions, leases and `upsert` always on the primary;
- every read on the primary unless a call asks for a replica;
- the replica settings name one of the two, as a required option.

### M40. A primary key is one string id — MINOR, **open**

*Split out of the MINOR list's multi-tenancy entry on 2026-10-13.*

`BaseEntity` declares `id: string`, every repository method that names a row takes it
(`findById`, `updateById`, `deleteById`, `upsert`'s returned row), and an entity declaring more than
one primary property is refused while its schema is built (`typeorm-base-data-source.model.ts`,
"more than 1 primary key specified"). There are no composite keys and no integer or bigint ids. The
id runs through the repository, both store drivers, relations, change sets, soft deletes and
backups: around 700 references in the repository and the two drivers alone.

A unique group over several properties already gives an entity a natural key that `upsert` and
`findOne` work through, so what composite keys add beyond that is a table without a surrogate id:
mostly a schema the application maps under `schemaManagement: 'external'` and cannot add a column to.

The decision it waits on, offered on 2026-10-13 and not yet taken: full composite and non-string keys
everywhere; composite keys only for entities under `'external'`, read and written by key without
relations; or declining it in favour of unique groups.

### M41. A page can be as large as its caller asks, and a negative one reads differently on each store — MAJOR, **open**

*Filed on the re-check of 2026-10-15.*

`findAllPaginated(page, limit)` (`src/data-source/repository/repository.ts:1389-1411`) passes
`skip: (page - 1) * limit, take: limit` through as they are, and `findAllAfter` (`:1447-1488`) its
`limit`. [M4](#m4-no-default-limit-on-findall--major-fixed)'s cap only guards a `findAll` that names
no limit, so a page of ten million rows is a read like any other. `CrudController.findAll`
(`src/routing/models/crud-controller.model.ts:81-89`) takes both numbers from the query string with
nothing but `type: 'number'`, which makes `GET /things?page=1&limit=100000000` the whole table in
the heap from one request, on every route the controller builds.

Values that are not a page are not refused either. On postgres `page=0` or a negative `limit` is a
negative `OFFSET` or `LIMIT`, which the database refuses, so the request is a 500. On valkey the
driver slices (`src/data-source/driver/val-key.repository-driver.ts:610-611`), and
`slice(-10, …)` counts from the end, so the same call hands back rows. A fraction is rounded by one
store and sliced by the other. Two stores answering one call differently is the class of bug the
shared `.cases.ts` files exist for, and none of them pages with a value below 1.

### M42. A change set names the id of its row and not which entity the row is of — MINOR, **open**

*Filed on the re-check of 2026-10-15.*

Every `ChangeSetRepository` of a data source writes into the one `ChangeSet` table, and a change set
records `changeSetEntityId` (`src/change-sets/models/change-set.model.ts:48-49`) and nothing that says
which entity that id belongs to. Ids are unique per table, not across tables, and `allowId` lets an
application choose them - a profile or settings row that takes its user's id is the usual shape.

For two such rows, `rollbackToTimestamp` (`src/change-sets/change-set-repository.ts:341-377`) reads
every change set of that id, the other entity's included, and applies their keys to this row;
`resetSingleChangeSet` and `rollbackToChangeSetById` (`:224`, `:321`) accept the other entity's change
set because the only check is the id. The history of one row is the history of both, which an audit
trail asked "what happened to invoice X" cannot tell apart either.

### M43. Saving an owner with its children on valkey is quadratic in the children of one owner — MINOR, **FIXED**

*Filed 2026-10-15, while closing [02 §M21](./02-http-runtime-core.md), which is the same pattern.*

> **Fixed (2026-10-15)**, by [M44](#m44-the-rows-of-a-relation-were-written-past-their-own-repository--major-fixed).
> The test hung rather than failing, on postgres first: postgres was affected as well, worse. Typeorm's
> cascade looks every cascaded row up in a list of all the others (`CascadesSubjectBuilder.findByPersistEntityLike`
> compares id maps per pair, `OneToManySubjectBuilder` scans per row), synchronously - so jest's timeout
> could not fire - and would then have inserted all 70,000 rows in one statement, since `chunk` splits only
> the rows given at the top. The valkey loop, measured alone, blocked for 23 s at 70,000. Neither path
> exists any more: the repository writes the rows through the repository of their entity, which is a
> `createAll` cut into statements like any other. Green in memory; the container run of
> `large-batches.postgres-valkey.test.ts` is on the verification queue.

`saveToManyRelationsOf` (`src/data-source/driver/val-key.repository-driver.ts`, the loop after
`targetDriver.save`) hands every saved child back to its owner with
`owned.set(key, [...owned.get(key) ?? [], child])`, copying the owner's list once per child. A save
of one owner with n children through a one to many or has one relation - cascading inserts is their
default - copies n²/2 elements: about 2.5 billion for the 70,000 rows `large-batches.cases.ts` writes.
Postgres saves through typeorm and is not affected.

Not shown red yet, because it needs the valkey container. Held by *creates an owner together with more
rows than one statement binds values for, about as fast as the rows alone* in `large-batches.cases.ts`,
run by `large-batches.postgres-valkey.test.ts` on both stores: the nested save of 70,000 rows has to take
at most three times what `createAll` of as many rows took in the case before it. If valkey is red there
and postgres green, the fix is the push `groupByName` got in 02 §M21. Reachable through a request only
as far as a body holds children - a few thousand at the default `100kb` - which is why it is minor.

### M44. The rows of a relation were written past their own repository — MAJOR, **FIXED**

*Filed and fixed 2026-10-15, while fixing [M43](#m43-saving-an-owner-with-its-children-on-valkey-is-quadratic-in-the-children-of-one-owner--minor-fixed).*

A `oneToMany` or `hasOne` value given to a write went to the driver with the owner, and each store
wrote the rows itself: typeorm through its cascade, valkey and the in memory store through a save of
the target's driver. Below the repository, so the rows skipped everything the repository of their own
entity does: their scope, their hooks, their change sets and their soft delete. A row given by its id
was linked whatever the caller could see of it, so a caller could pull a row out of another owner into
theirs by naming it. The stores also disagreed on the rest:

- **Rows left out of the value.** Postgres unlinked them - typeorm's default, which fails on a required
  foreign key - and valkey left them where they were.
- **Deleting the owner.** Postgres deleted the rows of a relation with the `remove` flag through
  `ON DELETE CASCADE`, past any soft delete; valkey and the in memory store deleted none of them, and
  left them pointing at nothing. `cascade-delete.test.ts` ran on postgres only.
- **Soft deleting the owner** marked nothing else deleted, so a soft deleted user's rows went on being
  counted.

Decided with the user: the repository takes the value off before any hook runs, writes the row, and
then writes each relation through the repository of its entity, in one transaction - `createAll` for
rows without an id, `updateById` for rows with one (which finds them, so the scope applies and a row
the caller may not see refuses the write), `deleteAll` or `updateAll` for the rows left out. The rule for
those follows typeorm 1.0: deleted when the foreign key is required, unlinked when it is optional.
`removeRows` deletes the rows of relations with `remove` first, the same way and unscoped; a soft
deleting entity's are hard deleted then. Soft deleting a row soft deletes them, noting the row in the
new `SoftDeleteEntity.deletedWith`, and restoring it restores exactly those - not rows deleted on their
own before. A soft deleting entity whose relation removes rows of one that is not refuses the start;
`deletedWith` is a key of its own in the type, so an entity implementing `SoftDeleteEntity` rather
than extending it is told by the compiler. `updateAll` gives the value to every row it matches, each
with its own copy of the rows without an id, and refuses a row given by its id once it matches more
than one - postgres used to link such a row to whichever owner it saved last. With `allowId`, a row
given with an id no row has yet is created with it, as the drivers' saves did, which the backup sync
relies on. The drivers write only their own rows now; what to write is
`OwnedRelationUtilities`, which skips a relation whose inverse is a plain column, as change sets have.

Held by `owned-relations.cases.ts` (19 cases, in memory here and on postgres and valkey in
`owned-relations.postgres-valkey.test.ts`), eight red before the change and mutation checked after it, and
by the start refusal in `data-source.service.test.ts`. A hard delete still writes no change set
anywhere, which was so before.

### M45. Deleting a row that records change sets keeps its change sets — MINOR, **open**

*Filed 2026-10-15, while fixing [M44](#m44-the-rows-of-a-relation-were-written-past-their-own-repository--major-fixed).*

`ChangeSetEntity.changeSets` points at `ChangeSet.changeSetEntityId`, a plain column rather than a
relation, so no store has a foreign key for it and `OwnedRelationUtilities` leaves it out. Hard deleting
such a row leaves its change sets behind, describing a row that is gone. The user: they should go with
it. Held by *deletes its change sets along with it* in `relation-deletes.evaluation.test.ts`, red.

### M46. Deleting a row that rows point at, through no relation that removes them, leaves them dangling off postgres — MINOR, **open**

*Filed 2026-10-15, while fixing [M44](#m44-the-rows-of-a-relation-were-written-past-their-own-repository--major-fixed).*

A relation without `remove` gets no `ON DELETE` on postgres, so its foreign key refuses deleting a row
other rows still point at. Valkey and the in memory store have no foreign keys and delete it, leaving
those rows pointing at nothing. Held by *refuses the delete, as a foreign key does* in
`relation-deletes.evaluation.test.ts`, red in memory.

---

## What each repository call costs

*Written by this work on 2026-09-18, at the user's request, while closing
[§M12](#m12-write-amplification-on-change-set-and-soft-delete-entities--major-fixed).*

> **Measured since (2026-10-01)**: `docs/costs.md` holds the counts per data source, `BEGIN` and
> `COMMIT` included, and `repository-costs.cases.ts` fails when they change. This table kept the
> reasoning and is not updated. Writing the counted suite found the `updateAll` row below untrue - the
> repository wrapped the one statement in a transaction of its own - which is fixed.

For the plain `Repository` on postgres, on an entity with no relations to resolve, no change sets and
no soft delete. **Read off the code, not measured** — the only numbers in this file that were measured
against a container are §M12's soft delete and ordinary update, and they are marked as such.

"Hook passes" counts entities put through `beforeSave` or `beforeReturn`, because that is where
encryption, hashing and exclusion happen: a decrypt is a key operation per encrypted property, and
one run on an object nobody receives is pure waste.

| Call | Statements | Hook passes | Why not fewer |
|---|---|---|---|
| `findById` / `findOne` | 1 | 1 return | The read itself |
| `findAll` | 1 | 1 return per row | One statement whatever the row count; the bound is a `take` of one past the cap rather than a second query |
| `findAllPaginated` | 2, in one transaction | 1 return per row | The page and its total are one `findAndCount`; `REPEATABLE READ` is what makes the pair describe one moment rather than two |
| `count` / `exists` | 1 | 0 | `exists` reads one row with no relations and discards it, so nothing is decrypted for a yes or a no |
| `create` | 2 | 1 save, 1 return | The second is typeorm's: `save` is an upsert, so it reads the row to decide insert from update, and the framework has already assigned the id. An insert builder would make it 1 — **not done, and the same statement §M12 removed from the update path** |
| `create` with relations | 3 | 1 save, 1 return | The read that resolves them, which a write cannot answer. The written row skips the return hook, because the row that replaces it runs it |
| `createAll` | 2 | 1 save + 1 return per row | As `create`, once for the batch rather than once per row, and once per chunk past 65535 bound values — §M34 |
| `createAll` with relations | 3 | 1 save + 1 return per row | The read that resolves them, one for the whole batch — §M29. The written rows skip the return hook, because the rows that replace them run it |
| `updateById` | 2 | 1 save, 1 return | The guard that tells a missing row from a write that changed nothing, and `UPDATE … RETURNING *`. The guard is an `exists`, so it joins nothing and decrypts nothing |
| `updateById` with a condition | 2 | 1 save, 1 return | Same: the condition travels into the write's `WHERE` rather than costing a read of its own |
| `updateById` with relations | 3 | 1 save, 1 return | The read that resolves them. The written row is discarded before the return hook rather than after |
| `updateById` that matched nothing | 3 | 1 save | The third is `validateUpdateWasWritten` reading the row again *without* the condition, which is what tells a conflict from a not found. Only on the failing path |
| `updateAll` | 1 | 1 save | One statement however many rows match |
| `updateAll({ returnUpdated: true })` | 2 | 1 save + 1 return per row | The extra is `validateReturnIsBounded` counting before the write, so a caller asking for more than fits is refused while nothing has happened |
| `updateAll` of a row-bound encrypted property | 1 read + 1 write per row | 1 save + 1 return per row | §M3: a value bound to its row cannot be written to many rows in one statement. The read asks for ids alone — no relations, nothing decrypted — because the rows are about to be overwritten |
| `upsert` | 1 | 1 save, 1 return | One statement is the entire point; see §M20 |
| `upsert` on a scoped entity | 1 | 1 save, 1 return | Which rows it may change travels into the statement's `DO UPDATE … WHERE` as a select pinned by the conflicting row's id, so it is one primary key probe inside the one statement. A refused conflict costs a second, running the refused row once more for a row committed after the first began - on the failing path only |
| `upsert` incrementing what the scope reads | 3 | 1 save, 1 return | `BEGIN`, the statement, `COMMIT`: an increment's result is not known before it lands, so it is judged on the written row and rolled back when it left the caller's reach. None extra inside a caller's own transaction. Only a scope keyed on a counter pays it - a quota. A `set` on what the scope reads is judged before the write and costs nothing |
| `upsertAll` | 1 | 1 save + 1 return per row | One statement for the whole batch: each row's change is a `CASE` on the id that row was proposed with, which `EXCLUDED` carries. A caller looping `upsert` paid one per row - the event service's subscriber refresh did, on every dispatch poll. Past 65535 bound values it is several, in one transaction — §M34 |
| `upsertAll` with relations | 2 | 1 save + 1 return per row | The read that resolves them, one for the whole batch, as `createAll` |
| `upsertAll` on a scoped entity | 3 | 1 save + 1 return per row | `BEGIN`, the statement, `COMMIT`: a refused row can come after rows the statement already wrote, so a restricted batch of several is held together and rolled back whole. None extra inside a caller's own transaction; a batch of one costs what `upsert` does |
| `deleteById` | 3 | 1 return, 1 save, 1 return | Read, delete, and typeorm's own read inside `remove`. The delete hook runs per entity, so the row has to be in hand |
| `deleteAll` | 2 | 1 return + 1 save per row | The rows are read because the delete hook runs per entity — §M3's residue. Nothing is put through the return hook unless the caller asked for the rows |
| `deleteAll({ returnDeleted: true })` | 3 | 1 return + 1 save + 1 return per row | The extra statement is the bound check; the extra hook pass is the rows being handed over |

**Three of these were reduced while writing the table**, all of them work whose result was thrown
away: `create` and `upsert` ran the return hook on the written row and then read the row again,
`updateById`'s guard read a whole row with its relations joined and its values decrypted to ask
whether one exists, and `deleteAll` decrypted every removed row for a caller receiving a count. The
lesson is narrow and repeatable — **a hook pass on an object that is about to be replaced is
invisible in every test, because the replacement is correct.**

**What is left is named rather than fixed.** `create`'s pre-`SELECT` is the same statement §M12
removed from the update path and would go the same way, through typeorm's insert builder; the
`deleteById` read inside `remove` is typeorm's again. Neither is a rewiring, and neither was this
round.

---

## MINOR / DX

- ~~`src/data-source/repository.ts:101-104, 119-129, 222` mutate the caller's input object
  (`delete data.id`, `data.id = id`).~~ — **fixed.** Every write path that takes caller data now
  works on a shallow copy: `create`, `createAll`, `upsert`, `saveUpdate`, `updateAll`.
  `updateAllBound` already did, and its comment is where the pattern came from. Shallow covers every
  column; a nested object is still shared, which is a narrower thing and stays open.

  **What made it more than untidy**: the caller's object gained the generated id, everything
  `beforeSave` wrote, and whatever the driver handed back — so a payload a caller held on to and
  reused was a different object after each call.

  **And it changes what a change set records, which is the part worth reading.**
  `ChangeSetRepository.updateById` and `.updateAll` pass the caller's `data` to the change set
  *after* the write, and were reading the mutated version — so `newValue` held the **encrypted**
  value for an encrypted column while `previousValue`, read back through a decrypting `findById`,
  held plaintext. The two sides of one change disagreed about which form they were in.

  Threading the written version through was drafted and rejected: it would have preserved that
  inconsistency. `resetSingleChangeSet` writes stored values back through a path that encrypts
  again, so a change set has to hold plaintext to be resettable at all, and `preserveCreateChangeSet`
  writes `newValue` — the one that was encrypted.

  **Which resolved into the right rule: a secret is not something a change set may record.** A
  property declaring `encryption` or `hash` now defaults to `excludeFromChangeSets: true` — a
  default, not a rule, because whether a given encrypted column is a secret or merely encrypted at
  rest is the declaration's call. That removes the ciphertext, the plaintext and the double-encrypt
  on reset in one go, rather than picking which of the two forms to store. Held by
  `change-set-exclusion.test.ts`.

  **And the asymmetry underneath it is closed too.** A create recorded what *landed*
  (`ChangeSetRepository.create` passes the saved entity); an update recorded what was *asked for*.
  So any value the framework generated during an update was missing from its change set. Both record
  what landed now: `saveUpdate` and a new `saveUpdateAll` hand back a `WrittenUpdate` — the row and
  the change that produced it — and `updateById`, `updateAll` and both reset paths build their
  change sets from that.

  **`written` is the object the save hooks write into**, so a value produced by a property's
  `default` is in it by construction, with no further plumbing. The two alternatives were weighed and
  are worse: the caller's change misses everything generated, and re-reading the row afterwards
  carries every column nobody touched plus anything another writer changed in between, which the
  change set would then claim as its own.

  `WrittenUpdate` is one pair per row rather than two parallel lists, because a bound encrypted value
  is encrypted for the row it lands in — the rows of one bulk update genuinely do not share a change
  — and two lists that must stay in step are two lists that can fall out of it.

  **What this still waits on**: `setDefaultValues` runs for `CREATE` only, so nothing is generated
  during an update yet and the new path has nothing to carry. That is a deliberate gap rather than an
  oversight — see the note below.
- ~~`repository.ts:218-227` warns *"Found an id on the update data, it will be ignored"* and then
  overwrites it — the message is false.~~ — **closed, re-checked 2026-10-01.** Both update paths
  work on a copy now (see the first entry), and the id given in the data is the one thing the copy
  does not use: `saveUpdate` writes the id of the call over it and `updateAll` deletes it. So
  "ignored" describes what happens.
- ~~`change-set-repository.ts:360-366` mutates the entity and the payload
  (`restoreExcludeProperties` / `removeExcludeProperties`) to compute a diff; these are async
  mutations on objects the caller still holds.~~ — **closed, re-checked 2026-10-01.** The mutation is
  still there and the caller's objects no longer reach it: every call site hands `createChangeSet`
  a row the repository read or wrote itself, and the `written` copy of the first entry rather than the
  caller's data. A created row is mutated before it is returned, so the caller never holds it while
  that happens.
- ~~`soft-delete-repository.ts:133-148` drives its happy path through a caught `NotFoundError`.~~ —
  **closed 2026-10-02.** Worse than a style problem: the catch sat outside the transaction, so on an
  entity whose update reads relations back it ran after the write had been rolled back and answered
  with the row as it was before; and it fired on the guard's own NotFoundError too, so marking an
  already deleted row deleted reported success for a write that never ran. `updateByIdWithoutChangeSet`
  had no catch at all and threw after writing. `saveUpdate` now reads past the guard after every
  write - the guard ran before it, on the read that decided the row is there - and the catch is gone.
  Found on the way: a hard `deleteById` read through the guard and could not remove a row that was
  already soft deleted, while a hard `deleteAll` always could; it reaches every row now.
- ~~`soft-delete-repository.ts:189-197` silently discards a caller-supplied `deleted` filter.~~ —
  **closed 2026-10-02, by the user's choice of a three-way option.** The soft delete filter types
  already left `deleted` out, but a filter typed as the entity's own `Where` carries it past them,
  and the guard overwrote it - so a trash view could not be asked for at all. `withDeleted?: boolean`
  is `deleted?: 'exclude' | 'include' | 'only'` (`SoftDeletedRows`) on every soft delete option type,
  and a filter branch naming `deleted` with a value the option does not give it is refused with an
  `InternalError` naming the option. A value that agrees passes rather than being refused, because
  the repository hands itself converted filters: a bulk update converts once, and the reads underneath
  it come back through the same overrides. Weighed and declined: letting the filter win (keeps two
  ways to say one thing) and refusing at runtime only (no trash view). Held by
  `soft-delete-repository.test.ts` and `soft-delete-relations.test.ts` (both moved to the in-memory
  data source, red first for the bugs) and a MINOR block in `data-layer.evaluation.test.ts`.
- ~~`postgres-typeorm-data-source.model.ts:198-199` casts `targetProps[metadata.inverseSide]` and
  immediately dereferences `.cascade` — a typo'd `inverseSide` gives
  `TypeError: Cannot read properties of undefined` at boot.~~ — **closed 2026-10-02.** `inverseSide`
  is typed by the target's keys, so the one way to reach this is a property the target has but never
  decorated. Refused now by `DataSourceService` before any data source is initialized, naming every
  such relation - on every store, where valkey and in-memory had only noticed once a query crossed
  the relation. Fixed in passing: the cast also lied when the inverse *is* declared but is no
  relation, which the framework's own `ChangeSetEntity.changeSets` does (its inverse is the plain
  `changeSetEntityId` column); the cascade is read through `isRelationMetadata` now, a shared guard
  beside the four private copies of the same check that remain in the valkey driver,
  `UUIDUtilities`, the repository and the migrated entity utilities. Held by
  `data-source.service.test.ts` (in-memory, red first) and a case in `bootstrap.evaluation.test.ts`.
- ~~`entity.decorator.ts:30,35` and `property.decorator.ts:27,50` use `any` in the core public
  metadata types; TypeORM's `FindOptionsOrder` / `FindOptionsRelations` leak straight into the
  public `@Entity` API.~~ — **closed with [05 §M3](./05-di-metadata-and-packaging.md)**, down to the
  variance limit named there; `EntityOrder<T>` and `EntityRelations<T>` are the framework's own.
- ~~`property.decorator.ts:186-212` — `@Property.file` defaults to `allowedMimeTypes: 'all'`
  (it warns, but allows).~~ — **closed 2026-10-02, as a required option.** Any file type and a list
  of them are both ordinary answers, so `allowedMimeTypes` is required on `@Property.file` and on a
  file array item, `'all'` written out included, and both warnings are gone - a forgotten list read
  exactly like a decision to take anything. Two doc examples and one test declared file items without
  it and now say `'all'`. Held by a `@ts-expect-error` case in `data-layer.evaluation.test.ts`.
- ~~`property.decorator.ts:206, 232` construct `new Error().stack` per decorator evaluation.~~ —
  **closed 2026-10-02.** Not only the property decorators: 22 decorators across DI, routing,
  responses, websockets and auth each rendered the whole stack to text, once per property, route
  and parameter, to find a file name that is the same for every decorator of a class.
  `MetadataUtilities.setFilePath(target)` now reads the stack for the first decorator of a class
  only (its own metadata, so a subclass still gets its own file). It collects the frames without
  rendering them, through `resolveCallSites`, which the logger's `resolveOrigin` now shares. Found
  on the way: the file was read at a fixed depth, line 5 of the rendered stack. That depth moved
  with every decorator built on another, so for a project's own decorator wrapping `@DataSource`
  the orphan data source error named `reflect-metadata/Reflect.js` as the declaring file. The frame
  is now found by what it is: the first one below the `__decorate`/`Reflect.decorate` helpers, and
  `'unknown'` when the class was not declared through them. Held by `metadata.utilities.test.ts`
  (red first for the wrapped decorator) and a MINOR block in `data-layer.evaluation.test.ts`, which
  counts the stack reads for a class with three properties (3 before, 1 after).
- ~~`src/data-source/driver/typeorm.repository-driver.ts:79-84` re-converts the entire where filter
  into SQL on every query; nothing is cached.~~ — **withdrawn 2026-10-02, by the user's choice, with
  a benchmark entry.** There is nothing in it that could be done once. The conversion produces
  typeorm find options, not SQL. Its input is the call's own filter, and its output carries that
  call's values as parameters, numbered uniquely per query, so it cannot be reused even by the same
  filter. The only part that is the same on every call is the property metadata, which is already a
  WeakMap lookup. Measured (postgres converter, offline): 0.8 µs for an empty filter, 1.5–3 µs for
  one condition, 6 µs for four, spread evenly over the converter's own walk of the filter. The
  in-memory baseline's `findById` is 260 µs. A cache keyed by the filter would have to walk it to
  hash it, which is the same work. The real "once" is a prepared statement, which postgres would
  parse and plan once per statement shape. Typeorm's find API does not expose one, and named
  statements break under pgbouncer's transaction pooling, so that was not taken up. The cost stays
  visible as "where filter conversion" in `framework-overhead.benchmark.test.ts` (median 0.008 ms
  on the baseline machine, added to `baseline.json`).
- ~~`validateOptions` (`postgres-typeorm-data-source.model.ts:177-183`) checks for default
  credentials but never requires TLS; TypeORM's default is an unencrypted connection.~~ — **closed
  2026-10-02, as a required option rather than a requirement.** An unencrypted connection is right
  for a database on the same host or a private network and wrong everywhere else, so neither answer
  can be the default: `ssl` on `PostgresOptions` and `useTLS` on `ValKeyOptions` (glide's default was
  `false` too, the same gap unnamed) are required, and `options` is abstract on both data sources so
  a subclass that declares none is asked as well. Refusing plaintext outside loopback was weighed and
  declined - a compose service named `db` is not loopback and is a private network. Found on the way:
  the backup's `pg_dump`/`psql` children read libpq's `PGSSLMODE`, whose default `prefer` falls back
  to plaintext silently, so a backup could travel less protected than every query. With no mode in
  the environment they now get `require` for a set `ssl` and `disable` for `false`; `require` rather
  than `verify-full` because libpq verifies against its own root certificate, not the system store
  node uses, and an operator who has one names `verify-full` through the environment. The flip side,
  stated in the docs and the upgrade guide: an explicit `ssl` means `PGSSLMODE` no longer reaches the
  connection itself. The scaffold and the sandbox read it from a new `DB_SSL` through a
  `requireBooleanEnv` that refuses anything but `true`/`false`, since a typo reading as `false` would
  turn encryption off. Held by `backup.evaluation.test.ts` (the dump child's mode with and without one
  in the environment, and a data source of each kind leaving tls unsaid failing to compile).
- ~~`data-source.interface.ts:18-23` exposes `READ UNCOMMITTED`, which Postgres silently treats as
  `READ COMMITTED`.~~ — **closed 2026-10-02, the member removed.** Postgres is within the standard
  doing that, since a level is a minimum, but no supported store gave the member a meaning of its own
  (valkey ignores levels entirely), so a caller choosing it got something else everywhere.
  `READ_COMMITTED` is exactly what they had. Held by a `@ts-expect-error` case in
  `data-layer.evaluation.test.ts`.
- ~~No multi-tenancy, no schema-per-tenant. Multi-tenancy here includes the identity side: a user
  belonging to a tenant and a session that cannot reach another tenant's rows. 03 §H listed that as a
  row of its own until it was split into findings (2026-10-04); it was folded in here so that one
  entry tracks multi-tenancy. Read-replica routing and composite primary keys were part of this entry
  until 2026-10-13 and are [§M39](#m39-nothing-routes-a-read-to-a-replica-and-one-postgres-option-already-does-unexamined--minor-open)
  and [§M40](#m40-a-primary-key-is-one-string-id--minor-open) now: neither has anything to do with tenants.~~
  — **closed 2026-10-14, a tenant column on every row and a layer of its own around the scopes.** Every
  entity says where its tenant is or that it is shared, and the repository narrows every read and write
  to the active tenant before a scope narrows within it - so `unscoped` lifts what an entity restricts
  and never reaches another tenant, and reaching every tenant is `acrossTenants`, written at the call.
  Schema-per-tenant was decided against: it moves the restriction into connection routing, where a
  query that forgot to switch reads the wrong tenant, rather than removing it. The identity side is
  memberships (one user, many tenants, roles per membership), checked on every request and websocket
  message whatever the route asks; api keys and client tokens can be bound to one tenant; SCIM, the
  invoicing, payment and mailing list plugins and every framework entity were sorted into per tenant,
  optional (a row of no tenant every tenant reads) or shared. Held by `tenant-isolation.evaluation.test.ts`,
  which attacks over http and websockets as a member of the other tenant, as a user of both holding a
  key bound to one, and through the rows every tenant shares, on the in-memory store and on Postgres;
  `tenant-isolation.cases.ts` holds the repository half on all three stores. **Writing the evaluation
  found four defects, each fixed red-first.** The active tenant kept the case a request wrote its uuid
  in, so a key bound to the tenant, a row's tenant sent back unchanged and a websocket room each took
  the same tenant in capitals for another one - closed, not open, but the same tenant answering two ways.
  A row of no tenant could be changed and deleted from inside any tenant, which is every other tenant's
  data changing under it; it is read-only there now (403 by id, left out of a bulk write), and joining a
  shared websocket channel, which depended on that write, goes across tenants. Thread job callbacks ran
  outside the job's tenant, so an `onComplete` broadcasting a result sent one tenant's result to every
  tenant's connections. And the mail queue sent a tenant's mail outside it, so an application's
  transport, and its log lines, acted for no tenant. 03 §H20, a tenant bringing its own sign-in, stays
  open on its own.
- ~~`@Entity({defaultRelations})` — used by `ChangeSet` itself
  (`change-sets/models/change-set.model.ts:13`) — makes eager joins the default for every query of
  that entity, with no per-call way to opt out to "no relations".~~ — **closed, re-checked
  2026-10-01.** `relations` on a call takes the place of `defaultRelations` rather than adding to it,
  and `relations: []` reads the row on its own (`docs/data-source.md`, reading relations).
