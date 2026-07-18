# Error handling
Zibri routes every thrown error through a single global error handler, which turns it into either a JSON response or a rendered HTML error page, depending on what the client accepts. A small hierarchy of error classes controls what gets shown to the end user and what stays server-side only.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `ExternalError` | abstract class | Base for errors whose message is safe to show to the client |
| `InternalError` | class | Base for errors that must never leave the server |
| `GlobalError` | class | Wraps whatever was thrown, used internally by the error handler for logging |
| `HttpError` | abstract class | Base for `ExternalError`s that carry an HTTP status code |
| `NotFoundError` | error | 404, an existing route couldn't find the requested resource |
| `UnmatchedRouteError` | error | 404, the route itself doesn't exist (extends `NotFoundError`) |
| `BadRequestError` | error | 400, generic invalid client input |
| `ValidationError` | error | 400, thrown automatically by Zibri's validation (extends `BadRequestError`) |
| `UnauthorizedError` | error | 401, the caller isn't allowed to do this |
| `ConflictError` | error | 409, conflicting state on the server |
| `ContentTooLargeError` | error | 413, request body exceeds an allowed size |
| `UnsupportedMediaTypeError` | error | 415, request `Content-Type` isn't supported by the endpoint |
| `TooManyRequestsError` | error | 429, a rate limit was exceeded |
| `InternalServerError` | error | 500, generic unexpected server error |
| `MissingEntitiesError` | error | Internal, entities not registered on a data source |
| `MissingTokensError` | error | Internal, DI tokens that couldn't be injected |
| `InvalidDecoratorCombinationError` | error | Internal, conflicting decorators on the same target |
| `GlobalErrorHandler` | type | Signature of the express-style handler that processes every error |
| `ErrorPageTemplate` | type | Signature of a preact component used to render the HTML error page |
| `ErrorUtilities` | class | Static helpers for classifying and converting errors |
| `ZIBRI_DI_TOKENS.GLOBAL_ERROR_HANDLER` | DI token | Injects/overrides the `GlobalErrorHandler` |
| `ZIBRI_DI_TOKENS.ERROR_PAGE_TEMPLATE` | DI token | Injects/overrides the `ErrorPageTemplate` |

## Usage
### `ExternalError` vs `InternalError`
Every error in Zibri is either external or internal, distinguished by a readonly `isInternal` flag.
<br>
`InternalError` is for anything that must not leave the server (eg. misconfiguration, invariant violations). It takes a plain `string | string[]` message and an optional `ErrorOptions` (eg. `{ cause }`):

```ts
import { InternalError } from 'zibri';

throw new InternalError('The application has already been started');
```

`ExternalError` is for anything that is safe to show to the client. Its messages must be `TranslatedString`s (produced by `$t`/`$ts`, see [localization](./localization.md)) rather than plain strings, and it additionally carries a `title` and `paragraphs` (the message split into lines) that a rendered error page can use:

```ts
// abstract, always extended - shown here for illustration only
abstract class ExternalError extends Error {
    readonly isInternal: false;
    title: TranslatedString;
    paragraphs: TranslatedString[];
}
```

You normally don't extend either of these directly. Instead, throw one of the built-in `HttpError` subclasses below, or extend `HttpError` yourself for a custom status code.

### Throwing a built-in HTTP error
`HttpError` extends `ExternalError` and additionally carries a `status: HttpStatus`. Each built-in subclass fixes its own status and title, and takes the message plus an optional `ErrorOptions`:

```ts
// src/data-source/repository.ts
import { $ts, NotFoundError } from 'zibri';

throw new NotFoundError($ts`Could not find ${this.entityClass.name} with id "${id}".`);
```

The full catalogue:

| Class | Status | Constructor |
|---|---|---|
| `BadRequestError` | 400 | `(message, options?)` |
| `UnauthorizedError` | 401 | `(message, options?)` |
| `NotFoundError` | 404 | `(message, options?)` |
| `UnmatchedRouteError` | 404 | `(originalUrl, options?)` — thrown by Zibri itself for unregistered routes |
| `ConflictError` | 409 | `(message, options?)` |
| `ContentTooLargeError` | 413 | `(message = $ts\`request too large\`, options?)` |
| `UnsupportedMediaTypeError` | 415 | `(mediaType, options?)` |
| `TooManyRequestsError` | 429 | `(message, rateLimitResult?, options?)` — see [rate limiting](./rate-limiting.md) |
| `InternalServerError` | 500 | `(message, options?)` |
| `ValidationError` | 400 | `(type, paramName, problems, options?)` — thrown automatically, see below |

`message` is always `TranslatedString | TranslatedString[]`.

### Declaring thrown errors in the OpenAPI docs
Use `@Response.error()` on a controller method so the error shows up in the generated OpenAPI docs (see [creating endpoints](./creating-endpoints.md)):

```ts
import { Controller, Get, HttpStatus, Response } from 'zibri';

@Controller('/users')
export class UserController {
    @Response.error(HttpStatus.NOT_FOUND)
    @Get('/:id')
    async findById(): Promise<User> {
        // throws NotFoundError if the user doesn't exist
    }
}
```

### Validation errors
`ValidationError` extends `BadRequestError` and is thrown automatically by Zibri's validation layer whenever a request body, path parameter, query parameter, header parameter or websocket request fails validation (`src/validation/validation.service.ts`). You don't construct it yourself in normal usage. Its message is built from the failing `type` (`'body' | 'path' | 'query' | 'header' | 'websocketRequest'`), the parameter name (if any), and the list of `ValidationProblem`s, all resolved through the current request's locale.

