# HTTP runtime core — round 2

Read in full: `packages/zibri/src/application/application.ts` and `application-options.model.ts`, `routing/router.ts`, `resolve-route-params.function.ts`, `resolve-body-metadata.function.ts`, `route-configuration.model.ts`, `route-param-metadata.model.ts`, the `Body`, `Param`, `Controller` and `Response` decorators, `CrudController`, `parsing/parser.ts` and the five shipped body parsers, `body-parser.utilities.ts`, the `parse-*` functions, `validation/validation.service.ts`, `shape-problems.function.ts`, `validate-string.function.ts`, `validation-problem.model.ts`, `error-handling/error-handler.ts`, `error.utilities.ts` and the error classes the handler branches on, `http/` (cors, cookie, cross-origin-cookie, trace-context, compression, request-deadline, http-server-limits, json-response, redirect-response, http-request model), `context/base-context.ts`, `http-request.context.ts`, `request-context-token.model.ts`, `operation-limit.utilities.ts`, `versioning/versioning.service.ts`, `open-api/open-api.service.ts`, `response.decorator.ts`, `websocket/services/websocket.service.ts`, `data-source.websocket-adapter.ts`, `json.socket-io-encoder.ts`, the websocket connection, options and request models, `assets/asset.service.ts`, `parsing/html/html-response.model.ts` and `csp-options.model.ts`, `tsx/tsx.utilities.ts`, `document/pdf.utilities.ts`, the entry of `xml-reader.utilities.ts`, `logging/logger.ts` (for what the exception handler does), `plugin/plugin.model.ts`, the default providers for every http token, and the docs pages creating-endpoints, error-handling, application-lifecycle, deployment, excluding-properties, plus targeted reads of websocket.md and app-settings.md. One Node probe was run in the scratchpad (not in the repository) to confirm a claim about `closeAllConnections()`. Not reached: `context/cache`, `als.utilities.ts`, the xml writer and `XmlUtilities` beyond the parser entry, the `zibri-tsx` runtime, `http-client`, `sem-ver.utilities.ts`, the metrics middleware, and the docs pages assets, document, xml, templating, versioning, request-context in full. Working-tree note: `router.ts`, `open-api.service.ts`, `websocket.service.ts`, `websocket-options.model.ts`, `resolve-route-params.function.ts` and `request-context-token.model.ts` are modified in the working tree; line numbers below are against that state.

## CRITICAL

### H1. A multipart file part named after an `Object.prototype` member ends the process — CRITICAL
*Filed 2026-10-21.*

`packages/zibri/src/parsing/form-data/form-data.body-parser.ts:316` declares `const filesMap: Record<string, File[]> = {};` as an object literal, and the `'finish'` listener of each file's write stream fills it with `filesMap[fieldname] = filesMap[fieldname] ?? []; filesMap[fieldname].push(meta);` (`:433-434`). For a part sent as `name="constructor"; filename="x.txt"`, `filesMap['constructor']` is `Object`, which is not nullish, so `Object.push(meta)` throws `TypeError: ... push is not a function`. `__proto__`, `toString`, `hasOwnProperty` and `valueOf` do the same. The text fields beside it are guarded (`Object.prototype.hasOwnProperty.call(fields, name)`, `:369-371`); the file map is not.

The throw happens inside a stream `'finish'` listener, which Node runs from a libuv callback: nothing in the parser's `Promise` executor is on the stack, so it is an uncaught exception. `packages/zibri/src/application/application.ts:1086-1091` logs it and rethrows on purpose ("after an uncaught exception the process may hold half-updated state"), so one request ends the instance. The body is parsed after `checkAccess` (`packages/zibri/src/routing/router.ts:882-892`), so the sender needs to reach any route taking a multipart body: a public upload endpoint, or any authenticated user.

Not deliberate: the url-encoded parser builds its object through `Object.fromEntries` precisely for this (`packages/zibri/src/parsing/form-url-encoded/form-url-encoded.body-parser.ts:113-118`), the cookie parser uses a `Map` for the same reason (`packages/zibri/src/http/cookie.middleware.ts:34-36`), and `form-url-encoded.body-parser.test.ts:146-150` holds `__proto__` and `constructor` fields at 400. The multipart suite has no such case, and 03 filed the url-encoded and cookie halves without this one. Fix: `filesMap` (and `fields`, where a `__proto__` field is currently dropped silently rather than reported as an unknown key) become `Map`s or `Object.create(null)`, the way the two sibling parsers already do it.

**Verify:** `startTestServer` on the in-memory data source, a route with `@Body(Dto, { type: MimeType.FORM_DATA })`, one multipart request whose only part is `name="constructor"; filename="x.txt"`: expect a 400 naming the unknown key and a second request answered afterwards. Today jest reports the uncaught `TypeError` and the suite dies with it.

> **Closed 2026-10-21, the way the finding proposed.** The parser collects fields and files in `Map`s,
> builds the value with `Object.fromEntries` the way the url-encoded parser does, and looks a part's
> property up by own key only - so `constructor`, `__proto__`, `toString` and `hasOwnProperty` as a
> file part are a 400 for an unknown key, and `__proto__` as a text field is reported rather than
> dropped. `form-data.body-parser.test.ts` holds both cases and a request answered after them; the
> suite now boots on the in-memory data source, since parsing a body touches no store. Red first:
> the file part took the suite down with the `TypeError`, and `__proto__` as text was a 200.

## MAJOR

