# Data layer: data sources, where conversion, transactions, migrations, backup — round 2

*Reviewed 2026-10-21 against the working tree on `v3`. Read-only; nothing was run.*

Read in full: `packages/zibri/src/data-source/data-sources/**` (the three interfaces, `typeorm-base-data-source.model.ts`,
`postgres/postgres-typeorm-data-source.model.ts`, `postgres-value-conversion.utilities.ts`, `pg-type-parsers.function.ts`,
`val-key/val-key-data-source.model.ts`, `scan-val-key-keys.function.ts`, `val-key-glide.function.ts`, the three
where converters, the statement limiting and cancelling types), `data-source/transaction/**` (both transaction
models, the guarded valkey writes, `abandoned-transaction.test.ts`), `data-source/migration/migration.model.ts` and
`run-migrations.function.ts`, `data-source/where/key-where-to-sql.function.ts` and the head of
`drop-impossible-conditions.function.ts`, `literal-to-sql.function.ts`, `backup/**` (service, encryption, staging,
journal, cleanup cron, the fs, s3 and sftp transports and their option models), the in-memory data source, store
and transaction in `packages/testing/src/in-memory-data-source/`, the driver's error classification and locked read
(`typeorm.repository-driver.ts:555-605, 975-1027`), `lease.service.ts:100-178`, and the pages `data-source.md`,
`backup.md`, `costs.md`, `replication.md`, `leases.md`, `deployment.md`. Cross-checked against `evaluation/01`,
`04 §5.4/§5.6` and `10`. Not read line by line: `val-key.repository-driver.ts` and `in-memory.repository-driver.ts`
beyond their key layout and evaluator use (the driver reviewer owns them), `postgres-column-sql.model.ts`, the
`.cases.ts` suites beyond their titles, the s3 signature utilities, `drop-impossible-conditions.function.ts` past its
contract. The working tree carries uncommitted changes; of the files cited here only
`where-converter/postgres-typeorm-where-filter.converter.ts` and `docs/data-source.md` are modified, and nothing
below rests on a line of either that looks mid-change.

## CRITICAL

None. The data-loss and injection classes the first round filed (01 §C1-C6) are closed in the code as read, and
nothing found here is independently sufficient to reject.

## MAJOR

### S1. A restore clears the whole schema, and nothing checks the schema holds only this data source — MAJOR
*Filed 2026-10-21.*

`createBackupData` dumps `--schema "<current_schema()>"` (`postgres-typeorm-data-source.model.ts:1658-1690`), and
`restoreBackup` prepends `clearSchemaSql(schema)` to the dump (`:1714-1745`), which collects and executes
`DROP ... CASCADE` for every table, view, sequence, type, routine, operator, collation and text search object in
the schema that is not extension-owned (`:209-262`). The scope is deliberate: 01 §C6 closed by moving from the
cluster to "the schema this data source works in", and `docs/backup.md:75` says so.

The unit of a backup is therefore the schema, not the data source's entities, and the schema is `public` unless
somebody configured a `search_path`. Two Zibri data sources on one database, a second application sharing the
database, or a DBA's reporting views in `public` all end up inside data source A's archive, and a restore of A
drops and recreates them as of A's backup. `@Backup` validation (`validateBackupConfiguration`, `:1407-1457`)
checks client tools and versions and never asks whether the schema holds anything the data source does not own
(`pg_class` in the schema versus the entity tables, their junction tables and `MigrationEntity`). The dump side
compounds it: the archive carries the other tables' rows, so a backup shipped off-host for one application carries
another's data.

Not deliberate beyond the scope choice: the C6 note argues why *other* schemas are left alone, not why an
application's schema may hold other owners' objects. The fix direction is cheap: at `@Backup` validation, list the
relations of the schema and refuse (or at least warn) when any is not one the data source created; alternatively
dump and clear by table list rather than by schema, which `pg_dump --table` supports.

**Verify:** `startTestServer` with a postgres data source marked `@Backup`; create an extra table in the same
schema by raw query, run `createBackup`, drop the extra table's rows, run `restore`, and assert the extra table is
untouched. It will instead come back as of the backup, and a table created *after* the backup will be dropped.

> **Closed 2026-10-22, by the user's call: both units are legitimate, so the data source says which.**
> `PostgresDataSource.backupScope: 'schema' | 'entity-tables'` (`postgres-backup-scope.model.ts`), required for a
> data source marked `@Backup`: `validateBackupConfiguration` refuses to boot without it (an optional property
> refused at boot rather than an abstract one, since it means nothing to a data source nobody backs up).
> `'schema'` is the behaviour M55 built, unchanged. `'entity-tables'` dumps `--table` per entity table (junction
> and migration tables are entities to the orm, so they are listed), clears with one `DROP TABLE IF EXISTS` of
> the tables this build declares, *without* cascade, and lets `pg_restore --clean --if-exists` drop what the
> archive holds (a table an older build declared). No cascade is the point: a foreign view or foreign key on an
> entity table makes the restore fail inside psql's single transaction rather than taking the other object with
> it, and `docs/backup.md` says to remove it first. Not built: a boot check that a `'schema'` schema holds
> nothing foreign; choosing `'schema'` says it does not. Test: `postgres-backup-scope.test.ts` (rows restored,
> a foreign table left out of the archive and untouched by the restore, a table created after the backup
> surviving it, a dependent view refusing the restore, boot refusal without a scope). The five existing
> `@Backup` postgres sources declare `'schema'`. Docs: `backup.md` (table of the two scopes), upgrade guide.
> **Not run here (postgres).**

