# DI, metadata, packaging, build, CI, CLI, testing framework, TSX compiler — round 2

Read in full: `packages/zibri/src/di/di-container.ts`, `init-di-container.function.ts`, the
`@Injectable` decorator, `di-provider.model.ts`, the DI errors, `global/global-registry.ts` and
`framework-copies.ts`, the init sweep in `application/application.ts` (`:318-357`, `:575-765`),
`utilities/optional-peer.function.ts`, `resolve-app-root.function.ts`, `register-ts-node.function.ts`,
`resolve-call-sites.function.ts`, `validate-tokens-registered.function.ts`, `document/pdf.utilities.ts`,
`localization/xlf/generate-source-xlf.function.ts` and `transform-source-translation-tokens.function.ts`,
`tsx/tsx.utilities.ts`; all five `package.json` files, the lockfile's shape, every `tsconfig*.json` and
`jest.config.mjs` of `packages/zibri`, all four workflows; `packages/cli` (`new.command.ts` in the
parts that install, write the Dockerfile and the test files, the command list, the templates
directory, the recorded output of the docker heavy test); `packages/testing` (`index.ts`,
`start-test-server.function.ts`, `start-data-source-containers.function.ts`, the cluster fork and
module-path preload, the in-memory driver's error surface); `packages/tsx` (`package.json`, the
webpack loader and vendor plugin, `build/vendor.ts`, `semantics/symbols.ts`, the jest transform);
`docs/di.md`, `testing.md`, `deployment.md`, `releases.md`, `multithreading.md` (worker section) and
the relevant lines of `upgrading-to-3.md`, `templating.md`, `document.md`, `getting-started.md`;
evaluation chapters 05, 06, 09, 11, the evaluation-tests README and the user's list. Not reached:
see the last section. Several files cited below are modified in the working tree
(`new.command.ts`, `start-test-server.function.ts`, `start-test-cluster.function.ts`,
`start-data-source-containers.function.ts`, `accepted-sandbox-differences.ts`); line numbers are
against the working tree and each such citation says so.

## CRITICAL

None filed. Two of the MAJORs below (T2, T3) are the ones I weighed for this level and kept lower on
purpose: T2 is loud and has a one-line workaround, T3 needs a specific construction order.

## MAJOR

### T1. The cluster and evaluation suites — the regression tests for the Tier-1 findings — never run in CI — MAJOR
*Filed 2026-10-21.*

> **Closed 2026-10-23.** `test:ci` now runs `test:evaluation` and `test:cluster` after the coverage
> runs, so CI's `test` job runs them on every node line of the matrix. All of them were green in the
> user's last runs (2026-10-21, 2026-10-23), so nothing had to be excluded by name. The case the Verify
> note asked for is wider: *runs every test file of the framework* in `ci-workflows.test.ts` reads
> every `npm run … -w zibri` of `ci.yml`, follows `npm run` through the package scripts to the jest
> runs they end in, and fails on any `*.test.ts` under `packages/zibri/src` that none of their
> `--testPathPatterns` reaches. It was red with exactly the 46 evaluation and 15 cluster files before
> the script changed, and green after. A new suffix kept out of `test:normal` is caught the same way.
> Resources were weighed and are not the limit: the public repository's hosted linux runner has
> 4 vCPUs and 16 GB, and the job already ran the multithreading performance suite (`test:heavy`) and
> the container-backed suites. What it costs is wall clock per matrix line. Along the way: the
> evaluation README no longer says its tests are red and kept out of the pipeline, its
> `heterogeneous-events` row is green (closed with 04 §1.4b), the multithreading performance test's
> comment no longer claims it is excluded from `test:ci`, and CODE_STYLE.md says what CI runs. The
> second half of the user's list item (fold the evaluation tests into the normal ones and drop their
> evaluation references) is not part of this and stays on that list. Not run in CI yet: the first push
> is the real check.

CI's test job runs `npm run test:ci -w zibri` (`.github/workflows/ci.yml:61`). `test:ci` is
`test:coverage` (`packages/zibri/package.json:34`), which is `test:coverage:normal` and
`test:coverage:heavy` (`:40-42`). `test:normal`'s pattern excludes `.evaluation.test.ts`,
`.cluster.test.ts` and `.benchmark.test.ts` (`:36`); `test:heavy` is a fixed list (`:35`). So the
ten cluster scenarios under `src/__testing__/evaluation/cluster/` and the 45 evaluation suites run
only when a developer types `npm run test:cluster` / `npm run test:evaluation` by hand. The package's
own `test` script does include them (`:33`), but CI does not call it.

Those suites are where the previous review's central argument lives. The evaluation README's own
table marks `cron`, `events`, `migrations`, `caching`, `websocket`, `mail`, `lock` and `shutdown`
"green — closed, now a regression test" (`packages/zibri/src/__testing__/evaluation/README.md:449-460`),
and the reason it gives for keeping them out of the pipeline — "so the pipeline keeps signalling real
regressions rather than a constant wall of known gaps" (`:13-16`) — was written when they were red.
With 302 of 315 findings closed (`evaluation/11-whats-left.md:7`), the wall is gone and what is left
out of CI is the proof that the cluster coordination, the schema lock and the lease fold still hold.
A change that reintroduces cron firing on every replica passes the build.

Nothing technical stops them running there: the same job already runs testcontainers-backed suites
on `ubuntu-latest`, and the cluster script is `--runInBand` by design. The cost is wall-clock time,
which is a matrix-sizing question rather than a reason. The user's list already names the second half
of this ("integrate the evaluation tests into the normal tests or remove their evaluation references",
`evaluation/after-all-findings-fixed.md:8`); the first half — that the cluster suites gate nothing — is
the part that matters to an adopter reading "closed" in chapter 10.

