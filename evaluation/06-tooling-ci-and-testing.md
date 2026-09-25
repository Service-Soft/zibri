# Tooling, CI/CD, the Custom TSX Compiler, and Testability

> This area's delegated pass was terminated early by a session limit. The findings below are my own
> direct review of `.github/workflows/ci.yml`, `.github/workflows/cd.yml`,
> `packages/zibri/src/__testing__/test-server/start-test-server.function.ts`,
> `packages/tsx/package.json`, `packages/tsx/src/parser/type-erasure.ts` and
> `packages/cli/package.json`. What I did **not** review is listed in
> [09-method-and-coverage.md](./09-method-and-coverage.md).

---

## T. Testability of a consumer's own application

### T1. The framework's own harness has to reach into private statics — ~~MAJOR~~ **PARTIALLY FIXED**

> **A third instance of this, found by its side effect rather than by reading the code.** A run left
> a `versions/1.0.0.json` behind inside `packages/zibri/src` — in the source tree, where git could
> see it — and a later run of a different suite failed to boot on it. Three files wrote it, and each
> one declared a subclass whose constructor did `(this as any).versionsPath = testVersionsDir`,
> including this repository's own `__testing__/test-server/providers.ts`. Same defect as the two
> casts below and one turn worse: `VersioningService` and `LocalizeService` resolved a write path
> from `__dirname` at construction, so overriding it meant substituting a *class*, and a subclass has
> to be constructed by the very container the test is trying to configure.
>
> **The seam already existed and was one token wide.** `FILE_UPLOAD_TEMP_FOLDER` is a DI token, so
> `VERSIONS_PATH` and `TRANSLATIONS_PATH` are two more of exactly its shape, injected rather than
> computed. All three subclasses are gone, each replaced by a `useValue` in a providers array — which
> is what a consumer would have had to write, and had no way to.
>
> **A path that can be pointed somewhere can also clean up after itself, which is the half worth
> having.** `startTestServer` makes one directory per server under `src/__testing__/file-output`,
> registers the three write paths into it *ahead* of the call's and the application's own providers
> so a suite naming one still wins, and removes it in `shutdown()`. The lifetime is the **server's,
> not the application's**: `reInit` re-registers the *same* directory rather than making a fresh one,
> because a reInit is a restart and a restart that finds nothing is not testing a restart — and
> because a reInit naming its own providers replaces the array these were in, so inheriting them was
> never available. An `init()` that throws leaves the directory behind, since a boot that failed is
> exactly when what it managed to write is worth reading. A cluster gets one for all its instances,
> handed to each fork by environment: replicas of one deployment shared these folders before anybody
> chose them, because the framework resolved them relative to itself.
>
> The `.gitignore` entry that had been hiding the stray `versions` folder came out with it. An ignore
> rule over a directory nothing resolves to any more would mask a regression of the bug it was
> papering over.
>
> Covered container-free by `test-server-scratch.test.ts`, including the two cases that are the
> design rather than the feature: the directory **survives a `reInit`**, and a suite naming one of
> the three paths itself gets its own.
>
> **The two `readonly` casts still stand**, and this makes them sharper rather than smaller:
> `assetService.assetsPath` and a data source's `options` are now the only two things the harness
> overrides with no supported way to say so, beside three that have one. Whether the framework's own
> defaults resolve those paths consistently is a separate question, filed as
> [05 §P6](./05-di-metadata-and-packaging.md).

> **The private statics are gone**, both of them, in both places. Neither needed a reset API of its
> own in the end: an application's `shutdown()` now discards its container and returns the state
> machine to `OFFLINE`, so the harness has nothing left to undo and calls `initDiContainer()` only to
> fill the fresh container the injects above `new ZibriApplication` read from. See
> [02 §C7](./02-http-runtime-core.md), which is the same defect from the other side.
>
> **The `process.exit` bullet below is stale** and was already stale when it was written: `shutdown()`
> exits only on the signal path (`if (signal != undefined)`), so a direct call has been safe since
> [02 §C3](./02-http-runtime-core.md). The harness still stubs it, which is now belt and braces rather
> than a requirement.
>
> **The two `readonly` casts stand**, and they are the honest remainder of this finding: there is
> still no supported way to point a data source at another port or an asset service at another
> folder, so a consumer's harness casts the same way this one does.
>
> One of them then cost a real afternoon, which is the argument for closing the rest of this finding
> rather than living with it. `asset-service.test.ts` casts `publicAssetsPath` away to point the
> singleton at a fixture folder and never puts it back, and the next `describe` boots a whole
> application around that same singleton. It only ever passed because the harness reset the container
> underneath it — so removing that reset (above) turned a latent leak between two `describe` blocks
> into two 404s, and the failure named the assets rather than the cast three tests earlier. **A
> `readonly` cast is a mutation with no owner**: nothing in the type system says it has to be undone,
> so nothing does.

`packages/zibri/src/__testing__/test-server/start-test-server.function.ts:117-119` (and again at
`:165-166`)

```ts
// Reset singleton — every test file gets a clean container with no stale instances.
DiContainer['singleton'] = undefined;
initDiContainer();
GlobalRegistry['appData'].state = AppState.OFFLINE;
```

Bracket notation to bypass `private`, twice, because there is no public reset or dispose API on
either the container or the registry. Any customer wanting isolation between test files must
reproduce exactly this hack against private internals that carry no compatibility guarantee.

Two more of the same shape in the same file:

- `:63` — `jest.spyOn(process, 'exit').mockImplementation(() => undefined as never)`. The harness
  must **stub `process.exit`**, because `app.shutdown()` calls it unconditionally
  ([02](./02-http-runtime-core.md) §C3). A consumer cannot shut a Zibri app down in-process
  without killing the test runner.
- `:194` — `(assetService.assetsPath as string) = testAssetsFolder;` and `:48-55`
  `(dataSource.options as ValKeyOptions) = {...}` — casting away `readonly` to mutate services,
  again because no public override exists.

### T2. The good test helpers are not importable — ~~MAJOR~~ **FIXED**

