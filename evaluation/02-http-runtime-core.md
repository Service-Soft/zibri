# HTTP / Runtime Core — Bootstrap, Routing, Parsing, Middleware, Errors, Lifecycle, WebSockets

All paths relative to `packages/zibri/`.

---

## CRITICAL

### C1. CORS is hardcoded to `Access-Control-Allow-Origin: *` — ~~CRITICAL~~ **FIXED** **[verified]**

`src/http/cors.middleware.ts:11-19`

```ts
res.setHeader(KnownHeader.ACCESS_CONTROL_ALLOW_ORIGIN, '*');
res.setHeader(KnownHeader.ACCESS_CONTROL_ALLOW_METHODS, 'GET,POST,PUT,DELETE,OPTIONS');
res.setHeader(KnownHeader.ACCESS_CONTROL_ALLOW_HEADERS, 'Content-Type, Authorization');
if (req.method === 'OPTIONS') { return res.sendStatus(200); }
```

Registered at field-initializer time (`src/application.ts:78-80`), so it runs before every user
middleware. There is **no CORS option** in `ZibriApplicationOptions`, `corsMiddleWare` is not
exported from `src/index.ts`, and CORS appears in **zero** documentation files.

Three separate failures:

- **`*` on every route, including authenticated ones.** Any origin can call the API with a bearer
  token. An enterprise cannot lock the API to `app.corp.com`.
- **`PATCH` is missing** from the allowed methods, so every browser `PATCH` preflight fails —
  and Zibri has `@Patch` routes. The allowed *headers* likewise omit the framework's own
  `x-csrf-token`, `x-authorization-otp`, `x-correlation-id` and `x-version`, so a cross-origin
  browser client physically cannot send the CSRF token or the 2FA code. The CORS policy the
  framework ships forbids the security headers the framework defines.
- **`OPTIONS` routes are impossible.** Every `OPTIONS` is short-circuited with an empty 200 before
  the router, yet `HttpMethod.OPTIONS` is a first-class registerable method
  (`src/routing/router.ts:320-324` branches on it explicitly). Registering one silently never fires.

> **Closed.** `corsMiddleware(options)` is now built from `security.cors` on
> `ZibriApplicationOptions`, exported, and documented in the new `docs/app-settings.md` - CORS appeared
> in zero documentation files before. Origins are `'*'` or a list, typed as `` `http://${string}` ``
> / `` `https://${string}` `` so a bare hostname, which can never match what a browser sends, is a
> compile error rather than a silent mismatch. `Vary: origin` is set whenever the answer depends on
> who asked. Held by `src/http/cors.middleware.test.ts`, which goes through a real server because
> what matters is the headers on the wire, not that `setHeader` was called.
>
> The default stays `'*'` with no credentials. Restricting by default would break every existing
> app to protect against something that default does not actually permit: with no credentials a
> browser attaches no cookies, so a cross origin page still needs a token it was deliberately given.
> What was missing was the ability to lock it down at all.
>
> `credentials: true` together with `origins: '*'` **throws at startup**. Browsers refuse that
> combination, so accepting it would present the loosest-looking configuration while silently
> disabling cookie auth from every browser.
>
> **The methods and headers bullets are closed as stated** - every routable method including `PATCH`,
> and the framework's own headers: the two configurable ones taken from the DI tokens that name them,
> so renaming `CSRF_TOKEN_HEADER` cannot leave the CORS policy behind, and `traceparent` /
> `tracestate` beside them, whose names belong to the standard rather than to this framework. The
> trace a request was answered in is exposed back, so a page can report which one to look at.
>
> **The `OPTIONS` bullet was right about the symptom and wrong about the cause, twice.** Only actual
> preflights are short-circuited now, discriminated by `access-control-request-method`, which the
> Fetch spec makes mandatory on every preflight - so nothing a browser sends is affected.
>
> An `@Options` route was never registerable in the first place: **there is no `@Options` decorator**,
> and the router branching on `HttpMethod.OPTIONS` is unreachable from user code. Deliberately not
> added - a preflight must be answered by the middleware whatever a user route says, so such a route
> would fire only for the OPTIONS requests that are *not* preflights, splitting one route across two
> handlers on a header the caller happened to send.
>
> **What the short circuit actually cost was express's own `OPTIONS` handling**, which is better than
> the thing the bullet asked for. Express answers `OPTIONS` on a known path with an `Allow` header
> listing the methods that do exist - the standard meaning of the method, and useful without any
> route being registered for it. Every one of those was replaced by a blank 200, for every path in
> the app including ones that do not exist. Found by the test asserting a 404 and getting a 200: the
> request had reached the router all along, and the router had a real answer.
>
> Also found while checking: **there is no `@Put` decorator either** (`src/routing/router.ts:326`
> branches on `HttpMethod.PUT`, and `HttpClient` can send one). A Zibri server cannot expose a `PUT`
> endpoint. A separate gap, and a much more surprising one than `@Options`.
>
> **Closed (2026-09-28).** `@Put` exists, shaped like `@Patch`. Nothing else had to change: the
> router, the OpenAPI document and CORS already treated `PUT` like every other method, so the
> decorator was the whole gap. `router.test.ts` dispatches one with a path parameter and a body.
> `docs/creating-endpoints.md` lists it, along with `@Patch` and `@Delete`, which its table of
> exports had left out.

### C2. Prometheus label cardinality explosion → guaranteed OOM — ~~CRITICAL~~ **FIXED** **[verified]**

`src/metrics/metrics.service.ts:105`

```ts
const route: string = req.originalUrl ?? req.route?.path ?? req.path;
```

`req.originalUrl` is the raw URL including path params and query string, and it is always defined
— so `req.route?.path` (the route *template*, the correct value) is dead code. Every distinct URL
becomes a new label value on `http_requests_total` and `http_request_duration_ms` (7 buckets +
sum + count ⇒ ~10 series each), and `prom-client` retains every series with no eviction or TTL.

`for i in $(seq 1 1000000); do curl "$HOST/health?x=$i"; done` creates 10M series and OOMs the
process. No auth required — an unauthenticated remote DoS against both the app and the monitoring
backend. Normal traffic with UUIDs in paths reaches the same end state, just slower.

Also, `res.on('finish')` (line 94) only fires on successful completion, so aborted and errored
requests are never counted — client-abort and error rates are invisible in the very metric meant
to show them.

> **The label is the route template now, and `req.route` was never dead code — it was unreachable.**
> `req.originalUrl ?? …` is a `??` against a value that is always defined, so the two correct fallbacks
> behind it could not run. Routes are bound on an express `Router` mounted at the root
> (`router.ts:134`), so `req.baseUrl + req.route.path` is the full template, and it survives on the
> request until the response ends.
>
> **The half that a template alone does not fix:** a request that matched *no* route has no template,
> and falling back to its url would reopen the hole completely — scanning for admin panels would mint
> a series per guess. All of them share one `<unmatched>` label. That is also the more useful shape:
> what matters about a scan is its rate, not which paths it tried.
>
> **`close` instead of `finish`.** `finish` only fires once a response has been written in full, so a
> client that hung up and a request that died halfway were never counted. `close` fires for both and
> exactly once either way. An abandoned response still carries whatever status was set before the
> client left — usually the 200 nothing ever wrote — so `writableFinished` decides, and an unfinished
> one is labelled **499**, the code proxies already use for this and dashboards already read.
>
> **The asset skip moved to `req.path`.** It used to test the label, which was the full url; now the
> label is a template and would no longer start with the assets route. Checking the path is what the
> skip always meant, and it no longer depends on what the label happens to be.
>
> Proven in `metrics.service.test.ts` by reading the labels back off the registry, which is why this
> needed no scrape endpoint — the reason the evaluation test for it had stayed a todo.

### C3. No in-flight request draining, no readiness signal, no shutdown timeout — ~~partly fixed~~ **FIXED, the readiness half WITHDRAWN**

`src/application.ts:363-378`

```ts
private async shutdownHttpServer(): Promise<void> {
    if (!this.server.listening) { return; }
    return new Promise((resolve, reject) => {
        this.server.close(err => { if (err) { reject(err); } else { resolve(); } });
    });
}
```

- ~~`server.close()` waits for all open connections. `closeIdleConnections()` /
  `closeAllConnections()` are never called anywhere. A long-poll or streaming response blocks
  shutdown indefinitely.~~ **Fixed.**
- ~~There is **no timeout** on `shutdownHttpServer` — ironic, since every lifecycle hook gets a 30s
  `PromiseUtilities.withTimeout` (lines 313, 331, 349). Under Kubernetes: SIGTERM → hang →
  SIGKILL at `terminationGracePeriod` → in-flight requests dropped.~~ **Fixed.** The drain is bounded
  by `ZIBRI_DI_TOKENS.HTTP_DRAIN_TIMEOUT_IN_MS` (ten seconds), after which `closeAllConnections()`
  ends what is left and the shutdown continues.

  This turned out to matter beyond the requests themselves. `shutdownHttpServer` runs *before* every
  lifecycle hook, so an unbounded wait here also blocked
  [10 §10 shutdown draining](./10-leases-and-claims.md) — the hook that hands back the leases held by
  in-flight work. One stuck request meant no lease was ever released, the pod was killed at the grace
  period, and every replica waiting on that work sat out a full lease. The graceful path degraded
  into the crash path without saying so. Covered by `cluster/shutdown.cluster.test.ts`.
- ~~`GlobalRegistry.isAppShuttingDown()` exists (`src/global/global-registry.ts:226`) but is never
  referenced on the request path. There is no readiness flip and no 503 during drain — there
  isn't even a `ServiceUnavailableError` in the error catalogue. The load balancer keeps routing
  to a draining pod.~~ **Withdrawn — this was the wrong layer.** See below.
- ~~`process.exit(0)` (lines 252, 270) is unconditional — exit code 0 even if every shutdown hook
  threw~~ **Fixed.** Each hook still swallows its own error, because they are independent and one
  broken teardown must not strand the rest — but it now sets `shutdownFailed`, and the process exits
  `1` when anything failed. Without that an orchestrator reads a clean exit and a rolling deploy
  carries on as though the teardown had gone fine. Held by `application.shutdown.test.ts`, which
  also holds that a shutdown by a call - not a signal - leaves the process running.

  The second half of that bullet — *"does not flush pending async log-transport writes"* — was
  **overstated**. Every logger call on the shutdown path is awaited, including the ones inside the
  hook catch blocks, so those writes have landed before the exit. What is genuinely unflushed is
  fire-and-forget logging elsewhere, such as `void this.logger.error(...)` in the process-level
  handlers. Fixing that properly needs a flush contract on `LoggerTransport`, which no transport
  implements today, and is a separate piece of work from this finding. *(It exists since: the
  logger buffers every entry and `onAppShutdown` flushes it, 04 §3.3.)*

#### Why the readiness half was withdrawn

A 503-during-drain was built and then reverted, because it does not work and would not help if it
did.

**It is mostly unreachable.** `server.close()` stops the listener, so a *new* connection after that
point is refused by the kernel — no middleware ever runs and there is no 503 to send. It could only
answer on an already-open keep-alive socket, and since Node 19 `close()` drops idle keep-alive
connections too. Making it reachable would need the server to keep listening for a pre-shutdown
window.

**And that window should not answer 503 anyway.** The standard sequence is: readiness flips → the
load balancer removes the instance → the instance *keeps serving normally* for a few seconds, because
endpoint propagation is asynchronous → then close and drain. Requests arriving during that window
were routed by a balancer that had not learned yet; answering them with 503 turns correctly routed
traffic into errors. A delay that 503s is worse than no delay.

**The readiness signal itself belongs to the project, not the framework.** The original finding
assumed the framework knows something the application cannot. It does not:
`start()` runs the `onAppStart` hooks and only then calls `server.listen(port)`
(`src/application.ts:240`), with `init()` already complete — so there is no window where the server
accepts connections while the application is still starting up. Startup readiness is a non-issue,
and shutdown readiness is one boolean (`GlobalRegistry.isAppShuttingDown()`) that any project can
read from a controller of its own. A framework-owned endpoint would force a route on every
application to expose a flag it already has.

**The choreography around it belongs to the deployment.** The `preStop` sleep has to be sized against
a particular ingress's propagation delay, which the process cannot know. `docs/replication.md`
documents what to configure; the framework does not implement it.

`ServiceUnavailableError` was kept — it is a reasonable member of the error catalogue regardless of
this — and the cluster test asserting the 503 was deleted, because it asserted a guarantee none of
the sane designs make.

Nothing in C3 is open any more. The exit code is fixed, the drain is fixed and bounded, and the
readiness half is withdrawn as the wrong layer with the reasoning above. The one thing carried out of
here is a `LoggerTransport` flush contract, which belongs with logging rather than with shutdown, and
closed there (04 §3.3).

**The withdrawal has since been honoured rather than merely argued.** "Any project can read that
boolean from a controller of its own" was true and nobody had written the controller — `zi new` is
the project, and it generated none. It does now, and it is worth reading against the paragraph above:
`/health/ready` is exactly the signal this section says the deployment needs, carried by the one
mechanism that does not turn correctly-routed traffic into errors. The instance keeps serving
normally while the probe says "stop routing to me", which is the sequence the 503-during-drain was
trying and failing to express. See [06 §C4](./06-tooling-ci-and-testing.md), and
[`docs/deployment.md`](../packages/zibri/docs/deployment.md) for the shape a deployment polls it in.
`ServiceUnavailableError`, kept here on general grounds, is what the readiness route throws.

~~`docs/application-lifecycle.md` documents hook ordering in detail and says nothing about draining,
readiness or liveness.~~ It now has a *What happens before the first shutdown hook* section covering
the drain and its timeout, and notes the missing readiness signal.

### C4. Unhandled promise rejections in the websocket path crash the process — ~~CRITICAL~~ **FIXED**

> **Closed on both levels.**
>
> *The last line of defence exists.* `ZibriApplication` installs `process.on('unhandledRejection')`
> and `process.on('uncaughtException')` in its constructor and removes them on shutdown, so a
> rejection escaping any background path is logged and the application keeps serving. Proven by
> *installs a process level unhandled rejection handler* and *…uncaught exception handler* in
> `http-and-observability.evaluation.test.ts`, and it is what stopped a replica exiting with code 1
> in `cluster/events.cluster.test.ts`.
>
> *The handshake handles its own errors.* The whole middleware body is inside the try now, not just
> the version lookup, and `'connection'` has its own `.catch`. This mattered independently: the
> process handler stops a rejection being fatal, but socket.io still never reaches `next()`, so the
> client got no error and sat there until its own twenty second connect timeout. A stalled handshake
> is quieter than a crash, not better than one.
>
> The catch now separates two cases. An `HttpError` is a decision about that client and is forwarded
> as it is, so a thrown `UnauthorizedError` still explains itself. Anything else is this server's
> fault: it is logged, and only `'Could not establish the websocket connection'` goes out. That
> second branch closes a leak the original code had and the original finding did not mention —
> socket.io puts `err.message` on the wire, so `next(error)` handed the internals of a failed
> database call to an unauthenticated client.
>
> Proven by `websocket-handshake.test.ts`, five tests against a real `isAllowedToConnect` that
> really throws. The assertion carrying the finding is a **three second bound** on the connect
> attempt: the old failure mode was silence, not an error, so a test that only checked for an error
> would have passed on a hang.
>
> One correction to the finding's premise: a malformed token cannot reach this path. `getCurrentUser`
> runs the strategies through `Promise.allSettled` with `required: false`, so a bad JWT resolves to
> `undefined` rather than throwing. A user-supplied `isAllowedToConnect` is the reachable trigger,
> which is what the test drives.