The obvious shape: `test:ci` runs `test:cluster` and the green evaluation files (the still-red ones
are listed in that README and can be excluded by name until closed), and `ci-workflows.test.ts`
asserts the CI test job invokes them, the way it already asserts the matrix and the audit gates.

**Verify:** add a case to `packages/zibri/src/ci-workflows.test.ts` asserting that the commands of
the `test` job include a script whose jest pattern matches `.cluster.test.ts` (red today); then run
the workflow once and read the cluster suites' output.

### T2. `zibri-testing` cannot be loaded without its optional `testcontainers` peers, so a generated project's tests fail on a registry install — MAJOR
*Filed 2026-10-21.* Regression of the decision recorded in 06 §T2/§T3.

> **Closed 2026-10-23.** Wider than filed: every optional peer of the harness was imported at the top
> of a module the barrel exports, not only the two container packages - `@peculiar/x509`
> (`createFakeKeyPair`, `FakeFidoMetadataService`), `ldapts` (`FakeLdapDirectory`), `xml-crypto` and
> `xml-encryption` (`FakeSamlProvider`) as well. Each is now loaded through the framework's
> `optionalPeer`, which `zibri` exports for it, where the feature is set up: a container only for a
> data source that `needsContainer`, the fakes in their `create`, `xml-encryption` only for a provider
> with `encryptsTo`. Types stay `import type`. `ts-node` is an optional peer of `zibri-testing`, and
> `startTestCluster` asks for it before anything is forked, so a missing one is named rather than each
> instance dying on `MODULE_NOT_FOUND`. A missing `xml-crypto` would have read as a signature that does
> not verify, since `isXmlSignedBy` swallows every error; it is now asked for before the `try`. Test:
> *the test harness* in `optional-peer-dependencies.test.ts` loads the built `dist/index.js` with each
> optional peer hidden, plus the named errors for a container without testcontainers and a cluster
> without ts-node - 9 red before (all six peers failed the load), green after. `docs/testing.md`
> gained an *Optional packages* table, and a case keeps it complete against the manifest (written
> after the table, so never red). CI's `test` job builds `zibri-testing` before `test:ci`, since the
> check loads the build. Second half of the Verify note: `new.command.docker.heavy.test.ts` runs
> `npm test` in the registry-installed project, inside the base image, after asserting the lock has
> no `node_modules/testcontainers`; container-backed, not run here.

`packages/testing/src/start-data-source-containers.function.ts:1-2` (modified in the working tree)
imports `PostgreSqlContainer` and `GenericContainer` at the top of the module, and both are used as
values (`new GenericContainer(...)` at `:199`, `new PostgreSqlContainer(...)` at `:208`), so the
compiled module `require`s both packages when it loads. The barrel re-exports that module
(`packages/testing/src/index.ts:56`) and `start-test-server.function.ts:10` imports from it, so
`import { startTestServer } from 'zibri-testing'` loads it unconditionally. Yet
`packages/testing/package.json:41-69` declares `testcontainers` and `@testcontainers/postgresql` as
*optional* peers — which npm does not install. 06 §T3 records the decision in so many words:
"`testcontainers` and `@testcontainers/postgresql` moved from dependencies to optional peers along
the way... a generated project was installing the container tree to run tests that mostly need
none" (`evaluation/06-tooling-ci-and-testing.md:1268-1270`). The manifest moved; the import did not.

What a consumer gets: `zi new` installs `zibri-testing` alone (`new.command.ts:303-306`, working
tree), writes a test that imports `startTestServer` (`:755-756`) and a test options module built on
`createInMemoryDataSource`, and `npm test` fails with `Cannot find module '@testcontainers/postgresql'`
before any test runs. The recorded output of the one heavy test that installs from a registry rather
than from `file:` shows exactly this tree: `packages/cli/src/__testing__/file-output/new-command-docker/api/package-lock.json:9259-9296`
has `zibri-testing@3.0.0` with the two packages only inside its `peerDependencies` block and no
`node_modules/testcontainers` entry anywhere in the file. That suite builds an image and never runs
the project's tests; the suite that does run them (`new.command.heavy.test.ts:27`) sets
`ZIBRI_CLI_LOCAL_DEV=1`, which installs `zibri-testing` as a `file:` link into this repository, where
node resolves `testcontainers` through the monorepo's hoisted `node_modules`. The defect is therefore
invisible to every test here, for the same structural reason 06 §C4 recorded for `xmlbuilder2`.

The same manifest has a second undeclared dependency: the cluster fork runs every instance with
`execArgv: ['-r', 'ts-node/register', ...]` (`packages/testing/src/cluster/start-test-cluster.function.ts:451`,
working tree) and `ts-node` appears nowhere in `packages/testing/package.json`. It works for a
scaffolded project only because the scaffold installs `ts-node` as a production dependency of the
application (T9).

The fix direction is the one 05 §P3 already applied to the framework: reach for the container
packages through `optionalPeer` where a container is actually started (`startDataSourceContainers`,
reached only for a data source that `needsContainer`), declare `ts-node` as an optional peer, and give
`zibri-testing` the same "hide each peer and load the built package" check that
`optional-peer-dependencies.test.ts` gives `zibri`.

**Verify:** a test in `packages/testing` that loads the built `dist/index.js` in a child process with
`testcontainers` and `@testcontainers/postgresql` removed from module resolution, asserting the
import succeeds (red today); and extend `new.command.docker.heavy.test.ts` to run `npm test` inside
the registry-installed project (red today for the same reason).

### T3. A request-scoped value is captured by an application-scoped service when that service is first built under a request-scoped frame — MAJOR
*Filed 2026-10-21.*

