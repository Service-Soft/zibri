---
keywords: [integrity, hash chain, immutable, append only, tamper proof]
---

# Tamper-evident tables
An append-only entity keeps its rows as they were created: the repository refuses to update or delete them, and removes old ones only when you prune them. A chained entity goes further. The rows of each [tenant](../glossary.md#tenant) form a [hash chain](../glossary.md#hash-chain), which tells a row that was changed, removed or slipped in past your application, such as by someone with access to the database. Use them for records that are evidence, such as the history of a task or approvals.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `BaseChainedEntity` | class | The base of a chained entity, holding `chainSequence` and `chainHash`, which the repository fills in |
| `ChainServiceInterface`, `ZIBRI_DI_TOKENS.CHAIN_SERVICE` | interface, DI token | Links the rows of the chained entities, checks a chain, and prunes chains from their old end |
| `ChainService` | class | The default implementation. Replaceable through `ZIBRI_DI_TOKENS.CHAIN_SERVICE` |
| `ChainVerification`, `IntactChain`, `BrokenChain` | type, type, type | What checking a chain found: where an intact chain ends, or the first row that does not hold and why |
| `ChainLink` | type | The `chainSequence` and `chainHash` of a row about to be created |
| `ChainAnchor` | entity | Where a chain starts once its oldest rows were pruned |

## Keeping rows as they were created
Declare the entity with `appendOnly: true`:

```ts
// src/models/task-view.model.ts
import { BaseEntity, Entity, Property } from 'zibri';

@Entity({ appendOnly: true })
export class TaskView extends BaseEntity {
    @Property.string({ format: 'uuid' })
    tenantId!: string;

    @Property.string({ format: 'uuid' })
    taskId!: string;

    @Property.date()
    viewedAt!: Date;
}
```

`create` and `createAll` work as for any entity. `updateById`, `updateAll`, `upsert`, `upsertAll`, `deleteById` and `deleteAll` throw an `InternalError`.

## Chaining the rows of each tenant
Declare the entity with `chained: true`, and extend `BaseChainedEntity`:

```ts
// src/models/task-activity.model.ts
import { BaseChainedEntity, Entity, Property } from 'zibri';

@Entity({ chained: true })
export class TaskActivity extends BaseChainedEntity {
    @Property.string({ format: 'uuid' })
    tenantId!: string;

    @Property.string({ format: 'uuid' })
    taskId!: string;

    @Property.string()
    change!: string;

    @Property.date()
    changedAt!: Date;
}
```

A chained entity is append-only. Each tenant's rows form one chain, and the rows of no tenant form one of their own. When a row is created, the repository gives it the next `chainSequence` of its chain and a `chainHash`: a keyed hash of its content and of the hash of the row before it. The key is a `SigningKey`, kept encrypted under the [master key](../glossary.md#master-key), see [encryption and hashing](./encryption-and-hashing.md#keeping-a-signing-key).

Rows written together land together. Each write reads where the chains it reaches end. Two writers adding to one chain at once both succeed: the second links its rows after those of the first.

A chained entity declares no encrypted or hashed property, is kept in one data source, and takes no time of the data source such as `dataSourceNow()`. The decorator and the write refuse each of them.

## Checking a chain
`resolveChainVerification` reads the chain of a tenant, or of the rows of no tenant with `undefined`, and checks every row against its hash:

```ts
// src/services/task-activity-check.function.ts
import { ChainVerification, inject, ZIBRI_DI_TOKENS } from 'zibri';

import { TaskActivity } from '../models/task-activity.model';

export async function checkTaskActivity(tenantId: string): Promise<ChainVerification> {
    return await inject(ZIBRI_DI_TOKENS.CHAIN_SERVICE).resolveChainVerification(TaskActivity, tenantId);
}
```

An intact chain answers `{ intact: true, newestSequence, newestHash }`. A broken one answers `{ intact: false, brokenAtSequence, reason }`, with the first row that does not hold: one that was changed or slipped in, or the first after rows that are missing.

> [!NOTE]
> A chain alone cannot tell that its newest rows were removed. Keep `newestSequence` and `newestHash` outside the data source, such as in your logs, and compare them with the next check.

> [!NOTE]
> Someone holding both the database and the master key can write a new chain that holds.

## Pruning old rows
`prune` removes the rows of an append-only or chained entity that a filter matches, of every tenant:

```ts
// src/services/old-task-views.function.ts
import { Ms, Repository } from 'zibri';

import { TaskView } from '../models/task-view.model';

export async function deleteOldTaskViews(views: Repository<TaskView>): Promise<number> {
    return await views.prune({ viewedAt: { before: new Date(Date.now() - (Ms.DAY * 90)) } });
}
```

For a chained entity, `prune` removes rows from the old end of each chain only, up to the first row the filter does not match. A `ChainAnchor` records where the chain starts from then on, so the check tells pruned rows apart from removed ones. The filter names neither the tenant nor `chainSequence`. `prune` resolves how many rows it removed, and throws for an entity that is neither append-only nor chained.

## Requirements
Your data source declares these entities:

| Entity | Needed when |
|---|---|
| `ChainAnchor` | An entity is declared with `chained: true`. The [audit trail](./audit.md) declares one |
| `SigningKey` | Every application |

How large each table grows, and what deletes its rows, is in [framework tables](./framework-tables.md).

## See also
- [Audit trail](./audit.md) — the trail of security events, kept tamper-evident
- [Data source](./data-source.md) — declaring entities and their repositories
- [Encryption and hashing](./encryption-and-hashing.md#keeping-a-signing-key) — the signing key
