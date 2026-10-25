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

### Q2. Two implementations of the trigram index — MINOR
`reconcileTrigramIndexes` builds them non-concurrently under `'synchronize'` (`:1049-1069`) and
`resolveDeclaredKeys` builds them concurrently under `'migrations'` (`:2210-2219`), with `indicesOwnedBySelf`
(`:1528-1534`) declaring them to the orm a third time. One owner per schema object was the point of 01 §M38.

### Q3. Error classification by prose — MINOR
S4 in the evaluation chapter; architecturally, a dialect's error mapping belongs on SQLSTATE and constraint name alone. The same file
reaches into the driver's connection object through a cast (`ConnectedQueryRunner`, `:113-123, 729`) to find the
backend pid; the comment owns the risk, and the typeorm range is `^0.3.29`, so a minor release can move it.

### Q4. Placeholder renumbering by regex — MINOR
`appendParams` (`:1296-1300`) renumbers `$N` in a subselect's text with `replaceAll(/\$(\d+)/g)`. It holds
because every caller value is bound, so no `$1` can appear in the text; it stops holding the day an identifier
or a literal reaches that SQL. A comment naming that invariant, or building the subselect with an offset, would
be cheaper than finding it later.

### Q5. Backup errors are private classes in the service file — MINOR
`backup.service.ts:51-188` declares `InitBackupServiceError`, `BackupTransportNotFoundError`,
`UnreadableBackupError`, `IncompleteBackupError`, `CorruptBackupError`, `BackupStoppedError`,
`RestoreStoppedError` and `RestoreNotUndoneError` without exporting them. `CODE_STYLE.md` wants one exported
concept per `.error.ts` file; for an application it means a restore failure can only be told apart by `name`,
and `RestoreNotUndoneError.snapshotPaths`, the one field an operator needs, is unreachable by type.

### Q6. Valkey lock namespace and script payloads — MINOR
S12 for the namespace. `applyGuardedValKeyWrites` serializes every write of a transaction into one JSON `ARGV`
(`apply-guarded-val-key-writes.function.ts:65-70`); a transaction of a large batch becomes one multi-megabyte
script argument, where the unguarded path already streams a `Batch`. Guarding only the keys list and queueing
the writes as a batch behind a `WATCH`-style check would keep the two paths one shape.

### Q7. Where-filter parity is in good shape — positive
Every `.cases.ts` under `data-source/` has a `postgres-valkey` (or per-store) runner except `large-batches`,
which runs under `heavy`; the in-memory driver uses the same `WhereFilterEvaluator` as valkey
(`in-memory.repository-driver.ts:39-50`), so there are two evaluators, not three. The one place the evaluator
is more permissive than postgres by construction, a filter on a property without metadata
(`where-filter.evaluator.ts:330-333` returns rather than refusing; `typeorm-where-filter.converter.ts:285-293`
throws), is unreachable through the typed `Where<T>` and only matters for filters built from data.