### Extending `HttpError` for a custom status code
If none of the built-in errors fit, extend `HttpError` directly:

```ts
// src/errors/payment-required.error.ts
import { $ts, HttpError, HttpStatus, TranslatedString } from 'zibri';

export class PaymentRequiredError extends HttpError {
    constructor(message: TranslatedString | TranslatedString[], options?: ErrorOptions) {
        super(message, HttpStatus.PAYMENT_REQUIRED, $ts`Payment Required`, options);
        this.name = 'PaymentRequiredError';
    }
}
```

### How the global error handler processes an error
Every error thrown anywhere in the request pipeline eventually reaches the `GlobalErrorHandler` registered under `ZIBRI_DI_TOKENS.GLOBAL_ERROR_HANDLER` (the default implementation lives in `src/error-handling/error-handler.ts` and is installed as the last express middleware in `Application.start`, right after a catch-all that turns unmatched routes into `UnmatchedRouteError`). It:
1. Wraps the caught value in a `GlobalError` and logs it — via `logger.critical` if the value isn't even an `Error`, via `logger.error` if it's an internal error, and not at all if it's an external error (external errors are expected, user-facing outcomes, not bugs).
2. Converts the error to an `HttpError` via `ErrorUtilities.toHttpError` — anything that already is one passes through, anything else becomes a generic `InternalServerError`.
3. Attaches rate-limit headers (`X-RateLimit-*`, `Retry-After`) if the error is a `TooManyRequestsError` with a `rateLimitResult`.
4. Negotiates the response format via `Accept`: JSON clients get `{ status, name, message, paragraphs }`; HTML clients get the rendered `ErrorPageTemplate`, falling back to the same JSON (with a warning logged) if no template is configured.

### Custom error page
By default `ZIBRI_DI_TOKENS.ERROR_PAGE_TEMPLATE` is `undefined`, so HTML-accepting clients get the JSON fallback described above. To render an actual error page, provide a preact component (see [templating](./templating.md)) that accepts an `error: HttpError` prop:

```tsx
// src/templates/pages/error.tsx
import { ErrorPageTemplate } from 'zibri';

export const ErrorPage: ErrorPageTemplate = ({ error }) => {
    return <div>
        <h1>{error.status}: {error.title}</h1>
        {error.paragraphs.map(p => <p>{p}</p>)}
    </div>;
};
```

```ts
// src/providers.ts
import { defineProvider, DiProvider, ZIBRI_DI_TOKENS } from 'zibri';

import { ErrorPage } from './templates/pages/error';

export const providers: DiProvider<unknown>[] = [
    defineProvider({
        token: ZIBRI_DI_TOKENS.ERROR_PAGE_TEMPLATE,
        useFactory: () => ErrorPage
    })
    // ...
];
```

### Replacing the global error handler
If negotiating JSON/HTML isn't what you want at all, override `ZIBRI_DI_TOKENS.GLOBAL_ERROR_HANDLER` with your own `GlobalErrorHandler`, which has the same signature as an express error middleware:

```ts
// src/my-error-handler.ts
import { GlobalErrorHandler } from 'zibri';

export const myErrorHandler: GlobalErrorHandler = async (error, req, res, next) => {
    // ...your custom logic
};
```

```ts
// src/providers.ts
import { defineProvider, DiProvider, ZIBRI_DI_TOKENS } from 'zibri';

import { myErrorHandler } from './my-error-handler';

export const providers: DiProvider<unknown>[] = [
    defineProvider({
        token: ZIBRI_DI_TOKENS.GLOBAL_ERROR_HANDLER,
        useFactory: () => myErrorHandler
    })
    // ...
];
```

Doing this bypasses `ErrorPageTemplate` entirely, since that's only consulted by the default handler.

### `ErrorUtilities`
Static helpers used internally by the error handler, also useful in your own code:

| Method | Purpose |
|---|---|
| `toHttpError(value)` | Returns `value` if it's already an `HttpError`, otherwise wraps it in a generic `InternalServerError` |
| `isHttpError(value)` | `value instanceof HttpError` |
| `isExternalError(value)` | `value instanceof ExternalError` |
| `isError(value)` | `value instanceof Error` |
| `unknownToErrorString(value)` | `value.message` if it's an `Error`, otherwise a JSON-stringified fallback |

## Configuration
| Token | Type | Default |
|---|---|---|
| `ZIBRI_DI_TOKENS.GLOBAL_ERROR_HANDLER` | `GlobalErrorHandler` | the built-in handler described above |
| `ZIBRI_DI_TOKENS.ERROR_PAGE_TEMPLATE` | `ErrorPageTemplate \| undefined` | `undefined` (HTML clients get JSON with a logged warning) |

Both are overridden the same way as any other injectable, see [dependency injection](./di.md#overriding-existing-injectables).

## See also
- [Dependency injection](./di.md) — how to override `GLOBAL_ERROR_HANDLER` and `ERROR_PAGE_TEMPLATE`
- [Templating](./templating.md) — writing the preact component used as `ErrorPageTemplate`
- [Localization](./localization.md) — `$t`/`$ts` and how error messages get translated
- [Rate limiting](./rate-limiting.md) — `TooManyRequestsError` and its `rateLimitResult`
- [Creating endpoints](./creating-endpoints.md) — `@Response.error()` for documenting thrown errors in the OpenAPI schema
