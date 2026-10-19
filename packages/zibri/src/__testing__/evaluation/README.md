# Evaluation tests

Executable versions of the findings in [`/evaluation`](../../../../evaluation/README.md).

## What these are

Every test here asserts the **fixed** behavior, not the current one. They are therefore **expected
to fail today**. Each one turning green means one finding from the evaluation is closed.

This is deliberate: a test that encodes a known bug as the expected result is worse than no test,
because it locks the bug in.

## Running them

They are excluded from `npm test` so the pipeline keeps signalling real regressions rather than a
constant wall of known gaps:

```sh
npm run test:evaluation -w zibri              # all of them
npm run test:evaluation -w zibri -- --verbose # with each test named
```

## The rule these tests follow

**Assert observable behavior. Never assert how the code is written.**

An earlier version of this suite grepped the framework's source to check whether a fix was present.
That approach reported three separate findings as fixed while nothing had changed:

- a regex for a durable event transport matched the word *"listen"* in a doc comment
- a regex for single-flight coalescing matched a metrics gauge named `inFlight`
- a window after `register<T>(` spilled into the neighbouring JSDoc and matched its `@throws`

Source greps are gone. What replaced them:

1. **Behavioral** — drive the real thing and observe the result. Point the HTTP client at a local
   server and count requests; call a cache wrapper concurrently and count origin invocations; throw
   from a real endpoint and read back the rows the real log transport persisted.
2. **`it.todo`** — for findings that need infrastructure this suite does not stand up yet
   (a second process, a scrape endpoint, a login flow). A todo states what has to be proven and
   *cannot report itself as fixed*, which is the whole problem with a grep. It is also the thing most
   worth re-reading: the M10 todos said "needs a file upload route" long after `registerRoute` could
   mount one with a body model in four lines.
3. **Published-artifact assertions** — `package.json`, `tsconfig`, the workflows, `post-build.mjs`.
   These are read directly with `FsUtilities` in `di-and-packaging`. That is the artifact a consumer
   receives, not implementation detail, so asserting on it is legitimate.
4. **A comment where a case used to be** — for a finding whose fix *declined* what it asked for.
   `02 C1` asked for a non-wildcard CORS default and the fix kept `'*'` with no credentials on
   purpose; `02 C3` asked for a readiness endpoint and that half was withdrawn as the wrong layer;
   `05 M2` asked for two compiler options and got one, because `exactOptionalPropertyTypes` checks
   no code — it decides what every optional property in the public API means, which is a modelling
   pass rather than a strictness setting. A
   test asserting either would be red forever while describing behavior nobody intends to build, and
   deleting it silently would lose the reasoning. The comment says what was asked, what was decided
   instead, and where the part that *was* fixed is held.

   This is the one shape that can hide a real gap, so it is only for a decision written up in the
   finding itself — never for something merely inconvenient to test. That is what `it.todo` is for.

### Auditing the todos

A todo cannot go stale loudly — it stays grey whether the gap is still there or was closed a month
ago. So they get re-read against the source periodically, and the finding each one describes is
written into the comment above it with the file and line that proves it. If you fix something, the
todo is the thing to check.

`auth-and-security.evaluation.test.ts` was audited in full twice. The first time all 14 todos still
described real gaps. The second time, after most of chapter 03 had closed, seven of the remaining
nine stood for fixed findings. Four were already tested elsewhere and are comments now. Three got
the test they described, and one of those found a bug: a user store that was down still answered
like a wrong password, because the user service turned every failed lookup into "not found". The two
left are chapter 03's section H, capabilities that do not exist.

Two comments were sharpened in the first round, both because the original wording would have sent a
fix to the wrong place:

- the JWT revocation todo said the strategy "never consults the store". `resolveUser` does
  (`jwt.auth-strategy.ts:326`); `hasRole` does not (`:349`). The bug is that the two halves of one
  strategy disagree, which is narrower and more fixable than the original claim.
- the asymmetric-algorithm todo now records that `JwtUtilities.verify` passes no `algorithms`
  allowlist. That is inert while the secret is a `string`, because jsonwebtoken then only allows
  HMAC — but it turns into algorithm confusion the moment someone adds public key support without
  adding the allowlist in the same change. Public key support has since landed with the allowlist
  pinned per key (`jwt-auth.asymmetric.test.ts`), and the todo is a pointer now.