### S2. Any index or constraint named `IDX_*` or `UQ_*` on an entity's table is dropped at boot, without a log line — MAJOR
*Filed 2026-10-21.*

Under `schemaManagement: 'migrations'`, `reconcileKeysOf` (`postgres-typeorm-data-source.model.ts:2076-2107`)
reads every index of the table (`STORED_KEYS_SQL`, `:540-548`), keeps those `isDeclaredKeyName` answers yes for,
and drops every kept one that no entity declares (`:2100-2104`). `isDeclaredKeyName`
(`typeorm-base-data-source.model.ts:1426-1438`) answers yes for the framework's own prefixes *and* for anything
starting with `UQ_` or `IDX_`, because those are TypeORM's default names and 2.x let the orm name them (01 §M38).

`IDX_` is also the most common hand-written index prefix there is. A DBA who adds `IDX_orders_customer_created` on
a hot table in production loses it on the next deploy of any version, with no record: neither the drop of an
abandoned key nor of an invalid leftover (`:2083-2085`) is logged, and `reconcileKeys` only reports a boolean. The
performance regression surfaces as slow queries days later, and the index reappears nowhere.

Checked: `key-reconciliation.cases.ts` holds "stops keeping a unique the next release no longer declares" and
nothing about a foreign index surviving; `upgrading-to-3.md:647` describes the 2.x replacement; no comment
considers a name the orm did not generate. TypeORM's defaults are `IDX_`/`UQ_` followed by a fixed-length hex
hash, so the 2.x case can be matched exactly; and a drop of a schema object at boot is worth an info line in every
case.

**Verify:** `startTestServer` on postgres under `'migrations'`, `CREATE INDEX "IDX_manual" ON "<entity table>" (...)`
by raw query, `reInit`, and assert the index still exists in `pg_indexes`. It is gone.

> **Closed 2026-10-22, by ownership on the object rather than in the name.** The fix direction here (match the
> orm's `IDX_`/`UQ_` + hash exactly) was not enough: the data source names its own `idx_<table>_…` and
> `uq_<table>_…`, and postgres folds an unquoted `IDX_orders_customer` to `idx_orders_customer`, so the most
> common hand-written index on `orders` still matched. Now every index `reconcileKeysOf` keeps for a declaration
> carries `COMMENT ON INDEX … IS DECLARED_KEY_COMMENT`, set after the concurrent build (and on a kept one that
> lacks it), and `owned` is: marked, *or* named as one declared now (an index built before the comment existed, or
> by a boot that stopped between build and comment), *or* exactly the orm's default (`/^(UQ_[\da-f]{27}|IDX_[\da-f]{26})$/`,
> 2.x leftovers). `renameDeclaredKeys` renames marked indexes only. Both drops (an abandoned key, an invalid
> leftover) log at info with the index and table. Residue: an index an unreleased 3.0 build created and a later
> one stopped declaring, before the comment existed, is no longer recognized and stays (dev databases only).
> `isDeclaredKeyName` (base class) keeps its prefixes: it now only filters what the orm builds for a table being
> created, where every name came from metadata. Test: two postgres-only cases in `key-reconciliation.cases.ts`
> (passed a `runStatement` by `key-reconciliation.postgres.test.ts` only): `"IDX_by_hand"` and unquoted
> `IDX_reconciled_widget_by_hand` survive a release that drops the declared index; the declared index and an
> orm-named one are dropped, and both drops are logged. Docs: `data-source.md` "Keeping indexes and uniques".
> **Not run here (postgres).**

### S3. The docs recommend a connection pooler; the data source's session-level state breaks under transaction pooling, and only one of the dropped settings is detected — MAJOR
*Filed 2026-10-21.*

`replication.md:118-125` and the `poolSize` comment (`postgres-typeorm-data-source.model.ts:623-644`) send a
deployment that outgrows twenty connections per replica to "a pooler in front". A pooler in transaction mode is
what PgBouncer, RDS Proxy and most managed offerings default to, and the data source assumes a session it owns:

- the statement timeout and the trigram threshold travel as connection *startup options*
  (`fullOptions`, `:662-675`), which PgBouncer rejects unless `ignore_startup_parameters=options` and then drops;
- `limitStatementsOn` outside a transaction sets `statement_timeout` on the session and `RESET`s it afterwards
  (`:738-746`); under transaction pooling the `SET`, the statement and the `RESET` can land on three server
  connections, so the limit applies to somebody else's statements and this call runs without one;
- `schemaLock` takes a session advisory lock on a dedicated one-connection `DataSource` (`:1165-1211`); with a
  pooler between, `pg_advisory_lock` and `pg_advisory_unlock` are not guaranteed the same backend, and a second
  instance's lock request routed to the backend already holding it is granted (same session), so the exclusion
  01 §C2 closed with is gone;
- `cancelStatementOn` names the backend by `databaseConnection.processID` (`:724-735`), which is the pooler's
  view of the pid.

What is deliberate: `SET LOCAL` is used inside transactions for exactly this reason (`:765-770`), and
`warnAboutAnotherSimilarityThreshold` (`:941-952`) exists because "something between it and the server is
dropping the setting". What is missing is the same probe for `statement_timeout` (one `SHOW statement_timeout`
at boot against `this.statementTimeoutInMs`), a probe for the pooling mode, and a sentence in `replication.md`
saying which pooling mode the data source needs (session) and which it does not. An adopter who follows the
recommendation gets a schema lock that does not lock and a statement timeout that is not there, both silently.

