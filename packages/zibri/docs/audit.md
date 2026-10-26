# Audit trail
The audit trail records what happens around security: logins, refused routes, password resets, roles given and taken, and the rest [auth lists](./auth.md#what-gets-recorded). Every event is stored as an `AuditEntry`, and logged as well.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `AuditServiceInterface` | interface | `record` an event, `flush` to wait until everything recorded is stored, `deleteExpiredEntries` to remove what is past the retention |
| `AuditService` | class | The default implementation |
| `ZIBRI_DI_TOKENS.AUDIT_SERVICE` | DI token | Injects `AuditServiceInterface` |
| `AuditEntry` | entity | One entry of the trail |
| `RetentionInMs` | type | How long something is kept, in milliseconds, or `'forever'`. The type of `AUDIT_RETENTION_IN_MS` and the other retention tokens |
| `AuditCollapse` | enum | How an entry stands for refusals past the budget |
| `AuditEvent` | type | What `record` takes: an action, an outcome, and who it was about |
| `AuditAction`, `AuditOutcome`, `AuditReason` | enum | The closed sets an `AuditEvent` is built from |
| `AuditCleanupCronJob` | cron job | Deletes the entries older than the retention, daily |
| `ZIBRI_DI_TOKENS.AUDIT_RETENTION_IN_MS` | DI token | How long an entry is kept: a number of milliseconds, or `'forever'`. Required |
| `ZIBRI_DI_TOKENS.AUDIT_MAX_REFUSALS_PER_MINUTE` | DI token | How many refusals a minute are stored as entries of their own, on each instance. Defaults to 1000 |

## Setting it up
Declare `AuditEntry` on your data source, and say how long an entry is kept:

```ts
// src/providers.ts
import { defineProvider, Ms, ZIBRI_DI_TOKENS } from 'zibri';

defineProvider({
    token: ZIBRI_DI_TOKENS.AUDIT_RETENTION_IN_MS,
    useValue: Ms.DAY * 365
});
```

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
| `AuditEntry` | Every application |

How large each table grows, and what deletes its rows, is in [framework tables](./framework-tables.md).

## See also
- [Auth](./auth.md#what-gets-recorded) — the events the framework records
- [Logging](./logging.md) — the log line written for every event
- [Metrics](./metrics.md) — `audit_entries_pending`
- [Tenancy](./tenancy.md) — the tenant an entry belongs to