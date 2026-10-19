# Events
A durable pub/sub system for decoupling parts of your app. Unlike a plain event emitter, every emitted event is persisted along with where each of its subscribers stands — how many attempts that subscriber has spent and what the last one failed with — so events survive restarts and are retried until every subscriber that was registered at emit time has either successfully processed them or spent all its attempts.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `EventService` | class | Default implementation of `EventServiceInterface` |
| `EventServiceInterface` | interface | Contract for emitting and subscribing to events |
| `EventSubscribeOptions` | type | Options passed to `subscribe`/`subscribeAll` (`subscriberId`, `attempts`, `timeout`) |
| `EventSubscriptionInterface` | type | Return value of `subscribe`/`subscribeAll`, exposes `unsubscribe` |
| `EventReplayOptions` | type | Which failed runs `replayFailed` offers again (`eventIds`, `subscriberIds`, `types`, `acrossTenants`) |
| `Event` | entity | Persisted record of an emitted event |
| `EventSubscriberRun` | entity | Persisted ledger of one subscriber's attempts at one event: where it stands, how many it has spent, and what the last one failed with |
| `EventSubscriberRunStatus` | enum | `PENDING_RETRY`, `SUCCEEDED` or `FAILED` — where a subscriber stands with an event |
| `EventSubscriberRegistration` | entity | Which subscribers exist across the deployment |
| `EventCleanupCronJob` | class | Cron job that deletes `FINISHED` events past their `cleanupAt`, and `FAILED` ones older than `EVENT_FAILED_RETENTION_IN_MS` |
| `EventProcessingError` | error | Logged when a subscriber's hook fails after exhausting all attempts |
| `ZIBRI_DI_TOKENS.EVENT_SERVICE` | DI token | Injects `EventServiceInterface` |
| `ZIBRI_DI_TOKENS.EVENT_SUBSCRIBER_REGISTRATION_TTL_IN_MS` | DI token | How long a subscriber stays on record without being refreshed. Defaults to one minute |
| `ZIBRI_DI_TOKENS.EVENT_RETRY_DELAY_IN_MS` | DI token | How long the first retry waits, doubling for each one after it. Defaults to one minute |
| `ZIBRI_DI_TOKENS.EVENT_MAX_CONCURRENT_HOOKS` | DI token | How many hooks one instance runs at a time. Defaults to 50 |
| `ZIBRI_DI_TOKENS.EVENT_FAILED_RETENTION_IN_MS` | DI token | How long a `FAILED` event is kept, counted from when it was emitted, or `'forever'`. Required |

## Usage
### Declaring what your application emits
Declare your events once, anywhere in your project, by extending `ZibriEventMap`:

```ts
// src/events/app-events.ts
declare module 'zibri' {
    interface ZibriEventMap {
        userCreated: { userId: string }
    }
}

export {};
```

That is what `emit` and `subscribe` are checked against: emitting a type nobody declared is a compile error, and a hook is handed the payload belonging to the type it named.

### Subscribing to an event
Inject `EventServiceInterface` and call `subscribe` with the event type, a hook and options. `subscriberId` is required and must stay stable across restarts (see below).

```ts
// src/events/register-user-events.ts
import { defineProvider, Event, EventServiceInterface, EventStatus, EventSubscriptionInterface, inject, Ms, Repository, repositoryTokenFor, ZIBRI_DI_TOKENS } from 'zibri';

import { sendWelcomeMail } from '../services/welcome-mail';

export async function registerUserEvents(): Promise<void> {
    const eventService: EventServiceInterface = inject(ZIBRI_DI_TOKENS.EVENT_SERVICE);

    await eventService.subscribe(
        'userCreated',
        async (event) => {
            // event.data is typed as { userId: string }
            await sendWelcomeMail(event.data.userId);
        },
        { subscriberId: 'send-welcome-mail', attempts: 3, timeout: 5000 }
    );
}
```

`subscribeAll` works the same way but receives every event type, regardless of `type`.
<br>
Both methods reject if the given `subscriberId` is already used for a conflicting subscription (eg. subscribing to `'userCreated'` while already subscribed via `subscribeAll`). Subscribing the same `subscriberId` to the same event twice simply returns the existing subscription instead of creating a duplicate.

### Emitting an event
```ts
export async function announceUser(eventService: EventServiceInterface, userId: string): Promise<void> {
    await eventService.emit('userCreated', { userId });
}
```

