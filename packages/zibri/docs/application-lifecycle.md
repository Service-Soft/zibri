# Application lifecycle
Zibri exposes hooks that run at specific points while the app boots up and shuts down. Any `@Injectable` provider can implement one or more of these hooks to run setup or teardown logic, such as to connect to an external system on boot, warm a cache, or flush something on shutdown.

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
| `AfterAppShutdown` | interface | Runs just after the app shuts down, for services that need to stay available longest (such as the data source) |
| `implementsBeforeAppInit`, `implementsOnAppInit`, `implementsAfterAppInit`, `implementsOnAppStart`, `implementsAfterAppStart`, `implementsBeforeAppShutdown`, `implementsOnAppShutdown`, `implementsAfterAppShutdown` | function, function, function, function, function, function, function, function | Check whether a value implements the lifecycle interface of the same name |
| `LifecyclePhase` | enum | The phases an app runs through on its way up, in order, each named after the hook that runs in it |
| `BeforeAppShutdownError`, `OnAppShutdownError`, `AfterAppShutdownError` | error, error, error | What a shutdown hook that threw something other than an error is logged as |
| `GlobalRegistry` | class | Static registry holding global app state and shared app data |
| `AppData` | type | What `GlobalRegistry` holds about the app: its `state`, `baseUrl`, `name` and `version` |
| `AppState` | enum | The possible states an app can be in |
| `MiddlewarePhase` | enum | Where a middleware sits in the request pipeline |
| `ShutdownSignal` | type | The signal that started a shutdown: `SIGTERM`, `SIGINT` or `SIGHUP` |
| `SHUTDOWN_SIGNALS` | constant | The signals the app shuts down on, as a list |
| `HttpServerLimits` | type | How long a request may take to arrive and to be handled, how many headers it may carry and how large its body may be, via `ZIBRI_DI_TOKENS.HTTP_SERVER_LIMITS` |
| `BodySizeLimits` | type | The most a body may weigh, for each kind of body |

## Implementing a lifecycle hook
Any class decorated with `@Injectable()` (the default `register: 'immediately'`) is instantiated during `app.init()` and automatically checked against every lifecycle interface. There is nothing else to register.

```ts
// src/services/analytics.service.ts
import { Injectable, OnAppInit, OnAppShutdown, ShutdownSignal, ZibriApplication } from 'zibri';

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

## Choosing which hook to implement
The init hooks fire in this order during `app.init()`: `beforeAppInit` → `onAppInit` → `afterAppInit`, each waiting for the previous phase to fully finish before the next one starts. Within a single phase the implementers run in an unspecified order, so a service that reads what another one produces has to implement a later hook than it.

The start hooks fire during `app.start(port)`, with the port binding between them: `onAppStart` → *listening* → `afterAppStart`.

The shutdown hooks fire in the mirrored order during `app.shutdown()`: `beforeAppShutdown` → `onAppShutdown` → `afterAppShutdown`.

- **`BeforeAppInit`**: for services that other services rely on being available during initialization, such as the data source service.
- **`OnAppInit`**: the default choice for most providers.
- **`AfterAppInit`**: for services that create new work which might rely on other services already being operational, such as the cron or websocket service.
- **`OnAppStart`**: for the last of the preparation, while the socket is still closed.
- **`AfterAppStart`**: for work that should only begin once this instance can be reached, such as the cron service putting jobs on the schedule.
- **`BeforeAppShutdown`**: for services that create new work which might rely on other services still being operational, such as the cron or websocket service.
- **`OnAppShutdown`**: the default choice for most providers.
- **`AfterAppShutdown`**: for services that should stay available the longest, such as the data source service.

`onAppStart` prepares, `afterAppStart` begins the work. Work that changes shared state, such as running a scheduled job or picking up a queue, goes in `afterAppStart`. It then runs only on an instance that can be reached, and never on one that failed to bind its port.

```ts
// src/services/task-reminder.service.ts
import { AfterAppShutdown, AfterAppStart, Injectable, OnAppInit, ZibriApplication } from 'zibri';

@Injectable()
export class TaskReminderService implements OnAppInit, AfterAppStart, AfterAppShutdown {
    onAppInit(app: ZibriApplication): void {
        // your setup, such as reading the reminder settings
    }

