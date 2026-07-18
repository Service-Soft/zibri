# Events
A durable pub/sub system for decoupling parts of your app. Unlike a plain event emitter, every emitted event and every subscriber's processing attempt is persisted, so events survive restarts and are retried until every subscriber that was registered at emit time has successfully processed them.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `EventService` | class | Default implementation of `EventServiceInterface` |
| `EventServiceInterface` | interface | Contract for emitting and subscribing to events |
| `EventSubscribeOptions` | type | Options passed to `subscribe`/`subscribeAll` (`subscriberId`, `attempts`, `timeout`) |
| `EventSubscriptionInterface` | type | Return value of `subscribe`/`subscribeAll`, exposes `unsubscribe` |
| `Event` | entity | Persisted record of an emitted event |
| `EventSubscriberRun` | entity | Persisted record of one subscriber's attempt at processing an event |
| `EventCleanupCronJob` | class | Cron job that deletes finished events past their `cleanupAt` |
| `EventProcessingError` | error | Logged when a subscriber's hook fails after exhausting all attempts |
| `ZIBRI_DI_TOKENS.EVENT_SERVICE` | DI token | Injects `EventServiceInterface` |

## Usage
### Subscribing to an event
Inject `EventServiceInterface` and call `subscribe` with the event type, a hook and options. `subscriberId` is required and must stay stable across restarts (see below).

```ts
// src/events/register-user-events.ts
import { EventServiceInterface, inject, ZIBRI_DI_TOKENS } from 'zibri';

type AppEvents = {
    userCreated: { userId: string }
};

const eventService: EventServiceInterface<AppEvents> = inject(ZIBRI_DI_TOKENS.EVENT_SERVICE);

await eventService.subscribe(
    'userCreated',
    async (event) => {
        // event.data is typed as { userId: string }
        await sendWelcomeMail(event.data.userId);
    },
    { subscriberId: 'send-welcome-mail', attempts: 3, timeout: 5000 }
);
```

`subscribeAll` works the same way but receives every event type, regardless of `type`.
<br>
Both methods reject if the given `subscriberId` is already used for a conflicting subscription (eg. subscribing to `'userCreated'` while already subscribed via `subscribeAll`). Subscribing the same `subscriberId` to the same event twice simply returns the existing subscription instead of creating a duplicate.

### Emitting an event
```ts
await eventService.emit('userCreated', { userId: user.id });
```

`emit` persists the event together with the ids of every subscriber currently registered for it, then pushes it onto the internal RxJS subject. Subscribers registered *after* the event was emitted will not receive it.
<br>
An optional third argument, `cleanupAfterMs`, controls how long after creation a finished event is kept before `EventCleanupCronJob` deletes it. Defaults to one day (`Ms.DAY`).

### Unsubscribing
Both `subscribe` and `subscribeAll` resolve to an `EventSubscriptionInterface`:

```ts
const subscription = await eventService.subscribe('userCreated', hook, { subscriberId: 'send-welcome-mail' });
subscription.unsubscribe();
```

### Why `subscriberId` must stay stable
Per the `EventSubscribeOptions` JSDoc, the id "needs to be unique and should stay consistent to survive power cycles". On `onAppStart`, `EventService` reloads every event that isn't `FINISHED` and re-emits it internally so pending subscribers can pick up where they left off. Matching an event's remaining subscribers against completed `EventSubscriberRun` records is done by `subscriberId` — if a subscriber uses a different id after a restart, it looks like a brand-new subscriber and the event's already-run subscribers won't be recognized as done for it.

## Configuration
`Event` and `EventSubscriberRun` are regular entities and must be added to a data source's `entities` array, same as any other entity (see [data source](./data-source.md)). `EventService` validates this on `onAppInit` and throws a `MissingEntitiesError` naming exactly what's missing if you forget.
<br>
`EventService` also registers `EventCleanupCronJob` automatically on `onAppInit` if it isn't already present in `app.options.cronJobs` — no manual registration needed.

### Retry and timeout semantics
Passed per-subscription via `EventSubscribeOptions`:
- `attempts` — how many times the hook is retried before giving up. Defaults to `1` (no retry).
- `timeout` — milliseconds the hook has to finish, per attempt, before it's aborted and counted as a failure. Defaults to `30000` (30 seconds). The hook receives an `AbortSignal` as its second argument that fires when the timeout elapses.

If every attempt fails, an `EventProcessingError` is logged via the configured logger (see [logging](./logging.md)) and an `EventSubscriberRun` is still created for that subscriber, with the error attached — the event is only left un-`FINISHED` for subscribers that never ran at all, not for ones that ran and failed.

## See also
- [Data source](./data-source.md) — registering the `Event`/`EventSubscriberRun` entities on a data source
- [Cron](./cron.md) — how `EventCleanupCronJob` and other cron jobs work
- [Logging](./logging.md) — where `EventProcessingError` ends up when a subscriber's hook keeps failing
