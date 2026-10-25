# Events
A durable pub/sub system for decoupling parts of your app. Unlike a plain event emitter, it stores every emitted event together with where each of its subscribers stands: how many attempts that subscriber has spent, and what the last one failed with. Events survive restarts. They are retried until every subscriber registered at emit time has handled them or spent all its attempts.

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
| `EventStatus` | enum | `CREATED`, `FINISHED` or `FAILED`: where an event stands with all of its subscribers |
| `EventSubscriberRunStatus` | enum | `PENDING_RETRY`, `SUCCEEDED` or `FAILED`: where a subscriber stands with an event |
| `EventSubscriberRegistration` | entity | Which subscribers exist across the deployment |
| `EventCleanupCronJob` | cron job | Deletes `FINISHED` events past their `cleanupAt`, and `FAILED` ones older than `EVENT_FAILED_RETENTION_IN_MS` |
| `EventProcessingError` | error | Logged when a subscriber's hook fails after exhausting all attempts |
| `ZIBRI_DI_TOKENS.EVENT_SERVICE` | DI token | Injects `EventServiceInterface` |
| `ZIBRI_DI_TOKENS.EVENT_SUBSCRIBER_REGISTRATION_TTL_IN_MS` | DI token | How long a subscriber stays on record without being refreshed. Defaults to one minute |
| `ZIBRI_DI_TOKENS.EVENT_RETRY_DELAY_IN_MS` | DI token | How long the first retry waits, doubling for each one after it. Defaults to one minute |
| `ZIBRI_DI_TOKENS.EVENT_MAX_CONCURRENT_HOOKS` | DI token | How many hooks one instance runs at a time. Defaults to 50 |
| `ZIBRI_DI_TOKENS.EVENT_FAILED_RETENTION_IN_MS` | DI token | How long a `FAILED` event is kept, counted from when it was emitted, or `'forever'`. Required |

## Declaring what your application emits
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

`emit` and `subscribe` are checked against this map. Emitting a type nobody declared is a compile error, and a hook gets the payload of the type it names.

