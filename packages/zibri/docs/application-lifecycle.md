# Application lifecycle
Zibri exposes hooks that run at specific points while the app boots up and shuts down. Any `@Injectable` provider can implement one or more of these hooks to run setup or teardown logic, eg. connect to an external system on boot, warm a cache, or flush something on shutdown.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `BeforeAppInit` | interface | Runs before the app initializes, for services others rely on being available early |
| `OnAppInit` | interface | Runs when the app initializes |
| `AfterAppInit` | interface | Runs just after the app initializes, for services that create new work relying on others being operational |
| `OnAppStart` | interface | Runs while the app is starting, before the port is bound |
| `AfterAppStart` | interface | Runs once the app is accepting requests |
| `BeforeAppShutdown` | interface | Runs before the app shuts down, while most services are still operational |
| `OnAppShutdown` | interface | Runs when the app shuts down |
| `AfterAppShutdown` | interface | Runs just after the app shuts down, for services that need to stay available longest (eg. the data source) |
| `GlobalRegistry` | class | Static registry holding global app state and shared app data |
| `AppState` | enum | The possible states an app can be in |
| `MiddlewarePhase` | enum | Where a middleware sits in the request pipeline |

## Usage
### Implementing a lifecycle hook
Any class decorated with `@Injectable()` (the default `register: 'immediately'`) is instantiated during `app.init()` and automatically checked against every lifecycle interface. There is nothing else to register.

```ts
// src/services/analytics.service.ts
import { defineProvider, HttpServerLimits, Injectable, Ms, OnAppInit, OnAppShutdown, ShutdownSignal, ZIBRI_DI_TOKENS, ZibriApplication } from 'zibri';

import { AnalyticsClient } from './analytics-client';

@Injectable()
export class AnalyticsService implements OnAppInit, OnAppShutdown {
    private client: AnalyticsClient | undefined;

    async onAppInit(app: ZibriApplication): Promise<void> {
        this.client = await AnalyticsClient.connect(app.options.name);
    }

    async onAppShutdown(_app: ZibriApplication, _signal: ShutdownSignal | undefined): Promise<void> {
        await this.client?.flush();
        await this.client?.disconnect();
    }
}
```

A class with `register: 'onUse'` is only instantiated once something injects it. If nothing does, its hooks never run, so use the default `'immediately'` registration for anything that must run on every boot.

### Choosing which hook to implement
The init hooks fire in this order during `app.init()`: `beforeAppInit` → `onAppInit` → `afterAppInit`, each waiting for the previous phase to fully finish before the next one starts. Within a single phase the implementers run in an unspecified order, so a service that reads what another one produces has to implement a later hook than it.
<br>
The start hooks fire during `app.start(port)`, with the port binding between them: `onAppStart` → *listening* → `afterAppStart`.
<br>
The shutdown hooks fire in the mirrored order during `app.shutdown()`: `beforeAppShutdown` → `onAppShutdown` → `afterAppShutdown`.

- **`BeforeAppInit`**: for services that other services rely on being available during initialization, eg. the data source service.
- **`OnAppInit`**: the default choice for most providers.
- **`AfterAppInit`**: for services that create new work which might rely on other services already being operational, eg. the cron or websocket service.
- **`OnAppStart`**: for the last of the preparation, while the socket is still closed.
- **`AfterAppStart`**: for work that should only begin once this instance can be reached, eg. the cron service putting jobs on the schedule.
- **`BeforeAppShutdown`**: for services that create new work which might rely on other services still being operational, eg. the cron or websocket service.
- **`OnAppShutdown`**: the default choice for most providers.
- **`AfterAppShutdown`**: for services that should stay available the longest, eg. the data source service.

**Preparing and working are different things**, which is what the two start hooks are for. An instance that has connected is not yet an instance anyone has decided to keep: a readiness probe has not passed, an operator has not routed to it, and a deploy that is about to be rolled back looks exactly the same from the inside. Work that changes shared state — running a scheduled job, picking up a queue — belongs in `afterAppStart`, so that an instance which never becomes ready is also one that never did it.

