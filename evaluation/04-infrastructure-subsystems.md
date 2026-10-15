# Infrastructure Subsystems — Cron, Events, Mail, Cache, Metrics, Logging, Threads, HTTP Client, Backups

All paths relative to `packages/zibri/`.

**Headline:** every stateful subsystem here is a per-process in-memory singleton with no
coordination layer. Zibri behind a load balancer with N replicas produces N cron firings, N
duplicate emails, N× the configured mail rate limit, and events that only reach subscribers on the
emitting process. Only the ValKey cache store and the ValKey rate-limiter lock are cluster-aware,
and the flagship multi-tier cache is explicitly excluded from tag invalidation.

---

## 1. Distributed correctness

### 1.1 Cron has no leader election — every replica runs every job — ~~CRITICAL~~ **FIXED**

> **Closed.** Every scheduled execution is now claimed through a `CronRunLease` row whose key is
> unique, so the data source elects exactly one instance per tick. Wired through node-cron's
> `distributed` / `runCoordinator` options; the contract is `shouldRunExecution` on
> `CronServiceInterface`, so election can be replaced without reimplementing the service.
> Proven by `src/__testing__/evaluation/cluster/cron.cluster.test.ts` — three replicas, grouped by
> scheduled tick, exactly one writer per group. That test failed with all three instances in every
> group before the fix and passes after it.
>
> Election is **not** unconditional, and getting that wrong was caught while fixing it: a first
> pass made every job coordinate, which silently broke the three framework jobs that are per replica
> by nature — `CollectMetricsCronJob` reads this process's own prom-client registry and this host's
> network counters, `FormDataBodyParserCleanupCronJob` clears this container's own temp folder, and
> the default rate limiter store is in memory. Electing one instance for those means the other
> replicas are never collected and never cleaned up, which is a slow disk fill rather than an error.
> `InitialCronConfig.distributed` now expresses the difference, defaulting to `true`.
>
> Two details worth keeping:
> - the key is `<job name>:<scheduled time>`, not the job name, so a replica jittered by
>   `maxRandomDelay` still competes for the tick it was scheduled for instead of colliding with the
>   next one. No TTL tuning against the schedule period is needed.
> - the claim is a plain unique `INSERT`, not a compare-and-swap, because `Repository.updateAll`
>   cannot express one — see [01 §M12](./01-data-layer.md).
>
> The lease TTL is `ZIBRI_DI_TOKENS.CRON_EXECUTION_LEASE_IN_MS` (5 min default) and exists only to
> recover an execution whose instance died mid-run.

The original finding, for the record:

`src/cron/cron-job.model.ts:153`

```ts
this.task = cron.createTask(this.entity.cron, this.runOnTick.bind(this), { maxRandomDelay: Ms.SECOND });
```

`node-cron` v4's `TaskOptions` exposes `distributed`, `runCoordinator`, `distributedLease`,
`noOverlap` and `timezone`. Zibri passes **only** `maxRandomDelay`. `CronService`
(`src/cron/cron.service.ts:50-64`) has no lock, no lease, no coordinator, and `CronJobEntity`
(`src/cron/cron-job-entity.model.ts`) has `lastRun` but no `lockedBy` / `lockedUntil`.

Four replicas × `SendQueuedEmailsCronJob` (every 5 s), `LogCleanupCronJob`, `EventCleanupCronJob`,
`CollectMetricsCronJob`, plus every customer billing/report/sync job = four concurrent executions.
`maxRandomDelay: 1000` spreads them over one second; that is not mutual exclusion. Any job that
charges a card, files a report, or posts to a partner API does so N times.

The distributed primitive is one constructor option away in the library already depended on, and
it is not wired through.

### 1.2 Cron registration races on boot — ~~CRITICAL~~ **FIXED**

`src/cron/cron-job.model.ts:176-177`

```ts
return await this.cronJobRepository.findOne({ where: { name: this.fullInitialConfig.name } }, false)
    ?? await this.cronJobRepository.create({ ...this.fullInitialConfig, ... });
```

Read-then-insert with no upsert and no `ON CONFLICT`, while `name` is
`@Property.string({ unique: true })` (`src/cron/cron-job-entity.model.ts:15`). A rolling deploy
where replicas boot simultaneously → both `findOne` miss → both `create` → unique violation → the
losing replica throws during `afterAppInit` and **fails to start**. Invisible until the table is
empty (first deploy, DR restore, fresh staging environment).

> **Fixed**, and confirmed exactly as predicted: `duplicate value for property "name" violates unique
> constraint` out of `resolveEntity`, with the losing replica reporting `boot-failed`. It surfaced in
> `cluster/migrations.cluster.test.ts` rather than in a cron test, because that suite is the one that
> boots replicas simultaneously against an empty table.
>
> **`upsert` is not the fix here**, which is worth recording because it is the obvious reading of the
> entry above. The stored row is runtime-authoritative, not code-authoritative: `initTask` schedules
> from `entity.cron`, `entity.active` gates execution, and `activate`/`deactivate`/`changeCron` write
> to those columns at run time. An upsert whose conflict path wrote the code config back would undo
> every runtime change on the next boot — deactivate a job, restart a replica, and it returns active.
> No column is safely code-owned, so there is no honest `onConflict` to write. What this needs is
> get-or-create, which is a different operation.
>
> So it is a lease, taken once around the whole registration loop in `CronService.afterAppInit` —
> `'wait'` rather than `'skip'`, because a replica that gave up here would start with no cron jobs at
> all. One grant per boot rather than one per job, bounded by
> `ZIBRI_DI_TOKENS.CRON_REGISTRATION_LEASE_IN_MS`. The lease's own acquisition is a unique insert
> whose loser is caught and retried, so this does not move the race, it ends it.
>
> Latent since before this work, and reproduced reliably only after `LeaseCleanupCronJob` made it a
> tenth job — one more sequential round trip per replica was enough to widen the window from rarely
> to always.

### 1.3 `runOnInit: true` is the default — ~~CRITICAL~~ **FIXED**

`src/cron/cron-job.model.ts:86-92` — `initTask` (`:157-159`) executes the job immediately on boot.
Every pod restart, scale-out event and rolling deploy fires **every** cron job on **every** new
replica, outside its schedule. A ten-pod rolling deploy fires each nightly job ten extra times.

The safe default is `false`; Zibri's framework-internal jobs all override it
(`send-queued-emails.cron-job.ts:15`, `event-cleanup.cron-job.ts:16`,
`collect-metrics.cron-job.ts:15`) — the authors knew, and left the dangerous default for user code.

> **The default flipped, and that turned out to be the smaller half.** `task.execute()` runs what it
> is given without asking anybody, so `runOnInit` bypassed the run coordinator outright — opting in
> gave one execution *per replica* no matter what `distributed` promised. A default cannot fix that;
> anyone who wanted a startup run still got ten of them.
>
> The startup run is now elected like any other. What made that possible is finding something every
> replica agrees on without talking: node-cron exposes `getNextRun()` but no previous run, and the
> **upcoming** slot is identical across every instance of one rolling deploy. So the claim is keyed
> `cron:<name>:startup:<next scheduled time>` — deliberately apart from that slot's own key, because
> the startup run happens *ahead of* the slot rather than instead of it, and taking its key here would
> silently cancel the scheduled run. An instance restarting a week later computes a different slot and
> runs again, which is the whole point of the option. `distributed: false` skips the election, because
> per-instance work has to happen on every instance. Held by `cron.test.ts` for two jobs asking at
> once, and by `cluster/cron-startup.cluster.test.ts` for instances booting after the first.
>
> **The claim outlived nothing, which the todo audit found.** It was held for
> `CRON_EXECUTION_LEASE_IN_MS`, five minutes by default, while the key it guards means something until
> the slot it names. A lapsed grant is deleted by the next acquirer, so every instance a slow rolling
> deploy started more than five minutes after the winner took the same key again and repeated the run -
> the key was right, and only its lifetime was wrong. It is held until that slot now, never less than
> the execution lease. The cluster test waits past a one second lease before scaling out to three,
> which is exactly the deploy that used to run it three times.
>
> **The window it does not close:** an instance booting in the gap after a slot fires and before the
> next is computed sees a different key and runs a second time. It fails toward one extra execution
> rather than N, and the window is one schedule period wide — a day for a nightly job. A `runOnInit`
> on a job that fires every second is the case where this is bad, and it is also the case where the
> option means nothing.
>
> **Also fixed while here, because the flip alone was inert:** `resolveEntity` read the row and never
> looked at the class again, so `runOnInit` and `stopOnError` were frozen at first boot. Flipping the
> defaults would have reached new installs only — every deployment that had already booted kept the
> dangerous values, which is to say the deployments that have been running longest. Those two now
> follow the class on every start; `cron` and the state stay operator-owned. See 2.1 for the state
> half of that.

### 1.3b Scheduled work starts before the app is listening — ~~MAJOR~~ **FIXED**

`CronService` implements `AfterAppInit` (`src/cron/cron.service.ts:40,50`), and `afterAppInit` runs
inside `init()` (`src/application.ts:176`). `start()` only runs `onAppStart` hooks and binds the port
(`:198-219`). Cron therefore begins firing at the end of `init()` — **before the http server is
listening**, so before any readiness probe could pass and before an operator could route to the pod
or decide to abort the deploy.

Consequences:

- a pod that never becomes ready, or is rolled back, still runs the nightly billing job
- there is no seam between "connected" and "doing scheduled work", so the standard "boot paused,
  enable once the cluster is assembled" pattern cannot be expressed at all
- combined with 1.1, a rolling deploy has a window where old and new replicas are both firing

Found while building the cluster harness: the first instance was already firing a job on a schedule
while the other two were still booting, which is why
`src/__testing__/cluster/start-test-cluster.function.ts` has to offer `clearMarks()` — there is
nothing later to wait for.

> **Worse than filed, and that is what made it a new hook rather than a move.** `onAppStart` also runs
> *before* `this.server.listen(port)` (`application.ts:238-244`), so there was no hook anywhere that
> ran after the app was reachable — the obvious fix, moving cron one phase later, had nowhere to move
> it to. `AfterAppStart` is now that seam, and it is the answer to the finding's own complaint that
> "there is no seam between connected and doing scheduled work".
>
> **Cron splits along it.** Registration reads and creates rows, so it stays in `afterAppInit` where
> the data source is up. Firing moved to `afterAppStart`: `CronJob.init` builds the node-cron task
> without starting it, and a new `CronJob.start` performs the startup run and puts the job on the
> schedule. An instance that never becomes ready, or is rolled back, is now also one that never ran
> the nightly billing job. `cronService.schedule()` still does both at once, because it is called by
> an application that is already up.
>
> **`start()` waits for the socket rather than for `listen` to return.** `listen` only asks; the
> socket opens an event later and a failed bind announces itself on the server rather than throwing
> where it was called. Two things fall out: the hook means *reachable* rather than *asked to be
> reachable*, and a bind that fails now rejects `start()` **before** `markAppAsStarted` — which is
> exactly the wrong state the comment at `application.ts:231-234` was written about.
>
> **A docs correction came with it:** `docs/application-lifecycle.md` described `OnAppStart` as
> running "once the app starts listening", which was never true. That belongs to 07 in spirit; it is
> fixed here because this change is what gives the sentence a hook it *is* true of.
>
> **Same shape, not touched:** `EventService.onAppStart` replays unfinished events, which is also work
> beginning on an instance nothing can reach yet. It is a different subsystem and a different
> finding — noted rather than changed.

Scheduling belongs in `onAppStart` at the earliest, and ideally behind an explicit enable.

Held by `src/__testing__/evaluation/bootstrap.evaluation.test.ts`. It asserts on a job that has
actually *run* rather than on one that was merely registered — `runOnInit: true`, the framework's
own default, is what turns "scheduled" into "fired", and a fix that moved registration without
moving the start would otherwise read as closed. The shared test providers replace `CRON_SERVICE`
with an inert stub, so the test has to put the real one back before there is any timing to observe.

### 1.4 The "durable event system" does not cross processes — ~~CRITICAL~~ ~~MOSTLY FIXED~~ **FIXED**

> **Closed for delivery and exactly-once; see 1.4b for what remains.**
>
> `EventSubscriberRun` is now a *claim* rather than a record. It carries a unique
> `claimKey` (`<eventId>:<subscriberId>`), a `lockedUntil` and a `finishedAt`, and the row is
> written **before** the hook runs — so every replica hosting that subscriber races to insert it and
> exactly one wins. A subscriber that sends a mail now sends one mail no matter how many replicas
> host it.
>
> `finishedAt` is what marks a run done, not the row existing. Without that distinction, claiming
> upfront would mark an event finished while a subscriber was still working on it. The rxjs filters
> were changed for the same reason: they skipped on *any* run existing, which after this change
> would mean an expired claim is never retried by anyone.
>
> `EventDispatchCronJob` polls for unfinished events and is deliberately `distributed: false` —
> every instance polls so any can take over abandoned work, and *which* one runs is decided by the
> claim rather than by electing a single poller. Electing one would make recovery depend on that
> instance being alive and having the subscriber registered.
>
> Proven by `src/__testing__/evaluation/cluster/events.cluster.test.ts`: emit on one replica, SIGKILL
> it mid-hook, and require a survivor to finish the work exactly once. Before the fix nothing ever
> finished it.

### 1.4b `emit` only knows about subscribers in its own process — ~~MAJOR~~ **FIXED**

`src/event/event.service.ts` — `emit` still snapshots `subscriberIds` from the **emitting process's
local subscriber set**. There is no registry of subscribers in the data source, so an instance
cannot know what other instances subscribe to.

For an identical deployment — the normal case, every replica running the same image — the local set
equals the cluster-wide set and this is invisible. It bites a heterogeneous one.

**The exact shape, narrowed while writing the test.** The original wording said a `web` replica
emitting while only `worker` replicas subscribe "records an empty `subscriberIds`, and the event is
marked finished having been processed by nobody". The first half is right, the second is not: with
`subscriberIds: []` nothing ever finishes the event, so it stays un-FINISHED and the dispatch poll
on the workers *does* pick it up. `runHook` never checks `subscriberIds`, so that case now works by
accident.

The case that actually breaks is **two different logical subscribers** — the realistic split, where
the web tier audits an order and the worker tier mails it. `emit` records only the auditor
(`:101`), and `eventHasUnfinishedSubscriptions` reconciles that snapshot against the *emitter's own*
local subscriptions (`:419`) — both halves local. So the moment the auditor finishes, the emitter
concludes the event is fully handled and sets `FINISHED`. The workers' dispatch poll only looks for
events that are not finished, so the mail is never sent, and nothing reports a failure because as
far as the emitting process could tell, everything ran.

Fixing it means persisting subscriber registrations and reconciling them at emit time, which is a
larger change than the claim-based delivery above and was deliberately left out of it.

> **Fixed**, and it was exactly the change predicted above. `EventSubscriberRegistration` is a row
> per subscriber and event type, written by `subscribe` before it returns and refreshed on the
> dispatch poll. Both local reads are now deployment wide: `emit` snapshots the registry rather than
> the local set, and `eventHasUnfinishedSubscriptions` reconciles against it rather than against the
> emitter's own subscriptions. Fixing only the first would have left the second red, which is why the
> test asserts both directions.
>
> **Expiry is the part this entry did not anticipate.** A registry that only grows means a subscriber
> you delete holds every event it was recorded against open forever. So a registration lapses
> `EVENT_SUBSCRIBER_REGISTRATION_TTL_IN_MS` after the last instance hosting it stops refreshing. The
> same window is what makes a tier being briefly down safe rather than lossy: the registration
> outlives the outage, the events stay unfinished, and they are handed over when it returns. Too
> short and a slow deploy silently drops events; too long and a removed subscriber blocks cleanup.
> A trade rather than a tuning knob, and the one minute default is deliberately much larger than the
> five second dispatch poll that refreshes it.
>
> One row per subscriber rather than per instance, because replicas hosting the same subscriber are
> copies of it - whichever refreshes first keeps it alive for all of them, so the registration
> disappears only when none are left.
>
> `subscribe` and `subscribeAll` became async, so the row is written before they return rather than
> on the next heartbeat - an emit immediately after subscribing has to count it. Not a breaking
> change: `EventServiceInterface` already declared both as returning
> `EventSubscriptionInterface | Promise<EventSubscriptionInterface>`.
>
> **Expiry alone was not enough, found while writing its test.** A lapsed registration stops *future*
> events counting that subscriber, but did nothing for events already emitted while it existed. Those
> stay unfinished for good: a subscriber that has already run is filtered out before its hook, so
> `eventHasUnfinishedSubscriptions` - which only runs after a hook - never runs for that event again,
> and `EventCleanupCronJob` deletes only *finished* events. They accumulate silently and forever.
>
> Closed by having the dispatch poll reconcile as well as re-offer: it already walks exactly the
> unfinished events, so it now finishes any that nobody still owes a run. That also recovers an event
> whose every subscriber ran but whose emitter died before marking it, which nothing handled before.
> Chunked rather than serial or all-at-once - a backlog arrives here all at once by definition, since
> that is what a dead instance leaves behind, and matching the fan out to the backlog would make
> recovery worse than the outage.
>
> **What this costs a single process**, surfaced by `event.service.test.ts` going red on a test that
> predates the registry: `unsubscribe` does not delete the registration, so for up to the ttl every
> event emitted afterwards still counts that subscriber and stays unfinished. Deleting on unsubscribe
> was considered and rejected - one instance letting go says nothing about the others, and a delete
> another replica repairs on its next poll opens a window where emits omit a subscriber that does
> still exist. Missing an event is worse than finishing one late, so the row lapses rather than being
> deleted. The suite clears the registry per test, since each test invents a new subscriber id and
> none of them can wait a minute.
>
> Registering the new entity turned up that **`Lease` was never added to the `zibri new` scaffold**
> either, so a generated app would have failed `validateEntitiesRegistered` at boot ever since the
> lease fold landed. Both are in the template now.

Held by `src/__testing__/evaluation/cluster/heterogeneous-events.cluster.test.ts`, the only cluster
scenario whose replicas are not interchangeable. It asserts both directions, because a fix applied
to one role's emit path would leave the other red.

**Observed**, not merely predicted. Both tests fail on their second wait and pass their first: the
emitting replica's own subscriber runs, and the subscriber hosted only on the other replicas never
does — `last read []` after twenty seconds, which is four dispatch polls. Web-emits and
worker-emits fail identically, so this is symmetric rather than a property of one role.

The original finding, for the record:

`src/event/event.service.ts:44, 107-115, 137-141`

```ts
protected readonly eventSubject: Subject<Event<TEvents[keyof TEvents]>> = new Subject();
...
const event = await this.eventRepository.create({
    type: String(type),
    subscriberIds: [...this.subscriptionForEvent[type] ?? [], ...this.subscriptionsForAll].map(d => d.id),
});
this.eventSubject.next({ ...event, eventSubscriberRuns: [] });
```