`src/websocket/services/websocket.service.ts:122-152`

```ts
this.socketServer.use(async (socket, next) => {
    ...
    const currentUser = await this.authService.getCurrentUser(context, this.authService.strategies, false);  // 131
    if (!await this.options.isAllowedToConnect(currentUser)) { ... }                                          // 136
    try { ... } catch (error) { ... }                                                                         // try starts at 141
});
```

Lines 131 and 136 are **outside** the try/catch. Socket.IO does not catch rejections from async
middleware. A malformed token that makes JWT verification throw, a DB outage during user lookup,
or a user-supplied `isAllowedToConnect` that throws ⇒ unhandled rejection ⇒ process exit.
Triggerable by an unauthenticated attacker during handshake.

`:153` — `this.socketServer.on('connection', async socket => await this.onConnect(socket))` is an
async function on an EventEmitter with no `.catch`. `onConnect` → `recoverConnection` (`:174`)
issues two repository queries (`:286-305`) with no try/catch anywhere in the chain.

Framework-wide there is **no `process.on('unhandledRejection')` and no
`process.on('uncaughtException')`**. There is no last line of defence.

### C5. `server.listen()` has no error handler — ~~CRITICAL~~ **FIXED**

> **The half the finding describes closed with the wrong finding.** `start()` now waits for the bind
> before it does anything else — `awaitListening` settles on whichever of `'listening'` and `'error'`
> arrives, and each handler takes the other back off, so a one-shot listener left behind cannot
> answer a later failure by settling a promise that is already settled. `EADDRINUSE` rejects
> `start()`, `afterAppStart` and the *"is running on port"* line are past the wait, and
> `markAppAsStarted` is never reached. Covered by *rejects start() when the port is already taken*
> in `bootstrap.evaluation.test.ts`.
>
> That was built for [04 §1.3b](./04-infrastructure-subsystems.md) — scheduled work must not begin
> before the instance is reachable — which needed the same wait for a different reason and got here
> first. Worth recording, because the C5 heading stayed accurate for months after the code stopped
> matching it.
>
> **What it left open is the sentence the finding actually wrote: *anywhere*.** The bind is one moment;
> the server emits `'error'` for the rest of its life. Node raises one when `accept()` fails, which is
> what a burst that exhausts the process's file descriptors produces — and an `'error'` with no
> listener is thrown rather than delivered, so it reached the `uncaughtException` handler that C4
> added, which logs and deliberately rethrows. **One connection the server could not accept ended a
> process whose open connections were all fine.** Load is exactly when that happens, and exactly when
> it costs the most.
>
> So `awaitListening` hands the server to a lasting handler on its way out, and that one logs and
> returns. The two halves want opposite things from the same event — a failure to start is fatal to a
> process that has not started, a failure to accept is one refused connection — and the moment the
> port is bound is the boundary between them.
>
> **The first attempt installed it in the wrong branch**, which is worth keeping because it explains
> the shape of the method. `listen` binds a numeric port while it is still on the stack, so
> `server.listening` is already true when `awaitListening` is called and the promise below it is only
> ever entered by a bind that *failed* — the ordinary path takes the early return. Installing the
> lasting handler beside the `resolve()` therefore installed it exactly never. It now happens after
> the `if`, reached however the port came to be bound.

`src/application.ts:213-221`

```ts
this.server.listen(port);
if (port === 0) { ... }
GlobalRegistry.markAppAsStarted();
await this.logger.info(`${this.options.name} is running on port ${port}`);
```

No `server.on('error', ...)` anywhere. `listen` errors are emitted asynchronously, and an
`'error'` event with no listener throws. On `EADDRINUSE` the sequence is: `start()` resolves →
logs *"MyApp is running on port 8080"* → process dies with a raw stack trace. `await
app.start(port)` can never be wrapped in a try/catch to handle a bind failure, because the promise
has already resolved.

### C6. Uploaded temp files are never deleted, and are written into `node_modules` — ~~CRITICAL~~ **FIXED**

> **Both halves are closed.** The default is now
> `FsUtilities.getPath(resolveAppRoot(), '.zibri', 'uploads')`, and the cleanup cron's two bugs are
> fixed below.
>
> The directory anchor is the interesting part. The obvious replacement — the os temp directory —
> was rejected on the grounds that during development you want to open the folder and confirm an
> upload actually landed. `process.cwd()` was rejected too, and for a sharper reason: it is wherever
> the command happened to be run from, so `npm run start -w api` in a monorepo resolves the
> repository root, and the same application writes to different places depending on which directory
> someone started it from. `resolveAppRoot` walks up from the **entry module** to the nearest
> `package.json`, skipping `node_modules`, so it lands inside the application regardless of the
> caller's shell. It sits beside `resolveZibriRoot`, which answers the opposite question.
>
> `.zibri/` is one line in `.gitignore`.
>
> **The test stopped measuring this and had to be repointed** (2026-09-07). It injected
> `FILE_UPLOAD_TEMP_FOLDER` from inside a started test server and asserted the result was not under
> `src/`. That was a fair reading until [06 §T1](./06-tooling-ci-and-testing.md) gave every test
> server a scratch directory and had `zibri-testing` override this very token into it — deliberately
> under the project's own test folder, because the first thing anyone does with a failing test is
> look at what it wrote. So the assertion started reporting where the *harness* writes, went red, and
> said nothing about the default it was named after. It reads the factory off `ZIBRI_DI_PROVIDERS`
> now, which is the thing the finding is about, and additionally asserts the folder is under
> `resolveAppRoot()` rather than merely somewhere else. **A test that overrides the value it is
> asserting on can only be green by accident** — this one was, until the override moved.

The original finding, for the record:

`src/di/default/zibri-di-providers.default.ts:103`

```ts
FILE_UPLOAD_TEMP_FOLDER: { useFactory: () => FsUtilities.getPath(__dirname, 'temp') },
```

The default upload directory is inside the installed package —
`node_modules/zibri/dist/cjs/di/default/temp`. Immutable container images and read-only
`node_modules` mounts break outright; otherwise user uploads land in the dependency tree and are
wiped on every `npm ci`.

The cleanup cron had two independent bugs, either of which alone disabled it. Both are now fixed;
they are kept here because the pair is instructive — the second masked the first, so a fix for the
inverted predicate on its own would have changed nothing observable:

**Inverted predicate** — `src/parsing/form-data/form-data-body-parser-cleanup.cron-job.ts:60-65`

```ts
private async hasRecentlyBeenCreated(folderPath: FsPath): Promise<boolean> {
    const cleanupAtMs: number = Number(await FsUtilities.readFile(cleanupAtPath));
    return Date.now() > cleanupAtMs;
}
```

The `.cleanupAt` file stores `Date.now() + cleanupAfterMs`
(`src/parsing/form-data/form-data.model.ts:48-51`), so this returns `true` precisely when the
folder is **expired** — and the caller (`:39-46`) treats `true` as `shouldBePreserved`. Expired
uploads are kept forever; fresh uploads are deleted out from under in-flight requests.

**Broken path** — `:38`
`FsUtilities.getPath(this.tempPath, folder.parentPath, folder.name)`. `Dirent.parentPath` is
already absolute on Node ≥20, and `FsUtilities.getPath` is `path.join`
(`src/utilities/fs.utilities.ts:151-157`), which does not reset on an absolute segment. The result
is `/app/temp/app/temp/temp-abc`. `FsUtilities.rm` early-returns on a path that does not exist
(`src/utilities/fs.utilities.ts:321-326`), so the removal is not even an error — it simply does
nothing.

Nothing is ever deleted, while `:53` logs `removed N out of N folders`: it reports success for
every folder while removing none of them. In production this is unbounded disk growth from
unauthenticated uploads.

A correction to the original write-up. It cited the leaked `temp-*` directories under
`src/di/default/temp/` as being "committed to the repository", and they are not — `git ls-files`
returns nothing for that path and `.gitignore:10` covers it. They are local build artifacts, which
makes them evidence of the bug on a developer machine but not of anything having been committed.
The defect itself is unaffected; the evidence cited for it was wrong.

**Both cron bugs are fixed.** The predicate is now `hasExpired`, named for what it answers, and a
folder with no readable `.cleanupAt` is kept rather than deleted — that state is an upload still
being written. The path is built from `folder.name` alone. Covered by
`http-and-observability.evaluation.test.ts`, which creates one expired and one live folder and runs
the real `onTick` over them.

~~Still open: the default upload directory itself, which remains inside the installed package.~~
Closed since, see the note at the top of this entry.

### C7. One `ZibriApplication` per process — global mutable singletons — ~~CRITICAL~~ **FIXED**

> **Closed**, held by `bootstrap.evaluation.test.ts`. One process can now run applications one
> **after** another. It still cannot run two at **once**, and that is a decision with an argument
> behind it rather than a remainder — see the end of this note.
>
> The defect was smaller than "global mutable singletons" suggests: **the lifecycle was missing its
> last transition.** `OFFLINE → CREATED → INITIALIZED → STARTED → SHUTTING_DOWN → ` nothing. A state
> machine with no way back to where it started is why a second `new ZibriApplication` was refused, and
> the error it produced named a state rather than anything the caller had done. `markAppAsOffline` is
> that transition, and it is accepted only from `SHUTTING_DOWN`, so skipping the teardown hooks to
> reach it is refused by the state machine rather than by each caller remembering.
>
> `shutdown()` discards the DI container with it. That is not cosmetic: `register` replaces the
> *provider* and never the instance cached under it ([05 §D4](./05-di-metadata-and-packaging.md)), so
> a container outliving its application would hand the next one services still holding the previous
> one's connections, timers and sockets. It happens last, once every teardown hook has run against
> them.
>
> **What is deliberately not cleared is everything the decorators registered.** `@Entity`,
> `@Injectable` and `@DataSource` run when their module is first loaded and never again. Those arrays
> being global is not the bug — it is what the decorator model *is* — and emptying them would leave
> the next application with nothing to build from.
>
> Of the four consequences the finding listed, two are now met, one was met by a different route, and
> one was wrong.
>
> **In-process test isolation** is the one that mattered, and it is met:
> [06 §T1](./06-tooling-ci-and-testing.md)'s private-static resets are gone from the framework's own
> harness, which is the same hack a customer was going to have to reproduce. **Embedding inside a
> larger host** works for the same reason — what blocked it was that the host could only ever do it
> once.
>
> **"No clustering story for the HTTP layer" was wrong.** It reads a per-process constraint as a
> scaling one. Clustering is many processes, which the cluster suite has been doing by forking since
> before this was written.
>
> **"No two app configurations in one process" is declined, not deferred**, and the reason is the
> paragraph above about decorators. Two applications at once would share every declaration whatever
> the container did, so separate containers would buy separate instances of one shared set of classes
> — the isolation would be a half-truth, which is worse than the honest refusal. And `inject()` is a
> free function with no parameter saying which application is asking; making it per-application means
> threading a container through every call site, or an async-local one that cannot answer for the code
> that runs outside a request — a cron tick, a subscriber, a module's top level. Building that would
> be a redesign of the decorator and injection model in service of a case no adopter has, while the
> requirement actually behind the finding — an application must be able to *follow* another — is met
> without any of it.

`src/global/global-registry.ts:49-63`

```ts
export abstract class GlobalRegistry {
    private static readonly appData: AppData = { state: AppState.OFFLINE };
    static readonly injectables: DiProvider<unknown>[] = [];
    static readonly lazyInjectables: DiProvider<unknown>[] = [];
    static readonly entityClasses: Newable<BaseEntity>[] = [];
```

`src/application.ts:130` calls `GlobalRegistry.markAppAsCreated()` in the constructor, which throws
on a second `new ZibriApplication(...)` (`global-registry.ts:85-86`). Decorators push into these
static arrays at module load, so merely importing a controller registers it globally and
permanently.

No two app configurations in one process, no in-process test isolation without manually resetting
the DI container and registry, no embedding a Zibri app inside a larger host, and no clustering
story for the HTTP layer.

### C8. WebSockets are single-process only — broadcasts silently drop — ~~CRITICAL~~ **FIXED**

> **Closed**, and covered in full by [04 §1.10](./04-infrastructure-subsystems.md). `WebsocketOptions`
> now takes an `adapterDataSource`, which builds a socket.io adapter on the framework's own
> publish/subscribe transport, so `emit` and `to(room).emit` cross instances. Reconnecting to
> another instance is handled too, though not by socket.io: Zibri replays the persisted messages the
> client missed and rejoins an authenticated user's channels out of the shared data source.
>
> `sendToChannel` with `expectResponse: true` remains local to the sending instance, and the
> secondary O(n) `connections` array is untouched — both recorded in 04 §1.10, and filed as 04 §1.13
> and §1.12. Both are closed since: the array is a map by socket id, and a send waiting for answers
> asks every instance.

`src/websocket/services/websocket.service.ts:74-76`

```ts
private readonly websocketHandlers: Record<string, SocketIOWebsocketHandler | undefined> = {};
private readonly websocketChannels: Record<string, SocketIOWebsocketConnection[] | undefined> = {};
private readonly connections: SocketIOWebsocketConnection[] = [];
```

No socket.io adapter is ever configured (`new Server(app.server, { connectionStateRecovery: {} })`,
`:104`), and `WebsocketOptions` exposes only `timeoutInMs` and `isAllowedToConnect`.
`this.socketServer.emit(...)` (`:526`) and `this.socketServer.to(channel.name).emit(...)` (`:462`)
therefore only reach clients on *this* replica. `connectionStateRecovery` also buffers in the
default in-memory adapter, so a reconnect landing on a different pod recovers nothing.

Secondary: `connections` is a plain array with `.find()` on connect (`:170`) and
`.find()` + `.indexOf()` + `.splice()` on disconnect (`:321-326`) — O(n) per connection event,
O(n²) under churn. At 50k concurrent sockets a reconnect storm melts the event loop.

---

## MAJOR

### M1. Stream error after headers sent throws inside an `'error'` listener — **FIXED**

