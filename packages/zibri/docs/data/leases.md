---
keywords: [locks, locking, mutex, distributed lock, leader election]
---

# Leases
A [lease](../glossary.md#lease) is the right to do a piece of work that no other instance may do at the same time. Zibri's
cron elections, event claims, mail claims and named locks are all leases, and they all go through
one service, so they behave the same way.

[Replication](./replication.md) shows what the framework uses leases for across instances.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `Lease` | entity | Where a grant lives |
| `LeaseOptions` | type | What to take: `key`, `leaseInMs`, the two axes below, and `heldUntil` |
| `LeaseSetOptions` | type | The same without `key` or `mode`, for taking several at once |
| `LeaseAcquisitionMode` | type | `'wait'` or `'skip'`: what to do when somebody else holds it |
| `LeaseCompletion` | type | `'release'`, `'retain'` or `'retainOnError'`: what happens to the grant when the work is over |
| `HeldLease` | type | A grant that has been taken: its `name`, and how to `renew` and `release` it |
| `KeptGrant` | type | A grant `keepAlive` renews until you `release` it, with the `lost` signal that aborts once it is lost |
| `LeaseServiceInterface` | interface | The contract: `withLease` and `withLeases` for the whole cycle, `hold` for a grant you took yourself |
| `LeaseService` | class | Default implementation. Renews while the work runs and drains on shutdown |
| `LeaseAcquisitionTimeoutError` | error | Thrown when a `'wait'` acquisition runs out of patience |
| `LeaseLostError` | error | What the work's signal aborts with once its grant is lost |
| `ZIBRI_DI_TOKENS.LEASE_SERVICE` | DI token | Override to replace the implementation |
| `ZIBRI_DI_TOKENS.LEASE_DRAIN_TIMEOUT_IN_MS` | DI token | How long a shutting down instance waits for held work. Defaults to ten seconds |

## Protecting work with a lease

A grant is handed out for `leaseInMs`. The work it protects can take longer than that: a slow SMTP
server, a batch that grew, a database having a bad minute. The lease service keeps the grant for as
long as the work runs:

1. **it renews the grant while the work runs**, so the work does not have to fit inside `leaseInMs`
2. **it releases the grant when the work ends**, however it ends
3. **a release frees only a grant this holder still owns.** For a grant of your own, that is your
   release's job, see [bringing your own grant](#bringing-your-own-grant)

### When a lease is the wrong tool

A lease covers the time its grant is held. A write made in a transaction becomes visible on
**commit**, and that commit can come after the grant is released. A lease protects **work** that only
one instance should be doing. It does not protect a **value** read and written back inside a
transaction:

| Use | When |
|---|---|
| [`upsert`](./data-source.md#changing-a-value-based-on-what-is-stored) | One value is read and written back |
| [`withLease`](#taking-a-lease) | Only one instance may do a piece of work |
| [`withLease` with `heldUntil`](#holding-a-lease-until-a-transaction-ends) | The work writes in a transaction you were handed |

A write made under a lease in a transaction that is still open when the grant is released is logged
as a warning.

## Taking a lease

`withLease` is the whole cycle in one call: take the grant, run the work while keeping it alive,
hand it back afterwards.

```ts
// src/services/feed-import.service.ts
import { inject, Ms, ZIBRI_DI_TOKENS } from 'zibri';

export async function importFeedOnce(feedId: string, importFeed: (id: string) => Promise<string>): Promise<string | undefined> {
    return await inject(ZIBRI_DI_TOKENS.LEASE_SERVICE).withLease(
        { key: `import:${feedId}`, leaseInMs: Ms.MINUTE },
        async () => await importFeed(feedId)
    );
}
```

It returns `undefined` when another instance holds the grant. On every replica but one, that is the
normal outcome. Prefix your keys: the key space is shared with the framework's own.

## Choosing how it is acquired and released

A lease is set along two axes: how it is acquired, and what happens to it at the end.

**How you acquire**: `mode`, defaulting to `'skip'`:

| | |
|---|---|
| `'skip'` | Give up at once when somebody else holds it. For work that has to happen once and that nobody is waiting on: another replica is already sending the mail, so there is nothing to do |
| `'wait'` | Queue until it is free. For work that has to happen once and that every caller needs the result of. Bounded by `acquireTimeoutInMs`. Reaching that bound **throws** `LeaseAcquisitionTimeoutError` |

**What happens at the end**: `onCompletion`, defaulting to `'release'`:

| | |
|---|---|
| `'release'` | Hand it back, so the work can be done again by whoever needs to. For a grant that only protects work in progress |
| `'retain'` | Keep it, and let it lapse on its own `expiresAt`. For work that must not happen twice: the grant is also the record that it happened |
| `'retainOnError'` | Hand it back when the work returned, keep it when the work threw. For backoff: work that failed against a dead upstream is not retried the instant it fails |

Set `acquireTimeoutInMs` when you use `'wait'`. It defaults to `leaseInMs`, which is how long the work
takes, not how long another caller should queue for it.

A wait inside a request also ends when that request's deadline does, whichever comes first, see
[deadlines](../endpoints/creating-endpoints.md#deadlines).

## Holding a lease until a transaction ends

`heldUntil` names a transaction the work writes in. The grant is then handed back once the work has
returned and that transaction has committed or rolled back, so the next holder sees what the work
wrote:

```ts
// src/services/entry-link.service.ts
import { inject, Ms, Transaction, ZIBRI_DI_TOKENS } from 'zibri';

export async function linkOnce(entryId: string, transaction: Transaction, link: (transaction: Transaction) => Promise<void>): Promise<void> {
    await inject(ZIBRI_DI_TOKENS.LEASE_SERVICE).withLease(
        { key: `link:${entryId}`, leaseInMs: Ms.MINUTE, mode: 'wait', heldUntil: transaction },
        async () => await link(transaction)
    );
}
```

A rollback counts as the work having thrown, for `onCompletion`, and so does a transaction
[rolled back for sitting idle](./data-source.md#using-transactions). With a transaction that has ended
already, the grant is handed back once the work returns, as it is without one.

## Taking several at once

`withLeases` takes as many of the given keys as are free and runs the work over those:

```ts
// src/services/email-batch.service.ts
import { Email, LeaseServiceInterface, Ms } from 'zibri';

export async function sendEachOnce(
    leaseService: LeaseServiceInterface,
    emails: Email[],
    sendMany: (emails: Email[]) => Promise<void>
): Promise<void> {
    const byKey: Map<string, Email> = new Map(emails.map(e => [`email:${e.id}`, e]));

    await leaseService.withLeases(
        [...byKey.keys()],
        { leaseInMs: Ms.MINUTE, onCompletion: 'retainOnError' },
        async taken => await sendMany(taken.flatMap(k => byKey.get(k) ?? []))
    );
}
```

The work is given the keys that were taken. They may be fewer than were asked for, and are never
empty: when every key is already held, it returns `undefined` without running the work at all.

A set is always taken with `'skip'`. Two callers queueing for the same keys in a different order
would wait for each other forever.

## Renewing

The work may run longer than `leaseInMs`. The grant is renewed three times per `leaseInMs` while the
work runs, so it lapses only after two renewals in a row fail. `leaseInMs` decides how long another
instance waits before taking over from one that stopped existing.

A grant lapses by the [clock of the data source](./data-source.md#comparing-with-the-time-of-the-data-source),
which every instance shares. Instances whose own clocks are apart agree on who holds it.

A failed renewal is logged, and the work goes on. A holder whose grant lapsed and was taken over
cannot release its successor's grant.

`withLease`, `withLeases` and `hold` hand the work an `AbortSignal`. It aborts with a
`LeaseLostError` once the grant is lost: taken by another instance, or not renewed for longer than it
lives, after which anybody may take it. Whoever takes the grant over runs the work again from the
start, so stop there. The framework's own thread jobs and event hooks do:

```ts
// src/services/export.service.ts
import { inject, Ms, ZIBRI_DI_TOKENS } from 'zibri';

export async function exportChunks(exportId: string, chunks: Buffer[], upload: (chunk: Buffer) => Promise<void>): Promise<void> {
    await inject(ZIBRI_DI_TOKENS.LEASE_SERVICE).withLease({ key: `export:${exportId}`, leaseInMs: Ms.MINUTE }, async lost => {
        for (const chunk of chunks) {
            if (lost.aborted) {
                return;
            }
            await upload(chunk);
        }
    });
}
```

A grant kept alive with `keepAlive` says the same through `lost` on what it returns.

## Bringing your own grant

`hold` runs the renew-and-release cycle over a `HeldLease` you built yourself, for a grant that lives
somewhere of your own choosing instead of the `Lease` table. Prefer `withLease`.

> [!WARNING]
> The `release` of your own grant deletes it only while this holder still owns it. An unconditional
> release lets a holder whose grant lapsed free the grant that replaced it. From then on every
> caller releases the grant of the one before it, and the exclusion is gone for good.

A release that deletes a claim row only while this holder is still the one recorded on it:

```ts
// src/services/claim.service.ts
import { Lease, Repository } from 'zibri';

export async function releaseClaim(
    claimRepository: Repository<Lease>,
    claimId: string,
    instanceId: string
): Promise<void> {
    await claimRepository.deleteAll({ id: claimId, heldBy: instanceId });
}
```

## Cleaning up

Taking a lease clears the lapsed grant of **the key it asks for**, and nothing else. `Lease`
declares `expiresBy`, so `ExpiredRowsCleanupCronJob` deletes every grant that has expired every hour,
`'retain'` grants included, see [deleting rows once they expire](./data-source.md#deleting-rows-once-they-expire).

## Shutdown

`LeaseService` implements `OnAppShutdown`. It waits for held work before it releases anything:

1. work still holding a grant is waited for, up to `LEASE_DRAIN_TIMEOUT_IN_MS`. It releases its own
   grants as it finishes, and the data sources are still connected because they close in
   `afterAppShutdown`
2. whatever is still held after that is released, so another replica takes the work over at once
   instead of waiting out a full lease

**Step 2 overrides `onCompletion`.** Work that never finished has its grant handed back, `'retain'`
included.

No new grant is taken during shutdown: the HTTP server is drained before any shutdown hook runs, and
cron jobs stop in `beforeAppShutdown`.

Keep `LEASE_DRAIN_TIMEOUT_IN_MS` well inside the application's shutdown timeout, or the hook is cut
off before it releases anything. Open requests are drained before any shutdown hook runs, so
[`HTTP_DRAIN_TIMEOUT_IN_MS`](../application/application-lifecycle.md), plus this one, plus whatever your own hooks
take, has to fit inside the platform's grace period.

## How the framework uses it

The built-in leases differ only in where the grant lives and what happens to it at the end:

| Lease | Grant | Completion |
|---|---|---|
| Scheduled execution | `cron:<job>:<slot>` | `'retain'`: the grant is also the record that this tick ran, so a late replica does not run the job again. It lapses on its own `expiresAt` |
| Queued mail | `email:<id>`, one per mail in the batch | `'retainOnError'`: handed back when the batch is sent or rate limited, kept when a send died halfway so it is not retried at once |
| Event subscriber | `event:<event id>:<subscriber id>` | `'retain'`: kept beside the `EventSubscriberRun` row that records the hook ran |

Mail takes **several grants under one body**, through `withLeases`. Each mail is claimed on its own,
so a send that outlasts the interval between two ticks is not sent again by the next one. The rate
limiter is asked for the whole batch at once, after the claims are settled, so the replicas of a
cluster do not spend the SMTP budget racing for the same mails.

Schema setup is the one exclusion in the framework that is not a lease, since the `Lease` table does
not exist before it. Each data source holds a lock of its own for it, which application code does not
reach.

## Requirements
Your data source declares these entities:

| Entity | Needed when |
|---|---|
| `Lease` | Every application |

How large each table grows, and what deletes its rows, is in [framework tables](./framework-tables.md).

## See also
- [Replication](./replication.md) — what leases do once there is more than one instance
- [Cron](../background-work/cron.md) — how a scheduled execution is claimed, and jobs that outlast their interval
- [Events](../background-work/events.md) — how each attempt of a subscriber is claimed
- [Data sources](./data-source.md) — `upsert` and transactions, for a value read and written back
- [Application lifecycle](../application/application-lifecycle.md) — the shutdown hooks and timeouts the drain fits into
- [Glossary](../glossary.md) — what lease, claim, grant and slot mean