> **Closed 2026-10-23.** `injectRequestScoped` now refuses when *any* frame in `constructing` is kept
> for the application, and names the nearest such frame as the holder. Neither the outermost frame
> (this finding) nor the nearest one alone is enough: the nearest can be a transient that a kept
> class holds as a field. Tests in `di-container.test.ts`: *refuses to be built into something kept
> that is first built for a request scoped holder*, the filed shape over two requests, both rejecting
> (red before: it resolved); and *lets something built afresh for a request scoped holder hold it*
> (request → transient stays allowed, green before and after). `docs/di.md` already states the rule
> for every service kept for the application, so it is unchanged.

`injectRequestScoped` decides whether a request-scoped value is about to be built into something
longer lived by reading the *outermost* construction frame only: `this.constructing.at(0)`
(`packages/zibri/src/di/di-container.ts:480-483`), and the comment beside it says why — "the
outermost frame ... is what decides how long everything under it is kept". That is true when the
outer frame is the longer-lived one. It is false when an application-scoped class is first
constructed *inside* a request-scoped class's construction: the stack is then
`[RequestScoped, ApplicationScoped]`, `at(0)` has scope `'request'`, the check passes, the
application-scoped instance receives the current request's value, and `inject` caches it for the
process lifetime (`:359-364`). Every later request is answered with the first request's value.

The shape: `@Injectable({ scope: 'request' }) class RequestAudit { constructor(readonly audit: AuditService) {} }`
and `@Injectable() class AuditService { readonly tenant = inject(CurrentTenantService); }`. Nothing
builds `AuditService` at startup (it declares no hook, 05 §M4), so its first construction happens
inside the first request's `inject(RequestAudit)`. This is precisely the failure `docs/di.md:194-202`
promises is an error — "A service that is kept for the application would hold the first request's
value and hand it to every request after that, so building one raises a `CapturedRequestScopeError`"
— and the 05 §D2 blockquote calls the silent version "a worse bug than the thing it replaces". The
only test of the check is the direct case, an application-scoped holder at the top of the stack
(`di-container.test.ts:86-95`); nothing in the framework uses `scope: 'request'` itself, so no suite
reaches the nested case.

For a multi-tenant deployment this is a cross-tenant read with no error and no log line. It is not
CRITICAL only because the triggering shape needs a request-scoped class that takes an application-
scoped one by constructor, and the docs steer towards `inject()` in methods instead.

The fix is one line: refuse when *any* frame in `constructing` has a scope that outlives the request
(the nearest one that will be cached is what decides), not the first.

**Verify:** a case in `di-container.test.ts` with the two classes above: two `asARequest` calls
each doing `inject(RequestAudit)`, asserting the first throws `CapturedRequestScopeError`. Red today:
it resolves, and the second request's `audit.tenant` is the first request's object.

### T4. An asynchronous provider is only safe to `inject()` from a class the sweep reaches *after* it, and the documented form is the one that fails — MAJOR
*Filed 2026-10-21.*

> **Closed 2026-10-23.** Not by the pre-pass the fix direction proposes. That would run every
> async factory before `DataSourceService.beforeAppInit`, which is what registers the repositories a
> factory may name in `deps`. It would also leave two holes open: a data source's `options`, where a
> vault password goes, are built inside that hook with a plain `inject`; and an async factory whose
> declared class hides an async value of its own still depended on order. The fix has four parts:
> - **The hidden edge is found by trying.** `DiContainer.injectAwaitingWhatItReaches` builds a
>   non-async token. On `UnresolvedAsyncProviderError` (which now carries its `token`) it awaits
>   that token, keeping the chain, so a real cycle is still a `CircularDependencyError`, and builds
>   again. What the attempt built is cached and reused; code before the failing line runs a second
>   time. That tradeoff was accepted.
> - **The sweep order is data sources, then every async factory, then the rest**
>   (`ZibriApplication.resolveSweepRank`). This covers the one place the container cannot retry:
>   a `beforeAppInit` body.
> - **Data sources are built through `injectAsync`**, both in `DataSourceService` and in the three
>   places `zibri-testing` builds them ahead of init (`buildDataSources`: container start, `reInit`,
>   cluster replicas).
> - **Found on the way:** inside an async factory, *every* `inject()` in the call tree was refused,
>   the framework's own included (a repository reaching for its tracer). So a factory reading
>   through a repository it declared, the docs' "warmed cache", never worked. Only an *async* token
>   is refused now, resolved or not; anything else is built on demand in any order.
>
> The `UnresolvedAsyncProviderError` text now names the one remaining cause, a provider registered
> after the awaiting started. `docs/di.md` and the `useAsyncFactory` JSDoc state the narrowed
> refusal. Tests:
> - in `di-container.test.ts`, red before: a field initializer, a sync factory body, a class behind
>   an async factory's `deps`, *builds what a class reached for before the awaited value once*, a
>   cycle through a field initializer (red: it reported the unresolved value instead of the cycle),
>   *lets the factory use what it declared, whatever that reaches for itself*, and the error text;
> - in `di-container.test.ts`, green before and after: *refuses an awaited value reached for through
>   what the factory declared*;
> - in `application.async-providers.test.ts`, all red before, through `startTestServer` on an
>   in-memory data source: an `OnAppInit` service's field initializer, a data source's field
>   initializer, and an async factory with `deps: [repository]`.

05 §D6 closed on the argument that the order among asynchronous providers must be known from outside
the factory bodies, and `deps` plus constructor parameters supply it. What the container follows is
exactly that and nothing more: `resolveAsync` awaits the `deps` of an async factory and the
*constructor parameter* tokens of a class (`di-container.ts:397-417`, `:449-454`); a field
initializer or an `inject()` inside a sync `useFactory` body is invisible to it. The sweep then
resolves tokens in one pass, in registration order with only `DATA_SOURCE_SERVICE` pulled to the
front (`application/application.ts:694-715`). Registration order is: framework defaults, then every
`@Injectable` class (`init-di-container.function.ts:16-21`), then plugin providers, then the
application's `providers` array (`application.ts:336-338`). An application's async providers are
therefore always registered *after* its decorated classes.