**Verify:** a cluster suite is the honest one (two instances through a PgBouncer container in transaction mode,
both booting a migration), but the cheap proof is a unit of `fullOptions` plus a `startTestServer` boot with
`extra.options` stripped by a wrapper, asserting the data source warns that `statement_timeout` is not what it
asked for. Today it warns about the trigram threshold only.

### S4. Unique and mistyped-value detection parse the server's English messages — MAJOR
*Filed 2026-10-21.*

`violatedUniqueProperties` (`postgres-typeorm-data-source.model.ts:1350-1373`) reads the violated columns out of
`detail` by splitting on `'Key ('` and `')='`, and falls back to the constraint name when that fails.
`mistypedJsonValue` (`:1376-1404`) chooses its marker by `declaredTypeOf(error.message)` (`:174-182`, matching
`'for type numeric'` etc.) and reads the value with `UNREADABLE_VALUE_PATTERN` (`:163`). Both are the server's
`lc_messages`, which an international deployment sets to `de_DE`, `fr_FR` or `ja_JP` at the server
(`lc_messages` is superuser-only, so the data source cannot force `C` per session).

Under a non-English server, a unique violation still becomes `UniqueConstraintViolationError`, but its
`properties` is `['uq_account_email']` rather than `['email']`, so every application that maps the property to a
field error (the documented use, `data-source.md:257`) shows the constraint name, and the in-process stores keep
answering with property names — the "two stores answer differently" class. The mistyped-json path degrades
further: no marker matches, so a `StoredValueTypeMismatchError` that the docs promise (`data-source.md:412-417`)
arrives as a bare `QueryFailedError`, a 500.

Not deliberate: the comment at `:1358` shows the English detail as the assumed shape. The locale-independent
fields are already in the error: `driverError.constraint` and `driverError.code`, and the framework names every
constraint itself (`uniqueConstraintName`, `checkConstraintName`), so the properties can be resolved from the
name through the entity's `keyGroupsOf` instead of from prose; the json cast can carry its marker's index in the
cast expression and be matched by `driverError.position` rather than by message text.

**Verify:** `startTestServer` on postgres with `ALTER DATABASE ... SET lc_messages = 'de_DE.utf8'` (the official
image ships the locale) or a container started with `-c lc_messages=de_DE.UTF-8`; insert a duplicate and assert
`error.properties` equals `['email']`; filter a mistyped json number and assert `StoredValueTypeMismatchError`.

> **Closed 2026-10-22, the way the finding proposed for uniques, by `routine` for the casts.** The abstract became
> `findViolatedUniqueProperties(error, entityClass)` (mirroring `findViolatedCheck`): postgres matches
> `driverError.constraint` against the names `resolveDeclaredKeys` gives the entity's uniques (through
> `toStoredIdentifier`, so a cut name matches), then against the orm's primary-key name
> (`namingStrategy.primaryKeyName(tablePath, …)` → the primary properties), and otherwise answers the constraint
> name, as before for an undetailed one. The detail is no longer read. The json path chooses its marker by
> `driverError.routine` (`numeric_in`, `set_var_from_str` before 16, `boolin`, `DateTimeParseError`), never
> localized, with the old first-marker fallback kept; the value is read between the quotes of any language
> (`"…"`, `»…«`, `« … »`, `„…“`, `「…」`). Correction to the finding: the mistyped path never degraded to a bare
> `QueryFailedError`, since an unmatched type fell back to the first marker; what broke was the wrong path when a
> statement casts several types, and the whole message as the value. Test: `postgres-localized-errors.test.ts`
> (installs `de_DE.UTF-8` in the container through the new zibri-testing `StartedTestServer.runInContainer`,
> sets `lc_messages` on the database as superuser, re-inits; a control that the server answers in German, then the
> unique, the single cast and a two-cast statement). **Not run here (postgres); if the image lacked the
> translations the control case is what goes red.**

### S5. A serialization failure or deadlock is an untyped 500; nothing can retry it, and there are no savepoints — MAJOR
*Filed 2026-10-21.*

`IsolationLevel` offers `REPEATABLE READ` and `SERIALIZABLE` (`data-source.interface.ts:23-27`), and the driver
itself opens `REPEATABLE READ` for every `findAllPaginated` (`typeorm.repository-driver.ts:308-313`). What
postgres answers such a transaction with when it conflicts is SQLSTATE `40001`, and a lock cycle between two
`updateAll` claims (`findLockedIds`, `:569-577`, `FOR UPDATE`) or two `upsert` batches with `40P01`. The driver's
`run` (`:989-1027`) classifies a `QueryFailedError` into unique, check and mistyped-json errors and rethrows
everything else as `QueryFailedError extends InternalError` (`query-failed.error.ts:8`): no error type, no
`sqlState` field, no retry anywhere in the repository, and nothing in the docs beyond "decide an order for your
keys" (`data-source.md:1672-1676`).

For an adopter this means a `SERIALIZABLE` transaction, the one isolation level the docs name as the answer to
"rows that start matching while it runs" (`:1643`), can only be used by digging `error.cause.driverError.code`
out of an `InternalError` and re-running the whole unit of work by hand, and that a deadlock the framework's own
primitives reach (01 §M34 found "postgres deadlocked where valkey waited") is a 500 to whoever called. The
`Transaction` type (`transaction.model.ts:8-40`) also has no savepoint, so partial rollback inside a unit of work
is impossible; 01 §M6 declined a `runInTransaction` helper on the grounds that it would need savepoints, which
leaves the capability absent rather than decided.

