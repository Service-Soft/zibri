# Request context
Zibri tracks per-request data (the incoming request/response, the matched controller, and lazily-computed values like the current user or locale) using `AsyncLocalStorage`. Any service, deep in a call chain, can `inject()` the currently active context without it being threaded through as a function argument.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `AlsUtilities` | class | Static wrapper around the `AsyncLocalStorage` instances that hold the active contexts |
| `BaseContext` | class | Base class all contexts extend, holding the per-request token value cache |
| `HttpRequestContext` | class | Context for an incoming HTTP request |
| `WebsocketRequestContext` | class | Context for an incoming websocket request |
| `CacheContext` | class | Context describing a cache operation currently in flight |
| `RequestContextToken` | class | Defines a lazily-computed, per-request value with a unique key |
| `ZIBRI_REQUEST_CONTEXT_TOKENS` | const | The built-in request context tokens (current user, locale, version, ...) |
| `ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT` | DI token | Injects the currently active `HttpRequestContext \| WebsocketRequestContext`, or `undefined` |
| `ZIBRI_DI_TOKENS.CURRENT_CACHE_CONTEXT` | DI token | Injects the stack of currently active `CacheContext[]`, or `undefined` |

## Usage
### Reading request-scoped data from a service
Inject `ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT` wherever you need it — a cache key function, a validator, a logger transport. It resolves to `undefined` when called outside of a request (eg. from a cron job or during app startup), so always guard with `?.`.

```ts
import { HttpRequestContext, inject, WebsocketRequestContext, ZIBRI_DI_TOKENS, ZIBRI_REQUEST_CONTEXT_TOKENS } from 'zibri';

function currentLocalePrefix(): string {
    const ctx: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
    return ctx?.get(ZIBRI_REQUEST_CONTEXT_TOKENS.CURRENT_LOCALE) + 'index';
}
```

`HttpRequestContext` and `WebsocketRequestContext` share the same shape:
- `request` — the raw `HttpRequest` (HTTP) or `WebsocketRequest` (websocket).
- `controllerClass` / `controllerMethod` — the matched route, or `undefined` if routing hasn't resolved yet.
- `.get(token)` / `.has(token)` — read a `RequestContextToken`'s value.

`HttpRequestContext` additionally carries `response: HttpResponse`. `WebsocketRequestContext` additionally carries `connection: BaseWebsocketConnection | undefined`. Both expose a `type` discriminant (`'http-request'` or `'websocket-request'`) so you can narrow which one you got:

```ts
import { HttpRequestContext, inject, WebsocketRequestContext, ZIBRI_DI_TOKENS } from 'zibri';

const ctx: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
if (ctx?.type === 'http-request') {
    const method: string = ctx.request.method;
}
```

### Built-in request context tokens
Pass one of `ZIBRI_REQUEST_CONTEXT_TOKENS` to `.get()`/`.has()`. Each token's value is computed on first access and then cached on the context for the rest of the request — calling `.get()` again returns the same value without recomputing it.

| Token | Returns | Notes |
|---|---|---|
| `NONCE` | `string` | Random per-request base64 nonce, used for CSP |
| `CORRELATION_ID` | `string` | Read from the correlation-id header, or generated if missing |
| `CURRENT_USER` | resolved user or `undefined` | Runs the route's configured auth strategies |
| `IS_LOGGED_IN` | `boolean` | Runs the route's configured auth strategies |
| `HAS_2FA` | `boolean` | `false` if there's no matched route or no current user |
| `CURRENT_VERSION` | `Version` | Resolved via `VERSIONING_SERVICE` |
| `CURRENT_LOCALE` | `LocaleCode` | Resolved via `LOCALIZE_SERVICE` |

### Defining your own token
Create a `RequestContextToken` with a unique key and a resolver function. The resolver receives the context and can itself `inject()` services or call `ctx.get()` on other tokens:

```ts
import { HttpRequestContext, RequestContextToken, WebsocketRequestContext } from 'zibri';

export const TENANT_ID: RequestContextToken<string | undefined> = new RequestContextToken(
    'tenant_id',
    (ctx: HttpRequestContext | WebsocketRequestContext) => ctx.request.headers?.['x-tenant-id']
);
```

Registering two tokens with the same key throws an `InternalError` — keys must be globally unique.

### Reading cache context
While a `Cache` decorator (see [caching](./caching.md)) is executing, `ZIBRI_DI_TOKENS.CURRENT_CACHE_CONTEXT` resolves to the stack of `CacheContext[]` currently in flight (nested caches push onto the same stack). Each `CacheContext` carries `cache` (name), `operation`, `key`, `hit`, and `durationInMs`. This is how the built-in logger attaches cache info to log lines:

```ts
// src/logging/logger.ts
const cacheContext: CacheContext[] | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_CACHE_CONTEXT);
```

## Configuration
There's nothing to configure — both context types are populated automatically by the framework:
- `HttpRequestContext` is created and entered via `AlsUtilities.runWithHttpRequestContext()` at the start of routing, before version matching or any controller code runs (`src/routing/router.ts`).
- `WebsocketRequestContext` is created and entered via `AlsUtilities.runWithWebsocketRequestContext()` at the start of handling an incoming websocket message (`src/websocket/services/websocket.service.ts`).
- `CacheContext` is pushed via `AlsUtilities.runWithCacheContext()` around each cache operation.

There's no `.set()` on the contexts themselves — request-scoped state is added by defining a new `RequestContextToken`, not by mutating the context. The token's per-request value cache (backed by `BaseContext`'s internal map) is what gives you "compute once, reuse for the rest of the request" behavior for free.

## See also
- [Caching](./caching.md) — using `ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT` inside a cache key function, and how `CacheContext` is produced
- [Logging](./logging.md) — how the logger attaches request and cache context to log lines