```ts
// src/event/event.service.ts (simplified)
import { AfterAppShutdown, Injectable, OnAppInit, OnAppStart, ZibriApplication } from 'zibri';

@Injectable({ register: 'onUse' })
export class EventService implements OnAppInit, OnAppStart, AfterAppShutdown {
    onAppInit(app: ZibriApplication): void {
        // register additional cron jobs, entities etc.
    }

    async onAppStart(): Promise<void> {
        // resume any unfinished work now that the app is listening
    }

    afterAppShutdown(): void {
        // unsubscribe internal listeners after everything else has shut down
    }
}
```

### When the port cannot be bound
`app.start(port)` resolves once the port is actually bound, so a bind failure — an address already in use, a privileged port, an interface that went away — rejects the promise it returned and can be handled like any other error:

```ts
export async function startOn(app: ZibriApplication): Promise<void> {
    try {
        await app.start(8080);
    }
    catch (error) {
        // the port is taken: pick another one, or exit with a code your orchestrator understands
    }
}
```

`afterAppStart` and the *"is running on port"* log line are both on the far side of that wait, so an instance reports itself as running only once it is reachable.

Once the port is bound the server keeps an error handler of its own. An error it raises later — a connection it cannot accept because the process ran out of file descriptors, say — is logged at `error` level, and the instance carries on serving the connections it already has.

### How long a request may take
Four timeouts bound one request. Three of them bound the client sending it, because a connection nobody closes costs a file descriptor whether or not a request ever finishes arriving on it. The fourth bounds your own code. Two more limits bound its headers:

```ts
defineProvider({
    token: ZIBRI_DI_TOKENS.HTTP_SERVER_LIMITS,
    useFactory: (): HttpServerLimits => ({
        requestInMs: Ms.SECOND * 60,
        headersInMs: Ms.SECOND * 15,
        keepAliveInMs: Ms.SECOND * 5,
        handlerInMs: Ms.SECOND * 30,
        maxHeaderCount: 100,
        maxHeaderSizeInBytes: 16 * 1024
    })
})
```

`requestInMs` is how long a request may take to arrive in full and `headersInMs` how long its headers alone may — shorter, because a body can legitimately be large and slow while a set of headers cannot. The headers timeout has to be at most the request timeout, and the application refuses to start when it is not: the narrower of the two would never be the one that fires.

`keepAliveInMs` is how long an idle connection is kept. **Raise it above the idle timeout of whatever sits in front of the application.** A proxy that reuses a connection the server closed in the same moment has nothing to answer with, and reports a gateway error that no log on this side explains.