`scaling-and-infrastructure.evaluation.test.ts` was audited too, and has no todos left: eight of its
eleven pointed at findings already proven elsewhere, and are comments naming where; the other three
got the test they described. One of those, 01 §C3, had been marked closed with nothing holding it.

### Uncaught exceptions cannot be observed with a listener

Measured, not assumed, while writing `streaming.evaluation.test.ts`. Inside a jest test:

- `process.listeners('uncaughtException')` is **empty**
- `process.hasUncaughtExceptionCaptureCallback()` is **false**
- a throw from a `process.nextTick` callback reaches **no** listener registered during the test —
  and still fails the test

So jest intercepts uncaught exceptions ahead of the listener chain. Two consequences worth knowing
before writing a test that depends on either:

1. A `process.on('uncaughtException')` recorder is dead code. Jest failing the test *is* the
   observation, and it reports the real error and the real line, which an assertion could not.
2. The framework's own handler (`application.ts:536`, which logs and then deliberately rethrows)
   does not run under jest either — so a test that provokes an uncaught exception is not at risk of
   ending the worker, and does not need to stand that handler down.

This does not affect `http-and-observability`'s two green tests, which assert the handlers are
*installed* rather than what they do.

### Control tests

Some tests are *expected to pass*. They exist so a red elsewhere is trustworthy:

- `serves the second caller from the cache once the first has filled it` — proves the cache caches,
  so the single-flight red means single-flight, not a broken fixture
- `still retries a server error` — proves retries work, so the 4xx reds mean misclassification
- `commits and rolls back through a transaction the data source handed out` — proves the happy path
- `has the undecorated route registered` — proves the route is routed, so the missing-warning red is
  not vacuous. It deliberately does not assert the status, because asserting 200 would encode the
  open-by-default bug.
- `finds a row by an ordinary value inside a json column` and `finds a row whose json value contains
  a quote` — prove the JSONB filter path is reached and that the quote doubling does hold for the
  ordinary case, so the reds beside them are about the specific value that was filtered for rather
  than about JSONB filtering never having worked at all.
- `rotates the token when it is presented once` and `accepts a confirmed enrollment` — prove that
  sequential rotation and a real enrolled second factor both work, so the concurrency and replay
  reds beside them are about the second request rather than about the fixture.
- `serves a file stream that does not fail` — proved the streaming route works, so the mid-stream
  cases beside it were about the failure rather than about file responses. The whole file is green
  now that [02 §M1](../../../../evaluation/02-http-runtime-core.md) is closed, and the control still
  earns its place: it is what stops a fix that refuses every stream from looking like a fix.
- `restores the state the backup was created in` and `renames a property when the migration commits`
  — prove that backup/restore and the rename migration both work when nothing goes wrong, so the
  interrupted versions beside them are about the interruption.
- `removes a mail from the queue once every recipient accepted it` and `…and the mail is persisted`
  — the first proves the queue really drains through the stub SMTP server, the second proves the
  rejection is *detected*. Together they narrow the red between them to the deletion itself rather
  than to sending or to bounce handling.

Any green that is **not** in this list is either a closed finding or a broken test. Audit it: run
the assertion by hand and confirm what actually satisfied it.

### Closed findings

Once a finding is fixed its test stays, as a regression test, and is listed here so that a green is
never mistaken for an unaudited one:

- `cluster/cron.cluster.test.ts` — [04 §1.1](../../../../evaluation/04-infrastructure-subsystems.md),
  cron leader election. Failed with all three replicas in every tick group; passes with one.
- `cluster/events.cluster.test.ts` — [04 §1.4–1.5](../../../../evaluation/04-infrastructure-subsystems.md),
  cross-process event delivery and exactly-once processing. Failed because nothing ever finished an
  event whose replica died; passes with a survivor completing it once.
- `cluster/migrations.cluster.test.ts` — [01 §C2](../../../../evaluation/01-data-layer.md), the
  schema lock. Failed with two of three instances crashing on a postgres catalog unique violation;
  passes with all three up and one migration row. The only test using `bootMode: 'simultaneous'`.
- `cluster/caching.cluster.test.ts` — [04 §1.9](../../../../evaluation/04-infrastructure-subsystems.md),
  a local cache tier going stale on the other replicas. Uses a real multi-tier cache, in-memory L1
  over a shared valkey L2, because a single-tier cache on a shared store is coherent by itself and
  would prove nothing.
- `cluster/websocket.cluster.test.ts` — [04 §1.10](../../../../evaluation/04-infrastructure-subsystems.md),
  broadcasts reaching only one instance's clients. The two clients connect to *different* instances,
  which is the only arrangement that can tell the difference.
