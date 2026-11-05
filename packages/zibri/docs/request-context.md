# Request context
The request context holds what belongs to the request being handled: the incoming request and response, the matched controller, and values computed once per request, such as the current user or locale. Any service, deep in a call chain, can `inject()` the active context without it being passed down as an argument.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `AlsUtilities` | class | Runs code inside a context, and reads the active ones |
| `OperationLimit` | type | How long the work running here may take: the `timeoutInMs` of one statement, and the `signal` that fires when the work or its request runs out of time. Read with `AlsUtilities.findCurrentOperationLimit` |
| `LeaseScopeResult` | type | What `AlsUtilities.runInLeaseScope` returns: the result of the function, and the transactions written to while it ran |
| `BaseContext` | class | Base class all contexts extend, holding the per-request token value cache |
| `HttpRequestContext` | class | Context for an incoming HTTP request |
| `WebsocketRequestContext` | class | Context for an incoming websocket request |
| `HttpRequest` | type | An incoming HTTP request, the `request` of an `HttpRequestContext` |
| `isHttpRequest` | function | Whether a value is an `HttpRequest` |
| `HttpResponse` | type | The response to an HTTP request, the Express response with a `setHeader` that takes a `KnownHeader` and its value |
| `WebsocketRequest` | class | An incoming websocket request, the `request` of a `WebsocketRequestContext` |
| `CacheContext` | class | Context describing a cache operation currently in flight |
| `RequestContextToken` | class | Defines a value computed once per request, on first access, under a unique key |
| `ZIBRI_REQUEST_CONTEXT_TOKENS` | constant | The built-in request context tokens (current user, locale, version, ...) |
| `ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT` | DI token | Injects the currently active `HttpRequestContext \| WebsocketRequestContext`, or `undefined` |
| `ZIBRI_DI_TOKENS.CURRENT_CACHE_CONTEXT` | DI token | Injects the stack of currently active `CacheContext[]`, or `undefined` |

## Reading request-scoped data from a service
Inject `ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT` wherever you need it, such as in a cache key function, a validator or a logger transport. It is `undefined` outside a request (such as in a cron job or during startup), so guard it with `?.`.

```ts
// src/caching/cache-keys.ts
import { HttpRequestContext, inject, WebsocketRequestContext, ZIBRI_DI_TOKENS, ZIBRI_REQUEST_CONTEXT_TOKENS } from 'zibri';

function currentLocalePrefix(): string {
    const ctx: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
    return ctx?.get(ZIBRI_REQUEST_CONTEXT_TOKENS.CURRENT_LOCALE) + 'index';
}
```

`HttpRequestContext` and `WebsocketRequestContext` share the same shape:
- `request`: the raw `HttpRequest` (HTTP) or `WebsocketRequest` (websocket).
- `controllerClass` / `controllerMethod`: the matched route. Both are set before any check or handler runs, so a service called by a handler sees them. A middleware that runs before routing sees `undefined`.
- `.get(token)` / `.has(token)`: read a `RequestContextToken`'s value.
- `signal`: an `AbortSignal` that fires when the handler runs out of the time its route or event allows, see [deadlines](./creating-endpoints.md#deadlines) and [websocket deadlines](./websocket.md#deadlines). Pass it on to whatever a handler is waiting for. `AlsUtilities.findCurrentRequestSignal()` is the same signal, reached without the context. The HTTP client, the [lease](./glossary.md#lease) service and waiting for a thread job listen to it.

`HttpRequestContext` additionally carries `response: HttpResponse`. `WebsocketRequestContext` additionally carries `connection: BaseWebsocketConnection | undefined`. Both expose a `type` discriminant (`'http-request'` or `'websocket-request'`) so you can narrow which one you got:

```ts
// src/logging/logger.ts
import { HttpRequestContext, inject, WebsocketRequestContext, ZIBRI_DI_TOKENS } from 'zibri';

const ctx: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
if (ctx?.type === 'http-request') {
    const method: string = ctx.request.method;
}
```

## Reading the built-in tokens
Pass one of `ZIBRI_REQUEST_CONTEXT_TOKENS` to `.get()`/`.has()`. Each token's value is computed on first access and kept for the rest of the request. Calling `.get()` again returns the same value without computing it again.

| Token | Returns | Notes |
|---|---|---|
| `NONCE` | `string` | Random per-request base64 nonce, used for CSP |
| `TRACE_CONTEXT` | `TraceSpanContext` or `undefined` | The trace this request belongs to, read from its `traceparent`. See [tracing](./tracing.md) |
| `CURRENT_USER` | resolved user or `undefined` | Runs the route's configured [auth strategies](./glossary.md#auth-strategy), and throws when the route requires a user it cannot resolve |
| `IS_LOGGED_IN` | `boolean` | Runs the route's configured auth strategies |
| `HAS_2FA` | `boolean` | Whether this request presented a valid [second factor](./glossary.md#second-factor) for the current user; `false` when there is no current user |
| `CURRENT_VERSION` | `Version` | Resolved via `VERSIONING_SERVICE` |
| `CURRENT_LOCALE` | `LocaleCode` | Resolved via `LOCALIZE_SERVICE` |

## Defining your own token
Create a `RequestContextToken` with a unique key and a resolver function. The resolver receives the context and can itself `inject()` services or call `ctx.get()` on other tokens:

```ts
// src/request-context-tokens.ts
import { HttpRequestContext, RequestContextToken, WebsocketRequestContext } from 'zibri';

export const TENANT_ID: RequestContextToken<string | undefined> = new RequestContextToken(
    'tenant_id',
    (ctx: HttpRequestContext | WebsocketRequestContext) => ctx.request.headers?.['x-tenant-id']
);
```

Keys are unique across the application.

## Reading cache context
While a `Cache` decorator (see [caching](./caching.md)) is executing, `ZIBRI_DI_TOKENS.CURRENT_CACHE_CONTEXT` resolves to the stack of `CacheContext[]` currently in flight (nested caches push onto the same stack). Each `CacheContext` carries `cache` (name), `operation`, `key`, `hit`, and `durationInMs`. The built-in logger attaches it to log lines, and your own code reads it the same way:

```ts
// src/logging/logger.ts
import { CacheContext, inject, ZIBRI_DI_TOKENS } from 'zibri';

export function currentCacheContext(): CacheContext[] | undefined {
    return inject(ZIBRI_DI_TOKENS.CURRENT_CACHE_CONTEXT);
}
```

## Configuration
There is nothing to configure. The contexts are created for you:
- `HttpRequestContext` is entered with `AlsUtilities.runWithHttpRequestContext()` at the start of routing, before version matching or any controller code runs.
- `WebsocketRequestContext` is entered with `AlsUtilities.runWithWebsocketRequestContext()` at the start of handling an incoming websocket message.
- `CacheContext` is pushed with `AlsUtilities.runWithCacheContext()` around each cache operation.

The contexts have no `.set()`. To add state to a request, define a `RequestContextToken`. Its value is computed once per request and reused for the rest of it.

## See also
- [Caching](./caching.md) — using `ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT` inside a cache key function, and how `CacheContext` is produced
- [Logging](./logging.md) — how the logger attaches request and cache context to log lines