Fix direction: classify `40001`/`40P01` into a `TransactionConflictError` carrying the SQLSTATE, document that it
is retryable, and offer a `Repository.inTransaction`-shaped retry with a bounded attempt count; savepoints are a
separate decision.

**Verify:** `startTestServer` on postgres; two transactions at `SERIALIZABLE` performing a read-then-write on the
same row; assert the loser's error is a named, retryable type. Today it is `QueryFailedError`.

> **Closed 2026-10-22, by the user's two calls: a shared parent, and a retrying helper without savepoints.**
> `TransactionConflictError` (abstract) is the parent of `TransactionDeadlockError` and the new
> `TransactionSerializationError` (40001, `isSerializationFailure` beside `isDeadlock`). The base data source's
> `resolveConflictError` classifies both, and is used by the driver's `run` and handed to `TypeOrmTransaction`,
> whose `commit` now maps a failed commit through it, since a serializable loser often learns it only at COMMIT.
> `DataSourceInterface.runInTransaction(work, { maxAttempts, ...StartTransactionOptions })`, implemented once
> in `TransactionUtilities.runInTransaction` and delegated to by postgres, valkey and in-memory: commit,
> rollback on failure (skipped when a failed commit already ended it), rerun on a `TransactionConflictError`,
> rethrow the last one after `maxAttempts` (required, a whole number ≥ 1). It needs no savepoints because it
> reruns from the start, which removes the M6 objection. Savepoints were not built (the user did not pick that
> option). Tests: `run-in-transaction.cases.ts` (5 cases; in memory 5/5 here, postgres and valkey in
> `.postgres-valkey.test.ts`), `postgres-serialization.test.ts` (a real write skew: the second commit fails
> with `TransactionSerializationError`; `runInTransaction` books once after losing the first attempt). Docs:
> `data-source.md` "Using transactions", upgrade guide (the deadlock section widened, `runInTransaction` for a
> data source of your own). **Postgres and valkey not run here.**

### S6. A valkey backup is not a snapshot, and a restore rebuilds no index — MAJOR
*Filed 2026-10-21.*

`ValKeyDataSource.createBackupData` (`val-key-data-source.model.ts:848-871`) scans every key under the prefix
(`scanValKeyKeys`, all keys collected into one array first, `scan-val-key-keys.function.ts:9-21`), then `DUMP`s
and `PTTL`s each key one at a time. Transactions commit between those round trips, atomically per batch
(`val-key-transaction.model.ts:549-569`): a row hash, its `{table}:ids` membership, its unique index entries and
the `{table}:keys` list can each be captured on either side of a commit. The postgres resource gets a
transaction-consistent snapshot from `pg_dump`; this one is a walk.

`restoreBackup` (`:888-913`) stages every entry then swaps all keys in one batch, which is atomic for the swap
but swaps in whatever the walk saw. Nothing afterwards reconciles rows against their indexes: `reconcileKeys`
runs only in `init` (`:347-352`), and `rebuildStoredKeys`-style work is tied to a changed declaration, not to a
restore. A unique index entry whose row was not captured keeps the value taken (a phantom
`UniqueConstraintViolationError`), and a row captured without its `ids` membership is invisible to every read
and never deleted. Cost is the second half: a backup of N keys is 2N sequential round trips plus the full key
list in memory, and a restore holds the dataset twice on the server until the swap.

Checked: 01 §M16 closed the "destroys before validates" half and says nothing about consistency; `backup.md`
describes the postgres scope and no valkey caveat. For a store the docs present as "the exact same
repositories" (`data-source.md:133-135`), an adopter will assume the backup is as consistent as the other one.
Fix direction: take the backup inside the schema lock while refusing writes (the simplest consistent cut), or
record `{table}:ids` and the index keys last and rebuild indexes on restore; and document that a valkey backup
is a walk.

**Verify:** `startTestServer` on valkey; start `createBackupData` and, while its stream is consumed slowly,
commit a transaction creating a row of an entity with a unique property; restore; assert either both the row
and its index entry are present or neither. One of the two mixed states is reachable.

