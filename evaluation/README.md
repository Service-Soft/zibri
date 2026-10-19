# Zibri — Enterprise Adoption Evaluation

A technical due-diligence review of Zibri, framed as: *why might a major international
company decline to adopt this as its main backend technology?*

**Scope:** code and architecture only.
**Explicitly out of scope** (by request): project maturity, community size, ecosystem breadth,
number of contributors, adoption, "it's new". None of the findings below rest on those.

**Focus areas:** robustness, performance, raw utility, documentation, developer experience.

---

## Verdict

*As written on 2026-08-04, before the rework. What is still open is indexed in
[11](./11-whats-left.md).*

Zibri is a coherent, well-crafted, unusually broad **single-instance** framework.
It is not adoptable as a primary backend platform for a large organization today, and the 
reasons are architectural rather than bug-shaped.

The blockers cluster into six groups. Any one of them independently fails a standard
enterprise architecture or security review:

1. **Nothing stateful survives horizontal scaling.** Cron, events, the mail queue, websocket
   rooms, caching and rate limiting are all per-process in-memory singletons, and most of them
   have no seam to swap in real infrastructure.
2. **Defaults that destroy data.** `synchronize` is opt-out, migrations take no lock, and
   down-migrations run automatically on version downgrade.
3. **Security defaults and gaps.** Hardcoded `Access-Control-Allow-Origin: *`, routes open by
   default with no warning, no access-token revocation, no rate limiting on any built-in auth
   endpoint, secrets stored in plaintext.
4. **No enterprise identity.** No OIDC, SAML, LDAP, JWKS, asymmetric JWT, mTLS, API keys or
   multi-tenancy — and the strategy interface is shaped around local-password login.
5. **The observability floor is below the enterprise bar.** Every 5xx logs as `"Global Error"`
   with an empty stack; no access log, no correlation IDs, no tracing; and the Prometheus
   integration is an unauthenticated remote OOM.
6. **Operational lifecycle.** No in-flight request draining, no readiness signal, no
   `unhandledRejection` handler, unconditional `process.exit`, and `ts-node` as a mandatory
   production dependency.

The pattern is consistent: **the design work is strong; the multi-process and
adversarial-input dimensions are largely unexplored.** Most Tier-1 items are one architectural
decision each — a cron coordinator, a socket.io adapter, `FOR UPDATE SKIP LOCKED`, a CORS
option, default-deny routing — rather than sprawling rewrites.

---

## Contents

| File | Area |
|---|---|
| [00-executive-summary.md](./00-executive-summary.md) | The prioritised rejection list — read this first |
| [01-data-layer.md](./01-data-layer.md) | Data sources, ORM, repositories, migrations, change sets, backups |
| [02-http-runtime-core.md](./02-http-runtime-core.md) | Bootstrap, routing, body parsing, middleware, errors, lifecycle, websockets |
| [03-auth-and-security.md](./03-auth-and-security.md) | AuthN/AuthZ, JWT, 2FA, crypto, rate limiting, CORS, cookies |
| [04-infrastructure-subsystems.md](./04-infrastructure-subsystems.md) | Cron, events, mail, cache, metrics, logging, threads, HTTP client, backups |
| [05-di-metadata-and-packaging.md](./05-di-metadata-and-packaging.md) | DI container, decorator/metadata model, TS config, dual CJS/ESM, peer deps |
| [06-tooling-ci-and-testing.md](./06-tooling-ci-and-testing.md) | CI/CD, release process, the custom TSX compiler, CLI, testability |
| [07-documentation-vs-code.md](./07-documentation-vs-code.md) | Claims the implementation does not support; missing documentation |
| [08-strengths.md](./08-strengths.md) | What is genuinely good, and worth preserving |
| [09-method-and-coverage.md](./09-method-and-coverage.md) | How this was produced, what was verified, what was not reviewed |
| [10-leases-and-claims.md](./10-leases-and-claims.md) | A cross-cutting class of cluster bug, found while fixing the Tier-1 items |
| [11-whats-left.md](./11-whats-left.md) | What is still open, grouped by the kind of work it is — the short answer to "what now" |

---

## The rework

The findings are being worked through on `v3`, a cluster at a time. **The heading of each finding is
the authoritative status** — `~~CRITICAL~~ **FIXED**`, `**PARTIALLY FIXED**`, or unchanged — and a
closed one carries a blockquote underneath saying what changed, what was decided against, and what it
still does not cover. Those notes are the point: several fixes turned out differently from what the
finding predicted, and a few uncovered defects nobody had filed.

