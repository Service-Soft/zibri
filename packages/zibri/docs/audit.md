# Audit trail
The audit trail records what happens around security: logins, refused routes, password resets, roles given and taken, and the rest [auth lists](./auth.md#what-gets-recorded). Every event is stored as an `AuditEntry`, and logged as well. The trail is tamper-evident: it tells an entry that was changed, removed or slipped in past your application, such as by someone with access to the database.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `AuditServiceInterface` | interface | `record` an event, `flush` to wait until everything recorded is stored, `deleteExpiredEntries` to remove what is past the retention, `writeCheckpoints` to seal the hours that ended, `resolveVerification` to check the trail of a [tenant](./glossary.md#tenant) |
| `AuditService` | class | The default implementation |
| `ZIBRI_DI_TOKENS.AUDIT_SERVICE` | DI token | Injects `AuditServiceInterface` |
| `AuditEntry` | entity | One entry of the trail, with a keyed hash of what it holds |
| `AuditCheckpoint` | entity | Seals the entries one tenant stored in a span of time: how many there are, and a digest of their hashes |
| `ChainedAuditEntry` | entity | One entry of a trail kept as a chain, see [keeping the trail as a chain](#keeping-the-trail-as-a-chain) |
| `BaseAuditEntry` | class | What both kinds of entry hold |
| `AuditIntegrity` | type | How the trail tells a changed entry: `'checkpoints'` or `'chain'` |
| `ZIBRI_DI_TOKENS.AUDIT_INTEGRITY` | DI token | How the trail tells a changed entry. Defaults to `'checkpoints'` |
| `AuditVerification`, `IntactAuditTrail`, `BrokenAuditTrail` | type, type, type | What checking the trail of a tenant found |
| `AuditCheckpointCronJob` | cron job | Seals the entries of the hour that ended, hourly. Registered for you with `'checkpoints'` |
| `RetentionInMs` | type | How long something is kept, in milliseconds, or `'forever'`. The type of `AUDIT_RETENTION_IN_MS` and the other retention tokens |
| `AuditCollapse` | enum | How an entry stands for refusals past the budget |
| `AuditEvent` | type | What `record` takes: an action, an outcome, and who it was about |
| `AuditAction`, `AuditOutcome`, `AuditReason` | enum | The closed sets an `AuditEvent` is built from |
| `AuditCleanupCronJob` | cron job | Deletes the entries older than the retention, daily |
| `ZIBRI_DI_TOKENS.AUDIT_RETENTION_IN_MS` | DI token | How long an entry is kept: a number of milliseconds, or `'forever'`. Required |
| `ZIBRI_DI_TOKENS.AUDIT_MAX_REFUSALS_PER_MINUTE` | DI token | How many refusals a minute are stored as entries of their own, on each instance. Defaults to 1000 |

## Setting it up
Declare the entities under [requirements](#requirements) on your data source, and say how long an entry is kept:

```ts
// src/providers.ts
import { defineProvider, Ms, ZIBRI_DI_TOKENS } from 'zibri';

defineProvider({
    token: ZIBRI_DI_TOKENS.AUDIT_RETENTION_IN_MS,
    useValue: Ms.DAY * 365
});
```

An entry is deleted together with the checkpoint that seals it, once that checkpoint's span ended longer ago than the retention.

## Recording an event
The events [auth lists](./auth.md#what-gets-recorded) are recorded for you. Record one of your own through the audit service:

```ts
// src/services/failed-login.function.ts
import { AuditAction, AuditOutcome, AuditReason, AuditServiceInterface } from 'zibri';

export function recordFailedLogin(auditService: AuditServiceInterface): void {
    auditService.record({
        action: AuditAction.LOGIN,
        outcome: AuditOutcome.FAILURE,
        reason: AuditReason.REFUSED,
        subject: 'ada@example.com'
    });
}
```

`record` returns at once and is stored right after. The entry carries the [tenant](./tenancy.md) the event happened in, and the client's address and the trace of the request it was recorded in. The event is also [logged](./logging.md#security-events), at `info` when it succeeded and `warn` when it did not.

`action`, `outcome` and `reason` are closed sets, for a detection rule to key on.

## Reading the trail
```ts
// src/services/refused-logins.function.ts
import { AuditAction, AuditEntry, AuditOutcome, inject, Repository, ZIBRI_DI_TOKENS } from 'zibri';

export async function findRefusedLogins(entries: Repository<AuditEntry>, subject: string): Promise<AuditEntry[]> {
    await inject(ZIBRI_DI_TOKENS.AUDIT_SERVICE).flush();
    return await entries.findAll({ where: { action: AuditAction.LOGIN, outcome: AuditOutcome.FAILURE, subject } });
}
```

`flush` waits until everything recorded so far is stored. Call it before you read what you just recorded, such as in a test.

## How much is stored
Every success is an entry of its own. So is every refusal, up to `AUDIT_MAX_REFUSALS_PER_MINUTE` a minute on each instance. Past that, the refusals of one kind become one entry, stored when the minute ends. Refusals are of one kind when they share the tenant, action, reason, subject, user, role, scopes and client address. `count` says how many refusals it stands for, `occurredAt` and `lastOccurredAt` when the first and the last happened, and `collapsed` is `per-kind`:

```ts
// src/services/attempts.function.ts
import { AuditEntry } from 'zibri';

export function countAttempts(entries: AuditEntry[]): number {
    return entries.reduce((sum, e) => sum + e.count, 0);
}
```

Each minute keeps at most 100 kinds apart. The refusals beyond them are counted in one entry per action and reason, of no tenant, whose `collapsed` is `past-kinds`.

An entry the data source does not take is kept and stored again later. `audit_entries_pending` in the [metrics](./metrics.md) says how many are waiting, and shutdown stores what is left.

## Telling whether the trail was changed
Each entry carries `mac`, a keyed hash of everything else it holds. The key is a [signing key](./encryption-and-hashing.md#keeping-a-signing-key), so writing a hash that fits takes more than access to the database. Every hour, `AuditCheckpointCronJob` seals what each tenant stored since its last checkpoint in an `AuditCheckpoint`: how many entries there are, and a digest of their hashes. The checkpoints of each tenant form a [hash chain](./glossary.md#hash-chain), and each starts where the one before it ends.

Check the trail of a tenant, or of the events of no tenant with `undefined`:

```ts
// src/services/audit-check.function.ts
import { AuditVerification, inject, ZIBRI_DI_TOKENS } from 'zibri';

export async function checkAuditTrail(tenantId: string): Promise<AuditVerification> {
    return await inject(ZIBRI_DI_TOKENS.AUDIT_SERVICE).resolveVerification(tenantId);
}
```

A trail that holds answers `{ intact: true, newestSequence, newestHash, sealedUntil }`. One that does not answers `{ intact: false, reason }`, naming the first entry, span or checkpoint that does not hold: an entry that was changed, a span whose entries are not the ones it sealed, or a checkpoint that was changed or removed.

Each checkpoint is logged at `info` as well, with its tenant, `chainSequence` and `chainHash` under `metadata.auditCheckpoint`. Ship the log to a store outside the data source, such as with [JSON lines for a log collector](./logging.md#writing-json-lines-for-a-log-collector). The newest checkpoint there is what tells the trail apart from one whose newest entries and checkpoints were removed together.

> [!NOTE]
> An entry is sealed at the first checkpoint after the hour it was stored in, five minutes into the next hour. Removing it before then goes unnoticed. `sealedUntil` says where the sealed part of the trail ends.

## Keeping the trail as a chain
Kept as a chain, the entries of each tenant form a [hash chain](./glossary.md#hash-chain) of their own, see [tamper-evident tables](./tamper-evident-tables.md). Provide `ZIBRI_DI_TOKENS.AUDIT_INTEGRITY` and declare `ChainedAuditEntry` in place of `AuditEntry` and `AuditCheckpoint`:

```ts
// src/providers.ts
import { defineProvider, ZIBRI_DI_TOKENS } from 'zibri';

defineProvider({ token: ZIBRI_DI_TOKENS.AUDIT_INTEGRITY, useValue: 'chain' });
```

| Use | When |
|---|---|
| `'checkpoints'` | Storing an entry costs no more than storing any row. A removed entry is told once its hour is sealed |
| `'chain'` | A removed entry is told at once. Each write first reads where the chains of its tenants end |

Read the entries through the repository of `ChainedAuditEntry`. `resolveVerification` checks the chain of the tenant, and its `sealedUntil` is `undefined`. Switching an application that holds entries starts a new trail: the entries stored before stay in the table of the other kind.

## Keeping the trail elsewhere
Provide your own implementation to send the events somewhere else as well, such as a SIEM:

```ts
// src/providers.ts
import { defineProvider, ZIBRI_DI_TOKENS } from 'zibri';

import { SiemAuditService } from './services/siem-audit.service';

defineProvider({ token: ZIBRI_DI_TOKENS.AUDIT_SERVICE, useClass: SiemAuditService });
```

Every event goes through it, your own and those recorded for you.

## Requirements
Your data source declares these entities:

| Entity | Needed when |
|---|---|
| `AuditEntry`, `AuditCheckpoint` | `AUDIT_INTEGRITY` is `'checkpoints'`, the default |
| `ChainedAuditEntry` | `AUDIT_INTEGRITY` is `'chain'` |
| `ChainAnchor`, `SigningKey` | Every application |

How large each table grows, and what deletes its rows, is in [framework tables](./framework-tables.md).

## See also
- [Auth](./auth.md#what-gets-recorded) — the events the framework records
- [Logging](./logging.md) — the log line written for every event
- [Metrics](./metrics.md) — `audit_entries_pending`
- [Tenancy](./tenancy.md) — the tenant an entry belongs to
- [Tamper-evident tables](./tamper-evident-tables.md) — append-only and chained entities of your own