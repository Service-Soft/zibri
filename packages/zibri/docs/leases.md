# Leases
A lease is the right to do a piece of work that no other instance may do at the same time. Zibri's
cron elections, event claims, mail claims and named locks are all leases, and they all go through
one service so that they behave the same way.

This is the tool. For what it is used for, see [replication.md](./replication.md).

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `Lease` | entity | Where a grant lives |
| `LeaseOptions` | type | What to take: `key`, `leaseInMs`, and the two axes below |
| `LeaseSetOptions` | type | The same without `key` or `mode`, for taking several at once |
| `LeaseAcquisitionMode` | type | `'wait'` or `'skip'` - what to do when somebody else holds it |
| `LeaseCompletion` | type | `'release'`, `'retain'` or `'retainOnError'` - what happens to the grant when the work is over |
| `HeldLease` | type | A grant that has been taken: its `name`, and how to `renew` and `release` it |
| `LeaseServiceInterface` | interface | The contract: `withLease` and `withLeases` for the whole cycle, `hold` for a grant you took yourself |
| `LeaseService` | class | Default implementation. Renews while the work runs and drains on shutdown |
| `LeaseAcquisitionTimeoutError` | error | Thrown when a `'wait'` acquisition runs out of patience |
| `LeaseCleanupCronJob` | cron job | Removes lapsed grants. Registered for you |
| `ZIBRI_DI_TOKENS.LEASE_SERVICE` | DI token | Override to replace the implementation |
| `ZIBRI_DI_TOKENS.LEASE_DRAIN_TIMEOUT_IN_MS` | DI token | How long a shutting down instance waits for held work. Defaults to ten seconds |

## The problem it exists for

A grant is handed out for a fixed time. The work it protects can take longer than that - a slow smtp
server, a batch that grew, a database having a bad minute. When it does, the grant expires
underneath its own holder, a second instance takes the same grant, and both do the work.

Nothing about that is loud. Both replicas succeed. The duplicate only shows up in what the work
touched.

Three things have to be true for a lease to be safe, and `hold` provides the first two:

1. **it is renewed while the work runs**, so the deadline follows the work instead of the work
   having to fit inside the deadline
2. **it is released when the work ends**, however it ends
3. **releasing checks that this holder still owns it** - the caller's job, see below

### When a lease is the wrong tool

All three only cover the window the grant is held for. If the *effect* of the work lands outside that
window, the lease guarantees nothing, and no amount of renewing fixes it - a write made with a
transaction becomes visible on **commit**, and a commit the lease does not own can happen after it is
released.