    async afterAppStart(): Promise<void> {
        // your work, such as sending the reminders that are due
    }

    afterAppShutdown(): void {
        // your cleanup, once everything else has shut down
    }
}
```

## Choosing the address to listen on
`app.start(port)` listens on every address of the machine. Name one as the second argument to be reachable only there, such as `127.0.0.1` behind a proxy on the same machine:

```ts
// src/index.ts
import { ZibriApplication } from 'zibri';

export async function startLocally(app: ZibriApplication): Promise<void> {
    await app.start(8080, '127.0.0.1');
}
```

## When the port cannot be bound
`app.start(port)` resolves once the port is bound. A bind failure, such as an address already in use, a privileged port or an interface that went away, rejects the promise it returned, and you handle it like any other error:

```ts
// src/index.ts
import { ZibriApplication } from 'zibri';

export async function startOn(app: ZibriApplication): Promise<void> {
    try {
        await app.start(8080);
    }
    catch (error) {
        // your handling
    }
}
```

In the `catch`, pick another port, or exit with a code your orchestrator understands.

`afterAppStart` and the *"is running on port"* log line are both on the far side of that wait, so an instance reports itself as running only once it is reachable.

Once the port is bound, the server keeps an error handler of its own. An error it raises later, such as a connection it cannot accept because the process ran out of file descriptors, is logged at `error` level, and the instance carries on serving the connections it already has.

## How long a request may take
Four timeouts bound one request. Three of them bound the client sending it, and the fourth bounds your own code. Two more limits bound its headers:

```ts
// src/providers.ts
import { defineProvider, HttpServerLimits, Ms, ZIBRI_DI_TOKENS } from 'zibri';

defineProvider({
    token: ZIBRI_DI_TOKENS.HTTP_SERVER_LIMITS,
    useFactory: (): HttpServerLimits => ({
        requestTimeoutInMs: Ms.SECOND * 60,
        headersTimeoutInMs: Ms.SECOND * 15,
        keepAliveTimeoutInMs: Ms.SECOND * 75,
        handlerTimeoutInMs: Ms.SECOND * 30,
        maxHeaderCount: 100,
        maxHeaderSizeInBytes: 16 * 1024,
        maxBodySizes: { json: '100kb', xml: '100kb', formUrlEncoded: '100kb', formData: '100kb', stream: '10mb' }
    })
})
```

`requestTimeoutInMs` is how long a request may take to arrive in full, and `headersTimeoutInMs` how long its headers alone may. Keep the headers timeout shorter: a body can be large and slow, a set of headers cannot. It has to be at most the request timeout.

`keepAliveTimeoutInMs` is how long a connection is kept open after a response, waiting for the next request on it. It is 75 seconds by default, nginx's idle timeout towards the applications behind it, and above the 60 seconds of an AWS load balancer.

> [!WARNING]
> Set `keepAliveTimeoutInMs` above the idle timeout of whatever sits in front of the application, such as above 600 seconds behind a Google Cloud load balancer. Otherwise a proxy can reuse a connection the server closed in the same moment, and reports a gateway error that no log of the application explains.

`handlerTimeoutInMs` is how long a route handler has to produce a result, for every route that does not say otherwise. It runs from the handler being called to it returning, so it is independent of the three above: they are all satisfied the moment the request has arrived. Set it to `'none'` to leave handlers unbounded unless a route asks for a deadline itself. A route declares its own with `timeoutInMs`, see [creating endpoints](./creating-endpoints.md#deadlines).

`maxHeaderCount` is how many headers a request may carry and `maxHeaderSizeInBytes` how many bytes they may take up together. A request over either is answered `431` before any middleware or route sees it. Both are whole numbers of at least one.

`maxBodySizes` is the most the body of a request may weigh, for each kind of body, on every route whose `@Body` names no size of its own. A larger one is answered `413`. The files of a multipart body are added to `formData`, see [limits on a multipart body](./creating-endpoints.md#limits-on-a-multipart-body).

## Handling shutdown timeouts and errors
`BeforeAppShutdown`, `OnAppShutdown` and `AfterAppShutdown` accept an optional `shutdownTimeoutInMs` (default 30 seconds). All implementers within the same shutdown phase run in parallel; if one throws or times out, the error is logged and the remaining implementers in that phase are unaffected.

What a hook logs is written before the process ends. The log is flushed after the `OnAppShutdown` phase, while the data sources are still open, and once more after the `AfterAppShutdown` phase, to the transports that need none. An uncaught exception outside a request is written the same way, and the process then ends with code 1.

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

## What happens before the first shutdown hook
A shutdown does not begin with `beforeAppShutdown`. First:

1. **The signal handlers are removed**, so a second SIGTERM is not swallowed by a shutdown already in progress.
2. **The HTTP server stops accepting and waits for the requests still running**, for up to `ZIBRI_DI_TOKENS.HTTP_DRAIN_TIMEOUT_IN_MS` (ten seconds by default). Anything still open after that is ended, and the shutdown carries on. A websocket is ended as the drain begins, and its client reconnects to an instance that is staying.

Your hooks, handing back [leases](./glossary.md#lease) and closing the data sources all wait for this drain. Set it low enough that the whole shutdown fits inside whatever grace period you are given:

```ts
// src/providers.ts
import { defineProvider, Ms, ZIBRI_DI_TOKENS } from 'zibri';