> **Closed**, held by `streaming.evaluation.test.ts`.
>
> Both copies of the listener now go through one `failStream`, and the whole of the fix is asking
> `res.headersSent` first - which is the question the original code never asked, while doing something
> that is only legal when the answer is no.
>
> **Two situations wearing one shape.** While the head is unsent the response can still become an
> error page: the headers set for a body that is not coming are taken back off and the error goes to
> the handler, exactly as before. Once the head is flushed neither is possible, and the honest thing
> is to stop - `res.destroy()` closes the connection, which is how a caller learns that a body it was
> promised is not arriving. Ending cleanly instead would hand it a truncated file under a `200` and a
> `Content-Length` that no longer matches, which is a corrupt download reported as a successful one.
>
> **The log is the whole of what is left.** No status, no error page, nothing for the error handler to
> do - so the failure is logged with the stream's own error as its cause, and the test asserts the
> cause rather than only the line. Without it a caller reporting a truncated file is a report with
> nothing on the server side to match it to.
>
> The finding's second consequence is what made this an availability defect rather than a logging one:
> the throw landed on the *first* `removeHeader`, so `next(err)` was never reached and nothing ever
> ended the response - one leaked socket per failed download - and the `uncaughtException` handler
> added since the review logs and rethrows, so a single failed download ended the process. Any file
> past one chunk is in this case.

`src/routing/router.ts:567-574` (and identically `:599-604` for HTML)

```ts
res.on('close', () => (result.data as Readable).destroy());
result.data.on('error', err => {
    res.removeHeader(KnownHeader.CONTENT_TYPE);
    res.removeHeader(KnownHeader.CONTENT_LENGTH);
    next(err);
}).pipe(res);
```

`OutgoingMessage.removeHeader` throws `ERR_HTTP_HEADERS_SENT` once the head is flushed. For any
file larger than one chunk, headers are already sent when a mid-stream error occurs (disk I/O
error, S3 socket reset, client abort). The throw happens synchronously inside an `'error'`
listener, so it is not caught by the surrounding `try` in `createControllerInnerHandler` (`:506`)
— it becomes an uncaught exception. Streaming a large download is exactly the scenario that
triggers it.

**Reproduced against plain node while writing the test**, which turned up a second consequence the
original write-up missed. The throw lands on the *first* `removeHeader`, so `next(err)` is never
reached and **nothing ever ends the response**. The client is left holding an open connection until
its own timeout — a leaked socket per failed download, with no error page and no status. Confirmed
output: `headersSent = true`, `removeHeader` throws, uncaught exception code
`ERR_HTTP_HEADERS_SENT`, client aborts on its own timer.

That compounds with the `uncaughtException` handler added since the review
(`application.ts:536-541`), which logs and then deliberately rethrows: a single failed download
now ends the process.

Held by `src/__testing__/evaluation/streaming.evaluation.test.ts`, which asserts both halves — no
uncaught exception, and a response that ends — and covers the HTML copy of the same listener at
`:599-604` separately, so fixing one does not turn the other green.

**Confirmed** against the framework, with the healthy-stream control green: `Cannot remove headers
after they are sent to the client`, thrown at `router.ts:569` and at `:601` for the HTML copy.

The test observes the crash half by *being failed by it* rather than by recording it. That is not a
shortcut — a `process.on('uncaughtException')` recorder was tried first and is dead code under
jest, which intercepts uncaught exceptions ahead of the listener chain (measured: no listeners, no
capture callback, no listener ever invoked). The same measurement says the framework's own
rethrowing handler does not run in tests either. Reasoning recorded in the test-suite README.

### M2. Every JSON response is serialized three times — ~~MAJOR~~ **FIXED**

> **The http half is one line.** `res.type(MimeType.JSON).send(JsonUtilities.stringify(result))`: the
> framework serializes once, with its own replacer, and writes the string. Express still sets the
> content length and the ETag, because `res.json` only ever stringified and then called `send` itself.
>
> **The websocket half is not the same defect, and that is the part worth recording.** socket.io
> encodes the packet it is handed, so it has to be handed something encodable — a `bigint` reaches it
> as a string only because the round trip put one there. Removing it would either change what clients
> receive or throw on the first `bigint`. What was genuinely wasted is *where* it happened: `send`
> normalized per call, and `sendToAll` / `sendToChannel` waiting for acks call `send` once per
> connection, so a broadcast to a thousand clients turned the same message into json a thousand times.
> That is hoisted now — `emitWithAckTo` takes an already prepared payload — and the finding's
> *"in `sendToAll` it runs once per connection"* is what it closed on.
>
> **A helper named for the round trip was written and then deleted.** `JsonUtilities.toJsonSafe` read
> well until its return type had to be written down: `T` is a lie once a `Date` comes back as a
> string, and `DeepPartial<T>` is a different lie, because `DeepPartial<Date>` is still `Date`. The
> honest type is a `JsonOf<T>` mapper, which is a type-level project with a public API ripple, and not
> what a performance finding should drag in. The two call sites say what they do.
>
> Held by *costs one pass rather than three* in `http-and-observability.evaluation.test.ts`. It
> measures both candidate implementations on the machine running it and asserts the request lands on
> the one-pass side of the midpoint between them — a threshold in milliseconds would mean something
> different on every laptop, and this finding is entirely about cost.
>
> It measures the **first byte**, not the round trip, and the first attempt is why: reading a four
> megabyte body back costs about what serializing it did, so the whole round trip carried ten
> milliseconds of the client's own work into a comparison whose two sides were eighteen apart. It
> failed by 1.3ms *with the fix in place*. A json response is written in one piece, so the first byte
> leaves only once the body has been serialized in full — which puts all of the work being measured on
> one side of the clock and none of the transfer.
>
> **And it failed again, on the user's machine, with the fix in place** — 53.2ms against a 51.4ms
> midpoint. The remaining error was the other constant: a request costs a connection, express, the
> middleware chain and the router before any of this, and that was being compared against two function
> calls. The same route with an empty body now measures exactly that, and the comparison is against the
> difference. Twice over, the thing that made this test wrong was a cost that belongs to the machine
> rather than to the implementation — which is the argument for measuring one rather than allowing for
> it.

`src/routing/router.ts:533`

```ts
res.json(JsonUtilities.parse(JsonUtilities.stringify(result)));
```

`JsonUtilities.stringify` uses a replacer function (`src/utilities/json.utilities.ts:28-35`),
which forces V8 onto the slow serialization path and invokes a JS callback for every key. Then
`JSON.parse` allocates a complete duplicate object graph. Then express's `res.json` calls
`JSON.stringify` a third time. For a 1 MB list endpoint that is 3× the CPU and ~2 MB of transient
garbage per request, purely to convert `bigint` to string — which one pass plus
`res.type('json').send(str)` would do. Same pattern in the websocket hot path
(`src/websocket/services/websocket.service.ts:425, 462, 526`), and in `sendToAll` it runs once
*per connection*.

### M3. ~40 metadata lookups and object allocations per request, none precomputed — ~~MAJOR~~ **FIXED**

> **Closed by a registry, and the performance half turned out to be the smaller one.**
>
> There is now a `RouteRegistry` (`src/global/route-registry/route.registry.ts`), the route-shaped
> counterpart of the `ModelRegistry` the framework already had: one entry per controller method,
> holding what its parameters were declared as and what its `@Auth` decorators mean for a caller.
> The router fills it while it registers each route, the websocket service does the same for its
> own, and everything that serves a request - `checkAccess`, `resolveRouteParams`, the `CURRENT_USER`
> and `IS_LOGGED_IN` context tokens, the OpenApi spec - reads the answer back out of it. The request
> path performs no metadata lookups at all now, and the duplicated four the finding names are gone
> with the rest.
>
> **What made it more than a performance fix is that resolving a declaration was never side effect
> free.** It is where `@Auth.skip` beside a check is refused, and where the "Useless @Auth.skip"
> warnings come from. Doing that per request meant an application whose route says two contradicting
> things booted cleanly and served a 500 to whoever called it first, and a warning meant for a
> developer was written once per call instead of once. Both now happen while the route is registered,
> which is the difference between a deployment that can still be stopped and one that is live.
>
> **And the fix could not be applied where the finding pointed.** `router.ts:491` is the natural
> place, but the router is initialized *before* the auth service (`ROUTER` is declared above
> `AUTH_SERVICE` in `zibri-di-tokens.default.ts`, and `onAppInit` runs in token order), so resolving
> a route there read a `defaultAuth` the application had not stated yet - and an unstated default is
> indistinguishable from `'public'`. Every route in the framework would have silently become
> unauthenticated. The service now takes that option in `beforeAppInit`, which is the hook's
> documented purpose and the only ordering guarantee available.
>
> The shallow copy was the live defect and closed with `cloneMetadata`, which is deep for plain
> objects and arrays and passes everything else - classes, factories, validators - on by identity,
> because those are what a declaration points at rather than what it holds. Model properties keep the
> shallow record copy they had: `@Property` builds a class's metadata by reading that record back and
> storing it again, and the class helpers derive one model from another by passing entries straight
> through. The nested sharing between a parent entity and its child is the same defect one layer
> down, and it is not fixed here. Filed as §M22.
>
> Held by `route-metadata.evaluation.test.ts`. The framework's own fixtures had to move first: three
> controllers in `auth.service.test.ts` carry declarations nothing can satisfy, and were registered
> on a running test server.

`src/utilities/metadata.utilities.ts:58-67` — every lookup allocates a clone. Per request:

- `resolveRouteParams` calls `getRoutePathParams` / `QueryParams` / `HeaderParams` / `Body`, and
  then `parseRouteParams` calls **the same four again**
  (`src/routing/resolve-route-params.function.ts:31-34` vs `:68-98`), plus `getRouteCurrentUser`
  and `getRouteCurrentWebsocketConnection`.
- `authService.checkAccess` performs 31 `MetadataUtilities.get*` calls.

All of this is static per route and known at startup; the framework already builds a per-route
closure (`router.ts:491`) that is the natural place to bake it in.

Related: `structuredCloneSafe` (`metadata.utilities.ts:34-39`) is a **shallow spread**, not a
structured clone, despite the name. Nested objects (`allowedStrategies`, `allowedRoles`) are shared
with the route's canonical metadata, so a caller mutating them corrupts routing for all subsequent
requests.

### M4. Auth is re-verified 2–4× per request; the cache meant to prevent it is dead code — ~~MAJOR~~ **FIXED**

> **Both halves closed, neither the way the finding expected.**
>
> *The repeated verification* was fixed while closing [03 §E3/E4](./03-auth-and-security.md) and the
> ownership half of [03 §A2](./03-auth-and-security.md): `resolvePrincipal` resolves the caller once
> per request through `memoized`, a `WeakMap` keyed by the context and then by what the answer depends
> on — the strategy set, and whether the row is re-read or the credential is taken at its word. A
> route with `@Auth.isLoggedIn` + `@Auth.hasRole` + `@CurrentUser` costs one resolution, and the
> audit line naming who was refused costs nothing beyond it.
>
> *The dead cache* was not revived. Those `context.has(...)` guards answer without regard to the
> arguments they were called with, so making the tokens live — which is what closing M5 does — would
> have turned them from unreachable into wrong. They were deleted instead. See M5 for what each one
> would have returned.



`src/auth/auth.service.ts:294-297`

```ts
if (context.has(ZIBRI_REQUEST_CONTEXT_TOKENS.IS_LOGGED_IN)) {
    return context.get(ZIBRI_REQUEST_CONTEXT_TOKENS.IS_LOGGED_IN);
}
```

Nothing in the codebase ever calls `context.get(IS_LOGGED_IN)` outside this `has()` guard, so
`has()` is always false and the token's resolver
(`src/context/request/request-context-token.model.ts:78-95`) is unreachable. Same for `HAS_2FA` at
`src/auth/2fa/two-factor.service.ts:94-95`.

For a route with `@Auth.isLoggedIn` + `@Auth.hasRole` + `@CurrentUser`, the full strategy chain
runs for `isLoggedIn` (`:242`), again for `hasRole` (`:257`), and again in `getCurrentUser` —
three signature verifications and up to three DB queries where one would do.

### M5. Documented request-context behavior never happens — ~~MAJOR~~ **FIXED**

