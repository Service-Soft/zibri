# Rate limiting
Rate limiting lets you cap how often a piece of code can run, per key (eg. per user or IP), using one of several interchangeable limiting algorithms.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `RateLimiter` | decorator | Registers a class as a rate limiter |
| `RateLimited` | decorator | Applies a rate limiter to a controller method |
| `RateLimitKeys` | class | Helpers for the common ways of saying what a limit is counted per: `perConnection` (the default), `perUser`, `GLOBAL`. Any key of your own works too |
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
| `RateLimitStateEntity` | class | The entity that `RepositoryRateLimiterStore` persists, add it to the entities of your data source |
| `RateLimiterLockInterface` | interface | Guards the read-modify-write cycle of `RepositoryRateLimiterStore` |
| `InProcessRateLimiterLock` | class | Lock for a single instance app |
| `ValKeyRateLimiterLock` | class | Lock that lives on a valkey server, for apps that run more than once |
| `RateLimiterStoreInterface` | interface | Contract for persisting limiter state |
| `RateLimitStoreFailurePolicy` | enum | What a limiter does when it cannot reach its store: `REJECT` (the default) or `ALLOW` |
| `TooManyRequestsError` | error | Thrown when a limit is exceeded and no reservation was made |
| `RateLimitStoreUnavailableError` | error | Thrown (HTTP 503) when the limiter could not read its state and the policy is `REJECT` |
| `ZIBRI_DI_TOKENS.RATE_LIMITING_SERVICE` | DI token | Injects `RateLimitingServiceInterface` |

## Usage
### Defining a limiter
Extend one of the algorithm classes and decorate it with `@RateLimiter()`. The decorated class acts as its own DI token, so it doesn't need an entry in `ZIBRI_DI_TOKENS`.

```ts
// src/rate-limiters/test.rate-limiter.ts
import { inject, InMemoryRateLimiterStore, Ms, RateLimiter, RateLimitStateEntity, RateLimitStoreFailurePolicy, RepositoryRateLimiterStore, repositoryTokenFor, TokenBucketRateLimiter, TokenBucketState, ValKeyRateLimiterLock } from 'zibri';

import { CacheDbDataSource } from '../data-sources';

@RateLimiter()
export class TestRateLimiter extends TokenBucketRateLimiter {
    constructor() {
        super(
            Ms.MINUTE * 5, {
                name: 'TestRateLimiter',
                store: new InMemoryRateLimiterStore<TokenBucketState>(),
                capacity: 1,
                maxReservationWaitMs: undefined
            }
        );
    }
}
```

Every algorithm class takes an `intervalInMs` (or similar rate-defining argument) followed by a config object requiring at least `name`, `capacity`, `store` and `maxReservationWaitMs`.

### Sharing limits across instances
`InMemoryRateLimiterStore` only knows about the process it runs in, so as soon as an app runs more than once every instance has its own limits. `RepositoryRateLimiterStore` keeps the state in a data source instead, which means all instances share it. It goes through a repository, so it works with any data source — valkey and postgres alike:

```ts
new RepositoryRateLimiterStore<TokenBucketState>(
    inject(repositoryTokenFor(RateLimitStateEntity, CacheDbDataSource)),
    new ValKeyRateLimiterLock(inject(CacheDbDataSource))
)
```

Add `RateLimitStateEntity` to the `entities` of the data source that should hold the limits. It is marked `allowDuplicate`, so several data sources can hold their own limits — name the one you mean when injecting the repository.

The second argument is the lock. Reading the state, running the algorithm and writing the result are separate operations, so without a lock two concurrent updates read the same state and one of them is silently lost:

| Lock | Use for |
|---|---|
| `InProcessRateLimiterLock` | a single instance — serializes per key inside the process |
| `ValKeyRateLimiterLock` | multiple instances — takes the lock on the valkey server, expiring on its own so a dead instance cannot block a limit forever |

Note that `WATCH` / `MULTI` / `EXEC` is *not* a working alternative for the valkey lock: `WATCH` is state of the connection, and the client multiplexes every command over a single one, so concurrent updates would all watch the same key on the same connection and silently lose each other's writes. You can also implement `RateLimiterStoreInterface` yourself.