`handlerInMs` is how long a route handler has to produce a result, for every route that does not say otherwise. It runs from the handler being called to it returning, so it is independent of the three above: they are all satisfied the moment the request has arrived. Set it to `'none'` to leave handlers unbounded unless a route asks for a deadline itself. A route declares its own with `timeoutInMs` — see [creating endpoints](./creating-endpoints.md#deadlines).

`maxHeaderCount` is how many headers a request may carry and `maxHeaderSizeInBytes` how many bytes they may take up together. A request over either is answered `431` before any middleware or route sees it. Both are whole numbers of at least one, and the application refuses to start otherwise.

### Handling shutdown timeouts and errors
`BeforeAppShutdown`, `OnAppShutdown` and `AfterAppShutdown` accept an optional `shutdownTimeoutInMs` (default 30 seconds). All implementers within the same shutdown phase run in parallel; if one throws or times out, the error is logged and the remaining implementers in that phase are unaffected.

```ts
// src/services/queue.service.ts
import { Injectable, OnAppShutdown, ShutdownSignal, ZibriApplication } from 'zibri';

@Injectable()
export class QueueService implements OnAppShutdown {
    readonly shutdownTimeoutInMs: number = 5000;

    async onAppShutdown(_app: ZibriApplication, signal: ShutdownSignal | undefined): Promise<void> {
        await this.drainQueue();
    }

    private async drainQueue(): Promise<void> {
        // ...whatever finishing the work in flight means for your queue
    }
}
```

### What happens before the first shutdown hook
A shutdown does not begin with `beforeAppShutdown`. Two things happen first, and both can delay every hook that follows:

1. **The signal handlers are removed**, so a second SIGTERM is not swallowed by a shutdown already in progress.
2. **The http server stops accepting and waits for the requests still running.** Node's `close` waits for every open connection with no upper bound of its own, so this wait is capped by `ZIBRI_DI_TOKENS.HTTP_DRAIN_TIMEOUT_IN_MS` (ten seconds by default). Anything still open when that runs out is ended, and the shutdown carries on.

That cap matters more than it looks. Everything else — your hooks, handing back leases, closing data sources — queues behind it, so an unbounded wait here would mean a single long poll or stuck upstream stops the rest of the shutdown from happening at all. In a container the orchestrator's grace period then ends the process anyway, and the graceful path quietly becomes the same thing as a crash.

Set it low enough that the whole shutdown fits inside whatever grace period you are given:

```ts
defineProvider({
    token: ZIBRI_DI_TOKENS.HTTP_DRAIN_TIMEOUT_IN_MS,
    useFactory: () => Ms.SECOND * 5
})
```

> Zibri exposes no readiness endpoint, on purpose — it knows nothing you do not. `server.listen()` runs only after initialization finishes, so an instance never takes a request while still starting up, and `GlobalRegistry.isAppShuttingDown()` tells you the rest. Add the endpoint in your own controller, and give your deployment a `preStop` delay so a load balancer has time to notice before the drain begins. See [replication.md](./replication.md#draining-traffic-before-shutting-down).

### Adding middleware, and where it runs
`app.use(handler)` adds a middleware to the request pipeline. Every registration is collected and the pipeline is assembled once, when `start()` runs, so where a middleware ends up is the phase it names and then the order the calls were made in — the lifecycle hook it was registered from makes no difference.

```ts
import { MiddlewarePhase, ZibriApplication } from 'zibri';

function addMiddleware(app: ZibriApplication): void {
    // runs before a route is matched, which is the default
    app.use((req, res, next) => {
        next();
    });

    // and this one runs earlier, whichever of the two was registered first
    app.use(
        (req, res, next) => {
            next();
        },
        MiddlewarePhase.SECURITY
    );

    // limited to one route and everything below it
    app.use('/admin', (req, res, next) => {
        next();
    });
}
```

The phases, in the order they run:

| Phase | What is already there | What Zibri puts here |
|---|---|---|
| `SECURITY` | the raw request | cors, the trace context, response compression, the security headers |
| `PARSING` | a response that a browser will read | cookies, signed and unsigned |
| `OBSERVABILITY` | cookies | the access log, the request metrics |
| `BEFORE_ROUTING` | a request that is being timed | — |
| `ROUTING` | everything above | static assets, then the controllers |
| `AFTER_ROUTING` | a request nothing answered | the 404 |

`BEFORE_ROUTING` is the default and is where your own middleware goes unless it says otherwise: the request has been made readable and nothing has answered it yet, so it is the first place you can read what the caller sent and refuse the request outright.

Two things follow from the pipeline being assembled at `start()`. A middleware added afterwards is refused rather than accepted and ignored, so `use()` throws once the application is running. And the error handler is not part of this at all — an application has exactly one, and it is `ZIBRI_DI_TOKENS.GLOBAL_ERROR_HANDLER`. See [error-handling.md](./error-handling.md).

### Reading and sharing global app data
`GlobalRegistry` is a static class that tracks the app's current `AppState` and a small set of app-wide data (`state`, `baseUrl`, `name`, `version`). It's already populated by the time any `BeforeAppInit`/`OnAppInit`/`AfterAppInit` hook runs, so it's a convenient place to read the app's name or version without injecting the whole `ZibriApplication`:

```ts
import { GlobalRegistry } from 'zibri';

const appName: string = GlobalRegistry.getAppData('name') ?? '';
const appVersion: string = GlobalRegistry.getAppData('version') ?? '-';
```

`AppState` reflects where the app currently is in its lifecycle: `OFFLINE` → `CREATED` → `INITIALIZED` → `STARTED`, and `SHUTTING_DOWN` once shutdown begins. `GlobalRegistry` also exposes `isAppStarted()`, `isAppInitialized()`, `isAppCreated()`, `isAppOffline()` and `isAppShuttingDown()` to check the current state without comparing the enum value directly.

## See also
- [Replication](./replication.md) — what a shutdown has to hand back when other instances are running
- [Leases](./leases.md) — the `OnAppShutdown` implementer that drains work still holding a grant
- [Caching](./caching.md) — reads the app name from `GlobalRegistry` when rendering a cached page
- [Metrics](./metrics.md) — reads the app version from `GlobalRegistry` for the metrics dashboard
- [Templating](./templating.md) — reads the app name from `GlobalRegistry` when rendering a page