Delivery is an in-process rxjs `Subject`. The DB row is a *log*, not a bus — nothing polls it, no
LISTEN/NOTIFY, no outbox poller, no broker. `subscriberIds` is snapshotted from the **emitting
process's local subscriber set**.

Replica A emits `order.placed`; only A's handlers run. Replica B's handlers — same code, same
`subscriberId` — never fire, and because `subscriberIds` contains only A's ids,
`eventHasUnfinishedSubscriptions` (`:237-246`) reports the event complete. The event is marked
`FINISHED` having been processed once out of N.

### 1.5 Restart replay is per-replica and duplicates — ~~CRITICAL~~ **FIXED**

> **Closed.** The `onAppStart` replay is gone entirely, subsumed by `EventDispatchCronJob`. Where
> the replay had no claim and ran on every replica, the poller feeds events through the same claim
> as any other delivery, so a rolling restart of four pods replays the backlog once rather than four
> times. The dedupe row is now written *before* the hook rather than after, which is what closes the
> window all four replicas used to pass through.

The original finding, for the record:

`src/event/event.service.ts:79-92` — every replica runs this on `onAppStart` with no claim or
lease. A rolling restart of four pods replays the entire unfinished backlog four times
concurrently, and the `EventSubscriberRun` dedupe row (`:226-230`) is written only *after* the hook
completes, so all four pass the check and all four execute. Handlers must be idempotent; nothing in
the API, types, or docs says so.

### 1.6 Mail queue: N replicas send N copies of every email — ~~CRITICAL~~ **FIXED**

`src/email/email.service.ts:169-176`

```ts
protected async findMails(priority: EmailPriority, amount: number): Promise<Email[]> {
    return await this.emailRepository.findAll({ where: { status: EmailStatus.QUEUED, priority }, take: amount });
}
```

Plain `SELECT ... LIMIT n`. No `FOR UPDATE SKIP LOCKED`, no transition to a `SENDING` state, no
claim token, no worker id. `Email` has no lock, attempt or lease column, and status only changes
*after* `transporter.sendMail` returns (`:136-141`).

With the cron firing on all replicas every 5 s (§1.1), four replicas select the *same* ten rows and
send the same mail four times. Even within a single process, `onTick`
(`src/email/send-queued-emails.cron-job.ts:27-30`) is a `while` loop draining the whole queue,
`noOverlap` is not set, and the schedule is 5 s — a backlog taking longer than that to drain means
the next tick starts mid-flight and re-selects rows already in flight.

> **Closed** by the lease fold, [10 step 2](./10-leases-and-claims.md). Every mail is claimed under a
> lease keyed `email:<id>` before it is handed to the transport, taken as a batch through
> `withLeases`, so a replica that selects a row somebody else is already sending simply does not get
> it. That covers the single-process half too: the grant outlives the tick that took it, so the next
> tick re-selecting rows still in flight cannot claim them.
>
> Completion is `'retainOnError'` - a send that died halfway keeps its grant rather than being handed
> straight to whoever asks next, because the failure mode being prevented is a duplicate send and a
> half-finished send is exactly when one is most likely. The grant lapses on its own expiry, which is
> what still allows a genuine retry after a crash.
>
> `EmailSendClaim`, the bespoke table this used to need, is deleted.

### 1.7 Mail rate limiter defaults to in-memory — ~~MAJOR~~ **WITHDRAWN, mostly**

**"Not swappable" was wrong.** `EmailRateLimiter` is registered as
`ZIBRI_DI_TOKENS.EMAIL_RATE_LIMITER` with a `useClass`
(`zibri-di-providers.default.ts:103`), so replacing it with one built on
`RepositoryRateLimiterStore` is a provider override — the same answer as any other default. The
store is hardcoded *inside the default class*, not inaccessible.

Nor is the constraint hidden. `docs/rate-limiting.md` has a "Sharing limits across instances"
section stating plainly that `InMemoryRateLimiterStore` "only knows about the process it runs in, so
as soon as an app runs more than once every instance has its own limits", and gives the shared
alternative with its lock. That is the correct answer, documented in the right place.

Unlike caching there is no multi-tier rate limiter, so there is no local tier that a shared store
cannot fix. Choosing the store *is* the whole answer here.

**What is left is much smaller**, and it is a default-safety argument rather than a capability one:
a user who never reads that section gets a per-replica cap, and the failure mode — `maxEmailsPerHour:
500` on six replicas becoming 3000/hour to SES — is invisible until the provider throttles the
sending domain. The same "safe by default" reasoning that made cron coordinate by default would
point at defaulting the mail limiter to the shared store when a data source is available.