> **Closed 2026-10-22, by the user's call: both directions, chosen per data source.** Required-at-boot
> `ValKeyDataSource.backupMode: 'snapshot' | 'walk'` (`val-key-backup-mode.model.ts`, refused by
> `validateBackupConfiguration` when unset, as postgres' `backupScope`). `'snapshot'`: one Lua script
> (`KEYS` + `DUMP` + `PTTL`, undeclared keys, standalone only as everything else here) read with
> `Decoder.Bytes`, a true cut in one round trip at the price of blocking the server and one reply holding the
> dataset. `'walk'`: the scan, then a pipelined non-atomic batch of `DUMP`/`PTTL` per 250 keys (2N round trips →
> N/250). Either way, `restoreBackup` now runs `ValKeyRepositoryDriver.rebuildStoredKeys()` per entity under the
> schema lock after the swap: `ids` rebuilt from the row hashes (`SCAN … TYPE hash`, no `:` after the table),
> every declaration of the restored list and of the entity taken off `built`, its keys deleted, built again from
> the rows, checks judged again. Residue: many-to-many join keys are not rebuilt, so a walk can still restore a
> join entry naming a row it did not capture. Test: `val-key-backup-mode.test.ts` (boot refusal; round trip per
> mode; a transaction committed while a snapshot is read is absent whole; an unlisted row and a row-less unique
> entry come back in line after a restore, per mode). Docs: `backup.md` (a table of the two modes), upgrade guide.
> **Not run here (valkey).**

### S7. A restore ignores migrations, key reconciliation and the other instances — MAJOR
*From the user's list ("the backup system needs to somehow deal with datasource migrations"). Filed 2026-10-21.*

`BackupService.restoreWithin` (`backup.service.ts:681-736`) fetches, snapshots and applies resources with no
schema lock, no lease, and no look at `MigrationEntity`. The postgres resource then replaces every table,
`migration` included, inside psql's single transaction (S1). Three concrete consequences:

- a backup *older* than the running build restores an older `migration` table and older columns under
  instances whose code expects the newer schema; nothing re-runs migrations or key reconciliation on the
  restoring instance (`init` is the only caller, `typeorm-base-data-source.model.ts:565-584`), so every
  instance serves 500s until each is restarted, and the other replicas have no signal at all;
- a backup *newer* than the build cannot be used: the next boot's `validateDatabaseIsNotAhead`
  (`run-migrations.function.ts:191-204`) refuses to start, and `revertMigrationsAfter` needs a build that
  carries the newer migrations, which is the one being replaced;
- the `zibri:indexes-and-uniques` record and the trigram indexes come back as of the backup while the entities
  declare the current set, and nothing between restore and next boot brings them in line.

`backup.md:213-227` documents the per-resource snapshot and the journal and says nothing about stopping
instances, versions or migrations. The reviewer agrees with the user's own note that this is unsolved; what the
code could do now: refuse a restore whose `migration` rows are ahead of the build, run `runMigrations` plus
`reconcileKeys` under the schema lock right after a restore, and document that a restore is an operation on a
stopped deployment.

**Verify:** `startTestServer` on postgres with one migration; back up; `reInit` with a second migration that
adds a required column; restore the older backup without restarting; a write through the repository now fails
with a column error, and nothing in the log said why.

> **Closed 2026-10-23: a restore ends the way a boot does.** Every data source's `restoreBackup` brings what it
> restored in line with the running build before it returns. `TypeOrmBaseDataSource.restoreBackup` holds the schema
> lock around the dialect's `applyBackup` (postgres' psql run, renamed from `restoreBackup`) and then, under the
> migration timeout, `runMigrationsAfterRestore` plus the boot's own key reconciliation, record and synchronize
> (`reconcileSchema`, extracted from `init`). Valkey cannot hold the lock across its swap (the lock key is under the
> prefix the swap deletes), so it locks right after: `rebuildStoredKeys` (now returns whether the restored lists
> differed from the declarations), migrations, reconciliation, and the `zibri:indexes-and-uniques` record when either
> changed anything. The in-memory store does the same, and its snapshot now carries the key lists, which it kept
> across a restore before. `runMigrationsAfterRestore` (`run-migrations.function.ts`) refuses a backup holding
> migrations or a key record of a newer version, with a restore-specific message ("Restore it with a build of that
> version or a newer one"); `BackupService` then puts every applied resource back as for any failing resource. The
> refusal comes after the apply: psql's single transaction gives no point to look at the archive's `migration` rows
> before committing. "The other instances" is documentation, not code: `backup.md` says to restore with one instance
> running. Tests: `restore-migrations.cases.ts` on in memory, postgres and valkey (an older backup gets the later
> release's migration and is writable as it declares; the later release's unique holds over it and an older release
> refuses to start afterwards; a newer backup is refused naming its migration), red first in memory (3 of 5), plus
> `backup-service.several-resources.test.ts` (the refusal puts the data source back). Docs: `backup.md` (a backup of
> another release, restoring with one instance), `data-source.md` (a restore applies migrations). **Not run here
> (postgres, valkey).**

### S8. The S3 transport takes static access keys only — MAJOR
*Filed 2026-10-21.*

`S3BackupTransportOptions` requires `accessKeyId` and `secretAccessKey` (`s3-backup-transport-options.model.ts:22-26`),
and `resolveRequest` signs with exactly those (`s3.backup-transport.ts:334-343`); there is no session token
header, no credential provider, no instance-metadata/IRSA/web-identity path, and no server-side-encryption or
object-lock headers. AWS enterprise policy almost universally forbids long-lived keys in workloads; the transport
as shipped cannot be used there without subclassing past `private` members, which is the "seam nobody can use"
shape 04 §5.2 closed for mail. The hand-rolled SigV4 client is a defensible dependency decision; the credential
model is the missing half of it.

Fix direction: accept `credentials: () => Promise<{ accessKeyId, secretAccessKey, sessionToken? }>` and send
`x-amz-security-token` when present; the rest of the signer already builds a canonical header set.

**Verify:** a unit test of `resolveRequest` with a session token in the options, asserting the signed headers
carry `x-amz-security-token` and the signature includes it; the option does not exist today.

> **Closed 2026-10-23, all three gaps the body names.** Credentials: `accessKeyId`/`secretAccessKey` became
> `credentials: S3Credentials | (() => Promise<S3Credentials>)` (`s3-credentials.model.ts`, `sessionToken?`), resolved
> per request in `resolveRequest`; the signer takes `credentials` and puts `x-amz-security-token` among the signed
> headers. The function shape is the AWS SDK's `AwsCredentialIdentityProvider`, so `fromNodeProviderChain()` (memoized
> until expiry) passes as it is; documented as an example without importing it (the docs test would not resolve the
> package). Encryption: required `serverSideEncryption: 'bucket-default' | { algorithm: 'AES256' } | { algorithm:
> 'aws:kms', keyId? }` (two legitimate answers, so required), sent and signed on `PutObject` and
> `CreateMultipartUpload` only. Object lock: every `PutObject` and `UploadPart` sends a signed `Content-MD5`, which a
> bucket with a default retention refuses uploads without; chosen over `x-amz-checksum-*` because every S3 compatible
> service knows it. No upgrade-guide entry: the transport is new in 3.0. Tests:
> `s3.backup-transport.requests.test.ts` (container-free: an in-process endpoint records what the transport sends;
> token per request and signed, none for static keys, digest on both parts and the record, encryption headers on the
> start of each object and not on parts), red first for token, digest and encryption; a token case in
> `s3-signature.utilities.test.ts`; the versity suite now signs through a credentials function. Docs: `backup.md`.
> **Not run here:** the versity suite, and no real object-lock bucket.

