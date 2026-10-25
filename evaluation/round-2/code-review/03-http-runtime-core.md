# HTTP runtime core — code review

Extracted from the evaluation chapter [03-http-runtime-core.md](../03-http-runtime-core.md); `H` ids
refer to its findings. These are shape, duplication and style, with the evaluation's severity scale.
Cross-cutting: [09-architecture-and-code-quality.md](./09-architecture-and-code-quality.md).

### Q1. Three copies of the shutdown phase runner, two copies of the shutdown — MINOR
`application.ts:786-853` holds `beforeAppShutdown`, `onAppShutdown` and `afterAppShutdown` as the same 20 lines three times (filter, `Promise.all`, timeout, catch, `shutdownFailed`, log), differing in the predicate, the method and the error class; `runLifecyclePhase` (`:762-784`) already abstracts the start side. `shutdown()` (`:507-562`) repeats its `CREATED` and `INITIALIZED | STARTED` branches line for line except for `shutdownHttpServer`. One parameterized phase runner and one branch with a conditional drain.

### Q2. The version-overlap refusal is built four times — MINOR
`router.ts:516-540`, `:709-734`, `:743-765` and `websocket.service.ts:852-873` construct the same two error messages from `findOverlappingVersions`; the websocket copy throws a plain `Error` where the router throws `InitRouterError`. One `validateNoOverlap(key, versions, kind)` on the versioning service.

### Q3. A hundred and fifty lines of browser JavaScript as string arrays — MINOR
`open-api.service.ts:305-458` ships `custom.js` and `swagger-ui-init.js` as `[...].join('\n')` literals inside a TypeScript service, unlintable and untestable, next to an asset folder that already carries `swagger-ui-bundle.js`. The static half belongs in `assets/public/open-api`; the dynamic half (the version list, the app name) is a dozen lines.

### Q4. The four largest runtime files — MINOR
`websocket.service.ts` (1596 lines), `open-api.service.ts` (1349), `router.ts` (1234) and `application.ts` (1091) each hold several concerns: the router holds route registration, dispatch, content negotiation, result writing, csp and stream failure; the websocket service holds the handshake, replay, rooms, cross-instance answers, login expiry and message dispatch. A `ResponseWriter` and a `ReplayService` would be the first two to split out.

### Q5. File names and suffixes outside the style table — MINOR
`routing/param-metdata.helpers.ts` is misspelt, and `.helpers.ts` (there and `http/mime-type.helpers.ts`) is not a suffix `CODE_STYLE.md` lists - both hold loose exported functions where the guide asks for a utility class. `resolve-route-params.function.ts` exports one function and an unexported second (`parseRouteParams`), which is the "second one appears next to it" case.

### Q6. Two deadline mechanisms — MINOR
`RequestDeadlineUtilities.resolveWithinDeadline` (`http/request-deadline.utilities.ts:32-77`) and `OperationLimitUtilities.openLimit` (`context/operation-limit.utilities.ts:56-80`) each build a timer and an `AbortController`; the second already composes with the request's signal through `AbortSignal.any`. The handler deadline is an operation limit whose error is a `GatewayTimeoutError`, and the newer utility could carry it.

### Q7. The manual-route path reimplements the controller path — MINOR
`createManualRouteInnerHandler` (`router.ts:619-661`) parses and validates path, query, header and body in the order `parseRouteParams` does (`resolve-route-params.function.ts:35-99`), by hand. 02 §M13 moved the auth check onto the shared path; the parameter half stayed duplicated, and a parse rule fixed on one side (H4, H5) has to be fixed on the other.

### Q8. The error classification is written three times — MINOR
`error-handler.ts:184-212` decides "not an Error → critical with `GlobalError`; 5xx → error; 4xx → nothing", and `websocket.service.ts:598-611` and `:1501-1543` decide it again in two places with a `persist` flag beside it. One `ErrorUtilities.reportToLog(error, logger)` is the shape 02 §M6 found was missing when the second copy went unfixed for a round.

### Q9. `Parser.parseBody` ends in five identical arms — MINOR
`parser.ts:185-203` switches over the media type with five cases that each call `parseBodyWith(this.findBodyParser(...))`; the comment says the cases exist to narrow the metadata type. A `findBodyParser` typed over the union would remove the switch.
