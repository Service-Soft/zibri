# Rate limiting
Rate limiting lets you cap how often a piece of code can run, per key (eg. per user or IP), using one of several interchangeable limiting algorithms.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `RateLimiter` | decorator | Registers a class as a rate limiter |
| `RateLimited` | decorator | Applies a rate limiter to a controller method |
| `TokenBucketRateLimiter` | class | Allows bursts up to capacity, refills continuously |
| `GcraRateLimiter` | class | Token bucket behavior tracked as a single timestamp |
| `LeakyBucketMeterRateLimiter` | class | Smooths bursts by tracking accumulated "water" |
| `LeakyBucketQueueRateLimiter` | class | Schedules requests to a fixed output rate |
| `FixedWindowRateLimiter` | class | Counts requests in fixed, resettable windows |
| `SlidingWindowCounterRateLimiter` | class | Approximates a sliding window, O(1) memory |
| `SlidingWindowLogRateLimiter` | class | Exact sliding window, memory grows with request volume |
| `SemaphoreRateLimiter` | class | Limits concurrent (not per-time) operations |
| `InMemoryRateLimiterStore` | class | In-memory `RateLimiterStoreInterface` implementation |
| `RateLimiterStoreInterface` | interface | Contract for persisting limiter state |
| `TooManyRequestsError` | error | Thrown when a limit is exceeded and no reservation was made |
| `ZIBRI_DI_TOKENS.RATE_LIMITING_SERVICE` | DI token | Injects `RateLimitingServiceInterface` |

## Usage
### Defining a limiter
Extend one of the algorithm classes and decorate it with `@RateLimiter()`. The decorated class acts as its own DI token, so it doesn't need an entry in `ZIBRI_DI_TOKENS`.

```ts
import { InMemoryRateLimiterStore, Ms, RateLimiter, TokenBucketRateLimiter, TokenBucketState } from 'zibri';

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

Every algorithm class takes an `intervalInMs` (or similar rate-defining argument) followed by a config object requiring at least `name`, `capacity`, `store` and `maxReservationWaitMs`. Use `InMemoryRateLimiterStore` for a single-instance app, or implement `RateLimiterStoreInterface` yourself (eg. backed by redis) to share limiter state across instances.

### Applying a limiter to an endpoint
Use `@RateLimited()` on a controller method, passing the limiter class:

```ts
import { Auth, Controller, Get, RateLimited, Response } from 'zibri';

@Auth.isLoggedIn()
@Controller('/tests', { versions: 'all' })
export class TestController {
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
- `keyFn`: resolves the rate-limit key from the method arguments (eg. per-user instead of global).
- `countFn`: how many units of capacity the call consumes (defaults to 1).
- `reserveIfUnavailable`: if `true`, falls back to reserving capacity instead of throwing when the limit is currently exceeded.

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

## See also
- [Metrics](./metrics.md) — reading rate limiter stats on the built-in dashboard
- [Error handling](./error-handling.md) — the `TooManyRequestsError` hierarchy