### S9. The valkey data source speaks to one standalone node — MAJOR
*Filed 2026-10-21.*

`ValKeyOptions` is `GlideClientConfiguration` minus `addresses` (`val-key-data-source.model.ts:61-86`), `init`
builds `addresses: [{ host, port }]` (`:340-343`), and every path uses `GlideClient`, never `GlideClusterClient`.
Keys of one entity live under several top-level keys (`{prefix}:{table}:{id}`, `:ids`, `:keys`, index sets), and
transactions, the guarded-writes script and the lock scripts put all of them in one `Batch` or one `KEYS` list
(`apply-guarded-val-key-writes.function.ts:66-70`), which a cluster rejects across slots. Managed valkey in an
enterprise is clustered more often than not (ElastiCache "cluster mode enabled", Memorystore cluster), and
`docs/data-source.md` nowhere says that is unsupported. A non-clustered primary endpoint with replicas works,
and that is what should be written down; cluster support would need hash-tagged keys per entity.

**Verify:** not reproducible without a cluster; the documentation half is a one-line check of
`data-source.md:132-203`.

> **Closed 2026-10-23.** Decided with the user: a valkey data source supports one server (standalone, or the
> primary endpoint of a primary with replicas), which every app instance shares; cluster support stays out,
> since a transaction spanning entities would need the whole data source under one hash tag, i.e. one slot.
> `init` now reads `INFO cluster` right after connecting and refuses `cluster_enabled:1` with an error naming
> the data source, closing the client (`val-key-data-source.model.ts`, `validateServerIsStandalone`).
> `data-source.md` "Using ValKey" says which servers it connects to. Held by
> `val-key-data-source.cluster-mode.test.ts`, which boots `valkey-server --cluster-enabled yes` and expects
> `init` to reject (container-backed, not run here).

### S10. An abandoned postgres transaction never finishes; on valkey it does, and a lease held until it is kept forever — MAJOR
*Filed 2026-10-21.*

01 §M6 closed the abandoned-transaction leak by `idle_in_transaction_session_timeout` on postgres
(`postgres-typeorm-data-source.model.ts:757-779`) and a timer on valkey. The two do different things to the
`Transaction` object. Valkey's timer calls `abandon()` → `rollback()` → `runFinishedWork(false)`
(`val-key-transaction.model.ts:367-386, 572-585`): `isFinished` becomes true and every `afterFinish` runs.
Postgres' server terminates the backend, and `TypeOrmTransaction` learns nothing: `finished` stays false and
`finishedWork` never runs until somebody calls `commit` or `rollback` (`typeorm-transaction.model.ts:24-75`),
which an abandoned transaction by definition nobody does.

`LeaseService.runHoldingUntil` (`lease.service.ts:131-178`) relies on `afterFinish` to set `committed` and
release; until then `keepAlive` renews the grant. A `withLease({ heldUntil: transaction })` whose transaction is
abandoned on postgres therefore keeps its grant renewed for the life of the process, and
`leases.md:106-122` promises the opposite. The pool is recovered (held by `abandoned-transaction.test.ts`), the
lease is not, and the same code on valkey releases it after ten seconds. Fix direction: arm the same timer on the
postgres transaction, or have the next use of a terminated runner mark the transaction finished and run its
work; either way both stores should answer the question the same way.

**Verify:** `startTestServer` on postgres; `withLease({ key, leaseInMs: 1000, mode: 'wait', heldUntil: tx })`
with `tx` started at `idleTimeoutInMs: 500` and never ended; after two seconds a second `withLease` on the
same key with `mode: 'skip'` must get the grant. It does on valkey and not on postgres.

> **Closed 2026-10-23.** The Verify scenario was red on valkey too, and on the in-memory data source: valkey
> armed its idle timer only on the first write, and the in-memory transaction ignored `idleTimeoutInMs`, so a
> transaction holding nothing but a `heldUntil` lease was never ended on any store. Now:
> postgres' `startTransaction` listens for the connection's `error` (the server closing it, which is what the
> idle timeout does) and calls the new `TypeOrmTransaction.abandon()` - finished, committed work dropped,
> `afterFinish(false)` run - logging it; the listener is removed in `afterFinish`. `TypeOrmTransaction.commit`
> on a finished transaction throws `TransactionAlreadyFinishedError` and `rollback` returns, as the other
> stores do. Valkey's `afterFinish` arms the timer (work waiting for the end is held like a grant). The
> in-memory transaction got the same timer (default 10s, armed by writes and `afterFinish`). `data-source.md`
> (Using transactions) and `leases.md` (heldUntil) say what an idle rollback does. Held by
> `abandoned-transaction-lease.cases.ts` (lease handed back + commit refused, rollback quiet), run by
> `abandoned-transaction-lease.test.ts` (in memory: red first - lease kept, commit accepted, shutdown hung on
> the drain; green after) and `.postgres-valkey.test.ts` (container-backed, not run here).

