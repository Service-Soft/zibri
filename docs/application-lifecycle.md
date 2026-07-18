# Application lifecycle
Zibri exposes hooks that run at specific points while the app boots up and shuts down. Any `@Injectable` provider can implement one or more of these hooks to run setup or teardown logic, eg. connect to an external system on boot, warm a cache, or flush something on shutdown.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `BeforeAppInit` | interface | Runs before the app initializes, for services others rely on being available early |
| `OnAppInit` | interface | Runs when the app initializes |
| `AfterAppInit` | interface | Runs just after the app initializes, for services that create new work relying on others being operational |
| `OnAppStart` | interface | Runs when the app starts listening |
| `BeforeAppShutdown` | interface | Runs before the app shuts down, while most services are still operational |
| `OnAppShutdown` | interface | Runs when the app shuts down |
| `AfterAppShutdown` | interface | Runs just after the app shuts down, for services that need to stay available longest (eg. the data source) |
| `GlobalRegistry` | class | Static registry holding global app state and shared app data |
| `AppState` | enum | The possible states an app can be in |

## Usage
### Implementing a lifecycle hook
Any class decorated with `@Injectable()` (the default `register: 'immediately'`) is instantiated during `app.init()` and automatically checked against every lifecycle interface. There is nothing else to register.

```ts
// src/services/analytics.service.ts
import { Injectable, OnAppInit, OnAppShutdown, ShutdownSignal, ZibriApplication } from 'zibri';

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
The init hooks fire in this order during `app.init()`: `beforeAppInit` → `onAppInit` → `afterAppInit`, each waiting for the previous phase to fully finish before the next one starts.
<br>
The shutdown hooks fire in the mirrored order during `app.shutdown()`: `beforeAppShutdown` → `onAppShutdown` → `afterAppShutdown`.

- **`BeforeAppInit`**: for services that other services rely on being available during initialization, eg. the data source service.
- **`OnAppInit`**: the default choice for most providers.
- **`AfterAppInit`**: for services that create new work which might rely on other services already being operational, eg. the cron or websocket service.
- **`OnAppStart`**: runs once the app starts listening, after `app.start(port)` is called.
- **`BeforeAppShutdown`**: for services that create new work which might rely on other services still being operational, eg. the cron or websocket service.
- **`OnAppShutdown`**: the default choice for most providers.
- **`AfterAppShutdown`**: for services that should stay available the longest, eg. the data source service.

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
}
```

### Reading and sharing global app data
`GlobalRegistry` is a static class that tracks the app's current `AppState` and a small set of app-wide data (`state`, `baseUrl`, `name`, `version`). It's already populated by the time any `BeforeAppInit`/`OnAppInit`/`AfterAppInit` hook runs, so it's a convenient place to read the app's name or version without injecting the whole `ZibriApplication`:

```ts
import { GlobalRegistry } from 'zibri';

const appName: string = GlobalRegistry.getAppData('name') ?? '';
const appVersion: string = GlobalRegistry.getAppData('version') ?? '-';
```

`AppState` reflects where the app currently is in its lifecycle: `OFFLINE` → `CREATED` → `INITIALIZED` → `STARTED`, and `SHUTTING_DOWN` once shutdown begins. `GlobalRegistry` also exposes `isAppStarted()`, `isAppInitialized()`, `isAppCreated()`, `isAppOffline()` and `isAppShuttingDown()` to check the current state without comparing the enum value directly.

## See also
- [Caching](./caching.md) — reads the app name from `GlobalRegistry` when rendering a cached page
- [Metrics](./metrics.md) — reads the app version from `GlobalRegistry` for the metrics dashboard
- [Templating](./templating.md) — reads the app name from `GlobalRegistry` when rendering a page
