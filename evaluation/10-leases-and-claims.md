# 10 — Leases and claims

A cross-cutting category rather than a subsystem. Every finding here has the same shape, which is
why it gets its own document: fixing them one at a time closed the instances but not the class, and
the next feature that needs cluster-wide exclusion will reintroduce it unless the framework offers
one primitive that is correct.

## The shape

Something grants the right to do a piece of work to exactly one replica. It is granted **once**, for
a **fixed duration**, and the work then runs **without checking that it still holds it**.

That is safe only while the work is faster than the grant. Nothing enforces that relationship, and
nothing detects when it is violated. The failure is silent by construction: both replicas believe
they are the only one, both succeed, and the duplicate is visible only in whatever the work touched.

Three ingredients, all of which have to be present for the bug:

1. **A grant with a deadline** — a TTL on a key, a `lockedUntil` column, a slot in a schedule.
2. **No renewal** — the deadline is set at acquisition and never extended while the work runs.
3. **No validation at the end** — completion writes its result unconditionally, rather than
   conditionally on the grant still being held.

Missing (3) is what turns a lost exclusion into a compounding one, because the completing replica
also *releases* a grant that by then belongs to someone else.

## Instances found

### 10.1 `ValKeyDataSource.withLock` expires under its own holder — **fixed**

[`val-key-data-source.model.ts`](../packages/zibri/src/data-source/data-sources/val-key-data-source.model.ts)

```ts
{ conditionalSet: 'onlyIfDoesNotExist', expiry: { count: timeoutInMs } }
try { return await fn(); }
finally { await client.del([lockKey]); }
```

`withLock(key, fn)` takes an arbitrary function and never states a bound on how long it may run. If
`fn` outlasts `timeoutInMs` the key expires underneath it and a second replica acquires the same
lock. The `finally` then deletes a key it no longer owns, freeing the *second* holder's lock and
letting a third in. Once the deletes are one holder out of step they stay that way, so a single slow
call degrades the lock for every later caller, not just the one that was slow.

Severity is higher than it looks: `SCHEMA_LOCK_KEY` goes through this. A migration that takes longer
than the lock lives re-opens [01 §C2](01-data-layer.md) — the finding `withLock` was introduced to
close.

`timeoutInMs` is also doing two unrelated jobs: how long to *wait* for the lock, and how long to
*hold* it. They are not the same quantity and cannot be tuned independently.

**Postgres is not affected.** `pg_advisory_lock` is session-scoped and held until unlocked;
`lock_timeout` bounds acquisition only. So this is a divergence between two implementations of one
interface, which is the kind that survives a test suite exercising only the other one.

Covered by `cluster/lock.cluster.test.ts`.

#### The fix, and why it is not just "do what postgres does"

A postgres advisory lock is owned by a *session*, and the server releases it when that connection
drops. Liveness is detected by the server, so no lease is needed. Valkey has no equivalent: keys are
global and nothing ties one to a connection's lifetime. The alternatives are worse rather than
different — `BLPOP` on a one element list gives blocking acquire with no expiry, but a holder that
dies never pushes the token back and the lock deadlocks permanently; RedLock is still lease based,
across more nodes.

A lease plus a heartbeat is the standard way to emulate session-scoped locking on a server that
cannot detect a dead holder, and that is what was implemented:

- **a fencing token.** Every acquisition stores a uuid as the key's value, and release runs a lua
  script that deletes only while the value still matches. `del` cannot express that on its own,
  which is what allowed a lapsed holder to free the lock that had replaced its own
- **renewal.** A timer extends the expiry three times per lifetime, through a script that only
  extends while the token matches. The hold now follows the work instead of the work having to fit
  inside the hold
- **`LOCK_HOLD_IN_MS`**, separate from `LOCK_TIMEOUT_IN_MS`. With renewal in place the hold only
  decides how long others wait after a holder *dies*, so a short value is now strictly better —
  which was not true while one number meant both things
- a failed renewal **logs and lets the work finish**. Cancelling midway would leave whatever was
  already written behind, and the conditional release means a lapsed holder can no longer damage its
  successor. What must not happen is losing the lock silently

The test got shorter as a result, which is the clearest evidence the two values needed separating:
it previously had to stagger the replicas by a fraction of the timeout, because starting them
together made every follower give up before the leader's key could lapse. That workaround existed
only because the fixture had no way to say "wait thirty seconds, hold for two".

#### Postgres is better here, but not free

Worth stating, because "postgres is not affected" reads as though it has no cost. It is better on
one axis — liveness — and pays for it elsewhere:

- **it holds a connection for the whole lock.** `withLock` dedicates a query runner, so locks held
  across slow work compete with request traffic for the pool. At the default `poolSize` of 100
  ([01 §M7](01-data-layer.md)) heavy lock contention presents as database unavailability
- **it breaks under transaction-mode connection pooling.** PgBouncer in transaction mode does not
  preserve session state, so the lock taken in one statement may not exist for the release. That is
  a common production topology
- **`hashtext` is 32 bit.** `pg_advisory_lock(hashtext($1))` maps every lock name into an `int4`, so
  two distinct names can collide and serialize against each other. The failure mode is over-locking:
  slower, never unsafe. Still a caveat of this implementation rather than of advisory locks

So the two are a trade, not a ranking. A deployment that runs both could route named locks to
postgres and keep valkey for the rest — worth an explicit `lockDataSource` option, in the shape of
the websocket `adapterDataSource`, rather than an implicit preference. It only helps deployments
that have postgres at all.

### 10.2 `EventService.claimRun` is not renewed while the hook runs — **fixed**

[`event.service.ts`](../packages/zibri/src/event/event.service.ts)

The claim is per `(event, subscriber)` — a claim on the *work item*, which is the right granularity
and structurally better than 10.3. But `lockedUntil` is written once at claim time, and `runHook`
finishes with an unconditional `updateById`. A hook that outlives the lease has its claim collected
as abandoned by another replica's dispatch poll and the subscriber runs twice.