So a lease protects **work**: something only one instance should be doing. It does not protect a
**value** read and written back inside someone else's transaction. For that, use
[`upsert`](./data-source.md#changing-a-value-based-on-what-is-stored--upsert), which has no window
between the read and the write for anyone else to get in.

This is not theoretical - it is how invoice numbering got a correct-looking lock that still handed
out duplicate numbers. A lock and a transaction have independent lifetimes, and an invariant spanning
both is only as strong as the shorter one.

## Usage

### Taking a lease

`withLease` is the whole cycle in one call: take the grant, run the work while keeping it alive,
hand it back afterwards.

```ts
// src/services/feed-import.service.ts
import { Email, inject, Lease, LeaseServiceInterface, Ms, Repository, ZIBRI_DI_TOKENS } from 'zibri';

export async function importFeedOnce(feedId: string, importFeed: (id: string) => Promise<string>): Promise<string | undefined> {
    return await inject(ZIBRI_DI_TOKENS.LEASE_SERVICE).withLease(
        { key: `import:${feedId}`, leaseInMs: Ms.MINUTE },
        async () => await importFeed(feedId)
    );
}
```

It returns `undefined` when the grant was not taken, which on every replica but one is the normal
outcome and not an error. Prefix your keys - the key space is shared with the framework's own.

### The two axes

Every lease in the framework differs from every other one along exactly two axes, and nothing else.

**How you acquire** - `mode`, defaulting to `'skip'`:

| | |
|---|---|
| `'skip'` | Give up at once when somebody else holds it. For work that has to happen once and that nobody is waiting on - another replica is already sending the mail, so there is nothing to do |
| `'wait'` | Queue until it is free. For work that has to happen once and that everybody needs the result of. Bounded by `acquireTimeoutInMs`, and reaching that bound **throws** `LeaseAcquisitionTimeoutError` - a caller that asked to queue cannot be told "never mind" and left to carry on as though the work had been done |

**What happens at the end** - `onCompletion`, defaulting to `'release'`:

| | |
|---|---|
| `'release'` | Hand it back, so the work can be done again by whoever needs to. Right whenever the grant only protects work in progress |
| `'retain'` | Keep it, and let it lapse on its own `expiresAt`. For work that must not happen twice, where the grant doubles as the record that it already happened. The alternative - release, then write your own "already done" row - is two writes with a window between them, and a crash in that window permits the re-run |
| `'retainOnError'` | Hand it back when the work returned, keep it when the work threw. The backoff case: something that just failed against a dead upstream should not be retried the instant it fails |

Set `acquireTimeoutInMs` deliberately when you use `'wait'`. It defaults to `leaseInMs`, and the two
answer different questions - how long the work takes is not how long another caller should be
prepared to queue for it.

A wait inside a request also ends when that request's deadline does, whichever comes first - see
[deadlines](./creating-endpoints.md#deadlines).

### Taking several at once

`withLeases` takes as many of the given keys as are free and runs the work over those:

```ts
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

The work is given the keys that were actually taken, which may be fewer than were asked for and is
never empty - when every key is already held it returns `undefined` without running the work at all.

There is deliberately no waiting form. Queueing for several keys at once is how two callers that want
the same two keys in a different order wait for each other forever, so a set is always `'skip'`.

### Renewing

Nothing about the lease is an upper bound on the work. A timer pushes `expiresAt` forward three
times per lease for as long as the work runs, so two consecutive failures are tolerated before a
grant is allowed to lapse. `leaseInMs` only decides how long *another* instance waits before taking
over from one that stopped existing.

A failed renewal is logged and does not stop the work. Stopping halfway is not better than
finishing - whatever the work had already written stays written either way - and the release is by
row id, so a holder whose grant lapsed and was taken over cannot free its successor's.

### Bringing your own grant

`hold` is the escape hatch: it runs the renew-and-release cycle over a `HeldLease` you built
yourself, for a grant that lives somewhere of your own choosing rather than in the `Lease` table.
Zibri uses it for the one exclusion that cannot be a lease - see below. Prefer `withLease`.

If you do write your own, **the release must check that this holder still owns the grant.** Releasing
unconditionally is worse than not releasing at all: a holder whose grant already lapsed will free the
one that replaced it, and from then on every caller is releasing the grant of the one before it. One
slow call degrades the exclusion for everyone, permanently.

```ts
// a valkey key: delete only while the value is still our token
const releaseScript: string
    = 'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';

// a claim row: delete only while this holder is still the one recorded on it
export async function releaseClaim(
    claimRepository: Repository<Lease>,
    claimId: string,
    instanceId: string
): Promise<void> {
    await claimRepository.deleteAll({ id: claimId, heldBy: instanceId });
}
```

### Cleaning up

Taking a lease clears the lapsed grant for **the key it is asking for** and nothing else - a sweep of
the whole table on every acquisition would turn the hot path into a scan.

That leaves lapsed grants behind, and a `'retain'` grant is never handed back by design. So
`LeaseCleanupCronJob` runs daily and deletes everything that has expired. It is registered for you
when the lease service initializes; you do not have to add it, and removing it means the table grows
by one row per retained grant, forever.

## Shutdown

`LeaseService` implements `OnAppShutdown`, and this is the part that is easy to get backwards.

Releasing every held grant when shutting down would be **wrong**. Work that is still running would be
handed to another replica while this one is still doing it, which is the exact duplicate leases exist
to prevent.

So it drains instead:

1. work still holding a grant is waited for, up to `LEASE_DRAIN_TIMEOUT_IN_MS`. It releases its own
   grants as it finishes, and the data sources are still connected because they close in
   `afterAppShutdown`
2. whatever is still held after that is released anyway - by then the process is going to exit with
   that work unfinished either way, so an immediate takeover beats a lease-length stall

**Step 2 overrides `onCompletion`.** A grant is only ever kept on the grounds that the work it
protected has been done, so work that never finished has its grant handed back whatever was asked
for - `'retain'` included. Retaining there would mean the next replica sits out a full lease for a
tick or a hook that stopped mid-flight.

Nothing has to stop new grants from being taken during shutdown: the http server is drained before
any shutdown hook runs, and cron jobs stop in `beforeAppShutdown`, so by then nothing is left that
could ask for one.

`LEASE_DRAIN_TIMEOUT_IN_MS` has to stay comfortably inside the application's shutdown timeout, or the
hook is cut off before it can release anything. It also sits behind the http drain - open requests
are waited for before any shutdown hook runs - so
[`HTTP_DRAIN_TIMEOUT_IN_MS`](./application-lifecycle.md) plus this one plus whatever your own hooks
take has to fit inside the platform's grace period.

## How the framework uses it

The built-in leases differ only in where the grant lives and what happens to it at the end:

| Lease | Grant | Completion |
|---|---|---|
| Scheduled execution | `cron:<job>:<slot>` | `'retain'` - the grant is also the record that this tick ran, so handing it back would let a late replica run the job again. It lapses on its own `expiresAt` |
| Queued mail | `email:<id>`, one per mail in the batch | `'retainOnError'` - handed back when the batch is sent or rate limited, kept when a send died halfway so it is not retried instantly |
| Event subscriber | `event:<event id>:<subscriber id>` | `'retain'` - handing it back the instant the hook returns would reopen the window the `EventSubscriberRun` ledger row is written to close |

Mail is the one that takes **several grants under one body**, through `withLeases`. The claim has to
be on each mail rather than on the batch or on the tick: the next tick a moment later is a different
set of mails, and a send that outlasts the interval between two ticks would otherwise be re-read as
`QUEUED` and sent again. Taking them together is what lets the rate limiter be asked for the whole
batch at once, *after* the claims are settled, so a three replica cluster does not spend three times
the SMTP budget racing for the same mails.

Schema setup is the one exclusion in the framework that is *not* a lease and cannot become one - a
lease is a row in a table that schema setup has not created yet. `ValKeyDataSource` uses a key with
a token, `PostgresDataSource` an advisory lock, which needs no expiry at all: the session owns it and
the server releases it when the connection drops. Neither is reachable from application code.
