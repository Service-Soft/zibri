# HTTP runtime core — code review

Extracted from the evaluation chapter [03-http-runtime-core.md](../03-http-runtime-core.md); `H` ids
refer to its findings. These are shape, duplication and style, with the evaluation's severity scale.
Cross-cutting: [09-architecture-and-code-quality.md](./09-architecture-and-code-quality.md).

### Q1. Three copies of the shutdown phase runner, two copies of the shutdown — MINOR
`application.ts:786-853` holds `beforeAppShutdown`, `onAppShutdown` and `afterAppShutdown` as the same 20 lines three times (filter, `Promise.all`, timeout, catch, `shutdownFailed`, log), differing in the predicate, the method and the error class; `runLifecyclePhase` (`:762-784`) already abstracts the start side. `shutdown()` (`:507-562`) repeats its `CREATED` and `INITIALIZED | STARTED` branches line for line except for `shutdownHttpServer`. One parameterized phase runner and one branch with a conditional drain.

> **Closed 2026-10-29.** `runShutdownPhase(injectables, declares, run, toError)` is the one runner
> (filter, `Promise.all`, timeout, catch, `shutdownFailed`, log), called three times by
> `runShutdownPhases`, which also holds the log flush between the phases and the process release.
> `shutdown()` has one branch for `CREATED`, `INITIALIZED` and `STARTED`, draining the http server
> only when the application listened. `application.shutdown.test.ts` and
> `application.websocket-shutdown.test.ts` stay green.

### Q2. The version-overlap refusal is built four times — MINOR
`router.ts:516-540`, `:709-734`, `:743-765` and `websocket.service.ts:852-873` construct the same two error messages from `findOverlappingVersions`; the websocket copy throws a plain `Error` where the router throws `InitRouterError`. One `validateNoOverlap(key, versions, kind)` on the versioning service.

> **Closed 2026-10-29.** `VersioningServiceInterface.validateNoOverlap(subject, declared, versions,
> currentLatest, definedOn)` throws the new public `VersionOverlapError` (`versioning.md` has its
> row) with the messages as they were, and the four sites call it: the router's route, base route and
> controller route checks, and the websocket's event check, which threw a plain `Error` before. The
> router's `InitRouterError` prefix is gone from these four messages; the tests of both read the
> message's tail and stayed green through the change (`router-overlapping-routes.test.ts`,
> `versioning-websocket.test.ts`).

### Q3. A hundred and fifty lines of browser JavaScript as string arrays — MINOR
`open-api.service.ts:305-458` ships `custom.js` and `swagger-ui-init.js` as `[...].join('\n')` literals inside a TypeScript service, unlintable and untestable, next to an asset folder that already carries `swagger-ui-bundle.js`. The static half belongs in `assets/public/open-api`; the dynamic half (the version list, the app name) is a dozen lines.

> **Closed 2026-10-29 (user's decision: the application's assets).** Both scripts are static files
> in `assets/public/open-api/` of the CLI's scaffold and the sandbox, beside `custom.css`, served under
> the explorer's route like the swagger-ui files (one loop for the five). The page hands them the
> name, the logo and the documents as JSON in `<script id="zibri-explorer-config"
> type="application/json">`, with `<` escaped, from `resolveExplorerConfiguration`. A defect on the
> way: the name of the application was written into `custom.js` as it was, so a quote in it made the
> script fail to parse, and the page title took it unescaped. The title goes through the new
> `HtmlUtilities.escape`, which is `FederatedRouteUtilities`' private escape moved where both use it.
> Tests, red first: the new describe in `open-api.service.test.ts` (an application named
> `Ada's "Tasks" </script><b>`, served the sandbox's assets: both scripts parse, the page's
> configuration carries the name as it is, the markup does not). `versioning.service.test.ts` reads
> the dates of a deprecated version from the page now (container-backed, yours to run).
> `open-api.md` has "Changing the look of the explorer"; `upgrading-to-3.md` says to add the two
> files, which `zi upgrade` writes. The assets stay outside lint, as `custom.css` and the bundle are.

### Q4. The four largest runtime files — MINOR
`websocket.service.ts` (1596 lines), `open-api.service.ts` (1349), `router.ts` (1234) and `application.ts` (1091) each hold several concerns: the router holds route registration, dispatch, content negotiation, result writing, csp and stream failure; the websocket service holds the handshake, replay, rooms, cross-instance answers, login expiry and message dispatch. A `ResponseWriter` and a `ReplayService` would be the first two to split out.