### H2. A shutdown never finishes while one websocket client is connected — MAJOR
*Filed 2026-10-21.*

`packages/zibri/src/application/application.ts:546` runs `shutdownHttpServer()` before any shutdown hook. That method (`:870-903`) calls `server.close(cb)`, waits for it under `HTTP_DRAIN_TIMEOUT_IN_MS` (ten seconds, `packages/zibri/src/di/default/zibri-di-providers.default.ts:133`), and on the timeout calls `server.closeAllConnections()` and then `await closed` without any bound. The socket.io server is closed in `WebsocketService.beforeAppShutdown` (`packages/zibri/src/websocket/services/websocket.service.ts:507-512`), which runs only after that await.

A websocket is an upgraded socket. On upgrade node frees the request's parser and takes the socket out of the list `closeAllConnections()` walks, while `net.Server.close` keeps counting it until it closes, and engine.io only closes its sockets on the http server's `'close'` event, which fires after the count reaches zero. Probed on node v24.21.0 (the repository's engine) with a raw upgrade: the `close` callback does not fire after `closeAllConnections()`, and does not fire at all while the client stays connected. So with one browser tab open, `await closed` never settles, `beforeAppShutdown`/`onAppShutdown`/`afterAppShutdown` never run, and since the signal handlers were already removed (`:541-544`) the next SIGTERM is node's default exit. Under an orchestrator the pod is SIGKILLed at the grace period: no lease handed back (10 §10), no log buffer flushed (`packages/zibri/src/logging/logger.ts:155-157`), no data source closed, and the adapter never tells the other instances it left (`packages/zibri/src/websocket/data-source.websocket-adapter.ts:111-117`).

Not deliberate: `docs/application-lifecycle.md:148-154` promises that "anything still open when that runs out is ended, and the shutdown carries on", and every websocket suite disconnects its clients before `shutdown()` (`websocket.service.test.ts:133-137`, `cluster/websocket.cluster.test.ts:33-39`), so nothing exercises the case. Fix direction: close the socket.io server (or `engine.close()`) as part of the drain rather than after it, or track sockets from the http server's `'upgrade'` event and destroy them when the drain times out; either way the second `await closed` must carry the same bound as the first.

**Verify:** in-memory `startTestServer` with one websocket controller and `WEBSOCKET_OPTIONS_INPUT`, connect one `socket.io-client`, call `server.shutdown()` raced against a timer of `HTTP_DRAIN_TIMEOUT_IN_MS + 5s`: expect the shutdown to win. Today the timer wins.

> **Closed 2026-10-22.** The http server keeps the connections it hands over to another protocol
> (its `upgrade` event, gone again on `close`). The drain ends them as it begins - `end()`, so the
> client is told and reconnects elsewhere - since no request on them could finish; a drain that
> times out destroys whatever is still open, the upgraded ones included, and the second wait carries
> the same bound as the first, with a warning when even that runs out. `application.websocket-shutdown.test.ts`
> connects a socket.io client to an in-memory application with a two second drain and holds the
> shutdown to finishing inside it, the client disconnected; red first, the shutdown never returned.
> The lifecycle page says what happens to a websocket in the drain.

### H3. The uncaught exception that ends the process is the one log line never written — MAJOR
*Filed 2026-10-21.*

`packages/zibri/src/application/application.ts:1086-1091` logs the exception and rethrows synchronously, and the inline comment at `:233-235` says the point is "the error reaching the configured log transports before the exit". Since 04 §3.3 the logger does not write: `Logger.log` adds to a buffer and schedules an unref'd drain `LOGGER_FLUSH_INTERVAL_MS` later (`packages/zibri/src/logging/logger.ts:226-305`, one second by default, `zibri-di-providers.default.ts:99`). A throw from inside an `uncaughtException` listener ends the process on that tick, and there is no `process.on('exit')` flush anywhere in `src`. The record of why an instance died is exactly the one that is dropped.

The signal path loses entries the same way. `shutdown(signal)` flushes the logger in `onAppShutdown` (`logger.ts:155-157`) and then runs `afterAppShutdown`, whose failures are logged in the catch at `application.ts:794-805`, and then calls `process.exit` (`:532-534`, `:556-558`). A data source that fails to close, or anything an `AfterAppShutdown` hook logs, sits in the buffer when the process exits; the exit code says something failed and nothing says what.

Not deliberate: the comment at `:233-235` describes the logger as it was before it became buffered; 04 §3.3 added the flush for the orderly path and nobody re-read the exception handler. Fix: the exception handler flushes with a bounded timeout and then exits (node's own guidance is that this handler must exit), and `shutdown` flushes once more after `afterAppShutdown` - the console transport needs no data source.

**Verify:** unit test on an initialized in-memory application with a recording transport in `LOGGER_TRANSPORTS`: invoke the listener `process.listeners('uncaughtException')` holds inside a `try`, and assert the transport received the entry before the rethrow returns (it does not); second case, an `AfterAppShutdown` provider that throws, `process.exit` mocked, `shutdown('SIGTERM')`, assert the transport holds the error before `exit` was called.

> **Closed 2026-10-22.** The exception handler logs, flushes the logger within a bound (five
> seconds; what could not be written is reported on the console) and then ends the process with 1 -
> node's own rule for this handler, rather than a rethrow that ended it with the entry unwritten. The
> signal path flushes twice from the application rather than through a hook of the logger's own:
> after the `OnAppShutdown` phase, while the data sources are still open, and again after
> `AfterAppShutdown`, once the application is marked offline, for the transports that need no data
> source. Found on the way and fixed with it: the logger passed every `afterStartup` transport over
> for the whole shutdown, since it judged by the application being initialized or started - so the
> flush at shutdown never reached the db transport, and the last second of entries, "shutting
> down..." included, was lost on every orderly stop, against what `docs/logging.md` promised. It now
> judges by the init phase having finished and the application not yet being offline, which also
> keeps a failed init away from a data source it never had. `application.shutdown.test.ts` records
> both transports as the process is asked to end: a failing `OnAppShutdown` hook reaches both, a
> failing `AfterAppShutdown` hook the direct one only, and an uncaught exception both before `exit(1)`.
> Red first on the three cases; the lifecycle and logging pages say what is flushed when.

### H4. An array query parameter with one value is a 400, and the OpenAPI document describes a format the router does not read — MAJOR
*Filed 2026-10-21.*

`packages/zibri/src/parsing/parser.ts:136-140` hands `req.query[name]` to `parseArray`, which (`packages/zibri/src/parsing/functions/parse-array.function.ts:20-32`) `JSON.parse`s a string and, when that fails or does not yield an array, hands the raw value back. Express 5's query parser gives `['a', 'b']` for `?tags=a&tags=b` and `'a'` for `?tags=a`, so two values work and one value reaches validation as a string, which `validation.service.ts:295-297` refuses with "should be of type array". `?tags=42` parses to the number 42 and is refused the same way.

The published document says the opposite of both: `open-api.service.ts:1225-1243` and `:1280-1288` emit `in: 'query', schema: { type: 'array', items }` with no `style`/`explode`, which OpenAPI defines as `form`/`explode` - `?tags=a&tags=b`, and `?tags=a` for one element. The only form the suite exercises is a JSON string in the query (`packages/zibri/src/routing/router.test.ts:269-273`), which is the one form the document does not describe (an object parameter is declared as `content: application/json`, `:1233-1240`; an array is not). A client generated from the spec gets a 400 the first time a list holds one entry.

Fix direction: a string that is not a JSON array becomes a one-element list (the spec's form), and the document either keeps `form`/`explode` or states `content: application/json` the way object parameters do - not both.

**Verify:** in-memory `startTestServer`, `@Param.query('tags', { type: 'array', items: { type: 'string' } })`: `GET ?tags=a` answers 200 with `['a']` (today 400), `GET ?tags=a&tags=b` answers `['a', 'b']`; and a unit assertion that the parameter's document carries either an explicit `style` or `content`.

> **Closed 2026-10-22.** An array query parameter is read as the document describes: one value per
> item, a value alone a list of one, and a value spelling a json list that list - `?tags=42` is
> `['42']`, the text it was sent as. Query parameters only; a json body naming a string where a list
> is declared is still refused. The document now says `style: form, explode: true` outright, and the
> framework's own http client sends a list as one value per item, where it sent them joined by
> commas. Red first in `router.test.ts` (400 on `?tags=a`); the document in `open-api.service.test.ts`;
> `creating-endpoints.md` says how a list and an object are spelled in a query.

### H18. After one failed read of the pub/sub channel, an instance stops hearing the other instances for good — MAJOR
*Filed 2026-10-21. The store half is round-2 02 §S11; this is what it does to websockets.*

`ValKeyDataSource.subscribe` reads messages in a loop that `return`s on the first rejected `getPubSubMessage()` (`packages/zibri/src/data-source/data-sources/val-key/val-key-data-source.model.ts:399-415`), logging once and never reopening the subscriber. The websocket adapter subscribes exactly once, in its constructor (`packages/zibri/src/websocket/data-source.websocket-adapter.ts:95-99`, `:154-164`), with no reconnect and no way to learn the loop ended. Publishing goes through the data source's main client and keeps working, so after a valkey failover or one dropped connection the instance is half in the cluster: its broadcasts reach everybody, nobody's reach it.

What that costs on the websocket side: `io.to(room).emit` from any other instance never reaches this instance's sockets, so the clients it holds miss every broadcast, channel message and user message sent elsewhere (04 §1.10's guarantee); `ASK_FOR_ANSWERS_EVENT` never arrives, so every `sendToChannel({ expectResponse: true })` on the other instances waits out `timeoutInMs + 1s` for answers this instance will never send (`websocket.service.ts:1131-1159`, the heartbeat still counts it because publishing works); and `ENDED_LOGINS_EVENT` never arrives, so a logout, a revoked token or a deactivated user on another instance leaves the user's sockets here open and receiving until the credential's own expiry check (`:1259-1277`, `:1283-1304`) - the guarantee 02 §M17 closed holds on every instance but this one, and nothing reports which one. The adapter's `close()` also never runs for a loop that died, so the glide client leaks until shutdown.

Fix direction belongs with §S11 (resubscribe with backoff inside `subscribe`, so every consumer gets it); the adapter should additionally log at error level when its subscription ends, since silence is what makes this invisible.

**Verify:** a cluster suite over valkey: two instances, a client on each, kill and restart the valkey container (or `CLIENT KILL` the subscriber connection), then `sendToAll` from instance one: expect the client on instance two to receive it. Today it never does, and `logins ended` on instance one leaves the socket on instance two open.

> **Closed 2026-10-23, together with 02 §S11.** A dropped connection was never what ended the loop:
> glide 2.5 reconnects it and subscribes it again by itself (`pubsubReconciliationIntervalMs`), and
> `getPubSubMessage` rejects only for a client that was closed. That one never opens again, and the
> loop returned. `subscribe` now closes it, logs at error level, and subscribes again on a new client
> after a second, retrying until it works or the subscription is ended, as the postgres listener
> already did. So the subscription never ends while someone holds it, and the adapter needs no signal
> of its own. Tests, none run here (containers): `val-key-pub-sub.test.ts` closes the subscriber
> client (got through a call-through spy on `createClient`, since nothing outside the process can
> close it) and `CLIENT KILL TYPE pubsub`s it, expecting delivery again each time; the Verify above is
> the last case of `websocket.cluster.test.ts` (kill, broadcast until instance two hears, then a
> deactivation on one closes the socket on two). Expected red without the fix: the closed-client case
> only. `websocket.md` says an instance hears the others again after reconnecting.

## MINOR

### H5. An optional body cannot be left out — MINOR
*Filed 2026-10-21.*

`packages/zibri/src/parsing/parser.ts:150-157` reads the content type and falls back to the declared one only for a response or a websocket message ("a http request that names none is refused"); `:176-181` then throws `UnsupportedMediaTypeError('')`. So `@Body(X, { required: false })` on a `POST` or `DELETE` answers 415 to a request with no body and no `Content-Type`, which is what `curl -X DELETE` and most clients send. The one test of the optional case goes through `postJson`, which sets the header on an empty body (`packages/zibri/src/routing/one-of-bodies-and-params.test.ts:306-312`). A request with no content type and nothing on the wire should hand back `undefined` and let `required` decide.

**Verify:** in-memory server, route with `@Body(X, { required: false })`, `fetch(url, { method: 'POST' })` with no headers: expect 200; today 415.

> **Closed 2026-10-27.** `Parser.parseBody` hands back `undefined` for a http request that names no content type
> and carries nothing (`hasContent`: no `Transfer-Encoding`, and no `Content-Length` or `0`, RFC 9112 §6.3), and
> `validateBody` decides by `required`. Something on the wire without a type is still 415. fetch sends
> `Content-Length: 0` for a bodyless POST, which the first version of the check missed. Test: a case in
> `one-of-bodies-and-params.test.ts` (red first: 415).

### H6. A file is always an attachment, and a non-ASCII filename reaches the user percent-encoded — MINOR
*Filed 2026-10-21.*

`packages/zibri/src/routing/router.ts:1013-1015` writes `Content-Disposition: attachment; filename="${encodeURIComponent(result.filename)}"`. Browsers do not percent-decode the plain `filename` parameter, so `Rechnung März.pdf` is saved as `Rechnung%20M%C3%A4rz.pdf`; RFC 6266 puts the encoded form in `filename*=UTF-8''...` beside an ASCII `filename`. And `FileResponse` has no way to say `inline`, so a PDF, an image or a generated report cannot be shown in the browser - every file is a download. Both are what an international deployment meets on the first invoice.

**Verify:** in-memory server returning `FileResponse.fromStream({ filename: 'Rechnung März.pdf', ... })`: assert the header carries `filename*=UTF-8''Rechnung%20M%C3%A4rz.pdf` and an ASCII fallback; today it is `filename="Rechnung%20M%C3%A4rz.pdf"`.

> **Closed 2026-10-27.** `resolveContentDisposition` (`http/content-disposition.function.ts`) writes an ASCII
> `filename` (accents dropped, the rest `_`, quotes escaped) and, when that differs, `filename*=UTF-8''…` per
> RFC 8187. `FileResponse` takes `disposition: 'attachment' | 'inline'` (`ContentDisposition`, exported),
> 'attachment' by default since a file shown is rendered on the application's origin; `creating-endpoints.md`
> says both. No dependency: express's `content-disposition` is transitive only. Test:
> `router.file-response.test.ts` (red first).

### H7. Error bodies carry developer prose — MINOR
*Filed 2026-10-21.*

`RelationsNotAllowedValidationProblem` (`packages/zibri/src/validation/validation-problem.model.ts:120-168`) answers a 400 whose paragraphs are a TypeScript snippet naming the entity class, its relation target and a helper (`OmitType`, which the framework does not export - it is `OmitClass`). `UnmatchedRouteError` (`packages/zibri/src/error-handling/errors/unmatched-route.error.ts:13-16`) tells every caller, JSON ones included, to "take a look at the available Routes via the OpenAPI Explorer linked below" - there is no link in JSON, and the sentence advertises the explorer to anonymous callers of an application that put it behind `OPEN_API_AUTH`. Both reach end users and both name internals that belong in the server log.

**Verify:** in-memory server, a body with a relation key and a `GET /nope` with `Accept: application/json`: assert neither body contains `class ` or `Explorer`.

> **Closed 2026-10-27.** `RelationsNotAllowedValidationProblem(key)` says the one sentence; how to take related
> rows in a body is in `models.md` "Deriving models". `UnmatchedRouteError` names the route only; the scaffold's
> html error page links the explorer itself. The unit tests of the example generation were replaced by one of the
> plain message. Test: `router.error-bodies.test.ts` (red first, both cases).

### H8. The document does not say that an optional property accepts `null` — MINOR
*Filed 2026-10-21.*

Validation treats `null` like a missing value (`packages/zibri/src/validation/functions/validate-string.function.ts:41`, `== undefined`), and the docs model it that way (`docs/creating-endpoints.md:81-82`, `name?: string | null`). The schema says `type: 'string'` (`packages/zibri/src/open-api/open-api.service.ts:1299-1312`), so a generated client strips or refuses a `null` the server would accept and answer with. OpenAPI 3.1 spells it `type: ['string', 'null']`. Beside it, the `oneOf` schema (`:1159-1175`) declares `discriminator: { propertyName: 'shape' }` over inline schemas without a `mapping`, which the specification only defines for named schemas; generators that honour discriminators ignore or reject it.

**Verify:** unit test over `createOpenApiDefinition`: a `@Property.string({ required: false })` property's schema includes `null` in its type; today it does not.

> **Closed 2026-10-27.** `buildOpenApiSchemaForProperties` adds `null` to the type of every property that is not
> strictly required (`allowNull`, in requests and responses, `null` added to an `enum` too); a schema of no type
> with `oneOf`/`anyOf` becomes `anyOf: [schema, { type: 'null' }]`. The discriminator is gone, the `enum` of each
> shape's name already tells them apart. `open-api.md` says it. Tests: two cases in `open-api.service.test.ts`
> (red first), three expectations of the old shape updated.

### H9. An undecorated handler parameter is a 500 on the first call rather than a refusal at boot — MINOR
*Filed 2026-10-21.*

`resolveRouteParamMetadata` counts the declared parameters at registration (`packages/zibri/src/routing/route-param-metadata.model.ts:99-104`), and the comparison against the method's `length` happens per request in `parseRouteParams` (`packages/zibri/src/routing/resolve-route-params.function.ts:91-96`, "Did you forget to decorate one of the parameters?"). The function is in hand at registration (`router.ts:875-892` reads `controllerClass` and the method name), so the mismatch is knowable when `RouteRegistry.register` runs, which is where 02 §M3 moved every other declaration check for this reason. The same shape for websocket routes (`websocket.service.ts:1428`).

**Verify:** in-memory server with a controller whose route method has an undecorated parameter: expect `init()` to throw naming `Controller.method`; today it boots and the route answers 500.

> **Closed 2026-10-27.** `resolveRouteParamMetadata`, which `RouteRegistry.register` runs while the router and
> the websocket service register a route, compares the declared parameters with the method's `length` and throws
> naming `Controller.method`. The per-request check and the fields only it read (`controllerClass`,
> `controllerMethod`, `declaredParamCount`) are gone. All 215 in-memory suites boot (no shipped or test
> controller had one). Test: `router.undecorated-param.test.ts` (red first: the application started). It
> replaces `resolve-route-params.function.test.ts`, a postgres suite that asserted the 500 at the first call
> and was missed by the in-memory sweep; removed 2026-10-28.

### H10. Preflights are never cached — MINOR
*Filed 2026-10-21.*

`packages/zibri/src/http/cors.middleware.ts:140-145` answers a preflight with `sendStatus(200)` and no `Access-Control-Max-Age`, and browsers then cache it for five seconds. Every call the framework's own clients make is non-simple (`Authorization`, `x-version`, the csrf header), so a single-page app on another origin pays a round trip per endpoint every five seconds. One header with a configurable value closes it.

**Verify:** the cors suite: a preflight response carries `Access-Control-Max-Age`.

> **Closed 2026-10-27.** `CorsOptions.preflightMaxAgeInMs`, two hours by default (Chromium's cap), sent as
> `Access-Control-Max-Age` in seconds on a preflight only; `app-settings.md` "Preflights". The cors suite booted
> postgres for headers alone and runs in memory now. Test: a case in `cors.middleware.test.ts` (red first).

### H11. No cache directive on authenticated responses, and a served file says `public` — MINOR
*Filed 2026-10-21.*

A json result is written with `res.type().send()` (`router.ts:975`) and carries an `ETag` and `Vary: Accept(-Encoding)` but no `Cache-Control`; only the OAuth2 routes set `no-store` (`packages/zibri/src/auth/authorization-server/authorization-server-controller.model.ts:30`). A response to a request carrying `Authorization` is protected by RFC 9111, a cookie-authenticated one is not: a shared cache between a browser and a cookie-auth deployment may store `/users/me` and revalidate it with the validator the framework supplies. `FileResponse.fromPath` goes through `res.sendFile` (`router.ts:1026`), whose defaults add `Cache-Control: public, max-age=0` to every download, authenticated or not. Spring Security's answer - `no-store` on every secured response - is what an OWASP checklist asks for.

**Verify:** in-memory server, an `@Auth.isLoggedIn()` json route and a `FileResponse.fromPath` route: assert `Cache-Control` is `no-store` (or at least `private`) on both; today the first has none and the second says `public`.

> **Closed 2026-10-27.** `Router.writeCacheControl` sets `no-store` before the result is written when the request
> found out who sent it and the route set no `cache-control` itself (a `JsonResponse` header still overrides
> it). Decided through the new `AuthServiceInterface.resolveIsCallerIdentified`, which reads the per-request
> principal memo every check and `getCurrentUser` go through, so a public route stays cacheable and nothing
> is resolved for it. The context tokens were not enough: the access check never reads them. `sendFile` runs
> with `cacheControl: false`. `app-settings.md` "Security headers". Test: `router.cache-control.test.ts`
> (red first: none on the logged-in routes, `public, max-age=0` on the file).
>
> *Follow-up the same day:* `static-assets.evaluation.test.ts` ("answers the favicon the same way")
> went red with it: the framework's `/favicon.ico` route lost the `public, max-age=0` the static
> middleware gives every other public asset. The route sets it itself now (`AssetService`), which is
> the route saying how its file is cached, as the closure intends.

### H12. A status cannot be chosen at run time, and the streaming the docs mention is undocumented — MINOR
*Filed 2026-10-21.*

The status comes from the declaration that matches the returned value (`router.ts:938-941`, `:1140-1166`), and `JsonResponse` carries headers only (`packages/zibri/src/http/json-response.model.ts:8-13`), so a `PUT` that answers 201 when it created and 200 when it replaced, or a 202 decided by a queue's state, cannot be written without a second declared class. `docs/creating-endpoints.md:786` and `:826` speak of "a page of server-sent events" and streamed responses, and no page says how a handler produces one - which is by injecting the request context and writing to `context.response` yourself, after which `returnResult` steps aside on `headersSent` (`router.ts:922-924`). A `status` on `JsonResponse` and one documented section would close both.

**Verify:** a docs-example test compiling `JsonResponse.of(body, { status: HttpStatus.CREATED })` and asserting the answer is 201; today the option does not exist.

> **Closed 2026-10-27.** `JsonResponseOptions.status` (and `headers` optional now), passed to `returnResult` as
> the chosen status ahead of `resolveStatus`. `creating-endpoints.md` shows it under "Answering with headers",
> and a new "Streaming a response" section shows server-sent events written to `ctx.response`, with the one
> condition the router puts on it: the headers are out before the handler returns, or it is answered 204.
> Tests: a case in `json-response.model.test.ts` (red first: neither answered in the status chosen), and
> `router.streaming.test.ts` running the documented example past a 50 ms handler deadline.

### H13. A plugin cannot ship websocket controllers, two-factor methods, data sources or backup transports — MINOR
*Filed 2026-10-21.*

`ZibriPlugin` carries providers, controllers, cron jobs, body parsers, auth strategies and authenticators (`packages/zibri/src/plugin/plugin.model.ts:12-50`), and `createFullOptions` merges exactly those (`application.ts:1018-1025`). A plugin that is a notification feature (a websocket controller), a second factor, or a backup target has to ask the application to register its classes by hand, which the docs already do for one shipped plugin (`docs/plugin.md:90-97`). Plugins are the composition seam an enterprise reuses across projects, so the seam should carry everything the options carry.

**Verify:** a plugin declaring a `websocketControllers` array is a type error today; once added, an in-memory application built from the plugin alone answers the event.

> **Closed 2026-10-27.** `ZibriPlugin` carries every list the options carry: `websocketControllers`,
> `dataSources`, `twoFactorMethods`, `backupTransports` and `additionalLifecycleServices` beside the six it had,
> merged in `createFullOptions` like those (a plugin's two factor methods replace the OTP default as its
> authenticators do the password one). `plugin.md` lists them. Test: `plugin/plugin.model.test.ts`, an
> application declaring neither the websocket controller nor the data source answers the event over the
> plugin's own data source (red first: the data source was never registered).
>
> Found on the way: a data source that runs migrations (Valkey, in memory, sql under `'migrations'`) and does not
> declare `MigrationEntity` failed at boot with `NoProviderError` for `Repository<MigrationEntity>@X`, and
> `data-source.md` said the entity is needed under `'migrations'` only. `resolveMigrationRepository` refuses it
> naming the data source and the entity, for every reader of the records (boot, key reconciliation, revert,
> the commands); the Requirements row names data sources without `schemaManagement`. Test:
> `migration-entity-required.test.ts` (red first).

### H14. The route record is written where the application runs — MINOR
*Filed 2026-10-21.*

`VersioningService.afterAppInit` writes `versions/<version>.json` at startup when the version changed (`packages/zibri/src/versioning/versioning.service.ts:96-104`, `:120-128`, `:260-274`), and `docs/deployment.md:115-123` documents that the folder is writable by the running user. The design is deliberate; what it meets in an enterprise is `readOnlyRootFilesystem: true`, which every pod security baseline sets. The documented way out is a writable mount, and a mount is empty: the folder exists, `versionFiles` is empty, `:120-128` records the running version as the first one ever, and every guarantee the history exists for is dropped - silently, which is the exact case the comment at `:81-91` says must stay distinguishable from a missing folder. Recording the snapshot at build time (`zi build`) and only reading it at run time would keep the guarantee under a read-only image.

**Verify:** start an in-memory application with `VERSIONS_PATH` pointing at an empty directory while the code's version is `2.0.0` and a `1.0.0.json` with a route the code no longer has exists elsewhere: the start is accepted; the test records that nothing refuses the empty history.

> **Closed 2026-10-27, as the user decided: never write in production.** `VersioningService.recordVersion`
> refuses to start a production application whose record does not hold its version as the only latest one,
> before anything is written, saying to record it in development, commit and rebuild; development records as
> before. A `zi build` step was the other option, and needs the build to boot the application to list its routes.
> `deployment.md` ("What the application writes" names `.zibri` only), `versioning.md` and an upgrade-guide
> entry. Test: `versioning.production.test.ts` (red first: the empty folder was written to).
>
> **Followed through to the scaffold 2026-10-29.** `new.command.docker.heavy.test.ts` still built the
> image from the empty folder `zi new` writes and expected the production container to record the
> version, so all of it failed at startup. It now does what `deployment.md` says: it starts the image
> once in development with the project's `versions` mounted, builds again from the recorded folder,
> and starts production on a fresh database. The read-only case that stops mounts an empty `versions`
> and expects the refusal instead of `EROFS`. The generated `Dockerfile`, and the sandbox's, no longer
> hand `versions` to the `node` user, since production only reads it; `deployment.md` says so. Red
> first: *gives the user running the image only the paths the application writes* in
> `new.command.test.ts` now expects `/app/.zibri` alone.

### H15. The html error fallback logs three warnings per request — MINOR
*Filed 2026-10-21.*

`packages/zibri/src/error-handling/error-handler.ts:88-98` logs three `warn` lines on every error answered to a client that accepts html when no `ERROR_PAGE_TEMPLATE` is configured. The scaffold does configure one (`packages/cli/src/commands/new/new.command.ts:480-482`), so this hits applications that removed it; for those, a browser-side scan of a few thousand unknown urls writes three warn rows each into the `log` table - the access log was kept off by default to avoid that table becoming the busiest one (02 §M6). One warning at boot says the same thing once.

**Verify:** in-memory server without the template, a hundred `GET /unknown` with `Accept: text/html`, a recording transport: expect one warn entry, today three hundred.

> **Closed 2026-10-27.** `errorHandler` answers json without a word; the application warns once where it mounts
> the global error handler, when that is the default one and no template is provided (an application with a
> handler of its own is not told about a template it does not use). `error-handling.md` says so. Test:
> `error-handler.html-fallback.test.ts` (red first: twenty requests, twenty of the middle warning alone).

### H16. The explorer and the document are public by default, permission names included — MINOR
*Filed 2026-10-21.*

`OPEN_API_AUTH` defaults to `{ skip: true }` (`zibri-di-providers.default.ts:122`), the scaffold does not set it, and the document carries every route, every model and the `x-permission` names (`open-api.service.ts:581-582`). 02 §M13 decided this: a browser navigation carries no bearer token, so an inherited `requireLogin` produced an explorer nobody could open. That is a good argument for development and a weak one for production, where an enterprise expects the route map to be default-deny and the explorer to be a non-production feature. A scaffold that gates it by environment, or a default that follows `defaultAuth` with a documented dev-only override, keeps the explorer usable and the production surface closed.

**Verify:** scaffold test: a generated project's providers set `OPEN_API_AUTH`, or the spec route answers 401 under `defaultAuth: 'requireLogin'` without an override.

> **Closed 2026-10-27, as the user decided: follow `defaultAuth`, with an override independent of it.**
> `OPEN_API_AUTH` defaults to `{}`, which is the application's default, reversing 02 §M13's `{ skip: true }`;
> providing it stays the override (`{ skip: true }` opens it). `open-api.md`, `configuration.md` and an
> upgrade-guide entry. Tests: a describe in `open-api.service.test.ts` (red first: 200 anonymously under
> `isLoggedIn`; the override answers 200); `default-auth.test.ts` opens the document explicitly now, which its
> spec cases read anonymously (container suite, not run here). The scaffold and the sandbox provide
> `{ skip: true }` in every environment, at the user's decision, so a `zi new` project with `isLoggedIn` keeps
> an explorer a browser can open; a case in `new.command.test.ts`. Missed then and updated 2026-10-28:
> `manual-routes.evaluation.test.ts` (round 1's 02 §M13) still asserted the public default; its two cases now
> assert the login by default and the public explorer through `{ skip: true }`.

### H17. The keep-alive default is the one that produces intermittent 502s behind every common proxy — MINOR
*Filed 2026-10-21.*

`keepAliveInMs` defaults to five seconds (`zibri-di-providers.default.ts:152`) and the model's own comment (`packages/zibri/src/http/http-server-limits.model.ts:26-33`) says to raise it above the proxy's idle timeout, because a proxy that reuses a connection the server just closed reports a gateway error no log explains. AWS ALB idles at 60 s, nginx at 75 s, GCP at 600 s, so the default is wrong for every deployment the deployment page describes and right for none. A default above the common idle timeouts (AWS's own recommendation is a few seconds above the balancer's), or making it required, turns a documented trap into a non-event.

**Verify:** none needed beyond the default's value; a docs-example test asserting the scaffold's `HTTP_SERVER_LIMITS` sets `keepAliveInMs` above 60 s would hold the decision.

> **Closed 2026-10-27, as the user decided: nginx's 75 seconds.** `keepAliveTimeoutInMs` defaults to 75 s, above
> AWS ALB's 60 s; `application-lifecycle.md` says what it is (the idle time between two requests on one
> connection, not how long a request lives) and names GCP's 600 s as one to raise it for. Shutdown is not held
> up by it: on node 24, which the package requires, `server.close()` closes idle connections. Not tested: that
> `headersTimeoutInMs` (15 s) leaves an idle keep-alive connection alone, since node checks it every 30 s and a
> test would wait that long. Test: a case in `http-server-limits.test.ts` reading the started server's
> `keepAliveTimeout` (red first: 5000).

### H19. Header names are matched case-sensitively against a map node lowercases, and the docs example hits it — MINOR
*Filed 2026-10-21. Same class as round-2 05 §I11 (the `Bearer` scheme and the api key header).*

Node hands every incoming header name over lowercased, and socket.io's `handshake.headers` is the same map. `Parser.parseHeaderParam` reads `req.headers[metadata.name]` with the name exactly as the decorator was written (`packages/zibri/src/parsing/parser.ts:131`), and `createHeaderParamMetadata` does not lowercase it (`packages/zibri/src/routing/param-metdata.helpers.ts:173-175`), so `@Param.header('User-Agent')` - the example in `docs/creating-endpoints.md:280` - is always `undefined`, which for a required parameter is a 400 "is required" on every request. The `Header` type is `KnownHeader | (string & {})` (`packages/zibri/src/http/header.type.ts:6`), so nothing stops the spelling. The configured `VERSION_HEADER` is read the same way (`packages/zibri/src/versioning/versioning.service.ts:457-458`): an application that overrides the token as `X-Version` never resolves a version from the header. The parser's own content-type read knows the problem - it falls back to `KnownHeader.CONTENT_TYPE.toLowerCase()` (`parser.ts:150-151`) rather than fixing the lookup.

The rest of the runtime is clean: content types are lowercased before comparison (`parser.ts:152`), `accept-encoding` and `cache-control: no-transform` are case-insensitive (`compression.middleware.ts:59`, `:46`), `Accept` goes through express's negotiator, and `Sec-Fetch-Site` values are lowercase by specification. One related exactness: a configured CORS origin is compared with `===` (`cors.middleware.ts:165`), and a browser serializes origins lowercase, so `https://App.corp.com` in the options never matches; the `CorsOrigin` type could demand `Lowercase<string>`.

**Verify:** in-memory server with `@Param.header('User-Agent') agent: string` as the docs write it: expect the handler to receive the header; today 400. A second case overriding `VERSION_HEADER` with `'X-Version'` and sending it: expect the version to resolve.

> **Closed 2026-10-27.** `findHeader(headers, name)` (`http/find-header.function.ts`) lowercases the name, and
> every lookup by a declared or configured name goes through it: header parameters (the parsed value is stored
> under the lowercased name too, on controller and configuration routes), the content type, `VERSION_HEADER`,
> the OTP, passkey, code and recovery code headers, `API_KEY_HEADER` (the header half of 05 §I11) and the login
> ticket header. A configured CORS origin is matched in any spelling and answered as the browser sent it, since
> the browser compares the two. Tests: `http/header-names.test.ts` (parameter, version header, origin) and a
> case in `api-key.auth-strategy.test.ts` (`X-Api-Key`), all red first.

### H20. Building an application adds to the lists of the options it was given — MINOR
*Filed and closed 2026-10-26, found by 08 §X27's work (06 §F27).*

`ZibriApplication.createFullOptions` spread the provided options, so `cronJobs`, `authenticators`,
`authStrategies`, `twoFactorMethods` and the other lists were the caller's own arrays, and everything
the application added while it started went into them: the default `JwtAuthStrategy`,
`PasswordAuthenticator` and `OtpTwoFactorMethod`, and every cron job a feature registers. A second
application built from the same options, such as a test reusing `baseApplicationOptions`, started
with what the first one added. The test harness's `reInit` made it worse by inheriting `app.options`
itself, so a feature's cleanup job outlived the feature.

> **Closed 2026-10-26.** The application copies every list it is given; `StartedTestServer` keeps the
> options it built the application from and a `reInit` inherits those, plugins included (it dropped
> plugins before, because `app.options` held what they had added). Tests:
> `application.options-base.test.ts` "leaves the lists it was built from as they were", red with the
> caller's arrays holding the defaults and the cron jobs; `password-reset-token-cleanup.cron-job.test.ts`
> "after a reInit without the password authenticator", red with the job still registered.

## Code quality and architecture

Moved to [code-review/03-http-runtime-core.md](./code-review/03-http-runtime-core.md) (Q1–Q9).

## Already filed

- HTTP/2 and in-process TLS absent → 02 §M11, open (waiting on a decision).
- A push-only websocket application on one instance gets no server → 04 §1.14, open.
- `@XmlText` not expressible in the document → 02 §M15, open (waiting on Swagger UI).
- Explorer and document public by default → 02 §M13, closed; H16 above says why the closure is thin for production.
- `__proto__` in url-encoded forms and cookies → 03 (closed); H1 is the multipart gap those fixes did not reach.
- In-flight draining and its timeout → 02 §C3, closed; H2 is the hole an upgraded socket leaves in it.
- Process-level `uncaughtException` handler → 02 §C4, closed; H3 is what the buffered logger (04 §3.3) did to its purpose.
- Multipart part and file limits, 413 as a reset → 02 §M10, closed.
- 405 and 406 → 02 §M14, closed; verified present.
- Error logging and the access log → 02 §M6, closed; H15 is the fallback branch left logging per request.
- Middleware ordering → 02 §M12, closed; the phase table matches the code.
- Manual routes outside auth → 02 §M13, closed; `checkRouteAccess` runs first in `createManualRouteInnerHandler`.
- A valkey subscription that fails once delivers nothing for the rest of the process → round-2 02 §S11; H18 above is the websocket-side consequence.
- `Bearer` and the api key header matched case-sensitively → round-2 05 §I11; H19 above is the same class in the http runtime.

## Not reviewed

`context/cache` and `als.utilities.ts` (left to the caching reviewer), `websocket-request.context.ts`, `document/xml-writer.utilities.ts` and `xml.utilities.ts` beyond the parser entry (entity expansion was checked: saxes expands none), the `zibri-tsx` runtime's escaping beyond its own tests, `http-client`, `sem-ver.utilities.ts` matcher arithmetic, the metrics and access-log middleware, `route-label.utilities.ts`, the CRUD controller's options, the explorer's own page beyond its auth posture, the sandbox application, and the docs pages assets, document, xml, templating, versioning and request-context in full.