Closed so far, roughly in order: the lease fold behind every cluster claim (10), valkey durability
and the atomic write primitives (01), the cron and event coordination races (04), configurable CORS
(02 C1 / 03 F1), the 2FA cluster (03 C2/C3/C4), refresh-token rotation (03 B2), token revocation and
the confused deputy (03 A3/A4), rate limiting (03 E1/E2), routes being open by default (03 A1),
which closed by making the choice required rather than by picking one, and credentials at rest
(03 B5/C1), which needed a hash strategy the framework did not have, the auth endpoint oracles
and lifetime defaults (03 B4/B6), the cookie parser (03 F3), the security trail (03 G1), which turned
out to need an error class rather than a log line, and the cookie transport cluster (03 F2/F4), where
rotating the csrf token needed a delivery channel and turned up a missing
`Access-Control-Expose-Headers`, jwt verification (03 B1/B3), where the framework's own test
fixtures turned out to hold the misconfiguration the new startup check refuses, password hashing
(03 D1/D2/D5), where the obvious fix - bumping the strategy version - turned out to be a registry key
that would have refused to boot, and what a limiter costs and does when it cannot answer (03 E3/E4),
where the lock was demoted to contention avoidance and a version on the row took over correctness,
and a full store learned to refuse a new key rather than evict an old one, and row level access
(03 A2, the half that made it a MAJOR), which closed by deleting `@Auth.belongsTo` rather than
extending it: a route decorator cannot see the query a list handler runs, so the declaration moved to
the entity and the enforcement to the repository - and a declarative ownership option shipped there
first and was then deleted too, once it turned out a plain function said everything it said and the
one thing it could not, and sql built by concatenation (01 C5), where the two sentinels the finding
blamed turned out to be innocent - substituting a column into a finished statement is safe once the
statement holds nothing the caller wrote, so binding the input closed three of the four vectors
without touching the mechanism, and the fourth needed a second finding fixed with it, and the three
remaining data layer criticals (01 C1/C4/C6) — schema management, which closed by deleting
`synchronize` from the options type rather than flipping its default, the trigram extension, which
closed by asking whether it was already installed before claiming the right to install it, and
backups, where the finding argued about superuser credentials going *in* and the artifact turned out
to carry every role's password verifier back *out*, and one application per process (02 C7), which
turned out to be a state machine missing its last transition rather than the global mutable state it
was filed as, and error logging (02 M6/M8), where the 5xx half was one wrapper in two handlers and
the 4xx half closed by refusing what the finding asked for - logging every client error would put a
warning on a missing favicon, so the security relevant ones went to the audit trail and the rest to a
new access log that is off by default because metrics answer the same questions more cheaply, and
`unique` meaning one thing on postgres and another on valkey (01 M22), which closed by making the
index that had been built for lookups the thing that enforces the declaration, and by giving both
stores one error to refuse a duplicate with, and routes registered on the router rather than through a
controller (02 M13), which reached no authorization at all and had no way to be given any - the
framework's own docs surface among them, which the fix first pointed at `defaultAuth` and then, once
it turned out that a browser navigation carries no bearer token, gave an option of its own instead,
and correlation ids (02 M7), where
the first attempt reproduced the finding - a request context token is resolved when somebody asks for
it, so a request that logged nothing still had no id, and the middleware that establishes one is what
made the token worth reading, and multipart bounds (02 M10), where the limits moved from one
application-wide token onto the body as well, because an endpoint that could state how much its body
may weigh but not how many parts it may have was saying half of one thing in two places, and a
download that failed mid-stream (02 M1), which threw from inside the listener written to handle it -
so nothing ended the response and, since the review added a rethrowing `uncaughtException` handler,
one failed download ended the process, and a server that could not bind its port (02 C5), which had
already been closed by a fix filed under another finding entirely - and whose one remaining word,
*anywhere*, turned out to be the important one, and a request context that never learned which route
it matched (02 M5/M4), where the dead code the finding complained about was the only thing keeping
the framework safe, and a json response being written three times over (02 M2), where the same
pattern on the websocket side turned out to be necessary and wasteful for different reasons, and the
missing baseline http capabilities (02 M11), where the test written to prove one of the nine rows
wrong turned up the defect that row had been describing badly, and a route's declaration being read
back on every request (02 M3), which closed as a registry rather than as a cache - and where the
performance half turned out to be the smaller one, and the mail transport having no seam (04 5.2),
where the finding turned out to be provable rather than arguable: the only way to send through
anything but nodemailer was to subclass `EmailService` and override a `protected` method, and **two
of this repository's own fixtures did exactly that** — so the project that wrote the class could not
swap the transport through its public surface either. One of those overrides had drifted past a
finding closed after it was written, deleting a failed mail the real send keeps, which is what a
seam nobody can use costs. What is still open is indexed in [11](./11-whats-left.md).