So `@Injectable() class WarmIndexService implements OnAppInit { private readonly password = inject(vaultSecret); }`
with `vaultSecret` as a `useAsyncFactory` in `providers` fails at boot: the sweep builds
`WarmIndexService` first (it declares a hook), its field initializer calls `inject(vaultSecret)`, the
provider is still unresolved, and `inject` throws `UnresolvedAsyncProviderError` (`:336-338`).
`docs/di.md:239-244` shows precisely this field-initializer form (`SecretReadingReportService`) as
the way to consume an awaited value, and `:259-261` says "the order the two are registered in does
not matter". The error's text then misdiagnoses it: "it is registered with `register: 'onUse'`, or
added after initialization" (`di/errors/unresolved-async-provider.error.ts:20-24`) — neither is true,
and its advice, "Register it in the application's providers array", is what the reader already did.
The same holds for a sync `useFactory` in the providers array that `inject`s an async token
registered later in that array: it works or fails by array position.

A workaround exists (take the token as a constructor parameter with `@Inject`, which the walk sees),
which keeps this out of CRITICAL; what makes it MAJOR is that a documented pattern fails at first
boot with a message that points away from the cause, in the feature whose whole closing argument was
order independence.

Fix direction: resolve every `useAsyncFactory` provider (with its `deps`) in a pre-pass before the
general sweep — they are known from the provider shape without running anything — and have the error
name the sweep order when the provider *is* registered.

**Verify:** a case in `di-container.test.ts`: register `vault` as `useAsyncFactory`, then
`@Injectable() class Warm { readonly secret = inject(vault); }`, and `await injectAsync(Warm)`;
assert it resolves. Red today with `UnresolvedAsyncProviderError`. (At the application level, the
same with `implements OnAppInit` through `startTestServer`.)

### T5. A generated project has no upgrade path: 52 framework-coupled templates and ~1,600 lines of generated configuration are copied into user space once and never revisited — MAJOR
*Filed 2026-10-21.* From the "never reviewed" list in 09.

> **Closed 2026-10-23.** Both directions, (a) for the configuration and (b) for everything else; the
> metrics explorer half of (a) is filed as §T21. Decided with the user before it was built.
> - **The framework knowledge leaves the project.** `zibri/webpack` exports
>   `resolveWebpackConfiguration({ root })`: the externals, the loaders, the source generation, the
>   vendor bundles, the `?client` replacement, the copied folders and the watch restart. Its build
>   packages are loaded from the application's root and are optional peers of zibri. `zibri-testing`
>   ships a jest preset (`zibri-testing/jest-preset`, `ts-jest` an optional peer), and zibri ships
>   `tsconfig.application.json`. The generated `webpack.config.js` is one call, `jest.config.mjs` names
>   the preset, and `tsconfig.json` extends the shipped config and keeps only `outDir` and `include`,
>   which an extended config would resolve against itself. The sandbox matches; it builds through the
>   factory, and its suites run through the preset.
> - **`zi upgrade` for everything still generated.** `zi new` writes `zibri-scaffold.json`: the cli
>   version, the answers, and each file's git blob id. `zi upgrade` installs `zibri`/`zibri-testing`
>   at its own version plus every package the generator lists that the project lacks, then generates
>   into a temporary folder and handles each file. A file the project never changed is replaced, and
>   one it deleted stays deleted. One both changed is merged with `git merge-file` against the version
>   read back out of the project's history by its id, leaving conflict markers where they collide. With
>   no such version (never committed, a binary, or a project from before the manifest), the new
>   version is written beside as `<file>.zibri-upgrade`. A file no longer generated is removed when
>   unchanged. Arguments override the recorded answers (`zi upgrade github` adds the workflow), a
>   project without a manifest is asked for them, and a manifest from a newer cli is refused before
>   anything changes. `generateFiles` is split out of `NewCommand.run` for this; the answers, the
>   questions and the dependency lists moved to `packages/cli/src/scaffold/`.
> - **Found on the way, both fixed red first:** `zibri-tsx`'s structural `CompilerLike` typed
>   `tapPromise` as returning `Promise<unknown>`, so `ZibriTsxVendorPlugin` was not assignable to
>   webpack's own plugin type. Nothing noticed, because every config that used it was JavaScript, and
>   zibri's typecheck of the factory was the red test. Its subpaths also had no `typesVersions`, so
>   `module: commonjs` resolution (zibri's own build among them) found no types for `zibri-tsx/webpack`,
>   `/jest`, `/compiler`, `/email` or `/jsx-runtime`; `runtime-entry.test.ts` has a case per subpath.
>   Its one-element arrays put the lint rule `json/array-bracket-newline` against npm's own manifest
>   format, which the release bump reproduces and `ci-workflows.test.ts` holds it to. The root eslint
>   config turns that rule off for `package.json`, as the shared config already does for key order.
>   The `zibri/webpack` entry needed `reflect-metadata` of its own, since a webpack config loads it
>   before anything else of the framework. `published-package.test.ts` loads it alone in a fresh
>   process, and that case was red with `Reflect.getOwnMetadata is not a function`.
>
> Tests, red before: in `new.command.test.ts` the webpack config evaluated with a stand-in factory,
> the jest config, the tsconfig and the manifest (ids checked against `git hash-object`), and
> `upgrade.command.test.ts` (11 cases on real git repositories). Also `resolve-webpack-configuration.function.test.ts`
> (webpack's own `validate`, the root used wherever webpack starts, the copied folders against the
> sandbox, and the restart cases moved from the cli), and the three entry points in `published-package.test.ts`.
> The parity suite's "creates every folder its webpack config copies" moved to zibri with the config.
> Docs: getting-started (`zi upgrade`, the shipped configs, the new optional peers), testing (the
> preset), releases (the entry points), and the upgrading-to-3 entry rewritten around `zi upgrade`.
>
> After the lockfile was updated, the consumer-tree license check found `caniuse-lite` (CC-BY-4.0).
> It comes in through the `webpack` peer, and every generated project already had it through its
> devDependencies. CC-BY forbids passing the material on under further restrictions, which MIT
> allows, so the user decided against allowing it in general. The policy gained `allowedFor`: a
> license allowed for one named package at every version, with the reason recorded. `ci-workflows.test.ts`
> has the rule as a case (red first), and `deployment.md` names the allowance, which the docs case
> now checks too.

`zi` has three commands: `help`, `new`, `version` (`packages/cli/src/commands/`). `new` writes, from
string arrays in a 1,642-line file (`packages/cli/src/commands/new/new.command.ts`, modified in the
working tree), the webpack config with its hand-maintained `externals` list of typeorm's optional
drivers (`:1443-1455`, mirrored in `packages/sandbox/webpack.config.js:112-144`), the Dockerfile, the
CI workflow, `env.ts`, the health controller, the tsconfig, the jest config — and copies 52 `.tsx.tpl`
templates (`packages/cli/templates/**`), of which 20 are the metrics explorer pages and 11 the email
layer. Those templates import framework types: `MetricsSnapshot` (`templates/pages/metrics/metrics.tsx.tpl:2`,
`cache/cache-detail.tsx.tpl:2`), `LogEmailTemplate` (`templates/emails/log.tsx.tpl:1`). They are
framework UI living in the application's `src/templates`.

What that costs over time is already on record in this repository: 06 §C4 found the sandbox's copy of
`log.tsx` destructuring `{ log }` after the framework made it `logs: Log[]` — "three type errors, in
the cli's copy and the sandbox's alike" (`evaluation/06-tooling-ci-and-testing.md:1302-1308`). The
parity suite catches that for the sandbox and the cli template. It cannot reach the copy in any
consumer's project, which breaks the same way on the same upgrade, in files the developer never
wrote. The upgrade guide's answer is manual: "Run `zi new` somewhere else and copy what differs"
(`packages/zibri/docs/upgrading-to-3.md:28`). After a year of releases that is the whole mechanism
by which the `createRequire` fix for bundled optional peers, the `onlyCompileBundledFiles` fix,
the Dockerfile's `versions` `COPY` line and a new typeorm driver in `externals` reach an existing
project.

For an enterprise this is the "what does an upgrade cost" question, and the honest answer today is
"diff two scaffolds by hand". Two directions, not obviously exclusive: (a) move the framework's own
pages out of user space — serve the metrics explorer from the framework (it already serves its docs
surface, 02 §M13) and ship the email layer as components the project *imports* rather than copies;
(b) a `zi upgrade` that regenerates the generated files against the project's answers (the three
`zi new` questions are already arguments) and three-way-merges, with the template files carrying a
generator version header so drift is detectable.

