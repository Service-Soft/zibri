# Architecture
A Zibri application is one `ZibriApplication`, built from the options that say what it is made of, and one container holding everything it uses. This page shows how the pieces fit together, and each section links to the page that covers its piece in full.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `ZibriApplication` | class | The application: built from its options, then initialized, started and shut down |
| `ZibriApplicationOptions` | type | What the application is made of |
| `ZibriPlugin` | class | A set of controllers, providers, cron jobs, body parsers and auth strategies added to an application as one |
| `ZIBRI_DI_TOKENS` | object | The tokens every service of the framework is provided under |
| `MiddlewarePhase` | enum | Where a middleware sits in the request pipeline |
| `HttpRequestContext` | class | Everything known about the request being handled |

## Usage
### The application
The options name what the application is made of: its controllers and websocket controllers, its data sources, its cron jobs, its body parsers, auth strategies and two-factor methods, its backup transports, its plugins and its own providers.

```ts
// src/index.ts
import { ZibriApplication } from 'zibri';

import { ReportController } from './controllers';
import { DbDataSource } from './data-sources';
import { providers } from './providers';

async function start(): Promise<void> {
    const app: ZibriApplication = new ZibriApplication({
        name: 'reports',
        baseUrl: 'http://localhost:3000',
        version: '1.0.0',
        defaultAuth: 'public',
        controllers: [ReportController],
        websocketControllers: [],
        dataSources: [DbDataSource],
        providers
    });
    await app.init();
    await app.start(3000);
}
```

A plugin adds its controllers, providers, cron jobs, body parsers and auth strategies to the ones the application names. See [plugins](./plugin.md).

### The container
Everything the application uses is a provider in one container: your services, the repository of every entity, and every service of the framework, such as the logger, the router, the parser, the validation service, the auth service, the error handler and the email service.

Each service of the framework is provided under a token in `ZIBRI_DI_TOKENS`. Naming one of those tokens in your `providers` array replaces that service everywhere it is used, including inside the framework. A class becomes a provider when it is decorated with `@Injectable`, and any other value when it is listed in `providers`.

A provider lives for the application, for one request, or for one injection. See [dependency injection](./di.md).

### Starting up and shutting down
`new ZibriApplication(options)` sets up the security part of the request pipeline. `app.init()` builds the container's values and runs the init hooks. `app.start(port)` runs the start hooks and binds the port, with the pipeline assembled in between. A class takes part in a phase by implementing its hook.

| Step | What the framework does there |
|---|---|
| `beforeAppInit` | connects every data source and brings its schema up to date |
| `onAppInit` | registers every route of every controller, and each service prepares itself |
| `afterAppInit` | services that create work, such as the cron and websocket services, set themselves up |
| `onAppStart` | the router adds the routes to the request pipeline, and the pipeline is assembled |
| *listening* | the port is bound |
| `afterAppStart` | work that changes shared state begins, such as scheduled cron jobs |

`app.shutdown()`, or a `SIGTERM`, `SIGINT` or `SIGHUP`, stops accepting requests, waits for the ones still running, and then runs `beforeAppShutdown`, `onAppShutdown` and `afterAppShutdown`. The data sources close in `afterAppShutdown`, so every other hook can still use them. See [application lifecycle](./application-lifecycle.md).

### A request, from arriving to answered
An http request passes through the pipeline phases in order. Your own middleware runs in `BEFORE_ROUTING` unless it names another phase.

1. **`SECURITY`**: cors, the trace context, response compression and the security headers.
2. **`PARSING`**: cookies.
3. **`OBSERVABILITY`**: the access log and the request metrics.
4. **`BEFORE_ROUTING`**: your middleware.
5. **`ROUTING`**: static assets, then the controllers. A request matching a route gets its `HttpRequestContext`, and then:
    1. the version it asks for picks the controller method that handles it,
    2. the auth service checks the route's access rules,
    3. the `Accept` header is checked against what the route answers with,
    4. the body and the path, query and header parameters the method declares are parsed and validated,
    5. the method runs, within the route's deadline,
    6. what it returned is checked against the responses the route declares, serialized and sent.
6. **`AFTER_ROUTING`**: a request nothing answered becomes a 404.

An error thrown at any of these steps goes to the one global error handler, which logs it when it is not an expected outcome and answers the caller in the format it accepts. See [error handling](./error-handling.md).

From the moment the context exists until the response is sent, any service the request reaches can `inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT)` and read the current user, locale, version or trace from it, without them being passed along as arguments. See [request context](./request-context.md).

A websocket message takes the same path from its own entry: it is validated, gets a `WebsocketRequestContext`, the route's access rules are checked, its parameters are parsed and validated, and the handler runs within its deadline. See [websockets](./websocket.md).

### One declaration, read everywhere
A model is declared once, with `@Property` on each field, and that one declaration is what:

- the validation service checks a body or a parameter against,
- the OpenAPI document describes,
- a data source stores, along with the encryption, hashing and defaults it declares,
- the http client checks a response against.

A route is declared once as well. Its decorators are what the router mounts, what the auth service checks, and what the OpenAPI document describes. See [models](./models.md) and [creating endpoints](./creating-endpoints.md).

### Reading and writing data
A data source declares its entities, and each entity gets a `Repository` in the container. A repository call applies the entity's scope, runs the hooks that set defaults, encrypt, hash, decrypt and leave out excluded properties, and hands the rest to the data source. Every data source answers the same calls with the same results, so code using a repository works the same on any of them.

A transaction is passed along as an option. A repository used inside a request also stops when the request's deadline passes. See [data sources](./data-source.md), and [costs](./costs.md) for what each call costs.

### Work outside a request
Cron jobs, event subscribers, the email queue and thread jobs run outside any request. There is no request context there: `CURRENT_REQUEST_CONTEXT` is `undefined`, and a request scoped provider cannot be built.

Each of them takes a lease before it runs, so a job runs on one instance at a time when several instances share a data source. See [cron](./cron.md), [events](./events.md), [email](./email.md), [multithreading](./multithreading.md) and [replication](./replication.md).

## See also
- [Getting started](./getting-started.md) — creating a project that is already wired this way
- [Deployment](./deployment.md) — running the application in a container behind a proxy
- [Testing](./testing.md) — booting the whole application in a test