---
keywords: [entity listener, entity subscriber, triggers, database triggers, before write, after write, after commit, read only rows, invariants]
---

# Observing writes
A write observer sees every write to the rows of an entity, however a repository gets to it: `create`, `updateById`, `updateAll`, `upsert`, `deleteById` and every other method that writes. It can refuse a write before anything is written, write rows that belong with it in its transaction, and follow it once it is committed. Use it for a rule that has to hold for every row of an entity, such as a row that stays unchanged after a date, where checking it in one service would leave out the writes of every other.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `EntityWriteObserverRegistry` | class | Registers an observer of every write to an entity, from `onAppInit` or `afterAppInit` |
| `EntityWriteObserver` | type | An observer: the `properties` it reads of the rows, and `validateWrite`, `completeWrite`, `handleWritten`, `followsBefore` and `requiresTransaction`, each optional |
| `ObservedWrite` | type | A write about to be made, as `validateWrite` is handed it: its `operation`, `data` and `transaction`, and `resolveRowWrites` |
| `MadeWrite` | type | A write once it is made, as `completeWrite` is handed it: the rows `before` and `after`, and its `transaction` |
| `WrittenRows` | type | A committed write, as `handleWritten` is handed it: the rows `before` and `after` |
| `EntityWrite` | type | A write as its `operation` and its `data`, as `followsBefore` and `requiresTransaction` are handed it |
| `RowWrite` | type | What a write does to one row: the `data` written to it and the row as it is, `existing` |
| `WriteOperation` | type | Which write it is: `'save'`, `'insert'`, `'updateEach'`, `'updateAll'`, `'upsert'` or `'remove'` |
| `RestoreContextUtilities` | class | Tells the writes of a restore of a backup apart with `isRestoring`, see [when an observer runs](#when-an-observer-runs) |

## Registering an observer
Implement `EntityWriteObserver` in a service and register it for an entity in `onAppInit` or `afterAppInit`, see [choosing which hook to implement](../application/application-lifecycle.md#choosing-which-hook-to-implement):

```ts
// src/observers/task.write-observer.ts
import { EntityWriteObserver, EntityWriteObserverRegistry, inject, Injectable, OnAppInit } from 'zibri';

import { Task } from '../models';

@Injectable()
export class TaskWriteObserver implements EntityWriteObserver, OnAppInit {
    readonly properties: string[] = ['title', 'dueAt'];

    onAppInit(): void {
        inject(EntityWriteObserverRegistry).register(Task, this);
    }
}
```

Registering once `afterAppInit` has finished throws an `InternalError`, since writes made before would not have reached the observer. An entity can have several observers, which see each write in the order they were registered.

## What an observer sees
Each write is one of these operations, with what it writes as `data`, row by row:

| Operation | What it writes |
|---|---|
| `'insert'` | Rows it creates, such as by `create` and `createAll` |
| `'updateEach'` | Rows it updates one by one, each read first |
| `'updateAll'` | Every row a filter matches, at once |
| `'upsert'` | Rows it creates, or updates when they are there already, such as by `upsert`. Its `data` holds what each row is created with and what it is set to |
| `'save'` | Rows it creates or updates by their ids as they are stored, such as by restoring a backup |
| `'remove'` | Rows it removes, such as by `deleteById` and `deleteAll`. Its `data` is empty |

`resolveRowWrites` of the write reads what it does to each row: the `data` written to it, and the row as it is, `existing`, undefined for a row it creates. The rows are read once per write, however many observers ask, and only when one asks. Of an `'updateAll'` and a `'remove'`, a row is read as the `properties` the observers of the entity name, not as a whole row.

Once a write is made, the rows are `before` and `after` it. `after` holds the rows as they are now, with the ids a create gave them. `before` holds the rows as they were for a write whose `followsBefore` answers true, or whose rows a check read already, and is empty otherwise.

## When an observer runs
| Method | When it runs | What it throws |
|---|---|---|
| `validateWrite` | Before anything is written, in the transaction of the write | Refuses the write |
| `completeWrite` | Once the write is made, in its transaction, before it is committed | Fails the write, which its transaction rolls back |
| `handleWritten` | Once the write is committed, or once it is made when it runs in no transaction | Is logged, since the write stands |

A write rolled back is not followed by `handleWritten`.

A [restore of a backup](./backup.md#creating-and-restoring-backups) writes the rows back as they were stored, through the observers like any other write. `RestoreContextUtilities.isRestoring()` is true while a restore runs the code, so an observer that writes or refuses on behalf of a row, such as one posting an invoice into the books, leaves the rows of a restore as they are. The observers of Zibri and its plugins do.

## Keeping a row unchanged after a date
`validateWrite` refuses a write by throwing. This observer keeps a task unchanged once its due date has passed, whether a controller, a cron job or a migration writes it:

```ts
// src/observers/task-due.write-observer.ts
import { $ts, ConflictError, EntityWriteObserver, EntityWriteObserverRegistry, inject, Injectable, ObservedWrite, OnAppInit } from 'zibri';

import { Task } from '../models';

@Injectable()
export class TaskDueWriteObserver implements EntityWriteObserver, OnAppInit {
    readonly properties: string[] = ['title', 'dueAt'];

    onAppInit(): void {
        inject(EntityWriteObserverRegistry).register(Task, this);
    }

    async validateWrite(write: ObservedWrite): Promise<void> {
        if (write.operation === 'insert') {
            return;
        }
        const now: number = Date.now();
        const overdue: object | undefined = (await write.resolveRowWrites())
            .flatMap(rowWrite => rowWrite.existing ?? [])
            .find(row => {
                const dueAt: unknown = Reflect.get(row, 'dueAt');
                return dueAt instanceof Date && dueAt.getTime() < now;
            });
        if (overdue != undefined) {
            const title: string = String(Reflect.get(overdue, 'title'));
            throw new ConflictError($ts`The task ${title} is past its due date, and cannot be changed or deleted.`);
        }
    }
}
```

Every write of a repository to an overdue task is refused with a `409`. A create passes, since there is no row yet. The [invoicing plugin](../plugins/invoicing-plugin.md#keeping-issued-invoices-unchanged) keeps issued invoices unchanged the same way.

## Writing rows along with a write
`completeWrite` writes the rows that belong with the rows a write made, in its transaction, with their ids. Declare the writes it completes with `requiresTransaction`. A write without a transaction that an observer requires one for runs, with every observer of the entity, in a transaction of the data source of the entity, started for it and committed once the write is complete. Every other write runs as it is called, and a write with a transaction runs in that one.

This observer opens every task with a comment, so a task and its first comment are created together or not at all:

```ts
// src/observers/task-opening.write-observer.ts
import { EntityWrite, EntityWriteObserver, EntityWriteObserverRegistry, inject, Injectable, MadeWrite, OnAppInit, Repository, repositoryTokenFor } from 'zibri';

import { Comment, Task } from '../models';

@Injectable()
export class TaskOpeningWriteObserver implements EntityWriteObserver, OnAppInit {
    readonly properties: string[] = [];

    onAppInit(): void {
        inject(EntityWriteObserverRegistry).register(Task, this);
    }

    requiresTransaction(write: EntityWrite): boolean {
        return write.operation === 'insert';
    }

    async completeWrite(write: MadeWrite): Promise<void> {
        if (write.operation !== 'insert') {
            return;
        }
        const comments: Repository<Comment> = inject(repositoryTokenFor(Comment));
        for (const task of write.after) {
            await comments.create({ taskId: String(Reflect.get(task, 'id')), text: 'Opened' }, { transaction: write.transaction });
        }
    }
}
```

With `tenantsWithoutBooks` set to `'never'`, the [bookkeeping plugin](../plugins/bookkeeping-plugin.md#choosing-what-a-tenant-without-books-does) creates the settings of the books of every [tenant](../glossary.md#tenant) this way, and a tenant whose settings cannot be created is not created either.

> [!NOTE]
> The transaction started for a write is one of the data source of its entity. A row an observer writes into another data source is in none of it, and is kept when the write fails. An observer writing rows of another entity validates at startup that its entity is in the data source of the observed one, such as in the `validate` of its [plugin](../application/plugin.md#writing-a-custom-plugin).

## See also
- [Data sources](./data-source.md) — the repositories whose writes are observed, and transactions
- [Application lifecycle](../application/application-lifecycle.md) — the hooks an observer is registered in
- [Issuing invoices](../plugins/invoicing-plugin.md) — issued invoices kept unchanged and posted by observers
- [Keeping the books](../plugins/bookkeeping-plugin.md) — recorded expenses kept unchanged, and tenants created with their books
- [Errors](../application/error-handling.md) — the errors a check throws, such as `ConflictError`