**Verify:** take the recorded registry-installed scaffold
(`packages/cli/src/__testing__/file-output/new-command-docker/api`), point its `zibri` at the working
tree build, run `tsc --noEmit` and count the errors in `src/templates/**` and `webpack.config.js`; a
heavy test of that shape (generate at tag N, build against N+1) is what would hold it.

### T6. The template compiler and the translation extractor run on TypeScript's in-process compiler API, and a mandatory peer pins the application's TypeScript to `^5.9` — MAJOR
*Filed 2026-10-21.*

> **Closed 2026-10-23** by the first fix direction, the user's choice of three:
> - **The peer ranges are widened.** `zibri-tsx` (mandatory) and `zibri` (optional, for the
>   extractor) take `typescript ^5.9.2 || ^6.0.0`.
> - **Every major in the range is tested.** TypeScript 6 is a devDependency under the alias `typescript-6`.
>   `npm run test -w zibri-tsx` runs the whole suite a second time through
>   `jest.typescript-6.config.mjs`, which points `typescript` at it for the code under test, so CI runs
>   both. In `optional-peer-dependencies.test.ts`, the built extractor reads the framework's sources
>   on each major and must find the same translations.
> - **The rejected alternatives:** moving the API users to `@typescript/typescript6`, as the paused ESM
>   branch decided, and leaving it all to that move.
>
> Red before the widening: the new range cases in `runtime-entry.test.ts` (on the TS 6 run) and in
> `optional-peer-dependencies.test.ts`. Everything else passed on TypeScript 6.0.3 unchanged: 721 of
> 722 compiler tests, and the same translation count as on 5.9. The getting-started requirements name
> both versions. TypeScript 7, the forward-looking half of this finding, is tracked as a GitHub issue
rather than here.

`zibri-tsx` declares `typescript ^5.9.2` as a *mandatory* peer (`packages/tsx/package.json:63-65`),
and the compiler is built on the JavaScript compiler's programmatic surface: a `ts.Program` per
template with a `TypeChecker` for symbol resolution (`packages/tsx/src/semantics/symbols.ts:40,106`),
`ts.transform`/`ts.factory` and `ts.createPrinter` for emission, `ts.transpileModule` for type erasure
(`codegen/erase-types.ts`). The XLIFF extractor in the framework does the same through the optional
peer (`transform-source-translation-tokens.function.ts:144-174`), and `zibri` itself declares
`typescript ^5.9.2` (`packages/zibri/package.json:94`). The scaffold installs `typescript@^5.9.3`
(`new.command.ts:253`).

