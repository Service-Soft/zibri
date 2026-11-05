# Events
A durable pub/sub system for decoupling parts of your app. Unlike a plain event emitter, it stores every emitted event together with where each of its subscribers stands: how many attempts that subscriber has spent, and what the last one failed with. Events survive restarts. They are retried until every subscriber registered at emit time has handled them or spent all its attempts.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `EventService` | class | Default implementation of `EventServiceInterface` |
| `EventServiceInterface` | interface | Contract for emitting and subscribing to events |
| `ZibriEventMap` | interface | The events of your application and their payloads, declared by extending it |
| `EventSubscribeOptions` | type | Options passed to `subscribe`/`subscribeAll` (`subscriberId`, `attempts`, `timeoutInMs`, `delivery`, `runsOn`) |
| `EventHook` | type | The hook of a subscriber: handed the event, a signal and its run |
| `QueuedWorkRun` | type | What an attempt is handed: a `runId` the same on every attempt, which `attempt` it is, its `signal` and its `transaction` |
| `QueueDelivery` | type | How often a hook runs when an instance stops at the wrong moment: `'atLeastOnce'`, `'atMostOnce'` or `'transactional'`, see [choosing how a hook is delivered](#choosing-how-a-hook-is-delivered) |
| `EventSubscriptionInterface` | type | Return value of `subscribe`/`subscribeAll`, exposes `unsubscribe` |
| `EventSubscription` | class | What `EventService` returns from `subscribe`/`subscribeAll` |
| `EventReplayOptions` | type | Which failed runs `replayFailed` offers again (`eventIds`, `subscriberIds`, `types`, `acrossTenants`) |
| `FrameworkEventNames` | type | Which writes of users, [memberships](./glossary.md#membership) and roles are emitted, each as an event type of yours, via `ZIBRI_DI_TOKENS.FRAMEWORK_EVENT_NAMES`. Defaults to none, see [hearing of users, memberships and roles](#hearing-of-users-memberships-and-roles) |
| `UserEventData`, `MembershipEventData`, `RolesChangedEventData` | type, type, type | What the events of users, memberships and roles carry |
| `EventTypeFor` | type | The event types of your `ZibriEventMap` whose payload some data fits |
| `Event` | entity | Persisted record of an emitted event |
| `EventSubscriberRun` | entity | Persisted ledger of one subscriber's attempts at one event: where it stands, how many it has spent, and what the last one failed with |
| `EventStatus` | enum | `CREATED`, `FINISHED` or `FAILED`: where an event stands with all of its subscribers |
| `EventSubscriberRunStatus` | enum | `PENDING_RETRY`, `SUCCEEDED` or `FAILED`: where a subscriber stands with an event |
| `EventSubscriberRegistration` | entity | Which subscribers exist across the deployment |
| `EventDispatchCronJob` | cron job | Hands unfinished events back to the subscribers of this instance, so an event survives a restart. Registered for you |
| `EventCleanupCronJob` | cron job | Deletes `FINISHED` events past their `cleanupAt`, and `FAILED` ones older than `EVENT_FAILED_RETENTION_IN_MS` |
| `EventProcessingError` | error | Logged when a subscriber's hook fails after exhausting all attempts |
| `ZIBRI_DI_TOKENS.EVENT_SERVICE` | DI token | Injects `EventServiceInterface` |
| `ZIBRI_DI_TOKENS.EVENT_SUBSCRIBER_REGISTRATION_TTL_IN_MS` | DI token | How long a subscriber stays on record without being refreshed. Defaults to one minute |
| `ZIBRI_DI_TOKENS.EVENT_RETRY_DELAY_IN_MS` | DI token | How long the first retry waits, doubling for each one after it. Defaults to one minute |
| `ZIBRI_DI_TOKENS.EVENT_MAX_CONCURRENT_HOOKS` | DI token | How many hooks one instance runs at a time. Defaults to 50 |
| `ZIBRI_DI_TOKENS.EVENT_HOOK_TIMEOUT_IN_MS` | DI token | How long a hook whose subscriber names no `timeoutInMs` may take. Defaults to 30 seconds |
| `ZIBRI_DI_TOKENS.EVENT_FINISHED_RETENTION_IN_MS` | DI token | How long a finished event that names no `cleanupAfterInMs` is kept. Defaults to one day |
| `ZIBRI_DI_TOKENS.EVENT_FAILED_RETENTION_IN_MS` | DI token | How long a `FAILED` event is kept, counted from when it was emitted, or `'forever'`. Required |
| `ZIBRI_DI_TOKENS.FRAMEWORK_EVENT_NAMES` | DI token | Injects `FrameworkEventNames`. Defaults to none |

## Declaring what your application emits
Declare your events once, anywhere in your project, by extending `ZibriEventMap`:

```ts
// src/events/app-events.ts
declare module 'zibri' {
    interface ZibriEventMap {
        userCreated: { userId: string },
        taskAssigned: { taskId: string, userId: string }
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
        { subscriberId: 'send-welcome-mail', attempts: 3, timeoutInMs: 5000 }
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

An optional third argument, `cleanupAfterInMs`, sets how long a finished event is kept after it was created. `EventCleanupCronJob` deletes it after that. Defaults to `ZIBRI_DI_TOKENS.EVENT_FINISHED_RETENTION_IN_MS`, one day by default, which also covers the events the framework emits.

An event emitted in a [tenant](./tenancy.md#work-outside-a-request) belongs to it, and every hook runs in that tenant, whichever instance picks the event up.

## Hearing of users, memberships and roles
A write to users, memberships or roles can be emitted as an event of yours, however it is made: through the auth service, a repository or a provisioning provider. Declare a type for each one you want in your event map:

```ts
// src/events/account-events.ts
import { MembershipEventData, UserEventData } from 'zibri';

declare module 'zibri' {
    interface ZibriEventMap {
        accountRemoved: UserEventData,
        teamMemberLeft: MembershipEventData
    }
}

export {};
```

and name it in `ZIBRI_DI_TOKENS.FRAMEWORK_EVENT_NAMES`:

```ts
// src/providers.ts
import { defineProvider, ZIBRI_DI_TOKENS } from 'zibri';

defineProvider({
    token: ZIBRI_DI_TOKENS.FRAMEWORK_EVENT_NAMES,
    useValue: { userDeleted: 'accountRemoved', membershipEnded: 'teamMemberLeft' }
})
```

| Name | Emitted when | Carries |
|---|---|---|
| `userDeleted` | A user is removed from the store. A soft deleted user is not | `UserEventData` |
| `userDeactivated` | An active user is deactivated | `UserEventData` |
| `userReactivated` | A deactivated user is reactivated | `UserEventData` |
| `membershipStarted` | A user becomes an active member of a tenant: a membership is created, reactivated, or moved to them | `MembershipEventData` |
| `membershipEnded` | A user stops being an active member of a tenant: their membership is deleted, deactivated, or moved to somebody else | `MembershipEventData` |
| `rolesChanged` | A role is created, changed or deleted. Once for each tenant whose own roles changed, and once with `tenantId: null` for the roles every tenant shares | `RolesChangedEventData` |

A type whose payload the event does not fit does not compile. None is emitted until you name it, and each one you name costs every write of its kind a read of the rows it changes and an event. An event of a membership or of a tenant's own role belongs to that tenant, and one of a user or of a shared role to none.

> [!NOTE]
> An event is emitted once its write is committed. An instance that stops between the commit and the emit loses that one event.

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

## Handling events out of order
Hooks run in no fixed order. Two events of one type run on whichever instances pick them up, at the same time or one after the other. A subscriber runs independently of the other subscribers of the same event. A hook that fails is [retried](#retry-and-timeout-semantics) after events that were emitted later.

A hook that depends on order reads the current state of what the event is about, such as the task row, rather than trusting the payload to be the latest. Or the payload carries a version of that state, and the hook ignores a payload older than what it already handled.

## Changing what an event carries
A hook can receive an event that an older or a newer deploy of your application emitted. During a rolling deploy both versions run at once, and [`replayFailed`](#replaying-failed-runs) runs events again that failed days ago.

A change that a hook of the other version can still read needs nothing extra, such as a new optional property. A change it cannot read goes under a new event type:

```ts
// src/events/app-events.ts
declare module 'zibri' {
    interface ZibriEventMap {
        taskAssigned: { taskId: string, userId: string },
        taskAssignedV2: { taskId: string, assigneeIds: string[] }
    }
}

export {};
```

Emit both types and subscribe to the new one. Once no `taskAssigned` event is left unfinished or [failed](#when-an-event-cannot-be-handled), stop emitting it and remove it.

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

## Choosing how a hook is delivered
A hook runs at least once: an instance that stops after the hook did its work and before its run is recorded leaves the work to another, which runs the hook again. The third argument of a hook is its run. Its `runId` names the event and the subscriber, the same on every attempt, so the work it does elsewhere can be made safe to repeat, such as the idempotency key of a message to a chat service:

```ts
// src/events/announce-assignment.subscription.ts
import { EventServiceInterface } from 'zibri';

import { postToChat } from '../services/chat';

export async function subscribeAnnounceAssignment(eventService: EventServiceInterface): Promise<void> {
    await eventService.subscribe(
        'taskAssigned',
        async (event, signal, run) => {
            await postToChat(event.data.taskId, event.data.userId, { idempotencyKey: run.runId, signal });
        },
        { subscriberId: 'announce-assignment', attempts: 3 }
    );
}
```

`delivery` chooses otherwise:

| `delivery` | The hook | Use it when |
|---|---|---|
| `'atLeastOnce'` | Runs again after an instance stopped at the wrong moment. The default | Its work is safe to repeat, or carries `runId` to something that drops repeats |
| `'transactional'` | Writes through `run.transaction`, a [transaction across data sources](./data-source.md#writing-to-several-data-sources-in-one-transaction) which records its run too, so its writes happen once. A hook that throws has its writes rolled back | Its work is writes through repositories |
| `'atMostOnce'` | Is recorded as failed before it runs, so it never runs twice, and is not retried. An instance stopping during it leaves it `FAILED` | A repeat is worse than a miss, such as a push notification |

```ts
// src/events/comment-assignment.subscription.ts
import { EventServiceInterface, inject, Repository, repositoryTokenFor } from 'zibri';

import { Comment } from '../entities/comment.entity';

export async function subscribeCommentAssignment(eventService: EventServiceInterface): Promise<void> {
    const comments: Repository<Comment> = inject(repositoryTokenFor(Comment));
    await eventService.subscribe(
        'taskAssigned',
        async (event, _signal, run) => {
            await comments.create({ taskId: event.data.taskId, text: 'Assigned' }, { transaction: run.transaction });
        },
        { subscriberId: 'comment-assignment', delivery: 'transactional' }
    );
}
```

## Running on every instance
A subscriber with `runsOn: 'everyInstance'` runs on every instance that hosts it, such as one that clears what that instance keeps in memory:

```ts
// src/events/forget-workload.subscription.ts
import { EventServiceInterface } from 'zibri';

import { workloads } from '../services/workloads';

export async function subscribeForgetWorkload(eventService: EventServiceInterface): Promise<void> {
    await eventService.subscribe(
        'taskAssigned',
        event => workloads.forget(event.data.userId),
        { subscriberId: 'forget-workload', runsOn: 'everyInstance' }
    );
}
```

It runs once on each instance, as the event is emitted: on the emitting instance at once, and on the others through the data source's messages. It owes the event no run, so the event is finished without it, and a hook that throws is logged and not run again.

> [!NOTE]
> A subscriber on every instance is best effort. An instance that is down when the event is emitted misses it, and with a data source that carries no messages between instances, only the emitting instance runs it.

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
- `timeoutInMs`: milliseconds the hook has to finish, per attempt, before it is aborted and counted as a failure. Defaults to `ZIBRI_DI_TOKENS.EVENT_HOOK_TIMEOUT_IN_MS`, 30 seconds by default. The hook receives an `AbortSignal` as its second argument. It fires when the timeout elapses, and when the [claim](#running-more-than-one-instance) on the event is lost.

Each delivery runs one attempt. A hook that fails leaves its `EventSubscriberRun` at `PENDING_RETRY`, with a `nextAttemptAt`, the attempts spent so far, and the failure as a `LoggedError` that keeps the message and the chain of causes. `EventDispatchCronJob` offers the event again once that time has passed. Until then the event's `nextDispatchAt` keeps it out of the poll, unless another subscriber owes it a run that is due.

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

How large each table grows, and what deletes its rows, is in [framework tables](./framework-tables.md).

## See also
- [Replication](./replication.md) — how each subscriber handles an event once across instances
- [Background work](./background-work.md) — choosing between events, thread jobs, cron jobs and the other tools
- [Data source](./data-source.md) — registering the `Event`/`EventSubscriberRun` entities on a data source
- [Cron](./cron.md) — how `EventCleanupCronJob` and other cron jobs work
- [Logging](./logging.md) — where `EventProcessingError` ends up when a subscriber's hook keeps failing