The dependency injection container (05 D1/D9) is where a finding was right about the mechanism and
wrong about the fix. D1 says `resolvingStack` is maintained and never checked for cycles, which is
true - and checking it would have caught only half of them, because that array was threaded through
one call chain and `inject()` called inside a factory starts a fresh one, losing every frame above
it. **A cycle running through two factories was invisible to the very stack meant to describe it**,
and adding a membership check to the parameter would have looked like a fix while leaving that case
overflowing. The stack moved onto the container instead, where it brackets the whole synchronous
construction; what makes one array enough is that providers cannot `await`, which is itself an open
finding, so the invariant is recorded where whoever closes D6 will meet it.

D3 is the same shape, one step further: the finding is right that nothing detects a duplicate
registration, and the detection it asks for would have refused the framework's own configuration
mechanism. Overriding a default *is* a second registration of a token, and so is
`[...sharedProviders, myOverride]`, an idiom this repository uses in 29 of its own test files -
a providers array is read front to back and the last entry wins, which is a decision written down
where the next reader can see it. **What has no decision behind it is two plugins claiming one
token**, because neither author wrote the array their providers end up in and the winner is settled
by the order `plugins` happens to be listed in. That is refused now, from the application
constructor rather than from the container: intent is only visible where the composition happens,
and the container is handed providers with no idea who wrote them.

D2 is where a finding named a missing feature and the fix turned out to be mostly about refusing
things. Adding a request scope is small - the request context is already created per request and
entered for exactly as long as one is handled, so a map on it is the whole store. What the scope
needs to be worth having is the two errors around it: a request scoped value asked for where no
request bounds its life, and a request scoped value built into something that outlives the request.
**Without the second one the scope is a worse bug than the thing it replaces** - a service
constructed once would hold the first request's tenant and answer every later request with it,
which is silent and wrong where reaching into AsyncLocalStorage at call time was merely awkward.
The finding also asked for a scope alongside `cache: boolean`; the two are one setting, so they were
unified rather than stacked.

D5 was filed as a bad error message and the bad message turned out to be the smaller half. The
literal `Could not find token` it quotes is reachable, but the common failure never got that far:
`design:paramtypes` keeps a class and flattens everything else to `Object`, and `Object` was
injected like any other token, so an interface-typed parameter produced *no provider for `Object`* -
a token the reader never wrote, about a class the message does not name. **The container has to know
which values in that metadata are not types at all**, which is a small fixed set, because
TypeScript's fallbacks are what it means when the type is gone. Once it stops asking for them, the
error can be made of what is actually known: the class, the position, what was recorded, and the
file. What cannot be recovered is *why* the type is gone - an interface and a class caught in an
import cycle are the same `Object` by then - so the message names both causes rather than picking
one.

D6 is the finding where the constraint mattered more than the feature, and it took four rejected
designs to state it: `inject()` is synchronous, so the await has to have happened already; so the
container must resolve asynchronous providers before any consumer code runs, other providers'
factories included; so it must know the order among them beforehand; and a factory body is opaque to
it. **The ordering information therefore has to exist outside the bodies** - a proof, not a
preference, and the reason Nest and Angular both ask for a declaration while Inversify offers a
second resolve function. What saved it from being a tax on everything is that a class is not opaque:
its constructor parameters are already read, so only a factory declares anything, and only for what
it reaches. The other half is refusing `inject()` inside such a factory *outright*. A softer rule
would have been worse than none, because the case that works there is the case that breaks on the
next reordering, and the two are indistinguishable where they are written. Refusing all of them
costs no coverage: factory bodies run at every boot, so the mistake is found the first time the
application starts rather than the first time a branch is taken.

