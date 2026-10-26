# Rate limiting
Rate limiting caps how often a piece of code runs, per key such as a user or an IP address. Each limiter uses one of several interchangeable algorithms.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `RateLimiter` | decorator | Registers a class as a rate limiter |
| `RateLimited` | decorator | Applies a rate limiter to a controller method |
| `RateLimitedOptions` | type | The options of `@RateLimited`: the key, the count, and whether to reserve capacity when the limit is reached |
| `RateLimitWrapOptions`, `RateLimitWrapResult`, `RateLimitKeyProvider`, `RateLimitCountProvider` | type, type, type, type | The options of `wrap` on a limiter, what it returns, and the functions giving the key and the count of a call |
| `RateLimiterInterface`, `isRateLimiter`, `BaseRateLimiter` | interface, function, class | What a rate limiter implements, the check whether a value is one, and the base class of every built-in limiter |
| `RateLimiterConfig`, `RateLimiterConfigInput`, `SemaphoreConfigInput` | type, type, type | What a limiter is configured with: its name, capacity, store, reservation limits and `onStoreFailure`, and what a `SemaphoreRateLimiter` is configured with |
| `RateLimitKeys` | class | Helpers for the common ways of saying what a limit is counted per: `perConnection` (the default: an IPv4 address, an IPv6 /64, or a websocket connection), `perUser`, `GLOBAL`. Any key of your own works too |
| `TokenBucketRateLimiter` | class | Allows bursts up to capacity, refills continuously |
| `GcraRateLimiter` | class | Token bucket behavior tracked as a single timestamp |
| `LeakyBucketMeterRateLimiter` | class | Smooths bursts by tracking accumulated "water" |
| `LeakyBucketQueueRateLimiter` | class | Schedules requests to a fixed output rate |
| `FixedWindowRateLimiter` | class | Counts requests in fixed, resettable windows |
| `SlidingWindowCounterRateLimiter` | class | Approximates a sliding window, O(1) memory |
| `SlidingWindowLogRateLimiter` | class | Exact sliding window, memory grows with request volume |
| `SemaphoreRateLimiter` | class | Limits concurrent (not per-time) operations |
| `InMemoryRateLimiterStore` | class | In-memory `RateLimiterStoreInterface` implementation |
| `RepositoryRateLimiterStore` | class | `RateLimiterStoreInterface` implementation that keeps its state in any data source, so limits are shared across instances |
| `InMemoryRateLimiterStoreOptions`, `RepositoryRateLimiterStoreOptions` | type, type | How many keys a store holds at most, as `maxKeys` |
| `RateLimitStateEntity` | class | The entity that `RepositoryRateLimiterStore` persists, add it to the entities of your data source |
| `RateLimiterLockInterface` | interface | Guards the read-modify-write cycle of `RepositoryRateLimiterStore` |
| `InProcessRateLimiterLock` | class | Lock for a single instance app |
| `ValKeyRateLimiterLock` | class | Lock that lives on a Valkey server, for apps that run more than once |
| `RateLimiterStoreInterface` | interface | Contract for persisting limiter state |
| `RateLimiterStoreUpdateResult` | type | What `atomicUpdate` of a store answers: the new state, and whether the number of keys changed |
| `RateLimitStoreFailurePolicy` | enum | What a limiter does when it cannot reach its store: `REJECT` (the default) or `ALLOW` |
| `TooManyRequestsError` | error | Thrown when a limit is exceeded and no reservation was made |
| `RateLimitStoreUnavailableError` | error | Thrown (HTTP 503) when the limiter could not read its state and the policy is `REJECT` |
| `RateLimitResult`, `SuccessRateLimitResult`, `FailedRateLimitResult` | type, type, type | The outcome of consuming from a limiter: whether it is allowed, the limit, what remains and when it resets, and when to retry once it is not allowed |
| `RateLimitReservation` | class | Capacity reserved for later: its key, count, when it is ready and when it expires. Resolved once, through `commitReservation` or `cancelReservation` of its limiter |
| `RateLimitReservationResult`, `SuccessRateLimitReservationResult`, `FailedRateLimitReservationResult`, `RateLimitReservationRejectionReason` | type, class, class, enum | The outcome of reserving, and why a reservation is refused: `EXCEEDS_CAPACITY`, `EXCEEDS_RESERVATION_LIMIT` or `QUEUE_TOO_LONG` |
| `RateLimitReservationNotFoundError` | error | Thrown when no reservation with the given key and id exists |
| `RateLimitReservationError` | error | Thrown when taking a reservation from a limit failed |
| `TokenBucketState` | type | The state a `TokenBucketRateLimiter` keeps per key, which types its store |
| `BaseRateLimitState`, `FixedWindowState`, `GcraState`, `LeakyBucketMeterState`, `LeakyBucketQueueState`, `ScheduledItem`, `SemaphoreState`, `SlidingWindowCounterState`, `SlidingWindowLogState` | type, type, type, type, type, type, type, type, type | The expiry and reservations every limiter state holds, the state each of the other limiters keeps per key, which types its store, and an item scheduled in a leaky bucket queue |
| `RateLimitingServiceInterface` | interface | The registered limiters, and `addLimiter` for one built while the application starts |
| `RateLimitingService` | class | The default `RateLimitingServiceInterface`. Replaceable through `ZIBRI_DI_TOKENS.RATE_LIMITING_SERVICE` |
| `RateLimitingCleanupCronJob` | cron job | Removes the expired limiter state, and refunds the reservations nobody committed or canceled in time, every ten seconds. Registered for you |
| `ZIBRI_DI_TOKENS.RATE_LIMITING_SERVICE` | DI token | Injects `RateLimitingServiceInterface` |