A lock that lives outside the process has to expire on its own, or one instance dying takes a key with it. That means it can expire while the section it guards is still running — a slow query, a long garbage collection pause — and a second instance can then hold the same lock at the same time. `RepositoryRateLimiterStore` does not depend on that never happening: every state carries a `version` that the write compares as part of the update, so the second writer is refused and starts over against what the first one left behind, rather than overwriting it. The lock keeps that situation rare; the version is what makes it harmless. A lock of your own only has to provide mutual exclusion for the common case.

### When the store cannot answer
A limiter whose store is unreachable — the data source is down, the lock never came free, the store is full — knows nothing about the caller, so it can neither say yes nor say no truthfully. Which way to be wrong is a decision about what the limit protects, so it is yours to make:

```ts
// src/rate-limiters/thumbnail.rate-limiter.ts
@RateLimiter()
export class ThumbnailRateLimiter extends TokenBucketRateLimiter {
    constructor() {
        super(Ms.MINUTE, {
            name: 'ThumbnailRateLimiter',
            store: new InMemoryRateLimiterStore<TokenBucketState>(),
            capacity: 20,
            maxReservationWaitMs: undefined,
            onStoreFailure: RateLimitStoreFailurePolicy.ALLOW
        });
    }
}
```

`REJECT` is the default and answers `RateLimitStoreUnavailableError` — HTTP 503, not 500, because nothing about the request was wrong and retrying is reasonable. Keep it for anything the limit is protecting rather than shaping: a limit that quietly stops applying is one nobody finds out about until it mattered. `ALLOW` runs the call anyway, which suits a limiter that is only smoothing traffic and should not take an endpoint down along with the store.

Either way the failure is counted on the limiter's error metric, so `ALLOW` does not mean invisible. A limit that says no is unaffected — that is still a `TooManyRequestsError`, whatever the policy.

### How many keys a limiter holds
`InMemoryRateLimiterStore` keeps a key for as long as it is unexpired, and expired ones are cleared out in bulk every ten seconds. Under normal traffic that settles at roughly "distinct callers per window". If it does not, something is wrong rather than busy — usually a `keyFn` deriving keys from something with no natural bound, or an app that has outgrown a store living inside a single process. `maxKeys` is what the store holds at most, 100 000 by default:

```ts
new InMemoryRateLimiterStore<TokenBucketState>({ maxKeys: 5000 })
```

A full store refuses keys it has never seen, which reaches the caller as whatever that limiter's `onStoreFailure` says, and reports itself once as an error in the log. Keys already in the store keep counting exactly, so what being full costs is one limited endpoint rather than the process — and rather than the limit itself, which is what evicting would cost: whoever filled the store would be resetting everybody else's counter for them.

### Applying a limiter to an endpoint
Use `@RateLimited()` on a controller method, passing the limiter class:

```ts
// src/controllers/test.controller.ts
import { Auth, Controller, Get, InjectRepository, RateLimited, RateLimitKeys, Repository, Response } from 'zibri';

import { Test } from '../models';

@Auth.isLoggedIn()
@Controller('/tests', { versions: 'all' })
export class TestController {
    constructor(
        @InjectRepository(Test)
        private readonly testRepository: Repository<Test>
    ) {}

    @RateLimited(TestRateLimiter)
    @Response.array(Test)
    @Get()
    async find(): Promise<Test[]> {
        return await this.testRepository.findAll();
    }
}
```

If the limit is reached, a `TooManyRequestsError` (HTTP 429) is thrown, carrying the rate-limit result (limit, remaining, reset time) on `.rateLimitResult`.
<br>
`@RateLimited` also accepts an options object:
- `keyFn`: what the limit is counted per — a key, or a function resolving one from the arguments.
- `countFn`: how many units of capacity the call consumes (defaults to 1).
- `reserveIfUnavailable`: if `true`, falls back to reserving capacity instead of throwing when the limit is currently exceeded.

### What a limit is counted per
**Limits count per caller unless you say otherwise** — the client address over http, the connection
over a websocket. `RateLimitKeys` names the choices:

```ts
// src/controllers/keyed.controller.ts
@Controller('/keyed', { versions: 'all' })
export class KeyedController {
    @RateLimited(TestRateLimiter)                                    // per caller, the default
    @Get('/login')
    async login(): Promise<void> {}

    @RateLimited(TestRateLimiter, { keyFn: RateLimitKeys.perUser })  // per logged in user
    @Get('/export')
    async exportData(): Promise<void> {}

    @RateLimited(TestRateLimiter, { keyFn: RateLimitKeys.GLOBAL })   // one bucket for everyone
    @Get('/mail')
    async mail(): Promise<void> {}

    @RateLimited(TestRateLimiter, { keyFn: (id: string) => `tenant:${id}` }) // from the arguments
    @Get('/tenant/:id')
    async tenant(id: string): Promise<void> {}
}
```

Reach for `GLOBAL` when the limit belongs to the *resource* rather than the caller — an outgoing mail
server that accepts so many messages an hour, whoever asked for them. It is also where every per
caller key lands when there is no request at all, such as work started by a cron job.

Be aware of what a shared bucket means: one caller can spend everybody else's capacity, so a single
attacker can lock out your whole user base. That is why it is not the default.

If your application runs behind a load balancer or ingress, tell it so with `security.trustProxy` —
see [app settings](./app-settings.md). Until it knows, the client address is the last hop it actually
saw, which is the proxy, and every request lands in the same bucket.

### Choosing an algorithm
- **`TokenBucketRateLimiter`**: the default choice for most cases. Allows bursts up to `capacity`, then refills continuously.
- **`GcraRateLimiter`**: behaves like a token bucket but stores state as a single timestamp instead of a token count — cheaper to store.
- **`FixedWindowRateLimiter`**: simplest and cheapest, but can allow up to `2x capacity` in a short burst straddling a window boundary.
- **`SlidingWindowCounterRateLimiter`**: avoids the fixed-window boundary burst problem, without the memory cost of logging every request.
- **`SlidingWindowLogRateLimiter`**: exact sliding-window enforcement, at the cost of memory growing with request volume.
- **`LeakyBucketMeterRateLimiter`**: smooths bursts by modeling requests as water leaking out of a bucket at a constant rate.
- **`LeakyBucketQueueRateLimiter`**: schedules requests onto a fixed output rate instead of rejecting bursts outright, up to a max queue depth/wait time.
- **`SemaphoreRateLimiter`**: limits concurrent operations rather than a rate over time (eg. "at most 5 running exports at once"). Permits must be released after use; `wrap` does this automatically.

### Reservations
Instead of immediately rejecting a request that exceeds the limit, a limiter can reserve capacity for later. A reservation debits capacity immediately, even if it isn't available yet, and must eventually be either committed or cancelled — unresolved reservations are automatically cancelled and refunded after their `expiresAtMs`. This is used automatically when `reserveIfUnavailable: true` is passed to `@RateLimited`.

## Configuration
Rate limiting has no global options to configure — each limiter is configured individually through its own constructor (see above). To read the list of currently registered limiters (eg. for a dashboard), inject `RateLimitingServiceInterface`:

```ts
import { inject, RateLimitingServiceInterface, ZIBRI_DI_TOKENS } from 'zibri';

const rateLimitingService: RateLimitingServiceInterface = inject(ZIBRI_DI_TOKENS.RATE_LIMITING_SERVICE);
const limiterNames: string[] = rateLimitingService.limiters.map(l => l.config.name);
```

Each limiter also reports metrics (allowed/blocked counts, active keys, active reservations, decision duration, store duration) through the [metrics](./metrics.md) system automatically.

A cleanup job runs every ten seconds against every limiter, dropping expired state and giving back the capacity of reservations nobody came back for. It costs two store operations per limiter regardless of how many keys there are, plus one update for each key that is actually holding an abandoned reservation — usually none. It runs on every instance rather than on one, because the default store is per instance and each has its own state to expire.

## See also
- [Replication](./replication.md) — why a limiter needs a shared store once there is more than one instance
- [Metrics](./metrics.md) — reading rate limiter stats on the built-in dashboard
- [Error handling](./error-handling.md) — the `TooManyRequestsError` hierarchy