This needs no misconfiguration. The default lease is a minute; the default hook timeout is thirty
seconds *per attempt*, and `attempts` is a documented option. `attempts: 3` reaches ninety seconds.

Covered by `cluster/events.cluster.test.ts`, which observed **three** claims on one event across two
replicas.

Those three claims were `instance-1`, `instance-1`, `instance-2` — reproduced across two runs. The
first replica collected **its own** abandoned claim and started the subscriber again alongside the
copy it was already running. So this was not only "another replica picks the work up": a single
replica running one slow subscriber duplicated the work against itself, with no second instance
required. A one-process deployment was not safe from it either.

**The fix.** A timer pushes `lockedUntil` forward three times per lease while the hook runs, cleared
in a `finally` around the attempts loop and `unref`ed so a running hook cannot hold the process open
at shutdown. Losing the claim is logged rather than acted on: cancelling halfway would leave whatever
the hook had already done behind, and the conditional half of the design costs nothing extra here
because 10.2a made `updateById` throw once the row is gone. Both the renewal and the closing
bookkeeping write therefore fail loudly on a lost claim instead of writing into a deleted row.

#### It did not stop at a duplicate — the replica died. **Fixed**

Observed in the cluster run, not reasoned about. The replica whose claim had been collected finished
its hook and ran `updateById(run.id, …)` against a row the new claimant had already deleted. That
call is an upsert (§10.2a), the resulting insert violated `createdAt`'s not-null constraint, and the
process exited with code 1.

Three separate gaps had to line up for a slow subscriber to kill a healthy replica, and all three
were present:

1. **The write is outside the guard.** `runHook`'s `try`/`catch` covers only the attempts loop that
   invokes the subscriber's hook. The bookkeeping `updateById` that follows it is unprotected — the
   framework guards the user's code but not its own.
2. **The promise is discarded.** Delivery is `.subscribe(e => void this.runHook(…))`. `void` throws
   the promise away, so a rejection has no caller and becomes an unhandled rejection rather than an
   error anyone can catch.
3. **Nothing listens for that.** There is no `process.on('unhandledRejection')` in the framework;
   the only such handlers live in `thread-job.worker.ts`, inside a worker thread. Node's default
   since v15 is to print and exit.

The HTTP error middleware cannot help here. It wraps the request pipeline, and this path has no
request, no response and no HTTP stack anywhere in it. This was the concrete instance of the missing
process-level handler listed under operational lifecycle in the
[README](README.md) and asserted by `http-and-observability.evaluation.test.ts`.

All three are fixed, because each fails at a different level: (1) was the bug, (2) is why it
escalated, (3) is why it was fatal rather than logged. `uncaughtException` deliberately logs and
rethrows rather than continuing — after one, the process may hold half-updated state, so what the
handler buys is the error reaching the configured transports before the exit, not survival.

`cluster/events.cluster.test.ts` now asserts every replica still serves http after a claim is lost,
before it asserts anything about duplicates.

**The crash was hiding how bad the duplication is.** With the replica dying on its first lost claim,
the run recorded three claims. Surviving, the same scenario records **four** — `instance-1` three
times, then `instance-2`. A replica that loses its claim does not stop working; it keeps finishing,
keeps re-claiming on the next poll, and does so once per lease interval for as long as the hook
runs. The observable count is therefore roughly `hook duration / lease duration`, not two.

### 10.2a `updateById` on a missing row inserts it — **fixed**

[`repository.ts`](../packages/zibri/src/data-source/repository.ts)

```ts
data.id = id;
await this.driver.save([data], options?.transaction, false);
```

`save` is an upsert, so an id that no longer exists is not an error — it is an INSERT with every
column the caller did not name left at `DEFAULT`. Independent of the cluster work, and reachable by
any concurrent delete.

How it presents is decided by the entity rather than by the repository, which is what makes it
awkward to reason about:

- with any not-null column that the caller did not name, the insert breaks that constraint and the
  failure surfaces as a raw `QueryFailedError` attributed to an update. `EventSubscriberRun.createdAt`
  is what crashed the replica above
- with every column nullable, there is nothing to break. **Observed**: the call resolves normally and
  hands back `{ id, body: 'edited' }` for a row that was deleted — resurrected, carrying only what
  that one call happened to set, with nothing raised anywhere

`findById` already throws `NotFoundError` for exactly this situation, so there is a right answer and
neither of these is it.

A correction worth recording, because the first version of this section had the emphasis backwards.
I wrote that the silent resurrection was the common case and the constraint violation the exception.
It is the other way round — most entities have at least one required column, so most of the time
this is loud. The first test written for it then passed for a reason unrelated to the finding:
`EvalOrder.reference` is required, so the insert broke *that*, and "it throws" was satisfied without
touching the claim at all. A green test in a suite where green means *closed* is the worst outcome
available, and it survived one round of review before the run caught it.

**The fix.** `Repository.updateById` reads the row before writing and lets `findById` throw
`NotFoundError`, which is what `ChangeSetRepository` already did — change set tracked entities never
had this, only plain repositories. Two things made the change safe to make rather than merely
desirable:

- an audit of all 17 call sites found none relying on upsert. Every one passes an id from an entity
  it has just read, and `RepositoryRateLimiterStore` branches on `if (existing)` explicitly
- `CrudControllerModel`'s `PATCH /:id` already declares `@Response.error(HttpStatus.NOT_FOUND)`. The
  contract already promised a 404 for a missing id and the implementation was upserting instead, so
  on an entity with no required columns a client could create a row at an id of their choosing by
  patching one that does not exist

Cost: one extra `SELECT` per update on a plain repository, and one redundant read on the subclasses
that already fetch before delegating — a soft-deleted, change-set-tracked update now issues four
where it issued three. Removing the redundancy means threading the already-read entity down through
the signature, which was more churn than the fix warranted.

Covered by `data-layer.evaluation.test.ts`.

### 10.3 Queued mail is claimed per tick, not per row — **fixed**

[`email.service.ts`](../packages/zibri/src/email/email.service.ts)