Two consequences for an organisation that standardises its TypeScript version centrally. Today: an
application on a TypeScript major outside `^5.9` cannot `npm install` a Zibri app without
`--legacy-peer-deps` or an alias, because the compiler the pages need is the same copy the
application compiles with. Whether 6.0 is generally available I could not confirm offline. Ahead:
TypeScript's native (Go) compiler does not offer the in-process `Program`/transformer/printer API
these two components are written against, so the day an organisation moves its build to it, the
template compiler and the extractor need a second, JavaScript TypeScript kept installed for them —
the `?client`/`onClient` design that 06 §X1 bought by deleting the hand parser is now a dependency
on one specific implementation of TypeScript. This is the forward-looking half of "the TSX compiler
as a maintenance liability": the grammar risk is gone and an API-lifetime risk took its place.

Checked that it is deliberate: 06 §X1 records the decision ("stop owning a grammar") and its
packaging consequence (`zibri-tsx/compiler` subpath so the runtime never loads TypeScript), and both
hold. What it does not record is a version policy for the peer, or what the analysis needs that a
syntax-only parser (e.g. the `@typescript/native-preview` syntax API, or a non-TS parser plus the
single-file resolution the compiler already does itself) could not give it.

Fix direction is a decision rather than a patch: either widen the peer to `>=5.9` with a test matrix
over TypeScript majors (the build-toolchains test already runs four toolchains), or isolate what the
analysis actually needs from the checker so the compiler can be ported off the in-process API.

**Verify:** a scratch project with the newest TypeScript major installed: `npm i zibri zibri-tsx`
(expect `ERESOLVE`); then with `--legacy-peer-deps`, compile the 105 real templates through
`compile()` and run `packages/tsx`'s suite against that TypeScript.

## MINOR

### T7. `DuplicateFrameworkCopyError` fires in a consumer's test that re-requires the application after `jest.resetModules()`, and the message blames the install — MINOR
*Filed 2026-10-21.*

The copy counter increments once per evaluation of `global-registry.ts` (`:13`,
`framework-copies.ts:46-49`) and `initDiContainer` refuses a count above one (`:60-66`). A second
module registry in one realm is "precisely what a second copy of the framework is" per the comment —
and it is also what `jest.resetModules()` followed by a `require`, or `jest.isolateModules(() =>
require('./app'))`, produces; the framework's own test uses exactly that to manufacture the second
copy (`framework-copies.test.ts:23`). A consumer who tests a module with state that way gets:
"2 copies of zibri are loaded in this process... Run `npm ls zibri`" — an install diagnosis for a
test-runner setting. Nothing in `docs/testing.md` or `docs/di.md` mentions it.

Fix direction: say so in the message (a reset module registry is the second cause), and document the
constraint next to `startTestServer`.

**Verify:** a jest file with two cases that each `jest.isolateModules(() => require('zibri'))` and
boot through `startTestServer`; the second fails today with the install message.

### T8. Translation extraction re-parses, transforms and prints the whole shipped framework source on every build and discards the printed output — MINOR
*Filed 2026-10-21.* `src/localization` was never reviewed (09).

`generateSourceXlf` runs from the webpack `beforeCompile` hook (`packages/sandbox/webpack.config.js:59-79`,
same in the scaffold), so on every build and every watch rebuild. It globs the installed framework's
`src/**/*.{ts,tsx}` — the sources 05 §P4 kept in the tarball for the maps' sake — and for each file
builds a `SourceFile`, runs a full `ts.transform` and prints the result (`transform-source-translation-tokens.function.ts:116-131`,
`:144-175`). The printed `code` is then never read: `generateSourceXlf` uses only `.extracted`
(`generate-source-xlf.function.ts:16-18`). The extractor also writes to `process.cwd()`
(`:19`), the one anchor `resolve-app-root.function.ts:7-11` argues against, and carries a `// TODO: fix`
on the display path (`:123`).

For a developer this is seconds added to every watch cycle for strings that do not change between
framework releases; for the packaging story it is a build that silently depends on `src` shipping.

Fix direction: ship the framework's own extracted `source.xlf` with the package and extract only the
project's origin; drop the print.

**Verify:** time `generateSourceXlf` with the sandbox's two origins before and after; a unit test that
the framework origin is read from a shipped file rather than globbed.

### T9. The scaffold installs `ts-node` as a production dependency for TypeScript worker files, prunes `typescript` from the image, and bundles the application so no `.ts` worker path can exist — MINOR
*Filed 2026-10-21.* Touches 06 §C4's "the generator installs what its own generated configuration reaches for".

`new.command.ts:264-268` (working tree) explains: a generated app "runs its worker files as
TypeScript, which is what `multithreading.enableTsWorkerFiles` defaults to, so it has to ask for the
compiler itself", and `:295` installs `ts-node@^10.9.2` as a *dependency*. `typescript` is a
*devDependency* (`:253`). The generated Dockerfile runs `npm prune --omit=dev` (`:836`) and copies
that tree into the runtime stage (`:845-846`). `registerTsNode` guards only `require('ts-node')`
(`register-ts-node.function.ts:28-38`); `tsNode.register()` on `:39` loads `typescript` and is
unguarded. The boot check asks `isTsNodeInstalled()` only (`multithreading.service.ts:393`), which
answers yes in that image. So the first job naming a `.ts` worker fails at dispatch with
`Cannot find module 'typescript'`, after a boot check that was written to make exactly that fail at
boot (`docs/multithreading.md:101`).

And in a bundled application the case cannot arise anyway: the documented path is
`FsUtilities.getPath(__dirname, 'fibonacci.worker.ts')` (`docs/multithreading.md:46-48`), and
`__dirname` inside `dist/bundle.js` is `dist/`, where no `.ts` file is. The sandbox has no worker
file. So every generated production image carries a compiler shim that cannot work, for a case the
bundle cannot produce — alongside `systeminformation`, `re2` (native), `prom-client`, `nodemailer`
and the OpenTelemetry SDK installed "because the defaults reach for them" (`:295-298`). That list is
what a container-hardening review reads first.