> **Closed by giving the context the one thing it never had: its route.** A http request is routed
> *after* its context exists — the version that decides which handler runs is itself read off the
> context — which is why the matched route could not be a constructor argument and, once
> `new HttpRequestContext(request, res, undefined, undefined)` was written, why nothing ever went back
> to fill it in. `HttpRequestContext` no longer takes those two arguments at all; it takes
> `matchedBy(controllerClass, controllerMethod)`, called by the route handler before the first check
> runs. The websocket path had been passing them all along, so only http was ever affected — which is
> also how the route-aware branches stayed working code rather than rotting.
>
> **The consequence the finding lists last is the one worth naming first.** `@CurrentUser`'s own
> arguments were read for the parameter index and then discarded, so `required` and
> `allowedStrategies` did nothing. A route saying *only a session may identify this user* accepted a
> bearer token, and a handler declaring `user: User` could be called with `undefined`.
>
> **What the finding did not say is that fixing it alone would have introduced a worse bug.** The
> three `context.has(...)` short circuits (M4's dead-cache half) return a token's value *regardless
> of the arguments the call named* — `isLoggedIn(ctx, someStrategies)` would have answered from a
> token resolved for the route's strategies, and `getCurrentUser(ctx, …, true)` would have returned
> the token's value without ever reaching its `required` check. Dead code was the only thing keeping
> them harmless. They are gone; `AuthService.memoized` is the same saving keyed on what the answer
> depends on, and it already covered these call sites.
>
> Removing them also took out a latent deadlock: the CURRENT_USER token resolver calls
> `getCurrentUser`, which read the CURRENT_USER token — safe only because the resolver happened to
> reach that call before its first `await`.
>
> `HAS_2FA` lost its route guard rather than gaining a route. Whether a request presented a valid
> second factor is a fact about the request and the user; a route that accepts only some methods says
> so with `@Auth.require2fa`, which checks them itself.
>
> Held by `request-context.evaluation.test.ts`, which drives two strategies at once so that
> *refuses a credential the route does not accept for @CurrentUser* is about a real second strategy
> rather than a stub.

`src/routing/router.ts:465`

```ts
const context: HttpRequestContext = new HttpRequestContext(request, res, undefined, undefined);
```

This is the only `new HttpRequestContext(...)` call site in non-test code, so `controllerClass` /
`controllerMethod` are never populated by any code path.

`docs/request-context.md:32` states they are *"the matched route, or `undefined` if routing hasn't
resolved yet"* — false; they are `undefined` even deep inside a matched controller method.

Downstream, every consumer takes the wrong branch
(`src/context/request/request-context-token.model.ts`):

- `HAS_2FA` (`:100-102`): `if (!ctx.controllerClass || !ctx.controllerMethod) return false;` —
  **always returns `false`**. `docs/request-context.md:55` documents it otherwise.
- `CURRENT_USER` (`:62-64`): always falls back to all strategies, so
  `@CurrentUser({ allowedStrategies, required })` metadata is silently discarded.
- `IS_LOGGED_IN` (`:82-83`): same — always all strategies, never the route's configured subset.

An enterprise reading these docs would build authorization logic on guarantees the code does not
provide.

### M6. Every 5xx logs as the same message with an empty stack trace — ~~MAJOR~~ **FIXED**

> **Closed**, held by `error-logging.evaluation.test.ts`. The finding bundled three complaints and
> each closed differently, which is the part worth reading.
>
> **The 5xx half was a wrapper, not a logger.** `GlobalError` is no longer what gets logged — the
> error that was actually thrown is, with the stack it was thrown from, so the two fields an
> aggregator groups and fingerprints on carry what happened. The wrapper survives for the one case it
> exists for: a thrown value that is *not* an `Error` has no message and no stack of its own, and
> `GlobalError` is what gives that record a name while keeping the value as a cause.
>
> `stack = undefined` was the load-bearing line and it is worth knowing why. The wrapper's own stack
> points at the error handler, which is noise, so blanking it was right *for the wrapper*. It only
> became a bug because the wrapper was being logged instead of the error. Deleting that line alone
> would have replaced an empty stack with a misleading one.
>
> **The websocket path had the identical defect and the finding did not name it.**
> `websocket.service.ts` built its own `GlobalError` and blanked its stack the same way. Finding it
> took reading for `GlobalError` rather than for the finding — a wrapper defect is per-call-site, and
> this codebase has two entry points into user code.
>
> And reading for `GlobalError` still missed one. A message that reached its route and failed there is
> caught in the route's own handler, not in the `onAny` catch that was fixed, and that handler built a
> plain `new Error('Global Error')`, so no search for the class name found it. Closed 2026-10-14: it logs the
> error that was thrown now, and `websocket-failed-message.test.ts` reads the logged row back for its
> message and its stack.
>
> **The 4xx half did not close the way the finding asked, and the finding was wrong to ask.** Logging
> every client error would put "this might be a concern" on a missing favicon. It split three ways
> instead:
>
> - The client errors that are security events - a refused login, an authorization denial, a replayed
>   refresh token - already reach the record through the audit trail, which
>   [03 §G1](./03-auth-and-security.md) added after this finding was written. They carry a reason a
>   detection rule keys on, which a log line never would have.
> - A **429 was the one gap**: it is a security event in its own right - a run of them is what
>   credential stuffing and scraping look like - and nothing recorded it. `AuditAction.RATE_LIMITED`
>   now does, emitted where the refusal becomes a *response*, so an internal limiter the application
>   absorbs itself (the mail queue waiting its turn raises the same error) stays out of the trail. It
>   cannot double up with the audited action underneath it, because `@RateLimited` sits on the route
>   method: a limiter that trips means the body that would have audited never ran.
> - Everything else is an access log's job, below.
>
> **The access log is new, and off by default.** One `info` line per finished request with method,
> url, status and duration, behind `ZIBRI_DI_TOKENS.ACCESS_LOG`. It also closes the
> `// TODO: track duration on requests`, and it had to be the writer that did: a duration is only
> knowable once the response has closed, which is also after the point where a request that matched
> no route ever had a context to read — so it builds its own `LogRequestContext` rather than deriving
> one, and `LogContextInput` gained a `request` field for that.
>
> **Why off, and why that is not a hedge.** The questions this normally gets enabled for — a 404
> storm, a 400 spike, a route that got slower — are about counts and distributions, and
> `MetricsService` already answers them from `http_requests_total` and `http_request_duration_ms` at a
> cost that does not grow with traffic. What the access log buys is the individual requests rather
> than the shape of them, which is a forensics question worth its cost only while it is being asked:
> the default transports include the database one, which keeps everything from `info` up, so leaving
> this on makes `log` the busiest table in the application. Documented that way in
> [logging.md](../packages/zibri/docs/logging.md), pointing at metrics first.
>
> **Not covered here:** correlation across requests, which is
> [M7](#m7-correlation-ids-are-defined-but-never-used--no-log-correlation-no-tracing--major-fixed)
> and has since closed. An access log line carries the trace of the request that produced it, so it
> joins to the work it caused rather than only to a timestamp.

The original finding, for the record:

`src/error-handling/error-handler.ts:31-33`

```ts
const globalError: GlobalError = new GlobalError(error);
globalError.stack = undefined;
await handleLogging(error, globalError);
```

`GlobalError`'s message is the literal string `'Global Error'`
(`src/error-handling/errors/global.error.ts:8`). `Logger.error` logs `error.message`
(`src/logging/logger.ts:59`), and `errorToLoggedError` sets `stackTrace: error.stack?.split('\n')
?? []` → `[]`, because the stack was just nulled.

In Datadog/Splunk/Sentry every 5xx arrives as `message: "Global Error"`, `stackTrace: []`. Error
grouping, fingerprinting and alert-on-new-error-type are all broken. The real error survives only
as prose inside a `paragraphs: string[]` array
(`src/logging/error-to-logged-error.function.ts:14-38`) — unqueryable and unaggregatable.

Compounding: `handleLogging` (`:103-110`) logs **nothing at all** for `ExternalError`, and every
`HttpError` extends `ExternalError` (`src/error-handling/errors/http.error.ts:8`). A 401 storm or
a 400 spike is completely invisible. There is also no access-log middleware anywhere, and request
duration is an open TODO — `src/logging/logger.ts:85`: `// TODO: track duration on requests`.

### M7. Correlation IDs are defined but never used — no log correlation, no tracing — ~~MAJOR~~ **FIXED**

> **The correlation half is closed**, held by `http-and-observability.evaluation.test.ts` and
> `error-logging.evaluation.test.ts`. Tracing is not, and is not being closed here - see the end.
>
> **A token nobody resolves has no value.** The first attempt read the id through the request context
> token, which is where it already lived - and that turned out to be the finding restated: a lazily
> resolved token exists only once somebody asks for it, so a request that logged nothing had no id at
> all, including on its own response, which is the one place a caller can read it. It is established
> by a middleware now, first thing after cors, and the token only ever reads what is already there.
>
> **One id, four places.** It goes back on the response header, into `LogRequestContext.correlationId`
> so every line of one request carries it, into the body of an error response - a header only helps
> whoever was watching the network tab, and the id has to survive being pasted into a ticket - and
> onto every outbound call the http client makes while a request is being handled. That last one is
> what makes it worth having at all: a call fanning out to three services otherwise produces four sets
> of logs that nothing joins.
>
> **The access log reads it off the request rather than through a context**, for the reason it builds
> its own context: it runs on `'close'`, where there is none. The middleware writing the id onto the
> request headers is what lets those two readers agree - a generated id is indistinguishable from a
> supplied one everywhere downstream.
>
> A header arriving more than once is taken as its first value rather than rejected or joined. A proxy
> chain prepends, so the first is the one the request started with, and inventing a fourth id would be
> the worst of the three answers.
>
> **The tracing half has since closed too, and closing it deleted the correlation half.**
>
> The question that decided the shape was not in the entry: *what is a correlation id, once there is
> a trace?* The honest answer is that the trace id **is** the correlation id under a standard name.
> Both are one value shared by every service handling one logical operation; both join log lines;
> both survive being pasted into a ticket. What a traceparent adds is a span id and a sampling
> decision, which a correlation id has no answer for. Nothing the correlation id did was left
> unserved.
>
> The one argument for keeping both was that a trace context seemed to depend on a tracer being
> configured, and an id that only exists when an SDK is installed is worse than one that always does.
> **That turned out to be an artefact of how it was about to be built.** Generating a W3C context
> needs no tracer at all - it is two random hex strings - so the context is established per request
> the way the correlation id was, and a tracer is a thing that later *attaches spans to a context
> that already exists*. `CORRELATION_ID_HEADER`, the `CORRELATION_ID` request context token and
> `correlationId` on the log context are gone; `traceId` and `spanId` replace them, the response
> carries `traceresponse`, and an error body carries `traceId`.
>
> The M7 block of `http-and-observability.evaluation.test.ts` asks the same five questions of
> `traceparent` that it used to ask of `x-correlation-id`, which is the check that this is a rename
> rather than a removal: continued from the caller, started when none arrived, named in the error
> body, handed to an outbound call, and handed on even when the caller supplied nothing. What it
> echoes is the trace id rather than the whole header, because the span id beside it is new per
> request and two requests of one trace would otherwise look unrelated.
>
> **The rule worth keeping: before adding a second identifier, check whether the first one is the
> new one under an older name.** Two ids naming one request is not redundancy that costs nothing -
> it is two things to search by, two to propagate, and two that can disagree.
>
> **What is traced.** A request it answers, a call it makes, every driver read and write, a websocket
> message, a cron tick, a pass over the email queue, a backup and a restore. Background work gets a
> trace of its own rather than hanging under whatever was running - a tick that fired while a request
> was in flight is not part of that request. Span names come from what is written in the source (a
> route template, an operation, a job name), never from what arrived, for the reason the metrics
> service labels by route template: a backend keeps every distinct name it has seen.
>
> **The data source is traced at the driver rather than at the repository, and that is the load
> bearing choice.** A repository operation is not one store operation - an update is a write plus the
> read that proves it landed - so tracing above the driver would have hidden exactly what §M12's
> round was about. It is also one seam against fourteen: `this.driver` is assigned in one place, so
> the wrapper cannot drift as the repository grows.
>
> **A defect the tests found, which reading could not have.** With no SDK configured the api hands
> back a *non-recording* span - and its context is not empty, it is **the parent's context
> unchanged**. So a child span reported its parent's span id, and two pieces of work became
> indistinguishable in the logs. The all-zeroes case was handled and the identical-to-parent case was
> not, because the api documents the first and only implies the second. The adapter now treats both
> as "no span was made here" and gives the work an identity of its own.
>
> **What is deliberately not traced.** Cache reads and writes, because what they cost is already
> reported per cache and per operation - hit rate, store duration, source duration - and sixteen call
> sites across fifteen files buy a position in the trace and nothing else. And the work a thread job
> does, because it runs in a worker thread, which shares no async context with the thread that queued
> it; propagating into a worker is its own piece of work rather than a line of this one. Filed as
> §M24.
>
> **`db.system` is absent on purpose**: neither the data source nor the driver interface exposes which
> store it is, and adding a member to either is a breaking change to a public interface for one
> attribute. The span names the operation and the entity, which is what a reader groups by.
>
> **Where spans go was rebuilt a round later**, on the question *why is this not shaped like
> metrics?* The first version pushed to an OTLP collector by default, over `OTEL_EXPORTER_OTLP_ENDPOINT`,
> defaulting to `http://localhost:4318`. So every deployment that had never heard of a collector made
> an export attempt every few seconds that nothing answered, and both SDK packages were mandatory to
> boot. The metrics service had answered the same question differently years earlier: keep a bounded
> amount in memory, let the application expose it if it wants to.
>
> Tracing is now the same shape. Spans go into an `InMemoryTraceBuffer` of a thousand records, read
> back through `ZIBRI_DI_TOKENS.TRACE_BUFFER` and returnable straight from a controller -
> `TraceSpanRecord` is declared with `@Property` like `Metric` is. An exporter is one provider:
> `TRACE_EXPORTER` holds nothing by default, and `otlpTraceExporter({ url, headers })` is what a
> deployment with a collector registers. `@opentelemetry/exporter-trace-otlp-http` left the scaffold's
> install with it.
>
> **And it is configured in the application rather than in the environment.** The first version read
> `OTEL_EXPORTER_OTLP_ENDPOINT` and set `OTEL_SERVICE_NAME` from `app.options.name` by writing to
> `process.env` - configuration by side effect on a global, in a place none of the application's own
> settings live. The url and the headers are arguments now, and the service name is taken from what
> the application already calls itself: two names for one service is two things to keep in step. The
> resource that carries it is built only when something exports, so `@opentelemetry/resources` is
> asked for only by an application that sends its spans somewhere.
>
> **The opposite answer to the other half of the question, and the reason is worth keeping: traces
> cannot be scraped.** Metrics are pull-able because a snapshot is bounded current state - scrape it
> twice and nothing is harmed, miss one and the counter is still cumulative. A span is an event: the
> set of them between two scrapes is unbounded, each is unique, and one that is missed is gone. OTLP
> is push-only, no tracing backend polls an application, and the only pull thing OpenTelemetry ships
> is a Prometheus *metrics* exporter. An endpoint serving spans would feed nothing that exists.
>
> **Measured rather than assumed, because the buffer is not free** (200k spans, warmed, with the
> attributes a request span actually carries): 1,792 ns and 862 bytes to record and keep one, against
> 705 ns for a span the sdk builds and drops and 24 ns for the api's noop. At a handful of spans per
> request that is single-digit microseconds and a few kilobytes per request, and the memory is
> bounded by the count rather than by traffic.
>
> **The measurement found something worse than what it was measuring.** `generateTraceId` and
> `generateSpanId` were two `randomBytes` calls, at **4,331 ns per span** - more than recording the
> whole span costs, and paid on every request whether or not anything records. They cut from a pooled
> `randomFillSync` block of 512 ids now: **93 ns**, 46 times cheaper, the same generator read in
> larger pieces. *A cost inside the thing being measured is the one nobody measures.*

The original finding, for the record:

`src/context/request/request-context-token.model.ts:51-57` defines `CORRELATION_ID` and
`src/di/default/zibri-di-providers.default.ts:119` defines the header name. Nothing consumes it.
`LogRequestContext` (`src/logging/log-context.model.ts`) has no correlation field. The HTTP client
does not propagate it. It does not appear in error responses.

There is no OpenTelemetry integration and no tracing hooks of any kind. For a company with an
existing observability stack, requests cannot be traced across service boundaries — and the
token's existence makes it look solved when it isn't.

### M8. All auth errors are swallowed; a database outage looks like a 401 — ~~MAJOR~~ **FIXED**

> **Closed, and mostly not on purpose.** All three bare catches are gone: `isLoggedIn`, `hasRole` and
> `belongsTo` were rewritten into `resolvePrincipal`/`readPrincipal` while closing
> [03 A3/A4](./03-auth-and-security.md), and nothing along that path catches any more. A user store
> that is unreachable now throws, which reaches the error handler as a 5xx and — since
> [M6](#m6-every-5xx-logs-as-the-same-message-with-an-empty-stack-trace--major-fixed) — is logged as
> the error it actually is.
>
> The `has2fa` half *was* deliberate, and it is the one that kept its shape: it still catches, because
> a second factor that does not validate is a legitimate `false`. What changed is that it records
> `AuditReason.ERROR` rather than dropping the distinction, so a key nobody could decrypt and six
> digits typed wrong are no longer the same event.
>
> Worth noting for the record that this closed as a *side effect* of an unrelated rework, and nobody
> checked it off. It was found by re-reading the code before starting on M6 — which is the argument
> for re-reading a finding before believing its heading.

The original finding, for the record:

`src/auth/auth.service.ts:299-305` (identical at `:314-320` `hasRole`, `:336-341` `belongsTo`)

```ts
try { return await PromiseUtilities.anyValueTrue(strategies, s => s.isLoggedIn(context)); }
catch { return false; }
```

Bare `catch`, no logging. When the user database is unreachable, every authenticated request
returns `401 "You need to be logged in to access this route."` and **nothing is logged** (see M6 —
401 is an `ExternalError`). Support sees a flood of user reports; the logs are silent; the actual
incident is invisible. This is the single worst debuggability property in the codebase.

`TwoFactorService.has2fa` has the same shape, and it was caught doing exactly this while closing
[03 C1](./03-auth-and-security.md#c1-totp-secrets-are-stored-in-plaintext--major-fixed): once the
TOTP secret became an encrypted property, a replica that could not decrypt it threw from inside
`validate` - and the caller reported a **wrong code**. A key nobody could use and six digits typed
wrong are not the same incident, and the only thing that distinguished them was that the test
happened to have a control asserting the other replica *should* accept.

### M9. No 403 — authorization failures return 401 — ~~MAJOR~~ **FIXED**

There is no `ForbiddenError` in `src/error-handling/errors/`. `src/auth/auth.service.ts:259` throws
`UnauthorizedError` (401) for a role-check failure. Every standard HTTP client, SPA auth library
and API gateway treats 401 as *"credentials invalid, refresh the token and retry"*, so an
authenticated user lacking a role triggers an infinite token-refresh loop. Also missing: 405, 406,
503.

**The 403 half is fixed.** `ForbiddenError` exists, and the three `checkAccess` branches that refuse
a caller the framework *did* identify — `hasRole`, `belongsTo` and `isNotLoggedIn` — throw it rather
than `UnauthorizedError`. Asserted against a real revoked role in
`src/__testing__/evaluation/auth-sessions-and-2fa.evaluation.test.ts`, which holds a token that
opened the route a moment earlier: the same token now answers 403, so the status is about the role
and not about the credential.

`isLoggedIn` and the `requireLogin` default stay 401 — nobody was resolved, so a credential really is
what is missing. `require2fa` stays 401 too, and that one is a judgement rather than a consequence: a
caller who has not sent a second factor still has one to send, which is the request-for-a-credential
case 401 is for and the reading [RFC 9470](https://www.rfc-editor.org/rfc/rfc9470.html) gives step-up
authentication. The refresh-loop argument above does apply to it, so the trade is live — the OTP
travels on its own header rather than an `Authorization` scheme, and the framework emits no
`WWW-Authenticate`, so the 401 carries no challenge a client could act on. Revisit it if a client is
observed looping.

The websocket handshake splits the same way: `isAllowedToConnect` refusing an anonymous caller is
401, refusing a resolved one is 403. Note the knock-on in
`src/websocket/services/websocket.service.ts` — a 401 from an event disconnects the socket, so a role
failure over a websocket no longer tears down a connection whose credential was never in question.

Of the three statuses the last sentence above also called missing, 503 has since arrived
(`service-unavailable.error.ts`). 405 and 406 have not — carried out as
[M14](#m14-405-and-406-are-never-produced) rather than left as a footnote on a closed finding.

### M10. Multipart parsing has no part/file count limits; 413 arrives as a connection reset — **FIXED**

> **Closed**, held by `http-and-observability.evaluation.test.ts`.
>
> **A body is bounded twice now, because bytes and parts are different costs.** Busboy is constructed
> with `files`, `parts` and `fields` from `ZIBRI_DI_TOKENS.FORM_DATA_LIMITS`. It reports a limit by
> stopping and saying so rather than by failing - past `files` it simply stops emitting file parts -
> so each of the three `*Limit` events is listened for. Left unhandled the body would have parsed as
> whatever happened to fit, which is a truncated request answered as though it were complete.
>
> **Three of the five limits the finding implies do not belong here, and finding out why turned up a
> second defect.** `fieldNameSize` is in `@fastify/busboy`'s type definitions and is never read - the
> source still carries `// * support limits.fieldNameSize` as a TODO - so shipping it as an option
> would have been a lie in the api. `fieldSize` is worse: it is not unbounded, it defaults to one
> megabyte, and a field over it is **truncated rather than refused**. The handler is handed a value
> that is not what was sent, the body's own byte counter measures the already-shortened value and
> notices nothing, and no error is raised anywhere. That is a live defect nothing in the review names.
>
> It is now set to the body's whole `maxSize`, so busboy cannot truncate before the cumulative counter
> refuses, and `nameTruncated`/`valueTruncated` are checked on every field anyway - the alternative to
> raising a truncation is trusting silence. There is no per field size option, because a field's bytes
> are already inside the body's budget and how long one value may legitimately be is a question about
> that field: `@Property.string({ maxLength })` answers it where the field is described.
>
> **Where the limits live took a second pass.** They started as one application-wide token, which put
> the size of a body on `@Body` and the shape of it somewhere else - an endpoint could not say what it
> accepts in one place, and a gallery endpoint taking fifty images would have had to raise the ceiling
> for every other endpoint too. `FormDataBodyMetadata` now carries `limits`, merged over the token, so
> the token is what an application states once and the option is what one endpoint states for itself.
> Resolved in the parser rather than in the decorator, because a decorator runs at module load and
> there is no container to ask yet.
>
> **The reset half was a destroy in the wrong order.** Refusing a body called
> `stream.destroy(new ContentTooLargeError())` on the request, and the json parser called
> `req.destroy(...)` - both take the socket down with them, so the 413 the error handler then wrote
> had nowhere to go. The caller saw an `ECONNRESET`, could not tell "too large" from a dropped
> network, and retried, which is the worst answer available. Both now stop reading and leave the
> request alone; node closes the connection itself once the response has been written over a body
> nobody finished reading.
>
> Worth knowing why the existing `rejects a request exceeding the overall body size budget with a 413`
> in `form-data.body-parser.test.ts` was green throughout: its body is a kilobyte, so it has entirely
> arrived before the refusal, and destroying a request that is already complete costs nothing. The
> reset only ever happened to a body still on the wire, which is why the case here sends four
> megabytes.

`src/parsing/form-data/form-data.body-parser.ts:259`

```ts
const bb: Busboy = Busboy({ headers: { 'content-type': contentType ?? 'string' } });
```

No `limits` object at all — no `files`, `parts`, `fields`, `fieldNameSize`, `fieldSize`. The only
guard is a cumulative byte counter. An attacker sends 100,000 one-byte file parts: each spawns a
`createWriteStream` (`:302`) and pushes to `filePromises` (`:355`) ⇒ 100k concurrent open file
descriptors ⇒ `EMFILE` ⇒ the process can no longer accept sockets. Total bytes stay under the
limit.

Separately, size-limit enforcement destroys the socket instead of responding —
`stream.destroy(new ContentTooLargeError())` (`:316`), and `req.destroy(...)` in
`src/parsing/json/json.body-parser.ts:81`. The client gets `ECONNRESET`, never the 413, and cannot
distinguish "too large" from a network failure — so it retries.

### M11. Missing baseline enterprise HTTP capabilities — ~~MAJOR~~ **PARTIALLY FIXED**

> **Nine rows, four outcomes.** The table below is annotated in place. What is worth reading here is
> that they did not all close the same way, and one of them was never open.
>
> **ETag was half right for the wrong reason, and the test that was meant to prove the row wrong
> found the real defect.** The finding checked whether the framework reads `IF_NONE_MATCH`, found
> nothing, and concluded the feature was absent. Express reads it — inside the `res.send` every
> response goes through — and generates the validator too. The `304` it should then produce was
> nonetheless impossible, because the router lowercased `request.method` and express's freshness
> check compares against `'GET'`. So the row was right about the outcome, wrong about every step
> leading to it, and the cause was filed as a MINOR two sections down about *third-party*
> middleware. See that entry; it is fixed there, and it took a HEAD answered with a body along with
> it.
>
> **Compression was built rather than installed.** The reference implementation is one dependency
> away, and it was declined on a ground worth recording: its types come from a hand-written
> DefinitelyTyped `.d.ts`, so every step into it lands somewhere that is not the code being run, and
> this repository has spent real effort on the opposite. `compressionMiddleware` takes over `write`
> and `end` the same way the reference does, and for the same two reasons — everything that answers a
> request goes through them, and express computes the ETag inside `send`, which runs first, so the
> validator stays a fact about the body rather than about the encoding it happened to be sent in.
>
> Which types are worth encoding is a `Set<MimeType>` rather than a regular expression over the
> header. `text/event-stream` is the entry that explains the rest: it compresses well and must never
> be encoded, because an encoder holds bytes back until it has enough to be worth writing, and an
> event nobody receives until the next one arrives is the one thing a stream of events must not do.
>
> **Taking over `write` cost the encoder every response longer than it holds at once, and a browser
> is what found it.** Whatever pipes into a response stops when a write is refused and waits for the
> response to say it may continue. With the encoder in between, a refused write is the encoder being
> full rather than the socket, so the response had no `drain` of its own to give: the transfer stopped
> partway and the request never ended. Every test covering compression sent a body written in one
> piece, which is the one shape that cannot reach it. Opening the explorer asks for a 2.6 MB
> `swagger-ui-bundle.js` beside two other assets of that size, and a page whose scripts never arrive
> is a page that loads forever. The encoder's own `drain` is passed on to the response, and
> `compression.middleware.test.ts` covers both shapes the framework answers a large body with — a file
> on disk through `res.sendFile`, and a stream piped into the response — for gzip, for the brotli a
> browser actually negotiates, and for a client that reads neither.
>
> **Turning it on changed what two other tests measure**, which is the part that generalizes. M2 times
> how long a response takes to serialize, and an encoder in front of it is a second thing being timed;
> M1 is about a stream failing *after* its head is out, and an encoder holds the head back until it
> has a first chunk to write. Both now state `accept-encoding: identity`, which is the honest fix:
> each was about the unencoded path all along and had simply never had to say so.
>
> **Timeouts are configured.** `HTTP_SERVER_TIMEOUTS` narrows node's five minutes and one minute to
> sixty and fifteen seconds, and `keepAliveInMs` is node's own default restated so a deployment can
> raise it above whatever proxy sits in front. A headers timeout longer than the request timeout is
> refused at startup, since the narrower of the two would never fire.
>
> **Per-route timeouts turned out to need a fourth application wide one first, and the reason is the
> thing worth recording.** All three of the timeouts above bound the *client*: node clears
> `requestTimeout` the moment the request stream ends, which for a `GET` is as soon as its headers
> have arrived, and `server.timeout` — the socket inactivity one that might otherwise have covered it
> — has defaulted to disabled since node 13. So a handler awaiting something that never answers was
> bounded by nothing at all, on a server whose timeouts a test had already checked. `handlerInMs` is
> the fourth field, it defaults to thirty seconds, and it is `number | 'none'` so that a deployment
> can say once that it wants deadlines only where a route asks for one.
>
> **A route declares its own the way it declares its versions**, because that mechanism was already
> there and correct: `timeoutInMs` on the http decorator options, on `@Controller`, and as a field on
> a manually registered route's configuration. Route over controller over application, resolved with
> `??` rather than a truthiness check — a route that declared `'none'` has said something, and `0` is
> not a meaningful deadline anyway. A separate `@RequestTimeout` decorator was the alternative and was
> declined for what this document has called the *two ways to say one thing* problem: `versions`
> already rides the options and nothing about a deadline is different.
>
> **What a fired deadline does is the part that cannot be made to sound better than it is.** A promise
> cannot be cancelled and whatever a handler is waiting for does not know it is being waited for, so
> the framework answers 504 and drops the handler's result. The handler keeps running. What makes that
> an honest feature rather than a lie is `context.signal`: an `AbortSignal` that fires at the deadline
> and that a handler passes on to the query or the http call actually doing the waiting. It sits on
> `BaseContext` rather than on the http one, so a service several frames below a handler reads it the
> same way whatever it was reached from.
>
> **Websocket messages then got the same deadline, and one thing http does not have.** `timeoutInMs`
> on `@WebsocketRoute` and `@WebsocketController` over a `handlerInMs` on `WEBSOCKET_OPTIONS`, and an
> overrun is answered on the socket with the `ok: false` shape the protocol already carries, at 504.
> What is different is the disconnect: **a http handler whose caller hung up at least has a response
> that fails to write, while a message handler has nothing that would ever notice**. So the service
> holds the contexts of the messages it is handling and fires them from `onDisconnect`, and the error
> path checks `clientGone` before trying to answer a socket that is already closed. An event
> declaring `'none'` whose client leaves is the case that had no bound at all.
>

> **The signal is only worth having if something listens, so the framework's own waits do.** Three
> of them, found by scanning for code that waits inside a request: the http client combines the
> request's deadline with its own `timeoutMs` through `AbortSignal.any`, so the shorter of the two
> ends the call and the connection to the upstream is let go rather than read and thrown away; a
> `'wait'` mode lease stops queueing instead of contending for a grant it would take and hand
> straight back; and `waitForThreadJob` stops waiting, which matters most of the three because it
> polls a row every interval and a thread job is given an hour by default. **None of the three is an
> option a call passes.** A deadline is a fact about the request the call is running inside, and an
> option threaded through every call site is an option the call sites that matter will forget - so
> they read `AlsUtilities.findCurrentRequestSignal()` themselves.
>
> **Stopping the wait is not stopping the work, and the thread job is where that distinction is the
> point.** The job keeps running and still records what it did; what ends is one caller's interest in
> the answer. The lease and the upstream call are the other way round - there is nothing left to
> finish - which is why only the job needed saying.
>
> **Everything that gives up fails with the deadline's own error.** `deadlineExceeded` aborts with
> the `GatewayTimeoutError` as the abort reason rather than with nothing, so an abandoned lease wait
> and a let-go upstream call both report the one thing that happened instead of each inventing an
> error of its own. It also made the abandoned-work log honest: a handler that passed the signal on
> now throws the deadline back out, and logging that at error level would put an error beside every
> timeout that worked exactly as intended. `isDeadlineComingBack` walks the `cause` chain for the
> abort reason and stays quiet when it finds it, so what is still logged is a handler that failed for
> a *second* reason after the first.
>
> **`PromiseUtilities` grew the two pieces this needs**: `withSignal`, which stops waiting for a
> promise without pretending to stop the promise, and an optional outer signal on `withTimeout` that
> is combined with its own timer. The listener is taken off again in a `finally` - one request's
> signal is read by everything that request waits for, so a listener per wait leaks on exactly the
> requests doing the most work, and there is a test that counts them.
>
> **Left alone, and why.** The rate limiter's lock retries hold a critical section and are bounded by
> an attempt count, so ending one mid-update trades waste for inconsistency. Event hooks already
> carry their own per-attempt signal and are not request work.
>
> **The database closed in two halves, and only one of them is store specific.**
> `DeadlineAwareRepositoryDriver` sits outside the traced driver and refuses an operation whose
> request is already over - store agnostic, one file, and it covers where most of the waste actually
> is: a handler runs several queries and the deadline lands between two of them. It is outside the
> tracing rather than inside on purpose, so an operation that never reached the store leaves no span
> claiming it did. A stream is checked per row rather than once, since outlasting a single answer is
> what a stream is *for*.
>
> **The other half is a statement that is already running, and there the honest answer was to ask
> the server.** The connection running a statement is busy running it, so there is nothing on it to
> ask with until it is finished - which is the moment it would no longer be needed. So the backend's
> own id is read off the connection and `pg_cancel_backend` is sent on a *different* one. To have an
> id to read, the operation has to own its connection rather than let the orm take one per statement
> internally, which `onConnection` does - **and only inside a request on a store that can cancel**,
> so nothing outside one pays for a capability it would never use.
>
> **The race this design exists to close**: release the connection first and the cancel is still on
> its way to a connection the pool has already handed to somebody else, where it would stop *their*
> statement. So the pending cancel is awaited before the release, and the listener comes off before
> that. A cancel that fails is not reported - the statement it was aimed at has either stopped or
> finished, and the caller is being told about whichever.
>
> **The first version left a transaction alone, on the reasoning that failing somebody else's
> transaction was not this feature's call to make - and the container run proved that wrong twice
> over.** It failed to cancel anything at all, because a repository takes a transaction of its own
> for any write a caller did not supply one for: `updateAll` reaches the driver with a transaction
> every time, so the branch that skipped transactions skipped essentially every write. And the
> reasoning behind the boundary does not survive being looked at either. A blocked statement inside
> a transaction is *worse* than one standing alone - the connection is held and so is everything the
> transaction has locked, until whatever it is queued behind lets go - and the request it belongs to
> has already been answered, so nothing it writes is going to be read. Stopping it fails the
> transaction, which is exactly right: the rollback is what frees the rows. So a transaction's own
> connection is what gets the cancel now, and only a statement standing alone has one taken out for
> it. `stream` is still left on the old path - a cursor lives longer than one statement, and the per
> row refusal already bounds it.
>
> **The same run found a second one: the logger was injected where the failure is written.** Work
> that has been abandoned outlasts the request by definition, and it can outlast the application -
> a suite tearing its server down between files is the ordinary way to see it. The container was
> empty by the time the report ran, so reporting the failure failed. It is taken while the request
> is still running now.
>
> **`canCancelStatements` was a boolean field for one revision and became a type guard.** The field
> forced a base method that threw and never used its parameter, which is the shape of a capability
> being declared in two places. `cancelsStatements(store)` asks the question and narrows to the
> answer in the same call, the way `isFileResponse` and `implementsOnAppStart` already do here.
>
> **`Promise.race` drops its loser, and a dropped rejection is an unhandled one.** A handler that
> failed a second after its 504 had been sent would have ended the process, over work whose caller had
> already been answered correctly. The abandoned promise gets a handler of its own that logs at error
> level once the signal has fired — the only record there will be, since the response is long gone and
> the error handler cannot run for it. `stays up when the abandoned handler fails later` is the case.
>
> **The clock covers the handler and stops when it returns**, which is what decides the exemptions
> without anybody declaring one. A stream, a download and a page of server-sent events are all a
> handler returning promptly and a response taking its time, so they are outside a deadline by being
> what they are. Websocket upgrades never reach the router, and static assets are served by
> `express.static` in `ROUTING` rather than through it. The alternative — bounding the response too —
> needs an exemption list keyed on content type, which is the guessing this avoids.
>
> **It records nothing new, deliberately.** The 504 goes through the global error handler, so the
> access log has the status, `logger.error` has an error naming the budget, the request span ends
> `ERROR` because the status is ≥ 500, `http_requests_total` counts it under `status_code=504`, and
> the body carries the `traceId`. A dedicated counter would have been a slice the existing one already
> produces.
>
> **Two rows stay open, and one of those is deliberate**: HTTP/2 is not built; in-process TLS is where
> the C3 readiness half ended up — the deployment terminates it, and a framework that reads
> certificates is a framework that has to reload them. **Tracing has since closed with M7**, which is
> where it is written up.

Verified absent across `src/` (excluding tests):

| Capability | Status |
|---|---|
| ~~Response compression (gzip/brotli)~~ | **fixed** — `compressionMiddleware`, brotli preferred, from a kilobyte, by mime type |
| ~~ETag / `If-None-Match`~~ | **fixed elsewhere** — express computes the validator and reads the header; the `304` was unreachable because the router lowercased `request.method`. See the MINOR entry on that |
| HTTP/2 | absent — `src/application.ts:1` imports `node:http` only |
| HTTPS / in-process TLS | absent, and **left there**: the deployment terminates it |
| ~~`requestTimeout` / `headersTimeout` / `keepAliveTimeout`~~ | **fixed** — `HTTP_SERVER_TIMEOUTS`, narrower than node's defaults, validated against each other |
| ~~`maxHeadersCount`~~ | **fixed with §M23** — `maxHeaderCount` (100) and `maxHeaderSizeInBytes` in `HTTP_SERVER_LIMITS`, over either answered 431 |
| ~~Per-route request timeouts~~ | **fixed** — `timeoutInMs` on a route, a controller or a manually registered route, over `handlerInMs`; 504, and an `AbortSignal` the http client, the lease wait and the thread job wait read themselves |
| ~~`trust proxy`~~ | **fixed** while closing C1 — `security.trustProxy`, and `req.secure` is what the HSTS decision reads |
| ~~Clustering / worker support for HTTP~~ | **fixed** with C7 — a process can run applications one after another, and the cluster suites run replicas |
| ~~OpenTelemetry / tracing~~ | **fixed with M7** — the framework owns `TracerInterface` and traces itself through it; `OpenTelemetryTracer` sets up the SDK and is registered by default |

~~The `trust proxy` gap has a concrete consequence: `src/application.ts:106` trusts
`X-Forwarded-Proto` unconditionally for the HSTS decision, while `src/logging/logger.ts:90` uses
`req.ip` — which without `trust proxy` is the load balancer's address, so `clientIp` is identical
for every request behind any ingress.~~ **Both halves fixed with C1**: `security.trustProxy` is a
declared option, the HSTS decision reads `req.secure` (which honours it) rather than the header
directly, and `clientIp` is the caller's for as many hops as the option allows.

### M12. Middleware ordering is implicit and undocumented — ~~MAJOR~~ **FIXED**

> **The order is now something a middleware asks for rather than something that happens to it.**
> `MiddlewarePhase` names six positions, `app.use(handler, phase)` takes one, and the pipeline is
> assembled in a single pass inside `start()` — sorted by phase, stable within one. When a middleware
> registers stopped meaning anything.
>
> **The sequence below understated it in one place.** Steps 3 and 5 are not one position each: the
> framework's own request log, request metrics and static asset handler all register from `onAppInit`,
> so their order relative to each other was **the order the di container happened to instantiate the
> services holding them**. Nothing chose it and nothing recorded it. They are `OBSERVABILITY`,
> `OBSERVABILITY` and `ROUTING` now, which also states the reasoning: measuring a request should span
> everything below it, and serving a file is answering the request rather than preparing it.
>
> **The cookie complaint closed by moving one line into a phase.** Parsing was registered *after* the
> `onAppInit` hooks purely because the signing secret is a di token and that is the first moment there
> is one to read — a fact about construction that had become a fact about the request pipeline. It is
> `PARSING` now, ahead of `BEFORE_ROUTING` where a project's own middleware goes, so "a middleware
> needing parsed cookies must not use `onAppInit`" is not a rule anybody has to know.
>
> **"Nothing registered after `start()` can ever run" became an error rather than documentation.**
> Express appended it behind the handler that answers every unmatched request, so the middleware was
> accepted, unreachable, and silent about both. `use()` throws once the pipeline is assembled.
>
> **The `any` is gone**, and one overload went with it. `use(...args: any[])` covered five shapes;
> what replaced it is two, `(handler, phase?)` and `(path, handler, phase?)`. The one deliberately
> dropped is `use(errorHandler)`: an application has exactly one error handler, it is already named by
> `ZIBRI_DI_TOKENS.GLOBAL_ERROR_HANDLER`, and a second way to register one that chained instead of
> replacing is the *two ways to say one thing* this document has rejected four times. It is the
> pipeline's fixed last layer now, which is what it always was in practice. `ERROR_HANDLING` was a
> seventh phase in the first draft and came out with it — a phase nothing can be registered into is a
> position, not a choice.
>
> **What changed behaviour beyond ordering:** an access log now records requests for static assets,
> which it did or did not before depending on di order. `docs/application-lifecycle.md` carries the
> table.

There is no middleware-registration API with ordering. Order is an emergent property of the boot
sequence:

1. `corsMiddleWare` — `src/application.ts:80`, field initializer, always first
2. security-headers middleware — `src/application.ts:101`, constructor
3. anything registered from a `beforeAppInit` / `onAppInit` hook (e.g. `src/metrics/metrics.service.ts:92`)
4. `cookieMiddleware` — `src/application.ts:174`, *after* `onAppInit`
5. anything from an `afterAppInit` hook
6. the router — `src/routing/router.ts:133`, from `onAppStart`
7. 404 catch-all, then the global error handler — `src/application.ts:211-212`, inside `start()`

So a middleware needing parsed cookies must not use `onAppInit`, and nothing registered after
`start()` can ever run. None of this is in `docs/application-lifecycle.md`. The escape hatch is
itself untyped — `src/application.ts:143-147`: `use(...args: any[]): void`.

### M13. Manually registered routes bypass the auth system entirely — ~~MAJOR~~ **FIXED**

> **Closed**, held by `manual-routes.evaluation.test.ts`.
>
> `RouteConfigurationInput` takes an `auth` field carrying the metadata the decorators produce, and
> `createManualRouteInnerHandler` checks it in the same position `createControllerInnerHandler`
> checks its own - first, before a single parameter is parsed.
>
> **What a route *says* differs; what saying it means must not.** The two paths meet at
> `requiresLoginGiven`, which decides the login gate from the resolved metadata and one boolean, and
> at `runChecks`, which runs the four checks in order. Only *where the default applies* is read
> differently: off the class for a decorated route, off `skip` for a configuration object. Growing a
> second implementation beside `checkAccess` would have made a route's protection depend on which of
> the two ways it happened to be written down, which is the finding one level up.
>
> **A route that states nothing states something.** It gets exactly what an undecorated controller
> route gets - the application's `defaultAuth` - so the option's guarantee no longer has a hole in it.
> That is the safe default rather than a required field, because unlike
> [03 A1](./03-auth-and-security.md#a1) there is already an application-wide answer to inherit; a
> route that has to answer anonymously says `skip: true`.
>
> **The framework's own routes now state their posture.** `/favicon.ico` says it is public: a browser
> asks for it on its own, before any login exists to send, and a 401 there is a broken tab icon on the
> login page of an application that did everything right.
>
> **The OpenAPI surface says it is public too, which reverses this note's first answer.** It inherited
> `defaultAuth` at first, on the reasoning that an application declaring `requireLogin` should not
> publish a map of its endpoints to anyone. That is the right instinct and the wrong mechanism: a
> browser reaches the explorer by *navigating* to it, and a navigation carries no `Authorization`
> header, so under a bearer token strategy the inherited requirement did not produce an explorer only
> the application's callers could open - it produced one nobody could, page, scripts and spec alike.
> Under a cookie strategy the same setting works perfectly, which is why the difference is invisible
> until someone deploys the other kind of api.
>
> So the surface is public by default and `ZIBRI_DI_TOKENS.OPEN_API_AUTH` is where an application says
> otherwise. It takes a whole `RouteAuthConfiguration`, so `{}` puts the docs behind the application's
> default and `{ hasRole: … }` behind a role - which is the thing the finding's second paragraph said
> was impossible for a manually registered route. The hole M13 named was that there was *no way* to
> protect these routes; that is closed either way, and which way to point them is the application's
> call rather than the framework's.
>
> **The spec had the same hole, as a comment.** `resolveOperationSecurity` was called for controller
> routes and left as `// security: ...` for manual ones, because there was no `controllerClass` to
> ask - so a manual route was documented as public whichever way it behaved. It now goes through
> `requiresRouteAuthentication`, the manual-route half of the call
> [03 A1](./03-auth-and-security.md#a1) added for the same reason.
>
> **The static assets mount stays public, and now says so.** `asset.service.ts` also does
> `app.use(assetsRoute, express.static(publicAssetsPath))`, which is not a route at all - it is
> express middleware outside the router, with no request context and nothing to hang a declaration on.
> In a bundled application that path resolves to `dist/assets/public`, so it is the application's own
> `style.css`, `vendor/` and images rather than framework files.
>
> Decided rather than deferred: the folder is called `public`, the boot line calls it *"public static
> assets"*, and a stylesheet the login page needs has to load before there is a login. Gating it would
> make an application that declared `requireLogin` unable to render the page where a caller logs in.
> So the guarantee is stated instead of widened - `docs/auth.md` says `/assets` is outside
> `defaultAuth` and that anything a login should gate belongs behind a route. That is the one place
> where "protected by the default" and "reachable" part company, and it is now written down rather
> than discovered.

`src/routing/router.ts` calls `authService.checkAccess` in exactly one place —
`createControllerInnerHandler` (`:494`) — and `src/websocket/services/websocket.service.ts` in one
more (`:775`). Both are the *controller* path. `registerRoute` builds its handler without ever
reaching it.

A manually registered route therefore has no auth metadata to read and no check run against it.
There is also no way to give it any: `RouteConfigurationInput` carries no auth field, because the
authorization model is decorator-and-metadata based and a config object has no decorators.

Registered this way today, all framework-internal:

- `src/assets/asset.service.ts:60`
- `src/open-api/open-api.service.ts:119, 138, 148, 158, 172, 220, 371` — the whole OpenAPI/docs
  surface

**What this costs, now that [03 A1](./03-auth-and-security.md#a1-endpoints-are-open-by-default-the-framework-never-warns-about-unprotected-routes--critical-fixed)
is closed:** `defaultAuth` does not reach these routes. An application that declared
`'requireLogin'` — i.e. stated that nothing is reachable without a login — still serves its OpenAPI
spec and its assets to anyone. The option's guarantee has a hole in it, and the hole is in the
direction that surprises people: the deployment that took the trouble to lock everything down is the
one that finds out it did not.

It is not only about the default. `@Auth.hasRole(...)` cannot be applied to a manually registered
route at all, so an api that wants its docs behind a role has to put a middleware in front of the
router rather than express it where the rest of its authorization lives. `registerRoute` is public
API, so any application-defined route using it inherits the same gap — this is not confined to the
framework's own routes.

**Shape of the fix:** `RouteConfigurationInput` takes an auth field carrying the same metadata the
decorators produce, and the handler built in `registerRoute` resolves it through the path
`checkAccess` already uses rather than growing a second implementation beside it. The framework's own
asset and OpenAPI routes then state their posture explicitly, the way `JwtAuthController` and
`CookieAuthController` now do.

Found while closing 03 A1, not in the original review: the gap predates it, but nothing depended on
it being closed until `defaultAuth` promised that a route without decorators is not a route without
protection.

### M14. 405 and 406 are never produced — ~~MAJOR~~ **FIXED**

> **Both are produced now, and the interesting part of each is where the answer comes from.**
>
> **405 could not be a layer on the router that holds the routes.** The obvious shape — one
> `all(path)` catch-all per known path, mounted after the real ones — breaks the moment a route is
> registered at runtime, which `registerRoute` supports: the catch-all is already in front of it and
> shadows it. So the 405 lives on a **second express router**, mounted after the first, where it is
> reached only once every real route has declined. Its `Allow` is computed when it is asked rather
> than when it was mounted, so a route added after the port was bound is in the list.
>
> **`OPTIONS` had to go the other way, and for the opposite reason.** Express answers an `OPTIONS` for
> any path some layer matched by generating an `Allow` of its own, and it does that *before* anything
> mounted after the router could see the request — so the only way to be the one deciding is to be a
> route. It is registered on the router that holds the routes, and declines to a route the application
> registered for `OPTIONS` itself. That is a replacement rather than an addition: two rules answering
> one question is how they come to disagree, and a test asserts the `OPTIONS` and the 405 hand back
> the same header.
>
> **One case had to be excluded from the 405.** A manually registered handler may call `next()` to say
> it is not the one after all, which reaches the second router under a method the path *does* have.
> That is a request nothing answered, not a request made with the wrong verb, so it falls through to
> the 404.
>
> **406 is decided from what the route declared, before the handler runs.** `@Response` is already the
> one place a route states what it produces, and it is the statement a generated client is written
> against — deriving a second answer from the handler's return value would let the two disagree, and
> checking at write time would mean a `POST` doing its work and then being refused. A route that
> declared nothing is unconstrained: refusing on a declaration nobody made would turn a documentation
> gap into a runtime failure, and the framework already warns at boot about routes with no declared
> responses.
>
> **The rule that "declared nothing" has to be careful about, found by the user asking what happens
> when there is no `@Response`:** `@RateLimited({ reserveIfUnavailable: true })` pushes a response of
> its own onto the route, marked `implicit`, and it is a **json** one. Counting it would have let a
> rate limit switch on content negotiation for a route whose author never said a word about
> representations — a caller sending `Accept: text/html` refused by a decorator that is about
> something else entirely. Implicit responses are excluded, which is the same test the startup warning
> makes.
>
> Error responses are excluded too, and for a reason worth stating: they describe how a failure is
> reported rather than what the resource looks like, so counting them would make every route that
> documents a 404 acceptable to a caller that can read none of its successful answers.
>
> **The error handler's "neither" branch was left answering json, deliberately** — the one place this
> did not go the way the finding's phrasing suggests. A caller that accepts neither json nor html gets
> the error as json at its real status, because the alternative is refusing the refusal: a 406 in
> place of the actual error leaves whoever is debugging with nothing saying what went wrong. The
> negotiation the finding wanted belongs on the success path, where a representation is actually being
> chosen, and that is where it now is. The branch is explicit rather than incidental now.

Split out of [M9](#m9-no-403--authorization-failures-return-401--major-fixed), which named them in
passing while it was about 403. `src/error-handling/errors/` has no class for either, and nothing in
`src/` constructs one.

**405.** A path that exists under a method it does not support answers 404, so a client cannot tell a
route it got wrong from a verb it got wrong — the case where retrying with a different method is the
fix, and the case where nothing will help. The router knows which of the two it is: it matched a path
and found no handler for the method. The 405 it should send carries an `Allow` header naming the
methods that do exist, which is the part that makes the status actionable rather than decorative.

**406.** Content negotiation never refuses. A request saying `Accept: application/xml` is answered
with JSON at 200, so a client asking for a representation the server cannot produce is told it
succeeded and hands the wrong media type to its parser. The error handler already branches on what
the client accepts to choose between a JSON body and a rendered HTML page, so the negotiation exists
— it has no "neither" branch.

Neither is exploitable and neither loses data. Both are what an API gateway, a conformance suite or a
generated client notices first.

### M15. The OpenAPI document cannot say that a property is an xml element's text — MINOR, **open (waiting on Swagger UI)**

*Filed by this work; moved here from 11 on 2026-10-01.*

The document is written as OpenAPI 3.1, which has no way to say that a property is an xml element's
own text: `@XmlText` is described as if it were a child element, so the published xml schema is wrong
for every model using it. 3.2's `xml.nodeType` (`element`, `attribute`, `text`, `cdata`, `none`) says
exactly that and replaces `attribute`/`wrapped` with one field. The installed `openapi3-ts` already
ships `oas32`, so the switch is the version string, the imports in `open-api.model.ts`, `annotateXml`
writing `nodeType`, and checking what the doc UI renders. 3.2 also has `itemSchema` for streamed
responses and the `QUERY` method, neither needed today.

**Waiting on Swagger UI (checked 2026-09-25).** The bundled copy only renders `3.0.x`/`3.1.x`, so a
`3.2.0` document shows "Unable to render this definition". 5.33.0 renders 3.2, but it builds its xml
examples from `xml.attribute` alone, and so does `master`. `nodeType` is read nowhere, and 3.2
forbids writing both, so the explorer would show every attribute as a child element. **Decided:
switch once a Swagger UI release reads `nodeType`.**

What the switch then needs: replace the vendored `assets/public/open-api` copies in the cli and the
sandbox (a project created earlier keeps its own copy and has to replace it too); make
`openApiToV3` in entity generation accept `3.2`, since it refuses anything but `3.0`/`3.1` and would
refuse zibri's own documents; and handle `oas32.SchemaObject` also being a `boolean`. The 3.2
defaults that make a `$ref` or an array produce no element of its own do not matter here, because
every schema is written inline. Mixed content becomes an array of `none` parts: the text shape is a
`text` node and each model shape an element named like the shape, with `shape` and `value` both
`none`.

### M16. A connection keeps a tenant's channels after its user stops being a member there — ~~MAJOR~~ **FIXED**

*Filed on the re-check of 2026-10-15.*

> **Closed 2026-10-15, together with [M20](#m20-a-closed-connection-is-never-taken-out-of-the-channels-it-joined--minor-fixed).**
> `updateTenantRooms` moves the user's connections out of every channel room of the tenant along with
> its tenant room, and back into the ones the user is in once they are a member again, the way a
> reconnect would join them. The user stays in `WebsocketChannel.userIds`: a membership that is
> deactivated and reactivated should not cost them their channels. Both go through the room of the
> user, so they reach the connections on every instance. The per-instance `websocketChannels` list
> is gone: `sendToChannel({ expectResponse: true })` asks the connections in the channel's room, so a
> connection moved out of it is not asked any more either. Held by *takes a connection out of the
> channels of a tenant once its user stops being a member there, and back once they are one again* in
> `websocket.service.tenancy.test.ts`, red first.

A membership that ends takes the user's connections out of the tenant's room and nothing else.
`updateTenantRooms` (`src/websocket/services/websocket.service.ts:873-890`) calls `socketsLeave` on
`zibri.tenant:<id>` only. The channel rooms the connection joined while it was a member
(`joinChannel`, `:835-851`, `rejoinChannels`, `:470-479`) are left as they are, the user stays in
`WebsocketChannel.userIds`, and the connection stays in `websocketChannels[channel.id]`.

So a member removed from a tenant, or deactivated there, keeps receiving every `sendToChannel` of that
tenant's channels on every connection that is open, and `sendToChannel({ expectResponse: true })`
still asks them for an answer. Only a reconnect ends it, because `recoverConnection` (`:507-510`)
reads the channels through the user's current memberships. `docs/websocket.md` says a connection
"stops receiving" a tenant's broadcasts once the membership is deleted, which holds for `sendToAll`
and not for channels.

`websocket.service.tenancy.test.ts` covers the tenant room in both directions and no channel. The
tenancy evaluation holds one websocket case, and it is about a message *sent*, not one received.

### M17. A socket receives as whoever it connected as, after that login has ended — ~~MAJOR~~ **FIXED**

*Filed on the re-check of 2026-10-15.*

> **Closed 2026-10-15. A socket receives for as long as a request with its credential would be
> accepted, and no longer.** The user chose disconnecting on each way a login ends over checking every
> socket on an interval. What is done on an ending is not "close the user's sockets" but "ask each
> socket of the user again": the handshake's credential is resolved the way a request's is, and the
> socket is closed when it no longer names its user. So a logout closes the socket of the login that
> logged out and leaves the user's other devices connected, and under `ACCESS_TOKEN_REVOCATION:
> 'onExpiry'` a logged-out access token keeps its socket exactly as long as it keeps working over
> http.
>
> - **Where logins end:** `AuthService.endLogins` (deactivation, password reset, any strategy),
>   `revokeApiKey(s)`, and inside `JwtAuthStrategy` logout, `endFederatedLogins`, `revokeToken` and
>   refresh-token reuse; `ClientAccessTokenAuthStrategy.revokeToken`. Each calls
>   `WebsocketServiceInterface.disconnectEndedLogins(userIds, transaction)`, which waits for the
>   commit and tells the other instances through the adapter (`serverSideEmit`), since only the
>   instance holding a socket can ask it again. The cookie strategy has no call: cookies never
>   authenticate a socket (`hasCredential` is false for a websocket context).
> - **Expiry:** `AuthStrategyInterface.resolveExpiresAt` is new and required, and every shipped
>   strategy answers it (`ProviderToken` gained `expiresAt` for it). A socket is asked again when its
>   credential expires, so a session extended in the meantime keeps it.
> - **Why re-resolving the handshake is safe:** it reads and writes nothing a request would not. DPoP
>   proofs are never checked for a websocket context, so nothing is spent twice, and no cookie
>   session can be rotated from a socket.
>
> A custom login strategy ending logins itself has to call `disconnectEndedLogins` too; docs/auth.md
> says so. Held by `websocket.service.ended-logins.test.ts` (nine cases, red first, the three
> strategy-internal endings mutation-checked) and, across instances, by the M17 case in
> `cluster/websocket.cluster.test.ts`.

Who a connection is gets decided once, in the handshake middleware
(`src/websocket/services/websocket.service.ts:275-323`), and is never asked again for anything the
connection *receives*. `recoverConnection` then joins `zibri.user:<id>`, the tenant rooms of every
membership and the rooms of every channel the user is in (`:505-512`).

Messages the client sends are checked one by one, each with its own `authorization`. Messages sent
to it are not. A logout, a revoked session ([03 §A3](./03-auth-and-security.md)), a deactivated user,
a changed password and an access token that expired an hour ago all leave the socket where it is,
receiving everything addressed to that user, their tenants and their channels until the client
disconnects on its own. The one place the framework closes a socket is a message of its own answered
with 401 (`:1082-1084`), and a client that only listens never sends one.

A deleted user is the one case that does end, through the memberships the deletion removes, and
only for the tenant rooms (see M16 for the channels).

### M18. A connection that sends no `auth.offset` joins none of its rooms — ~~MAJOR, open~~ **FIXED**

> **Closed 2026-10-16. No offset is a client with nothing to catch up on** (the user's call, over
> refusing it and over reading it as 0).
>
> - `BaseWebsocketConnection.offset` is `number | undefined`, and `SocketIOWebsocketConnection`
>   answers undefined instead of throwing. `recoverConnection` joins the user, tenant and channel
>   rooms first, whatever the offset, and only the replay depends on it: without one it returns
>   there, having sent nothing.
> - An offset that *was* sent and is not a whole number of at least 0 refuses the handshake with a
>   400, "The offset has to be a whole number of at least 0.", so a client sending a wrong one is
>   told instead of being read as some other offset. The connect handler's `as number` cast went
>   with it.
> - The docs half was closed by [M19](#m19-websocket-messages-are-kept-forever-and-a-client-picks-how-far-back-its-replay-reads--major-fixed),
>   which added the reconnect section and its client example. That example now starts without an
>   offset, and the section says what no offset and a bad one get.
>
> **Proof.** Two cases in the in-memory `websocket.service.tenancy.test.ts`, both red first: a
> logged in member connecting with an empty `auth` receives a broadcast in their tenant and a
> message to their channel, and not the persisted one sent before it connected; text, a negative
> number and a fraction are each refused with the message above.

*Filed on the re-check of 2026-10-15.*

`SocketIOWebsocketConnection.offset` (`src/websocket/models/connection/socket-io-websocket-connection.model.ts:21-26`)
throws when `handshake.auth.offset` is not a number, and `recoverConnection` reads it
(`src/websocket/services/websocket.service.ts:499`) after loading the memberships and **before**
`connection.join(...)` (`:505`). The connection has already been pushed into `connections` and its
`onAny` listener registered (`:354-360`), so it stays open and answers messages, while the error is
logged as `Could not handle a new websocket connection` by the `connection` listener (`:326-329`).

What a client gets for leaving it out: no user room, no tenant rooms, no channel rejoin and no
replay. `sendToAll` inside a tenant never reaches it, and nothing tells it so. Every test passes
`auth: { offset: 0 }`; `docs/websocket.md` never mentions the field, and has no client example to
show it in. A socket.io client connecting the way socket.io documents it is this case, and each such
connection writes an error line.

### M19. Websocket messages are kept forever, and a client picks how far back its replay reads — MAJOR, **FIXED**

*Filed on the re-check of 2026-10-15.*

> **Closed 2026-10-15.** Four decisions, each taken by the user:
>
> - **Retention is required.** `messageRetentionInMs` has no default: how long a client may be away
>   and still catch up is the application's call. The options moved behind
>   `WEBSOCKET_OPTIONS_INPUT` (undefined by default), and `WEBSOCKET_OPTIONS` is built from it and
>   throws when it is missing - read by the service only once the application declares websockets,
>   so an application without them starts as before and one with them fails on the way up. The
>   service now reads its options lazily for that reason. `WebsocketMessageCleanupCronJob`, hourly,
>   deletes every message up to the newest expired one, so what is kept is always a suffix.
> - **The replay is bounded, and all or nothing.** `maxReplayedMessages` (default 1000) caps the read
>   at one row more than it sends. A client that missed more, or whose offset lies before the oldest
>   kept message, is sent none of them and one `ws:replay-incomplete` carrying the newest seq instead,
>   so a partial history never looks complete.
> - **No acks during the replay.** socket.io keeps order on one connection and the client tracks the
>   seq, so the replay emits without waiting; a silent client neither holds it nor ends it.
> - **seq comes from a counter row.** Found on the way, filed nowhere: `getNewSeqNumber` read the
>   newest seq and added one, so concurrent sends (or two instances) shared a seq and a client keeping
>   its offset skipped one of them - twenty sends at once all got the same number. A new
>   `WebsocketMessageSequence` entity holds one row, drawn from by the atomic `upsert` increment the
>   invoice numbers use; the service creates it at boot from the newest kept message, so stored
>   messages keep their numbers.
>
> Held by `websocket.service.replay.test.ts` (six cases, in memory). Four red first: the replay
> stopped at the first unanswered message with "operation has timed out", 20 concurrent sends shared
> seq 10, and there was no cleanup. The other two - continuing from kept messages, refusing to start
> without a retention - were mutation-checked by removing the boot-time sequence and the refusal.
> **Breaking:** applications with websockets provide `WEBSOCKET_OPTIONS_INPUT` and declare
> `WebsocketMessageSequence`.

`send`, `sendToChannel` and `sendToAll` persist by default (`persist ?? true`,
`src/websocket/services/websocket.service.ts:646`), and nothing ever deletes a `WebsocketMessage`:
there is no cleanup cron and no retention setting, unlike `Log`, `Event` and `Lease`. Every broadcast
an application has ever sent is a row.

`recoverConnection` replays everything above `connection.offset` with `take: 'all'` (`:530-535`),
and the offset is whatever the client put into its handshake. `offset: 0` - which is what every test
in this repository sends - reads the whole history the connection can see into memory, and an
anonymous connection can see every broadcast sent outside a tenant. `isAllowedToConnect` admits
everyone by default, the handshake is not rate limited, so this is an unbounded read any client can
ask for once per connection.

The replay then sends each row with `expectResponse: true`, one after the other (`:537-546`), so a
client that does not acknowledge holds the loop for `timeoutInMs` per message, and the first timeout
throws out of `recoverConnection` and ends the replay there.

### M20. A closed connection is never taken out of the channels it joined — MINOR, **FIXED**

*Filed on the re-check of 2026-10-15.*

> **Closed 2026-10-15, with M16.** The list it describes no longer exists: who is in a channel is
> read off socket.io's room, which a closed socket leaves. Held by *forgets a closed connection in
> the channels it joined* in `websocket.service.tenancy.test.ts`, red first: the closed socket was
> asked, waited for until the timeout, and reported as an answer.

`onDisconnect` (`src/websocket/services/websocket.service.ts:549-558`) removes the connection from
`connections` and leaves it in every `websocketChannels[channel.id]` list. A reconnect gets a new
socket id and is pushed as another entry (`:475-476`), so the lists grow by one per reconnect of every
channel member for as long as the instance runs, each entry holding the closed `Socket`.
`sendToChannel({ expectResponse: true })` (`:741-760`) iterates the list and waits `timeoutInMs` for
each closed socket before reporting it as an error.

### M21. Reading an xml body takes time quadratic in how many sibling elements share a name — MAJOR, **FIXED**

*Filed on the re-check of 2026-10-15.*

> **Closed 2026-10-15.** `groupByName` pushes onto the group it finds instead of copying it with the
> element added. Held by *reads many elements of one name in time linear in how many there are* in
> `document/xml.utilities.test.ts`: 50,000 undeclared `<a/>` through `XmlUtilities.parseFrom`, refused
> by validation within a second - red first at 11.5 s. The body parser and `parseFrom` share the
> reader, so the one case covers both. The same copy-on-add grouping is in a few other places, none of
> them reachable with input of this size: two test helpers, the tsx compiler's own bookkeeping, a SCIM
> member's groups, the valkey upsert's candidates (grouped by unique values, so a group is one row),
> and the valkey driver's nested save (`val-key.repository-driver.ts`, the children of each owner),
> which a single save of thousands of children makes quadratic - filed as
> [01 §M43](./01-data-layer.md), with a case for it in `large-batches.cases.ts`.

`XmlReaderUtilities.groupByName` (`src/document/xml-reader.utilities.ts:235-241`) builds each group
with `[...res.get(element.name) ?? [], element]`, copying the group for every element added to it.
`readObject` and `readUntyped` call it for every element they read, and an element the model does
not declare is grouped like any other before validation refuses it.

Measured on the loop alone: 20,000 siblings take 1.5 s, 25,000 take 2.5 s, 50,000 take 13 s. A
body's default limit is `100kb` (`src/routing/resolve-body-metadata.function.ts:14`), which fits about
25,000 `<a/>`, so one request to any route taking an xml body blocks the event loop for seconds, the
parse running after the route's access check. `XmlUtilities.parseFrom`
(`src/document/xml.utilities.ts:51-67`) reads documents the same way and takes a string of any length.

### M22. A model derived from another shares its nested property metadata — ~~MINOR, open~~ **FIXED**

*Filed on 2026-10-15, from what §M3 left open.*

§M3 made route metadata a deep copy through `cloneMetadata` and left model properties on the shallow
record copy they had: `@Property` builds a class's metadata by reading that record back and storing it
again, and the class helpers (`OmitClass`, `PickClass`, `PartialClass`, `IntersectionClass`) derive one
model from another by passing entries straight through. So a parent model and a model built from it
hold the same nested objects - an array item's metadata, a oneOf's shapes, `allowedMimeTypes` - and
anything that changes one of them after declaration changes both.

> **Closed 2026-10-17. A declaration is frozen once it is made, so sharing it is safe.** Wider than
> filed: a subclass shares its parent's declarations too, its record starting as a copy of the
> parent's that holds the same objects, and `PartialClass` copies an entry one level deep and shares
> what is nested. Nothing in the framework writes to a declaration after it is made, so the sharing
> was invisible - but `getModelProperties` hands out the stored entries, and anything writing to one
> changed every model derived from it or the one it was derived from. The user's point was that a
> DTO derived from a model is meant to inherit its metadata, so inheriting by sharing stays; asked
> between freezing, a deep copy at every derivation, and merging a re-declared property into the
> inherited one, they chose freezing. `setModelProperties` freezes every declaration it stores and
> everything it holds - the plain objects and arrays, the parts `cloneMetadata` copies - and leaves
> classes, factories, validators and other instances alone. A write now fails where it is made. A
> derived model needing a property declared otherwise declares it again, as it already could, and the
> record of properties itself stays the model's own. No cost per read; once per declaration.
> Documented under "Deriving models".
>
> **Proof.** `metadata.utilities.test.ts` (pure): a write to a declaration, to its `allowedMimeTypes`
> and to an array's items refused, the `PartialClass` built from it unchanged - red first, every write
> accepted - and a subclass re-declaring a property without the parent's changing. The in-memory
> suites and the entity, validation, OpenAPI, parsing, registry, document and routing tests run with
> nothing writing to a frozen declaration.

### M23. `maxHeadersCount` cannot be set — ~~MINOR, open~~ **FIXED**

*Filed on 2026-10-15, from §M11's table.*

The server is `createServer(this.express)` (`src/application/application.ts:143`), and
`HTTP_SERVER_TIMEOUTS` covers the timeouts only. Node's limit of 2000 headers per request stands, and
an application that wants a lower one has to reach past the framework for the server.

> **Closed 2026-10-18. A request may carry 100 headers and 16 KB of them, both settable, and one
> over either is answered 431.** Looking closer found node's limit is not one: past
> `maxHeadersCount` the parser keeps the first headers and drops the rest without a word, and the
> request goes on without them. The user's calls: refuse rather than truncate, make the size
> settable as well, and find a reasonable default rather than node's 2000 - which is a hundred,
> what apache (`LimitRequestFields`) and haproxy (`tune.http.maxhdr`) accept by default.
>
> `HTTP_SERVER_TIMEOUTS` is renamed `HTTP_SERVER_LIMITS` (`HttpServerLimits`), the user's choice
> over a second token, with `maxHeaderCount` and `maxHeaderSizeInBytes` beside the four timeouts.
> The size is only given to `createServer`, so the server is no longer created in a field
> initializer but in `init`, right after the application's providers are registered and before any
> lifecycle hook - the websocket server attaches to it in `onAppInit`. `server` is a getter that
> refuses to answer before then, and the shutdown reads the field, so an application that failed
> while initializing still shuts down. The server is given one header more than the limit, and its
> request listener answers a request reaching that one `431` with the connection closed, before
> express - where node answers headers that are too large. Both limits are refused at startup
> unless whole numbers of at least one; the timeouts are applied and checked there too, at `init`
> rather than `start`.
>
> **Proof.** `http-server-limits.test.ts` (in memory, raw requests over a socket so the count is
> exact): a hundred headers served and a hundred and one answered 431 by default - red first,
> served - and with limits of its own, ten served, eleven refused, headers inside the size served
> and larger ones refused, and a count of 0 or a size of 1.5 refused at startup. The in-memory
> suites booting an application, the websocket and routing ones included, all start.

### M24. The work a thread job does is not traced — ~~MINOR, open~~ **FIXED**

*Filed on 2026-10-15, from what §M7 left out.*

A worker thread shares no async context with the thread that queued its job, so nothing a job does - a
query, an http call, a log line - carries the trace it was queued under, and the job itself is no span.
A request that hands its work to a thread job loses the trace exactly where the expensive part starts.

> **Closed 2026-10-18. A job's run is a span under the trace it was queued in, and the worker is
> handed that span.** Looking closer narrowed what there is to carry: a worker is a bare thread, with
> no container, tracer or framework logger, running only the job's file or function - nothing in it
> could record a span. What was missing is the job as a span, and the trace inside the worker for
> whatever it passes it on to. The user's calls: a queued job hangs under the trace it was queued in
> rather than starting its own like a cron tick, since it is work something asked for; and the worker
> gets the job span's context.
>
> `ThreadJobEntity` (and `ThreadJob`) carry `traceparent` and `tracestate`, written from the trace
> running when the job is queued, run or requeued - a requeued run answers to whoever asked for it.
> `runToCompletion`, the one place a job runs from start to end, records it as `runThreadJob`
> (`CONSUMER`, the job id as `messaging.message.id`, the file as `code.file.path`) under the stored
> trace, or as a root of its own when there is none - never under what happens to be running, which
> is the poll, another job finishing, or a request queueing something else. A failed job is a failed
> span with its error; cancelled and interrupted are not failures. The worker is now posted a start
> message, the job's data and the span's context, and keeps the context under a registry symbol on
> its `workerData`, beside the data rather than in it, where `getThreadJobTraceContext()` reads it -
> the registry because the worker and a worker file loading the framework as another module copy
> share nothing else. Documented in multithreading and tracing; the upgrade migration adds both
> columns.
>
> **Proof.** `multithreading.service.tracing.test.ts` (in memory, against the built worker): a job
> queued in a trace recorded as a span under it, with the worker handed that span; a row carrying a
> traceparent, picked up by a poll outside every trace, recorded under it; a `run` under its caller;
> a failing job as an error; and a job queued outside any trace as a root - all five red first.
> `optional-peer-dependencies.test.ts` posts the new start message to the built worker. Every
> multithreading suite that runs without a container passes.

---

## MINOR

- ~~**Every log line captures a V8 stack trace**~~ — **FIXED** (re-checked 2026-09-28): `resolveOrigin`
  swaps `prepareStackTrace` for one handing back the call sites, so no frame is rendered to text, and
  finds the caller by file name rather than by a fixed index — `Error.stackTraceLimit = 0` answers
  `'unknown'` instead of throwing. The original entry: `src/logging/logger.ts:73-75` does
  `(new Error().stack ?? '').split('\n')[3]` plus two regexes, on every enabled log call, just to
  derive an `origin` string. The frame index `[3]` is hardcoded, so any wrapper gives a wrong
  origin — and with `Error.stackTraceLimit = 0` (a routine production tuning) `line` is
  `undefined` and `line.match` throws on **every** log call.
- ~~**Validation regexes are recompiled per request**~~ — **FIXED 2026-10-02, with re2 by the
  user's choice.** The original entry: `src/validation/functions/validate-string.function.ts:66`
  calls `new RegExp(meta.regex)` per field, per request, on decorator metadata fixed at startup. No
  ReDoS guard or timeout on attacker-controlled input. A `maxLength` is no guard, because `(a+)+$`
  takes seconds on 27 characters. Weighed: refusing nested quantifiers at startup (misses
  overlapping alternation and polynomial cases), a time limit per match through a vm context, and
  documenting it. Taken: every declared pattern runs through `re2`, a linear-time engine, as a new
  optional peer. `RegexUtilities.resolveLinear` compiles each declared pattern once and strips `g`
  and `y`, because a shared pattern with either flag would carry `lastIndex` from one request to the
  next. `RegexUtilities.validateLinear` runs at every place a pattern can be declared:
  `@Property.string`, array items and oneOf shapes, path, query and header params, and array param
  items. A pattern re2 cannot run (a lookaround or backreference) is refused there, naming the key.
  Found on the way: an invalid pattern string used to throw a SyntaxError at the first request that
  reached it, which answered with a 500. It is refused at the declaration now. re2's errors come from
  a native addon and are not the `SyntaxError` of jest's realm, so the refusal is told apart by where
  it is thrown, not by its class. Held by `regex.utilities.test.ts` (every declaration site),
  `optional-peer-dependencies.test.ts` (optional, not needed to load, named when missing), and a
  MINOR block in `http-and-observability.evaluation.test.ts`. Documented in models, getting started
  and the upgrade guide.
- ~~**`req.method` is mutated to lowercase**~~ — **FIXED, and it was not a MINOR.** The finding
  filed it as a courtesy problem for *third-party* middleware. It was breaking express itself, in two
  places, on every request the framework routed:

  `request.js:462` — `if ('GET' !== method && 'HEAD' !== method) return false` is the whole of the
  freshness check, and `'get'` is not `'GET'`. **No response could ever be a 304.** The ETag was
  computed, sent, and returned by the client in `If-None-Match`, and every revalidation downloaded
  the entire body again. That is also why M11's ETag row read as absent: the header the finding
  looked for is read by express, but the answer it produces was unreachable.

  `response.js:216` — `if (req.method === 'HEAD') { this.end() }` is how express strips a body it
  must not send. **A HEAD was answered with the whole body**, which is a protocol violation and the
  opposite of what a client asking for one wants.

  Fixed by spelling `HttpMethod` the way the protocol spells it — `GET` rather than `get` — so
  `request.method` *is* an enum value with nothing having to rewrite it. Four places wanted the
  lowercase name and now ask for it: two express registrations and two open api path items, via
  `httpMethodKey`. The `.toUpperCase()` in `metrics.service.ts` that the finding noted as a symptom
  is gone, along with three more like it.

  Worth keeping: the mutation existed to make a type true. `HttpRequest['method']` was declared as
  the lowercase enum, so the value was edited to match the declaration rather than the declaration
  corrected to match the value — the same shape as [01 §M21/M22](./01-data-layer.md), *a declaration
  the read side trusts and the write side never makes true*, one layer up.

  Held by *answers a conditional request with a 304* and *answers a HEAD with the headers of the
  answer and none of its body* in `http-and-observability.evaluation.test.ts`.
- ~~**`InitRouterError` is thrown at request time**~~ — **FIXED (2026-09-28)**, and it had been
  recorded as fixed in a working note without being so: `validateResultType` still threw it. A
  handler returning a kind of value none of its responses declare now raises
  `UndeclaredResultError`, naming the route (`Controller.method`, or method and path for a route not
  on a controller) and what it returned against what it declares. `router.test.ts` had a case for
  this route that asserted only the 500, which is why the wrong error never showed; it now asserts
  the logged error (red first), and the suite boots on the in-memory data source since routing
  touches no rows. The original entry: `src/routing/router.ts:611, 617, 623`. Operators debugging a
  500 see an initialization error for a runtime type mismatch.
- ~~**`CORRELATION_ID` accepts unvalidated client input**~~ — **FIXED** by M7, which replaced the
  token with `TRACE_CONTEXT`. What a caller sends now has a fixed shape, so it is read through a
  pattern that pins the length, the charset and the number of fields; a header that arrived twice
  takes the first value, because a proxy chain prepends; and anything that does not parse is treated
  as though nothing arrived, which is what the standard asks for. Held by
  `src/tracing/trace-context.utilities.test.ts`.
- ~~**Build artifacts committed to source**~~ — **FIXED** (re-checked 2026-09-28): `src/di/default/temp/`
  no longer exists and nothing under it is tracked. Shipping `src/` is kept on purpose, so that
  following a framework method lands on what it does; `files` carves test material out with `!`
  entries. The original entry: `src/di/default/temp/`, 382 directories, 5.8 MB, and
  `files: ["./src", ...]` ships the entire `src/` tree to npm.