`findMails` selects rows with status `QUEUED`, and the status is written back only after `send()`
returns. Exactly-once therefore rests entirely on the cron lease, which is keyed
`<taskName>:<slotISO>` — one *scheduled execution*, not one *sending run*. Slot *t+1* is a different
key that a different replica may win freely while slot *t* is still sending, and it re-reads rows
that are still `QUEUED`.

The grant was scoped to the wrong thing. No lease duration fixes that, because the work being
protected is not the thing being claimed.

**The fix.** `EmailSendClaim`, a table whose unique `emailId` is the claim — the same shape as
`CronRunLease` and `EventSubscriberRun.claimKey`, where the insert decides the winner and no
compare-and-swap is needed. Mails are claimed before the rate limiter is asked for tokens, so an
instance does not spend its hourly budget on mail it will not send, and the claims are renewed while
the batch is in flight.

A separate table rather than a column on `Email`: a claim is only ever inserted, and adding a
not-null column to a table that already holds queued mail would need a database level default, which
property defaults do not currently emit ([01 §M9](01-data-layer.md)).

`sendLeaseInMs` lives on `EmailConfig` rather than in its own DI token, next to `maxEmailsPerHour` -
one place to configure mail.

One livelock had to be designed around: when every mail in a batch is already claimed,
`sendQueuedEmails` returns false. Returning true would spin, because `SendQueuedEmailsCronJob` loops
`while (goOn)` and the same rows come back on the next pass with the same claims failing.

Covered by `cluster/mail.cluster.test.ts`.

### 10.4 The invoice number lock ends before the caller's transaction commits — ~~open~~ **FIXED**