Fix direction: scaffold `enableTsWorkerFiles: false`, drop `ts-node` from the install, and document
worker files as a webpack entry; separately, make the boot check resolve `typescript` too.

**Verify:** in the registry-installed scaffold, `npm prune --omit=dev && node -e "require('ts-node').register()"`
(throws); and a multithreading test that stubs `typescript` out of resolution and asserts the boot
check refuses.

### T10. A `?client` package whose browser entry is an ES module is copied and served as a classic script, failing in the browser rather than at build — MINOR
*Filed 2026-10-21.* The vendor splitting was never reviewed (09).

`generateVendorBundles` copies a package's browser distribution verbatim (`packages/tsx/src/build/vendor.ts:96-110`),
choosing `exports['.'].browser` first (`:177-181`), then any `./dist/*.js` export key, then
`browser`/`unpkg`/`cdn` (`:196-204`). The page loads the result with a classic
`<script src>` (`runtime/render-page.ts:89-91`), so the contract is "a global". Many packages'
`exports['.'].browser` is an ESM file; it is accepted here, written to `assets/public/vendor`, and
throws `Cannot use import statement outside a module` in every browser that loads the page. The two
positive tests cover `chart.js` (which resolves through `unpkg` to a UMD build) and a package with
no browser field (`vendor.test.ts:31,52`); nothing covers a browser entry that is a module.
`docs/templating.md:191-193` states the global contract, not what happens to a package that cannot
meet it.

Fix direction: sniff the chosen file for `import`/`export` statements (or `"type": "module"` plus a
`.mjs` extension) and refuse at build with the package name.

**Verify:** a `vendor.test.ts` fixture package whose `exports['.'].browser` points at an ESM file;
assert `generateVendorBundles` throws (red today: it writes the file).

### T11. Compiled templates carry no source map through the webpack loader or the jest transform — MINOR
*Filed 2026-10-21.* "Source-map fidelity" was never reviewed (09).

The loader returns `result.code` as a string and nothing else (`packages/tsx/src/webpack/index.ts:67-75`);
the jest transformer returns `{ code }` (`jest/index.ts:72-79`); `compile()` produces no map. The
scaffold's `devtool: 'source-map'` therefore maps a template's frames to the *compiled* module text,
so a throw inside a handler or a render error points at generated line numbers in a file the
developer has never seen. The server-side emission is a statement-by-statement rewrite of the
template with TypeScript's printer (06 §X1), which can emit positions; the client script is assembled
by hand and would need a generator.

**Verify:** render a template whose handler throws and read the stack; a test asserting
`compile()` returns a `map` whose mappings for the component body point into the `.tsx` source.

### T12. Supply-chain polish on the workflows: actions pinned by major tag, an unpinned `npm@latest` in the release job, CI not run on pull requests — MINOR
*Filed 2026-10-21.* Cross-checked against 06 §CI2/§CD1-4, which cover the gates, not these.

Every `uses:` is a floating major tag (`ci.yml:18-19` and throughout, `cd.yml:21-24`,
`codeql.yml`, `dependency-review.yml`); the third-party one is `codecov/codecov-action@v5`
(`ci.yml:66`). The release job, which holds `id-token: write` and `contents: write`, first runs
`npm install -g npm@latest` (`cd.yml:29`), so the client that signs the provenance attestation is
whatever npm shipped that morning. CI triggers on `push` only (`ci.yml:2-4`); the dependency-review
workflow is the only one on `pull_request`. None of this is a defect in the artifact; it is the
OpenSSF-scorecard list an enterprise security review runs first, and the `check-consumer-tree` and
provenance work in 06 shows the project cares about exactly this surface.

**Verify:** two cases in `ci-workflows.test.ts`: every `uses:` reference is a 40-character SHA with
a version comment, and no `npm install -g npm@latest` without a version.

### T13. `prom-client` is deprecated in favour of `@prometheus-io/client` — MINOR
*Filed 2026-10-21.* From the user's list (`after-all-findings-fixed.md:12`).

`zibri` peer-depends on `prom-client ^15.1.3` (`packages/zibri/package.json:83`, optional at
`:167`) and the scaffold installs it into every project (`new.command.ts:298`). The types are used
only inside `metrics.service.ts:3` (`import type`), so nothing from it sits in a public interface —
the migration is contained to that service and the registry it exposes. I could not query the
registry from here to confirm the deprecation notice; the user's list records it from an install.

**Verify:** `npm view prom-client deprecated`; then a branch swapping the import in
`metrics.service.ts` and running `metrics.service.test.ts`.

### T14. Nothing measures the size or start time of a built production application — MINOR
*Filed 2026-10-21.* From the user's list (`after-all-findings-fixed.md:20`).

No test reads an image size, a bundle size or a time-to-ready (grep over the cli heavy tests finds
none). The docker heavy test already builds the generated image and polls `/health/ready`
(`new.command.docker.heavy.test.ts`), so both numbers are one `docker image inspect` and one
timestamp away. What this checkout offers as a baseline: the sandbox bundle is 7.7 MB and its
`dist` 28 MB with maps and assets; the registry-installed scaffold's `node_modules` is 290 MB with
dev dependencies (the pruned tree is what matters and is not recorded).

**Verify:** extend the docker heavy test to record image size and the delay from container start to
the first `200` from `/health/ready` into a baseline file beside `src/__testing__/benchmark/baseline.json`,
reported like the benchmark job rather than gated.

### T15. A PDF attachment's `src: string` is a file path read by pdfkit, and the framework's own `FsPath` brand is not used — MINOR
*Filed 2026-10-21.* `src/document` was never reviewed (09).