## Defining a limiter
Extend one of the algorithm classes and decorate it with `@RateLimiter()`. The decorated class is its own DI token, so it needs no entry in `ZIBRI_DI_TOKENS`.

```ts
// src/rate-limiters/task.rate-limiter.ts
import { InMemoryRateLimiterStore, Ms, RateLimiter, TokenBucketRateLimiter, TokenBucketState } from 'zibri';

@RateLimiter()
export class TaskRateLimiter extends TokenBucketRateLimiter {
    constructor() {
        super(
            Ms.MINUTE * 5, {
                name: 'TaskRateLimiter',
                store: new InMemoryRateLimiterStore<TokenBucketState>(),
                capacity: 1,
                maxReservationWaitInMs: undefined
            }
        );
    }
}
```

Every algorithm class takes an `intervalInMs`, or a similar argument that defines the rate, followed by a config object. The config needs at least `name`, `capacity`, `store` and `maxReservationWaitInMs`.

## Sharing limits across instances
`InMemoryRateLimiterStore` keeps its state in the process, so each instance of an application has its own limits. `RepositoryRateLimiterStore` keeps the state in a data source, which every instance shares. It goes through a repository, so it works with any data source, Valkey and Postgres alike:

```ts
// src/rate-limiters/task.rate-limiter.ts, as its store
import { inject, RateLimitStateEntity, RepositoryRateLimiterStore, repositoryTokenFor, TokenBucketState, ValKeyRateLimiterLock } from 'zibri';

import { CacheDbDataSource } from '../data-sources';

new RepositoryRateLimiterStore<TokenBucketState>(
    inject(repositoryTokenFor(RateLimitStateEntity, CacheDbDataSource)),
    new ValKeyRateLimiterLock(inject(CacheDbDataSource)),
    'TaskRateLimiter'
)
```

Add `RateLimitStateEntity` to the `entities` of the data source that holds the limits. It is marked `allowDuplicate`, so several data sources can hold limits of their own. Name the one you mean when you inject the repository.

The third argument is the namespace. It keeps the state of each store apart from every other store in the same table. Use the name of the limiter. A second store with a namespace that is already taken in the running application is refused.

The second argument is the lock. Reading the state, running the algorithm and writing the result are separate operations, and the lock keeps concurrent updates of one key apart. Without one, two concurrent updates read the same state and one of them is lost.

| Lock | Use for |
|---|---|
| `InProcessRateLimiterLock` | A single instance. Serializes per key inside the process |
| `ValKeyRateLimiterLock` | Several instances. Takes the lock on the Valkey server, and expires on its own, so an instance that dies cannot block a limit forever |

You can also implement `RateLimiterStoreInterface` yourself.

A lock outside the process expires on its own, so it can expire while the update it guards is still running, and a second instance can then take it. `RepositoryRateLimiterStore` stays correct when that happens. Every state carries a `version`, and a write whose `version` changed in the meantime is refused and runs again against the newer state. No update is lost. A lock of your own only has to keep updates apart in the common case.

## When the store cannot answer
A limiter whose store is unreachable knows nothing about the caller: the data source is down, the lock never came free, or the store is full. `onStoreFailure` says what the limiter does then:

```ts
// src/rate-limiters/thumbnail.rate-limiter.ts
import { InMemoryRateLimiterStore, Ms, RateLimiter, RateLimitStoreFailurePolicy, TokenBucketRateLimiter, TokenBucketState } from 'zibri';

@RateLimiter()
export class ThumbnailRateLimiter extends TokenBucketRateLimiter {
    constructor() {
        super(Ms.MINUTE, {
            name: 'ThumbnailRateLimiter',
            store: new InMemoryRateLimiterStore<TokenBucketState>(),
            capacity: 20,
            maxReservationWaitInMs: undefined,
            onStoreFailure: RateLimitStoreFailurePolicy.ALLOW
        });
    }
}
```

`REJECT` is the default. It answers with a `RateLimitStoreUnavailableError`, an HTTP 503, which tells the caller that retrying is reasonable. Keep it for a limit that protects something. `ALLOW` runs the call anyway. Use it for a limiter that only smooths traffic, so the endpoint stays up while the store is down.

Either way the failure is counted on the limiter's error metric. A limit that says no is unaffected by the policy: it throws a `TooManyRequestsError`.

## How many keys a limiter holds
`InMemoryRateLimiterStore` keeps a key while it is unexpired, and clears out the expired ones in bulk every ten seconds. Under normal traffic it holds about one key per distinct caller per window. A store that grows past that usually has a `keyFn` that derives keys from something without a natural bound, or belongs to an application that has outgrown a store inside one process. `maxKeys` caps the keys the store holds, 100 000 by default:

```ts
// src/rate-limiters/task.rate-limiter.ts, as its store
import { InMemoryRateLimiterStore, TokenBucketState } from 'zibri';

new InMemoryRateLimiterStore<TokenBucketState>({ maxKeys: 5000 })
```

A full store refuses keys it has never seen. The caller gets whatever that limiter's `onStoreFailure` says, and the store logs one error. Keys already in the store keep counting exactly. A full store costs one limited endpoint, and resets no caller's counter.

`RepositoryRateLimiterStore` takes the same option as its fourth argument, 1 000 000 by default, and is full the same way:

```ts
// src/rate-limiters/task.rate-limiter.ts, as its store
import { inject, RateLimitStateEntity, RepositoryRateLimiterStore, repositoryTokenFor, TokenBucketState, ValKeyRateLimiterLock } from 'zibri';

import { CacheDbDataSource } from '../data-sources';

new RepositoryRateLimiterStore<TokenBucketState>(
    inject(repositoryTokenFor(RateLimitStateEntity, CacheDbDataSource)),
    new ValKeyRateLimiterLock(inject(CacheDbDataSource)),
    'TaskRateLimiter',
    { maxKeys: 200_000 }
)
```

Its size is the number of unexpired keys of its namespace, counted at most every ten seconds per instance, plus the keys that instance created since. Instances creating keys at the same moment can take it past `maxKeys` by what they create in those ten seconds.

## Applying a limiter to an endpoint
Use `@RateLimited()` on a controller method, passing the limiter class:

```ts
// src/controllers/task.controller.ts
import { Auth, Controller, Get, InjectRepository, RateLimited, Repository, Response } from 'zibri';

import { Task } from '../models';
import { TaskRateLimiter } from '../rate-limiters/task.rate-limiter';

@Auth.isLoggedIn()
@Controller('/tasks', { versions: 'all' })
export class TaskController {
    constructor(
        @InjectRepository(Task)
        private readonly taskRepository: Repository<Task>
    ) {}

    @RateLimited(TaskRateLimiter)
    @Response.array(Task)
    @Get()
    async find(): Promise<Task[]> {
        return await this.taskRepository.findAll();
    }
}
```

When the limit is reached, the call throws a `TooManyRequestsError` (HTTP 429). Its `.rateLimitResult` carries the limit, what remains and the reset time.

`@RateLimited` also takes an options object:
- `keyFn`: what the limit is counted per, as a key or a function resolving one from the arguments.
- `countFn`: how many units of capacity the call consumes. Defaults to 1.
- `reserveIfUnavailable`: with `true`, the call reserves capacity instead of throwing when the limit is currently exceeded.
- `refundOnSuccess`: with `true`, what the call consumed is given back once it returns, so only calls that throw count. For a limit on trying something, such as a login.

## What a limit is counted per
A limit counts per caller unless you name a key: the client address over HTTP, the connection
over a websocket. `RateLimitKeys` names the choices:

```ts
// src/controllers/keyed.controller.ts
import { Controller, Get, RateLimited, RateLimitKeys } from 'zibri';

import { TaskRateLimiter } from '../rate-limiters/task.rate-limiter';

@Controller('/keyed', { versions: 'all' })
export class KeyedController {
    @RateLimited(TaskRateLimiter)                                    // per caller, the default
    @Get('/login')
    async login(): Promise<void> {}

    @RateLimited(TaskRateLimiter, { keyFn: RateLimitKeys.perUser })  // per logged in user
    @Get('/export')
    async exportData(): Promise<void> {}

    @RateLimited(TaskRateLimiter, { keyFn: RateLimitKeys.GLOBAL })   // one bucket for everyone
    @Get('/mail')
    async mail(): Promise<void> {}

    @RateLimited(TaskRateLimiter, { keyFn: (id: string) => `tenant:${id}` }) // from the arguments
    @Get('/tenant/:id')
    async tenant(id: string): Promise<void> {}
}
```

Use `GLOBAL` when the limit belongs to the resource, not to the caller: an outgoing mail server
that accepts so many messages an hour, whoever asked for them. `GLOBAL` is also where every per
caller key lands when there is no request, such as for work a cron job started.

> [!WARNING]
> In a shared bucket, one caller can spend everybody else's capacity, so a single attacker can lock
> out every user.

> [!WARNING]
> If your application runs behind a load balancer or ingress, set `security.trustProxy`, see
> [app settings](./app-settings.md). Without it, the client address is the last hop the
> application saw, which is the proxy, and every request lands in the same bucket.

## Choosing an algorithm
- **`TokenBucketRateLimiter`**: the default choice for most cases. Allows bursts up to `capacity`, then refills continuously.
- **`GcraRateLimiter`**: behaves like a token bucket, and stores its state as a single timestamp instead of a token count, which is cheaper to store.
- **`FixedWindowRateLimiter`**: the cheapest. Can allow up to `2x capacity` in a short burst across a window boundary.
- **`SlidingWindowCounterRateLimiter`**: has no burst at a window boundary, and no memory cost of logging every request.
- **`SlidingWindowLogRateLimiter`**: an exact sliding window. Its memory grows with request volume.
- **`LeakyBucketMeterRateLimiter`**: smooths bursts by modeling requests as water leaking out of a bucket at a constant rate.
- **`LeakyBucketQueueRateLimiter`**: schedules requests onto a fixed output rate instead of rejecting bursts outright, up to a maximum queue depth or wait time.
- **`SemaphoreRateLimiter`**: limits concurrent operations, not a rate over time, for example "at most 5 running exports at once". Permits are released after use, and `wrap` releases them for you.

## Reserving capacity for later
A limiter can reserve capacity for later instead of rejecting a request that exceeds the limit. A reservation takes capacity at once, even before it is available, and is then either committed or canceled. A reservation nobody resolves is canceled and refunded once its `expiresAtMs` passes. `reserveIfUnavailable: true` on `@RateLimited` reserves for you.

## Configuration
Rate limiting has no global options. Each limiter is configured through its own constructor, see above. To read the registered limiters, for a dashboard for example, inject `RateLimitingServiceInterface`:

```ts
// src/services/rate-limiter-overview.ts
import { inject, RateLimitingServiceInterface, ZIBRI_DI_TOKENS } from 'zibri';

const rateLimitingService: RateLimitingServiceInterface = inject(ZIBRI_DI_TOKENS.RATE_LIMITING_SERVICE);
const limiterNames: string[] = rateLimitingService.limiters.map(l => l.config.name);
```

A limiter built while the application starts, by a feature only some applications use, is added with `addLimiter`, so the cleanup below reaches it too.

Each limiter reports [metrics](./metrics.md#what-a-snapshot-contains): allowed and blocked counts, active keys, active reservations, decision duration and store duration.

A cleanup job runs every ten seconds against every limiter, on every instance. It drops expired state and gives back the capacity of reservations nobody came back for. It costs two store operations per limiter, however many keys there are, plus one update for each key holding an abandoned reservation.

## Requirements
The data source that holds the limits declares these entities:

| Entity | Needed when |
|---|---|
| `RateLimitStateEntity` | A rate limiter keeps its state in `RepositoryRateLimiterStore` |

How large each table grows, and what deletes its rows, is in [framework tables](./framework-tables.md).

## See also
- [Replication](./replication.md) — why a limiter needs a shared store once there is more than one instance
- [Metrics](./metrics.md) — reading rate limiter stats on the built-in dashboard
- [Error handling](./error-handling.md) — the `TooManyRequestsError` hierarchy