## MINOR

### S11. A valkey subscription that fails once delivers nothing for the rest of the process — MINOR
*Filed 2026-10-21.*

`subscribe` (`val-key-data-source.model.ts:383-424`) runs a loop around `getPubSubMessage()`; on the first
rejection it logs and `return`s (`:407-412`), and nothing restarts it. The websocket adapter calls it once in
`listen` (`data-source.websocket-adapter.ts:154-164`). Glide reconnects the connection on its own, so the loop
mostly survives a blip; what ends it for good is a client that gave up or was closed, after which cross-instance
fan-out stops with one error line. Resubscribing on error, or surfacing the dead subscription so the adapter can
reopen it, is a small change.

**Verify:** `startTestServer` on valkey with the websocket adapter; restart the valkey container (testcontainers
can), publish from a second client, and assert the subscriber still receives. Uncertain until run; the code path
after one rejection is certain.

> **Closed 2026-10-23, with 03 §H18**, where the closure is. A subscription whose client was closed
> subscribes again on a new one; `val-key-pub-sub.test.ts`.

### S12. The valkey schema lock is shared by every application on the server — MINOR
*Filed 2026-10-21.*

`acquireLocks` prefixes keys with `LOCK_KEY_PREFIX` only (`val-key-data-source.model.ts:123, 502`), and the
schema lock key is the constant `SCHEMA_LOCK_KEY` (`data-source.interface.ts:71`), so two applications with
different `keyPrefix` on one valkey server serialize their boots on `zibri.lock:zibri.schema` and fail each other
after `SCHEMA_LOCK_TIMEOUT_IN_MS` when one migration is slow. Row grants are safe because the row key carries the
prefix. Namespacing the lock under `keyPrefix` is one line.

**Verify:** two `ValKeyDataSource` classes with different `keyPrefix` against one container, one holding the
schema lock in a slow migration; the other's boot fails with "another instance is still holding it".

### S13. A migration's transaction idles out after ten seconds, and a migration cannot say otherwise — MINOR
*Filed 2026-10-21.*

`Migration.runUp` starts `this.dataSource.startTransaction()` with no options (`migration.model.ts:41`), so the
default `idleTimeoutInMs` of 10 s applies (`postgres-typeorm-data-source.model.ts:104, 759`) while the statement
timeout is lifted. A data migration that does slow in-process work or a remote call between two statements is
killed with postgres' own "terminating connection due to idle-in-transaction timeout", and `timeoutInMs` on the
migration (`:29`) does not reach it. `data-source.md:1450-1453` says migrations "take as long as they need".

**Verify:** `startTestServer` on postgres with a migration that awaits a 12 s timer between two writes; boot fails.

### S14. Migrations: no checksum of applied ones, no generator, no operator entry point, and a missing table is found by accident — MINOR
*Filed 2026-10-21.*

`MigrationEntity` records name, version and `ranAt` (`run-migrations.function.ts:46-69`); a migration edited after
it ran is not detected (Flyway/Liquibase checksum). Nothing generates a migration from an entity diff, and the
CLI has `new`, `help`, `version` only (`packages/cli/src/commands/`), so `revertMigrationsAfter` is run by
writing code against a data source (`data-source.md:1532-1538`). Under `'migrations'`, an entity whose
`createEntity` was forgotten is caught only when `reconcileKeys` tries to build an index on the missing
relation, with postgres' "relation does not exist" rather than a message naming the entity; an entity with no
keys and no string property is not caught at all (no `hasTable` check in `init`,
`typeorm-base-data-source.model.ts:535-585`).

**Verify:** `startTestServer` under `'migrations'` with an entity no migration creates; assert the boot error
names the entity. It names an index.

### S15. A backup's name is a path segment on every transport and is not validated — MINOR
*Filed 2026-10-21.*

`BackupCreateData` lets the caller pass `name` (`backup-service.interface.ts:14`, `backup-entity.model.ts:84-86`),
and it becomes `getPath(backupBasePath, name)` on fs (`fs.backup-transport.ts:91-93`),
`path.posix.join(options.path, name)` on sftp (`sftp.backup-transport.ts:374-376`) and the object key on s3
(`s3.backup-transport.ts:357-363`). `../` reads, writes and `rm`s outside the configured folder, and the sync
reads directory names back as backups. A name is a date by default; validate it as one path segment.

**Verify:** unit test on `BaseFsBackupTransport.storeMetadata` with `name: '../escaped'`; the file lands above
`backupBasePath`.

### S16. A failed backup stays on the transports and in the table; there is no retention and no schedule — MINOR
*From the user's list. Filed 2026-10-21.*

`createBackupWithin` deletes a stopped backup only when `stopping.signal.aborted` (`backup.service.ts:643-657`);
any other failure rethrows and leaves the uploaded resources, the `BackupEntity` and its incomplete
`BackupResourceEntity` rows. Each such leftover is warned about by every sync on every start (fs `:38-43`,
sftp `:85-89`, s3 `:106-109`). There is no retention (`backup.md` never mentions one) and no shipped cron that
takes a backup, so both are application code. Fix direction: delete on any failure the same way the stopped path
does, and offer a `keep` policy on `@Backup` or on the service.

