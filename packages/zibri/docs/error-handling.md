# Error handling
Every error a request throws reaches one global error handler. It answers with JSON, with XML or with a rendered HTML error page, whichever the client accepts. The class of an error decides what the caller sees and what stays on the server.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `ExternalError` | class | Base for errors whose message is safe to show to the client |
| `InternalError` | class | Base for errors that must never leave the server |
| `GlobalError` | class | Wraps a thrown value that is not an `Error`, so the error handler can log it |
| `HttpError` | class | Base for `ExternalError`s that carry an HTTP status code |
| `CustomBodyHttpError` | class | An `HttpError` answered with a body of its own, see [answering with an error body of your own](#answering-with-an-error-body-of-your-own) |
| `JsonMimeType` | type | A mime type a `CustomBodyHttpError` writes its body in: `MimeType.JSON`, `MimeType.JSON_LD` or `MimeType.JSON_SCIM` |
| `NotFoundError` | error | 404, an existing route couldn't find the requested resource |
| `UnmatchedRouteError` | error | 404, the route itself doesn't exist (extends `NotFoundError`) |
| `BadRequestError` | error | 400, generic invalid client input |
| `ValidationError` | error | 400, thrown automatically by Zibri's validation (extends `BadRequestError`) |
| `ValidationErrorType` | type | The part of the request a `ValidationError` is about: `body`, `path`, `query`, `header` or `websocketRequest` |
| `UnauthorizedError` | error | 401, the caller didn't say who it is, or the credential it sent isn't good |
| `ForbiddenError` | error | 403, the caller is known and still isn't allowed to do this |
| `CredentialReusedError` | error | A 401 that reads as `UnauthorizedError` on the wire, but tells the [audit trail](./audit.md) a spent credential came back |
| `CsrfTokenRefusedError` | error | A 403 for a request that changes something with a valid cookie session and without its [CSRF token](./auth.md#sending-the-csrf-token), on a route that needs a login |
| `CredentialClonedError` | error | A 401 that reads as `UnauthorizedError` on the wire, but tells the audit trail a credential came from a copy of its device, such as a [passkey](./glossary.md#passkey) whose signature counter went backwards |
| `PasswordLockedError` | error | A 401 that reads as a wrong password on the wire, but tells the audit trail the right password came for an account locked after too many wrong ones |
| `AccountDeactivatedError` | error | 403, a [deactivated user](./auth.md#deactivating-a-user) tried to log in |
| `MethodNotAllowedError` | error | 405, the path exists under other methods; thrown by Zibri itself and answered with an `Allow` header |
| `NotAcceptableError` | error | 406, the caller accepts nothing the route produces; thrown by Zibri itself |
| `ConflictError` | error | 409, conflicting state on the server |
| `ContentTooLargeError` | error | 413, request body exceeds an allowed size |
| `UnsupportedMediaTypeError` | error | 415, request `Content-Type` isn't supported by the endpoint |
| `TooManyRequestsError` | error | 429, a rate limit was exceeded |
| `InternalServerError` | error | 500, generic unexpected server error |
| `ServiceUnavailableError` | error | 503, the application cannot take the request right now and the caller may try again |
| `GatewayTimeoutError` | error | 504, a handler ran longer than its route allows; thrown by Zibri itself |
| `MissingEntitiesError` | error | Internal, entities not registered on a data source |
| `MissingTokensError` | error | Internal, DI tokens that couldn't be injected |
| `InvalidDecoratorCombinationError` | error | Internal, conflicting decorators on the same target |
| `EntityMetadataMissingError` | error | Internal, a class used as an entity without `@Entity` |
| `GlobalErrorHandler` | type | Signature of the express-style handler that processes every error |
| `ErrorPageTemplate` | type | Signature of a tsx component used to render the HTML error page |
| `ErrorPageTemplateProps` | type | What the error page component receives: the `HttpError` as `error` |
| `ErrorUtilities` | class | Static helpers for classifying and converting errors |
| `ZIBRI_DI_TOKENS.GLOBAL_ERROR_HANDLER` | DI token | Injects/overrides the `GlobalErrorHandler` |
| `ZIBRI_DI_TOKENS.ERROR_PAGE_TEMPLATE` | DI token | Injects/overrides the `ErrorPageTemplate` |

## Choosing between an external and an internal error
Every error of the framework is either external or internal, as its readonly `isInternal` flag says.

`InternalError` is for anything that must not leave the server (such as misconfiguration, invariant violations). It takes a plain `string | string[]` message and an optional `ErrorOptions` (such as `{ cause }`):

```ts
// src/index.ts
import { InternalError } from 'zibri';

throw new InternalError('The application has already been started');
```

`ExternalError` is for anything that is safe to show to the client. Its messages are `TranslatedString`s, produced by `$t`/`$ts` (see [localization](./localization.md)). It also carries a `title` and `paragraphs` (the message split into lines) that a rendered error page can use. Its shape, as an illustration:

```ts
// src/errors/illustrated-external.error.ts
import { TranslatedString } from 'zibri';

abstract class IllustratedExternalError extends Error {
    abstract readonly isInternal: false;
    abstract title: TranslatedString;
    abstract paragraphs: TranslatedString[];
}
```

Throw one of the built-in `HttpError` subclasses below, or extend `HttpError` for a status of your own.

## Throwing a built-in HTTP error
`HttpError` extends `ExternalError` and additionally carries a `status: HttpStatus`. Each built-in subclass fixes its own status and title, and takes the message plus an optional `ErrorOptions`:

```ts
// src/services/refuse-missing.ts
import { $ts, NotFoundError } from 'zibri';

export function refuseMissing(entityName: string, id: string): never {
    throw new NotFoundError($ts`Could not find ${entityName} with id "${id}".`);
}
```

Every built-in error:

| Class | Status | Constructor |
|---|---|---|
| `BadRequestError` | 400 | `(message, options?)` |
| `UnauthorizedError` | 401 | `(message, options?)` |
| `ForbiddenError` | 403 | `(message, options?)` |
| `NotFoundError` | 404 | `(message, options?)` |
| `UnmatchedRouteError` | 404 | `(originalUrl, options?)`. Thrown by Zibri itself for unregistered routes |
| `MethodNotAllowedError` | 405 | `(method, allowedMethods, options?)`. Thrown by Zibri itself, see below |
| `NotAcceptableError` | 406 | `(accept, producibleMediaTypes, options?)`. Thrown by Zibri itself, see below |
| `ConflictError` | 409 | `(message, options?)` |
| `ContentTooLargeError` | 413 | `(message = $ts\`request too large\`, options?)` |
| `UnsupportedMediaTypeError` | 415 | `(mediaType, options?)` |
| `TooManyRequestsError` | 429 | `(message, rateLimitResult?, options?)`. See [rate limiting](./rate-limiting.md) |
| `InternalServerError` | 500 | `(message, options?)` |
| `ServiceUnavailableError` | 503 | `(message, options?)` |
| `GatewayTimeoutError` | 504 | `(message, options?)`. Thrown by Zibri itself, see [deadlines](./creating-endpoints.md#deadlines) |
| `ValidationError` | 400 | `(type, paramName, problems, options?)`. Thrown for you, see below |

`message` is always `TranslatedString | TranslatedString[]`.

### Choosing between 401 and 403
Throw `UnauthorizedError` when the request did not establish who the caller is: no credential, an expired one, a wrong password. Throw `ForbiddenError` when it did, and the caller still may not do this: a missing role, an entity belonging to somebody else. A client answered `401` refreshes its credential and retries, so a permission failure answered with `401` keeps it in a loop. See [auth](./auth.md) for which check produces which.

### The two Zibri raises for you: 405 and 406
A request for a path that exists under other methods is answered `405`, with an `Allow` header naming the methods that exist. An `OPTIONS` for that path is answered `204`, with the same header.

A request whose `Accept` header excludes everything a route can produce is answered `406`, before the handler runs. A route produces what it declares with `@Response`, error responses left out. A route that declares nothing answers every `Accept`, and so does one whose only declarations Zibri added itself.

## Declaring thrown errors in the OpenAPI docs
Use `@Response.error()` on a controller method so the error shows up in the generated OpenAPI docs (see [creating endpoints](./creating-endpoints.md)). Here `findById` throws a `NotFoundError` when the user does not exist:

```ts
// src/controllers/user.controller.ts
import { Controller, Get, HttpStatus, Response } from 'zibri';

import { User, userRepository } from '../repositories';

@Controller('/users')
export class UserController {
    @Response.error(HttpStatus.NOT_FOUND)
    @Get('/:id')
    async findById(): Promise<User> {
        return await userRepository.findById('42');
    }
}
```

## Validation errors
`ValidationError` extends `BadRequestError`. It is thrown for you whenever a request body, path parameter, query parameter, header parameter or websocket request fails validation. Its message is built from the failing `type` (`'body' | 'path' | 'query' | 'header' | 'websocketRequest'`), the parameter name (if any), and the list of `ValidationProblem`s, all resolved through the current request's locale. Its `problems` are in the body of the answer, see [reading a refused request](./validation.md#reading-a-refused-request).

## Extending `HttpError` for a custom status code
For a status none of the built-in errors has, extend `HttpError`:

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

## Answering with an error body of your own
To answer with an error body of your own, such as one a protocol prescribes, extend `CustomBodyHttpError`. The response holds its `body`, written as JSON in the first of its `mimeTypes` the request accepts:

```ts
// src/errors/problem.error.ts
import { $ts, CustomBodyHttpError, HttpStatus, JsonMimeType, MimeType } from 'zibri';

export class ProblemError extends CustomBodyHttpError {
    readonly body: unknown;
    readonly mimeTypes: JsonMimeType[] = [MimeType.JSON];

    constructor(detail: string) {
        super($ts`${detail}`, HttpStatus.CONFLICT, $ts`Conflict`, undefined);
        this.name = 'ProblemError';
        this.body = { type: 'https://example.com/problems/taken', title: 'Taken', status: 409, detail };
    }
}
```

`headers` holds the headers the response carries besides the body, such as `WWW-Authenticate`.

`ScimError` is one, answering the way [SCIM](./scim.md#errors) says, and `OAuth2Error` another, answering the way [OAuth2](./authorization-server.md#errors) says.

## How the global error handler processes an error
Every error thrown while a request is handled reaches the `GlobalErrorHandler` registered under `ZIBRI_DI_TOKENS.GLOBAL_ERROR_HANDLER`. A request for a route that does not exist reaches it as an `UnmatchedRouteError`. The default handler:
1. Converts the error to an `HttpError` with `ErrorUtilities.toHttpError`. An `HttpError` stays as it is, anything else becomes a generic `InternalServerError`.
2. Logs it. A thrown value that is not an `Error` is wrapped in a `GlobalError` and logged with `logger.critical`. An error answered with a `5xx` status is logged with `logger.error`. An error answered with a `4xx` status is not logged, and a `TooManyRequestsError` is recorded in the [audit trail](./audit.md).
3. Sets the rate limit headers (`X-RateLimit-*`, `Retry-After`) for a `TooManyRequestsError`, and the `Allow` header for a `MethodNotAllowedError`.
4. Answers a `CustomBodyHttpError` with its own body, and every other error in the format the request's `Accept` asks for: JSON clients get `{ status, name, message, paragraphs, traceId }`, with `problems` for a `ValidationError` and a `CheckConstraintViolationError`; XML clients get the same as an `Error` document, with one `paragraph` element per paragraph; HTML clients get the rendered `ErrorPageTemplate`, falling back to the same JSON (with a warning logged) if no template is configured. A client naming none of them, or accepting anything, gets JSON. Between formats a client weighs equally, the one it names first is taken.

## Errors outside the request pipeline
The global error handler only sees errors that come back through a request. A promise nothing awaits, like `void this.auditService.record(order)`, rejects outside of it, even when a request started it. Such a rejection is logged as an `InternalError` and the application keeps serving. An exception nothing catches is logged and then ends the process with a non-zero exit code.

Await a promise, or give it a `.catch`, when you want to handle its failure yourself.

## Rendering an error page
By default `ZIBRI_DI_TOKENS.ERROR_PAGE_TEMPLATE` is `undefined`, so HTML-accepting clients get the JSON fallback described above. To render an error page, provide a tsx component (see [templating](./templating.md)) that accepts an `error: HttpError` prop:

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

## Replacing the global error handler
To answer errors your own way, override `ZIBRI_DI_TOKENS.GLOBAL_ERROR_HANDLER` with your own `GlobalErrorHandler`, which has the same signature as an express error middleware:

```ts
// src/error-handler.ts
import { GlobalErrorHandler } from 'zibri';

export const appErrorHandler: GlobalErrorHandler = async (error, req, res, next) => {
    // ...your custom logic
};
```

```ts
// src/providers.ts - one more entry in the same array
import { defineProvider, ZIBRI_DI_TOKENS } from 'zibri';

import { appErrorHandler } from './error-handler';

defineProvider({
    token: ZIBRI_DI_TOKENS.GLOBAL_ERROR_HANDLER,
    useFactory: () => appErrorHandler
});
```

`ErrorPageTemplate` is used by the default handler only, so your handler renders its own pages.

## Classifying and converting errors
Static helpers for classifying and converting errors:

| Method | Purpose |
|---|---|
| `toHttpError(value)` | Returns `value` if it's already an `HttpError`, otherwise a generic `InternalServerError` |
| `isHttpError(value)` | `value instanceof HttpError` |
| `isRefusal(value)` | Whether `value` is an `HttpError` with a status below 500 |
| `isExternalError(value)` | `value instanceof ExternalError` |
| `isError(value)` | `value instanceof Error` |
| `unknownToErrorString(value)` | `value.message` if it's an `Error`, otherwise a JSON-stringified fallback |

## Configuration
| Token | Type | Default |
|---|---|---|
| `ZIBRI_DI_TOKENS.GLOBAL_ERROR_HANDLER` | `GlobalErrorHandler` | the built-in handler described above |
| `ZIBRI_DI_TOKENS.ERROR_PAGE_TEMPLATE` | `ErrorPageTemplate \| undefined` | `undefined` (HTML clients get JSON, and the application warns once when it starts) |

Both are overridden the same way as any other injectable, see [dependency injection](./di.md#configuration).

## See also
- [Validating requests](./validation.md) — the problems a `ValidationError` is answered with
- [Dependency injection](./di.md) — how to override `GLOBAL_ERROR_HANDLER` and `ERROR_PAGE_TEMPLATE`
- [Templating](./templating.md) — writing the tsx component used as `ErrorPageTemplate`
- [Localization](./localization.md) — `$t`/`$ts` and how error messages get translated
- [Rate limiting](./rate-limiting.md) — `TooManyRequestsError` and its `rateLimitResult`
- [Creating endpoints](./creating-endpoints.md) — `@Response.error()` for documenting thrown errors in the OpenAPI schema
