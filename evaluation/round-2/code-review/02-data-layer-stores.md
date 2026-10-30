# Data layer: data sources, where conversion, transactions, migrations, backup — code review

Extracted from the evaluation chapter [02-data-layer-stores.md](../02-data-layer-stores.md); `S` ids
refer to its findings. These are shape, duplication and style, with the evaluation's severity scale.
Cross-cutting: [09-architecture-and-code-quality.md](./09-architecture-and-code-quality.md).

### Q1. `PostgresDataSource` is five concerns in 2545 lines — MINOR
`postgres-typeorm-data-source.model.ts` holds child-process management for `pg_dump`/`pg_restore`/`psql`
(`:125-325, 1407-1782`), trigram probing and index ownership (`:852-1133`), key and check reconciliation
(`:2042-2290`), upsert SQL (`:1214-1300`) and column mapping (`:2306-2544`). `CODE_STYLE.md` asks for related
functions grouped into utility classes; `PostgresValueConversionUtilities` shows the shape, and
`PostgresBackupUtilities` and a `PostgresKeyReconciliation` class would halve the file. The base class
(`typeorm-base-data-source.model.ts`, 1777 lines) mixes upsert orchestration with migration helpers the same way.

> **Closed 2026-10-29** (user's decision: backups and error mapping out). Typeorm going had already
> taken the base class, and the schema manager, converter and query builder carry the reconciliation,
> upsert SQL and column mapping; `postgres-data-source.model.ts` was 2192 lines and is 1494.
> `PostgresBackupRunner` (`postgres-backup.runner.ts`) holds the configuration check, the dump and the
> restore with the client environment and arguments and the order kept tables go back in, built with
> the data source and a getter for its schema; `PostgresRestoreSqlUtilities` the statements around
> the dump's, `PostgresClientToolUtilities` the child-process helpers. `PostgresStatementErrorUtilities`
> resolves a failed statement by SQL state and constraint name, with the lookups on the schema manager
> (`findDeclaredUnique` answering for the primary key too, and `findDeclaredCheck`, moved from the
> data source). The data source keeps `restoreBackup`'s lock and migrations and delegates the rest.
> No behavior changed by design; typecheck and the structural suites are green here, and the
> container-backed backup, unique, check, serialization and json value suites are the user's to run.

### Q2. Two implementations of the trigram index — MINOR
`reconcileTrigramIndexes` builds them non-concurrently under `'synchronize'` (`:1049-1069`) and
`resolveDeclaredKeys` builds them concurrently under `'migrations'` (`:2210-2219`), with `indicesOwnedBySelf`
(`:1528-1534`) declaring them to the orm a third time. One owner per schema object was the point of 01 §M38.

> **Closed 2026-10-29, by the move off typeorm.** The trigram index has one definition,
> `PostgresSchemaManager.resolveDeclaredKeys`, beside the uniques and indexes, with a concurrent build
> for a table holding rows and a plain one for a table this boot's migrations created. Nothing else
> declares it; the type change and the rename only drop or rename it by its name.

### Q3. Error classification by prose — MINOR
S4 in the evaluation chapter; architecturally, a dialect's error mapping belongs on SQLSTATE and constraint name alone. The same file
reaches into the driver's connection object through a cast (`ConnectedQueryRunner`, `:113-123, 729`) to find the
backend pid; the comment owns the risk, and the typeorm range is `^0.3.29`, so a minor release can move it.

> **Closed 2026-10-29, by the move off typeorm.** A failed statement is resolved by its SQL state and
> its constraint name alone (`PostgresStatementErrorUtilities`, split out under Q1); the message is
> read only to quote the unreadable value back. The backend pid and secret key are fields of the `pg`
> connection, declared in the narrowed `PgClient` type, so no cast reaches into a driver internal.

### Q4. Placeholder renumbering by regex — MINOR
`appendParams` (`:1296-1300`) renumbers `$N` in a subselect's text with `replaceAll(/\$(\d+)/g)`. It holds
because every caller value is bound, so no `$1` can appear in the text; it stops holding the day an identifier
or a literal reaches that SQL. A comment naming that invariant, or building the subselect with an offset, would
be cheaper than finding it later.

> **Closed 2026-10-29, as a defect.** `appendParams` went with typeorm, but the same rewrite lived on in
> `PostgresDataSource.bindRun`: the schema manager's positional statements were turned into named ones
> by `replaceAll(/\$(\d+)/g)` only to be turned back by `runStatement`. The day the item predicted
> had come: a string default is a literal inside the DDL (`literalToSql`), so
> `@Property.string({ default: 'costs $1' })` declared the column with the default `'costs :zi_run_0'`.
> `runStatement` now converts once and hands a private `runPositional` the statement, and `bindRun`
> hands its positional statements to `runPositional` as they are; no regex is left on the way to the
> driver. Test, in the container-backed `postgres-data-source.statement-text.test.ts` (yours to
> run, and the red against the old `bindRun` was not observed here): the stored column default keeps
> `'costs $1'`. The test helper `queryPostgres` still rewrites `$N` the same way; what it is handed is
> written by the test, so it stays.

### Q5. Backup errors are private classes in the service file — MINOR
`backup.service.ts:51-188` declares `InitBackupServiceError`, `BackupTransportNotFoundError`,
`UnreadableBackupError`, `IncompleteBackupError`, `CorruptBackupError`, `BackupStoppedError`,
`RestoreStoppedError` and `RestoreNotUndoneError` without exporting them. `CODE_STYLE.md` wants one exported
concept per `.error.ts` file; for an application it means a restore failure can only be told apart by `name`,
and `RestoreNotUndoneError.snapshotPaths`, the one field an operator needs, is unreachable by type.

> **Closed 2026-10-29.** The eight errors are `.error.ts` files beside `backup-failed.error.ts`,
> exported from `zibri` with a Key exports row each in `backup.md`. `RestoreNotUndoneError` takes
> `NotUndoneResource[]` (name and snapshot path, public) rather than the service's private staged
> resource, so `snapshotPaths` is reachable by type. The backup suites hold the messages.

### Q6. Valkey lock namespace and script payloads — MINOR
S12 for the namespace. `applyGuardedValKeyWrites` serializes every write of a transaction into one JSON `ARGV`
(`apply-guarded-val-key-writes.function.ts:65-70`); a transaction of a large batch becomes one multi-megabyte
script argument, where the unguarded path already streams a `Batch`. Guarding only the keys list and queueing
the writes as a batch behind a `WATCH`-style check would keep the two paths one shape.

> **Narrowed 2026-10-29.** The namespace closed with S12. The payload is measured before anything is
> decided (user's decision): `apply-guarded-val-key-writes.benchmark.test.ts` commits the same rows
> of ten fields, 10, 1000 and 10 000 of them, through the guard script and as an atomic batch, and
> prints how many times the batch the script takes. The `WATCH` alternative is not measured: glide
> multiplexes one connection, so it would need one of its own, and it costs at least two round trips
> more. Open until the user's run of `test:benchmark` decides between keeping the script and passing
> the writes as flat arguments.

> **Closed 2026-10-29** (user's decision: one path). The premise did not hold: the user's run measured
> the script at 0.73 times the batch for 10 rows, 0.50 for 1000 and 0.51 for 10 000. So every commit
> of a `ValKeyTransaction` goes through the script now, with nothing guarded when nothing is, and the
> atomic batch path is gone; the two commits are one shape, which is what the item asked for. The
> driver's writes outside a transaction stay a non-atomic pipeline, which promises nothing a script
> would add. The benchmark stays as the comparison; the valkey transaction suites are the user's to run.

### Q7. Where-filter parity is in good shape — positive
Every `.cases.ts` under `data-source/` has a `postgres-valkey` (or per-store) runner except `large-batches`,
which runs under `heavy`; the in-memory driver uses the same `WhereFilterEvaluator` as valkey
(`in-memory.repository-driver.ts:39-50`), so there are two evaluators, not three. The one place the evaluator
is more permissive than postgres by construction, a filter on a property without metadata
(`where-filter.evaluator.ts:330-333` returns rather than refusing; `typeorm-where-filter.converter.ts:285-293`
throws), is unreachable through the typed `Where<T>` and only matters for filters built from data.