> **Closed 2026-10-29 (user's decision on which splits).** Three of the four, each as a utility
> class, since none of them holds state:
> - `ResponseWriterUtilities` (`routing/response-writer.utilities.ts`): the result writing, its status
>   and format, the csp, the file and html results and the stream failure. The logger is taken while
>   the request runs, for a stream that fails after it. `router.ts` 1247 → 855 lines.
> - `WebsocketReplayUtilities` (`websocket/websocket-replay.utilities.ts`): the message sequence, the
>   replay after an offset and the "replay incomplete" answer, sent through the
>   `WebsocketServiceInterface` it is handed. `websocket.service.ts` 1605 → 1484. The cross-instance
>   answers stay: they share the server, the local connections and the pending answers with the
>   service.
> - `OpenApiSchemaUtilities` (`open-api/open-api-schema.utilities.ts`): the responses, the request body,
>   the parameters and every schema and xml annotation behind them, with `resolveResponses`,
>   `resolveRequestBody` and `resolveParameters` as the entry points. The service keeps the routes,
>   the explorer, the paths and their security. `open-api.service.ts` 1388 → 422 (the explorer's scripts left with §Q3).
>
> `application.ts` (1229) stays as it is; its shutdown copies went with §Q1. No behavior changed:
> `router.test.ts`, `router.file-response.test.ts`, `router.streaming.test.ts`, `router.csp.test.ts`,
> `open-api.service.test.ts` and the in-memory websocket suites stay green; `router-xml-response.test.ts`
> and `websocket.service.test.ts` are container-backed, yours to run.

### Q5. File names and suffixes outside the style table — MINOR
`routing/param-metdata.helpers.ts` is misspelt, and `.helpers.ts` (there and `http/mime-type.helpers.ts`) is not a suffix `CODE_STYLE.md` lists - both hold loose exported functions where the guide asks for a utility class. `resolve-route-params.function.ts` exports one function and an unexported second (`parseRouteParams`), which is the "second one appears next to it" case.

> **Closed 2026-10-29.** Each became a utility class with the steps as `private static`:
> `ParamMetadataUtilities` (`routing/param-metadata.utilities.ts`, `createPathParam`,
> `createQueryParam`, `createHeaderParam`), `RouteParamUtilities` (`routing/route-param.utilities.ts`,
> `resolveValues`, whose pass-through wrapper in the websocket service is gone) and the public
> `MimeTypeUtilities` (`http/mime-type.utilities.ts`, `resolveFromPath`, `resolveFileExtension`,
> `isKnown`, `isJson`, `isXml`, `isCompressible`; `creating-endpoints.md` has one row for it), with
> `FileExtension` and `mimeTypeToExtensions` in `http/file-extension.model.ts`. The third `.helpers.ts`,
> `logging/logger.helpers.ts`, which this item did not name, is `ConsoleUtilities` with `warn` and
> `printLog`, and `logToConsole` is its loop. Tests, red first: `mime-type.utilities.test.ts` (with
> the json, xml and compressible cases the helpers had none of) and `console.utilities.test.ts`;
> `parser.array-params.test.ts`, `validation.service.test.ts` and `router-overlapping-routes.test.ts`
> stay green. `payment-service.types.ts` stays with 06 §Q6.

### Q6. Two deadline mechanisms — MINOR
`RequestDeadlineUtilities.resolveWithinDeadline` (`http/request-deadline.utilities.ts:32-77`) and `OperationLimitUtilities.openLimit` (`context/operation-limit.utilities.ts:56-80`) each build a timer and an `AbortController`; the second already composes with the request's signal through `AbortSignal.any`. The handler deadline is an operation limit whose error is a `GatewayTimeoutError`, and the newer utility could carry it.

> **Closed 2026-10-29 as a decision (user's).** The two share a timer and differ in what it does:
> the deadline races the handler and answers the caller with the 504 when it passes, whatever the
> handler waits for; a limit fires a signal only, leaving the work running until a store refuses what
> it asks next, and caps every statement, which costs postgres a `SET statement_timeout` on each
> connection a request takes. Carrying the deadline as a limit would put that round trip on every
> request. Each keeps its timer, with an inline comment on why it is not the other.

### Q7. The manual-route path reimplements the controller path — MINOR
`createManualRouteInnerHandler` (`router.ts:619-661`) parses and validates path, query, header and body in the order `parseRouteParams` does (`resolve-route-params.function.ts:35-99`), by hand. 02 §M13 moved the auth check onto the shared path; the parameter half stayed duplicated, and a parse rule fixed on one side (H4, H5) has to be fixed on the other.

> **Closed 2026-10-29.** `createManualRouteInnerHandler` turns the route's declarations into a
> `RouteParamMetadata` once, when the route is registered (the body at position 0, where
> `resolveBodyMetadata` put it, the parameters after it), and each request calls
> `RouteParamUtilities.resolveValues`, which parses them onto the request and validates them as for a
> controller route. The router no longer injects the parser and the validation service.
> `one-of-bodies-and-params.test.ts` and `router.test.ts` stay green;
> `http-and-observability.evaluation.test.ts` covers manual routes too (container-backed, yours to
> run).

### Q8. The error classification is written three times — MINOR
`error-handler.ts:184-212` decides "not an Error → critical with `GlobalError`; 5xx → error; 4xx → nothing", and `websocket.service.ts:598-611` and `:1501-1543` decide it again in two places with a `persist` flag beside it. One `ErrorUtilities.reportToLog(error, logger)` is the shape 02 §M6 found was missing when the second copy went unfixed for a round.

> **Closed 2026-10-29.** `ErrorUtilities.reportToLog(error, logger)` logs a non-error as a critical
> `GlobalError`, a server error as it is, and a client error not at all, answering whether it was a
> defect. The http handler keeps its rate-limit audit and calls it; the websocket's two sites use its
> answer as `persist`, so the two decisions that were written beside each other are one. Tests, in
> `error.utilities.test.ts` (container-backed, yours to run): the three outcomes;
> `error-handler.test.ts` stays green.

### Q9. `Parser.parseBody` ends in five identical arms — MINOR
`parser.ts:185-203` switches over the media type with five cases that each call `parseBodyWith(this.findBodyParser(...))`; the comment says the cases exist to narrow the metadata type. A `findBodyParser` typed over the union would remove the switch.

> **Closed 2026-10-29.** The switch is one call: `findBodyParser` already took the generic media
> type, so `parseBody` resolves the parser's type (`MimeType.JSON` for every json media type, through
> `isJsonMimeType`) and hands `parseBodyWith` the metadata as it is. The dispatch tests
> (`parser.test.ts`, container-backed) are yours to run.