> **The general rule, which is the useful part of this finding:** an application level lock and a
> database transaction have **independent lifetimes**, so any invariant that spans both is only as
> strong as the shorter one. `withLock` cannot fix that by trying harder — it does not own the
> transaction, so it has no way to know when commit happens.
>
> The right question is therefore not "how do we hold the lock longer" but "what can hold the
> guarantee until commit". Two answers exist, and only one is good.
>
> Inverting the ownership works: a `withLockedTransaction(key, fn)` that acquires the lock, opens the
> transaction, runs the work, commits and only then releases would be correct. It was rejected. It
> holds a lock with a TTL across arbitrary caller work — which is [10.1](#101-valkeydatasourcewithlock-expires-under-its-own-holder--fixed)
> again, a lease expiring under the thing it protects — it deadlocks when two callers take locks in
> different orders inside their transactions, with nothing to detect it, and it forces every caller
> to give up bringing its own transaction.
>
> **What shipped is the same rule, enforced by the database instead.** `getConsecutiveNumber` claims
> its number with `Repository.atomicUpsert`, one insert-or-increment statement. Inside a transaction
> postgres takes a row lock on the counter row and holds it *until commit* rather than until the
> statement ends — so the exclusive window already reaches exactly as far as it has to, natively,
> with deadlock detection and no TTL to outlive. The number also rolls back with an abandoned
> invoice, so the sequence stays gapless.
>
> The rule is now enforced rather than remembered: `atomicUpsert` requires the identifying columns to
> be declared in `uniques` on the entity, and is `undefined` on data sources that cannot perform it,
> so a store that would have to emulate it says so instead of pretending. `docs/data-source.md`
> states when to reach for it and when `withLock` is still the right tool - work that is not a single
> value, where nothing is deferred past the lock at all.

Found during the audit, *after* [04 §1.11](./04-infrastructure-subsystems.md) was closed — which is
the interesting part. The fix there was a real lock, correctly keyed, correctly scoped. It still
does not hold for a caller that passes a transaction.

`getConsecutiveNumber` reads and increments inside
`withLock('invoice-number:<year>:<recipient>', …)`, but writes through
`updateById(…, { transaction })`. The write therefore lands in the **caller's** transaction and only
becomes visible on commit, while the lock is released when `withLock` returns — before that. The
next caller takes the lock legitimately, reads a counter whose increment is still uncommitted, and
issues a legal identifier that has already been handed out.

This is the same shape as [10.1](#101-valkeydatasourcewithlock-expires-under-its-own-holder--fixed)
seen from the other side. There, the grant expired under work that was still running. Here the work
finishes inside the grant and its *effect* lands outside it. In both cases the protected window and
the window that needs protecting are not the same window.

It generalizes past invoicing, so it is worth stating as a rule: **a lock cannot protect a
read-modify-write whose write is deferred to a transaction the lock does not outlive.** Any
`withLock` body that takes a `transaction` parameter it did not open is suspect for the same reason.

Checked, and it is one instance rather than a pattern. `DataSourceInterface.withLock` has exactly
three production callers: the schema lock in `typeorm-base-data-source.model.ts:174`, the same in
`val-key-data-source.model.ts:229`, and this one. Neither schema lock is handed a transaction.
`RepositoryRateLimiterStore.atomicUpdate` is a separate `RateLimiterLockInterface.withLock` and has
the identical read-modify-write shape, but passes no transaction — its writes commit inside the
lock, so it is safe for exactly the reason invoicing is not. Recorded so it stays that way.

The fix is not a wider lock: the lock would have to outlive a transaction the service does not own
and cannot see the end of. Either the database serializes it — an atomic
`UPDATE … SET number = number + 1 RETURNING number` inside the caller's transaction, which removes
the need for a lock — or the counter moves out of the caller's transaction and commits on its own,
which costs a burnt number on rollback. The first needs a returning/conditional update in the
repository layer, the gap the code comment already names.

Held by *gives every caller its own number when each one runs inside its own transaction* in
`invoicing.evaluation.test.ts`, red until the fix.

### 10.5 The first sign-in lease of a directory ends before the login commits — ~~open~~ **FIXED**

> **Closed 2026-10-16: the lease now lasts until the login's transaction ends** (the user's call,
> over the two other answers below).
>
> - **`LeaseOptions.heldUntil`** names a transaction the work writes in. `withLease` then hands the
>   grant back once the work has returned *and* the transaction has ended, whichever comes last: a
>   caller usually ends it afterwards, but the work may end it itself. In between the grant is kept
>   through `keepAlive`, so it is renewed, the shutdown drain waits for it, and no TTL can run out
>   under a slow commit. A rollback counts as the work having thrown for `onCompletion`; a
>   transaction that has ended already, or none, behaves as before. `runInLeaseScope` no longer
>   reports the transaction the grant is held until, since the grant does cover that commit.
> - **`Transaction.afterFinish(work)`**, new beside `afterCommit`, runs once the transaction is
>   committed, rolled back or its commit failed, and tells the work which. All three transactions
>   implement it, spliced so a rollback after a failed commit does not run it twice; the valkey
>   transaction's idle rollback reaches it too. A `Transaction` of an application's own implements it,
>   which `upgrading-to-3.md` says.
> - `BaseLdapAuthenticator.resolveUser` passes `heldUntil: transaction`, and nothing else changed:
>   the hook and the link stay in the login's transaction and roll back with it.
>
> **Why not the obvious alternatives.** *Its own transaction* (the first sign-in commits inside the
> lease) was the smallest change, but a login failing afterwards would keep the user and link, the
> hook would no longer get the login's transaction, and every first sign-in would need a second
> pooled connection while its login's is open, so a burst of them can exhaust the pool waiting on
> each other. *Let the database decide* (insert the link first through `upsert`, with an empty
> `userId`, and let the unique index make the second wait) is the 10.4 answer, but needs a nullable
> `userId`, an `upsert` whose conflict path changes nothing (refused today), and an in-memory store
> that makes a second transaction wait. Holding the lease until commit is the `withLockedTransaction`
> shape 10.4 rejected; its reasons do not carry over. The TTL is renewed rather than outlived, the
> caller keeps its own transaction, and no lock-order cycle can form: a waiting login has only read
> by then.
>
> **Worse than filed.** On the in-memory store both logins *succeeded*, as two different users with
> two links, because nothing there enforces a unique at commit. Postgres and valkey would have
> failed the second login as filed.
>
> **Proof.** *links two first sign-ins as the same entry at once to one user while their logins commit
> late* in `base-ldap.authenticator.test.ts` logs in through `AuthControllerUtilities.runInTransaction`
> as `AuthController` does, and commits 300 ms after the session is started, longer than the waiting
> side's poll. It was red first (two users), and also asserts that the lease warning stays quiet. The
> older case, which logs in without a transaction, stays as it was. `lease.service.test.ts` holds
> `heldUntil` (held past the work until commit; handed back on rollback, retained on one under
> `retainOnError`; handed back once the work returns when the transaction ended inside it or
> before), `run-in-lease-scope.test.ts` the quiet warning, and `afterFinish` has a case on each
> store, a failed commit included on postgres and valkey.

*Filed on the re-check of 2026-10-15. The shape of 10.4, in code written after it.*

`BaseLdapAuthenticator.resolveUser` (`src/auth/authenticators/ldap/base-ldap.authenticator.ts:470-497`)
makes two first sign-ins as one entry wait for each other through
`withLease({ key: 'ldap-first-sign-in:<name>:<entry>', mode: 'wait' })`. Inside it,
`resolveFirstSignIn` creates the user and `identityRepository.create(…, { transaction })` links the
entry, both in the login's transaction. Every login has one: `AuthControllerUtilities.runInTransaction`
(`src/auth/auth-controller/auth-controller.utilities.ts:129-140`) opens it around `AuthService.login`
and commits after the strategy has started the session. The lease is released when the callback
returns, before that commit.

So the second sign-in takes the lease, asks `findIdentity` inside its own transaction, sees nothing
committed, and calls `resolveFirstSignIn` a second time. Its link then waits on the unique
`(directory, entryId)` and fails once the first commits, so the second login ends in an error
instead of finding the user, after the application's hook has run twice. `runInLeaseScope` sees the
open transaction on release and logs its warning on every first sign-in, not only the contested
ones.

*links two first sign-ins as the same entry at once to one user* in `base-ldap.authenticator.test.ts`
is green because the waiting side polls every 100 ms (`ACQUIRE_RETRY_INTERVAL_IN_MS`) and the first
login usually commits inside that window. 03 §H4 records the lease as what makes the hook run once.

### 10.6 A deadlock between valkey transactions ends every one of them, after ten seconds — **open (deferred)**

*Filed on 2026-10-15; [Deadlock endings](#deadlock-endings) below has called it open and accepted since
step 3.*

Two transactions taking the same keys in opposite orders wait for each other until
`VAL_KEY_TRANSACTION_LOCK_TIMEOUT_IN_MS` runs out, and then all of them fail. Postgres finds the same
cycle in about a second and fails one, so the rest commit. The error names contention rather than a
deadlock. Wait-die was considered and rejected; detecting the cycle by walking who-waits-for-whom is
the design written down there, with two questions to settle first.

## Ruled out

Checked and genuinely safe, recorded so the next audit does not repeat the work:

| Component | Why it is safe |
|---|---|
| `log-cleanup`, `event-cleanup`, `cookie-auth-session-cleanup`, `jwt-refresh-token-cleanup` | `deleteAll` with a time predicate. Idempotent, so a duplicate run is a no-op |
| `collect-metrics`, `rate-limiting-cleanup`, `form-data-body-parser-cleanup`, `cache-invalidation` | `distributed: false`. Per-replica work by design, no grant involved |
| `PostgresTypeormDataSource.withLock` | Session-scoped advisory lock, no TTL to outlive |
| `MultithreadingService` | Ruled out at the time because the queue was an in-memory array, so a job never crossed instances. The queue is the table now and a job is claimed under a lease for its whole run, renewed while it runs ([04 §2.10](./04-infrastructure-subsystems.md)), so it is the shape this document fixed rather than one it ruled out |

## What `distributed: true` actually promises

Worth stating plainly in [`docs/cron.md`](../packages/zibri/docs/cron.md), because 10.3 is a direct
consequence of reading more into it than it says:

> `distributed: true` guarantees that one replica runs a given **scheduled execution**. It does not
> guarantee that only one execution is running at a time. A job whose `onTick` can outlive its own
> interval must claim the individual work items it processes; the slot lease will not do it.

## Toward one primitive

All three were fixed separately, and each landed on the same three mechanisms — A, B and C below,
which were written before any of them existed and turned out to describe what all three needed.

| | 10.1 `withLock` | 10.2 event claim | 10.3 mail claim |
|---|---|---|---|
| **A** the grant is identified | uuid token in the key's value | the run row's identity | the claim row's identity |
| **B** renewed while working | lua `pexpire`, 3× per hold | `lockedUntil` pushed forward, 3× per lease | same, per batch in flight |
| **C** failure is loud | conditional lua `del` | `updateById` throws once the row is gone | same |

That is three independent implementations of one idea, which is the point at which extracting it
stops being speculation.

**Extracted**, as `LeaseService` in [`src/leases`](../packages/zibri/src/leases), documented in
[`docs/leases.md`](../packages/zibri/docs/leases.md). `hold(lease, leaseInMs, fn)` owns the renewal
timer and the release; a `HeldLease` supplies only `name`, `renew` and `release`. The framework now
contains exactly one `setInterval`, where it previously had three, and one renewals-per-lease
constant where it had three.

Acquiring deliberately stayed with the callers. Taking a grant fails in ways holding one cannot -
running out of patience waiting for a lock, losing a race on a unique insert - and those are
decisions only the caller can make. What differs between the three is only *where the grant lives*,
which is exactly what `HeldLease` leaves to them.

> **Superseded** by [The two primitives](#the-two-primitives) below. Leaving acquisition out is what
> produced three bespoke tables, and the difference it was protecting turned out to be a single
> parameter: wait, or give up.

Two things came out of the extraction that were not in the original plan:

- **the shutdown drain.** A replica going away gracefully still holds grants, and whoever takes over
  otherwise waits out a full lease for work that stopped a second ago. The naive fix - release
  everything on shutdown - is wrong, because work still running would be handed to another replica
  while this one is still doing it. So it waits for in-flight work first (releasing as it finishes)
  and only takes back what is still held when that wait runs out.
- **a window closed in 10.2.** Moving the event's bookkeeping write inside the held section removed
  the gap between the hook returning and the run being marked finished, during which the claim could
  expire and another replica could restart completed work.

The three options as originally written, kept because they name the mechanisms:

### A. Fence the existing lock, keep the shape

Give each acquisition a unique token, store it as the value, and release conditionally — on ValKey a
short Lua script, since `del` has no compare-and-delete. This alone fixes the *compounding* half of
10.1: a replica whose lease expired can no longer free somebody else's lock. Exclusion is still lost
when work outlives the TTL, but the damage stops at the one call rather than spreading.

Split `LOCK_TIMEOUT_IN_MS` into an acquisition timeout and a hold TTL while touching this.

Small, local, and strictly an improvement. Worth doing regardless of what else is chosen.

### B. Renew in the background while the work runs

A heartbeat that extends the deadline on an interval well inside it, cancelled when the work
finishes. Turns "the work must be faster than the lease" into "the work must not stall for longer
than the renewal interval", which is a far weaker requirement and the one every mature lock manager
settles on.

Applies uniformly to all three: `withLock` extends its key, `claimRun` pushes `lockedUntil` forward,
and a per-row mail claim would do the same. The cost is that every grant now has a timer attached
and a defined behavior when renewal itself fails — at minimum, abandoning the work rather than
carrying on regardless.

### C. Make the grant checkable at the end

Independent of B and worth having even with it: completion writes conditionally on still holding the
grant. `updateById(run.id, …)` becomes an update guarded by the claim token, and a lost race is
logged rather than silently written. This is the only one of the three that makes a violation
*visible* instead of merely less likely — which matters more here than the exclusion itself, since
the entire category's defining trait is that it fails quietly.

It is also the one that would have prevented the crash in §10.2: a completion that checks whether it
still holds the claim finds the answer is no and logs it, instead of writing blindly into a row that
is no longer there.

B and C together are the standard answer, and they compose: renewal makes the loss rare, the
conditional write makes the remaining losses loud.

### Where it should live

All three are `DataSourceInterface` concerns rather than per-subsystem ones. The mail claim, the
event claim and the schema lock currently each hand-roll their own delete-expired-then-insert dance
against a bespoke entity. A single claim primitive on the data source — acquire with a token, renew,
release conditionally, complete conditionally — would let 10.2 and 10.3 be expressed as callers of
it rather than as three more implementations to keep in step.

That is a design change, not a patch, and it is the one worth discussing before writing more of
these by hand.

> **Superseded** by [The two primitives](#the-two-primitives). The conclusion that it belongs in one
> place holds. The proposed *location* does not: putting it on `DataSourceInterface` is what
> `withLock` already does, and that turns out to be the flaw rather than the fix.

---

## The two primitives

The design this document has been circling, written down before any of it is built. It came out of
asking why `atomicUpsert` refuses to work on ValKey, and ended up rewriting the answer to almost
every entry above.

There are two concepts, and everything else in this area is one of them wearing a different name.

| | Unit | Covers | Atomic because |
|---|---|---|---|
| **Transaction** | connection-scoped | database work | the store's own mechanism holds until commit |
| **Lease** | a row in one shared table, renewed | side-effecting work across processes | the grant is held, renewed, and given up loudly |

Two rather than one, because a transaction cannot span an SMTP send, a webhook or a PDF render.
Holding one open across a third party's latency pins a pooled connection and its locks behind
somebody else's outage — the thing you must never do. That boundary is the only reason both exist.

### Everything folds into one of them

| Today | Becomes |
|---|---|
| `atomicUpsert` | `upsert` — atomic because it is in a transaction |
| `updateAll`'s read-modify-write | atomic for the same reason |
| `DataSourceInterface.withLock` | a lease in `wait` mode |
| cron run lease | a lease in `skip` mode, retained |
| event subscriber claim | a lease in `skip` mode, retained |
| mail send claim | a lease in `skip` mode, released |
| the ValKey transaction's exclusion | a lease, held internally |

Six instances of one shape. *Toward one primitive* above argued from three.

### Why "lease" and not "lock" or "claim"

All three words are in use for the same object. Picking one is not cosmetics here: **"lock" encodes
the mental model that caused this entire category.** A reader of `withLock(key, fn)` reasonably
assumes exclusion lasts until the callback returns. It does not — it lasts until the TTL expires,
which is §10.1 (occupancy of three in a section meant for one) and §10.4 (the counter escaping
before the caller's commit).

"Lease" carries expiry and renewal in the word. `CronRunLease` and `EVENT_EXECUTION_LEASE_IN_MS`
already went that way.

A Postgres advisory lock genuinely does not expire, so "lease" understates it there. That is the
right direction to be wrong in: callers cannot branch on data source, so the contract has to be the
weakest guarantee any implementation offers. Calling the strong one a lease is honest; calling the
weak one a lock is not.

### Two axes, not one

Found while folding the cron lease onto the primitive, which did not fit: `withLease` releases the
grant when the work is over, and the cron lease **must not be released**. Its key names one
scheduled execution, and the row surviving the work is what stops a replica that arrived late from
winning the same key and running the job again. `EventSubscriberRun` has the same duality — it is
the claim *and* the record that this subscriber finished this event.

So the grant has a second axis, decided at completion rather than at acquisition:

- **`release`** — hand it back; the grant only ever protected work in progress. Every lock, and the
  mail claim.
- **`retain`** — keep it and let it lapse on its own `expiresAt`. The grant doubles as "this has
  already been done", and the expiry bounds how long that memory lasts. This is exactly what cron
  does today: `CRON_EXECUTION_LEASE_IN_MS` is five minutes and nothing ever deletes the row.

The alternative to `retain` — release the grant and have the caller write a separate "already done"
record — is two writes with a window between them, and a crash in that window permits precisely the
re-run it was meant to prevent. One row that outlives the work is the honest primitive.

A retained grant is kept whether the work succeeded or threw. Freeing it on failure would turn a
failed run into one another replica retries, which is a behavioural change rather than a property of
the grant, and not one a refactor should introduce.

### Acquisition comes in

Reversing the earlier call. The differences that kept it out — waiting for a lock versus losing a
race on a unique insert — are one parameter:

- **`wait`** — block until the grant is free. The schema lease: the second replica waits, then finds
  the migrations already applied.
- **`skip`** — give up immediately. Every claim: another replica has it, move on.

Everything else about acquisition was identical, and leaving it to callers is precisely what
produced three hand-rolled delete-expired-then-insert dances against three bespoke tables.

### Where the lease lives

A single `Lease` entity, registered in **exactly one** data source.

Not on `DataSourceInterface`. `dataSource.withLock(key)` silently scopes exclusion to *that* store's
key space, while the thing being protected frequently does not live there — a lease taken in ValKey
excludes nobody coordinating through Postgres, and nothing at the call site says so. One entity
makes the answer explicit and singular.

It also gets boot-time enforcement free from the existing `validateEntitiesRegistered` pattern: an
application whose `Lease` entity is missing fails at **init** with a message naming it, rather than
at the first contended request.

Three coordination tables collapse into one:

- `CronRunLease` — gone, it *is* a lease
- `EmailSendClaim` — gone
- `EventSubscriberRun` — keeps only its ledger role (`finishedAt`, `error`). It stops being the
  claim and becomes purely the record that this subscriber finished this event.

### One acquisition strategy

An earlier draft of this section allowed a second one — the lease stored as fields on the entity it
protects (`status='SENDING'` plus `sendingUntil` on `Email`). Dropped. With a `Lease` entity the mail
claim is just a lease keyed `email:send:<id>`, and the second strategy exists only to serve a case
that no longer arises.

What that costs is real but small: a mail being sent still reads `QUEUED`, so replicas keep selecting
it and then failing to acquire. Wasted round trips, not incorrectness — and exactly what
`EmailSendClaim` does today.

### What this does to [01 §M20](./01-data-layer.md)

It removes its justification, which is worth stating plainly because two rounds of design were spent
on the opposite assumption.

The argument for a conditional update ran: the mail queue must claim an existing `QUEUED` row, that
is `UPDATE … WHERE status='QUEUED'`, and no such operation exists. With leases the mail queue does
not claim by updating at all, so the one concrete requirement is gone.

What is left is still a real defect **for users**: `updateAll` is a read-modify-write where two
callers both believe they won, and a compare-and-set is what optimistic locking
([01 §M1](./01-data-layer.md)) would be built on.

**But it closes almost for free under this model, rather than needing to be re-argued.** Two earlier
conclusions about why it could not be done were both drawn under the old constraints and do not
survive:

- *"a method on both drivers can only carry a guarantee both drivers can keep, and ValKey cannot"* —
  ValKey can, once its transaction holds a lease. Inside a transaction the lease already excludes
  other writers; without one, `updateAll` wraps itself in an implicit transaction and takes a lease
  for the operation.
- *"a relation filter cannot be atomic on Postgres, because `UPDATE … WHERE <join>` is not
  expressible"* — `SELECT … FOR UPDATE` inside the transaction locks the matched rows until commit,
  so read-then-update-by-id is atomic too. Postgres simply has two mechanisms: one statement for
  plain predicates, `FOR UPDATE` for anything needing a join.

So `updateAll` becomes atomic everywhere, by four mechanisms across two stores, with the caller
unable to tell which ran. That is the same shape as every other row in the folding table above.

One honest edge remains, and it is narrower than either claim it replaces: neither `FOR UPDATE` nor
a lease covers **phantoms** — rows that begin matching the filter *after* the read. Only
`SERIALIZABLE` does. For claiming rows that already exist, which is every use in this document, it
does not arise; for `updateAll` as a general user-facing operation it is a documented limit rather
than a defect.

### Costs to accept

- **Granularity.** A filter-based write on ValKey cannot know which rows it will touch before
  reading, so its lease is entity-level. Every write to that entity serialises inside a transaction.
  Correct, coarse.
- **Deadlock.** Two transactions taking entity leases in opposite orders. Needs a fixed acquisition
  order or a timeout-and-abort — a design decision, not a detail.
- **Renewal inside transactions.** A user can do anything inside a transaction, so a ValKey
  transaction's lease needs the same heartbeat as any other. Reuse, not new machinery.
- Every ValKey write inside a transaction pays a lease round trip.

### Order

1. ~~`Lease` entity and the unified `LeaseService`~~ — **done.** Acquire/renew/release, `wait` and
   `skip`, boot-time validation.
2. ~~Fold `withLock`, the cron lease, the event claim and the mail claim onto it~~ — **done.**
   `CronRunLease` and `EmailSendClaim` are deleted, `EventSubscriberRun` is a ledger.

   Three things the fold turned up that this document did not predict:

   - **`withLock` did not disappear, it shrank.** Schema setup cannot use a lease, because a lease
     is a row in a table schema setup has not created yet. It survives as `protected schemaLock` on
     the data source, unreachable from application code, with its DI tokens renamed
     `SCHEMA_LOCK_*` to say so.
   - **Two axes were not enough.** Mail needs a third completion, `'retainOnError'` — a send that
     died halfway must not be handed straight back to whoever asks next — and it needs to hold
     several grants under one body, which is `withLeases`. The batch is deliberately `'skip'`-only:
     a waiting form is the deadlock in §"Deadlock" below, reachable by accident.
   - **`'retain'` had to lose to the shutdown drain.** Keeping a grant is a claim that the work has
     been done, so work that never finished releases whatever was asked for. Without that, a
     replica shut down mid-hook made its successor sit out a full lease.
3. ~~`ValKeyTransaction` holds a lease for its lifetime~~ — **done**, and held by
   `cluster/valkey-transaction.cluster.test.ts`.

   A grant per row key, taken as the write is buffered and released on commit or rollback. Only
   `hashSet` and `delete` take one; `setAdd`/`setRemove` maintain the id indexes and commute, so
   they are left free — the same way a database does not hold an index locked for the length of a
   transaction that inserted into it. Grants are native `SET NX PX`, not `Lease` rows, so a valkey
   write never reaches across to another data source for permission.

   Two things this needed that step 1 did not anticipate:

   - **`LeaseService.keepAlive`.** A transaction's grant lives from its first write to its commit,
     and no callback wraps that, which is the one shape `hold` cannot express. Implemented as `hold`
     with the body replaced by "until somebody says stop", so renewal, the drain and the release all
     apply unchanged.
   - **Deadlock is timeouts, not detection.** `VAL_KEY_TRANSACTION_LOCK_TIMEOUT_IN_MS`, ten seconds
     by default. A cycle costs the wait rather than being reported the moment it forms. **Open, and
     accepted for now** — see [Deadlock endings](#deadlock-endings) for what it would take.

   **What it does not buy**, and the second case of that test is the standing proof: a grant taken at
   write time cannot protect a value read before it. Three replicas doing read-add-write concurrently
   still land on 1 rather than 3. Postgres loses the same update under READ COMMITTED. That is step
   4's to close, and the test is what will show it closed.
4. ~~`upsert` replaces `atomicUpsert`, required on the driver, implemented by both stores~~ —
   **done**, and held by the second case of `cluster/valkey-transaction.cluster.test.ts`, which was
   left red by step 3 for exactly this.

   Postgres keeps the statement it already had. ValKey answers with a grant on the **identity**, not
   on the row: the row an upsert may be about to insert does not exist yet and has no key to hold,
   so the key is derived from the identity values instead. Taken before the read rather than at the
   write, which is the whole difference from step 3 — a grant taken at write time cannot protect a
   value that was read before it.

   Three things this turned up:

   - **`uniques` became a shared rule rather than a Postgres one.** `uniqueGroupFor` is now what both
     stores validate the identity against. On sql it resolves the conflict-target constraint name; on
     valkey it builds the grant key. The declaration means "these properties name at most one row",
     which is what an upsert needs, rather than "there is an index".
   - **`upsert` needs a transaction, so it takes one.** A grant is handed back when the transaction
     that took it ends, so an upsert outside one would hold its grant until it lapsed. The valkey
     driver opens its own and commits it when the caller passed none. Nothing records it in the
     §10.4 lease scope, which is right: a transaction that cannot escape the call cannot escape a
     lease either.
   - **`upsertAll` was not built.** It has no caller and no described use, and the batch form is real
     work on the sql side (per-row differing increments in one statement). Adding it now would be
     speculative; the singular closes every case this document raised.

     > **Built since (2026-09-28), because it had a caller after all.** `EventService.refreshSubscriberRegistrations`
     > looped `upsert` over every subscriber an instance hosts, on every dispatch poll - one round trip
     > each. The driver's `upsert` takes a list now, and the singular call is a batch of one, so each
     > store keeps one implementation. The per-row increments are one statement on postgres: every
     > changed column is a `CASE EXCLUDED."id" WHEN … END`, keyed on the id each row was proposed with,
     > and the rows come back paired by identity because a statement promises no order. Valkey takes
     > the identity grants sorted, reads every identity at once and saves once. Two rules came with it,
     > both enforced by the repository for every store: no identity twice in one batch (postgres refuses
     > that itself and a store applying them in turn would let one row decide the other's change), and
     > an `onConflict` leaves the identity as it is, since the identity is what the written row is
     > paired back by.

5. ~~Docs: `withLock` disappears, leases documented once~~ — **done**: `docs/leases.md`, and no
   page names `withLock` any more.
6. ~~`updateAll` becomes atomic~~ — **done**, closing [01 §M20](./01-data-layer.md).

   The whole operation moved onto the driver rather than staying orchestrated in the repository,
   because the two stores close the window in genuinely different ways and only the operation is
   shared. Postgres reads with `SELECT ... FOR UPDATE` — the rows are held from the read until the
   commit, and it re-checks the filter itself once each lock is granted. ValKey reads to learn which
   rows are candidates, holds those rows, then **reads again**, because the first read was made
   holding nothing; a row that stopped matching in between is dropped, which is the re-check done by
   hand.

   Two things worth recording:

   - **The entity-wide grant the design called for is not needed.** This document predicted that a
     filter write on valkey would have to hold the whole entity, serializing filter writes that
     match nothing in common. What actually makes it safe is holding the candidate rows and reading
     them again; the entity grant only prevented two of these from taking rows in opposite orders,
     and sorting the ids before claiming does that for nothing. Valkey gets row granularity too.
   - **It fixed a silent bug in soft delete.** `deleteAll` soft-deletes by calling `updateAll`, and
     the old implementation read its own result back through the repository's soft delete filter -
     which excludes the rows it had just marked deleted. It handed an empty array to the change set
     writer, so **bulk deletes recorded no DELETE change sets at all**. `deleteById` had been
     patched for the same thing years earlier with a try/catch; `deleteAll` never was, and no test
     covered it. Now held by one in `soft-delete-repository.test.ts`.

   One limit survives, narrower than the ones it replaces: **phantoms**. A row that begins matching
   after the filter was evaluated was never a candidate on either store. Only `SERIALIZABLE` covers
   that, and no store here offers one.

Steps 1 and 2 are pure refactoring under `cluster/lock`, `cluster/cron`, `cluster/mail` and
`cluster/events`, all currently green. They should stay green throughout — which is the strongest
safety net available for a change this size, and the reason to do it before anything that is not
refactoring. They did: the only cluster failure across the whole of steps 1 and 2 is
`heterogeneous-events`, which was 04 §1.4b, open then and fixed since, and red before any of this started.

## Deadlock endings

**Open, and deliberately accepted for now** — filed as 10.6. The deadlock itself is not a ValKey defect — two
transactions taking the same rows in opposite orders deadlock on Postgres too, and that is the
textbook case. What differs is the ending, and ours is worse in two ways:

| | Postgres | ValKey transaction |
|---|---|---|
| Noticed | ~1s, cycle found in the wait-for graph | never — only the acquisition timeout expires, ten seconds |
| Outcome | one victim killed, **the others commit** | every side times out, so **all of them fail** |

So a cycle costs 10x longer to report, produces an error that names contention rather than a
deadlock, and loses transactions that could have survived.

**Wait-die was considered and rejected**, which is worth recording because it is the textbook answer
and it does not fit here:

- it **aborts transactions that were never going to deadlock** — any younger transaction meeting an
  older holder dies, cycle or not. That replaces the queueing behavior step 3 exists to provide, and
  the first case of `cluster/valkey-transaction.cluster.test.ts` would go red by design.
- it assumes transactions are **restartable**, and ours are not. There is no `runInTransaction(fn)`
  anywhere: a transaction is `startTransaction()`, then the caller's own statements, then `commit()`.
  Nothing owns a body to re-run, so an abort could only surface as an error the caller must loop
  around — worse than the timeout it replaced.
- comparing start timestamps across replicas needs a clock they agree on, or the cycle comes back.

**What would fit, if this is picked up.** Detect real cycles rather than inferring from age. Put the
transaction id in the grant value; when a transaction blocks, write `waiting:{txId} -> {key}` with a
short TTL. A blocked transaction then walks the chain itself — who holds my key, what are they
waiting for — and a walk arriving back at itself is a cycle. Each participant sees the same cycle and
so computes the same victim (highest id, say); only that one aborts, the rest are unblocked by its
release. No central detector, no election, TTLs cover crashed processes, one `GET` per hop on a path
that is already slow. Crucially it leaves uncontended and merely-contended behavior untouched, which
is what wait-die gets wrong.

Two things to settle first: whether a walk can read a half-released chain and see a phantom cycle
(likely needs confirming the cycle twice before acting), and whether transaction ids exist yet.

## A `runMode` flag, and where its seam actually falls

Proposed while reviewing this: `runMode: 'cluster' | 'standalone'`, so a deployment that will only
ever run one process does not pay for machinery that exists to coordinate several. The motivation is
sound — most of that machinery costs a write or a poll — but the obvious dividing line is the wrong
one, and this document is the reason.

**Both 10.2 and 10.3 reproduce inside a single process**, observed rather than reasoned about:

- the events run recorded claims from `instance-1`, `instance-1`, `instance-2`. The first replica
  collected its own abandoned claim and ran the subscriber again next to the copy it was already
  running
- the mail runs recorded `instance-0` twice, then `instance-1` twice on the next run. One replica's
  tick re-read rows the same replica's previous tick was still sending, because `noOverlap` is false

So the seam is not *cluster versus not*. It is **coordination between processes**, which a single
process genuinely does not need, versus **claiming a unit of work**, which also protects a process
from itself and from its own restart. Dropping the second under `standalone` would not remove
overhead, it would make these two findings the default configuration.

| Cross-process only — safe to skip | Still required with one process |
|---|---|
| `CacheInvalidation` rows and the 2s poll | `EventSubscriberRun` ledger — recovery after a restart |
| The websocket pub/sub adapter | The event claim lease — self-reclaim, §10.2 |
| The schema lock around migrations | A per-row mail claim — self-overlap, §10.3 |
| `CronRunLease` writes | |

The saving lives almost entirely in the left column, and within it in the *polling* rather than the
locking: a 2s cache-invalidation poll and a 5s event-dispatch poll are continuous database traffic
that buys nothing with one process. A claim is one insert per work item, which is noise beside the
work it guards.

**Default it to `cluster`.** A wrong value here fails silently in the worst direction: an app
configured `standalone` and then scaled to two replicas behaves correctly until it does not, with
nothing connecting the symptom to the setting. If `standalone` is preferred as the default for
developer experience, it needs a startup check that refuses to boot when another live instance is
visible in the shared data source.