The ESM entry point (05 P1/P2, 06 CI4) is the one finding whose fix was to delete the feature. The
package advertised `dist/esm/index.mjs`, a file the build never emitted, so every consumer writing
`import { ZibriApplication } from 'zibri'` got `ERR_MODULE_NOT_FOUND`. The post-build script that was
supposed to produce it contains no rename at all - but fixing that only reaches the second layer,
because `dist/esm` held CommonJS (`module: nodenext` reads the format off a `"type"` field that did
not exist), and forcing the format reaches the third, where real esm fails on the source's
extensionless relative imports. **Each layer was found by running it rather than by reading it.**
What decided the shape of the fix was neither of those: `GlobalRegistry` and `DiContainer` are module
level singletons, so a genuine dual package hands a consumer whose graph reaches both halves two
containers, with every `inject()` on one side blind to the other. One build, and an esm consumer
reaches it through node's interop with all 460 named exports - held now by the first test in the
suite that loads the built package rather than `src`.

D7 is that same argument arriving from the other direction, and it is the one finding here whose fix
is deliberately *not* to make the broken case work. Two copies of `zibri` in one process - a lockfile
that could not dedupe, a plugin that depended on the framework instead of declaring it as a peer -
had two containers and two registries that could not see each other, and nothing said so. Hoisting
the singleton onto a realm-wide slot is easy, and `reflect-metadata` shows it works: it already puts
every piece of metadata on the realm's own `Reflect`, which is why the metadata half of a duplicated
install is the half that keeps working. **But one shared container would not make two copies work.**
The classes stay distinct - copy A's `BaseEntity` is not copy B's, nor its errors, nor its request
context - so every `instanceof` across the seam would keep answering no about a value that is exactly
what it claims to be, in whichever code path happened to cross it. That is most of a fix plus a class
of bugs with no visible cause, which is worse than the silence it replaces. So the copies count
themselves through the one registry the realm genuinely shares, and startup refuses more than one,
naming `npm ls zibri` and the peer dependency that fixes it. The test builds a real second copy
rather than describing one: a reset module registry re-evaluating the same files *is* what two
directories in `node_modules` produce.

04 2.3 and 2.4 were filed as two findings and turned out to be one, which is the useful part. 2.4 is
that a subscriber whose hook threw was indistinguishable from one that returned: the `error` was
written to the row faithfully, and `hasFinishedRun`, the completion check and the cleanup job all
asked whether a *row existed* instead. So the event flipped to `FINISHED` on the strength of a
failure and was deleted a day later — the same shape as 2.2, a record nothing reads rather than a
record nobody keeps. **The boolean was the obstacle both times.** "The run is over" and "the run
succeeded" are two questions, and one timestamp could only answer the first, exactly as
`CronJobEntity.active` could only answer one of 2.1's two. Three states fix that, and the third one
— a run that failed and is not over — is what makes 2.3 possible at all: the tight loop existed
because there was nowhere to put such a run, so every attempt had to happen before the row was
written. Once the row can say `PENDING_RETRY`, the attempts spread across deliveries with a
doubling backoff, and `attempts: 3` starts meaning what a reader would assume it means.

The release process (06 CD1/CD2/CD4) is the one place where the review was simply wrong about a
fact it could not see. CD2 called the missing test gate before publish a CRITICAL, having read
`cd.yml` as if it were the whole release process; the gate is a branch protection rule on `release`,
so nothing reaches that branch without a green build on `dev` first. Withdrawn rather than fixed -
re-running the suite in the release workflow would verify a tree GitHub had already refused to let
through unverified. What was real is what sat beside it: the build that produced the tarball resolved
its own dependency graph instead of installing the lockfile, so *the tested tree* and *the published
artifact* were two different claims, and `id-token: write` was granted for a provenance attestation
nothing ever produced. **A guarantee enforced outside the repository is invisible to a review of the
repository**, which is a finding about the review as much as about the project - so what the test
holds now is the half that is visible: that a merged pull request into `release` stays the only door
into the release path.

M3 is worth reading for what a finding can be wrong about while being right. Resolving what a route
declared is not a read: it is where `@Auth.skip` beside a check is refused and where the "useless
skip" warnings come from, so doing it per request meant an application whose route says two
contradicting things **booted cleanly and served a 500 to whoever called it first**. And the finding
named the place to bake the answer in - the per-route closure the router already builds - which is
exactly where it could not go: the router is initialized before the auth service, so a route resolved
there reads a `defaultAuth` the application has not stated yet, and an unstated default is
indistinguishable from `'public'`. Every route in the framework would have quietly become
unauthenticated. The option moved to `beforeAppInit`, the answers moved into a `RouteRegistry`
alongside the `ModelRegistry` that already existed, and the framework's own fixtures had to move
first: three controllers in `auth.service.test.ts` carry declarations nothing can satisfy and were
registered on a running server.