## Subscribing to an event
Inject `EventServiceInterface` and call `subscribe` with the event type, a hook and options. `subscriberId` is required and stays the same across restarts, see [keeping it stable](#keeping-subscriberid-stable).

```ts
// src/events/register-user-events.ts
import { EventServiceInterface, inject, ZIBRI_DI_TOKENS } from 'zibri';

import { sendWelcomeMail } from '../services/welcome-mail';

export async function registerUserEvents(): Promise<void> {
    const eventService: EventServiceInterface = inject(ZIBRI_DI_TOKENS.EVENT_SERVICE);

    await eventService.subscribe(
        'userCreated',
        async (event) => {
            await sendWelcomeMail(event.data.userId);
        },
        { subscriberId: 'send-welcome-mail', attempts: 3, timeout: 5000 }
    );
}
```

`event.data` is typed as `{ userId: string }`, the payload `userCreated` declares.

`subscribeAll` works the same way and receives every event type.

Both reject a `subscriberId` that is already used for a conflicting subscription, such as subscribing it to `'userCreated'` while it is subscribed through `subscribeAll`. Subscribing the same `subscriberId` to the same event again returns the existing subscription.

## Emitting an event
```ts
// src/services/user.service.ts
import { EventServiceInterface } from 'zibri';

export async function announceUser(eventService: EventServiceInterface, userId: string): Promise<void> {
    await eventService.emit('userCreated', { userId });
}
```

`emit` stores the event together with the ids of every subscriber registered for it at that moment, and hands it to them. A subscriber registered after the emit does not receive it.

An optional third argument, `cleanupAfterMs`, sets how long a finished event is kept after it was created. `EventCleanupCronJob` deletes it after that. Defaults to one day (`Ms.DAY`).

An event emitted in a [tenant](./tenancy.md#work-outside-a-request) belongs to it, and every hook runs in that tenant, whichever instance picks the event up.

## Unsubscribing
Both `subscribe` and `subscribeAll` resolve to an `EventSubscriptionInterface`:

```ts
// src/events/welcome-mail.subscription.ts
import { Event, EventServiceInterface, EventSubscriptionInterface } from 'zibri';

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

## Keeping `subscriberId` stable
A `subscriberId` is unique, and stays the same across restarts. `EventDispatchCronJob` offers every event that is still owed to this instance's subscribers again, so pending work continues after a restart. An event knows its subscribers by `subscriberId`. A subscriber that comes back under a different id is a new subscriber, and the runs recorded under its old id are not its own.

## Running more than one instance

A `subscriberId` names a subscriber, not a process. Every replica of your image registers the same subscriber under the same id, and the deployment runs it once per event. A `send-welcome-mail` subscriber sends one mail, not one per pod.

Each attempt is claimed through a [lease](./leases.md). One instance wins the claim and runs the hook, and the others skip. The claim stays after the hook finishes, so an instance arriving later does not run the same subscriber again.

The `EventSubscriberRun` row records how the last attempt ended. It is written when the attempt is over, while the claim is still held. A run at `SUCCEEDED` means the work is done.

If the instance holding a claim dies mid-hook, the claim expires after `ZIBRI_DI_TOKENS.EVENT_EXECUTION_LEASE_IN_MS`, one minute by default, and another instance picks the work up. An instance that shuts down gracefully hands its claim back, and another instance takes over at once.

The claim is renewed for as long as the hook runs, so the lease puts no deadline on your code. Keep it well above a normal run: it is how long the work waits after an instance stops existing.

A hook whose claim is lost while it runs is told through its signal. That happens when the store was unreachable for longer than the lease, or when another instance took the claim. Its result is not recorded: whoever took the claim runs the hook again and writes the row. A hook that carries on does its work twice, so a hook with side effects stops when its signal fires.

```ts
// src/providers.ts
import { defineProvider, Ms, ZIBRI_DI_TOKENS } from 'zibri';

defineProvider({ token: ZIBRI_DI_TOKENS.EVENT_EXECUTION_LEASE_IN_MS, useFactory: () => Ms.MINUTE * 10 })
```

### Replicas that are not identical

Tiers that differ need nothing extra, for example a `web` deployment that emits and a `worker` deployment that handles, each with its own subscribers for the same event.

Subscribing writes an `EventSubscriberRegistration` row, so every instance reads the same set of subscribers. `emit` records that deployment-wide set on the event. An event is finished once all of them have run, wherever they live.

A registration is refreshed while any instance hosting that subscriber is alive. It lapses `ZIBRI_DI_TOKENS.EVENT_SUBSCRIBER_REGISTRATION_TTL_IN_MS` after the last one goes away, one minute by default. A subscriber you deleted stops holding events unfinished once its registration lapses. A tier that is down for a shorter time keeps its events: they stay unfinished, and are handed over when it returns.

Raise it if a tier can be down longer than a minute during a deploy, and its events should wait for it.

## Configuration
Add `Event`, `EventSubscriberRun` and `EventSubscriberRegistration` to a data source's `entities` array, like any other entity (see [data source](./data-source.md)), together with the `Lease` entity (see [leases](./leases.md)).

Set `ZIBRI_DI_TOKENS.EVENT_FAILED_RETENTION_IN_MS`, how long a `FAILED` event is kept. It has [no default](./faq.md#why-do-some-options-have-no-default):

```ts
// src/providers.ts
import { defineProvider, Ms, ZIBRI_DI_TOKENS } from 'zibri';

defineProvider({ token: ZIBRI_DI_TOKENS.EVENT_FAILED_RETENTION_IN_MS, useValue: Ms.DAY * 90 })
```

`EventService` registers `EventCleanupCronJob` and `EventDispatchCronJob` on `onAppInit`, unless `app.options.cronJobs` already contains them. `EventDispatchCronJob` offers unfinished events again, including work an instance that died left behind. It runs on every instance, and the claim decides which one runs each hook.

### How many hooks run at once
An instance runs at most `ZIBRI_DI_TOKENS.EVENT_MAX_CONCURRENT_HOOKS` hooks at a time, 50 by default. `emit` hands the event to every subscriber and returns, so a burst of emits is a burst of hooks.

A hook over the limit does not start. The event still owes that subscriber a run, so `EventDispatchCronJob` offers it again on its next pass: the work is late, not lost. Each pass offers the oldest pending events first. An event whose owed subscribers all wait for a retry is left out until its earliest retry is due, so events waiting on long retries do not hold up the events behind them.

When `emit` resolves, the event is stored and owed. Nothing has necessarily run yet, on another instance or on a busy local one.

Raise the limit for hooks that spend their time waiting on something else. Lower it for hooks that do real work on the event loop.

### Retry and timeout semantics
Passed per subscription via `EventSubscribeOptions`:
- `attempts`: how many times the hook runs in total before the subscriber gives up. Defaults to `1`, a single attempt.
- `timeout`: milliseconds the hook has to finish, per attempt, before it is aborted and counted as a failure. Defaults to `30000` (30 seconds). The hook receives an `AbortSignal` as its second argument. It fires when the timeout elapses, and when the [claim](#running-more-than-one-instance) on the event is lost.

Each delivery runs one attempt. A hook that fails leaves its `EventSubscriberRun` at `PENDING_RETRY`, with a `nextRetryAt`, the attempts spent so far, and the failure as a `LoggedError` that keeps the message and the chain of causes. `EventDispatchCronJob` offers the event again once that time has passed. Until then the event's `nextDispatchAt` keeps it out of the poll, unless another subscriber owes it a run that is due.

The delay doubles from `ZIBRI_DI_TOKENS.EVENT_RETRY_DELAY_IN_MS`, one minute by default: the second attempt waits a minute, the third two, the fourth four. A retry starts no sooner than `EVENT_EXECUTION_LEASE_IN_MS` after the failed attempt, because that attempt keeps its claim until then.

Attempts are counted per subscriber and event, across instances and restarts. A subscriber with `attempts: 3` gets three, whichever instance runs each one.

A retry that succeeds clears the error and puts the run at `SUCCEEDED`. Spending the last attempt puts it at `FAILED` and logs an `EventProcessingError` via the configured logger (see [logging](./logging.md)).

### When an event cannot be handled
An event is `FINISHED` once every subscriber registered at emit time has `SUCCEEDED`. If any of them gave up instead, the event is `FAILED`.

`EventCleanupCronJob` deletes `FINISHED` events past their `cleanupAt`. A `FAILED` event and the runs under it are kept for `ZIBRI_DI_TOKENS.EVENT_FAILED_RETENTION_IN_MS`, counted from when it was emitted. Together they record what was emitted, which subscribers gave up, what each of them failed with, and how many attempts it took. Query them by status:

```ts
// src/services/failed-events.service.ts
import { Event, EventStatus, inject, Repository, repositoryTokenFor } from 'zibri';

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
// src/services/failed-events.service.ts
import { EventServiceInterface } from 'zibri';

export async function replayWelcomeMails(eventService: EventServiceInterface): Promise<number> {
    return await eventService.replayFailed({ subscriberIds: ['send-welcome-mail'] });
}
```

`eventIds`, `subscriberIds` and `types` select the runs. Each one you give narrows the selection, and `{}` selects every failed run. The runs are those of the active [tenant](./tenancy.md#reaching-every-tenant), or of every tenant with `acrossTenants: true`.

Each selected run gets all of its `attempts` again, with the delay starting over, and its event is owed again, so `EventDispatchCronJob` offers it on its next pass. A run whose subscriber no instance has registered stays `FAILED`. `replayFailed` resolves to the number of runs it offered again.

## Requirements
Your data source declares these entities:

| Entity | Needed when |
|---|---|
| `Event`, `EventSubscriberRun`, `EventSubscriberRegistration` | Every application |

## See also
- [Replication](./replication.md) — how an event is handled exactly once across instances
- [Data source](./data-source.md) — registering the `Event`/`EventSubscriberRun` entities on a data source
- [Cron](./cron.md) — how `EventCleanupCronJob` and other cron jobs work
- [Logging](./logging.md) — where `EventProcessingError` ends up when a subscriber's hook keeps failing