defineProvider({
    token: ZIBRI_DI_TOKENS.HTTP_DRAIN_TIMEOUT_IN_MS,
    useFactory: () => Ms.SECOND * 5
})
```

> [!NOTE]
> The framework has no readiness endpoint of its own. `zi new` generates one, see [health endpoints](./deployment.md#health-endpoints). `server.listen()` runs only after initialization finishes, so an instance never takes a request while still starting up, and `GlobalRegistry.isAppShuttingDown()` tells whether it is going away. Give your deployment a `preStop` delay, so a load balancer stops sending requests before the drain begins, see [draining traffic before shutting down](./deployment.md#draining-traffic-before-shutting-down).

## Adding middleware, and where it runs
`app.use(handler)` adds a middleware to the request pipeline. Every registration is collected and the pipeline is assembled once, when `start()` runs. A middleware ends up in the phase it names, then in the order the calls were made in. The lifecycle hook it was registered from makes no difference.

```ts
// src/index.ts
import { MiddlewarePhase, ZibriApplication } from 'zibri';

function addMiddleware(app: ZibriApplication): void {
    app.use((req, res, next) => {
        next();
    });

    app.use(
        (req, res, next) => {
            next();
        },
        MiddlewarePhase.SECURITY
    );

    app.use('/admin', (req, res, next) => {
        next();
    });
}
```

The first runs before a route is matched, which is the default. The second runs earlier, in `SECURITY`, whichever of the two was registered first. The third runs for `/admin` and every path below it.

The phases, in the order they run:

| Phase | What is already there | What Zibri puts here |
|---|---|---|
| `SECURITY` | the raw request | cors, the trace context, response compression, the security headers |
| `PARSING` | a response that a browser will read | cookies, signed and unsigned |
| `OBSERVABILITY` | cookies | the access log, the request metrics |
| `BEFORE_ROUTING` | a request that is being timed | nothing |
| `ROUTING` | everything above | static assets, then the controllers |
| `AFTER_ROUTING` | a request nothing answered | the 404 |

`BEFORE_ROUTING` is the default and is where your own middleware goes unless it says otherwise: the request has been made readable and nothing has answered it yet, so it is the first place you can read what the caller sent and refuse the request outright.

`use()` throws once the application is running, since the pipeline is already assembled. The error handler is not a middleware: an application has exactly one, `ZIBRI_DI_TOKENS.GLOBAL_ERROR_HANDLER`. See [error handling](./error-handling.md).

## Reading and sharing global app data
`GlobalRegistry` is a static class that tracks the app's current `AppState` and a small set of app-wide data (`state`, `baseUrl`, `name`, `version`, `environment`). It's already populated by the time any `BeforeAppInit`/`OnAppInit`/`AfterAppInit` hook runs, so it's a convenient place to read the app's name or version without injecting the whole `ZibriApplication`:

```ts
// src/index.ts
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