**And one real gap remains:** `ValKeyRateLimiterLock` is the only cross-instance
`RateLimiterLockInterface` that ships, so sharing limits requires ValKey even though
`RepositoryRateLimiterStore` works on any data source. `DataSourceInterface.withLock(key, fn)`
(added for [01 §C2](./01-data-layer.md) and [§1.11](#111-invoice-numbering-is-a-read-modify-write-race--critical-fixed))
has exactly the shape `RateLimiterLockInterface` requires, so a postgres-only deployment could have
correct shared limits with a small adapter. See E4 below for why that lock is not sufficient on its
own either.

### 1.8 Tag invalidation never reaches multi-tier caches — ~~CRITICAL~~ **FIXED**

> **Closed.** The root cause was not the double filter itself but what forced it: `MultiTierCache`
> had **no `tags` property at all**, so `c.tags` was `undefined` and it could not be matched against
> an invalidation. Excluding it was the only thing that could be done with the shape it had.
>
> It now reports the tags of its tiers — `'all'` if any tier is `'all'`, otherwise their union — and
> gains its own `invalidateTags`, which goes to the tier stores directly. `CacheService` no longer
> special-cases it.
>
> Going to the stores rather than back through the cache service is what stops the loop: that is
> exactly what `safeInvalidateTags` did, and why the existing path was a no-op that looked like it
> did something.
>
> Held by `src/__testing__/evaluation/caching.evaluation.test.ts`. Making a multi-tier cache
> invalidate its own tiers at all was the precondition for §1.9, which carries the same invalidation
> across processes.

The original finding, for the record:

`src/caching/cache.service.ts:87-90`

```ts
const affectedCaches: AnyCache[] = this.caches.filter(
    c => !(c instanceof MultiTierCache) && (c.tags === 'all' || matchesAnyTag(c.tags, tags))
);
await Promise.all(affectedCaches.map(c => c instanceof MultiTierCache ? undefined : c.store.invalidateTags(tags)));
```

`MultiTierCache` is filtered out twice and nothing else invalidates its tiers.
`MultiTierCache.safeInvalidateTags` (`src/caching/cache/multi-tier.cache.ts:283-288`) delegates back
to `cacheService.invalidateTags`, which skips it — a no-op loop. `@CacheInvalidate` against a
multi-tier cache **silently does nothing** and serves stale data until TTL.

Two tests cover this, because there are two independent halves:

- `src/__testing__/evaluation/caching.evaluation.test.ts` — in process. Stores a value under a tag
  through a multi-tier cache, invalidates that tag, and requires the next read to reach the origin.
- `src/__testing__/evaluation/cluster/caching.cluster.test.ts` — across replicas, for §1.9. Both
  instances read the value, one of them invalidates, and the *other* must stop serving the old one.
  It contains a control assertion that the invalidating replica does see the new value, so a red
  can be attributed to the cluster rather than to a broken fixture.

The cluster half needs a channel that leaves the process — postgres `LISTEN`/`NOTIFY`, valkey
pub/sub, or a version epoch stored where every replica reads it. Unlike cron and events, which were
closed with a unique `INSERT`, there is nothing to claim here: the problem is notification, not
mutual exclusion.

### 1.9 A local cache tier is never invalidated on the other instances — ~~MAJOR~~ **FIXED**

> **Closed.** `invalidateTags` now does two things: it clears this instance's caches, then writes a
> `CacheInvalidation` row. Every instance runs `CacheInvalidationCronJob` and applies the rows it has
> not seen to its own local tiers.
>
> **The cron job is deliberately `distributed: false`,** which is the opposite of every other cron
> job the framework ships. Electing one instance is right when the work happens *somewhere* — a
> cleanup, a report. Here the work is per instance by definition: every replica has its own L1 to
> clear, so electing one would clear that one's caches and leave the rest exactly as stale as before.
>
> Rows are tracked by **id, not timestamp**. Instances do not share a clock, and comparing one
> instance's `at` against another's idea of now is how a notification gets skipped entirely. The
> applied set is pruned to the rows that still exist on every poll, so it cannot grow without bound,
> and rows are deleted once older than `CACHE_INVALIDATION_RETENTION_IN_MS`. An instance down for
> longer than that starts with empty local caches, so there is nothing for it to have missed.
>
> Invalidation is now **eventually** consistent across a deployment rather than immediate, bounded by
> the poll interval. That is a property of the design rather than a defect — `docs/caching.md` and
> `docs/replication.md` say so — but it is the reason a cache holding something that must never be
> served stale for two seconds wants a shared single tier instead.
>
> `CacheInvalidation` has to be registered in a data source whenever an app has any cache; the boot
> check names it. The sandbox and the `zi new` scaffold both declare a cache and both had to be
> given the entity — the same parity gap `Lease` and `EventSubscriberRegistration` left, and the
> third time [§T4](./06-tooling-ci-and-testing.md)'s point has been proven.

The original finding, for the record:

**Narrowed from the original filing, which overstated it.** A single-tier cache backed by
`ValKeyCacheStore` has no cross-instance staleness at all: the values live on the server, so
invalidating on any instance removes them for everybody. That is a supported configuration and the
right answer for a cache that has to be coherent. `InMemoryCacheStore` going stale on other replicas
is not a defect either — an in-memory cache *is* per process, and the answer is to choose the other
store.

What remains is the case a shared store cannot fix:

**Multi-tier caches, which is the pattern multi-tier exists for.** The canonical setup is a fast
in-memory L1 over a shared ValKey L2. Invalidating on replica A clears A's L1 and the shared L2 —
and B's L1 keeps answering with the old value for the full TTL. The whole point of L1 is that it is
local, so no store choice removes this. Every serious multi-tier cache ships an invalidation channel
for exactly this reason; Zibri has none, and `docs/caching.md` does not mention the constraint.

`EncryptionKeyCache` defaults to an in-memory store, but that is **not** part of this finding: it is
registered as `ZIBRI_DI_TOKENS.ENCRYPTION_KEY_CACHE` with a `useClass`, so replacing it with a
ValKey-backed one is a provider override. Same answer as any other single-tier cache.

The fix is a notification channel that leaves the process. Unlike cron and events this is not a
locking problem: nothing needs to be claimed, every instance needs to be *told*. Options are
postgres `LISTEN`/`NOTIFY`, a valkey pub/sub channel, or a short-lived table every instance polls.

### 1.10 Websocket broadcasts are process-local — ~~CRITICAL~~ **FIXED**

> **Closed.** `WebsocketOptions.adapterDataSource` names a data source, and the service builds a
> socket.io adapter from it. Broadcasts now reach clients on every instance.
>
> **Broken and repaired again while making socket.io optional, which is worth recording because of
> how it was found.** [§5.1b](#51b-three-of-the-four-optional-peer-dependencies-are-not-optional--major-fixed)
> made the server start only for an application with websocket controllers. The cluster instance
> options for *this* finding declare none — they broadcast from an http route and the clients only
> listen — so both instances came up with no socket.io server at all and the test failed with
> `xhr poll error`, a client unable to reach a server that was never started. Nothing in the normal
> suite noticed, because the shape only exists here.
>
> That is a real application shape rather than a quirk of the test: **push-only notifications are a
> websocket server that never handles an inbound event.** So a websocket controller is one
> declaration and `adapterDataSource` is the other — naming one says this deployment carries
> broadcasts between its instances, which only an application with a server has any use for.
>
> **Residue, and it is the user's call rather than a defect**: a single-instance push-only
> application declares neither, and still gets no server. Closing that means an explicit option,
> which is a public API question.
>
> **The original filing had one thing wrong and it mattered.** It said "rooms are a plain object",
> which would have meant an adapter could not help — an adapter fans out socket.io *rooms*, so a
> framework keeping its own bookkeeping instead would bypass the mechanism entirely. In fact
> `joinChannel` calls `connection.join(channel.name)` and `sendToChannel` calls
> `socketServer.to(channel.name).emit(...)`: real rooms, used correctly. The plain array is only
> the request/response path. So the gap was never the design — it was that `new Server(...)` was
> called with hardcoded options and no way to pass an adapter.
>
> That turned a subsystem rewrite into a seam plus a transport. `DataSourceWebsocketAdapter` extends
> socket.io's own `ClusterAdapter`, so heartbeats, acknowledgements, cross-instance socket lookups
> and own-message filtering are socket.io's implementation; Zibri supplies `publish`/`subscribe`
> over a data source and nothing else.
>
> `PubSubDataSourceInterface` is deliberately **separate from and optional to**
> `DataSourceInterface`, unlike `withLock`. Locking is needed to boot safely at all; publishing is
> only needed by features that have to tell the other instances something. A data source that cannot
> do it is perfectly usable, it just cannot back those features.

Two limits remain, the first documented in `docs/websocket.md`:

- **`sendToChannel` with `expectResponse: true` still only reaches this instance's clients**
  (`websocket.service.ts:466`), because that path iterates the local connections array rather than
  going through a room. Collecting responses from clients on other instances is not supported.
- **`connections` is still a plain array**, scanned with `.find()` on connect and
  `.find()` + `.indexOf()` + `.splice()` on disconnect — O(n) per connection event, O(n²) under
  churn. Carried over from [02 §C8](./02-http-runtime-core.md), which is otherwise closed. Adding
  an adapter makes this matter *more*, not less: clustering is what puts enough sockets on one
  instance for a reconnect storm to be worth surviving. A `Map` keyed by socket id is the fix.

**Reconnecting to another instance is closed.** The original finding was right that socket.io's
`connectionStateRecovery` cannot span instances — the adapter returns no offsets — but wrong that
this left a reconnecting client fresh. Message replay never depended on it: `recoverConnection`
reads the persisted `WebsocketMessage` rows with a sequence number above the one the client last
saw, out of the shared data source, so the messages themselves already crossed instances.

Room membership did not, and that was the real defect. `joinChannel` was only ever called
explicitly, so a user reconnecting elsewhere stayed in `channel.userIds` while belonging to no
socket.io room: the missed messages arrived, and every channel message *after* the reconnect
silently did not. `recoverConnection` now rejoins the channels of an authenticated user, reusing
the query it already ran for the replay, and does so *before* replaying — a message published in
between is then delivered live and replayed, which a client can drop on the sequence number, where
the other order would lose it outright.

Proven by `puts a reconnecting user back into the channels they already belong to` in
`websocket.service.test.ts`: a user joins a channel on one socket, that socket closes, a second
socket for the same user connects and never asks to join, and a `sendToChannel` has to reach it.
That is the same position as reconnecting to another instance, since the mechanism reads the shared
data source either way. An anonymous connection still has to rejoin, which is inherent — nothing
ties it to a channel.

**Only ValKey can back it today.** Postgres `LISTEN`/`NOTIFY` was considered and rejected for now:
its payload limit is 8000 bytes, which websocket broadcasts routinely exceed, and working around it
means spilling large payloads into a table. Failing loudly at startup on a data source that cannot
publish is better than truncating a broadcast at 8 KB.

### 1.11 Invoice numbering is a read-modify-write race — ~~CRITICAL~~ **FIXED**

> **Closed, in two steps.** The lock described below closed it for a caller passing no transaction.
> It did **not** close it for a caller passing one — and `transaction` is a parameter on the public
> `InvoiceNumberServiceInterface.generateInvoiceNumber`, so that is a supported way to call it. The
> write went through `updateById(..., { transaction })`, landing in the caller's transaction and
> becoming visible only on **commit**, which is after `withLock` returned. The next caller acquired
> the lock legitimately and read a counter whose increment was still uncommitted.
>
> **The lock is gone.** `getConsecutiveNumber` now claims its number with `Repository.atomicUpsert`,
> a single insert-or-increment statement the database performs atomically, so there is no window to
> interleave in and nothing to hold. It runs inside the caller's transaction, so an abandoned invoice
> rolls its number back rather than leaving a gap in the sequence — which is why a database sequence
> was rejected for this, and why committing the counter separately inside a lock was too.
>
> All three tests in `invoicing.evaluation.test.ts` are green, including
> *gives every caller its own number when each one runs inside its own transaction*, which was
> written against the lock-based version and stayed red until the upsert replaced it.
>
> The general rule this produced is recorded in [10 §10.4](./10-leases-and-claims.md): an application
> level lock and a database transaction have independent lifetimes, so an invariant spanning both is
> only as strong as the shorter one. `atomicUpsert` requires the identifying columns to be declared
> in `uniques` on the entity, and is `undefined` on data sources that cannot perform it, so the
> constraint is enforced rather than remembered.

> **How the first step worked**, for the record. `getConsecutiveNumber` ran inside
> `dataSource.withLock('invoice-number:<year>:<recipient>', ...)`, which covers the read, the
> increment and the write as one. Both halves are addressed: the update branch can no longer read a
> stale counter, and the create branch can no longer have two first-time callers each insert their
> own counter starting at 1.
>
> The key is deliberately narrow. Two customers numbered at the same time do not touch the same
> counter and have no reason to wait for each other — a single global key would serialize every
> invoice in the deployment, and would also queue behind schema setup during a deploy.
>
> This is the finding that turned `withSchemaLock` into a general `withLock(key, fn)` on
> `DataSourceInterface`. The mechanism already existed for [01 §C2](./01-data-layer.md); it was just
> hardcoded to one key.
>
> Held by the first two tests in `src/__testing__/evaluation/invoicing.evaluation.test.ts`, which
> drive the real service concurrently — no cluster needed, see below.

The original finding, for the record:

`src/plugin/invoicing/services/invoice-number.service.ts:99-120`

```ts
let numberOfInvoices = await this.numberInvoicesRepository.findOne({ where: { year: currentYear, recipientId } }, false);
if (numberOfInvoices) {
    numberOfInvoices.number++;
    await this.numberInvoicesRepository.updateById(numberOfInvoices.id, { number: numberOfInvoices.number, ... }, { transaction });
}
```

No `SELECT ... FOR UPDATE`, no atomic `UPDATE ... SET number = number + 1 RETURNING`, no unique
constraint on `(year, recipientId)`. `validateInvoiceNumber` (`:169-173`) is a check-then-act
TOCTOU.

Two concurrent invoice creations read `number = 41`, both write `42`, both emit invoice
`2026-AB-0042`. This plugin implements EN16931/XRechnung/Peppol
(`src/plugin/invoicing/services/conformance/en16931/`) — the jurisdictions mandating those formats
(DE GoBD, IT SdI) also mandate gapless, unique sequences. Duplicated or skipped invoice numbers are
an audit finding, not a bug report.

**Worse than filed: this needs no cluster.** The read and the write are separate `await`s, so two
concurrent requests interleave inside a *single* process. Every other finding in this section
requires more than one replica before it can hurt you; this one does not, which moves it out of
"problems at scale" and into "problems".

Covered by `src/__testing__/evaluation/invoicing.evaluation.test.ts`, which drives the real
`InvoiceNumberService` concurrently — no cluster harness involved. It asserts both halves: distinct
numbers for concurrent callers, and exactly one counter row afterwards. The second is the *create*
branch racing rather than the update branch, and it is a separate defect with the same cause: no
unique constraint on `(year, recipientId)` means concurrent first-time callers each insert their own
counter and every one of them starts again at 1.

Both need what [01 §M20](./01-data-layer.md) says does not exist. Unlike cron and events, this
cannot be closed with a unique `INSERT`: the counter already exists and has to be incremented, so
it needs an atomic increment or a row lock. This is the finding that makes adding one concrete
rather than speculative.

---

## 2. Robustness

### 2.1 `stopOnError: true` default permanently disables cron jobs, persisted — ~~CRITICAL~~ **FIXED**

`src/cron/cron-job.model.ts:220-227` — on error it writes `errorMessage` and, when
`stopOnError` (default `true`, `:89`), calls `disable()` (`:250-260`) which persists
`active: false` to the database. No retry, no backoff, no error budget, no auto-recovery.

**Compounding failure:** `SendQueuedEmailsCronJob.onTick` propagates any non-`TooManyRequestsError`
from `sendQueuedEmails` (`src/email/email.service.ts:96-101`), and `sendMany` uses `Promise.all`
(`:110`) so one SMTP timeout rejects the batch. **One transient SMTP blip permanently disables all
outbound email**, persisted so it survives restarts, requiring a manual `cronService.enable()` or a
SQL `UPDATE`. The same mechanism kills `LogCleanupCronJob` (unbounded log-table growth) and
`EventCleanupCronJob`.

> **`stopOnError` now defaults to false**, so a failing tick costs one execution rather than the job.
> That closes the compounding failure above on its own: an smtp server refusing connections for a
> minute is a logged error and a retry on the next tick.
>
> **The persistence was the deeper half, and `active: boolean` could not express the fix.** Being
> turned off by somebody who meant it and being taken off the schedule by a failure produced the same
> `active: false`, so nothing could undo one without also undoing the other — which is why the halt
> had to be permanent. `CronJobEntity.active` is now `state: CronJobState`
> (`ACTIVE` / `INACTIVE` / `STOPPED_ON_ERROR`) with a `previousState` recording where to return to.
> A start restores it: whatever made that start happen — a deploy, a failover, a configuration change
> — is the same class of event that would have fixed the failure. A job somebody disabled plants no
> `previousState` and stays disabled. `errorMessage` survives the recovery, so the failure is still
> readable rather than forgotten.
>
> **`initialConfig` keeps `active: boolean` and no user code changes.** The developer only ever says
> where the job begins; `CronJobState` is what it is doing later, which an operator changes and a
> failure can change on its own, and neither belongs in a class read once per boot. `CronConfig`
> therefore stops being a straight `OmitStrict` of the entity for that one field.
>
> **Not done, and named in the finding:** there is still no retry, no backoff and no error budget.
> `stopOnError: true` is a halt that a restart clears, not a circuit breaker — a job failing every
> tick still fails every tick.

### 2.2 Failed emails are silently deleted — ~~CRITICAL~~ **FIXED**

`src/email/email.service.ts:247-259` (the claim work moved the line numbers since the review) — a
**rejected** email with `persist: false` (the default, `:89`) is `DELETE`d. The record of the
failure is destroyed, leaving only a `warn` log line. No retry, no DLQ, no bounce table; the
`Email` entity has no `attempts`, `lastError` or `nextRetryAt` field. A password-reset or 2FA mail
rejected by the recipient MX is gone with no operational trail.

Narrowed while writing the test: this is specifically the **partial rejection** path. A send that
fails outright throws, `sendQueuedEmails` sets `leaveClaimsToExpire` and rethrows, and the row
stays QUEUED — that case is fine. The row is only destroyed when the server accepts at least one
recipient and refuses another, which is what nodemailer reports as `rejected` rather than as an
error. That is also the most common real bounce: one address in a list no longer exists.

Held by `src/__testing__/evaluation/email-failure.evaluation.test.ts`, which drives a real SMTP
dialogue against a socket-level stub that answers `550` for one recipient and `250` for the other.

**Confirmed**, and the two controls are what make it precise: a fully accepted mail drains the
queue, the *same* rejected mail with `persist: true` keeps its row with `status: FAILED` — so the
bounce is detected correctly — and the default `persist: false` leaves **zero rows**. The deletion
is the whole defect.

> **A failed mail keeps its row whatever `persist` says.** The flag was being asked the wrong
> question: it answers what to do with a mail that was *sent*, and a mail that was not sent has no
> business being deleted by it. The row is the only record that the mail was ever owed, so the fix is
> one branch — `FAILED` writes back and returns before the delete is ever reached.
>
> **`rejectedRecipients` on the entity**, because keeping the row is not enough on its own. The
> defining property of this path is that a server accepted *some* recipients and refused others, so
> `status: FAILED` alone says a message half-arrived without saying to whom. A row that cannot answer
> "which address" is a tombstone rather than a trail.
>
> **It is a record, not a retry.** `findMails` selects `status: QUEUED`, so a kept `FAILED` row is
> never picked up again — the change adds an operational trail without quietly inventing a retry loop
> nobody asked for. Pinned by a test that sends twice and asserts one row.
>
> **What it costs, stated in the docs:** failures now accumulate. Sending at volume needs a retention
> policy for the table, which the framework does not have and does not pretend to.
>
> **Still not there,** and named in the finding: `attempts`, `nextRetryAt`, an actual retry with
> backoff, a dead letter queue. Those are a delivery feature rather than a correction, and the defect
> here was destroying evidence, which no longer happens.
>
> **The test asserting those columns was retired to a comment**, found red while closing §5.2. It
> asked `Email` for `attempts` and `lastError` — the two things this fix decided against — so it
> would have stayed red forever describing something nobody intends to build, and its own comment
> still claimed a rejected mail gets deleted. That is the `README.md` "a comment where a case used to
> be" shape, and it is only legitimate because the decision is written down here.

### 2.3 Event handler retries have zero backoff — ~~MAJOR~~ **FIXED**

> Closed with [2.4](#24-a-permanently-failing-subscriber-marks-the-event-finished--major-fixed),
> because they are one defect seen from two sides: the loop could not wait, and the reason it could
> not wait is that a run had nowhere to be recorded as *unfinished*. See the note below.

`src/event/event.service.ts:211-220` — a tight loop with no delay, no jitter, no exponential
backoff, and a default `attempts` of **1** (no retry at all by default). With `attempts: 3` it
hammers a downed dependency three times within microseconds and gives up.

### 2.4 A permanently failing subscriber marks the event FINISHED — ~~MAJOR~~ **FIXED**

> **The evidence was already there and three readers ignored it.** `EventSubscriberRun` has carried
> an `error` column throughout, so the failure was written down — but `hasFinishedRun`,
> `eventHasUnfinishedSubscriptions` and the cleanup job all asked whether a *row exists*, not how it
> ended. A hook that threw was indistinguishable from one that returned, and the row proving it
> failed was deleted a day later along with the event. This is 2.2 in a different subsystem: not a
> missing record, a record nothing reads.
>
> **A boolean could not express the fix, the same way `CronJobEntity.active` could not express
> [2.1](#21-stoponerror-true-default-permanently-disables-cron-jobs-persisted--critical-fixed)'s.**
> "The run is over" is one
> question and "the run succeeded" is another, and every reader needed both.
> `EventSubscriberRunStatus` is `PENDING_RETRY` / `SUCCEEDED` / `FAILED`, and only the last two are
> endings. `EventStatus` gains `FAILED` for the same reason: an event nobody owes anything any more,
> where somebody gave up, is not a finished event and must not be deleted like one.
>
> **That is what let the tight loop go, which is 2.3.** The loop existed because there was nowhere
> to put a run that had failed but was not over - the row said the run happened, so it had to be
> written once, so every attempt had to happen before it. With `PENDING_RETRY` on the row the
> attempts can be spread: one per delivery, `nextRetryAt` doubling from
> `EVENT_RETRY_DELAY_IN_MS`, and the count on the row rather than in the process, because no single
> process sees all of them once restarts are involved. `attempts: 3` now means three attempts over
> minutes instead of three within microseconds.
>
> **No jitter, deliberately.** The lease already decides *which replica* runs an event, so the only
> spread jitter would buy here is between events that failed together - which is
> [2.5](#25-event-fan-out-is-unbounded-and-unordered--major), not this.
>
> **The retry cannot outrun the lease**, which is retained after a failed attempt for the reason
> [10-leases-and-claims.md](./10-leases-and-claims.md) gives. `EVENT_RETRY_DELAY_IN_MS` therefore defaults to the same minute
> `EVENT_EXECUTION_LEASE_IN_MS` does, rather than to a smaller number that would never decide
> anything.
>
> **The docs contradicted themselves and one half was already right.** Line 2 promised retries until
> every subscriber succeeded; line 103 accurately described the opposite. Line 2 is now true as
> written, with the honest qualification the behaviour needs - retried until each subscriber has
> succeeded *or spent all its attempts* - and the retention cost of keeping `FAILED` events is
> stated where 2.2's was.
>
> Held by `event.service.test.ts`, which asserts one attempt per delivery, that the event is not
> re-offered while the backoff runs, that a later attempt clears the error, and that spending the
> last one leaves the run `FAILED` and the event `FAILED` rather than `FINISHED`. The last of those
> is the finding: `event-cleanup.cron-job.test.ts` already pins the delete to `FINISHED` alone, so a
> `FAILED` event surviving cleanup follows from it.
>
> **The error was not readable either, which only came out when the row had to be written twice.**
> `error` was `@Property.unknown` typed as `Error`, and `unknown` is `jsonb` - an `Error`'s message,
> stack and cause are all non-enumerable, so the column kept `{}`. A row saying a failure happened
> and nothing about what it was is barely better than the row that used to say it had succeeded. It
> is a `LoggedError` now, the shape `LogContext` already stores, so the message and the chain of
> causes survive. Two more entities have the same declaration and are filed as
> [01 §M25](./01-data-layer.md#m25-an-error-stored-in-a-column-keeps--of-it--major).
>
> **Switching the write from `create` to `upsert` walked straight into
> [01 §M24](./01-data-layer.md#m24-upsert-cannot-see-relations-on-the-way-in-or-on-the-way-out--major)**,
> which predicts it exactly: `"EventSubscriberRun" has no property "event"`, because a postgres
> upsert is one statement built out of columns and a relation is not one. The create data names
> `eventId` now, which is what the finding recommends - and is one entity stepping around it rather
> than the finding being closed.
>
> **Still not there:** no replay-failures API, and nothing walks a `FAILED` event back to
> `CREATED`. The record is queryable and that is the whole of it.

`src/event/event.service.ts:222-234` — the `EventSubscriberRun` row is written **whether or not**
the hook succeeded, so a failed subscriber counts as "ran". Once all subscribers have a row the
event flips to `FINISHED` and `EventCleanupCronJob` deletes it after `cleanupAt`. No DLQ, no
failed-event queue, no replay-failures API.

`docs/events.md:2` claims events "are retried until every subscriber has successfully processed
them" — the code retries only within a single `runHook` invocation and then marks the event done
regardless of outcome. **Direct documentation-vs-code contradiction.**

### 2.5 Event fan-out is unbounded and unordered — ~~MAJOR~~ **FIXED**

> **Bounded by refusing to start, not by queueing.** An instance runs at most
> `EVENT_MAX_CONCURRENT_HOOKS` hooks at a time - 50, the number `PromiseUtilities` already chunks by,
> because it answers the same question. A hook over the limit is not started and not held anywhere.
>
> **That is only allowed to be the answer because the work is not the promise.** The event is a row
> that still owes that subscriber a run, and `EventDispatchCronJob` offers it again - so a hook that
> does not start is late rather than lost. An in-memory queue would have been a second copy of a
> queue that already exists, which is the mistake
> [2.10](#210-non-priority-jobs-are-lifo-and-starve--major-fixed) was made of.
>
> **The poll was the other half, and it was hiding.** `dispatchPending` read *every* `CREATED` event
> with its runs joined, then chunked the work - and the comment there claimed the chunking prevented
> "a fan out the size of that backlog". It did not: `eventSubject.next()` returns immediately, so
> chunking bounded the settled-status queries and nothing else. It now reads one bounded page, which
> the entity already orders oldest-first - the ordering that keeps a backlog under continuous
> emission from having a head that never gets read.
>
> **Ordering across events is still not guaranteed and is now written down as such.** Two events for
> one subscriber can be handled in either order and on either instance. Guaranteeing otherwise means
> serializing per subscriber, which is a different delivery model rather than a repair to this one.
>
> **What `emit` promises is narrower than it looks, and always was.** It resolves when the event is
> stored and owed, not when anything has run - which was already true of a subscriber living on
> another instance. The limit only makes it true of a busy local one too. `docs/events.md` says so.

The original finding, for the record:

`src/event/event.service.ts:141` — `.subscribe(e => void this.runHook(...))`. Fire-and-forget, no
concurrency cap, no queue, no ordering guarantee. A burst of 50k emits spawns 50k concurrent
handler promises, each holding a 30-second timeout timer and a DB write. Nothing applies
backpressure; `emit` resolves as soon as the row is inserted.

### 2.6 A crashed idle worker poisons the thread pool forever — ~~CRITICAL~~ **FIXED**

`src/multithreading/services/multithreading.service.ts:483-496`

When a worker with **no assigned job** exits — OOM kill, native segfault, an OS signal — the
handler emits on a subject and returns. The dead `ThreadJobWorker` is never removed from
`this.idleWorkers` and never replaced; recovery only happens in `freeWorker` (`:458-462`), reached
exclusively via `handleJobCompletion`, i.e. only for workers that *had* a job.

The next `startJobs()` picks the corpse (`:316` / `:341`), calls `postMessage` on a terminated
worker, the message goes nowhere, and the job hangs until timeout. Repeat until the pool is dead
and every submission times out. The service reports no error; throughput just goes to zero.

> **An exit with no job now takes the worker out of both lists and starts a replacement.** Recovery
> used to live only on the job-completion path, so it could only ever reach a worker that had been
> *working* — a worker that died idle completed nothing, and nothing looked.
>
> **The assumption was written down, which is why nobody saw it.** `handleWorkerExit`'s doc comment
> said *"This should only happen on shutdown"*. It is not true of an OOM kill, a native crash or a
> signal, and the comment is corrected rather than left to mislead the next reader.
>
> **Three states, not a boolean, and the third is one this fix would otherwise have introduced.**
> `onAppShutdown` terminates every worker, and each termination fires the same exit — so "replace a
> dead worker" would have spawned threads while the process was trying to end, keeping it alive.
> `poolState` distinguishes *starting* (tell the subject, so startup fails rather than comes up with a
> pool it cannot fill), *running* (replace and log), and *stopped* (do nothing, this is what was
> asked for).
>
> **`freeWorker` had the same hazard** and is guarded with it: its `threadId === -1` recovery would
> equally respawn during shutdown. Pre-existing, unfiled, and the same failure — fixing one and not
> the other would have been arbitrary.
>
> Held by a test that terminates an idle worker directly and then runs a job with a **10 second**
> timeout. The real default is an hour, which is exactly how this ends quietly in production: nothing
> errors, throughput just stops.

### 2.7 Queued thread jobs are lost on restart — ~~MAJOR~~ **FIXED**

> **Recovery is on `onAppStart`, not `onAppInit`**, for the reason
> [1.3b](./04-infrastructure-subsystems.md) gives about cron: a pod that comes up and never becomes
> ready has no business working through the backlog. The finding asked for exactly this hook and was
> right to.
>
> **Two halves, because a shutdown and a kill leave different evidence.** A `ThreadJobStatus` of
> `INTERRUPTED` is written to everything still running before the workers stop, so the graceful case
> - every deploy and rolling restart - is exact and needs no judgement: those rows are free the
> moment anything starts. It is its own state rather than putting the job back to `IN_QUEUE` because
> a job that ran halfway and a job that never started are not the same thing, and `startedAtMs` and
> `progress` are kept as the record of how far it got.
>
> **A killed process writes nothing**, so its rows stay `IN_PROGRESS` - which is the finding's "stuck
> forever with no reaper" and looks identical to work another instance is doing right now. What
> separates them is already on the row: a healthy owner enforces the job's own `timeout`, so a row
> older than that means nobody is enforcing anything. No ownership column, no second claim.
>
> **Not a drain.** A job's default timeout is an hour and a pod's grace period is seconds, so waiting
> was never on offer; what was, is leaving the row true.
>
> **This is at-least-once and the docs now say so.** Telling a crashed owner from a live one exactly
> needs an owner column and a per-job heartbeat, so a takeover happens the moment renewal stops. That
> is a feature with its own semantics rather than a repair, and it is deliberately not in here.
>
> **[2.9](#29-eval-of-function-source-in-worker-threads--major-fixed) had to land first.** Recovery
> means re-running a job from its row, which was only well defined once a persisted job was
> guaranteed to name a file - re-running one would otherwise have meant rebuilding stored source into
> code, which is the thing 2.9 removed.
>
> The sweep runs under a lease in `skip` mode, so instances starting together do not each queue the
> same rows. Held by a test that plants both kinds of `IN_PROGRESS` row - one past its timeout, one
> not - restarts the application through the real lifecycle, and asserts the first runs and the
> second is left alone.

> **The deferred half was closed with [2.10](#210-non-priority-jobs-are-lifo-and-starve--major-fixed).**
> The owner and heartbeat this record calls a feature turned out to be a `withLease` call: the lease
> service already renews a grant underneath work that outlives it, which is a heartbeat by another
> name. Taking one per job for the whole of its run replaced the timeout judgement above entirely.
> The `INTERRUPTED` status stayed, and got better - the grant is handed back with it, so the graceful
> case is a handover rather than a shorter wait.

`MultithreadingService` implements only `OnAppInit` and `OnAppShutdown` (`:46`). `queueThreadJob`
persists a `ThreadJobEntity` (`:149-161`) but there is **no `onAppStart` recovery** that reloads
`IN_QUEUE` / `IN_PROGRESS` rows. `onAppShutdown` (`:275-286`) terminates workers without draining,
and `waitForThreadJob` (`:253-259`) throws if the job isn't in the local array. A pod restart
abandons the in-memory queue and leaves rows stuck at `IN_PROGRESS` forever with no reaper. The
table looks like a durable queue and behaves like a write-only audit log.

### 2.7b A consumer's own file is loaded with `require` — ~~MAJOR~~ **FIXED**

> **Closed by raising `engines` to `>=24`, and then by the half that no version fixes.**
>
> **The version was the larger part.** `require(esm)` is the default from node 22.12, so on a
> supported runtime `require` loads TypeScript, commonjs and es modules alike and the failure this
> finding names cannot happen. 24 rather than 22.12 because it is the current LTS, and rather than
> 23 because 23 is already end of life - the meaning of `>=23` is "24 or newer" with the 22 LTS
> excluded for nothing. CI now runs the version the package claims.
>
> **`await import()` would not have worked, and this is the part worth keeping.** The package is
> compiled with `module: commonjs`, and TypeScript rewrites a literal `await import(x)` into
> `require(x)` under that setting - verified by compiling one. The fix the finding proposed would
> have shipped as the call it was meant to replace, and passed review by reading correctly in the
> source. Where a real dynamic import is needed it is built through `new Function`, which the
> compiler cannot see through, exactly as [2.9](#29-eval-of-function-source-in-worker-threads--major-fixed)
> builds a function it must not let the compiler touch.
>
> **What no node version fixes, part one: an es module worker file ran once per thread.** A thread
> job *is* the top level code of its file, and one thread runs many jobs, so the worker drops the
> file from `require.cache` before each one. An es module cannot be dropped from anything - the
> loader's registry is keyed by url with no way to remove an entry - so the second job on that thread
> got a module that had already run: nothing reported, and the job sat until its timeout while the
> first had worked perfectly. Verified rather than reasoned about: after `delete require.cache[p]`, a
> second `require` of an `.mjs` file did not re-run its top level code on node 24. Such a file is now
> re-imported under a url the loader has not seen, which does run it again - at the cost of a module
> copy per run that nothing can evict, paid only by files that are es modules.
>
> **Part two, and the one that mattered: the job's data never reached it.** Fixing the re-run turned
> a job that timed out into a job that answered with the *previous* job's result, which is worse.
> `workerData` means "what this thread was started with", and a pooled thread runs many jobs, so the
> worker overwrote that binding per job. A commonjs or TypeScript file compiles
> `import { workerData }` to a property read where it is used, so it sees the overwrite. An es module
> binds to the module's *namespace*, which node builds once by copying the values out - so every job
> after the first read the first one's data. The hand-off was the broken part, not the loading.
>
> **Fixed by mutating that object rather than replacing it**, since what the namespace snapshot
> copies is a reference. The thread is started with an empty object and each job empties and refills
> it, which all three kinds of worker file read identically - so nothing was added for a consumer to
> know about, and the `@ts-ignore` that reassigned an imported binding is gone. The data is always an
> object to mutate: a queued job has to name the file it runs, and a `run` call carries the caller's
> input inside `{ func, input }`.
>
> **Top level await is supported rather than documented away.** `require` refuses an async module on
> every node version, so that error is caught and the file is imported instead - the same path the
> re-run uses, which had to exist anyway.
>
> Verified against the built worker directly, without the pool or a container: an `.mjs` fixture run
> twice on one thread answers for the job it was given each time, a top level await one does too, and
> a TypeScript fixture on that same thread afterwards still works.
>
> **The second call site needed nothing, and the finding was wrong about it.**
> `generateEntityFiles` returns early unless the providers file is `.ts`, which reads like three of
> the four extensions `resolveProvidersPath` looks for being silently ignored. It is not: what this
> generates is TypeScript source into the source tree, so resolving to a `.js` providers file means
> it is looking at build output - where the entities it would generate already exist. Doing nothing
> is the answer there, and a test said so before this was touched. Removing the guard was written and
> reverted; only the comment explaining it stayed.
>
> Held by a test that runs an `.mjs` worker file twice on a one-thread pool, where the second run is
> the assertion.

The original finding, for the record:

*Opened while closing [05 §P1](./05-di-metadata-and-packaging.md), not part of the original review.*

The framework loads a file the *application* wrote in exactly two places, and both use `require`:

- `src/multithreading/services/worker/thread-job.worker.ts:74` — `require(workerData.filePath)`,
  the entry point of a thread job.
- `src/entity/generation/generate-entity-files.function.ts:24` — `require(providersPath)`, the
  application's providers file, for entity generation.

An application that authored either as ESM — a `.mjs` file, or a `.js` file under
`"type": "module"` — gets `ERR_REQUIRE_ESM` on Node 22.0 through 22.11. `require(esm)` only became
default in 22.12, and `package.json` declares `"engines": { "node": ">=22" }`, so the supported range
includes versions where this cannot work.

Worth being precise about what this is *not*: it has nothing to do with which format `zibri` itself
ships. A dual build would have failed here identically, because the failure is about reading the
consumer's file, not about resolving the framework's. The fix is `await import()` at both call sites,
which needs the worker's synchronous `importWorkerFile` to become asynchronous and its error path to
follow.

### 2.8 Worker `uncaughtException` does not terminate the worker — ~~MAJOR~~ **FIXED**

> **The handler ends the worker now**, which is what node's own guidance says it has to do. What was
> being handed to the next tenant of that thread is everything the throw left half done - module
> scope, the `functionCache`, whatever a job was in the middle of - and none of it is visible from
> the outside.
>
> **Reporting and exiting are both needed, and the order matters.** The parent's exit handler can
> only say the job failed; the *message* is what carries the error itself and reaches the job's
> `onError`. So the worker reports first and exits a turn of the loop later, rather than exiting and
> letting the exit code speak.
>
> **Which introduced [2.6](#26-a-crashed-idle-worker-poisons-the-thread-pool-forever--critical-fixed)
> through a new door, and is the part worth recording.** An error message makes the parent settle the
> job and *free the worker* - back onto the idle list, in the moment it has left before the exit
> arrives. `startJobs` runs immediately after, so the very next job is posted to a thread already on
> its way out. That is the same "post to a corpse" 2.6 closed, reached from the other side.
>
> The parent cannot work out on its own that a worker is dying, so the message says so: an error
> message carries `fatal`, and a fatal one settles the job **without** freeing the worker. The exit
> that follows is what takes it out of the pool and starts the replacement, through the path 2.6
> already built. `handleJobCompletion` splits into `settleJob` + `freeWorker` + `startJobs` for it.
>
> Held by a test with a **one thread** pool - the fixture throws from a timer, where nothing in the
> worker can catch it, and a second job runs afterwards. With one thread there is nowhere else for
> that job to go, so a worker that should have been replaced and was not means it hangs until its
> timeout, which is an hour. Same shape as 2.6's test, and the same reason: nothing errors,
> throughput just stops.
>
> `unhandledRejection` gets the same treatment. It is node's own default since v15, and the argument
> is identical - something asynchronous failed halfway through in a context the next job inherits.

`src/multithreading/services/worker/thread-job.worker.ts:23-30` reports the error to the parent and
keeps running with corrupted state; `freeWorker` then returns it to `idleWorkers` for the next job.
Node's own guidance is that an `uncaughtException` handler must exit. A job that dies mid-mutation
leaves module-level state (including the `functionCache` at `:19`) inconsistent for the next
tenant's job.

### 2.9 `eval` of function source in worker threads — ~~MAJOR~~ **FIXED**

> **The sink was never the problem on its own - what fed it was.** Source that came from
> `func.toString()` in this process, this run, is source this process already had. Source read back
> out of a column is a different thing wearing the same type, and that is the whole of the finding:
> write access to `ThreadJobEntity` was write access to a worker thread.
>
> **So a function is no longer something a job can be persisted with.** `queueThreadJob`,
> `runThreadJob` and `rerunThreadJob` take a file path; `run` keeps taking a function and was already
> the only path that never writes a row. The type says it and a runtime check enforces it, because
> the caller this matters for is the one not reading the types - `PersistedFunctionJobError` names
> `run` and names the file alternative.
>
> **Which is the same shape as [05 §D6](./05-di-metadata-and-packaging.md):** what has to outlive the
> moment it was written cannot be a closure, so it has to be something that can be named. There a
> factory's dependencies, here a unit of work. A job that survives a restart names a file for exactly
> the reason an async provider names its deps.
>
> **`eval` became `new Function`, which is a smaller change than it looks.** A captured variable is
> gone either way - it never entered the string - so the common case is a `ReferenceError` under
> both. What differs is a *collision*: a direct `eval` runs the source in the worker module's scope,
> so a function capturing a name that module also has (`message`, `workerData`, `functionCache`,
> `require`) silently resolved against the worker's and returned an unrelated value. Built outside
> that scope the name is absent, and a wrong answer becomes an error.
>
> Held by three tests: queueing function data is refused while `run` still works, and a function
> capturing a variable called `message` - a real binding in the worker module - now rejects where it
> used to resolve to `'initialization'` and say nothing.
>
> **Not addressed:** `run` still turns source into code, so a function assembled out of untrusted
> input is still code. That is now a documented property of one in-process API rather than a
> database-fed sink, which is the part a security review objects to.

`src/multithreading/services/multithreading.service.ts:195` (`func: func.toString()`) →
`src/multithreading/services/worker/thread-job.worker.ts:59`

```ts
fn = eval(`(${wData.func})`) as ThreadJobFunction<unknown, unknown>;
```

For `runThreadJob` that source string is **persisted in `ThreadJobEntity.workerData`** and
re-`eval`ed on `requeueThreadJob` / `rerunThreadJob` (`:217-235`). Anything with write access to
that table achieves RCE in a worker thread. It also silently breaks closures — a captured variable
produces a `ReferenceError` at execution time rather than a compile error. An enterprise security
review will not clear an `eval` sink fed from a database column.

### 2.10 Non-priority jobs are LIFO and starve — ~~MAJOR~~ **FIXED**

> **Closed, and not by fixing the sort.** The descending comparator was real and is gone, but a sign
> flip would have left the more interesting half in place: the order being decided in a *per process*
> array at all. `queueThreadJob` has always written a row, so the in-memory queue was a second copy of
> a queue that already existed - and it was the copy that decided what ran, which meant a job queued
> on one instance could only ever be run by that instance.
>
> **The queue is now the table.** Waiting jobs are selected with `order: { queuedAtMs: 'ASC' }` and
> `take`, so oldest-first is the store's job rather than a comparator's, and a job queued on a busy
> instance is picked up by whichever one has a worker free. What is left in memory is what genuinely
> cannot be stored: the jobs this process's workers are running, and the callbacks a caller handed in.
>
> **The claim is a `withLease` per job, held for the whole run.** This is the piece that made the
> rest possible, and it came from a primitive that already existed: `withLease` renews a grant
> underneath work that outlives it, which is exactly the per-job heartbeat
> [2.7](#27-queued-thread-jobs-are-lost-on-restart--major-fixed) deferred as a feature. So an
> `IN_PROGRESS` row is no longer judged by its own timeout - a live owner renews, a dead one lapses,
> and takeover is within 30 seconds instead of within the job's timeout, which defaults to an hour.
> Shutdown settles its running jobs so the grants are handed back rather than waited out.
>
> **A second bug went with it.** `startJobs` started exactly one job per call, which is only correct
> while every job arrives with a call of its own. That stopped being true the moment a backlog could
> arrive from the table: a poll finding fifty rows started one of them and left the rest of the pool
> idle. It now fills every free worker, one round at a time - rounds are serialized, because a round
> reads the table before it takes a worker out of the idle list, and two overlapping rounds would
> both hand the same worker a job.
>
> **`run(fn)` is the one thing that cannot move.** Its function exists only in the process that called
> it - persisting it would be [2.9](#29-eval-of-function-source-in-worker-threads--major-fixed) again
> - so it waits in memory and is ordered against the rows by `queuedAtMs` rather than being served
> before or after them as a class. The test for that queues the row first on purpose: the other way
> round, an implementation that simply serves what it can see locally would pass without ordering
> anything.
>
> **What the callbacks cost.** `onComplete` and friends are functions, so they fire only when the
> instance that queued the job is also the one that runs it. Named in `docs/multithreading.md` rather
> than worked around, because the alternative - serving a job with callbacks only locally - would
> reintroduce the per-instance queue for the subset of jobs that have one.
>
> **A generic queue primitive was considered and deliberately not built.** This is the second place
> in the framework doing *select the oldest rows in a status, claim each under a lease, write the
> terminal status back* - the mail queue is the first, and the event dispatch is arguably a third.
> That is the shape leases themselves were extracted from, after three hand-rolled copies existed.
> Here the shared core is thin and the differences are most of each caller: priority tiers and rate
> limiting for mail, per-subscriber retry and backoff for events, a worker pool with progress,
> timeouts and results here. The judgement was that an abstraction designed against one real caller
> and two guesses is worse than a third copy that proves whether the shape is actually the same.

The original finding, for the record:

`src/multithreading/services/multithreading.service.ts:337-340`

```ts
const waitingJob = waitingJobs.sort((a, b) => b.queuedAtMs - a.queuedAtMs)[0];
```

Descending — newest first. The priority branch three lines up (`:314`) sorts ascending. Under
sustained submission the oldest normal job is never selected: unbounded tail latency and
indefinite starvation from what is almost certainly a sign typo.

### 2.11 No catch-up semantics, no timezone — ~~MAJOR~~ **FIXED**

`CronJobEntity.lastRun` (`src/cron/cron-job-entity.model.ts:44-46`) is written on every tick
(`cron-job.model.ts:197-200`) and **never read** — nothing compares it against the schedule. A pod
down from 02:00–04:00 simply misses the 03:00 nightly job and will not run it until tomorrow, with
no alert. node-cron offers `missedExecutionTolerance` and `suppressMissedWarning`; neither is
wired. `timezone` is likewise never passed, so all schedules run in the container's local time with
no way to express "03:00 Europe/Berlin" — DST shifts every schedule by an hour twice a year, or
silently skips/doubles a 02:30 job.

> **Time zone.** A schedule is now the expression *and* the zone it is read in, both stored on the
> job. The default is **UTC** rather than the machine's zone: a local zone is part of the
> environment, which would make the same job fire at one moment on a laptop and another in
> production. It is set deployment-wide on the localize options, where the other locale-wide defaults
> already live, and overridable per job — which is what makes one deployment able to run the same work
> on the schedule each of its tenants expects.
>
> `Timezone` is a union of the 419 IANA names rather than `string`, built the same way `CurrencyCode`
> already was, so a typo is a compile error instead of a job that never fires.
>
> **Catch-up, and the obstacle that shaped it.** node-cron answers "does this date match" and can say
> when the *next* run is — there is no previous-run API and `getNextRuns` takes no base date. So the
> missed slot is **searched** rather than computed: backwards from now, a second at a time, stopping
> at whichever is nearer, `lastRun` or the job's limit. A job that has been running normally stops
> after a step or two; only real downtime is ever walked over. Adding a second cron library to get a
> `prev()` was rejected — two parsers that have to agree about DST, ranges and day-of-week semantics
> is a worse bug than a bounded loop, and the search uses the *task's own* matcher, so it cannot
> disagree with the schedule about what a slot is.
>
> **Opt-in, and bounded.** `catchUpWithinMs` on the job, unset by default. Whether late work still
> means anything is a property of the work and only the job knows: a nightly invoice run is worth
> doing at 06:00 when the outage clears, this minute's metrics are not worth doing at all. The value
> doubles as the lookback, which bounds the search and answers the other question — past some age a
> make-up run is a surprise rather than a service.
>
> **One run, not one per missed slot.** A week of downtime owes the last invoice run, not seven. A job
> that has *never* run catches up nothing: there is no point to measure "since" from, and treating a
> whole schedule as outstanding would fire every job on the first boot of every new environment.
>
> **The coordination fell out for free.** The claim uses the key that slot's own execution would have
> used — `<name>:<slot ISO>`, node-cron's own format — so a make-up run and a real one are the same
> event to the deployment: if any instance ran it, the key is taken and nothing happens. Held by
> `cron.test.ts`, where two instances back from the same outage make it up once between them.
>
> **Where it lives:** `CronService`, private. The service is the swap point for scheduling policy, and
> a first attempt that put the search in a standalone function with its own callback type was
> abandoned — nothing outside calls it, so it needed neither.
>
> **Not done:** `missedExecutionTolerance` and `suppressMissedWarning` are still unwired. They are
> about an execution that ran late within one process, which is a different question from a process
> that was not there.

### 2.12 Unbounded thread-job queue — ~~MINOR~~ **FIXED**

> **Dissolved rather than bounded.** An admission limit and a `ThreadJobQueueFullError` were written
> first and then thrown away: the array this describes no longer exists.
> [2.10](#210-non-priority-jobs-are-lifo-and-starve--major-fixed) moved the queue into the table, and
> a burst now grows a table rather than a heap - which is what a queue is supposed to do, and what the
> mail queue has always done.
>
> **Rejecting work would have been the wrong answer even with the array still there.** The rows were
> always being written; the heap held a *second* copy of them. A cap would have refused to queue work
> that the store had room for, and it would have had to refuse recovered work too - or admit that a
> backlog inherited from a dead instance can exceed the bound anyway, which is the case that matters.
>
> What is bounded now is what a single round reads: `take: 10` candidates per free worker, so a
> hundred thousand waiting rows cost the same as ten.

The original finding, for the record:

`private queue: ThreadJob<...>[] = []` (`multithreading.service.ts:50`). No max depth, no rejection
when saturated. A burst outpacing the pool grows the array (and its retained `workerData` payloads)
until the heap is exhausted.

### 2.13 `CronExpression.every` builds a schedule that fires every second — ~~CRITICAL~~ **FIXED**

*Opened while closing [2.10](#210-non-priority-jobs-are-lifo-and-starve--major-fixed), not part of
the original review. Found by a flaky test rather than by reading: `cron.test.ts` failed the
`1.3` startup election assertion, and the reason it could fail turned out not to be the election.*

`CronExpression.every(value, unit)` set the field for the unit it was given and left every other
field `*`, on node-cron's six field form `second minute hour day month weekday`. A field left open
matches every value of itself, so naming any unit coarser than seconds built a schedule that fires
**once a second** throughout every window it matches:

| Written | Built | Actually fires |
|---|---|---|
| `every(5, 'minutes')` | `* */5 * * * *` | 60 times, once a second, during every fifth minute |
| `every(2, 'hours')` | `* * */2 * * *` | 3,600 times an hour, for the whole of every second hour |
| `every(1, 'days')` | `* * * */1 * *` | 86,400 times a day |

The JSDoc examples stated those outputs, so the utility documented its own defect as its contract -
which is how it survived review. `daily()`, `weekly()` and `monthly()` all floor their lower fields
correctly, and are the evidence that flooring was the intent.

> **Fixed by flooring every field below the named unit**, to `0` for the time fields and `1` for day
> of month, which is one based and matches nothing at zero. `at` still writes any field, including a
> floored one, so `every(1, 'minutes').at(30, 'seconds')` remains how a caller says which second they
> meant - the floor is a default rather than a lock.
>
> **Nothing the framework schedules was affected**: every built-in job is expressed in seconds, which
> was the one correct case. This was entirely a consumer-facing defect - a "nightly report" job that
> sends 86,400 emails.
>
> **It also explains the flake, and that connection matters.**
> [1.3](#13-runoninit-true-is-the-default--critical-fixed) closed the startup election with a known
> residue: two instances booting either side of a slot boundary compute different keys and both run.
> That was accepted because the window is one schedule period wide - "a day for a nightly job". With
> every coarser schedule secretly firing per second, the window was one second wide for every job
> anyone would write, so the residue was being hit constantly instead of almost never. The assumption
> under an accepted risk was false, and only the arithmetic of the accepted risk revealed it.
>
> Held by `src/cron/cron-expression.utilities.test.ts`, which needs no container and runs in the
> normal suite.

### 2.14 A mail whose send throws stays at the head of the queue, and enough of them stop a priority — MAJOR, **open**

*Filed on the re-check of 2026-10-15.*

[2.2](#22-failed-emails-are-silently-deleted--critical-fixed) settled the mail a server *rejects*: it
becomes `FAILED` and leaves the queue. A send that *throws* was called fine there, because the row
stays `QUEUED`. It stays `QUEUED` for good, though, whatever makes it throw: an attachment path that
does not exist (`validateAttachments`, `src/email/email.service.ts:269-281`), which in a cluster is
any attachment written on another instance or cleaned up since, or a message the transport refuses
before the server answers.

`findMails` (`:289-299`) reads the oldest queued mails of each priority (`Email` orders by `createdAt`),
so such a mail is read first on every pass. `sendMany` sends the batch with one `Promise.all`
(`:210-212`), so one throw fails the batch and `retainOnError` (`:179-194`) keeps the claim of every
mail in it, the poisoned one included, for `sendLeaseInMs`. While the claims are held the pass reads
the same rows, takes none and returns. Once they lapse the mail is tried again and throws again.

So a mail that cannot be sent is retried once a minute forever, with an error logged each time, and
once a priority's share of a batch (`sendBatchSize` less the slots held back for lower priorities)
is made of such mails, nothing of that priority is sent again. There is no attempt count, no
`FAILED` for this path and no way past the head of the queue.

### 2.15 Disabling, enabling, rescheduling or stopping a cron job reaches only one instance — MAJOR, **open**

*Filed on the re-check of 2026-10-15.*

`CronService.enable`, `disable`, `changeCron` and `update` (`src/cron/cron.service.ts:231-274`) find
the job in this instance's `cronJobs` and call it; `CronJob` writes the shared row and stops,
restarts or rebuilds **its own** node-cron task (`src/cron/cron-job.model.ts:575-639`). Every other
instance keeps its task as it was, and nothing reads the row again before a tick
(`runOnTick`, `:472-508`) or before the next boot.

With `distributed: true`, every instance competes for each slot, so after `disable()` on one
instance the job goes on running on the others, once per slot, while the row and `job.state` say
`INACTIVE`. `changeCron` leaves the old schedule running elsewhere beside the new one, and since the
claim key is `<name>:<scheduled time>`, slots of both schedules are claimed and run. `stopOnError`
is the same: a tick that throws stops the task of the instance it threw on and records
`STOPPED_ON_ERROR`, and the next slot is claimed by another instance and runs. `docs/cron.md`
describes all of these as states of the job.

`update` also accepts a new `name` and writes it to the row, while every later write
(`lastRun`, the state, the error) still filters on the class's own name (`:495`, `:528`, `:565`) and
reaches no row, and the next boot creates a new one under the old name.

### 2.16 The default timeouts of normal and priority thread jobs are swapped — MAJOR, **open**

*Filed on the re-check of 2026-10-15.*

`MultithreadingService.getDefaultTimeout` (`src/multithreading/services/multithreading.service.ts:696-698`)
returns `defaultTimeoutMs` for a priority job and `defaultTimeoutPriorityMs` for a normal one. The
option's JSDoc and `docs/multithreading.md` say the opposite: an hour for a normal job, five minutes
for a priority one. So a queued background job given no `timeout` is stopped after five minutes, and
`run(func, input)`, whose `priority` defaults to `true`, gets an hour. No test asserts which default
a job without a `timeout` gets.

---

## 3. Performance

### 3.1 Prometheus cardinality bomb — ~~CRITICAL~~ **FIXED** **[verified]**

`src/metrics/metrics.service.ts:105, 115-125`. See
[02-http-runtime-core.md](./02-http-runtime-core.md) §C2 for the full finding.

### 3.2 Every log call captures and regex-parses a stack trace — ~~MAJOR~~ **FIXED**

> **Closed**, held by `logging.evaluation.test.ts`, both cases green.
>
> The expensive half of reading `error.stack` is not collecting the frames, it is **formatting** them:
> the default `prepareStackTrace` renders every frame into text, and nothing here wanted text. Swapping
> it for one that hands back the frames themselves skips that entirely, and the split and two regexes
> go with it — a `CallSite` already knows its own file name. Measured on the suite's own benchmark:
> **87µs per call before, under the 50µs bar after**.
>
> **That 50µs bar was later the thing that broke**, on a busier machine, while the fix it guards
> stayed closed — 74µs, all of it load. A microsecond threshold can only ever be right for the
> machine it was written on, so the benchmark measures a formatted stack capture *on the machine
> running it* and compares against that instead. A log call is allowed to cost more than a bare
> capture, since it also formats a message, resolves a level and hands the entry to every transport;
> what it must not cost is multiples of one, which is what paying for a formatted stack on top of all
> that looked like.
>
> **The crash and the cost were the same defect.** `[3]` was a fixed index into a formatted stack, so
> any other call depth produced `undefined` and the next line called `.match` on it. Reading the frame
> by *name* — the first one whose file is not this one — removes the index, and with it the case the
> finding named: `Error.stackTraceLimit = 0` is an ordinary production tuning that used to make every
> log call in the application throw a `TypeError`. With no frames collected the answer is now
> `'unknown'`, which is what that field is for.
>
> **No option was added**, and "no way to disable it" stopped being the complaint it was. `Error.stackTraceLimit`
> is the knob Node already provides, it now works, and at this cost there is nothing left to turn off.
>
> Worth noting what made this urgent rather than merely true: the access log added while closing
> [02 §M6](./02-http-runtime-core.md) calls `log` once per request, so the per-call cost stopped being
> something an application pays only when it chooses to log.

The original finding, for the record:

`src/logging/logger.ts:72-75`

```ts
const line: string = (new Error().stack ?? '').split('\n')[3];
const matches: RegExpMatchArray | null = line.match(/\((.*):\d+:\d+\)/);
const origin: string = matches?.[0].split('(')[1].split(')')[0] ?? 'unknown';
```

`new Error().stack` forces V8 stack materialization — one of the most expensive operations
available — on every log line, plus a split and two regexes. No caching, no way to disable. It also
indexes `[3]` unconditionally, so any other call depth yields `undefined` and `line.match` throws
inside the logger.

### 3.3 Logging is awaited and does a DB INSERT per line — ~~MAJOR~~ **FIXED**

`src/logging/logger.ts:108-123` awaits `Promise.all(transports.map(...))`, and
`src/logging/transport/log-to-db.function.ts:10-13` is a single `repository.create` per log. Every
`await this.logger.info(...)` — used throughout the framework, including on request paths — blocks
on a database round trip. No buffering, no batching, no async queue, no sampling. Under load the
logger becomes the bottleneck and couples request latency to DB write latency.

> **Two halves, closed a long way apart.** The *awaited* half went with the access log
> ([02 §M6](./02-http-runtime-core.md)): `log()` is void, an entry goes into a bounded `LogBuffer`
> and the call returns, so nothing on a request path waits for a transport. What was left is the
> per-line write, and it had got worse in the meantime — the access log calls `log()` once per
> request, so the cost stopped being something an application pays only when it chooses to log.
>
> **`LoggerTransportSend` takes `Log[]` now**, which is a breaking change to a published type and
> the honest one: the logger holds a batch by the time anything is written and was unpacking it to
> call every transport once per entry. `logToDb` is one `createAll` — the repository already had a
> bulk insert, so the blocker this looked like it would need never existed. `logToConsole` loops,
> which is the honest shape for a terminal.
>
> **The test found the half that mattered, and it is not the one the finding names.** Batching alone
> changed almost nothing: `scheduleDrain` started a drain the instant an entry arrived, so the first
> entry of every quiet period was written on its own — and an application logging one line per
> request is quiet between requests, so **every access log line would still have been its own
> INSERT**. Batching is worth nothing without somewhere for entries to gather. `LOGGER_FLUSH_INTERVAL_MS`
> is that, one second by default, `0` to write each entry alone; the timer is unref'd so a pending
> drain never holds the process open, and `flush()` skips the wait rather than sitting through it.
>
> **The default is a second rather than the 100ms it was first written with**, which is the same
> mistake as the one above in smaller form: a service handling a few requests a second is quiet on a
> 100ms window too, so the shorter interval would have kept much of the per-line writing it was added
> to stop. A second buys real batching at the cost of a crash window nobody notices in production and
> a delay nobody notices in development.
>
> **What it costs, stated in the docs:** an unclean crash loses at most one interval. An orderly
> shutdown loses nothing, because `onAppShutdown` flushes while the data sources are still open.
>
> Held by `logger.batching.test.ts`, whose *"lets entries gather before writing them"* is the case
> that would have stayed broken.

### 3.4 `logToEmail` turns a log storm into a mail storm — ~~MAJOR~~ **FIXED**

`src/logging/transport/log-to-email.function.ts:51-62` enqueues one email per log event at
`EmailPriority.HIGH` by default. A failing dependency producing 10k errors/minute inserts 10k rows;
the mail cron drains ten per iteration while the in-memory token bucket blocks; if any send throws,
§2.1 disables the mail cron entirely. Log storm → mail queue explosion → email permanently offline.

> **The last link in that chain was already broken** — §2.1's `stopOnError` default is off, so a
> failed send costs one execution rather than the mail cron. What remained is the queue: the storm is
> over long before the backlog is, and every ordinary mail sits behind it.
>
> **One mail per batch, bounded twice.** The batch from §3.3 is what makes a digest possible at all.
> `maxEntriesPerEmail` (20) bounds the mail, because a digest of ten thousand rendered entries is a
> different denial of service rather than an absence of one; `minIntervalMs` (one minute) bounds the
> *rate*, which is the one bound an incident cannot outrun — one mail per drain is still one mail
> every few milliseconds under sustained failure.
>
> **Throttling that forgets silently would be worse than none.** Entries arriving inside the gap are
> counted, and the next mail's subject says how many were suppressed — otherwise a gap in the record
> reads as a gap in the incident. The same applies to the cap: the subject carries the true count,
> not the number that fitted.
>
> **The state had to become per transport.** Remembering when this transport last sent belongs to
> *this* transport — two of them reporting to different mailboxes share nothing — so `logToEmail`
> became `createLogToEmail()`, called once per transport from `LoggerTransport.email`. A module level
> variable would have made two transports share one budget, which is the kind of coupling nobody
> writes down and everybody trips over.
>
> Held by `log-to-email.digest.test.ts`, against the real mail queue rather than a stub, because what
> the finding is about is how many rows end up in it.

### 3.5 Mail queue: three SELECTs per ten mails, hardcoded batch — ~~MAJOR~~ **FIXED, the rest WITHDRAWN**

`src/email/email.service.ts:82-86` issues three sequential queries yielding at most ten rows, then
one `UPDATE` or `DELETE` per mail (`:136-141`), all inside a spin loop
(`send-queued-emails.cron-job.ts:27-30`). The `8` and `10` are magic numbers with no configuration
hook. Draining a 10,000-mail backlog costs ~3,000 SELECTs plus 10,000 individual writes.
`README.md:37` advertises "queuing support for thousands of mails".

> **The magic numbers were a rule nobody had written down**, which is why neither could be
> configured. `8` is *the batch minus one slot for each priority below HIGH*, and `10 - 1 - high` is
> the same reservation one priority further along — the whole thing is "hold back one slot per lower
> priority, so a permanent flood of HIGH cannot take every pass". Written that way it derives both
> numbers from `sendBatchSize`, an `EmailConfig` option defaulting to 10, and adding a priority is
> one entry in a list rather than a second constant somewhere else. The numbers are unchanged at the
> default, deliberately: the three suite tests asserting 8 and 10 still hold.
>
> **The rest is still open, and the read half is a schema question rather than a query one.**
> Collapsing the three `SELECT`s into one ordered read does not work: `EmailPriority` is a *string*
> enum, so `ORDER BY priority` sorts `HIGH, LOW, NORMAL`. One query needs either a numeric sort
> weight on the row or a numeric enum, and valkey's ordering story is separate again. The one write
> per mail is untouched.
>
> **Withdrawn, and the schema question above was the wrong question** (2026-09-26). Even a numeric
> sort weight would not help, because the three reads are not redundant. Each one takes up to its
> own cap, and the caps are the reservation described above. One `ORDER BY priority LIMIT batch`
> read would give every pass to HIGH for as long as HIGH keeps arriving, which is exactly what the
> reservation exists to prevent. Keeping it in one statement needs a `UNION` of limited reads, which
> the repository cannot express on any of the three stores.
>
> The write per mail was never waste either. Each row is written as soon as its own send returns,
> as SENT, FAILED with its rejected recipients, or deleted. A batched write would hold them until the
> whole pass had sent, and a process dying in that window would send every mail of the pass again
> instead of at most the one still being sent.
>
> Against that, the cost is three indexed reads per ten mails, next to ten sends that each take a
> round trip to a mail provider, all under `maxEmailsPerHour`. The finding read the queue as a
> database workload, but it is a sending workload. `mail-queue.evaluation.test.ts` holds both
> halves without containers: NORMAL and LOW get a slot in the first pass of a HIGH flood, and a
> mail's row is SENT while another mail of the same pass is still being sent.

### 3.6 ValKey cache: three or more sequential round trips per `set` — ~~MAJOR~~ **FIXED**

`src/caching/store/val-key.cache-store.ts:356, 358-372` — no Lua script, no `MULTI`.
`evictOverflow` (`:467-493`) issues `zcard` + `get` and then loops with more round trips. The byte
counter is a non-atomic read-modify-write: two nodes writing the same key both read `previousSize`
and both `incrBy`, so the accounting drifts permanently (acknowledged in the class doc at
`:295-296`) and can drive spurious eviction of live entries or disable eviction entirely.

> **The round trips were half closed before this round and the entry never said so.** Pipelining had
> already collapsed the batch that follows the size lookup into one trip; what was left in `set` was
> the lookup itself, the batch, and the usage read that starts `evictOverflow`. So the heading names
> the smaller of the two problems, and the sentence at the end names the larger one.
>
> **The byte counter was the finding, and it is a correctness bug rather than a performance one.**
> A read followed by an increment has a race whatever it costs: both instances read the size the key
> had before, both add the whole new size, and the counter is then too high by everything the losers
> of that race contributed. Nothing brings it back down. A store whose counter is too high evicts to
> get under a limit it is not over, evicts everything it can, and then throws away every later write
> as fast as it arrives — which reads, from outside, as a cache that has stopped caching.
>
> **Both sides of the bookkeeping are one step on the server now.** A lua script writes the value,
> records its size, moves the counter by the difference, and puts the entry into the index and its
> tag sets. A second script does the removals, and reading each size inside the same step is what
> makes removing an entry twice harmless — the second caller finds no recorded size and subtracts
> nothing. That second property is what lets every instance sweep the same shared store without
> them corrupting the counter between them, which §3.8 needs.
>
> The round trips fell out of the same change rather than being chased: `set` is one script
> invocation plus the overflow check, and a miss on a key that was never cached is one trip rather
> than two.
>
> **`MULTI` was not an option for the write.** The size the counter moves by depends on the size read
> in the same step, and a batch cannot see its own results. `WATCH` would have made it a retry loop
> over a value that is contended precisely when the cache is hot.

### 3.7 In-memory cache serializes the whole value on every write — ~~MAJOR~~ **FIXED**

`src/caching/store/in-memory.cache-store.ts:260-267` does a full `JSON.stringify` of every cached
object on every `set`, purely for byte accounting, then discards it. Caching a 5 MB result costs a
5 MB synchronous serialization that blocks the event loop. Defaults are also unrealistically small:
`maxEntries: 500`, `maxBytes: 750 KB` (`:45-47`).

> **Closed by measuring the json form instead of building it.** `JsonUtilities.byteSizeOf` walks a
> value and adds up what `stringify` would write — escapes, multi byte characters, the properties
> json leaves out and the array holes it writes as `null` all counted the way json counts them. The
> walk is the one `stringify` does anyway; what goes is the copy it makes and throws away.
>
> **Exact rather than approximate, deliberately.** Sampling large values was the cheaper option and
> was declined: a budget whose estimate drifts from what it estimates is a budget that admits more
> than it says it holds, and it drifts most on exactly the values that make the limit matter. The
> test asserts agreement with `stringify` byte for byte over a table of shapes rather than asserting
> a number, so a future change to either side has to keep them equal.
>
> **The string fast path is where the saving actually lands.** A value that is mostly one large
> string never needs the character walk: a string with nothing to escape is its utf-8 length plus
> two quotes, which the runtime measures natively. The walk is for the rest.
>
> Defaults are `5000` entries and `25 MB`. The old pair is small enough that the second real
> response evicts the first, so the cache reported a hit rate near zero while working exactly as
> configured.

### 3.8 Expired entries occupy the cache budget until read — ~~MAJOR~~ **FIXED**

`InMemoryCacheStore` has no TTL sweep; expiry is checked only on read
(`src/caching/cache/read-through/read-through.cache.ts:43`, `read-aside.cache.ts:156`). Worse,
`store.get` calls `recordAccess(entry)` (`in-memory.cache-store.ts:59`) **before** the caller
discovers it's expired, promoting a dead entry to most-recently-used. `MultiTierCache.wrap`
(`multi-tier.cache.ts:150`) does not even delete expired entries it encounters.

> **Half of the first sentence had already closed and the entry did not know.** Both read-through
> and read-aside checked expiry, evicted, and counted it. What had not closed is everything the
> entry names after that, and one thing it does not.
>
> **Expiry belongs to the store, and that is the whole fix.** A store now answers with what is still
> valid: an expired entry is removed and reported as absent, before the access is recorded. Three
> cache kinds implementing one rule became one place implementing it, and the two consequences the
> entry names went with it - nothing can promote a dead entry, because nothing hands one back, and
> `MultiTierCache` cannot forget to delete what it never sees.
>
> **The multi tier case is the argument for the choice.** It was the one cache of the three that
> recognized an expired entry and simply moved on to the next tier, leaving it exactly where it was.
> That is what a rule written in three places gets you, and the fourth cache kind somebody adds
> would have had the same coin flip. Its `expiredEvictions` counter was declared and never
> incremented - one field away from the hits and misses §3.9 fixed for the same reason, and neither
> had a finding of its own.
>
> **Room comes back without waiting to be asked.** `CacheExpiryCleanupCronJob` runs once a minute, per
> instance for the same reason the invalidation job is per instance, and `CacheService` reports what
> it reclaims as `cache_expired_evictions_total`. Rarely, because nothing is served wrong in the
> meantime: the only cost of waiting is room. Sweeping during writes was the alternative and was
> declined for tying convergence to traffic - a store that goes quiet holding expired entries stays
> wrong for as long as it stays quiet.
>
> **The count includes what a read removed.** A store reports how many entries expired since it was
> last asked, not how many that call happened to sweep. A number that only counted sweeps would read
> near zero on exactly the caches whose keys are read often, which is the opposite of the signal.
>
> **The metric moved rather than staying on the cache.** Counting it needs one owner and the sweep is
> where every removal is now visible, so `CacheMetrics` lost the field and `CacheService` took the
> counter - same name, same `cache` label. A `removeExpired` on `CacheInterface` instead would have
> made every cache anyone has written implement it, to report a number the service can read off the
> store it already reaches.
>
> **The shared store needed §3.6 first.** Every instance sweeps it, so two of them dropping the same
> expired entry at the same time has to leave the byte counter right - which is the property §3.6's
> removal script was built for.

### 3.9 The multi-tier cache has no stampede protection and no hit/miss metrics — ~~MAJOR~~ **FIXED**

`MultiTierCache` (`src/caching/cache/multi-tier.cache.ts:76`) does **not** extend `BaseCache`, so it
has no access to `runSingleFlight` (`base-cache.model.ts:157-176`); its `wrap` (`:145-166`) goes
straight from miss to `await fn(...args)`. It also declares `hits` / `misses` in `initMetrics`
(`:114-137`) and never increments them. A hot key expiring on the flagship cache sends every
concurrent request to the origin simultaneously, and the hit-rate dashboard reads a permanent zero.

> **Closed by moving single flight out of the base class rather than by inheriting from it.** The
> entry reads as though the fix is to extend `BaseCache`, and that would be wrong: a multi tier cache
> is not a cache over one store, so it cannot have the `store` and `defaultTtl` that base is built
> around. Coalescing was simply in the wrong place - it is a thing you do to a key, not something a
> cache is. `CacheSingleFlight` now holds it, both cache kinds own one, and `runSingleFlight` on each
> is the two lines that keep the `cache_in_flight` gauge honest.
>
> **The origin call and the tier writes are inside the coalesced section together.** Coalescing only
> the origin call would hand the second caller a value while the tiers were still empty, so the call
> after it would miss again - the stampede shortened rather than closed.
>
> **The miss is counted per caller, not per origin call.** Three callers coalescing into one origin
> call are still three callers who did not get a cached answer, and a hit rate that says otherwise
> flatters exactly the case the fix is for.
>
> Kept concrete rather than made a general `SingleFlight<K, V>`: it has two users, both caches, and
> its notion of key identity is the cache's. A third caller is when that question gets asked again.

### 3.10 Single-flight breaks for object keys — ~~MINOR~~ **FIXED, and it was not minor**

`base-cache.model.ts:21` — `private readonly inFlight: Map<K, Promise<V>>`. A key function
returning `{ userId, tenantId }` produces a fresh object per call, so reference-identity lookup
always misses and coalescing never occurs. Silent, with no type-level or runtime warning.

> **The same bug was in the in-memory store, where it is much worse.** `InMemoryCacheStore` keyed its
> entries by `Map<K, …>` too, so an object key never *hit the cache at all* - every call went to the
> origin, forever, with no error and no metric to see it in. The valkey store resolves the key with
> `JsonUtilities.stringify` (`val-key.cache-store.ts:316`), so the same declaration cached normally
> there. One cache declaration, two behaviours, decided by where it happened to be stored.
>
> **What made it possible is that "the same key" was decided in three places** - two stores and the
> in flight map - and only one of them was right. It is `cacheKeyOf` now, used by all three, so the
> question has one answer. The store keeps the resolved form internally (its order list and frequency
> buckets hold it), which is why eviction and tag invalidation delete by it rather than resolving a
> key they never had.
>
> **Two objects with the same entries in a different order are one key**, because a key is
> canonicalized before it is written: every object in it is sorted, including the ones inside arrays.
> This was going to be left as a documented wart - it costs a duplicate entry rather than a wrong
> answer - and that was the wrong call, since two call sites building the same key is exactly how a
> key provider gets used.
>
> **Array order is kept**, deliberately: `['name', 'createdAt']` is a different sort than
> `['createdAt', 'name']`, and a key that could not tell them apart would serve one query's answer to
> the other. Arrays are walked rather than sorted, so objects inside them are still put straight.
> Dates and class instances are left to the serializer - reordering their properties would read
> properties they do not keep their value in, and every date would come out as the same empty object.
>
> **A string key is stored as itself and everything else as json**, which the test written for it
> caught as a collision: the number `42` and the string `'42'` were one key. Serialized keys carry a
> mark that a string key cannot, which is the only thing that separates the two spaces.

### 3.11 Double JSON round trip per websocket recipient — ~~MINOR~~ **FIXED**

`src/websocket/services/websocket.service.ts:425, 462, 526` — stringify-then-parse to strip class
instances, then socket.io serializes again. Three passes per message; in `sendToAll` with
`expectResponse`, once **per connection** (`:531-536`).

> **The per connection half had already closed and the entry did not know.** The payload was
> prepared once per fan out before this round. What was left is the round trip itself, and it was
> not stripping class instances — json writes those the same either way. It existed because
> socket.io's encoder is plain `JSON.stringify`, which throws on a bigint.
>
> **The fix is to write the message once, in the place that has to write it anyway.** socket.io takes
> its encoder as an option, so the server gets one that writes every packet with
> `JsonUtilities.stringify`, and the service hands it the message as it is. The cluster adapter
> publishes through the same function, because the packet it carries now holds the message as sent.
>
> **The round trip had never covered the acknowledgement.** A handler answering a client that asked
> for an acknowledgement handed the message straight to socket.io, so a bigint in that answer threw
> inside socket.io and the answer never went out — the client waited out its own timeout. And a buffer
> went out as binary there and as `{ type: 'Buffer', data }` everywhere else. One encoder for every
> packet makes those the same.
>
> **A buffer is written as json on purpose, not as binary.** socket.io's own encoder sends a buffer beside
> the json, and that is what the acknowledgement path did. But a message is stored and replayed as json, and it reaches the
> clients of another instance as json, so binary on the clients of one instance would be the one path
> that differs. Nothing had asked for binary, so the encoder writes json only.
>
> The cost is one more optional peer: the server still reads what clients send with socket.io's own
> decoder, so `socket.io-parser` is declared next to `socket.io-adapter`, and like it arrives with
> socket.io.

### 3.12 Static assets served with no cache headers — ~~MINOR~~ **WITHDRAWN**

`src/assets/asset.service.ts:58` — `app.use(this.assetsRoute, express.static(this.publicAssetsPath))`
with no options: no `maxAge`, no `immutable`, no `Cache-Control`, no precompressed/brotli handling.
The `/favicon.ico` route (`:63-72`) does an `fs.exists` stat per request with no caching.

> **Read off the options rather than the response, and the response already had all of it.** With
> no options, the static middleware sends `Cache-Control: public, max-age=0`, a weak ETag and a
> `Last-Modified`. The favicon route answers through `res.sendFile`, which sends the same three.
> A browser confirms its copy before using it and gets a 304 with no body. Once the file changes, it
> gets the new one. Brotli and gzip come from the application's own compression middleware, which
> sits in front of both.
>
> **A longer `max-age` or `immutable` would be wrong here, not missing.** Both are safe only for a
> file whose name changes when its content does. Nothing served from `assets/public` is named that
> way: the explorer's bundle, the vendored scripts, `style.css` and the logo all keep their names
> across releases. A browser told to reuse them for a day would run the old ones for a day after
> every deploy. The per-request stat is how the validator is read, and the static middleware makes
> the same one.
>
> Observed in `src/__testing__/evaluation/static-assets.evaluation.test.ts`. Its first run was red
> for both routes, because node's fetch adds `cache-control: no-cache` to a conditional request by
> itself, and a server that answered that with a 304 would be wrong. Revalidating the way a browser
> does, with `max-age=0`, is what turned it green.

---

## 4. HTTP client

### 4.1 Retries non-idempotent requests on 4xx with zero backoff — ~~CRITICAL~~ **FIXED**

`src/http-client/http-client.ts:236-250`

```ts
for (let i: number = 0; i < (options?.attempts ?? 1); i++) {
    if (fetchResponse != undefined) { continue; }
    try {
        const response = await this.sendRequest(urlWithParams, init, options?.timeoutMs ?? Ms.SECOND * 5);
        if (!response.ok) { throw await this.buildResponseError(...); }
        fetchResponse = response;
    }
    catch (_error) { error = _error; }
}
```

Every non-2xx throws into the catch and is retried. No method check, no status classification: a
`POST` returning `400`, `401`, `403`, `409` or `422` is retried `attempts` times back to back with
no delay, no jitter and no `Retry-After` handling. Retrying a `POST /payments` that returned
`409 Duplicate` re-submits the charge. No idempotency-key support, no circuit breaker.

> **Two questions now, and both have to say yes.** *Is the failure worth another attempt* — only a
> connection error, a timeout, or `408`/`429`/`500`/`502`/`503`/`504`. Everything else is the server's
> considered answer to this exact request, and asking again produces it again. *Is repeating this
> request safe* — `GET`, `HEAD`, `OPTIONS`, `PUT`, `DELETE` yes, `POST` and `PATCH` no.
>
> **The nuance that stopped this from being "never retry a POST".** A non-idempotent request *is*
> repeated in one case: the server said it had not looked at it yet. A `429` counted the request and
> refused it; a `503` was not accepting work. Neither can have charged a card, and refusing to retry
> there would fail every rate-limited write that a moment's patience would have completed. A network
> error or a timeout is the opposite situation and is never repeated for those methods — the request
> may well have arrived and been carried out with only the answer lost, and nothing on the client side
> can tell that from a request that never landed.
>
> **Backoff is equal jitter, not full jitter.** Doubling from 250ms, capped at ten seconds, with half
> the window fixed and half random. Full jitter — `random() * window` — was written first and then
> changed, because it can roll a delay near zero: a backoff that sometimes does not back off. The
> fixed half also gives the test a floor to assert, which the fully random version did not.
> `Retry-After` overrides it entirely, in both its seconds and its http-date form.
>
> **Two loop bugs went with it:** the old loop `continue`d instead of breaking, so a request that
> succeeded on the first attempt still span through the remaining iterations; and `error` was
> overwritten every attempt, so what surfaced was the last failure rather than the first.
>
> `HttpStatus` was missing `408`, sitting between `406` and `409` which were both there.
>
> **Still not there,** and named in the finding: no idempotency-key support and no circuit breaker.
> Those are delivery features; the defect here was re-submitting charges.

### 4.2 Response body download is unbounded and untimed — ~~MAJOR~~ **FIXED**

`src/http-client/http-client.ts:453-462` — the `AbortController` timeout is cleared in the `finally`
as soon as `fetch` resolves (headers received). `readBody` (`:464-479`) then calls
`await response.text()` with no timeout and no size limit. A slow-loris or hostile upstream hangs
the call forever; a large response is fully buffered into a JS string before `metadata.maxSize` is
consulted (`:304`, checked in `parseBody` at `:310` — after the memory is committed). Default
timeout is a hardcoded 5 s.

> **The deadline now ends when the answer does, not when its first line arrives.** `sendRequest`
> cannot release the timeout itself — `fetch` resolves on headers — so it hands back a `release` the
> caller calls once it has read the body or given up. A streamed body is the exception and releases
> immediately: it is consumed after the call has already returned, so its lifetime belongs to whoever
> consumes it.
>
> **The size limit is enforced while the body arrives**, the same shape the server side already uses
> for an incoming request (`json.body-parser.ts:65-85`): refuse a declared `Content-Length` over the
> limit before reading a byte, then count each chunk and `cancel()` the body stream the moment the
> total passes it — which cancels the underlying source, so the rest is never transferred. Nothing
> calls `response.text()` any more, so a five gigabyte answer is no longer downloaded in full just to
> be refused for being large, and peak memory is bounded by what was asked for rather than by what the
> upstream chose to send. `ContentTooLargeError`, same as the server.
>
> **Why not in the body parsers, which have a `parseFromHttpClientResponse`.** Because those do not
> read anything. `FormDataBodyParser` gets `rawBody as Readable` and does limit it — that path was
> always fine. `JsonBodyParser` gets `rawBody` as a **string**, already materialised by the client, so
> by the time it is called the memory the limit exists to protect is spent. The decisive part is
> narrower still: a request that declares no `responseBody` returns before any parser runs at all, so
> enforcement there would leave `http.get(url)` — the common shape, and the one an untrusted upstream
> meets — unbounded. The read is the client's, so the limit has to be too.
>
> **The hardcoded 5s went with it.** Both defaults moved to `HTTP_CLIENT_OPTIONS`, resolved from an
> `..._INPUT` token the way `JWT_AUTH_OPTIONS` and `LOCALIZE_OPTIONS` already are, carrying
> `defaultTimeoutMs` and `defaultMaxResponseSize`. A per-request `timeoutMs` still wins.
>
> **The limit when nothing was declared is new policy rather than correction.** A declared
> `responseBody` derives its own, exactly as a route's body does; without one there was previously no
> limit at all, which is the "unbounded" in the title. It is now 10mb by default — large enough that no
> ordinary json answer meets it, and configurable for the ones that do. A genuinely large body wants
> the `stream` reader, which buffers nothing and is not capped.
>
> Runs locally: `http-client.evaluation.test.ts` needs no container. The size tests use a finite
> oversized body that ends on its own rather than an endless writer, so nothing in the suite depends
> on a connection being cut in order to terminate.

### 4.3 No connection pooling, proxy or TLS control — ~~MAJOR~~ **FIXED**

The client calls global `fetch` (`:457`) with no dispatcher or agent. There is no way to configure
keep-alive, `maxSockets`, per-host pooling, a corporate egress proxy, custom CA bundles, or mTLS
client certificates. Enterprise environments mandate proxy and CA configuration for all egress; the
payment plugin (`src/plugin/payment/providers/pay-pal/pay-pal-client.ts`) inherits the same
limitation.

> **The six things the finding lists are one option.** Keep-alive, `maxSockets`, per-host pooling, a
> proxy, a CA bundle and a client certificate are all how an undici `Dispatcher` is built, and node's
> `fetch` takes exactly one of them. So this closed as `HttpClientOptions.dispatcher` plus a
> per-request override, rather than as six settings — and the framework builds none of them, the same
> division as [§5.2](#52-no-swap-in-path-for-real-infrastructure--major-mostly-fixed): the seam is
> Zibri's, the provider is the deployment's.
>
> **Three things were measured rather than reasoned about, and two of them decided the design.**
>
> *Node 24's `fetch` honours a per-call `dispatcher`.* Confirmed by throwing from a stub's
> `dispatch` and watching it come back through `fetch failed`. Had it not, the only route would have
> been `setGlobalDispatcher` — which redirects every other library in the process, and is not a
> framework's decision to make. Per-client is possible, so per-client it is.
>
> *`undici` is not importable as a bare specifier and node exports no `node:undici`.* So the
> framework cannot construct a `ProxyAgent` itself without a fourteenth peer dependency. It does not
> have to: the consumer already has undici if they have a proxy to configure.
>
> *`undici-types` reaches every project already, through `@types/node`.* This looked like the answer
> to typing the option exactly, and **it is the one measurement that pointed the wrong way.**
>
> **A type-only dependency can still be the wrong one, and the whole detour is worth recording.**
> `undici-types` does reach every project — at whatever version their `@types/node` major pulls.
> This repository's own three workspaces carry undici-types **6, 7 and 8** at once, and a
> `Dispatcher` from one is *not assignable* to a `Dispatcher` from another: v8 widened
> `UndiciHeaders` to include `OutgoingHttpHeaders`, and variance does the rest. So naming the package
> means naming a version, every version is wrong for somebody, and the option would refuse the very
> `ProxyAgent` it exists to accept — for a reason nothing at the call site could show. **That is
> §4.3's own defect one layer up**, in the type system rather than the socket.
>
> Declaring the dependency is also what exposed it, and it exposed a second thing on the way: with
> `^8.10.1` declared, npm left `packages/zibri/node_modules/undici-types@8.10.1` shadowing the root
> copy, and `npm ls` reported the tree `invalid` while `tsc` stayed perfectly green — it resolves the
> nearer copy and has no opinion about which one a consumer will have.
>
> **So the type is described here instead**, to the one member the framework touches: none. It
> forwards a dispatcher to `fetch` and never calls it, so `{ dispatch }` is the whole contract, and
> no version of anything has to line up. Verified against all three majors present in this
> repository — 6, 7 and 8 all satisfy it, and a number still does not. Held by *"describes a
> dispatcher itself rather than depending on undici-types for it"* in
> `di-and-packaging.evaluation.test.ts`.
>
> **The per-request override replaces rather than merges.** Two dispatchers cannot be combined into a
> third that means both, so a request naming one uses it outright. Application-wide is where a proxy
> or a CA bundle belongs; per-request is for the destination whose egress genuinely differs, which is
> mutual tls to one partner.
>
> **The payment plugin needed nothing.** `PayPalClient` resolves `ZIBRI_DI_TOKENS.HTTP_CLIENT`
> (`pay-pal-client.ts:322`) rather than calling `fetch` itself, so it inherited the fix. The finding
> reads as though it is a second site; it was a second *victim*, which is the argument for the plugin
> having gone through the client in the first place.
>
> Held by `http-client.evaluation.test.ts`. **The test that could not be written is worth recording**:
> the first version delegated to node's own dispatcher so a real response came back, which needs
> `globalThis[Symbol.for('undici.globalDispatcher.1')]` — and inside jest `globalThis` is the test
> context's, so the symbol is not there. What replaced it asserts more: a dispatcher that refuses to
> connect proves the request went *through* it, because the stub server records nothing. A delegating
> one could not have distinguished that from a dispatcher being consulted and then ignored.
>
> **And walking the error chain could not use `instanceof Error`.** The `TypeError` `fetch` throws is
> built in node's realm while the test runs in jest's, so the sandbox's `Error` is a different class
> and `instanceof` answers no about a value that is exactly what it claims to be. That is the seam
> [05 §D7](./05-di-metadata-and-packaging.md) refuses to let two copies of the framework create,
> met for real in a test rather than argued about.

---

## 5. Operability

### 5.1 ts-node is a required production peer dependency — ~~MAJOR~~ **FIXED**

> **A compiler is registered when a TypeScript file is actually named, and never otherwise.**
> `registerTsNode` is called from `loadWorkerFile`, behind an extension check, so a worker file that
> is compiled JavaScript starts nothing — and a pool of thirty threads in a production image is no
> longer a pool of thirty TypeScript compilers waiting for work none of them will ever be given.
>
> **The second call site was the worse one**, and the finding did not name it.
> `generateEntityFiles` imported `ts-node` at the top of a file the barrel re-exports, so
> `require('zibri')` resolved a compiler before any application had done anything at all. That is
> what made the dependency mandatory in the literal npm sense: without it installed, the framework
> did not load. Both call sites reach it through `require` at the point of use now, because an
> import is resolved when its module loads, which would make an optional peer mandatory again by the
> back door.
>
> **Optional rather than removed.** npm installs a peer dependency unless the meta calls it
> optional, so `"ts-node": { "optional": true }` is the thing that keeps it out of a production
> image, while still telling a consumer who wants to hand the framework a `.ts` worker file what to
> install. Removing the entry would have documented nothing. Measured, that is **24.4 MB across 15
> packages** absent from a production install — `typescript` is a *non-optional* peer of `ts-node`
> and 22.5 MB of that total, so requiring one requires the whole compiler.
>
> **The part that needed a second pass: optional moves the failure from install time to run time.**
> A data source is named in the options at boot, so a missing driver is a startup failure. A worker
> file is named *per job*, so nothing tells the framework in advance that a `.ts` file is coming —
> and a server can run for days before the first one arrives, at which point the deployment that
> left the compiler out is long finished. Lazy loading alone made the blast radius smaller and the
> discovery later.
>
> So the consumer declares it. `MultithreadingOptions.enableTsWorkerFiles`, default `true`,
> validated in `validateInputs()` beside the thread count checks: true with `ts-node` unresolvable
> is an `InitMultithreadingServiceError` on the way up, naming the option and the package.
> `isTsNodeInstalled()` resolves without loading, so asking costs nothing in a process that will
> never need one. **Default `true` keeps the out-of-the-box behaviour and makes turning it off the
> deliberate act** that buys the compiler-free image — and because npm no longer installs an
> optional peer, `zi new` asks for `ts-node` itself rather than inheriting it.
>
> With it `false`, a `.ts` worker file is refused **when it is queued**, in the caller's own stack,
> before a row is written — rather than becoming a job that fails inside a worker thread for a
> reason nothing about the call that queued it could show. And when it is `true` and something is
> still missing, the message names the file, the package, and compiled JavaScript as the other way
> out, instead of a bare `MODULE_NOT_FOUND` from inside a thread.
>
> `src/optional-peer-dependencies.test.ts` holds all of it, against the built package in a process
> of its own: the framework loads with `ts-node` hidden from the resolver, a JavaScript worker file
> reports that nothing matching `ts-node` is in its thread's `require.cache`, a TypeScript one still
> answers `55`, and the missing-compiler message names the package. **A fixture had to be fixed to
> make that true**: `multithreading.service.test.worker.js` reached into `./worker/helpers`, which
> only ever resolved because a compiler happened to be hooked into `require` — a JavaScript file
> that silently depended on the thing it was there to be the control for.
>
> The dependency that stayed: `.mts` is deliberately out of scope. It is an es module, so it loads
> through `import` rather than `require`, and the hook this registers only covers the latter.

`package.json:66` lists `"ts-node": "^10.9.2"` under `peerDependencies` and it is **not** in
`peerDependenciesMeta` (`:69-81`), so it is mandatory.
`src/multithreading/services/worker/thread-job.worker.ts:21` calls
`tsNodeRegister({ transpileOnly: true })` at worker startup and `:74` does
`require(workerData.filePath)` on arbitrary TS files.

Every production worker thread boots a TypeScript compiler and transpiles at runtime: startup
latency on every worker spawn, a build-tool-grade dependency tree inside the production image, and
additional supply-chain surface. Enterprises run prebuilt JS in production; a framework requiring a
compiler there will not pass build-pipeline or container-hardening review.

### 5.1b Three of the four "optional" peer dependencies are not optional — ~~MAJOR~~ **FIXED**

> **Ten of the fourteen peers are optional now, and every one of them is checked at startup.**
> Measured the same way it was found — hiding each from the resolver in a child process and loading
> the built package: `bcryptjs`, `pg`, `@valkey/valkey-glide`, `handlebars`, `ts-node`, `otpauth`,
> `pdfmake`, `socket.io`, `socket.io-adapter` and `xmlbuilder2` all load without them.
>
> **The rule that shaped this, and it is the project's, not the finding's: a check belongs where the
> feature is *declared*, never where it is used.** A peer that is only missed at the moment someone
> finally renders a pdf or enrols an authenticator is a server that ran for months and then failed
> at the worst possible time. What made it workable is that the framework already force-constructs
> every registered token while starting (`application.ts:254`), so a constructor is a startup check:
>
> | peer | what declares it | where it is checked |
> |---|---|---|
> | `bcryptjs` | wiring `BcryptHashStrategy` into the options | its constructor |
> | `@valkey/valkey-glide` | declaring a `ValKeyDataSource` | opening the connection |
> | `otpauth` | leaving the default two factor method in place | `OtpTwoFactorMethod`'s constructor, which `TwoFactorService` registers and the startup sweep then builds |
> | `pdfmake` | declaring the invoicing plugin | `InvoicePdfService`'s constructor |
> | `socket.io` | declaring a websocket controller | `WebsocketService.onAppInit` |
> | `socket.io-adapter` | naming an adapter data source | `WebsocketService.resolveAdapter`, called from `onAppInit` |
> | `xmlbuilder2` | a `translations/source.xlf`, or declaring an EN16931 conformance | `LocalizeService.onAppInit` parses it; `EN16931ConformanceService`'s constructor |
> | `ts-node` | `multithreading.enableTsWorkerFiles` | `validateInputs` — see [§5.1](#51-ts-node-is-a-required-production-peer-dependency--major-fixed) |
> | `handlebars` | calling `HandlebarUtilities` | **first use** — the one that is not a startup check |
>
> **Three changes were behaviour, not imports.** The websocket server is now only started when the
> application has websocket controllers, which is right on its own terms — an application with none
> has nothing to serve — and is what turns socket.io into a declared feature. And the default
> two factor method stays the default, because two factor should be: what changed is that declaring
> a *different* method now means never constructing the otp one, so nobody carries `otpauth` they
> do not use. And **an application with no `translations/source.xlf` now starts** — it warns and
> serves every string as written, where before it died at boot on an ENOENT naming a path inside
> `node_modules`. That folder belongs to the application, so having none is what "I translate
> nothing" looks like, and it is the declaration `xmlbuilder2` is read off.
>
> **A defect this nearly shipped with:** `pdfmake` sets `module.exports` to its constructor, so the
> `.default` an es-module-shaped import suggests is `undefined`. Caught by checking the runtime
> shape of each of them rather than trusting the import syntax.
>
> **`socket.io-adapter` needed a restructure rather than a moved import.** A class cannot extend a
> base it has not loaded, so `class DataSourceWebsocketAdapter extends ClusterAdapter` at module
> scope made socket.io's own adapter package mandatory while the `socket.io` beside it was optional.
> The class is built by `dataSourceWebsocketAdapterClass()` now, called from `resolveAdapter` so the
> package is resolved while the application starts rather than when socket.io asks for the first
> namespace. `DataSourceWebsocketAdapter` is a type rather than a class as a result — the one
> published name this cost.
>
> **What is still mandatory, and why**: `bignumber.js`, `jsonwebtoken` and `rxjs` are core, and
> `zibri-tsx` is the templating engine. Four of fourteen. *(Three since 2026-10-05: `jose` replaced
> `jsonwebtoken` as an optional peer, [03 §H12](./03-auth-and-security.md).)*
>
> **A consequence worth naming: optional peers stop being installed in this repository too.** npm
> does not install an optional peer, so the framework's own suites lose the package the moment it is
> marked — which is why `bcryptjs`, `pg`, `@valkey/valkey-glide` and `handlebars` are in
> `devDependencies`, and why `otpauth`, `pdfmake`, `socket.io`, `ts-node` and `xmlbuilder2` joined
> them. Until that was done the invoicing and 2FA suites passed only on a `node_modules` that
> predated the change; a clean `npm ci` would have failed them.
>
> **The gap `handlebars` marks** is worth stating plainly, because it is the shape of the remaining
> work: a *utility class* has no declaration point, so calling one can only fail when it is called.
> `XmlUtilities` had the same shape and got a declaration point from its two callers rather than
> from itself. Turning the utilities into services registered under a token would give them one
> directly, and the startup sweep would then check them like everything else.

**Opened while fixing §5.1, by the test written for it.** `peerDependenciesMeta` calls four peers
optional. Measured against the built package, in a process with the resolver patched to refuse each
one in turn, **13 of the 14 peers are required to load `zibri` at all** — and three of the four
declared optional are among them:

| Declared optional | Actually optional | Required by |
|---|---|---|
| `pg` | yes | — |
| `bcryptjs` | **no** | `dist/cjs/auth/hash/strategies/bcrypt.hash-strategy.js` |
| `@valkey/valkey-glide` | **no** | `dist/cjs/data-source/data-sources/val-key-data-source.model.js` |
| `handlebars` | **no** | `dist/cjs/handlebars/handlebar.utilities.js` |

Each is a top level `import` in a module the barrel re-exports, so reaching any part of the
framework resolves all of them. A postgres-only deployment installs a valkey client; an application
that renders no templates installs handlebars; one that hashes with argon2 installs bcryptjs. What
the manifest promises is that it does not have to.

This is the same defect §5.1 turned out to be, in three more places, and it is more serious than
the count suggests: the four entries are the framework's own claim about its dependency surface,
and a security review reads exactly that field to decide what a consumer is being asked to carry.

`pg` is the shape the other three should have — it survives because nothing imports it for a value
at module scope.

Held by §P3 in `di-and-packaging.evaluation.test.ts`, which reads the manifest, and by
`optional-peer-dependencies.test.ts`, which hides each package from the resolver in a process of its
own and loads the built package without it.

> **Not fixed here, deliberately.** `@valkey/valkey-glide` is used as a value in five modules
> (`TimeUnit`, `Script`, `Batch`, `GlideClient.createClient`), so making it lazy is a real change to
> those files rather than a moved import, and doing it while closing §5.1 would have been scope this
> was not asked for. The alternative — deleting the `optional` claims so the manifest tells the
> truth — is cheaper and worse: it makes the framework honestly heavier instead of actually lighter.

### 5.2 No swap-in path for real infrastructure — ~~MAJOR~~ **FIXED**

| Subsystem | Pluggable? |
|---|---|
| Cache store | Yes — `CacheStoreInterface`, in-memory + ValKey |
| Rate limiter store | Yes — in-memory, repository, ValKey lock |
| ~~Backup transport~~ **fixed** | `BaseS3BackupTransport` for any S3 compatible storage and `BaseSftpBackupTransport` for any SFTP server, beside `BaseFsBackupTransport` |
| ~~Email~~ **fixed** | `EmailTransportInterface` + `ZIBRI_DI_TOKENS.EMAIL_TRANSPORT`; `SmtpEmailTransport` ships and an http API is a class |
| ~~Email rate-limiter store~~ **withdrawn** | `EMAIL_RATE_LIMITER` is a `useClass` provider — the same answer as [§1.7](#17-mail-rate-limiter-defaults-to-in-memory--major-withdrawn-mostly) |
| ~~Events~~ **fixed** | Claimed per `(event, subscriber)` in the data source and polled by every instance — see §1.4 |
| ~~Cron~~ **fixed** | Every scheduled execution is claimed through a `CronRunLease` row — see §1.1 |
| ~~Websocket adapter~~ **fixed** | `WebsocketOptions.adapterDataSource` — see §1.10 |

> **Closed for email, and the framework's own test suite was the evidence.** `EmailService` built its
> nodemailer transporter in its own constructor, so the only way to send through anything else was to
> subclass it and override a `protected` method. **Two of the project's own fixtures did exactly
> that** — `email.service.test.ts` and `cluster/mail.instance-options.ts` — which is the finding
> stated more sharply than the finding states it: if the people who wrote the class cannot swap the
> transport without reaching past its public surface, neither can a deployment whose egress firewall
> forbids outbound SMTP. Both fixtures are now a transport registered under a token, and the service
> under them is the framework's, unmodified.
>
> **One of those overrides had drifted, which is the cost of a seam that does not exist.**
> `TestEmailService.send` predated [§2.2](#22-failed-emails-are-silently-deleted--critical-fixed):
> it deleted a failed mail the real `send` keeps, and never wrote `rejectedRecipients` at all. The
> suite's "updates email status to FAILED" test had been passing against a send this file had
> written, for a different reason than production would. It reads the row now, and the assertion the
> override could not carry is back.
>
> **The contract is which of two things a transport does when it cannot deliver**, and it needed
> saying because nothing about a `Promise` distinguishes them: *throw* means the message never
> reached the provider, so the mail stays `QUEUED` and the retained claim is the backoff; *answer
> with `rejectedRecipients`* means the provider replied and refused those addresses, which is a
> verdict and ends the mail as `FAILED`. Answering where you should throw loses mail silently.
> Throwing where you should answer sends the accepted recipients a second copy.
>
> **The config split is what the fix actually turned on.** `EmailConfig` had been carrying `host`,
> `port`, `auth` and `pool` beside `maxEmailsPerHour`, `defaultSender` and `sendLeaseInMs`, and the
> whole object was spread into `createTransport` — so nodemailer was being handed `defaultSender` and
> `maxEmailsPerHour` as options, and a misspelt SMTP setting would have been accepted just as
> quietly. The connection half moved to `SmtpEmailTransportOptions` and the rest stayed. That is a
> breaking change to a published type, taken deliberately: an option type that keeps advertising
> `host` and `port` to a deployment sending over SES is telling it something false.
>
> **No default transport**, the same way `EMAIL_CONFIG` has no default. Every transport needs
> something only the deployment knows, so there is nothing to default *to* — and picking SMTP would
> make the choice invisible again. `EmailService` refuses to construct without one and names
> `SmtpEmailTransport` in the message, so the required option costs a reader one line rather than a
> search.
>
> **`secure` became sayable while the code moved.** It had been inferred as `port === 465`, which is
> a good guess and a bad requirement — implicit TLS on another port is an ordinary arrangement. The
> inference is still the default.
>
> Held by `email-transport.evaluation.test.ts`, which sends through a transport that is not SMTP and
> does not use nodemailer, and by `email-failure.evaluation.test.ts`, which drives the shipped
> `SmtpEmailTransport` through real nodemailer against a real SMTP dialogue. Between them both sides
> of the seam are covered by something that actually sends.
>
> **Backups stay open**, and are a different shape: `BackupTransportInterface` already exists, so
> what is missing there is an implementation rather than a seam.
>
> **Backups closed too, and half of it was this row being stale** (2026-09-26). `BaseS3BackupTransport`
> had already shipped, documented and tested against a gateway that checks every signature, while
> the row still said only the filesystem one existed. It has no dependency: it signs its requests
> itself and sends them through the framework's own http client, so it inherits the retry policy,
> the size limits and the tracing every other call gets.
>
> **`BaseSftpBackupTransport` is the other half**, for everyone whose backups go to a storage box, a
> NAS or a machine of their own rather than to object storage. Unlike S3 it takes a dependency, and
> that is justified: SSH is key exchange, ciphers and host authentication, which is not something to
> write again, and `ssh2` is the implementation Node's ecosystem uses. It is an optional peer, loaded
> when a transport is built, so an application storing its backups anywhere else never loads it.
>
> **The host key is required rather than defaulted.** A transport that accepts whatever key it is
> shown hands backups to anyone who can answer on that address, and "you forgot to say" would look
> exactly like "accept anything". The fingerprint is written the way `ssh-keygen -lf` prints it,
> because that is what providers publish, and a refused key is named in the error, since the key
> the server did present is what somebody setting this up needs to compare.
>
> Two details carry the backup's own contract over to SFTP. The record is written under a
> `.partial` name and renamed once complete, because the record is what makes a backup finished,
> and one cut off mid-write must not look finished. And the last resource to be deleted takes its
> folder with it, because a folder left empty would be resolved as an interrupted backup and warned
> about on every sync. **`BaseFsBackupTransport` had exactly that defect**: it deleted the files
> and kept the folder, so every sync after a delete warned about a backup that was never
> interrupted. Found while writing the SFTP transport, and fixed with `FsUtilities.rmIfEmpty`,
> which is one `rmdir` rather than a check followed by a removal, since the resources of a backup
> are deleted at the same time; `fs.backup-transport.test.ts` holds it.
>
> **The SFTP test found a third thing, in the service**: one transport that could not be read kept
> the application from starting, because the startup sync awaited every transport and any error
> failed `afterAppInit`. A backup server having a bad day took production down with it. The startup
> sync skips such a transport now with a warning naming it, which loses nothing recorded — every
> transport of a backup holds the same record — while `syncBackupEntities()` called by hand still
> fails. `backup-service.startup-sync.test.ts` holds both halves. The SFTP
> transport is tested against a real OpenSSH server in `sftp.backup-transport.test.ts`, including a
> refused host key, key-based login and a round trip through `BackupService`.

### 5.3 Metrics collection reads the wrong network interface — MINOR, **FIXED**

> There is no right interface to pick, which is why picking one was the bug. Both counters are
> collected per interface now and labelled with its name, so `network_bytes_received_total{interface}`
> lets the query say which one it means — `lo` included, and visible as `lo` rather than silently
> standing in for the machine.
>
> The host-wide half the finding also names stays true and is documented rather than hidden: the new
> table in `docs/metrics.md` says these are the counters of the machine the process runs on.
>
> `systeminformation` stays, and the cost the finding names with it. Dropping the two counters would
> have made the dependency reviewable — it is the only thing using it — but a metric that is labelled
> and caveated is worth more than no metric, and the 5 second cadence is the cron job's to change.

`src/metrics/metrics.service.ts:157-158` — `stats[0]` is whichever interface `systeminformation`
enumerates first, frequently `lo` in a container and never guaranteed. It is also host/namespace
wide, not process scoped, so `network_bytes_received_total` is not attributable to the app. This
runs every 5 seconds forever via `CollectMetricsCronJob`, and `systeminformation` shells out to OS
utilities on several platforms.

### 5.4 No backup restore verification — MINOR, **FIXED**

> **The two fields this needed were already declared and written by nothing.**
> `BackupResourceEntity.size` and `.completed` existed, were excluded from the create data so that the
> service would fill them in, and no code ever did. Every row said a backup of unknown length had never
> finished — including the ones that had. A `completed` flag that is false for every backup ever taken
> cannot distinguish the interrupted write this finding is about from a successful one.
>
> Now: `size` and a new `checksum` are measured as the data goes past on its way to the transports,
> and `completed` is set once every transport has taken the whole thing. A restore reads the stored
> data once, checks it against that record, and refuses before applying any of it when the two differ.
> The cost is reading each archive twice, which is what buys a refusal rather than a report.
>
> **The record is written beside the data as well as into the database**, because the database is
> usually the thing being restored — a checksum that lives only in the table you lost is not a
> checksum you have. That needed `storeMetadata` on `BackupTransportInterface`, called once every
> resource is recorded. `BaseFsBackupTransport` used to write that file at the *start* of `storeData`, so
> it could only ever hold the state the backup began in, and a write killed halfway left a folder that
> announced a backup and held part of one — which `syncBackupEntities` then registered as restorable.
> **This is a breaking addition for anyone with a custom transport.**
>
> **A defect with no finding, found on the way and worse than the one filed.** `createBackup` handed
> the *same* `Readable` to `Promise.all(transports.map(t => t.storeData(data, …)))`. A stream is
> consumable once, so two transports raced over its chunks and at least one archive was written short —
> silently, because a backup nobody reads until the day they need it is a backup nobody notices is
> short. Every transport now gets its own copy, and the measurement is one more copy rather than a
> stage the data passes through.
>
> **A backup records the framework version that took it**, on the user's prompting. They asked whether
> a `zibriVersion` belonged on `BaseEntity`; the answer was no — a semver string on every row of `Log`
> and `Change`, ambiguous under update (created-at or last-written-at?), and it only shifts the
> problem, since knowing a row came from 3.0.1 says nothing until the code also holds a table of which
> feature arrived when. That table is exactly the thing that rots. On `BackupEntity` it is intrinsic
> rather than incidental: one column on a tiny table, and it rides along in the `metadata.json` that
> travels with the archive.
>
> Its first use was going to be telling "taken before checksums existed" from "never finished", which
> `completed: false` cannot do alone because the flag defaults to `false`. The user then made the
> column required — breaking changes being acceptable at this stage — which removes the distinction by
> removing the old state: a resource that records nothing is refused, full stop. What the version buys
> now is the *next* transition, which is the point they were making about backups outliving releases.
>
> One thing this forced: `mergeEntities` rebuilds a synced backup from four explicit keys, so without
> carrying the version through, every archive the transports hold would be restamped with whatever
> version happened to be reading them.
>
> **Both costs the fix introduced are gone, and it took one mechanism rather than two.** A backup is
> staged on this instance's own disk now — written there on the way out, fetched there on the way back
> — under a `BACKUP_TEMP_FOLDER` token shaped like the `FILE_UPLOAD_TEMP_FOLDER` that already existed,
> with a daily `distributed: false` cron for what a killed process leaves behind.
>
> On the **write** side that removes the coupling the tee had: transports follow the file while it is
> still being written, so each gets the whole archive and none of them paces another *or* the source.
> The user asked whether that was possible with streams, and it is — but it also turned out to be
> necessary rather than a nicety: staging fully and *then* uploading would have made the common case
> (one local transport) go from roughly the dump's own time to twice it, by serializing two things that
> used to overlap. What this actually buys is that a database dump closes its snapshot as soon as it is
> written rather than holding it open for as long as the slowest upload takes — a cost that was landing
> on the live database rather than on the backup.
>
> On the **read** side it removes the double read, and the user's objection to the first attempt was
> sharper than the design question: `resolveData(transports, resource, backup)` was being called twice
> with identical arguments, once to verify and once to restore. Staging makes one call answer both, so
> the verify pass is gone as a separate method rather than merely made cheaper.
>
> The two functions this rests on — `stage` and `followFile` — are their own module with a
> container-free test, because they are the only genuinely concurrent code here and two of their five
> cases are races: a writer that finishes before the first reader looks, and a writer that fails while
> a reader has caught up and is waiting for more. The second one is the difference between a backup
> that fails and a backup that hangs.
>
> **What stays open**, and each is its own decision rather than this one's residue:
> - ~~**Encryption of backup data.**~~ **Closed, and it was not a transport concern.** Encrypting per
>   transport would have given each copy its own ciphertext and its own checksum, left the staging
>   file on this instance's disk in plaintext, and made every custom transport implement cryptography.
>   The data is encrypted once, before it is staged, so the disk and every transport only ever hold
>   ciphertext. `@Backup` takes a required `encrypt`, since both answers are legitimate. Every backup
>   gets a random data key, and that key is stored in the record, encrypted with the master key.
>   **The key management answer was the one that already existed**: the user rejected a separate
>   backup key, because it would come from the same environment as the master key, so whoever can
>   read one can read the other. It goes through the encryption service, whose `masterEncrypt` and
>   `masterDecrypt` are on its interface for this, so an application that replaces the service
>   decides how backup keys are encrypted too. They use the master key rather than the key table
>   because a restore usually runs against a database that is being replaced. The data is
>   sealed in 64 KiB AES-256-GCM chunks, whose nonce is the chunk's position plus a last-chunk flag
>   (the STREAM construction), rather than as one message. One GCM message tops out near 64 GB, and
>   the S3 transport allows 156 GB. A restore unwraps the key before fetching anything, so a master
>   key that is no longer listed costs no download. It then decrypts while staging and applies
>   nothing until every chunk has authenticated, which also refuses an archive whose record was
>   rewritten to match it. Held by `backup-service.encryption.test.ts` (in memory) and by
>   `backup-service.test.ts`, whose postgres round trip is encrypted now.
>
>   **A defect nobody had filed came out with it, and it was not about encryption.**
>   `FsUtilities.createReadStream` decoded every file as utf8 by default. So every staged archive
>   reached its transports as text re-encoded, and `followFile` reads in ranges, which means a
>   multi-byte character split across two reads came back as two replacement characters. A
>   plain-text dump with an umlaut in the wrong place was stored altered, and the next restore
>   refused it as corrupt. The sandbox's file controller served its JPEG through the same helper,
>   with a size that no longer matched. The helper hands out bytes now. The two restores that parse
>   text, valkey's and the in-memory store's, decode the whole stream rather than each chunk.
> - ~~**A restore that is atomic.**~~ **Closed 2026-10-13.** Within one resource it already was:
>   postgres applies a dump inside psql's `--single-transaction`, and valkey stages keys and swaps them
>   in with one batch. Across resources a backup of postgres and valkey whose second restore failed
>   left the first one applied.
>
>   **It was worse than filed, and that part was a defect.** `restoreWithin` ran every resource in one
>   `Promise.all`, each staging, checking and applying on its own, so resource A could be applied while
>   resource B's archive was still being fetched and then turned out corrupt. "Refuses before applying
>   any of it" held per resource only. Red first, deterministically: B's archive was held back until A
>   reported itself applied.
>
>   **The user's choice was stage all, snapshot, undo**, over a two-phase resource interface
>   (prepare/commit, breaking for custom resources, and postgres would have to restore into a second
>   database and swap it in) and over staging alone (no answer to a failure while applying). Every
>   archive is fetched and checked first, settled rather than raced so nothing still writes to the
>   staging folder when it is cleaned. Then every resource is snapshotted through its own
>   `createBackupData`, taken before any of them changes, and the resources are applied one after
>   another. When one fails, the ones applied are put back from their snapshots, the failing one
>   included, since nothing promises a resource that throws applied none of its data. When a put-back
>   fails too, `RestoreNotUndoneError` names the resource and keeps its snapshot file. No change to
>   `BackupResourceInterface`.
>
>   **What it costs:** resources are applied one at a time instead of together, and a restore needs disk
>   for every archive plus a snapshot of each at once (docs say so). It is not atomic against a process
>   killed between two applies; that would need the two-phase interface. A resource the application no
>   longer knows is still skipped with a warning, as before.
>
>   Held by `backup-service.several-resources.test.ts` (in memory: all restored; a corrupt second
>   archive applies nothing; a failing apply is undone; a failing undo is named and its snapshot kept).
> - **The 15 minute shutdown wait** (`shutdownTimeoutInMs`) still exceeds most Kubernetes grace
>   periods. An interrupted backup is now refused rather than mistaken for a good one, which is the
>   part that bites; making the wait fit the platform is a separate question about what a backup
>   should do when it is told to stop.
> **The format contract that rule needed now exists**, at the user's prompting, and building it showed
> that `zibriVersion` was the wrong thing to key it on. The obvious rule — refuse an archive from a
> different major — ties backup compatibility to the framework's whole release cycle, so a major bump
> for something unrelated (the decorator model in 05 §M1, say) would make every archive unreadable.
> That is precisely what the user said backups must not do, so the readability rule got its own
> version: `BACKUP_FORMAT_VERSION`, which changes when the shape of a backup changes and at no other
> time. `zibriVersion` stays as provenance.
>
> `restore` refuses a `formatVersion` that is not in `READABLE_BACKUP_FORMAT_VERSIONS`, before it
> believes anything else the record says — everything else a restore reads is read *in* the shape that
> field names. The list is a list rather than a lowest-supported bound so that dropping a shape is
> something somebody writes down instead of something a comparison starts doing.
>
> **Writing that boundary down is what exposed the last defect here**, on the user's question: would a
> transport need to declare which shapes it supports, the way the encryption service takes
> `oldMasterStrategies`? No — that pattern earns its keep because strategies coexist over the same
> live rows, the framework must choose per value, and the consumer has a real implementation to plug
> in; none of that is true of a record shape, where there is one reader and "supporting an old shape"
> is framework code rather than a consumer object.
>
> But the worry was pointing at something real. A transport *did* read the record:
> `BaseFsBackupTransport.resolveBackups` called `parseObject(json, BackupEntity)` and `storeMetadata`
> serialized one, so a change of shape would have broken every custom transport — and
> `READABLE_BACKUP_FORMAT_VERSIONS` holding two entries would have meant every third-party transport
> had to support both. The fix is not letting a transport opt out of shapes but never showing it one:
> `resolveBackups` returns the stored documents unopened and `storeMetadata` is handed the document to
> store. A transport is now storage and nothing else, and the shape is read in exactly one place —
> which is also where it is checked, so a document this build cannot read is reported at discovery
> instead of being interpreted as though it were this shape.
>
> **The container run then corrected the test rather than the code**: the case that asserts an unknown
> shape is left alone rewrote the record in one of the fixture's two transports, and the backup came
> back anyway — from the other one, in a shape this build reads perfectly well. That is the behavior
> that should hold, since a sync asks every transport and one readable copy is enough to rebuild the
> entity. The case rewrites both now.
>
> So a format covers what the framework writes, and the layout a transport stores under belongs to the
> transport, which both writes and reads it. Neither covers what a resource's `createBackupData`
> produces: a postgres dump is read by postgres, and which versions of it can is postgres's contract.

`src/backup/backup.service.ts` provides create/restore and `syncBackupEntities` (`:126-143`), but
there is no checksum, no manifest hash, no restore-test path, and no encryption in
`BaseFsBackupTransport`. `syncBackupEntities` reconciles by `id` only (`:138`), so a corrupted or
truncated archive with a matching id is treated as valid. `onAppShutdown` waits up to 15 minutes
for an in-flight backup (`:71`, `:118-123`), which exceeds most Kubernetes
`terminationGracePeriodSeconds` and will be SIGKILLed mid-write, leaving a partial archive that
`syncBackupEntities` happily registers.

---

## 6. Plugins

*Added on the re-check of 2026-10-15. [09](./09-method-and-coverage.md) lists the mailing list and
payment plugins as essentially unreviewed; these are what a first read of them found.*

### 6.1 An address already on one mailing list is put on any other without confirming — MAJOR, **open**

`MailingListService.requestSubscribeToList` (`src/plugin/mailing-list/services/mailing-list.service.ts:166-199`)
looks the address up first, and when a subscriber with it exists, writes the list onto it at once
and returns: no confirmation mail, no token. The double opt-in only ever applies to an address the
application has never seen. Anybody who can call the route the application builds on it can put an
existing subscriber on every list, and the list is appended again when the subscriber is on it
already (`[...foundSubscriber.mailingLists, list]`).

### 6.2 A subscription confirmation token never expires and is never used up — MAJOR, **open**

`confirmSubscribeToList` (`:202-221`) finds the token by its value and nothing else. The
`expirationDate` written at creation (`:184`) is read nowhere, the token is not deleted once it
confirmed, nothing cleans the table up, and the value is stored as it is, which
[03 §B5](./03-auth-and-security.md) stopped doing for password reset tokens. A link from a mail
years old still subscribes, as often as it is followed. The `subscribe/:id/:token` route
(`src/plugin/mailing-list/mailing-list.controller.ts:69-87`) reads the list named in the path for the
page it renders and subscribes to the one the token names.

### 6.3 Unsubscribing is a GET, and a subscriber's id is the only credential for their preferences — MINOR, **open**

`GET /mailing-lists/:id/unsubscribe` (`src/plugin/mailing-list/mailing-list.controller.ts:89-108`)
changes state, so a mail scanner or link preview that follows the link unsubscribes the recipient.
No `List-Unsubscribe` / `List-Unsubscribe-Post` header (RFC 8058) is written, which the large mailbox
providers ask of bulk senders.

`GET` and `PATCH /mailing-lists/preferences?subscriberId=…` (`:110-134`) take the subscriber's
primary key as their whole authorization: it shows the address and name and replaces the lists. The
id is in every mail sent to the list, never changes, and is the same value the application uses for
the row everywhere else.

### 6.4 A payment changes state on what the caller's copy of it says — ~~MAJOR~~ **FIXED**

> **Closed 2026-10-15.** Each part, in the order the finding names them:
>
> - **The caller's copy.** `PaymentService` runs every transition under a lease on the payment
>   (`zibri.payment:<id>`, waited for, renewed while PayPal is called), reads the row inside it and
>   decides on that. A second confirmation waits for the first, reads PAID and warns. The caller's
>   copy is brought up to date afterwards, which the sandbox suite relies on.
> - **Any error becoming FAILED.** Every PayPal call that moves money carries a `PayPal-Request-Id`
>   (`<payment id>:capture` and so on), so a repeated one is answered like the first rather than
>   done again. A call that throws is reconciled from the order: a completed capture is PAID, an
>   authorization RESERVED, a voided one CANCELLED, a refunded capture REFUNDED. When the order says
>   the step was not done, or cannot be read, nothing is written and the error is thrown - the
>   user's choice over a new status only a reconciliation could leave, since the idempotency key
>   makes retrying safe. FAILED is written for an answer that says the money did not move. A refund
>   PayPal declines leaves the payment PAID with the error, since the money is still captured.
> - **The order before the unique column.** The row is stored before the order is created, so a
>   repeated `transactionId` is refused by the unique column before PayPal sees anything; an order
>   that cannot be created takes its row with it.
> - **500s for the caller's mistakes.** A status that does not allow the transition and a used
>   `transactionId` are `ConflictError`s (409), invalid payment data a `BadRequestError` (400).
>
> Held by `pay-pal.payment-provider.local.test.ts` (eight cases, red first), against
> `src/__testing__/local-pay-pal-server.ts`, a local PayPal serving the orders as approved and
> answering a second capture the way PayPal does; the provider reaches it through `apiUrl`, which a
> subclass overrides, as the OAuth2 authenticators' endpoints are. `payment.service.test.ts` stores
> its payments now, since a transition is judged by the stored one.

Every transition in `PaymentService` (`src/plugin/payment/services/payment.service.ts:94-169`) checks
the `status` of the object it is handed, calls the provider, and the provider writes the whole object
back with `updateById(payment.id, payment)` (eg.
`src/plugin/payment/providers/pay-pal/pay-pal.payment-provider.ts:356`). Nothing reads the row, takes
a lease or writes conditionally on the status, which [01 §M20](./01-data-layer.md) made possible.

Two confirmations of one payment - a double click, a retried request, two replicas - both see
`CREATED` and both capture. PayPal refuses the second as already captured, and the provider turns
**any** error into `status: FAILED` (`:351-352` for a reservation, the same in the others) and writes
its copy last if it finishes last. A payment that was captured is then recorded as failed, and
`FAILED` cannot be confirmed again. A single confirmation whose answer times out after PayPal
captured ends the same way.

`validatePaymentData` checks `transactionId` with a read before the order is created
(`payment.service.ts:68-71`); the unique column refuses the second row, but only after PayPal has an
order for it. Refusals a caller caused - a reused `transactionId`, a status that does not allow the
transition - are `InternalError`s, so a client's retry is answered with a 500.

### 6.5 A payment amount is a float, sent as `String(amount)` — MINOR, **open**

`PayPalPaymentData.amount` and `Payment.amount` are `number`s, and every call to PayPal writes
`value: String(amount)` (`pay-pal.payment-provider.ts:264`, `:296`, `:418`, `:497`). An amount computed
by the application, such as `0.1 + 0.2`, goes out as `0.30000000000000004`, a small one as `1e-7`, and
an amount with more decimals than its currency has (two for most, none for `JPY`) passes
`validatePaymentData` and is refused by PayPal with an error that becomes `FAILED`. The invoicing
plugin calculates with `BigNumber`; the payment plugin does not.

### 6.6 Two recipients whose names abbreviate alike draw the same invoice numbers — MAJOR, **open**

`InvoiceNumberService.getConsecutiveNumber`
(`src/plugin/invoicing/services/invoice-number.service.ts:105-125`) keeps one counter per year and
**recipient**, while the number it goes into is `<year>-<abbreviation>-<counter>` (`:40-53`), and the
abbreviation is the first six letters and digits of a company name or the first three letters of
first and last name (`invoicing.plugin.ts:69-72`). "Siemens AG" and "Siemens Healthineers" are both
`SIEMEN`, "Anna Schmidt" and "Annabelle Schmitz" both `ANNSCH`, so the second recipient's first
invoice is `2026-SIEMEN-0001` again.

`validateInvoiceNumber` (`:171-175`) refuses it with a `ConflictError`. Called inside a transaction,
which is how the counter stays gapless, the refusal rolls the increment back, so the second recipient
draws `0001` again on every attempt and cannot be invoiced at all while the first has an invoice that
year. Called without one, each attempt burns a number until the two counters stop overlapping. [1.11](#111-invoice-numbering-is-a-read-modify-write-race--critical-fixed)
made the counter atomic and left what it counts as it was; nothing in its tests uses two recipients.

### 6.7 E-invoice amounts are written unrounded, and VAT is summed per line — MAJOR, **open**

`InvoiceCalcService` (`src/plugin/invoicing/services/invoice-calc.service.ts`) calculates exactly and
rounds nowhere, and `En16931ConformanceService`
(`src/plugin/invoicing/services/conformance/en16931/en16931-conformance.service.ts:146-171`, `:237`)
writes every amount with `BigNumber.toString()`. Three items at 9.99 with 19 % VAT give a tax of
`5.6943`, written as the VAT breakdown's `CalculatedAmount` and the document's `TaxTotalAmount`.
EN 16931 allows two decimals for those amounts (the `BR-DEC` rules), so XRechnung and Peppol
validators refuse the invoice. The VAT of a breakdown is also the sum of each line's own VAT
(`getTotalTaxForTaxGroup`, `:58-65`), where the standard takes the group's taxable amount times its
rate, rounded once (`BR-S-09` and its siblings), so rounding the output alone would still leave totals
a cent apart.

`getTotalBeforeTax` clamps a negative sum to zero (`:38`), `getTotalTax` does not, so an invoice with a
credit line larger than the rest has a net total of `0`, a negative VAT and a grand total that is not
their sum. Every conformance test uses 0 % VAT and a whole price, which is the one case where none of
this shows.