- `cluster/shutdown.cluster.test.ts` — [10](../../../../evaluation/10-leases-and-claims.md) draining
  and [02 §C3](../../../../evaluation/02-http-runtime-core.md). A replica told to stop used to keep
  every grant it held until the lease expired, so the next one waited a full minute for work that
  stopped seconds ago. The second case adds a request that never ends, because closing the http
  server waits for open connections *before* any shutdown hook - one long poll used to mean nothing
  was handed back at all.
- `http-and-observability.evaluation.test.ts` — greens in an otherwise red file, all audited:
  - *costs one pass rather than three* and its control
    ([02 §M2](../../../../evaluation/02-http-runtime-core.md)). The only test here that measures a
    duration, and the only one that could: a response serialized once and a response serialized three
    times differ in nothing an assertion can read off the wire. It measures both candidate
    implementations in the test process and asserts the request lands on the one-pass side of the
    midpoint between them, so it says the same thing on a fast machine and a slow one. It times the
    **first byte** rather than the round trip — reading a four megabyte body back costs about what
    serializing it did, and that was enough noise to fail the test with the fix in place.
  - the compression, encoding-preference and conditional-request cases
    ([02 §M11](../../../../evaluation/02-http-runtime-core.md)). Note what turning compression on did
    to its neighbours: the M2 cases here and the whole of `streaming.evaluation.test.ts` now state
    `accept-encoding: identity`, because an encoder is a second thing to time and it holds the head
    back until it has a chunk worth writing. Both were about the unencoded path all along and had
    never had to say so — a default that changes how a response is written changes what every test
    around it is measuring.
  - *answers a conditional request with a 304* and *answers a HEAD with the headers of the answer and
    none of its body*. These two were written to prove an M11 row **wrong** — it said ETag was absent
    because nothing in the framework reads `If-None-Match`, and express reads it. The first one
    failed anyway, which is how the router lowercasing `request.method` was found. Worth remembering
    the next time a finding looks mistaken: the row was wrong about the mechanism and right about the
    symptom.

    The conditional one is also the suite's clearest case of **the client being the thing under
    test**. It failed twice more after the framework was fixed, once because the route it asks for
    echoes a per-request id — so the body, and with it the validator, was different every time — and
    once because node's `fetch` adds `cache-control: no-cache` by itself to any request carrying a
    conditional header, which a correct server must answer in full. Both were told apart from a real
    defect with a twenty line express script rather than by reasoning about it, which is the cheaper
    move whenever a failure could belong to either side of the wire.
  - *installs a process level unhandled rejection handler* and *…uncaught exception handler*
    ([02](../../../../evaluation/02-http-runtime-core.md)). A rejection on a background path used to
    end the process, which is what killed a replica in `cluster/events.cluster.test.ts`.
  - *removes an expired upload folder and leaves a live one alone*
    ([02 §C6](../../../../evaluation/02-http-runtime-core.md)). The cleanup cron had two bugs, and
    the second hid the first: the predicate was inverted *and* the folder path was built by joining
    an absolute parent twice, so nothing was ever deleted while the log reported every folder
    removed. The rest of C6 - the upload directory defaulting inside the installed package - is
    closed too: it now resolves to `.zibri/uploads` in the application, anchored on the entry module
    rather than on `process.cwd()`, which in a monorepo would have followed whichever directory the
    command was run from.

- `request-context.evaluation.test.ts` — [02 §M5 and the dead cache half of §M4](../../../../evaluation/02-http-runtime-core.md),
  a request context that was never told which route it matched. Two of its cases carry the finding
  and the rest are controls, which is the right ratio here: the observable symptom is a *missing*
  refusal, so *hands a required @CurrentUser to a caller that is logged in* is what stops
  *refuses a caller that a required @CurrentUser cannot be resolved for* from passing because the
  parameter never resolves at all. The file registers two auth strategies for one case — a bearer
  token asking for a route that names only the cookie strategy — because a stub strategy would prove
  the framework consults a list, not that the list is the route's.
- `route-metadata.evaluation.test.ts` — [02 §M3](../../../../evaluation/02-http-runtime-core.md), a
  route's declaration being resolved on every request that reaches it. A performance finding whose
  observable form is not a measurement: *refuses an impossible declaration while registering the
  route, not while serving it* and *does not read the declaration again while serving a request* are
  both statements about *when* something happens, and each is red for a different reason. The second
  asks its question by writing metadata after boot, which nothing legitimate ever does - decorators
  run at module load - because that is the only way a caller can ask it. The file also holds the one
  case here that reaches past http on purpose: *does not hand out the route's own declaration by
  reference* mutates what a lookup returned and then calls the route, because the array it wrote to
  was the one the route's roles were kept in.