**Verify:** `startTestServer` with two fs transports, one pointing at an unwritable path; `createBackup` throws,
and the other transport still holds the resource.

### S17. `RestoreNotUndoneError` cannot be made impossible; what can be is narrower — MINOR
*From the user's list. Filed 2026-10-21.*

`putBack` (`backup.service.ts:783-801`) re-applies each snapshot through `restoreBackup`, which for postgres is
one psql transaction (`postgres-typeorm-data-source.model.ts:1714-1782`) and for valkey a staged swap. A put-back
fails for the reasons the restore failed: a role the snapshot names that is gone, disk full in the staging
folder, the connection lost. Making the error unreachable would need an atomic multi-resource commit, which two
different stores cannot give. What reduces it: validate the snapshot the same way an archive is validated
before applying anything (today the snapshot is taken but never checksummed), and take the snapshot and the
archive through the same `--single-transaction` path so the only remaining failure is infrastructure.

**Verify:** none beyond the existing `backup-service.several-resources.test.ts`; this is an analysis entry.

### S18. The staging folder is a third path the application writes, and `deployment.md` lists two — MINOR
*Filed 2026-10-21.*

`backup.md:250-255` says backups pass through `.zibri/backups` beside the application and asks for twice the
largest backup in disk; `deployment.md:115-123` says the application writes `versions` and `.zibri/uploads` and
"everything else can stay read only". A read-only root filesystem, which the page recommends, fails the first
backup with `EROFS`.

**Verify:** documentation; or boot with `BACKUP_TEMP_FOLDER` on a read-only mount and run `createBackup`.

### S19. Starting a postgres transaction costs three to four statements before any work — MINOR
*Filed 2026-10-21; the round-trip count per paginated page is round-2 01 §D4, this is the store-side half.*

`TypeOrmBaseDataSource.startTransaction` calls `runner.startTransaction(isolationLevel)`
(`typeorm-base-data-source.model.ts:978`), which typeorm's postgres runner issues as `START TRANSACTION` and,
when a level is named, a second `SET TRANSACTION ISOLATION LEVEL …` (`PostgresQueryRunner.js:122-124`).
`PostgresDataSource.startTransaction` then adds `SET LOCAL idle_in_transaction_session_timeout`
(`postgres-typeorm-data-source.model.ts:764-770`), and inside a request with a deadline
`STATEMENT_TIMEOUT_SUBSCRIBER` adds `set_config('statement_timeout', …)` (`:359-368`). Every `inTransaction`
and every `findAllPaginated` page (which opens `REPEATABLE READ`, `typeorm.repository-driver.ts:308-313`) pays
three or four round trips before its first real statement. Postgres accepts all of it as one
`BEGIN ISOLATION LEVEL REPEATABLE READ` followed by one multi-statement `SET LOCAL …; SET LOCAL …` string, or the
two settings folded into the `BEGIN`'s own session with `SET LOCAL` once; the subscriber cannot do that, but the
data source can, since it owns the runner and can issue `BEGIN ISOLATION LEVEL …` itself instead of through
typeorm's two statements.

**Verify:** `RoundTripCounter.describe()` around a `startTransaction({ isolationLevel: REPEATABLE_READ })` plus
one `findAll` inside a request; four statements precede the read.

## Code quality and architecture

Moved to [code-review/02-data-layer-stores.md](./code-review/02-data-layer-stores.md) (Q1–Q7).

## Already filed

- Nothing routes reads to a replica; TypeORM's `replication` option is accepted unexamined → 01 §M39, open.
- Text ordered by one locale for the whole application (the icu collation per column) → 01 §M28, open.
- A deadlock between valkey transactions ends all of them after ten seconds instead of one → 10 §10.6, open (deferred).
- `unique` on an encrypted property → 01 §M36, open (deferred).
- Composite and non-string primary keys → 01 §M40, open.
- Backup restore verification, staging, shutdown and the killed-restore journal → 04 §5.4 and §5.6, FIXED; S7, S16 and S17 are what those leave open.
- Transaction pool leak and the idle timeout → 01 §M6, FIXED; S10 is a consequence of how it closed.
- Pool size and the pooler recommendation → 01 §M7, FIXED; S3 is a consequence of the recommendation.
- Indexes and uniques kept by the data source, `UQ_`/`IDX_` treated as owned → 01 §M38, FIXED; S2 is the cost of that rule.
- SQL built by concatenation → 01 §C5, FIXED; re-read every assembly point listed under "SQL surface" in the summary, nothing reopened.
- Backup scope and credentials → 01 §C6, FIXED; S1 is the schema scope it chose.

- Six round trips per paginated page, and the per-transaction preamble → round-2 01 §D4 (repository side); S19 here is the store-side half.
- The valkey relation resolver building a new `ValKeyRepositoryDriver` per relation per read (`val-key.repository-driver.ts:2046-2051`) → pointed out by the repository reviewer; driver side, not re-filed here.

## Not reviewed

`val-key.repository-driver.ts` and `in-memory.repository-driver.ts` as drivers (the key layout and evaluator use
were read for S6, S12 and Q7 only); `drop-impossible-conditions.function.ts` past its contract; the s3 SigV4
utilities for correctness; `postgres-statement-timeout.test.ts` and the other suites beyond their titles;
`tenant.utilities.ts`; the change-set and soft-delete repositories; the statement-cancellation path through the
driver's `run` wrapper; what `typeorm`'s `synchronize()` does to a partial unique index under `'synchronize'`.