That fourth vector is the one worth reading. Binding an id stops it rewriting the `IN` list, but
postgres still parses it as a uuid and refuses it, so C5 could not close without the relation half of
01 M21 closing too. Fixing *that* then exposed the defect underneath both: the narrowing trusted a
declaration - `primary: true` means uuid - that nothing enforced, while the framework itself stored
ids like `user:42`. Rows were written, listed, and never found again, and rate limiting on a shared
store had silently stopped reading its own state. **A declaration the read side trusts and the write
side never makes true** is now a named class with two instances, 01 M21 and the new 01 M22.

M22 grew a consequence before it closed, and it is what moved it. The rate limiter's store catches a
failing `create` and says in a comment that the only thing it can collide with is the same key being
created by somebody else — true on postgres, false on valkey, so a limit could end up split across two
rows and let a caller through. The row `version` that closed 03 E3/E4 guards the read-modify-write and
has no equivalent for the *first* insert: there is no row yet to carry one, so the unique constraint
is what stands in for it, and on valkey nothing did.

Closing it needed the index M15 had already built, read under a grant on the index key, and a second
thing the finding never mentioned: *which error*. Making valkey refuse a duplicate only closes the
finding if both stores refuse it the same way, so one `UniqueConstraintViolationError` is thrown by
both — the point of `unique` being declared on the entity is that nothing downstream has to know which
store it landed in. Spotting a violation stayed dialect specific and moved to the data source; what to
do about one did not, and stayed in the driver.

M5 is the one to read for what a finding can miss about its own fix. It reads as a documentation
defect - three sentences in `docs/request-context.md` that describe branches no request ever takes -
and the missing line is genuinely one call. But the branches were unreachable *because* a http
request is routed after its context exists, and the three `context.has(...)` short circuits filed
under M4 as dead code return a token's value regardless of the arguments the call named. Writing that
one line would have made them live: a check asking whether a caller is logged in *with these
strategies* would have been answered for a different set, and the call that demands a user or throws
would have returned one without ever reaching the demand. **The dead code was the only thing making
the framework safe.** Both findings had to close together, and one of them closed by deletion.

M11 is worth reading for the opposite reason: it is the one place where writing a test to show a
finding was *wrong* was what found the bug. The row said ETag was absent because nothing in the
framework reads `If-None-Match`. Express reads it, so the row looked like a mistake - and the test
asserting a `304` failed anyway. The router had been lowercasing `request.method` to match the
framework's own enum, and express's freshness check compares against `'GET'`, so no response could
ever be a `304` and every revalidation downloaded the whole body again. The same mutation had
express answering a `HEAD` *with* a body. Both were filed as a MINOR about third-party middleware
being inconvenienced. **A finding that is wrong about the mechanism can still be right about the
symptom**, and the two entries never met because one described a cause and the other an effect.

07 Part 1 is the finding that turned out to be about the process rather than about the pages.
Sixteen of its twenty-two rows were stale — not answered, but overtaken: closing some *other*
finding changed a required option or a type, and the page demonstrating it was never revisited.
`defaultAuth` became required, `CURRENT_REQUEST_CONTEXT` widened to a union, `FsPath` became
branded, `Repository`'s constructor grew to six arguments. Each left examples behind that no longer
describe anything. So the fix is a test rather than an edit: **`src/docs-examples.test.ts` compiles
every documented example on every run**, one module per page, imports merged, checked against the
framework's own source under the options `zi new` scaffolds. A page is the unit because roughly
three in five blocks are excerpts of what came before them — assembling per block would have meant
adding a boilerplate import to about 140 examples to check nothing new. **Three of the examples that
would not compile were right about an api that was wrong**: `Omit` over a union collapses to the
common keys, so every form-data-only body option was documented, implemented and unreachable; two
types a DI token names were never exported; and `changePropertyOfEntity` accepted an old name the
entity no longer carries but not a new one, so the `down()` of a rename could not be written at all.
The README's own claims were checked the same way — `engines` says Node 24 and the quick start asked
for 22.