- `cluster/mail.cluster.test.ts` — [04 §1.6](../../../../evaluation/04-infrastructure-subsystems.md)
  and [10 §10.3](../../../../evaluation/10-leases-and-claims.md), replicas racing over one tick *and*
  a send outliving the tick. The second half needed a per row claim: the cron lease is keyed by
  scheduled execution, so the next slot may legitimately go elsewhere while this one is still
  sending rows that still read as QUEUED.
- `invoicing.evaluation.test.ts` — [04 §1.11](../../../../evaluation/04-infrastructure-subsystems.md),
  the invoice number race. Worth reading as a sequence rather than a result. A lock keyed on year and
  recipient closed the first two tests. The third was written during the audit *after* that fix and
  stayed red: passing a transaction puts the counter write on the caller's commit while the lock is
  released at the end of the critical section, so the next caller reads a number already handed out.
  A green file at that point would have been the wrong signal. All three are green now, and not by
  widening the lock — the lock is gone, replaced by a single `upsert`. See
  [10 §10.4](../../../../evaluation/10-leases-and-claims.md) for why no lock could have worked.
- `cluster/lock.cluster.test.ts` — [10 §10.1](../../../../evaluation/10-leases-and-claims.md), a
  critical section outliving the lock's own time to live. Peak occupancy reached three: the lock
  lapsed under its holder, and that holder then deleted the lock belonging to the replica that had
  replaced it.
- `data-layer.evaluation.test.ts` — mostly still red, and deliberately so: it covers M1, M2, M3, M4,
  M6, M7, M9, M13 and M14, all open. What *is* green there is closed rather than unaudited — the
  seven `M21` cases and both `updateById on a row that is gone` cases
  ([10 §10.2a](../../../../evaluation/10-leases-and-claims.md)). Its `M6` case *commits and rolls
  back through a transaction the data source handed out* is a control, listed above.
- `logging.evaluation.test.ts` — [04 §3.2](../../../../evaluation/04-infrastructure-subsystems.md),
  the cost of deriving a log line's origin. One of the few files here needing no containers, and one
  of two that assert a *timing*: 2000 calls, under 50µs each. A threshold is a fragile thing to
  assert, and it is deliberate here — the finding is about cost, so nothing else would state it. It
  was 87µs before the fix, so the bar has room. The other one, 02 §M2 above, needed no threshold at
  all, and is the better shape where the alternative implementation can be run alongside.

- `websocket.evaluation.test.ts` — [04 §3.11](../../../../evaluation/04-infrastructure-subsystems.md),
  a websocket message written three times. Green, and built like 02 §M2 above: a control that the
  client still receives the json the round trip produced, and a send measured against the midpoint
  between one pass and three over the same message. It times `sendToAll` in process rather than a
  round trip, because a broadcast is written synchronously, once for every client, before the call
  returns. It was 42ms against a 22ms bar with the round trip put back, and about 16ms without.

- `static-assets.evaluation.test.ts` — [04 §3.12](../../../../evaluation/04-infrastructure-subsystems.md),
  static assets served with no cache headers. Withdrawn, and green on its first run once the client
  asked the way a browser does. That condition is the part to read: node's fetch adds
  `cache-control: no-cache` to any request carrying `if-none-match`, and the server rightly answers
  that with the whole file. So the first run was red for both routes, and it looked like the finding
  confirmed. The same override is in the 02 §M11 case of `http-and-observability.evaluation.test.ts`.

- `mail-queue.evaluation.test.ts` — [04 §3.5](../../../../evaluation/04-infrastructure-subsystems.md),
  the half that was withdrawn: three reads per pass and one write per mail. It asserts what each is
  for rather than counting them. One is that a flood of HIGH still leaves NORMAL and LOW a slot in the
  first pass, which one ordered read would not. The other is that a mail's row is written while
  another mail of the same pass is still being sent, which a batched write would not.