`PdfAttachmentDefinition.src` is `string | ArrayBuffer | Buffer`, and "A string value is interpreted
as a file path" (`packages/zibri/src/document/pdf.utilities.ts:19-29`); `create` hands it straight to
`doc.file(...)` (`:108-110`), where pdfkit reads the path. The framework has a branded `FsPath` for
exactly the distinction between "some string" and "a path we resolved" (`utilities/fs.utilities.ts`),
used across the data source and asset code; here a request-supplied string type-checks as a path. The
documentation shows the string form (`docs/document.md:75`). Not a vulnerability in the framework —
the caller chooses what to pass — but the type says nothing where the rest of the codebase has it say
something.

**Verify:** a type test in `pdf.utilities.test.ts` with `@ts-expect-error` on a plain string once
the type is `FsPath | Buffer | ArrayBuffer`.

### T21. The metrics explorer is framework UI copied into the project — MINOR
*Filed 2026-10-23,* from §T5, whose closure left it here on purpose.

`zi new` copies the metrics explorer into `src/templates/pages/metrics/`: 20 pages and components
rendering `MetricsSnapshot` and the cache and rate-limiter names. They are framework UI, written
against framework data shapes, and they reach a project as its own source. `zi upgrade` (§T5) now
carries a change to them into a project by merge, so an upgrade no longer costs a hand diff. What is
left is that a project holds, reviews and merges twenty files it never meant to own. The alternative
is that the framework serves the explorer itself, as it serves its docs surface (02 §M13). That needs
pages compiled by the framework's own build and styles that do not depend on the project's tailwind
config.

**Verify:** none until the direction is decided; a heavy test generating a project and requesting
`/metrics/dashboard` from the framework would hold it.

## Code quality and architecture

Moved to [code-review/07-di-packaging-tooling.md](./code-review/07-di-packaging-tooling.md) (T16–T20).

## Already filed

- `exactOptionalPropertyTypes` off → 05 §M6, open (deferred on purpose).
- An application that is itself an ES module is untested → 06 §X7, open; T2's `-r ts-node/register`
  fork and T6's peer both land on it (`-r` hooks CommonJS only, `cluster-module-paths.ts:38-41` says so).
- One copy of the framework per process, refused at boot → 05 §D7, closed; T7 is the test-runner edge
  of it, not a regression.
- The harness's `readonly` port write and the asset path token → 06 §T1, closed; still as described.
- Optional peers reached at load time by the framework → 05 §P3 / 04 §5.1b, closed for `zibri`; T2 is
  the same defect in `zibri-testing`, which that round's check never covered.
- The scaffold's production shape (Dockerfile, health, env, secrets, CI) → 06 §C4, closed; T9 is
  one of its installs contradicted by its own Dockerfile, not the finding reopening.
- `defaultAuth` answered by the scaffold → 06 §C8, closed.
- Decorators under esbuild/SWC/Vite → 05 §M1, closed and held by `build-toolchains.test.ts`; nothing
  new found.
- Circular dependencies, duplicate tokens, the `Object` parameter message, async providers, lazy
  registration → 05 §D1, D3, D5, D6, D9, closed; T4 is a residue of D6's design, filed as its own
  finding because the documented form hits it.
- The handlebars type walk → 06 §X3, closed; not re-read beyond the walk's entry points.
- Release process, provenance, lockfile install, version bump → 06 §CD1-5, closed; T12 is beside them.
- Node version policy, OS matrix, license and advisory gates → 06 §CI1/§CI2, closed; the derived
  matrix and the consumer-tree walk are as described.
- The evaluation tests' integration into the normal suite → user's list item 8; T1 carries it.

## Not reviewed

- `src/document/xml-reader.utilities.ts`, `xml-writer.utilities.ts` and `xml.utilities.ts`.
- `src/localization/localize.service.ts`, `format*.function.ts`, `translate.function.ts`, the
  collation check and the XLIFF *parsers* (only the extractor was read).
- `src/handlebars/**` beyond confirming 06 §X3's shape; `src/types/**`; most of `src/utilities/**`
  (`fs`, `json`, `promise`, `typeorm`, `trigram`, `url`, `metadata` not read this round); the class
  helpers (`OmitClass` and friends) remain unreviewed, as 09 says.
- `packages/tsx`: `codegen/client/client-codegen.ts` (830 lines), `runtime/server-runtime.ts` (947),
  `semantics/walk.ts`, `validate*.ts`, the access-shape projection and the whole MJML parity layer
  (`src/email/**`). The isolation guarantee was taken from 06 §X1's record, not re-derived.
- `packages/testing`: the in-memory repository driver's internals (1,230 lines) and store, the
  transaction model, the fake OAuth/SAML/LDAP/passkey/FIDO providers, `test-providers.ts`,
  `resolve-application-options.function.ts`. Whether the in-memory evaluator accepts filters the real
  stores refuse — the question that decides whether a green in-memory test means anything — was not
  checked; the two shared `.cases.ts` files that skip it (`large-batches.cases.ts:14`,
  `released-unique.cases.ts:18`) say the stores already differ in at least two behaviours.
- `.github/scripts/*.mjs` (the consumer-tree walk, the node-majors resolver, the release scripts) —
  trusted from 06's record and `ci-workflows.test.ts`.
- `packages/cli`: the `encapsulation/` wrappers, `exit-*` utilities, `normalize-package-json`, the
  bulk of `new.command.ts` outside the install, Dockerfile, workflow and test-file sections, and the
  templates' contents beyond their imports.
- `packages/sandbox/src/**` beyond the data source, options and webpack config.
- `docs/provider-tokens.md`, `plugin.md`, `localization.md`, `templating.md` in full.