`emit` persists the event together with the ids of every subscriber currently registered for it, then pushes it onto the internal RxJS subject. Subscribers registered *after* the event was emitted will not receive it.
<br>
An optional third argument, `cleanupAfterMs`, controls how long after creation a finished event is kept before `EventCleanupCronJob` deletes it. Defaults to one day (`Ms.DAY`).
<br>
An event emitted in a [tenant](./tenancy.md#work-outside-a-request) belongs to it, and every hook runs in that tenant, whichever instance picks the event up.

### Unsubscribing
Both `subscribe` and `subscribeAll` resolve to an `EventSubscriptionInterface`:

```ts
export async function subscribeOnce(
    eventService: EventServiceInterface,
    hook: (event: Event<{ userId: string }>) => Promise<void>
): Promise<void> {
    const subscription: EventSubscriptionInterface = await eventService.subscribe(
        'userCreated',
        hook,
        { subscriberId: 'send-welcome-mail' }
    );
    subscription.unsubscribe();
}
```

### Why `subscriberId` must stay stable
Per the `EventSubscribeOptions` JSDoc, the id "needs to be unique and should stay consistent to survive power cycles". `EventDispatchCronJob` periodically reloads every event that is still owed and re-offers it to this instance's subscribers, so pending work is picked up where it left off. Matching an event's remaining subscribers against completed `EventSubscriberRun` records is done by `subscriberId` — if a subscriber uses a different id after a restart, it looks like a brand-new subscriber and the event's already-run subscribers won't be recognized as done for it.

### Running more than one instance

A `subscriberId` identifies a **logical subscriber, not a process**. Every replica running your image registers the same subscriber under the same id, and the event is processed **once across the deployment** — a `send-welcome-mail` subscriber sends one mail, not one per pod.

That is enforced by a [lease](./leases.md) keyed `event:<event id>:<subscriber id>`. Every replica that could handle the event tries to take it and exactly one succeeds; the rest skip. The grant is **retained** when the hook finishes, so a replica arriving a moment later cannot run the same subscriber again.

The `EventSubscriberRun` row is the separate, permanent record that the run happened. It is written when the hook is **over**, not before it starts, so a row existing means the work is done — there is no "claimed but unfinished" state to reason about.

If the instance holding a grant dies mid-hook, the grant expires after `ZIBRI_DI_TOKENS.EVENT_EXECUTION_LEASE_IN_MS` (one minute by default) and another instance picks the work up. A replica that shuts down *gracefully* hands its grant back instead, so the takeover is immediate rather than a lease away.

The grant is renewed underneath the hook for as long as it runs, so the lease is not a deadline on your code. It still wants to be comfortably larger than a normal run, because it is how long the work waits after a replica stops existing:

```ts
defineProvider({ token: ZIBRI_DI_TOKENS.EVENT_EXECUTION_LEASE_IN_MS, useFactory: () => Ms.MINUTE * 10 })
```

#### Replicas that are not identical

Nothing extra to do, but worth knowing how it works if your tiers differ — a `web` deployment that emits and a `worker` deployment that handles, each with its own subscribers for the same event.

Subscribing writes an `EventSubscriberRegistration` row, so the set of subscribers is something every instance can read rather than something each one knows only about itself. `emit` records that deployment-wide set on the event, and an event is finished once all of them have run — not once the emitting process's own subscribers have.

A registration is refreshed while any instance hosting that subscriber is alive, and lapses `ZIBRI_DI_TOKENS.EVENT_SUBSCRIBER_REGISTRATION_TTL_IN_MS` (one minute by default) after the last one goes away. That window is what stops a subscriber you have deleted from holding events unfinished forever, and it is also why a tier that is briefly entirely down does not lose its events: the registration outlives the outage, so the events stay unfinished and are handed over when it returns.

Raise it if a tier can be down longer than a minute during a deploy and you would rather events waited for it than moved on without it.

## Configuration
`Event`, `EventSubscriberRun` and `EventSubscriberRegistration` are regular entities and must be added to a data source's `entities` array, same as any other entity (see [data source](./data-source.md)). `EventService` validates this on `onAppInit` and throws a `MissingEntitiesError` naming exactly what's missing if you forget. Coordination additionally needs the `Lease` entity — see [leases](./leases.md).
<br>
`EventService` refuses to start without `ZIBRI_DI_TOKENS.EVENT_FAILED_RETENTION_IN_MS`, how long a `FAILED` event is kept:

```ts
defineProvider({ token: ZIBRI_DI_TOKENS.EVENT_FAILED_RETENTION_IN_MS, useValue: Ms.DAY * 90 })
```
<br>
`EventService` also registers `EventCleanupCronJob` and `EventDispatchCronJob` automatically on `onAppInit` if they aren't already present in `app.options.cronJobs` — no manual registration needed. `EventDispatchCronJob` is what re-offers unfinished events, including work abandoned by an instance that died; it is deliberately not distributed, so every instance polls and the lease decides who runs.

### How many hooks run at once
An instance runs at most `ZIBRI_DI_TOKENS.EVENT_MAX_CONCURRENT_HOOKS` hooks at a time — 50 by default. `emit` hands the event to every subscriber and returns, so a burst of emits is a burst of hooks, and each one holds a timeout timer, a claim being renewed, and rows to write.

A hook that would go over the limit is **not started, and not queued in memory**. The event is a row that still owes that subscriber a run, so `EventDispatchCronJob` offers it again on its next pass — the work is late rather than lost. The same poll reads a bounded, oldest-first page of pending events for the same reason.

So `emit` resolving means the event is stored and owed, not that anything has run yet. That is already true of a subscriber living on another instance; the limit makes it true of a busy local one as well.

Raise it for hooks that spend their time waiting on something else, lower it for hooks that do real work on the event loop.

### Retry and timeout semantics
Passed per-subscription via `EventSubscribeOptions`:
- `attempts` — how many times the hook is run in total before the subscriber gives up. Defaults to `1`, which is a single attempt.
- `timeout` — milliseconds the hook has to finish, per attempt, before it's aborted and counted as a failure. Defaults to `30000` (30 seconds). The hook receives an `AbortSignal` as its second argument that fires when the timeout elapses.

**One attempt per delivery.** A hook that fails leaves its `EventSubscriberRun` at `PENDING_RETRY` with a `nextRetryAt`, the attempts spent so far, and the failure as a `LoggedError` — the same `name`/`paragraphs`/`stackTrace` shape the logger persists, so the message and the chain of causes survive the trip into the column. `EventDispatchCronJob` offers the event again once that time has passed. The delay doubles from `ZIBRI_DI_TOKENS.EVENT_RETRY_DELAY_IN_MS` (one minute by default), so the second attempt waits a minute, the third two, the fourth four. A retry never comes sooner than the execution lease lapses, since the failed attempt keeps its grant until then — which is why the two defaults are the same number.

Because the attempts are spread across polls and restarts, they are counted on the row rather than in the process running them: a subscriber with `attempts: 3` gets three, whichever instance happens to run each one.

A retry that succeeds clears the error and puts the run at `SUCCEEDED`. Spending the last attempt puts it at `FAILED` and logs an `EventProcessingError` via the configured logger (see [logging](./logging.md)).

### When an event cannot be handled
An event is `FINISHED` once every subscriber registered at emit time has `SUCCEEDED`. If any of them gave up instead, the event is `FAILED`.

`EventCleanupCronJob` deletes `FINISHED` events past their `cleanupAt`. A `FAILED` event and the runs under it are kept for `ZIBRI_DI_TOKENS.EVENT_FAILED_RETENTION_IN_MS`, counted from when it was emitted, because together they are the record of work that was owed and never done — what was emitted, which subscribers gave up, what each of them failed with, and how many attempts it took. Query them by status:

```ts
export async function findFailedEvents(): Promise<Event<unknown>[]> {
    const repository: Repository<Event<unknown>> = inject(repositoryTokenFor(Event));
    return await repository.findAll({
        where: { status: EventStatus.FAILED },
        relations: ['eventSubscriberRuns']
    });
}
```

Once older than the retention, `EventCleanupCronJob` deletes them with their runs. With `'forever'`, they are kept until you delete them.

### Replaying failed runs
Once the cause is fixed, `replayFailed` offers failed runs to their subscribers again:

```ts
export async function replayWelcomeMails(eventService: EventServiceInterface): Promise<number> {
    return await eventService.replayFailed({ subscriberIds: ['send-welcome-mail'] });
}
```

`eventIds`, `subscriberIds` and `types` select the runs. Each one you give narrows the selection, and `{}` selects every failed run. The runs are those of the active [tenant](./tenancy.md#reaching-every-tenant), or of every tenant with `acrossTenants: true`.

Each selected run gets all of its `attempts` again, with the delay starting over, and its event is owed again, so `EventDispatchCronJob` offers it on its next pass. A run whose subscriber no instance has registered any more stays `FAILED`. `replayFailed` resolves to the number of runs it offered again.

## See also
- [Replication](./replication.md) — how an event is handled exactly once across instances
- [Data source](./data-source.md) — registering the `Event`/`EventSubscriberRun` entities on a data source
- [Cron](./cron.md) — how `EventCleanupCronJob` and other cron jobs work
- [Logging](./logging.md) — where `EventProcessingError` ends up when a subscriber's hook keeps failing