> **Closed by a package rather than the subpath the finding asks for**, and the two costs measured
> below are why. `zibri-testing` publishes `startTestServer`, `StartedTestServer`, `reInit`,
> `startTestCluster`, an in-process data source, a postgres one, and the providers a test wants
> instead of the shipped defaults. As a package of its own, `testcontainers` is a plain dependency
> of something a consumer installs as a devDependency - no optional peers, no lazy `require`, and
> the framework's own manifest is untouched. It peer-depends on `zibri`, so it drives the consumer's
> copy rather than bringing a second one, which [05 §D7](./05-di-metadata-and-packaging.md) refuses
> at boot.
>
> **Two of the three costs below turned out not to exist.** The jest coupling was stale: the comment
> said `shutdown()` calls `process.exit` unconditionally, and it has been guarded by
> `if (signal != undefined)` since [02 §C5](./02-http-runtime-core.md). No suite raises a signal in
> the runner process, so the spy and the `@jest/globals` import came out and nothing is committed to
> a test runner. The testcontainers coupling dissolved with the packaging decision, and the harness
> starts a container only for a data source that needs a server of its own.
>
> **The third was real and is where the work went.** `defaultTestServerProviders` mixed a harness
> with this repository's furniture, and splitting them is the finding's actual content. What ships
> is what is wrong *for a test* rather than wrong: a work factor sized for an attacker, a scheduler
> that fires on its own, a rate limit written for real callers, a mail transport that refuses to
> send. What stayed is this repository's: its user entity, its version folders, its own templates.
> The same split runs through the cluster harness - the shipped default takes the cron and thread
> stubs back out, because those are the subsystems a cluster test exists to observe, while the two
> scenarios that log in name this repository's user themselves.
>
> **It found a defect on its first run that nothing here could have found.** All 127 suites import
> relative paths; `zibri-testing` is the first module in the repository that imports `zibri` by
> name, the way every consumer does - and the application would not start. See
> [05 §M4](./05-di-metadata-and-packaging.md).
>
> **[§T3](#t3-no-documented-testing-story-at-all) is still open**, and this makes it sharper rather
> than smaller: there is now a package to document.

> **Sharpened, not fixed.** [05 §P4](./05-di-metadata-and-packaging.md) stopped publishing
> `src/__testing__`, so the helpers are now absent from a consumer's `node_modules` rather than
> present and unreachable. The finding's own sentence about them "physically sitting there" no
> longer holds, and nothing else about it changed.
>
> **What answering it costs, measured rather than guessed.** `start-test-server.function.ts` imports
> `@jest/globals` at the top — it spies on `process.exit` in the constructor — and reaches
> `testcontainers` and `@testcontainers/postgresql` through `start-data-source-containers`. All
> three are devDependencies today. Exporting `./testing` publishes them as three more optional
> peers and commits the framework to jest as *the* test runner, which is a larger promise than a
> subpath export.
>
> **And not all of it is a harness.** `defaultTestServerProviders` seeds this repository's own
> fixtures — its test users, its data sources, a rate limit raised to 10000 so the auth suites can
> run. Splitting the general part (`startTestServer`, `reInit`, `DiContainer.reset`) from the part
> that is this repo's furniture is the actual work, and it is a public API decision rather than a
> packaging one. It wants [§T3](#t3-no-documented-testing-story-at-all) answered alongside it,
> since a testing entry point nobody documents is only half an answer.

`packages/zibri/package.json:7-15` exposes exactly two entry points:

```json
"exports": {
    ".": { "types": "...", "require": "...", "import": "..." },
    "./package.json": "./package.json"
}
```

There is no `zibri/testing` subpath. `startTestServer`, `StartedTestServer` and `reInit` live in
`src/__testing__/` and are not re-exported from `src/index.ts`. Because `files` includes `./src`
([05](./05-di-metadata-and-packaging.md) §P4), the code is physically sitting in the consumer's
`node_modules` and is still unreachable through the package's own export map.

Net effect: the single most valuable DX asset in the repository — a real
testcontainers-backed server harness with lifecycle reset — is framework-internal. Every adopting
company rebuilds it, including the private-field resets from T1.

### T3. No documented testing story at all — ~~MAJOR~~ **FIXED**

> **Fixed** by `docs/testing.md`, and by the shape the page had to describe before it could be
> written.
>
> **Writing the page found that the harness answered the wrong question.** It could build a server
> out of controllers, providers and data sources a test named — which is what the framework's own
> suite wants, because the framework is not an application. A consumer has an application already,
> and a test assembling a second one out of its parts is testing something adjacent to it: the parts
> it remembered to list, with the framework's defaults wherever it forgot. So `startTestServer` now
> takes the application itself, as the options it is built from, and resolves every key **call,
> then application, then harness default**. A test names the one thing it is about and inherits the
> other forty.
>
> **The application had to be exported before it could be handed over.** `zi new` wrote
> `new ZibriApplication({ ... })` inline inside `start()`, so nothing but the process entry point
> could reach it. It now scaffolds three modules — `application-options.base.ts` for what the
> application *is*, `application-options.ts` adding where it stores that, and
> `__testing__/test-application-options.ts` adding an in process data source and
> `defaultTestProviders` on top of the application's own. **The split is forced rather than
> stylistic**: importing a module registers what it declares, and
> [05 §M4](./05-di-metadata-and-packaging.md)'s registry refuses a data source that is registered
> without being deployed — so a test module that spread the production options would boot an
> application carrying the production data source. The scaffold also gained a jest config, a `test`
> script, `zibri-testing` as a devDependency and one example test, because a test options module
> with nothing to run it is furniture.
>
> **What the project decides, the project decides.** The harness has no opinion about which defaults
> a test wants: it merges, and `defaultTestProviders` is a list the scaffolded test options apply
> themselves. That keeps `startTestServer` dumb and puts the policy where the application can see
> it.
>
> **Two things this turned up.** An option that is *present and undefined* takes away the default
> `ZibriApplication` would have filled in — `bodyParsers: undefined` is a `TypeError` at
> construction rather than the two default parsers — so the merge omits a key rather than emitting
> `undefined` for it. And a cluster instance whose options named no providers fell back to
> `defaultTestProviders` rather than `defaultClusterProviders`, which meant the cron and
> multithreading **stubs** were active in the five cluster scenarios that name none: a cluster test
> of a scheduler that schedules nothing cannot fail for the reason it was written. The fallback is
> the cluster's own now.
>
> **And one the move in [§T2](#t2-the-good-test-helpers-are-not-importable) had introduced, which
> only a cluster run could show.** Every cluster instance failed to boot on
> [05 §D7](./05-di-metadata-and-packaging.md)'s own refusal: *2 copies of zibri are loaded in this
> process.* A forked instance is a plain node process, so the entry's `import ... from 'zibri'`
> resolves through `node_modules` to the **built** package, while the options module it boots from
> reaches the framework however its own imports say — inside this repository, relative paths into
> the **source** tree. Two files, two containers, two sets of classes. The harness used to live
> inside `packages/zibri/src` and could only import relative paths, so it could not have this
> problem; a package that has to import by name can. The parent now hands the instance the paths it
> resolved `zibri` and `zibri-testing` to, and the instance maps those two names onto them before
> anything else loads. `zibri-testing` is in there for the same reason the framework is: it declares
> `ClusterMark`, and an entity is identified by its class, so a second copy would have the instance
> writing rows the parent cannot read back. What the parent hands over is covered container-free by
> `cluster-module-paths.test.ts` — it requires the path and checks it is the *same class*, since two
> files holding the same source are still two classes.
>
> `testcontainers` and `@testcontainers/postgresql` moved from dependencies to **optional peers**
> along the way, which is what the decision behind §T2 had actually been: a generated project was
> installing the container tree to run tests that mostly need none.
>
> `docs/testing.md` covers the three modules, the precedence, both data source creators, what each
> test provider changes and why, and the cluster harness. [§T1](#t1-the-frameworks-own-harness-has-to-reach-into-private-statics)'s
> residue is unchanged.

`docs/` has 24 files and none of them is about testing a Zibri application. There is no guidance on
provider substitution in tests, no in-memory or fake data source, no request-level test client, and
no `@Injectable` override mechanism documented for test scope. `docs/di.md`'s "Configuration"
section shows provider replacement via the application options array, which requires constructing a
whole application.

### T4. The thread job worker is tested from `dist`, so locally it is tested stale — ~~MAJOR~~ **FIXED**

*Opened while closing [04 §2.8](./04-infrastructure-subsystems.md) and
[04 §2.9](./04-infrastructure-subsystems.md), not part of the original review.*

`multithreading.service.ts:109-117` starts its workers from
`<packageRoot>/dist/cjs/multithreading/services/worker/thread-job.worker.js`, which is right — that
is the file a consumer of the published package runs. CI builds before it tests
(`ci.yml:38-39`, `build:prod` then `test:ci`), so there it is always the current worker.

`npm run test:normal -w zibri` does not build. So every local run of `multithreading.service.test.ts`
exercises whatever `dist` happened to contain, and an edit to anything under `worker/` is tested by
running the *previous* build of it. Nothing fails; the suite passes, against the old code.

**Found by being caught by it, twice in one sitting.** Both §2.8 and §2.9 change
`thread-job.worker.ts`, and the local suite was eight days behind:

- §2.9's test was **red for the right reason** — a function capturing a name the worker module also
  has resolved to the worker's value, exactly the collision the fix removes. It was reading the old
  `eval`.
- §2.8's test **passed without testing anything.** It asserted that a job after an uncaught exception
  still runs, and a worker that reports and carries on is still alive and still idle, so it takes
  that job perfectly well. The test could not tell the fix from its absence, and did not need the
  stale build to be wrong — it was a weak test, and the stale build is what stopped that being
  noticed.

> **The suite refuses a build older than the source it is built from**, and says to run the build.
> Cheap, and only in the one suite that depends on `dist`; a `pretest` build would put it on every
> run of every suite for the sake of one file.
>
> §2.8's test now compares the **thread id** across the failure rather than asking whether a job
> runs — a fixture reports `threadId`, and the pool is one thread, so a worker that should have been
> replaced and was not is directly visible. That is the assertion that could not have passed before
> the fix.

---

## CI. Continuous integration

`.github/workflows/ci.yml`

### CI1. Single Node version, single OS — ~~MAJOR~~ **FIXED**

> **The OS half is a job**, `portability`, running Windows and macOS in a matrix beside the existing
> Linux one. It runs the two suites that need no container - `zibri-tsx` and `zibri-cli` - and those
> are not a leftover subset, they are the right one: the compiler and the scaffolder spend their
> whole runtime in the filesystem, which is the thing the three platforms disagree about. The
> container-backed suites cannot join them, and this is not a gap that effort closes: a
> GitHub-hosted macOS runner has no Docker daemon, and `windows-latest` cannot run Linux images.
> What that leaves untested cross-platform is the data layer, and a data layer talks to a socket.
>
> Free, for a public repository: standard runners bill nothing on any of the three, and the
> multipliers that make Windows and macOS expensive apply to private repositories' minutes.
>
> **The version half is a matrix nobody maintains.** Raising the floor to `>=24` closed the
> narrow reading of this - CI ran the version `engines` declared - but not the finding, which is
> that a `>=` range is a promise about versions *that do not exist yet*. Node 25 is end-of-life and
> 26 has not shipped, so a hand-written matrix is correct today and silently wrong in October, kept
> honest only by somebody remembering to widen it every year. That is the same as not being kept.
>
> So the matrix is derived. A `node-versions` job runs
> `.github/scripts/supported-node-majors.mjs`, which reads node's own `schedule.json`, keeps every
> line that has started and not ended at or above the declared floor, and hands the result to
> `test` and `portability` through `fromJSON`. A new line is tested the week it ships; an
> end-of-life one drops out on its own, because a green build on a runtime nobody may deploy is not
> coverage. If the schedule is unreachable the job falls back to the floor rather than testing
> nothing, and the floor is always included whether or not node still maintains it - it is what the
> packages promise, and the promise outlives the support window by however long it takes to raise
> it.
>
> **`packages/zibri/src/ci-workflows.test.ts` is what keeps all of this from quietly reverting.** A
> workflow file is the one part of this repository that nothing else can contradict - not imported,
> not compiled, not linted - which is exactly how the original drift survived. Six assertions:
> every package declares the same floor, the matrix is *resolved* rather than listed, no version
> named outright anywhere is below the floor, the OS matrix is still there, and the supply-chain
> gates below are still there. The sixth is the one that matters: it drives the resolver against a
> fixture schedule and asserts that on 2026-08-28 it answers `[24]`, and on 2026-11-01 - with
> nothing edited - `[24, 26]`.

The original finding, for the record:

`package.json` declares `"engines": { "node": ">=22" }`, and CI tests exactly Node 22 on
`ubuntu-latest` (`ci.yml:16, 22`). Node 23, 24 and 25 are declared supported and never exercised.
No Windows or macOS job, despite the framework doing substantial filesystem work
(`FsUtilities.getPath`, upload temp directories, asset serving) where path semantics differ — and
`packages/zibri/src/parsing/form-data/form-data-body-parser-cleanup.cron-job.ts:38` contains a
path-join bug ([02](./02-http-runtime-core.md) §C6) of exactly the class an OS matrix catches.

### CI2. No security scanning — ~~MAJOR~~ **MOSTLY FIXED**

> **Two gates, covering the two halves of the surface.** `npm audit --omit=dev --audit-level=high`
> is a job in `ci.yml`, and CodeQL is a workflow of its own (`javascript-typescript`,
> `security-extended`, on push and weekly).
>
> `--omit=dev` is the deliberate part. The finding's own case is the tree the framework installs *on
> the consumer's behalf*, and that is the production tree; a high advisory in a build tool is worth
> knowing and is not worth failing every branch of every developer over. Scoping the gate to what a
> consumer receives is what makes it a gate rather than a thing people learn to ignore.
>
> `security-extended` for the same reason in the other direction. The default suite is tuned for a
> low false-positive rate on an *application*, where a taint path that ends in library code ends
> nowhere. Here the library code *is* the product, and a path that reaches a consumer's request
> handler is the whole reason to look.
>
> The schedule is not decoration: an advisory is published against code that did not change, so a
> branch going quiet is not the risk going quiet.
>
> **What is deliberately still open**: license scanning, SBOM generation, and dependency review.
> Dependency review only runs on `pull_request`, and this repository's CI is triggered by push - the
> workflow would be a file that never executes. SBOM and license policy are a compliance
> deliverable rather than a defect, and belong with the operations documentation that
> [07](./07-documentation-vs-code.md) says does not exist yet. Secret scanning and Dependabot are
> repository settings rather than workflow files, so nothing here can turn them on; both should be.

No `npm audit`, no CodeQL, no SAST, no dependency review, no license scanning, no SBOM generation,
no secret scanning step. For a framework whose value proposition is "batteries included" — i.e.
maximal transitive dependency surface owned on the consumer's behalf — the absence of any
automated supply-chain gate is the finding a security team raises first.

### CI3. No performance or regression testing — MINOR

There is a `test:heavy` script that runs `multithreading.service.performance.test.ts`
(`packages/zibri/package.json:32`), but nothing records or compares timings across runs. A change
that doubles per-request latency (see the triple-serialization and per-request metadata findings in
[02](./02-http-runtime-core.md) §M2–M3) would pass CI silently.

### CI4. The published artifact is never smoke-tested — ~~MAJOR~~ **FIXED**

> `published-package.test.ts` packs the package with `npm pack --dry-run`, checks that every path
> `exports`, `main` and `types` name is in the tarball and on disk, and then loads the built package
> in a child process the way a consumer does - once with `require`, once with `import` - asserting
> both reach the same module object.
>
> **A test rather than a workflow step**, deliberately: it runs in the normal suite, so it also runs
> before a push rather than only after one, and a developer who breaks the entry point finds out
> locally. It is the only suite here that does not go through ts-jest, which is the whole reason the
> defects in [05 §P1–P2](./05-di-metadata-and-packaging.md) could ship - every other test imports
> TypeScript and can therefore see nothing about what gets published.

Nothing in CI does `npm pack`, installs the tarball into a scratch project, and then `require()`s
and `import()`s it. Tests run against `src/` via ts-jest, never against `dist/`.

This is precisely why the `post-build.mjs` defects in
[05](./05-di-metadata-and-packaging.md) §P1–P2 can ship undetected: a broken ESM entry point, a
missing `index.mjs`, or `dist/esm/*.js` being parsed as CommonJS are all invisible to a test suite
that imports TypeScript source.

### CI5. Coverage upload is gated on a token, with `fail_ci_if_error: true` — ~~MINOR~~ **DECIDED AGAINST**

> **Kept as it is, deliberately.** A coverage upload that quietly does not happen is a coverage gate
> that quietly stops existing, and the project would rather see a red build than lose the signal.
> The finding's own case - a fork pull request with no `CODECOV_TOKEN` going red for a reason
> unrelated to the change - stands as the cost of that, to be handled if and when outside
> contributions arrive.

`ci.yml:42-46` — a fork PR has no `CODECOV_TOKEN`, so the codecov step errors and, with
`fail_ci_if_error: true`, fails the whole test job. External contributions get a red build for a
reason unrelated to their change.

---

## CD. Release process

`.github/workflows/cd.yml`

### CD1. The published build uses `npm i`, not `npm ci` — ~~MAJOR~~ **FIXED**

> One word, and the only part of this cluster that branch protection does not already cover: what
> reaches `release` is a tested *tree*, but `npm i` resolved a fresh dependency *graph* for the build
> that produced the tarball. The lockfile is what makes the artifact the thing that was tested.

`cd.yml:26` — `- run: npm i`. The *release* job resolves dependencies against `package.json` ranges
rather than the lockfile, so the artifact that reaches npm is built from a dependency tree that was
never tested. The `updateDocs` job three lines down uses `npm ci` (`:46`), so the inconsistency is
unintentional.

### CD2. No test gate before publish — ~~CRITICAL~~ **WITHDRAWN**

> **The gate exists; it is just not in the file this finding read.** Nothing reaches `release`
> without going through `dev` and passing CI, enforced by a branch protection rule with required
> status checks. Reviewing `cd.yml` alone and concluding there is no gate is reading the workflow as
> if it were the whole release process, which it is not - and adding a `needs:` on a second full run
> of the suite would re-verify a tree that GitHub already refused to let through unverified.
>
> **What was true, and closed with it:** the build that produced the tarball resolved its own
> dependency graph rather than installing the lockfile ([CD1](#cd1-the-published-build-uses-npm-i-not-npm-ci--major-fixed)),
> so "the tested tree" and "the published artifact" were not the same claim.
>
> **What a repository can hold of a rule that lives outside it** is that the rule keeps covering the
> release path: `cd.yml` publishes on a merged pull request into `release` and on nothing else, so a
> `workflow_dispatch` or a `push` trigger added later would be a door the protection rule does not
> reach. `di-and-packaging.evaluation.test.ts` asserts there is no second door. The residue an
> outside reviewer would still name is that an administrator can bypass a protection rule, and that a
> `release` branch allowed to diverge makes the merge result a tree nothing tested - both settings
> questions rather than code ones.

### CD3. Non-atomic multi-package publish — ~~MAJOR~~ **FIXED**

> **A publish cannot be rolled back, so the answer is not to start one that will fail halfway.** npm
> allows an unpublish for 72 hours and then never again, which rules out the rollback this finding
> asks for and leaves only the other direction: move everything that can refuse the release in front
> of the first publish.
>
> Three things could refuse it, and the workflow interleaved all three with publishing:
>
> | What refuses | When it was found | When it is found now |
> |---|---|---|
> | a build failing | after the earlier packages were published | before any publish |
> | a version already on the registry | at the publish that conflicts — the third one, after two went out | in a `npm view` loop over all three, first |
> | a manifest npm will not take | at that package's publish | in a `--dry-run` of all three |
>
> So the sequence is now: read the version → refuse it if the registry has it → build everything →
> dry run everything → publish everything. What is left is a registry outage between the first
> publish and the last, which nothing in a repository can prevent.
>
> **The version check needed somewhere to read the version from**, and the manifests are
> hand-edited, so `.github/scripts/release-version.mjs` refuses a release whose packages disagree —
> the everyday mistake, since they name each other by version and a half-bumped release is one a
> consumer can install and cannot resolve. Held by `ci-workflows.test.ts`, which asserts the
> ordering rather than the text: every build index below every publish index, every dry run below
> every publish.
>
> **[§T3](#t3-no-documented-testing-story-at-all) added a fourth package and found the shape of that
> check wanting.** It counted builds and publishes against a literal `3`, so a release forgetting
> `zibri-testing` would have failed on a number written in a test rather than on the step it left
> out — and `zi new` installs that package *at the cli's own version*, which makes a release that
> leaves it behind one where every generated project fails to install while nothing about the
> release itself looks wrong. The counts now come from the manifests `release-version.mjs` reads,
> the `npm view` loop is checked against those same names, and a test reads the generator for what
> it installs by version and requires the release to publish it.

`:28-33` publishes `zibri-tsx`, then `zibri`, then `cli`, sequentially with no rollback. If
`npm publish -w zibri` succeeds and `-w cli` fails, npm now hosts a half-release: a `zibri` version
whose matching CLI does not exist. `zibri-tsx` is a mandatory peer of `zibri`
([05](./05-di-metadata-and-packaging.md) §P3), so ordering matters and partial failure is
user-visible.

### CD4. OIDC permission requested but provenance not used — ~~MINOR~~ **FIXED**

> All three publishes pass `--provenance` now, so the permission that was already granted produces
> the attestation it was granted for. Closed here rather than on its own because it is the same
> sentence as CD1: what a consumer installs should be traceable to the tree that was tested.

`:8` grants `id-token: write` with the comment `# Required for OIDC`, but none of the three
`npm publish` commands passes `--provenance`. The permission is granted and the attestation is
never produced, so consumers get no supply-chain provenance despite the setup implying otherwise.

### CD5. No version bump, changelog, or tag automation — MINOR, **open by decision**

> **Generated release notes were declined**, which removes the cheap answer and leaves the question
> genuinely open rather than merely undone. What was on the table and is not ruled out: a
> hand-written `CHANGELOG.md` section that the release refuses to publish without — the same shape
> as the version check [CD3](#cd3-non-atomic-multi-package-publish--major-fixed) added, so the
> summary stays human and cannot be forgotten — and a `v<version>` tag pushed once all three
> publishes succeed, which answers "which commit produced this version" and nothing else.
>
> Half of what this finding asks for arrived with CD3 anyway: the three versions can no longer
> disagree, and a version the registry already has stops the release. What is still missing is the
> record of *what changed*, which is the half a person has to write.



Versions are hand-edited in three `package.json` files (all currently `3.0.0`). There is no
changelog, no git tag, no GitHub release, and therefore no machine-readable breaking-change signal.
For an enterprise, "how do I know what changed between 3.0.0 and 3.1.0" has no answer.

---

## X. The custom TSX compiler (`packages/tsx`)

`packages/tsx/package.json:44` describes it as *"Hand-written TSX compiler for Zibri page
templates."* It has **zero runtime dependencies** — the lexer, parser, type eraser, code generator,
JSX runtime, webpack plugin and MJML-compatible email component layer are all hand-rolled — and it
is a **mandatory** peer dependency of `zibri`.

### X1. Reimplementing the JavaScript/TypeScript grammar is an open-ended liability — ~~MAJOR~~ **FIXED, the grammar is gone**

> **The entry is right, and measuring it first is what showed how right.** A differential test
> (`packages/tsx/src/parser/tsc-parity.test.ts`) runs 62 valid-TSX cases through both this parser and
> TypeScript's. The first version compared accept/reject and reported the dangerous direction clean;
> **that version measured the wrong thing.** Acceptance is not agreement. Two further checks — no
> `Identifier` in the tree may be a reserved word, and the top-level statement count must match
> TypeScript's once type-only declarations are discounted — found **four constructs that were
> silently mis-parsed**: `class`, `enum`, `do/while` and `function*`. `export class C { m() {} }`
> became an identifier `class`, an identifier `C` and a free-floating block, with no diagnostic. That
> is exactly the *"emits subtly different code"* this entry names, and no amount of reading found it.
> Seven more were loudly refused, and one string literal decoded differently from JavaScript: a
> backslash-newline line continuation produced a newline where the language produces nothing —
> predicted, in so many words, by the *"handles the common escape sequences"* quoted above.
>
> **The decision was to stop owning a grammar.** TypeScript's parser reads the source now and
> `src/lexer/` is deleted. What that buys is not fewer lines: it is that the outcome *"compiles, and
> means something other than what it says"* stops existing, because a construct either parses
> correctly or is a TypeScript error the author's editor already shows them.
>
> **Checked before deciding, because the answer was not obvious: the isolation guarantee does not
> come from the parser.** Three properties carry it, all in `semantics/` and `codegen/` — the client
> file is *built up* from an allowlist of what client code transitively reaches rather than stripped
> down from the server module, `validateClientImports` refuses any emitted client identifier that
> matches an ordinary import binding, and the two emissions are independent. What the parser decides
> is whether the tree those run over is the program that was written, which is where the hand-written
> one was failing — so it was weakening the guarantee, not protecting it. **The one real reason to
> own a parser is syntax that is not valid TypeScript**, and this design deliberately has none: every
> hook is an ordinary function call, which is why the editor, `tsc` and eslint all understand these
> files, and why more hooks need lowering-table entries rather than grammar.
>
> **A packaging trap came with it and is worth recording on its own.** The package's main entry
> exported the compiler and the runtime together, and an application imports that entry to render a
> page — so a parser that reaches TypeScript would have put a compiler in every deployed bundle. The
> compiler moved to a `zibri-tsx/compiler` subpath. That is load-bearing rather than tidy: `zi new`
> installs `typescript` as a devDependency and the generated Dockerfile prunes dev dependencies after
> building, so a runtime entry that reached it would fail to boot every container — [§C4](#c4)'s
> lesson arriving a second time. `src/runtime-entry.test.ts` loads the built entry with `typescript`
> hidden from module resolution and proves it does not. **The rule: a dependency that makes a
> compiler possible is only acceptable while the runtime entry provably cannot reach it.**
>
> **Planning the next stage found a confidentiality defect that no parser choice touches.** What client
> code needs is worked out by *name*, not by which declaration a name refers to, and over-including is
> the safe direction for correctness and the leaking one for confidentiality, because what is kept is
> written into the page. Reproduced five ways: a local inside `onClient`, a `.map` parameter around a
> handler and a parameter of a kept helper each pulled an unrelated body declaration of the same name
> - `const apiKey = 'sk-live-…'` included - into the client script, and a local or loop parameter
> sharing a prop's name put the whole prop into the page. Until references are resolved to their
> declarations, compilation refuses any such collision by name (`ZTSX007`). It cannot guess wrong
> because it does not guess, and 105 real templates across zibri, the scaffold and the sandbox compile
> with no diagnostic at all, so it costs nothing that exists. A related, still open question is
> granularity: a prop or loop value client code reads is written into the page whole, even when one
> field of it is read. Two red tests state the part that does not depend on how that gets decided.
>
> **What the middle of this looked like, because the shape is reusable.** The swap landed in one
> reviewable step by keeping this compiler's own IR and lowering TypeScript's output into it, which
> left the semantics and codegen layers untouched and the existing tests a real regression net. The
> price was nine constructs the IR had no node for — class declarations, `enum`, `do/while`,
> generators, `for await of`, object-literal getters, `using`, private fields and decorators — refused
> by name for as long as it existed, and listed in the parity test so the dialect was written down
> rather than discovered. **That IR was a migration seam rather than an architecture**, and the last
> step below deletes it and the nine refusals with it. Four constructs the hand parser refused worked
> from the first step, including the `<T,>` generic arrow — the TSX idiom, so a file using one used to
> compile in the editor and nowhere else.
>
> **The removal is guarded by an equivalence oracle, built before any of it.**
> `packages/tsx/src/codegen/equivalence-oracle.test.ts` holds a recording of what the current compiler
> produces for 490 sources: the 105 real templates, plus every distinct source the test suite parsed,
> collected by wrapping `parse()` during a full run. For each source it records both module formats,
> the client script, the referenced props, hooks and translations, every handler and function-prop
> site, and every diagnostic. The replacement has to reproduce all of it. Emitted code is compared by
> meaning: it is reparsed, redundant parentheses are dropped and put back by TypeScript's node factory,
> and the result is compared token by token. So formatting may change and nothing else may. Tests
> prove both directions, on pairs like `(a + b) * c` against `a + b * c` and `return⏎x` against
> `return x`, and on the real compiler: a one-token change to the emitted `onClient` turns it red, and
> a formatting-only change leaves it green. It asserts sameness, not correctness, so the leaks above
> carry over on purpose; their red tests are what track them. The recording is never re-recorded, and
> the oracle is deleted once the move is done. **Building it found one more defect**: an anonymous
> `export default` component compiles to `export const default = …`, which is not valid JavaScript.
> That is a loud build failure rather than a leak, and it has a red test.
>
> **The analysis and code generation now run on TypeScript's syntax tree.** Each module was rewritten
> beside the one it replaces and had to agree with it before anything built on it. The comparison ran
> over the oracle's sources plus fixtures written for rare shapes. It covered the exact sequence of
> identifiers, functions and JSX elements the walk visits (matched by source span), pattern names,
> free and referenced identifiers per statement, translation sources, every diagnostic, and every
> handler and function-prop site. Then the whole compiler was compared against the recording. Two
> things proved the comparison could fail, not just pass. Deliberately dropping one case from the new
> walk produced 16 failures. A fixture that had silently not taken part (`<T>x` is not valid in a
> `.tsx` file) led to a guard that requires every fixture to compile cleanly. JSX is lowered by a
> TypeScript transformer, and **type syntax is erased by `ts.transpileModule`, TypeScript's own
> transpiler, so no rule about what counts as a type lives in this compiler**. What remains of the IR
> is the refusal gate for the nine unsupported constructs, which is the last thing to go. The
> analysis modules now load TypeScript at runtime, so their exports moved to the `zibri-tsx/compiler`
> subpath, and the runtime-entry test confirms a deployed application still never loads a compiler.
> The oracle was deleted once this was confirmed, because the next steps change behaviour on purpose.
>
> **Client code is now analysed by the declaration a name refers to, and `ZTSX007` is gone.** Each
> template is resolved by a single-file TypeScript program (no lib, no module resolution, about a
> millisecond), so a name in client code maps to exactly one symbol, or to none when the template
> declares it nowhere. What the body ships, what a handler captures and which props are written into
> the page are all decided by symbol, so a same-named binding pulls nothing in and the refusal had
> nothing left to prevent. A probe before the change found **two more leaks of the same family that
> the refusal did not catch**: a statement holding `onClient` was kept whole, so an unread
> `const internalUrl = '…'` beside it inside an `if` was shipped; and a declaration statement was kept
> whole, so `const label = 'go', secret = '…'` shipped `secret` when only `label` was read. Kept
> control flow and kept declarations are now pruned statement by statement and declarator by
> declarator. Jumps and control flow holding one stay, because dropping a `continue` would change
> which client code runs. The same symbols also removed a false refusal: a local inside `onClient`
> named like a server import was refused as `ZTSX003`. Deliberately breaking three pieces of the new
> pruning turned their tests red. 105 real templates compile with no diagnostic.
>
> **Client code now reads from a closed set of names, and the finished script is checked on its own.**
> A name client code reads from outside the component must be a browser global, a `?client` binding, a
> framework hook, or a `declare` of the template. Anything else refuses (`ZTSX009`): a module-level
> declaration, another component of the file, or a name declared nowhere, like `process`. Before this,
> every one of those compiled and threw `ReferenceError` in the browser. The browser globals are not a
> list kept here: they are read once per process from the installed TypeScript's `lib.esnext` and
> `lib.dom` declarations, following their lib references, and type-only names are left out.
> `import(...)` and `import.meta` refuse too (`ZTSX008`): the script is a classic `<script>`, where
> `import.meta` is a syntax error that stops every component's script on the page.
> **The second check is what makes this independent of the analysis.** The finished, type-erased client
> script is parsed and resolved again as its own program, every syntax TypeScript knows is traversed
> (not this compiler's walk, which has no case for a class body or `for...in`), and every name it reads
> without declaring must be in the same set derived from the template. This was proven directly rather
> than assumed: with the import check, the module-loading check and the name check all switched off, all
> ten refusal tests still refused through the second check alone. The price was 28 existing tests
> whose client code called undeclared helpers (`go()`, `log()`), now declared as page globals. 105 real
> templates compile with no diagnostic, and all 105 compiles take about 1.4 s together, lib files included.
>
> **Two defects closed after that.** The anonymous `export default` component found by the oracle now
> emits a valid module in both formats, and the CommonJS one is marked as an ES module so a bundler's
> `import Page from` receives it. And a latent one, confirmed with a failing test before the fix: a page
> defines each component's client setup once by name, and the name was `<Component>$$setup`, so two
> different components that share a name - a `Card` in two folders - ran the first one's setup for
> both, and clicking the second card ran the first card's handler. The setup name now carries a
> fingerprint of the template source, so equal names stay apart and the same template still shares one
> setup.
>
> **The emitted server module dropped everything but the first component - found while planning the
> removal of the refusal gate, pre-existing.** `compile()` rebuilt the module from the imports and the
> first component it found, so module-level constants, helper functions, a module-level
> `createContext(...)` and every further component - exported or not - were silently missing. The
> scaffold's and the sandbox's `base-email.tsx` render a module-level `HOVER_STYLES` and `log.tsx` a
> module-level `logLevelLabels`; rendering either would have thrown `ReferenceError`, and no suite
> renders them, which is why everything was green. Proven with tests that execute the emitted module,
> then fixed in two steps. First, representation only: commonjs is no longer written by hand but
> converted by TypeScript from the ES module, after the format-pinning tests were rewritten to load and
> render the module and passed against the old emit (a recursive component got its first test on the
> way). Then the fix: the template is emitted statement by statement with each component replaced by its
> compiled component, every component is compiled and checked, and JSX or a render hook outside a
> component - which has no render runtime to run in - is refused (`ZTSX010`) instead of becoming a module
> that throws. None of the 105 real templates has any.
>
> **The IR is gone, and with it the nine refusals.** `ast.ts`, the lowering, the IR parser and its tests
> are deleted. Syntax errors come straight from TypeScript's program (`getSyntacticDiagnostics`, public
> API), and nothing else is refused by name. Instead the analysis walk became exhaustive-or-loud: a
> syntax kind it has no case for throws, and `compile()` turns that into `ZTSX006` naming the kind, so a
> future TypeScript syntax can never be silently skipped by the isolation analysis - which is exactly
> the failure the hand parser had. The walk then gained cases for everything the gate used to refuse
> inside components: `for...in`, `do...while`, classes (fields, methods, accessors, constructors, static
> blocks, `extends`, decorators), object accessors, `yield`, `enum`, private names, and three gaps it had
> without anyone noticing - computed keys in destructuring patterns and in methods were never read, and
> a JSX element given directly as an attribute value (`icon=<Icon/>`) was rendered as `undefined` and
> invisible to the analysis. Deliberately removing the class-method and computed-key cases turned their
> tests red. **The independent script check paid for itself twice here**: with class methods unwalked,
> a server import read inside a method was still refused by it, and it caught a real, pre-existing
> defect - a JSX element passed as a prop that contained a handler was taken for a function prop, so its
> markup was shipped into the client script reading the server-only render runtime. Emitted code now
> targets ES2022 for server module and client script alike, so decorators and `using` are lowered by
> TypeScript; a decorated class using `using` runs inside a VM from the generated client script.
>
> **Granularity: what crosses the boundary is the fields client code reads.** Measured first on the real
> templates: of 26 distinct serialized values, only 3 are objects client code genuinely uses whole
> (a chart config handed to `new Chart`, an array iterated, an entry spread); the rest are field reads or
> primitives. The compiler has no types, so primitive or object is only known at render time. The
> compiler now works out an access shape per prop and per captured loop value - the fields read, followed
> through aliases, destructuring, `for...of` and array callbacks (`map`, `filter`, `find`, `at`, `reduce`,
> `sort`), with a value marked whole wherever it is used any other way - and the render narrows each value
> to its shape before writing it into the page: props of the page and of every nested instance, and the
> values handlers and function props capture. An array keeps its length, a value only tested (`if
> (account)`) is written as `{}`, and anything with `toJSON` stays itself. The three red tests from the
> planning probe, plus a fourth added later for an object handed down through `.map` into a child, are
> green, with nine more around them; turning projection off turned twelve red, and turning array methods
> off turned the two array tests red. In the sandbox this narrows the tab bar's `tabs` to their `id`s and
> the subscriber's lists to theirs.

### X1 (the original finding)

`packages/tsx/src/parser/type-erasure.ts:55-80` is representative:

```ts
/**
 * Decodes a JavaScript string literal (including its surrounding quotes) to its runtime value.
 * Handles the common escape sequences used in templates.
 */
export function decodeStringLiteral(raw: string): string {
```

"Handles the **common** escape sequences" is the whole risk in one doc comment. A hand-written
lexer that covers the common cases has, by construction, an uncharacterized set of uncommon cases —
and for a compiler the failure mode that matters is not "throws", it is "emits subtly different
code". The surrounding module hand-implements `\u`/`\x` decoding, a `SIMPLE_ESCAPES` table, and
module-specifier query stripping — each a small piece of a specification that TypeScript's own
parser implements completely and keeps current.

Concrete consequences for an adopting company:

- **Every TypeScript release is a compatibility question.** New syntax (`using` declarations,
  decorators-on-parameters, `satisfies` in new positions, future proposals) has to be re-implemented
  here or it silently fails to parse.
- **Two sources of truth for what compiles.** The IDE type-checks with `tsc`; the build compiles
  with `zibri-tsx`. Anything the two disagree on produces code that type-checks and does not run,
  or runs and does not type-check.
- **The bus factor is the liability, not the line count.** A hand-written compiler on the critical
  path of every page render is a component no customer can debug and no customer can replace.

There is a real test suite here (`compile.test.ts`, `parser.test.ts`, `lexer.test.ts`,
`mjml-parity.test.ts`, sandbox tests), which is the right mitigation — but tests establish which
inputs work, not which inputs are safely rejected.

### X2. `zibri-tsx` is CJS-only, while `zibri` claims dual CJS/ESM — ~~MAJOR~~ **WITHDRAWN, the premise is gone**

`packages/tsx/package.json:5-25` — `"main": "./dist/index.js"`, no `"type"` field, and every
`exports` entry uses a bare `"default"` condition with no `"require"`/`"import"` split:

```json
"exports": {
    ".":            { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
    "./webpack":    { ... },
    "./email":      { ... },
    "./jsx-runtime":{ ... }
}
```

`zibri` advertises an ESM entry point ([05](./05-di-metadata-and-packaging.md) §P1–P2) and takes a
mandatory peer dependency on a CJS-only package. An ESM consumer gets default-interop semantics for
the JSX runtime, which is exactly where interop bugs are least tolerable.

> **The finding is a mismatch between two packages, and there is no longer anything to mismatch.**
> `zibri` publishes one CJS build — `main` is `./dist/cjs/index.js`, its single `exports` entry uses
> the same bare `default` condition this entry criticizes `zibri-tsx` for, and `npm run build` runs
> `build:cjs` and nothing else. The dual claim that made the peer dependency a contradiction went
> with §P1–P2. Both packages are `module: nodenext` with no `"type"`, so both emit CJS and agree.
>
> **Withdrawn rather than fixed, because nothing changed here in response to it.** What closed it is
> a decision taken elsewhere for other reasons, and the entry is left standing so that a later reader
> who reaches for dual-mode publishing again finds the cost written down: an ESM entry point on
> `zibri` puts this exact question back, and it comes back hardest at the JSX runtime, where named
> exports reach the consumer through interop rather than directly.
>
> **What this does not say is that an ESM consumer is served well.** An application that is itself
> `"type": "module"` still reaches both packages through Node's interop. Nobody has filed that, no
> test covers it, and it is a different question from the one this entry asks.

### X3. The same hand-rolled-parser risk exists for Handlebars — ~~MAJOR~~ **the premise does not hold; a different defect does** — **FIXED**

> **Built as decided, and the tests written first found three more defects of the same kind.** An
> application's own block helper has its positional, named and sub expression parameters read as keys
> and its blocks walked in the context it is used in; `with` rebinds the context to the object it
> names, the way `each` does to an item; `log` contributes no keys and has its block walked.
>
> - **No block walked its `{{else}}` branch.** `element.inverse` was never visited, for `if`, `unless`
>   and `each` alike, so a key read only in an else branch was missing from the generated type — a
>   template that type checked and rendered `undefined`. Every block walks it now, in the context the
>   block is used in: an `each`'s else renders when the list is empty, so it cannot read from an item.
> - **`{{#if (and a b)}}` recorded only `a`.** The condition took the first parameter of a sub
>   expression, which is right for `each` (iterate the first argument) and wrong for a condition that
>   reads all of them. A literal condition — `{{#if "always"}}`, valid handlebars — threw; it reads no
>   key now. Its error-path test was asserting the defect and was replaced.
> - **The framework's own `and` rendered its block against the template's root.** It was an arrow
>   function, so it had no `this` and passed `opts.data.root`: inside an `each`, `{{#and x}}{{this.label}}`
>   printed the root's label. Found because the decided rule ("walk the body in the same context") had
>   to be checked against how the one shipped block helper actually renders — it disagreed, and the
>   helper was the one wrong. `helpers.test.ts` renders it.
>
> What still throws is what handlebars itself would reject or cannot mean: an `each` or `with` given
> more than one parameter, a literal or empty sub expression as what to iterate, and statement kinds the
> walk has no case for (decorators). Four tests in `resolve-error-paths.test.ts` that asserted the
> removed throws were deleted; the behaviour they pinned is asserted positively in `block-helpers.test.ts`.

> **Nothing here parses Handlebars.** `HandlebarUtilities.parse` calls handlebars' own
> `parse`, and `src/handlebars/ast.model.ts` narrows handlebars' own published `hbs.AST.*` types
> rather than declaring a grammar. So the structural exposure this row describes — *"a second
> hand-written parser for a third-party template grammar, which must track that grammar's
> evolution"* — is not present: the grammar belongs to handlebars and moves with it.
>
> What is hand-written is the **type-inference walk over that AST**, which is a smaller and
> different liability. Its stated failure mode is also backwards at the statement level:
> `resolveAllKeys` throws on a node kind it does not know, so a grammar addition is loud there
> rather than silently mistyped.
>
> **A real defect is underneath it, and the row does not mention it.** The walk handles exactly
> `each`, `if` and `unless`. `{{#with}}` and `{{#log}}` throw *"Not implemented yet"*, and **any
> custom block helper throws `Unknown AST path.original`** — including `and`, which
> `HandlebarUtilities.init` registers *with* `fn`/`inverse` block support. So `{{#and a b}}…{{/and}}`
> renders correctly and crashes type generation, and the failure arrives as an `InternalError`
> naming no template, no line and no helper.
>
> **Decided, not yet built**: an unknown block helper's path-expression parameters become keys and
> its body is walked in the same context, which is right for the `and`/`or`/`eq` shape people
> actually register; `with` gets real handling, since it rebinds context the way `each` does but to
> an object; `log` contributes no keys and has its body walked. Only `with` and `each` rebind
> context, so the generic rule cannot silently mis-attribute anything else.

### X3 (the original finding)

`README.md:96` advertises *"a custom parser for handlebar files, that automatically infers the type
of the data that is needed to render the template"* (`packages/zibri/src/handlebars/`). The feature
is genuinely clever, and it carries the same structural exposure as X1: a second hand-written
parser for a third-party template grammar, which must track that grammar's evolution, and whose
failure mode is an incorrect inferred type rather than an error.

---

## C. CLI (`packages/cli`)

### C1. `death` is an unmaintained dependency — MINOR, **FIXED**

> **The dependency was the smaller half. What it was being used for was a bug.**
> `death(() => {})` registers a `process.on` handler for SIGINT, SIGTERM and SIGQUIT whose callback
> does nothing — and Node only exits on those signals while *nothing* is listening. So the cli could
> not be interrupted: Ctrl+C outside a prompt did nothing at all, and the wrapper's own doc comment
> claimed the opposite ("kills the program when the process stops"). A faithful two line replacement,
> which is what this row asks for, would have preserved that.
>
> Replaced with `exitOnSignal()`, which exits through the `exitWithInterrupt` the cli already had — so
> an interrupt now prints the same line and exits 130 whether it lands during a prompt, during a child
> process, or anywhere else. Those three cases used to be answered three different ways, because
> inquirer and the child process each listen while they are running and nothing did outside them.
> `death` and `@types/death` are gone.

`packages/cli/package.json:42` — `"death": "^1.1.0"`, a signal-handling shim last published over a
decade ago, for something `process.on('SIGINT'|'SIGTERM')` does natively. Every dependency needs a
justification; this one is a two-line replacement.

### C2. Empty package description — MINOR, **FIXED**

> Says what the package is and what to type: "Command line interface for the Zibri framework.
> Scaffolds a new project with `zi new`."

`packages/cli/package.json:25` — `"description": ""`. This is the package a developer installs
globally (`npm i -g zibri-cli`) as their first contact with the project.

### C3. No coverage or CI gate on the scaffolded output — MINOR, **FIXED**

> **Coverage.** The cli has `test:coverage` and `test:ci`, and CI runs the latter and uploads the lcov
> beside zibri's. One jest invocation covers the whole suite rather than two that would need merging,
> because the heavy tests want `--runInBand` anyway — so no `nyc` had to follow, which is the shape
> zibri's own coverage needs only because it splits the run. Templates are excluded from coverage on
> purpose: a template is copied into a generated project and compiled *there*, so which of its lines
> run belongs to that project.
>
> **A CI defect came out with it, and it would have failed the first time it ran.** The `portability`
> job runs the cli suite on macOS and Windows, and its own comment explains that container backed
> suites cannot join it — a hosted macOS runner has no docker daemon. But it ran `npm run test`, which
> since §C4 includes `new.command.docker.heavy.test.ts`: it builds an image, starts a registry and a
> postgres container, and has no platform guard. That job now runs `test:normal`, which is what the
> comment always said it was for.
>
> **The gate.** What the finding is really about — a regression in generated output being absorbed into
> the accepted list — is mostly answered by §C4 (the generated code is parsed now) and §C5 (the list is
> checked against the code rather than against a snapshot the heavy suite wrote). What was still
> missing is that the list could rot silently, because the parity check only consults an entry for a
> path it is comparing: an entry for a file the sandbox no longer has is never read and never fails,
> while sitting there looking reviewed. A fast test now refuses an entry whose path is gone, and one
> that accepts an empty diff — which would accept anything that path does.
>
> **The last sentence below turned out to be a description of a live defect rather than a risk.**
> A regression in generated output was absorbed by adding it to the accepted list: `src/providers.ts`
> did not parse, and the missing comma was written down as an intended difference from the sandbox.
> See [§C4](#c4-not-assessed-whether-generated-projects-are-production-shaped--mostly-closed), where
> it is fixed and where the check that would have caught it now lives. What the finding asks for -
> coverage, and a gate on the scaffold - is still open.

The CLI has `test:normal` / `test:heavy` but no `test:coverage`, and CI runs `npm run test -w
zibri-cli` (`ci.yml:41`) without coverage. The "accepted sandbox differences" approach
(`src/__testing__/accepted-sandbox-differences.ts`, `recorded-sandbox-diffs.json`) records expected
divergence between the generated project and a golden sandbox — a reasonable technique, but it
means a regression in generated output can be absorbed by adding it to the accepted list rather
than fixed.

### C5. The fast parity check compared against a snapshot, not against the code — **FIXED**

**Opened while adding `ts-node` to the scaffold**, which changed what `zi new` writes.

`accepted-sandbox-differences.ts` lists the differences between a generated app and
`packages/sandbox` that are known and intended, and each entry has to be the *byte-exact* output of
`diffFileContents()`. A fast test checked those entries against `recorded-sandbox-diffs.json`, which
the heavy suite wrote at the end of its last run.

Two things were wrong with that, and the second is the one that matters:

**It could not have failed for a good reason.** The heavy suite asserts `diff === accepted` and then
records `diff`, so after a green run the recording *is* the accepted list. The check was a tautology.

**And it judged today's code against an arbitrarily old observation.** Run the heavy suite, change
the generator, run the fast one: it compares the new accepted entry against a recording made before
the change and reports a failure that says nothing about whether the entry is right. It could not
tell a mangled hand-written entry — the thing it existed to catch — from the generator having
legitimately moved.

**A third defect fell out of the same file**: `recorded-sandbox-diffs.json` is gitignored and the
test imported it statically, so on a checkout that had never run the heavy suite the whole file
failed to compile — `TS2307`, taking all of `test:normal` with it. That is every clean CI runner,
including the `portability` job from [§CI1](#ci1-single-node-version-single-os--major).

> **Replaced by a check that generates the diff.** `new.command.sandbox-parity.test.ts` runs the
> generator with `CPUtilities.exec` stubbed and diffs the tree it produces against
> `packages/sandbox`: **86 files in under two seconds**, always against the current code. Only the
> install is stubbed, and neither call it stubs writes a file being compared, so what runs is the
> whole generator.
>
> `package.json` is the one file it cannot judge, because npm writes half of it — that stays with
> the heavy suite, which is now the check on the fast suite's one assumption rather than a duplicate
> of it.
>
> **It found a wrong entry on its first run.** The `db.data-source.ts` diff recorded `User` and
> `JwtRefreshToken` as changed lines where they are context lines — a hand-edit from the
> [04 §1.9](./04-infrastructure-subsystems.md) pass that the snapshot check had been unable to
> question. The recording survives as an authoring aid, written by the fast suite and asserted
> against by nothing.
>
> **The `package.json` entry was reporting the run rather than the two projects.** Adding
> `pg-query-stream` to both sides made it red, because npm writes a top level key when the first
> install that needs it runs and `zi new` installs its dev dependencies first: the two files ordered
> their dependency blocks differently, a text diff read that as a moved block, and a line both files
> now held showed up as two differences. `normalizePackageJson` drops the three things that say
> something about the run instead of about the projects — the version npm resolved on the day, the
> order of the two blocks, and the author — and the entry that is left is six lines shorter and
> every line of it real. The generator also writes the four fields `npm init` writes, filling the
> author off the machine the way npm does, so that what is compared differs in what the two projects
> are rather than in how each file came to exist.

### C4. Not assessed: whether generated projects are production-shaped — ~~MAJOR~~ **ASSESSED, mostly closed**

> **The assessment found one live defect before it found any gaps, and it had been shipping the
> whole time.** `src/providers.ts` did not parse. The generator emitted `})` where an array element
> needs `}),`, so every project `zi new` has ever created carried a syntax error in the file that
> configures it. It was green because the parity suite carried the missing comma as an **accepted
> sandbox difference** — a literal `- })` / `+ }),` pair in
> `accepted-sandbox-differences.ts`, in the file whose entire job is to tell intended divergence
> from breakage.
>
> That is worth more than the fix. [§C5](#c5-the-fast-parity-check-compared-against-a-snapshot-not-against-the-code--fixed)
> replaced a check that could not fail for a good reason; this is the other failure mode of the same
> mechanism, where a check that *can* fail is answered by writing the failure down. An accepted
> difference is a claim that two projects legitimately differ. It cannot express "and both are
> wrong", so nothing stopped it being used that way.
>
> **Nothing parsed the generated code, which is why a syntax error could survive a parity suite.**
> The fast suite now runs every file the generator assembles line by line through the TypeScript
> parser and asserts there are no syntactic diagnostics. Syntax only, deliberately: types would need
> the install the suite stubs out, and the question that went unasked was not whether the scaffold
> type-checks but whether it is readable at all. Copied templates are left out — they are byte
> copies of files this repository already builds — so what is checked is exactly the part that
> exists as string arrays until a project is generated.
>
> **Three secrets were hardcoded literals, published with the cli.** `accessTokenSecret:
> 'JWT_ACCESS_TOKEN_SECRET'`, the same for refresh, and an encryption master key of
> `'MASTER_KEY_VALUE'`. The only checks on a jwt secret are that it is non-empty and distinct from
> the others, so an application booted happily on a signing key anyone can read off npm — and the
> seeded administrator's password was `'password'`. Meanwhile `docs/auth.md` and
> `docs/encryption-and-hashing.md` both already showed `process.env` for exactly these values. **The
> documentation and the generator disagreed, and the generator is what people run.**
>
> Everything that differs between one machine and the next is read from the environment now: the
> port, the base url, the database, the three secrets, the seeded administrator, the password reset
> url and the mail server. `src/env.ts` holds `requireEnv`, which refuses to start when a variable is
> unset — a deployment that forgot one stops with the name of what is missing rather than signing
> tokens with an empty string — and `optionalEnv` for what a project genuinely runs without.
>
> **Node's `engines` floor is what kept this to zero dependencies.** `>=24` means
> `process.loadEnvFile()` is native, so nothing here needs dotenv. It is called from `src/env.ts` as
> a module side effect rather than from the entry point, and that is a correctness point rather than
> a style one: imports are evaluated before any statement in `start()`, so by the time an entry point
> could load a file, every module that reads a variable has already read it.
>
> **`zi new` generates the `.env` too, with a secret per blank.** A committed `.env.example` is the
> list of what a deployment sets; the `.env` beside it is git ignored and carries values generated
> for that project. Any value the cli could write into the example is a value everyone has, so the
> example holds none — and a scaffold whose first `npm start` fails is not what "refuse to boot"
> should cost. The `.env` is the one generated file no comparison can judge, since two of them never
> agree; what the suite asserts about it instead is that it answers every variable the example
> declares, and that the three secrets are neither the example's value nor short.
>
> **The `.gitignore` gap was its own finding.** There was no `.gitignore` at all, so a fresh
> project's first `git add .` committed `node_modules` and `dist` — and `docs/creating-endpoints.md`
> instructed the reader to "add `.zibri/` to your `.gitignore`", a file nothing had been creating for
> them. It is generated now, and `versions` is deliberately absent from it: those snapshots are what
> the next version is validated against, so they belong in the repository.
>
> **One difference stopped existing rather than being re-recorded.** `create-default-data.function.ts`
> had an accepted diff whose entire content was that the two projects seeded different admin
> addresses and shared the password `'password'`. Both read the environment now, the files are
> identical, and the entry is gone. The difference was never the two projects disagreeing — it was a
> credential being written into a source file at all.
>
> **`schemaManagement: 'synchronize'` stays**, and is the one question here whose answer was already
> right. [01 §C1](./01-data-layer.md) made it a required choice rather than a default, and a project
> with no migrations yet is refused at boot under any other value — so it is the only thing a fresh
> scaffold can say. What it lacked was the warning its neighbour `defaultAuth` already carries,
> which it now has.
>
> `@types/node` joined the scaffold's devDependencies, because a project whose own code reads
> `process.env` under `strict` needs the types for the runtime it targets, and nothing was bringing
> them.
>
> **Two of C4's three remaining questions are answered now; the CI workflow is the one that stays
> open.**
>
> **The health endpoint.** [02 §C3](./02-http-runtime-core.md) withdrew the readiness signal from the
> framework on the argument that it "belongs to the project, not the framework… one boolean that any
> project can read from a controller of its own". That reasoning holds, and it landed *here*: `zi new`
> is the project, and nobody had written the controller the withdrawal assumed somebody would. It is
> generated now, as `src/controllers/health.controller.ts`, and the split it draws is the one the
> withdrawal implied: `/health/live` answers on the process alone, because a liveness check that
> reaches for the database turns an outage of the database into a restart loop of the application,
> and `/health/ready` answers `503` from the moment the application starts shutting down. That is
> also where §C3's reverted 503 drain belongs — the objection to it was that a window which 503s
> correctly-routed traffic is worse than no window, and a probe saying "stop routing to me" is the
> same signal without the traffic. It carries `versions: 'all'` so a version bump leaves the probe
> URL alone, and `@Auth.skip({ allowRedundant: true })` so it survives the switch to `'requireLogin'`
> that the generated options invite two lines away.
>
> **The Dockerfile**, with `.dockerignore` beside it. [05 §P6](./05-di-metadata-and-packaging.md) did
> want settling first and turned out to settle the other way: a `dist`-only image is not a deployment
> shape at all, because the bundle leaves `express`, `handlebars` and `ejs` as runtime requires. So
> the image is `package.json`, `node_modules`, `dist` and `versions`, and the last of those is a
> `COPY` line that has to be there — which is exactly what the boot-time refusal below makes
> enforceable rather than hopeful. The build stage prunes to production dependencies and the runtime
> stage copies that tree, rather than resolving the manifest a second time: what the application runs
> against is then what its bundle was built against, which two installs cannot promise.
>
> **A defect found on the way, and it is the reason this round was worth doing at all.** The
> versioning service created its `versions` folder at startup when it found none, and then recorded
> the version it was on as the first that ever existed. On a developer's machine that is the intended
> first run. In a container it is what happens every time the folder is left out of the image — and
> it happens *quietly*, with a healthy application serving traffic and every guarantee the route
> history exists to give silently gone. The folder is something a project checks in, so an absent one
> is now a refusal to start that names the path, and only an empty one is taken as permission to
> record a first snapshot. `zi new` writes a `.gitkeep` into it for the same reason: git records
> files rather than folders, so without one the first commit of a generated project dropped both
> `versions` and `translations`, and the clone after it had a build that failed on a folder its own
> config named.
>
> **And it found a second one, of exactly the shape this finding opened with.** A generated project's
> first `npm run build` failed: the webpack config extracts translations into `source.xlf` on every
> build, which writes XML through `xmlbuilder2` — an *optional* peer of the framework, so npm installs
> it for nobody, and `zi new` was not asking for it. `packages/sandbox` declares it and therefore
> builds, so the two had diverged; the parity suite could not say so, because `package.json` is the
> one file the fast suite excludes. **It was written down instead.** `acceptedSandboxDifferences`
> carried `xmlbuilder2` as intended divergence under the reasoning that "the sandbox ships
> translations and a generated project does not" — which is not what the dependency is for. The build
> extracts unconditionally, and `LocalizeService.onAppInit` parses the result back at startup, so a
> project needs it whether or not it has a single translation. That also settles where it goes: a
> development dependency would be pruned out of the image by the runtime stage, and the application
> would build and then fail to boot.
>
> `otpauth` was the same thing one step later, found once the application actually booted: a project
> that names no two factor methods is given `OtpTwoFactorMethod`, which asks for it as it is
> constructed. **The pattern under all of them is worth stating once**: a peer is optional to the
> *framework* and not to an application that takes the defaults, so what the generator has to install
> is whatever its own generated configuration reaches for. Four now — the compiler for worker files,
> the cursor driver, the XLIFF writer and the otp implementation — and each is droppable exactly when
> the default that wants it is turned off.
>
> That is the second time this file has been found recording a defect as a difference, after the
> missing comma above. The mechanism is the same both times — an accepted difference can express "these
> two legitimately differ" and cannot express "and one of them is broken" — and both were caught by
> running the thing rather than by comparing it.
>
> **Past the install, the build itself found two more, and both are the same gap seen from different
> sides: nothing had ever type-checked a generated project.** The fast suite deliberately checks
> syntax only — "types would need the install this suite stubs out" — and these are exactly what lives
> in between.
>
> `src/templates/pages/metrics/cache/cache-details-section.tsx` imports `./cache-detail`, and the cli
> had no template for it. Every project ever generated carried an import of a module that was never
> written. **The parity suite could not see it, and the reason is structural rather than an
> oversight**: the list of files to compare is built by walking the cli's own template folder, so a
> file missing from the cli is missing from the list of things to check as well. The comparison only
> looks one way — it can say the sandbox disagrees with a generated file, and cannot say the sandbox
> has a file that should have been a template. Copying it across added a parity case on its own,
> which then passed.
>
> `src/templates/emails/log.tsx` still destructured `{ log }` after [04 §3.4](./04-infrastructure-subsystems.md)
> made a log email a digest and the property `logs: Log[]`. The template that ships to every project
> had not been touched, so it referenced a property its own type does not have — three type errors,
> in the cli's copy and the sandbox's alike. It renders the batch now, titled by the worst level in
> it, which is what a digest of thirty info logs and one critical error is actually about. Those three
> errors plus a fourth in the sandbox's preview controller had been sitting in this repository being
> reported as a known-and-unrelated baseline; they were neither. `packages/sandbox` type-checks clean.
>
> **And then it found the one that matters most, which nothing short of running a built application
> could have found: an optional peer dependency reads as missing inside a bundle, however installed
> it is.** `hasOptionalPeer` asked `require.resolve`, and `optionalPeer` asked `require` — both of
> which a bundler rewrites into lookups in *its own* module map. A package the config deliberately
> leaves `external` is not in that map, so the answer is always no. A generated application therefore
> refused to start with *"the data source needs the optional peer dependency pg-query-stream, which
> is not installed"* while `pg-query-stream` sat in its `node_modules`, having been installed for
> exactly this. Every guarded feature had the same hole: `bcryptjs`, `otpauth`, `pdfmake`,
> `xmlbuilder2`, `handlebars`.
>
> The evidence was already in the repository, which is the part worth keeping. `resolveZibriRoot`
> compiles to `resolvePackageJsonPath = () => /*require.resolve*/(919)` — webpack replaced a path
> lookup with a module id — and the line under it reads *"keep the fallback even though
> require.resolve succeeds in plain (unbundled) Node.js"*. Somebody met this once, worked around it
> in the one place it bit, and the general case went on being written the same way. The generated
> webpack config even silences the warning that announces it, `"Critical dependency: the request of a
> dependency is an expression"`. Both functions resolve through `createRequire` anchored at the
> application root now, which asks node rather than the bundler and answers the same either way.
>
> **A second thing the same failure showed: it exited 0.** The container reported `exited (exit code
> 0)` after a fatal boot error, because `void start()` leaves the rejection to the framework's
> `unhandledRejection` handler, which logs it and lets the process end normally — weakening node's
> own default of terminating non-zero. An orchestrator reads the code: a container that stops with 0
> has done its job, so a rolling deploy carries on and a restart policy leaves it stopped. The
> generated entry point catches and exits 1. **The framework half stays open**: a rejection *after*
> boot is still logged and survived, which is defensible for a running server and is not the same
> decision as the one made here — [02 §C3](./02-http-runtime-core.md) settled exit codes for the
> shutdown path and never covered this one.
>
> `new.command.docker.heavy.test.ts` builds the generated Dockerfile and runs the image against a
> database container, then asks the application the questions that only a running one can answer:
> whether it serves its own home page, whether both health routes respond, whether the version
> history came with it, whether the process runs as a user that owns the two paths it writes and
> nothing else, and whether the `.env` it was generated with stayed out of the image. Reading the
> generated files could not have answered any of them.
>
> The CI workflow stays open. It is opinionated in a way none of the rest is — a provider, a
> registry, a release trigger — and it belongs with
> [§CD5](#cd5-no-version-bump-changelog-or-tag-automation--minor-open-by-decision), which is the same
> decision asked once.

I did not review the templates in depth. The questions an evaluator would ask — does `zi new`
produce a Dockerfile, a health endpoint, environment-based configuration, a CI workflow, a test
setup, and a `synchronize: false` data source — remain open. Given
[01](./01-data-layer.md) §C1, the last of those matters most.

> **One of the questions has been answered, and it was a defect.** The generated `webpack.config.js`
> copies four folders into `dist`, and copy-webpack-plugin refuses a `from` that does not exist —
> the scaffold created two of them. A fresh project's very first `npm run build` failed on
> `versions` and `translations`, folders its own generated config named. The sandbox has both
> because they were written by hand, which is exactly how a parity suite can be green about a broken
> generator.
>
> `zi new` creates them now, empty, which also says where each thing goes: a version snapshot, and
> the extracted translation source. The alternative — `noErrorOnMissing: true` on those two patterns
> — was rejected as the weaker answer, since it makes the build tolerate the absence rather than the
> project have somewhere to put them.
>
> **The check is static, so it runs in the fast suite**: `new.command.sandbox-parity.test.ts` reads
> every `from: path.resolve(__dirname, …)` out of the generated config and asserts the generator
> made it. No install, no build, no network — which matters, because "nothing compiles the scaffold"
> is what let this exist, and a check that needs a compile would have been skipped the same way.

### C6. `exitGracefully` waits for something that never happens — MINOR, **open**

The cli's every error path ends in `exitGracefully`, which sets `process.exitCode`, awaits
`finished(process.stdout, { writable: true })` and `finished(process.stderr, …)`, and then calls
`process.exit(code)` from a `finally`. The intent is to flush before exiting, and `stream.finished`
is the wrong question for it: with `writable: true` it settles when the stream *ends*, and a live
process's stdout does not end while the process is running. Verified directly — a script awaiting
exactly that pair sits there until something else stops it.

So neither half of the function does what it reads as. The flush is a promise that never settles,
and the `process.exit` under it is unreachable. A cli run still ends with the right status, because
the event loop empties with nothing left pending and node exits on `process.exitCode` — the correct
outcome arrived at by the function not working.

It only becomes visible where something else holds the loop open. Under a test runner the process
never ends, so a command that refuses stops there: three of the four suites that generate a project
run `zi new` for real, and one of them met a work directory a killed run had left behind. The
generator printed exactly the right refusal and then hung, and what the suite reported was a
timeout with the reason a few hundred lines up in captured console output.

The suites no longer depend on the previous run having cleaned up — `emptyWorkDirectory` clears
before it creates, which is what the docker suite already did for container names and for the same
reason — so the refusal is no longer reachable from a test. That is why this is filed rather than
fixed: the trigger is gone, and what is left is a function whose behaviour and whose text disagree.
Making it true means flushing what is *queued* rather than waiting for an end that never comes, and
then the `process.exit` starts running — which is a behaviour change on every error path, including
inside a test runner, where it would take the worker down instead of hanging it. Worth doing
deliberately rather than as a side effect of this.