The change set pair (01 M10/M11) is the audit trail failing at the two things an audit trail is for.
M10 recorded **every bulk change with no actor on it** — `createdByUserId` written for a field the
entity calls `createdBy` — and it survived because the object was built in a callback whose return
type was inferred, and an inferred literal is not checked for excess properties. The key belonged to
nothing and went nowhere. The singular paths had asserted the actor from the start; the bulk paths
had no assertion at all, which is the whole reason a wrong field name could sit there. M11 is the
same subsystem answering the other question: the change and the record of it were two independent
statements, so a failure between them left either a mutation nothing recorded or a record of a
mutation that was rolled back. **It was already fixed in exactly one place** — `updateAll`, with a
comment naming the risk — and that asymmetry was worse than the uniform bug, because the same class
wrote some audit rows atomically and some not with nothing saying which. Every path takes a
transaction now, two of them over more than a pair: a reset performs three writes, and a rollback
walks several resets and must not stop between two of them.

The last two red evaluation tests (01 M9, M14) closed together, and triaging the list they sat in
found four more rows that were **stale rather than open** — M6's pool leak (the release is in a
`finally`, with a test named for the throwing commit), M7's `poolSize: 100` (it is 20, and its own
body already said FIXED while its heading did not), and M16 and M17, both carrying a blockquote no
heading reflected. The same shape as 07 Part 1: fixing one finding closes another and nobody
revisits the record. **M9 closed by declining what its own test asserted** — a `databaseDefault`
option would have been a second way to say what `default` already says, so a *constant* default
becomes the column's default and a function stays in the application, because a column cannot run
one. **M14 is the release valve M4 owed**: bounding `findAll` was right and left `take: 'all'` — the
same unbounded read, spelled deliberately — as the only way past it. `stream` walks the result
instead of holding it, on `RepositoryDriverInterface` for the reason `schemaLock` is there, with no
order on any data source because ordering means holding all of it.

**Executable form:** `packages/zibri/src/__testing__/evaluation/`, cluster scenarios under
`cluster/`. Every expectation there describes the *fixed* behavior, so a file is red until its
finding is closed — see that directory's own README for why that is deliberate.

**Verifying a change** (always from `packages/zibri`, never the repo root):

```sh
npx tsc --noEmit -p tsconfig.json   # baseline is 7 pre-existing errors, all in .test.ts
npx eslint src --max-warnings=0
npx jest <pattern>                  # needs a container runtime for anything booting a server
npm run build -w zibri              # from the repo root, and not the same check as the first line
```

**The last line is not redundant.** `tsconfig.json` compiles `src` including its tests;
`tsconfig.cjs.json` starts from `files: ["src/index.ts", …]`, so it sees only what the barrel
reaches — which is the framework as an application gets it. Anything a *test file* can widen is
therefore invisible to the first line and caught only by the fourth. `ZibriEventMap` is the live
example: it is an empty interface an application fills in by declaration merging, three test files
merge into it, and with them in the program `keyof ZibriEventMap` is a real union. Without them it
is `never`, and `Record<never, …>` has no key that can be read. The first line was green and the
build failed with three errors.

**The evaluation suites are red on purpose**, one test per open finding they hold, so a red run of
`test:evaluation` is not a broken build. **A red test is only evidence of an open finding while the
finding still wants what the test asserts.** Triaging the suites against the chapters found tests
asserting designs that were decided against — the mail queue's `attempts` and `lastError` on `Email`
(04 §2.2), a `databaseDefault` option (01 §M9), `exactOptionalPropertyTypes` (05 §M2), a `./testing`
subpath (06 §T2) — and each was rewritten to assert what was built, or removed. Todos that stood for
closed findings became pointers to the test that proves them, or got that test (01 §C3's had none at
all); writing those found two defects, each fixed in its own finding (04 §1.3, 03 §G1). The last
todo, 03 §H19's, became a pointer once the auth routes were built.

## Severity legend

| Level | Meaning |
|---|---|
| **CRITICAL** | Independently sufficient grounds to reject, or a live security/availability defect |
| **MAJOR** | Would have to be fixed or worked around before a production rollout |
| **MINOR** | Real, but survivable; mostly DX and polish |

Every finding cites `path:line` against the working tree at the time of review
(branch `v3`, 2026-08-04). Findings marked **[verified]** were re-read directly during
synthesis rather than accepted from a delegated pass.