- `error-logging.evaluation.test.ts` — [02 §M6](../../../../evaluation/02-http-runtime-core.md), a
  5xx that could not be diagnosed from the logs. It is the one file in the suite that turns the
  **access log** on, through a `ZIBRI_DI_TOKENS.ACCESS_LOG` provider override, because the feature is
  opt-in and three of its cases are about what that buys. A green here therefore says nothing about
  what an application gets by default — which is deliberate, and the reason the override is written
  into the `beforeAll` rather than into the harness.

- `bootstrap.evaluation.test.ts` — now green throughout, and the file to read for how the harness
  itself changed. Its [02 §C5](../../../../evaluation/02-http-runtime-core.md) pair is where a green
  test found the rest of a finding: the bind case had been passing for a while, because the wait
  [04 §1.3b](../../../../evaluation/04-infrastructure-subsystems.md) needed happens to be the same
  wait, and the *survives an error the server emits once it is listening* case next to it is the half
  that was still open — one connection the server could not accept ending the whole process. It
  emits the event rather than provoking it, which is the exception the
  [rule these tests follow](#the-rule-these-tests-follow) allows: the real trigger is the process
  running out of file descriptors, and node raises the identical event either way.
  Its [05 §D10](../../../../evaluation/05-di-metadata-and-packaging.md) pair is the
  one to read carefully: the first case boots past an `allowOrphan: true` data source, the second
  proves a data source *without* the flag still fails the boot, and the second has to come last
  because its declaration outlives its test. Its
  [02 §C7](../../../../evaluation/02-http-runtime-core.md) case is closed too: an application's
  `shutdown()` now returns the state machine to offline and discards the DI container, so a process
  can run applications one after another. That is also why `startTestServer` no longer assigns to
  `DiContainer['singleton']` or to `GlobalRegistry['appData'].state`
  ([06 §T1](../../../../evaluation/06-tooling-ci-and-testing.md)) — which means every other test in
  the suite now depends on `shutdown()` doing that reset, rather than on the harness papering over it.

- `http-client.evaluation.test.ts` — [04 §4.1, §4.2](../../../../evaluation/04-infrastructure-subsystems.md)
  and now [§4.3](../../../../evaluation/04-infrastructure-subsystems.md), egress being unconfigurable.
  Green throughout. The §4.3 cases are the ones to read for **a test that had to get worse-looking to
  get stronger**. The first version delegated to node's own dispatcher so a real response came back,
  which means reading `globalThis[Symbol.for('undici.globalDispatcher.1')]` — and inside jest
  `globalThis` is the test context's, so the symbol is not there and cannot be. What replaced it uses
  a dispatcher that refuses to connect, and asserts the stub server recorded *nothing*: that shows
  the request went through the dispatcher rather than around it, which the delegating version could
  not have shown at all, since the server would have been hit either way.

  It also cost a run to learn that `instanceof Error` cannot walk the cause chain here. `fetch`
  throws a `TypeError` built in node's realm while the test runs in jest's, so the sandbox's `Error`
  is a different class and the check answers no about a value that is exactly what it claims to be —
  the same seam [05 §D7](../../../../evaluation/05-di-metadata-and-packaging.md) refuses to let two
  copies of the framework create. Shape is what survives a realm boundary; identity is not.

- `email-transport.evaluation.test.ts` — [04 §5.2](../../../../evaluation/04-infrastructure-subsystems.md),
  the mail transport having no seam. It is the one file here that never mentions SMTP: it sends
  through a stand-in for an http API and asks whether the rest of the subsystem still works over it.
  The pair to it is `email-failure.evaluation.test.ts`, which drives the shipped `SmtpEmailTransport`
  through real nodemailer against a real SMTP dialogue, so both sides of the seam are held by
  something that actually sends. **The evidence for the finding was in this directory the whole
  time**: `email.service.test.ts` and `cluster/mail.instance-options.ts` both subclassed
  `EmailService` to override its `protected send`, because there was no other way in — and one of the
  two had silently drifted past [04 §2.2](../../../../evaluation/04-infrastructure-subsystems.md),
  deleting a failed mail the real send keeps. A suite that has to reimplement the thing it is testing
  is a seam finding with no finding filed.

- `backup.evaluation.test.ts` — [01 §C6](../../../../evaluation/01-data-layer.md), a backup of one
  application dumping the whole cluster. Its last todo, a role with neither SUPERUSER nor CREATEROLE,
  became a case once `zibri-testing` stopped connecting every data source as the container's
  superuser: every case in the file runs as such a role now, and that one asks the server to confirm
  it before taking and restoring a backup. The file is worth reading for
  what the first run cost rather than for the result: seven of nine passed immediately and the
  round-trip did not, because the obvious fix — `pg_dump --schema <s> --clean` — makes the *schema*
  one of the dumped objects and so emits `DROP SCHEMA`, which postgres refuses while an extension
  lives there. That is the finding's own shape one level down, and the reason the dump now carries no
  `DROP` at all: `writes an artifact that cannot destroy anything by itself` is the assertion that
  came out of it, and was not in the original finding.

- `valkey-durability.evaluation.test.ts` — [01 §M16, §M17](../../../../evaluation/01-data-layer.md)
  and now [§M22](../../../../evaluation/01-data-layer.md), `unique` being enforced on one store and
  only indexed on the other. Green throughout. The case to read is *does not split a rate limit
  across two rows when the lock does not hold*: it builds a `RepositoryRateLimiterStore` with the
  lock replaced by a pass-through, which is the one arrangement that reaches a first insert racing
  another first insert — the row `version` guards every write after the first and there is no row yet
  to carry one. The rest of the block is paired: a control that stores a value nothing else holds
  sits ahead of each refusal, and the *frees a value once…* cases stop a future change from passing
  the refusals by refusing everything.

- `sql-building.evaluation.test.ts` — [01 §C5](../../../../evaluation/01-data-layer.md), a filter
  value rewriting the statement it was filtered with. All four vectors green, and the two controls
  beside them stayed green throughout, which is what makes the reds trustworthy in hindsight.

  Two of the four could not be closed by C5 alone, and that is the part worth knowing before
  touching this file: they filter a relation by an id that is not a uuid, so binding the id stops it
  rewriting the `IN` list but leaves postgres refusing to parse it. They needed the relation half of
  [01 §M21](../../../../evaluation/01-data-layer.md) fixed in the same pass. A green here therefore
  depends on two findings, not one.

- `partial-nested-update.evaluation.test.ts` — [01 §M61](../../../../evaluation/01-data-layer.md),
  an update replacing a stored object with the part of it it named. Green since the object is merged
  in. In memory only; what each store does with the merge is `partial-nested-update.cases.ts` in
  `src/data-source/tests`, run on postgres and valkey as well.

## Files

| File | Evaluation doc | Needs containers |
|---|---|---|
| `data-layer.evaluation.test.ts` | [01-data-layer.md](../../../../evaluation/01-data-layer.md) | yes |
| `sql-building.evaluation.test.ts` | [01 §C5](../../../../evaluation/01-data-layer.md) | yes |
| `valkey-durability.evaluation.test.ts` | [01 §M16, §M17, §M22](../../../../evaluation/01-data-layer.md) | yes |
| `http-and-observability.evaluation.test.ts` | [02-http-runtime-core.md](../../../../evaluation/02-http-runtime-core.md) | yes |
| `error-logging.evaluation.test.ts` | [02 §M6](../../../../evaluation/02-http-runtime-core.md), trust proxy | yes |
| `manual-routes.evaluation.test.ts` | [02 §M13](../../../../evaluation/02-http-runtime-core.md) | yes |
| `streaming.evaluation.test.ts` | [02 §M1](../../../../evaluation/02-http-runtime-core.md) | yes |
| `request-context.evaluation.test.ts` | [02 §M5, §M4](../../../../evaluation/02-http-runtime-core.md) | yes |
| `route-metadata.evaluation.test.ts` | [02 §M3](../../../../evaluation/02-http-runtime-core.md) | yes |
| `auth-and-security.evaluation.test.ts` | [03-auth-and-security.md](../../../../evaluation/03-auth-and-security.md) | yes |
| `auth-sessions-and-2fa.evaluation.test.ts` | [03 §B2, §C2, §C3](../../../../evaluation/03-auth-and-security.md) | yes |
| `caching.evaluation.test.ts` | [04 §3.6, §3.8, §3.9, §3.10, §1.8](../../../../evaluation/04-infrastructure-subsystems.md) | yes |
| `email-failure.evaluation.test.ts` | [04 §2.2](../../../../evaluation/04-infrastructure-subsystems.md) | yes |
| `email-transport.evaluation.test.ts` | [04 §5.2](../../../../evaluation/04-infrastructure-subsystems.md) | yes |
| `bootstrap.evaluation.test.ts` | [02 §C5](../../../../evaluation/02-http-runtime-core.md), [02 §C7](../../../../evaluation/02-http-runtime-core.md), [04 §1.3b](../../../../evaluation/04-infrastructure-subsystems.md), [05 §D10](../../../../evaluation/05-di-metadata-and-packaging.md) | yes |
| `schema-management.evaluation.test.ts` | [01 §C1](../../../../evaluation/01-data-layer.md) | yes |
| `backup.evaluation.test.ts` | [01 §C6](../../../../evaluation/01-data-layer.md) | yes |
| `trigram-extension.evaluation.test.ts` | [01 §C4](../../../../evaluation/01-data-layer.md) | yes |
| `scaling-and-infrastructure.evaluation.test.ts` | [04-infrastructure-subsystems.md](../../../../evaluation/04-infrastructure-subsystems.md) | no |
| `di-and-packaging.evaluation.test.ts` | [05](../../../../evaluation/05-di-metadata-and-packaging.md), [06](../../../../evaluation/06-tooling-ci-and-testing.md) | no |
| `http-client.evaluation.test.ts` | [04 §4.1, §4.2, §4.3](../../../../evaluation/04-infrastructure-subsystems.md) | no |
| `logging.evaluation.test.ts` | [04 §3.2](../../../../evaluation/04-infrastructure-subsystems.md) | no |
| `websocket.evaluation.test.ts` | [04 §3.11](../../../../evaluation/04-infrastructure-subsystems.md) | no |
| `static-assets.evaluation.test.ts` | [04 §3.12](../../../../evaluation/04-infrastructure-subsystems.md) | no |
| `mail-queue.evaluation.test.ts` | [04 §3.5](../../../../evaluation/04-infrastructure-subsystems.md) | no |
| `invoicing.evaluation.test.ts` | [04 §1.11](../../../../evaluation/04-infrastructure-subsystems.md) | yes |
| `partial-nested-update.evaluation.test.ts` | [01 §M61](../../../../evaluation/01-data-layer.md) | no |
| `connection-wait.evaluation.test.ts` | [01 §M63](../../../../evaluation/01-data-layer.md) | yes |

`bootstrap.evaluation.test.ts` exists because an application holds the process while it is running:
a second one built before the first has shut down is refused
([02 §C7](../../../../evaluation/02-http-runtime-core.md)). Anything needing its own freshly booted
application belongs there, one server per test, each shut down in a `finally`.

`schema-management.evaluation.test.ts` is the one thing that belongs there and cannot live there.
It has to declare a `@DataSource` of its own, and that registers into the static `GlobalRegistry` at
decoration time with nothing to take it back out, so the class stays visible to every test declared
after it.

Since [05 §D10](../../../../evaluation/05-di-metadata-and-packaging.md) closed, that is survivable
rather than fatal: a data source saying `allowOrphan: true` is ignored by an application that does
not name it. One *without* the flag still fails every later boot in the file, which is exactly what
`bootstrap`'s last case asserts — and why it is last. A second file is still the cheapest way to
declare a data source whose whole point is that it is not allowed to be an orphan, since jest gives
every file its own module registry.

`backup.evaluation.test.ts` is a third file for the same reason, and it has one property worth
knowing before reading it: it has **no control test**, and cannot have one. Part of
[01 §C6](../../../../evaluation/01-data-layer.md) is that the data source refuses to boot without
root credentials, so a fixture that declares them concedes the thing being asserted — which means
`beforeAll` itself is part of the red. Once the file is green, *restores the rows the dump was taken
with* takes over that job: it is what says the artifact is still a working backup rather than merely
a well-behaved file.

## Cluster tests

The Tier-1 argument of the whole evaluation — cron firing on every replica, events not crossing
processes, duplicate mail sends, incoherent caches, websocket broadcasts reaching 1/N of clients,
migrations racing — cannot be observed from one process. Not for want of trying: `markAppAsCreated()`
throws on a second `ZibriApplication` while the first is still running. That is the half of
[02 §C7](../../../../evaluation/02-http-runtime-core.md) which was declined rather than fixed, and
declined partly because forking is the honest way to get replicas anyway — two applications sharing
one module registry would share every `@Entity` and `@Injectable` in it, so they would not be the
independent replicas these tests are about. Applications *following* one another in a process do
work, which is what lets `bootstrap` boot one per test.

`../cluster/start-test-cluster.function.ts` boots N instances as forked processes against one shared
set of data sources. They live in `./cluster/` and run separately, because they cost containers and
real wall clock time:

```sh
npm run test:cluster -w zibri
```

| File | Finding | State |
|---|---|---|
| `cluster/baseline.cluster.test.ts` | none — the control | **green**, and everything else depends on it |
| `cluster/cron.cluster.test.ts` | [04 §1.1](../../../../evaluation/04-infrastructure-subsystems.md) | **green** — closed, now a regression test |
| `cluster/events.cluster.test.ts` | [04 §1.4–1.5](../../../../evaluation/04-infrastructure-subsystems.md) | **green** — closed, now a regression test |
| `cluster/heterogeneous-events.cluster.test.ts` | [04 §1.4b](../../../../evaluation/04-infrastructure-subsystems.md) | **red** — open finding, confirmed in both directions |
| `cluster/migrations.cluster.test.ts` | [01 §C2](../../../../evaluation/01-data-layer.md) | **green** — closed, now a regression test |
| `cluster/caching.cluster.test.ts` | [04 §1.9](../../../../evaluation/04-infrastructure-subsystems.md) | **green** — closed, now a regression test |
| `cluster/websocket.cluster.test.ts` | [04 §1.10](../../../../evaluation/04-infrastructure-subsystems.md) | **green** — closed, now a regression test |
| `cluster/mail.cluster.test.ts` | [04 §1.6](../../../../evaluation/04-infrastructure-subsystems.md), [10 §10.3](../../../../evaluation/10-leases-and-claims.md) | **green** — closed, now a regression test |
| `cluster/lock.cluster.test.ts` | [10 §10.1](../../../../evaluation/10-leases-and-claims.md) | **green** — closed, now a regression test |
| `cluster/shutdown.cluster.test.ts` | [10](../../../../evaluation/10-leases-and-claims.md) draining, [02 §C3](../../../../evaluation/02-http-runtime-core.md) | **green** — closed, now a regression test |

`baseline` is the control for this half of the suite: it asserts nothing about the framework, only
that the instances really are separate processes, that each is individually addressable over http,
that they share one data source the parent can read, and that a caller logged in on one of them is
accepted by another. If it goes red, no other cluster result means anything — fix it first.

That last one was added after it was missing. A jwt is issued and verified under the application's
name ([03 §B1](../../../../evaluation/03-auth-and-security.md)), and the harness had been booting
each replica under its own id — so a token minted on one instance was refused by the other, and any
scenario that logged in against one and called another failed as *not logged in*. It cost a round
trip through `otp-replay`, where it looked like a code being refused that had never been presented.
Replicas now boot under one application name; which process handled a request is a separate identity,
read from the environment with `clusterInstanceId()`.

**An application's `name` is a deployment-wide constant, not a label.** It belongs with the secret
rather than with the log prefix, and anything that varies it per process turns authentication off
between replicas.

### Writing one

An instance is configured by a `*.instance-options.ts` module that default-exports
`StartTestServerOptions` — the same options `startTestServer` takes. The path is passed rather than
the object, because a class cannot cross a process boundary. **Both sides import that module**: the
parent to learn which containers to start, the instance to boot. So nothing at its top level may
assume it is running inside an instance — `clusterInstanceId()` has to be read per request.

Observations are made from the parent with `cluster.sql()` or `cluster.marks()`, which query the
container directly. Never through an instance: the point is that the answer shares no code path
with the thing being asserted about. Instances record what they did as `ClusterMark` rows, and the
canonical assertion is "group by tag, exactly one row per group".

`cluster.kill(id, 'SIGKILL')` is a crash and `'SIGTERM'` runs the real shutdown path — several
findings are only reachable by killing a replica mid-work.

### Replicas that are not interchangeable

Every cluster scenario except one runs identical code on every instance, which is the normal
deployment and the right default. `heterogeneous-events` is the exception: it gives `instance-0` a
web role and the rest a worker role, each with a *different* subscriber for the same event.

That distinction is not cosmetic — [04 §1.4b](../../../../evaluation/04-infrastructure-subsystems.md)
is **invisible** in an identical deployment, because there the emitting instance's local subscriber
set equals the cluster-wide one. Any finding about one replica knowing something another does not
needs this shape.

The role is read with `clusterInstanceId()` **inside `onAppStart`**, never at module top level —
the parent imports the same module, and there it is not an instance at all.

## Every test data source states its schema management

`schemaManagement` is a required member of a data source
([01 §C1](../../../../evaluation/01-data-layer.md)), so the shared harness declares it:
`create-test-data-source.function.ts` says `'synchronize'`, which is what creates the tables for
every framework entity that the whole suite then reads and writes. A new data source written for a
test needs the same line, or it will not compile.
