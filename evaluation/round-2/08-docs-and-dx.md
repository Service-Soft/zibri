# Documentation and developer experience — round 2

*Reviewed 2026-10-21 against the working tree on `v3`. Read-only.*

What was read: every page under `packages/zibri/docs/` (54 pages, 15,377 lines — the core pages
`getting-started`, `architecture`, `creating-endpoints`, `models`, `data-source`, `di`, `auth`,
`roles-and-permissions`, `tenancy`, `testing`, `deployment`, `app-settings`, `error-handling`,
`application-lifecycle`, `request-context`, `plugin`, `cron`, `email`, `costs`, `releases`,
`versioning`, `assets`, `excluding-properties`, `auth-routes` in full by me; the 32 subsystem pages
in full by three delegated articulation passes whose quotes I spot-checked against the files), the
root `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `CODE_STYLE.md`, the three package READMEs,
`packages/zibri/README.md`, the whole barrel `packages/zibri/src/index.ts` (968 `export *` lines),
`packages/zibri/src/application/docs-examples.test.ts`, the complete `zi new` generator
(`packages/cli/src/commands/new/new.command.ts`, 1643 lines), and the source behind every claim
cited below. Pages modified in the working tree (`git status --short`): `api-keys`, `auth`,
`authorization-server`, `caching`, `client-certificates`, `creating-endpoints`, `data-source`,
`scim`, `sign-in-through-a-directory`, `tenancy`, `testing`, `two-factor`, `upgrading-to-3`,
`websocket`; `roles-and-permissions.md` is untracked (new); `src/index.ts` is modified. Line
numbers are against that working tree. Not reached: `upgrading-to-3.md` beyond its heading
structure, the generated typedoc under `docs/generated/` (git-ignored), and the `packages/tsx`
README.

The short version: the documentation set is broad and the hand-written pages are good; the problem
the maintainers named in `after-all-findings-fixed.md` (bullet 3) is real and measurable — about a
third of the pages, and most of the long ones, explain reasoning, history and store internals in a
voice that is not the hand-written one. On developer experience the framework is generous once a
project exists and expensive to set up: the scaffold is a web application, every entity carries a
tenant, every custom repository copies six constructor arguments, and the list of providers an
application must register before it boots is nowhere written down as a list.

---

## Part 1: claims the code does not support

| Page and line | Claim | What the code does | Severity |
|---|---|---|---|
| `getting-started.md:113` | `zi new` asks for "a name for your new project, and whether it gets a continuous integration workflow. Both can be given on the command line instead, as `zi new <name> <github\|none>`" | It asks three questions; the third is `defaultAuth`, and the command line is `zi new [name] [ci] [defaultAuth]` (`packages/cli/src/commands/new/new.command.ts:100-108`, `:1627-1641`). The page never mentions the question that decides whether a forgotten decorator serves anyone | MINOR, closed 2026-10-23 with the structure pass: a table of the three questions and `zi new <name> <github\|none> <requireLogin\|public>` |
| `getting-started.md:97` | `zibri-cli` is at `https://github.com/service-soft/zibri-cli` | The cli lives in this repository (`packages/cli/package.json:6-9` names `Service-Soft/zibri`, directory `packages/cli`) | MINOR, closed 2026-10-23 with the structure pass: links the npm package |
| `creating-endpoints.md:129-134` | `TestCrudController` (base route `/tests-crud`) picking `dashboard` off `MetricsController` exposes "`GET /metrics` (…which in this example returns a html dashboard)" | A route's final path is the *registering* controller's base route plus the method's route (`src/routing/router.ts:739`), so whatever `PickClass` carries over is served at `/tests-crud/dashboard`, never at `/metrics`. The example method also returns `{}` typed `Promise<unknown>`, not html | MINOR, closed 2026-10-23 with X8: the page lists `GET /tests-crud/dashboard` "under the base route of the class that picked it" |
| `creating-endpoints.md:131` | "returns a PaginatedResponse of Test" | No such export; the type is `PaginationResult` (`src/index.ts:525`, and the page's own key-exports row at `:32`) | MINOR, closed 2026-10-23 with X8 |
| `creating-endpoints.md:280` | `@Param.header('User-Agent') userAgent: string` | The router reads the header under the declared key as written (`src/routing/router.ts:632-633`, `context.request.headers[key]`); node stores incoming headers lower-cased, so `User-Agent` reads nothing. Filed by the HTTP reviewer as 03 §H19; the example on the page is the one that cannot work | MINOR, closed 2026-10-27 with 03 §H19: every header lookup lowercases the name, so the example reads the header as written |
| `creating-endpoints.md:786`, `:826` | A "page of server-sent events" and `text/event-stream` are mentioned as things an endpoint produces | No page says how to return one; `MimeType.EVENT_STREAM` exists (`src/http/mime-type.enum.ts:34`) and is documented nowhere. See 03 §H12 | MINOR, closed 2026-10-27 with 03 §H12: "Streaming a response" shows server-sent events written to the response |
| `testing.md:65-86` | The block titled "`src/application-options.base.ts` — everything the application is" imports `DbDataSource` and `entities` (`:70-71`) | The section's own point (`:135-138`) is that the base module must *not* reach the production data source, and the scaffold's base file does not (`new.command.ts:668-711`). The imports are there because the test harness merges a page's imports into its first block, see X13 | MINOR, closed 2026-10-23 with X13 |
| `di.md:27-29`, `creating-endpoints.md:40-43`, `auth.md:139-143`, 15 more pages | The first example of the page imports 10-20 names and one or two of the reader's own files | The example uses two or three of them. 18 pages carry an import line with ten or more names (`grep -E "^import \{ ([^}]*,){9,}" docs/*.md`), all produced by `docs-examples.test.ts:98-133` merging imports per page. A reader copying the first example of `di.md` gets `import { … } from './example-setup'` for a file that does not exist | MAJOR (as DX, see X13), closed 2026-10-23 with X13 |
| `auth.md:369-371` | The csrf token "is also reissued whenever the session rotates, which includes the rotation that happens inside an ordinary request once the session cookie expires" | The cookie's `maxAge` is `sessionExpiresInMs` (`src/auth/strategies/cookie/cookie-auth.auth-strategy.ts:165`) and the row lives five minutes longer (`:658`), so a browser stops sending the cookie before the row expires and never presents the expired session this sentence describes. Pointed out by the auth reviewer; verified at those two lines | MINOR, closed 2026-10-23 with the structure pass, in the code: the renewal the sentence describes was the intent (`hasCredential`'s comment, `setCsrfTokenHeader`'s JSDoc) and unreachable from a browser, which answered `401` instead. `resolveAndValidateSessions` now renews when the refresh cookie arrives alone, and still refuses a session cookie naming no row. Tests in `cookie-auth.auth-strategy.reuse-grace.test.ts` (in memory), "a lapsed session cookie": *renews the session inside a request that carries the refresh cookie alone* (red before: 401) and *refuses a session cookie that names no session* (green before and after). The page says what happens |
| `auth.md:722-734`, `tenancy.md:205-214`, `roles-and-permissions.md:74-84`, scaffold `new.command.ts:1133-1143` | The documented way to write a repository of your own: `class UserRepository extends Repository<User>` wrapping the injected `Repository<User>` through the six-argument `super(...)` | A `Repository` built on another repository keeps only `repo.driver` (`src/data-source/repository/repository.ts:248-249`). The injected repository is a `ChangeSetRepository` or `SoftDeleteRepository` whenever the entity declares `changeSets` or `deleted` (`data-source.md:1680`), and the documented subclass is a plain `Repository`, so soft deletes and change sets are silently gone for that entity. No page says so. Round-2 01 §D6 has the mechanism; the documentation half is this row | MAJOR, closed with 01 §D6 (2026-10-21: a repository built on one it does not extend is refused as it is built, and the pages use `super(User, repo)`) and X16 (2026-10-25: `@RepositoryFor` replaces the pattern; the framework builds the class over the data source's repository, and its type rejects a plain `Repository` for a soft-delete entity). No page, scaffold file or sandbox file shows the wrapping subclass any more |
| `src/tenancy/membership/membership-repo.decorator.ts:20` (published JSDoc) | `super(Membership, repo);` | The constructor takes six arguments (`repository.ts:233-243`); the two-argument call does not compile. Every docs page shows six. Typedoc publishes this JSDoc | MINOR, closed with X16's two-argument constructor (`repository.ts:299`), which this example now matches |
| `di.md:160-163` and `:240-243` | `CurrentTenantService` (request scoped, field initializer calling `inject`) and `SecretReadingReportService` (field initializer `inject(vaultSecret)` of an awaited provider) as the patterns to copy | The capture check reads only the top construction frame (`src/di/di-container.ts:480`, `this.constructing.at(0)`), and a field-initializer `inject()` of an async provider in a hooked class fails at boot — round-2 07 §T3 and §T4 show both examples failing. Not re-run here; cited on the DI reviewer's finding | MAJOR, closed 2026-10-23 with 07 §T3 and §T4: both shapes work or are refused as the page says |
| `deployment.md:115-120` | "Two paths are written while the application runs" — `versions` and `.zibri/uploads` | A third, `.zibri/backups`, is the default `BACKUP_TEMP_FOLDER` (`src/di/default/zibri-di-providers.default.ts:234`). See 02 §S18 | MINOR, closed 2026-10-23 with the structure pass: three paths. Found on the way: the generated Dockerfile gave the run user `package.json`, `node_modules` and `dist` too, against its own comment. Only `versions` and `.zibri` are its now (`new.command.test.ts`, *gives the user running the image only the paths the application writes*, red before), and the sandbox Dockerfile follows |
| `data-source.md:132-203` | `ValKeyDataSource` "is configured the same way and exposes the exact same repositories" | It connects with `GlideClient` only (`src/data-source/data-sources/val-key/val-key-data-source.model.ts:300`), i.e. a standalone server; a cluster is not supported and the page does not say so (02 §S9). `:173` says `createBackupData` "dumps exactly the keys below that prefix" without saying it is a key walk (`:856`, `scanValKeyKeys`) and not a point-in-time snapshot (02 §S6) | MINOR, closed with 02 §S6 (2026-10-22: `backupMode` `'snapshot'` or `'walk'`, described in backup.md) and §S9 (2026-10-23: data-source.md says it connects to a single server and refuses a cluster at start) |
| `releases.md:5-14` | "The public API is what you can import from a package's entry points … follow semantic versioning" | The entry point exports `DiContainer` (`index.ts:380`), `GlobalRegistry` (`:502`), `AlsUtilities` (`:440`), `MetadataUtilities` (`:1134`), `InternalError` (`:456`), `WriteDataUtilities` ("needed by a driver", `:668`), `ValueConversionUtilities` ("for the in memory data source", `:722`), `DoublyLinkedList` (`:1121`), every cleanup cron job and both where-filter converters. Under the stated rule each of them is a semver promise. 07 §T16 has the mutable-state half; X20 below has the surface | MAJOR, closed 2026-10-25 with X20: `zibri` is the documented surface and the rest is on `zibri/internal`, which `releases.md` says any release can change |
| `cron.md:39` | `await inject(ZIBRI_DI_TOKENS.LOGGER).info(...)` | `info` returns `void` (`src/logging/logger.interface.ts:21`); the `await` compiles and misleads about the logger being asynchronous | MINOR, closed 2026-10-23 with X8 |
| `backup.md:81` | "The `FsBackupTransport` simply writes…" | The export is `BaseFsBackupTransport` (`src/backup/transports/fs.backup-transport.ts:18`), as the page's own table at `:9` says | MINOR, closed 2026-10-23 with X8 |
| `packages/zibri/README.md:47` | "body parsers for json and form-data" | Four ship: json, xml, form-data and form-url-encoded (`index.ts:583-597`) | MINOR, closed 2026-10-23 with X12 |
| `packages/zibri/README.md:85` | "busboy for file uploads (the foundation of multer)" | The dependency is `@fastify/busboy` (`packages/zibri/package.json:63`); multer is not involved | MINOR, closed 2026-10-23 with X12 |
| `README.md:9` (repo root) | "See its [README](packages/cli/README.md)" for the cli | `packages/cli/README.md` is tracked and empty (0 lines) | MINOR, closed 2026-10-25 with X6 |
| `email.md:96-119` | The one "Queueing an email" example renders `.hbs` templates | The scaffold ships tsx emails only (`packages/cli/templates/emails/*.tsx.tpl`, `password-reset.tsx`) and `TsxUtilities.renderEmail` (`src/tsx/tsx.utilities.ts:33`) appears nowhere on the page; `:171` sends the reader to templating for "the `.hbs` email templates" | MINOR, closed 2026-10-23 with X24 |
| `metrics.md:31-39` | The table of "what the framework collects on its own" | Omits the cache metrics `caching.md` names (`cache_size`, `cache_expired_evictions_total`, hit/miss durations) and the rate limiter metrics `rate-limiting.md:223` names. CODE_STYLE: "A table listing an API is complete or it is wrong" | MINOR, closed 2026-10-23 with the structure pass: every cache and rate limiter metric, from `base-cache.model.ts:121-135`, `cache.service.ts:204` and `base-rate-limiter.model.ts:284-308`. The "hit/miss durations" do not exist; the durations are `cache_store_duration_ms` and `cache_source_duration_ms` |
| Key-exports tables | Each page's table lists the page's API | Incomplete on: `tenancy.md:17` (omits `updateRoles`, which the example at `:237` implements); `localization.md:22` (`compareText` at `:253`, `TRANSLATIONS_PATH` at `:139`); `logging.md` (`LOGGER_FLUSH_INTERVAL_MS`, `LOGGER_CLEANUP_AFTER_MS`, `Log`); `events.md` (`EventStatus`, `EventDispatchCronJob`, `EVENT_EXECUTION_LEASE_IN_MS`); `cron.md` (`CRON_SERVICE`); `email.md` (`EmailSendResult`, `EmailStatus`); `backup.md:5-22` (`BackupTransport` decorator used at `:46`); `multithreading.md` (`PersistedFunctionJobError`); `websocket.md` (`PubSubDataSourceInterface`); `templating.md:17` (`useContext`, `provideContext`, `$raw`) | MINOR, closed 2026-10-23 with the structure pass: the style test requires every name an example imports to be in the Key exports of some page |
| `docs-examples.test.ts:139-141` (the safety net's own claim) | An unresolved `../models` import is "context rather than a finding — the names it brings in stay usable and everything done with them is still checked" | A TS2307 import gives every name it brings in the type `any`, so `CrudController(Test, TestCreateDTO, TestUpdateDTO)` (`creating-endpoints.md:124`), `Repository<Test, TestCreateData, TestUpdateData>` (`data-source.md:431`) and every example built on a reader-file class is unchecked for those types. (The second half of this row, the page-level import merge letting a block that forgot an import pass, closed 2026-10-23 with X13; testing.md importing the real `ClusterMarkRow` from a made-up module was this half at work) | MINOR, closed 2026-10-29 (user: a typed reader project). `src/application/__testing__/docs-reader-project.ts` declares the reader's files the pages import from without showing them: the running example's entities, roles and permissions, data sources, options, the components `zi new` generates, and the clients of outside services. The assembly turns every named import from a relative path the page does not declare into an import from it, so a name it lacks fails as TS2305. First run: 88 names on 40 pages had been `any`. Typed, they showed 24 errors: `<Roles, User>` on 14 authenticators whose `User` holds role names (now `<string, User>`), client-certificates.md passing the `Role` entity as the role type, `version` from `package.json` used without the scaffold's `SemVerUtilities.isSemVerVersion` guard (cron.md, testing.md), `Order` without `open` or `paidAt` (metrics.md, localization.md), templating.md's `MetricsStatus` taking props the scaffold's does not (now the scaffold's `Checkbox`), two-factor.md's `read()` returning nothing, and `REPORT_STORAGE`, imported by di.md from a file nobody declared. And one in the framework: auth.md's `BaseUserRepository<User, UserCreateData>()`, the sandbox's pattern, was not a `RepositoryClassFor<User>` against the sources, because `UpsertWriterContext.beforeSave` took `CreateData` as a function-property parameter. The built declarations drop the private field's type, so readers never saw it. `Repository.beforeSave` and the context take `T \| DeepPartial<T>`, what `RepositoryHookUtilities.beforeSave` takes. DOCS_STYLE.md says where the names come from |

Pointer not independently confirmed: 01 §D3 says `data-source.md:745` ("With `allowId`, a row with an `id` that no row has yet is created with it") disagrees with `writeNewRows`' comment about an existing id being saved over. `repository.ts:831-838` creates the rows whose ids are missing and links the rest; whether linking "saves over" is the data reviewer's finding.

---

## Part 2: what is missing

### X1. No tour of the generated project — MAJOR
*Filed 2026-10-21.*

`getting-started.md` ends at "run `npm start` and enjoy your new api!" (`:142-143`). What `zi new`
wrote is 35 files across `src/controllers`, `src/models`, `src/repositories`, `src/data-sources`,
`src/templates`, `src/__testing__`, `versions`, `translations`, a webpack config with five custom
plugins, a tailwind config, a jest config with a transform for `jose`, two dotenv files and a
Dockerfile (`new.command.ts:316-355`). No page says what each of them is for, which ones a team
edits first, or which ones it can delete (the mailing list plugin, the page controller, the
Tailwind pipeline).

A developer from NestJS expects the `nest new` tour (`main.ts`, one module, one controller, one
service, one spec); from Spring Boot the Initializr's two files. Here the first thing they meet is
`page.controller.ts` with a `WriteThroughReadThroughCache` subclass injecting three framework
services (`new.command.ts:384-405`) — the most advanced construct in the project, before they
have written a route.

Fix direction: one page, "What `zi new` wrote", one line per file, linking to the page that owns it.

**Verify:** read `getting-started.md`; run `zi new` and list the files it writes.

> **Completed 2026-10-23.** `docs/project-layout.md`, "The generated project", lists every file
> `zi new` writes in tables by task (starting, building, storing data, users, requests, pages and
> emails, testing, deploying), each with the page that owns it, and starts with the four places most
> changes start. Getting started links it. Four "Removing …" sections name what an application that
> does not use them deletes, and what it edits: the mailing list, the pages, the metrics dashboard
> and the log email. Test: `packages/cli/src/commands/new/new.command.project-layout.test.ts`
> generates a project and holds the page to it both ways (every written file named, every named
> path written), and for each removal section checks that no file left behind, apart from the
> ones the section says to edit, imports what it deletes. That check is what the first draft of the
> page failed: it listed `base-mailing-list-footer.tsx` for the mailing list, which the footer of
> every email imports (red on that line, verified), and the metrics folder without `chart.tsx`,
> which imports the metrics page. Found on the way, filed under X14: the metrics dashboard, its two
> components, `assets/public/lib/`, `src/tsx.d.ts`, the `chart.js` dependency and the log email are
> written into every project and used by nothing in it.

### X2. No single reference for `ZIBRI_DI_TOKENS` — MAJOR
*Filed 2026-10-21.*

`src/di/default/zibri-di-tokens.default.ts` declares 124 tokens. They are the configuration
surface of the framework: every lifetime, limit, template, secret and replaceable service is one.
They are documented one at a time, in the page that happens to own each, in prose
("`ZIBRI_DI_TOKENS.HTTP_DRAIN_TIMEOUT_IN_MS` (ten seconds by default)",
`application-lifecycle.md:152`), and the scaffold's `providers.ts` registers 13 of them before an
application boots (`new.command.ts:460-560`).

Nowhere is there a table: token, type, default, required or optional, which page. An enterprise
reviewer asking "what does this application need configured to start?" has to read 54 pages or the
scaffold. The same question for an existing deployment ("what can I tune?") has the same answer.

**Verify:** `grep -c "^    [A-Z_]*:" packages/zibri/src/di/default/zibri-di-tokens.default.ts`
against any one page; no page lists more than a dozen.

> **Completed 2026-10-23.** `docs/configuration.md`, "Configuring the framework", lists all 134
> tokens of `ZIBRI_DI_TOKENS`, with type, what each is and its default or "Required", each linked
> to the page that explains it. The 17 plugin tokens are in the same table form on a page per
> plugin (`invoicing-plugin.md`, `mailing-list-plugin.md`, `payment-plugin.md`), which the user
> asked for so that each holds everything about its plugin; `plugin.md` keeps registering a plugin
> and writing your own. It opens with the six every
> application provides (master key, email config and transport, the three retentions) and the nine
> a feature requires (jwt keys, cookie secret, password reset url and template, passkey and
> federation options, the two SMS tokens, websocket options), then groups the rest by task, the
> replaceable services and the read-only resolved options last. 21 tokens were on no page before;
> the reference documents them. DI and the generated project link it. Test:
> `packages/zibri/src/di/default/zibri-di-tokens.default.test.ts` holds each of the four pages to
> its token object both ways (every token once, nothing else) and checks that a token links only to
> a page naming it. Found on the way, both red first: `auth.md` named neither `COOKIE_SIGN_SECRET`, which
> `CookieAuthStrategy` requires, nor `CSRF_TOKEN_HEADER`; and the table of what a test server
> provides in `testing.md` listed `DPOP_NONCES`, which `defaultTestProviders` does not set, and
> missed `THREAD_JOB_RETENTION_IN_MS` and `AUDIT_RETENTION_IN_MS`, which it does. The same test file
> now compares that table with `defaultTestProviders`.

### X3. No page says which framework entities a data source needs — MAJOR
*Filed 2026-10-21.*

The scaffold's `entities.ts` lists 33 framework entities by hand, from `MigrationEntity` to
`CacheInvalidation` (`new.command.ts:1268-1302`). `testing.md:24` names a
`zibriFrameworkEntities` value for the harness. No page says which entity belongs to which feature:
a team that does not use mailing lists, websockets, backups or two-factor cannot tell which of the
33 tables it may leave out, and the only signal is the boot error naming what is missing
(`src/error-handling/errors/missing-entities.error.ts:12-20`, which is a good error).

A framework that creates 33 tables for a fresh project needs a page that says what each is, how
large it gets, and what cleans it up — a DBA will ask exactly that before approving the schema.

**Verify:** grep `docs/` for `WebsocketMessageSequence` or `EncryptionRotationFailure`: not on any
page.

> **Completed 2026-10-23**, the part saying which entity belongs to which feature; how large each
> table gets and what cleans it up is split out as X27. On the user's suggestion, `## Built on`
> became `## Requirements` on every page: the package table as before, and a second table,
> `| Entity | Needed when |`, naming the entities the feature's default implementation stores rows
> in and what makes it need them ("Every application", "`CookieAuthStrategy` is registered",
> "`twoFactorAtLogin` is not `'never'`"), taken from the conditions around each
> `validateEntitiesRegistered` call. 25 pages carry one, the three plugin pages included.
> `data-source.md` names the seven features whose entities every application declares, and
> DOCS_STYLE describes the section. Test: `docs-style.test.ts`, "lists every entity the framework
> stores rows in under Requirements, and only those", compares the tables with
> `GlobalRegistry.entityClasses` after loading the barrel (`BaseRoleEntity`, which the reader
> extends, excepted); red with all 54 entities before the tables were written. Every framework
> entity is `allowOrphan`, so the per-feature checks are what require them, and four entities have
> no check of their own: `MigrationEntity` (fails at startup through the migration repository),
> `ChangeSet`/`Change` (follow the change-set repositories) and `RateLimitStateEntity` (follows
> `RepositoryRateLimiterStore`, checked by the code two-factor methods).

### X27. No page says how large a framework table gets and what cleans it up — MINOR
*Filed 2026-10-23, split out of X3.*

The Requirements tables say which framework entities a feature needs and when. A DBA approving the
schema also asks how many rows each table holds over time and what deletes them: some have a cleanup
cron job and a retention token (`AuditEntry`, `Event`, `ThreadJobEntity`, `Log`), some expire
(`PasskeyChallenge`, `LoginTicket`, `CacheInvalidation`), and some grow with the users
(`PasswordCredentials`, `ApiKey`). The pages say it for some tables in their own words, and not for
others.

**Verify:** pick `WebsocketMessage`, `FederatedLoginAttempt` and `EncryptionRotationFailure`, and
find on their pages what deletes their rows.

> **Closed 2026-10-26 (user: one page).** `docs/framework-tables.md` says of every entity the framework
> stores rows in what its table grows with and what ends its rows (a cleanup job with its retention,
> an expiry, deletion with what owns it, or nothing); every Requirements section links it. Test:
> `docs-style.test.ts` "says of every entity the framework stores rows in how its table grows and what
> ends its rows", red without the page. The research found three tables that grow without anything
> deleting them, filed for the user: a deleted user's credentials, second factors, passkeys, API keys,
> federated and LDAP identities, provider tokens, reset token and failure streaks stay behind;
> `MailingListSubscriber` rows outlive every list; an expired, unused `PasswordResetToken` is never
> deleted.

### X28. `BaseTenantEntity` does not combine with `SoftDeleteEntity` or `ChangeSetEntity` — MINOR
*Filed 2026-10-24, split out of X15.*

`BaseTenantEntity` (X15) declares the tenant property for an entity extending `BaseEntity`. An entity
that soft deletes or records change sets extends `SoftDeleteEntity` or `ChangeSetEntity` instead, and
a class has one base, so it still declares `@Property.string({ format: 'uuid' }) tenantId!: string`
itself, as `data-source.md`'s `Account` and `Note` do. The three bases are classes, not composable
parts.

**Verify:** declare an entity that is per tenant and soft deletes with neither of the two lines.

> **Widened 2026-10-25 by X16:** the same holds for `BaseUserEntity()` and `BaseMembershipEntity()`.
> `IntersectionClass(BaseUserEntity(), SoftDeleteEntity)` carries the user mark and soft deletes,
> but `BaseUserEntity`'s `unique` email cannot say whether a soft deleted user keeps the address,
> which a soft delete entity has to (`validateSoftDeleteKeysSayWhichRows`), and nothing outside the
> base can add it. A soft deleting user entity declares its columns and `[USER_ENTITY]` by hand, as
> `repository-for.decorator.test.ts`'s `ArchivedUser` does. `BaseUserRepository<T>(SoftDeleteRepository)`
> works over it.

> **Closed 2026-10-26 (user: bases take a base).** `BaseTenantEntity(base?)` is a function like the
> other two, and all three take `SoftDeleteEntity` or `ChangeSetEntity`. On a soft-deleting base,
> `BaseUserEntity` requires `{ deletedUserKeepsEmail }`, which decides its email's unique filter
> (`ChangeSetOnlyEntityClass` keeps a bare `SoftDeleteEntity` from matching the change set overload);
> the membership base declares no unique and takes none. Tests: `base-tenant-entity.model.test.ts`,
> `base-user.model.test.ts`, `base-membership.model.test.ts` (type tests with `@ts-expect-error`, and
> a soft-deleted tenant row end to end on the in-memory source), `repository-for.decorator.test.ts`'s
> `ArchivedUser` built from the base, registering again with a soft-deleted user's address. The docs'
> `Account` and `Note` use the composed bases.

### X4. No OpenAPI page — MAJOR
*Filed 2026-10-21.*

The explorer at `/explorer` is mentioned on `creating-endpoints.md:101` and the OpenAPI document is
named on `architecture.md:91` and `roles-and-permissions.md:170`, but there is no page: where the
json document is served, how to export it for an API gateway or a client generator, how auth is
represented in it, what `OpenApiServiceInterface` (`index.ts:522-523`) answers, how the explorer
is protected (the rework gave it an option of its own — README's rework notes mention it, the docs
do not). For a large organisation the OpenAPI document is the contract its gateway, its client
teams and its security scanner read; it needs an owner page.

**Verify:** `ls docs/ | grep -i open` — nothing.

> **Completed 2026-10-23.** `docs/open-api.md`, "The OpenAPI document": where the explorer and the
> document of each version are served (`/explorer`, `/explorer/spec/<version>`, 404 for an unknown
> version), downloading it for a gateway or a client generator, what each part of the document holds,
> how sign-in appears (a security scheme per registered strategy under its name, `security` on an
> operation that requires a login, following `defaultAuth`; `x-permission` and
> `x-platform-permission`), restricting the explorer through `OPEN_API_AUTH` (moved here from
> `auth.md`, which links it), and moving the explorer or changing the document by extending
> `OpenApiService` under `OPEN_API_SERVICE`, with an example adding `servers`. Test: the page's
> claims about the document were covered by `open-api.service.test.ts`; the one that was not, that a
> subclass under `OPEN_API_SERVICE` serves the explorer and the documents under its own
> `openApiRoute` and nothing under `/explorer`, is a new case there (green: a subclass keeps the
> injections of `OpenApiService`). Found on the way, red first: `info.title` was
> `"<name> | Explorer"`, the browser tab's title, which a gateway lists the API under and a client
> generator names the client after; it is the application's name now, read from `app.options`. Left
> to the user: the document names no `servers`, so a generator falls back to a relative URL; the
> page shows how an application adds one.

### X5. Validation is not a topic — MAJOR
*Filed 2026-10-21.*

`packages/zibri/README.md:48` lists "automatic model based validation" and links it to
`data-source.html`. `models.md` describes the per-property options; `error-handling.md:126`
describes `ValidationError` in one paragraph. What a developer coming from class-validator, Zod or
Bean Validation looks for and does not find: what the 400 body looks like (field paths, codes),
whether a rule can depend on two fields, how to write a rule of their own, what
`ValidationProblem` (`index.ts:654`) carries, and how a validation message is localised.

Checked in the code: there is no custom-validator option on `BasePropertyMetadata`
(`src/entity/models/base-property-metadata.model.ts`), so a cross-field rule on a request body
cannot be expressed at all — the only cross-field rule in the framework is `checks` on an entity
(`data-source.md:342-379`), which is a schema constraint, answers 400 only after the write reaches
the store, and does not apply to a DTO. That is a real gap next to every framework in the
comparison set, and a page would make it visible instead of discovered.

**Verify:** grep `src/entity/models/*.model.ts` for a validator callback option; read
`models.md`.

> **Completed 2026-10-24.** `docs/validation.md`, "Validating requests", with the user's design decisions:
> - **The 400 body.** `ErrorResponseBody` has `problems: [{ key, code, message }]` for a `ValidationError`, an XML `problem` element each, and the same on a websocket error.
>   - `ValidationProblem` is a class with `@Property` fields and a `code`.
>   - The built-in codes are `ValidationProblemCode`, named after the option broken: `required`, `type`, `format`, `regex`, `enum`, `minLength`/`maxLength`, `min`/`max`, `before`/`after`, `maxSize`, `allowedMimeTypes`, `unknownKey`, `relation`, `noShapeFits`/`unknownShape` and `check`.
>   - The four copies of the unknown-key problem became `UnknownKeyValidationProblem`.
> - **Bug found on the way, red first:** a `required` function was given the whole body, not the object the property is on. `validateObjectProperty` passed the root down, so `required: (booking: Booking) => …` on a nested `Booking` read the body. `WebsocketMessage` only worked because it is validated at the top level. Upgrade guide entry under Behavior.
> - **`before`/`after`** take a `DateBound`, `(data, ctx) => Date | undefined`, replacing the static date (the user's call). The static form was evaluated once when the class loaded, so `after: new Date()` meant "after the app started". Bounds are asked on each validation, never while choosing a shape. Upgrade guide entry under Models.
> - **Checks judged by validation**, for a body of the entity or of a model derived from it, with the evaluator the data sources use.
>   - A check is written out as `EntityCheck` `{ where, code, message: $t… }`. The bare filter is a shortcut, answered with `check` and a message naming its properties (the user's request).
>   - `copyClassProperties` carries a check over when every property it compares is kept; `PartialClass` and real subclasses inherit them.
>   - A check is judged only when the object holds every property it compares, `null` included. An update leaving one out is left to the store, because validation cannot tell a create from an update, and judging absent as `null` would refuse valid partial updates.
>   - Stores read `EntityMetadata.checks[].where`, so the shape Valkey persists is unchanged.
> - **`@ValidateCustom(rule)`**, synchronous (the user's call, and the user's name).
>   - The rule gets the object once its properties are valid, and the request, and returns `CustomValidationProblem<T>[]` with `property?: keyof T`.
>   - It applies to the class and classes extending it, and not to `PartialClass` (`stopInheritingCustomValidations`) or the copying derivations.
>   - Typed with a `keyof`-based constraint, so decorating a class that is not exactly the rule's model does not compile.
> - **Tests, in memory:**
>   - `error-handler.test.ts`: the JSON and XML `problems` of a body with three problems. These were new cases, red by construction (the field did not exist), not run red.
>   - `validation.service.test.ts`, moved off its container since it reads no table: `required` on a nested object and on an array item (red before), a date compared with another property, five cases for checks (written out, shortcut, nested, a partial update with and without `null`, an `OmitClass` dropping a property), and four for custom rules, including the `@ts-expect-error` for a wrong class.
>   - `validate-date.function.test.ts`, also off its container: callbacks, a bound asked per call, and a bound reading the object.
>   - `entity.decorator.test.ts`: the shortcut's code and message.
> - **Docs:** `models.md`, `data-source.md` (the written-out check), `error-handling.md`, `configuration.md` and `README.md` link the page.
> - **Filed:** 01 §D19 (a check cannot compare two properties, nor a date) and 01 §D20 (a check the data source refuses answers without the check's code).

### X6. Release notes and the cli README are empty — MINOR
*Filed 2026-10-21.*

> **Closed 2026-10-25.** `packages/cli/README.md` says what the cli does, how to install it, its
> commands and where the docs are; `packages/tsx/README.md`, which held a heading only, says the same
> for the compiler. `published-package.test.ts` "the packages released together" holds each of the
> four READMEs to a title, an install command and a link to the docs site; red for cli and tsx when
> written. The empty `## 3.0.0` section stays empty until the release: the notes are written by a
> person, and the release refuses to publish without them (`release-notes.mjs`, tested in
> `ci-workflows.test.ts` "reads the notes of one version out of the changelog").

`CHANGELOG.md` has a `## 3.0.0` heading and nothing under it (`CHANGELOG.md:5`); `CONTRIBUTING.md:45`
says the release refuses to publish while that is so, which is fine for a tree in progress but
means the adopter reading the repository today sees a changelog with no entry. `packages/cli/README.md`
is tracked and empty while the root README (`README.md:9`) points at it.

**Verify:** `wc -l CHANGELOG.md packages/cli/README.md`.

### X7. No glossary — MINOR
*Filed 2026-10-21.*

> **Closed 2026-10-25 (user: link on first use).** `docs/glossary.md` defines 28 terms, one heading
> each, with every meaning a word has across the pages (provider: DI, identity, plugin; scope: row,
> OAuth2, DI) and a link to the owning page; `unscoped`, `restrictedTo` and `acrossTenants` are
> explained under Scope and Tenant. Every other page links a term's first prose use to its entry, or
> to a page the entry names (about 105 links on 45 pages). Test: `docs-style.test.ts` "links each term
> of the glossary the first time a page uses it", which reads the terms from the glossary's headings;
> words the pages use in more than one sense (login, session, provider, claim, grant, identity,
> credential, scope) are defined but left out of the check (`UNCHECKED_TERMS`). Red with no glossary
> when written. DOCS_STYLE's "link it to the glossary" now links the page.

The auth pages use *authenticator*, *strategy*, *provider*, *identity*, *credential*, *login* and
*session* with precise, different meanings (`auth.md:51-60` is the only place two of them are
defined); the data pages use *scope*, *tenant*, *unscoped*, *acrossTenants*, *restrictedTo*; the
coordination pages use *lease*, *grant*, *claim*, *slot*, *ledger*. A reader entering on any one
page meets the terms without the definitions. One page with the ten terms would do.

**Verify:** read `tenancy.md:289-290` ("`unscoped` lifts an entity's scopes and leaves the tenant in
place") as a first-time reader.

---

## Part 3: articulation

> **2026-10-23:** the standard is written down in the root `DOCS_STYLE.md`, decided with the user
> before X8 to X12 are fixed. Those findings are measured against it. Where it differs from what is
> quoted below: one short sentence of why is allowed when a rule would look arbitrary without it;
> decisions spanning many pages go to a published `docs/faq.md`; heavy warnings and limits use
> `> [!WARNING]` and `> [!NOTE]`; libraries a default stands on are listed in a `## Built on`
> section; prose uses no em dashes.

> **2026-10-23, structure pass**, after X8 to X12. `docs-style.test.ts` gained the parts of a page:
> - no `## Usage` around the tasks (33 pages had one);
> - Key exports first, Built on right before See also, See also last (5 pages had none);
> - a file comment on the first line of every TypeScript example (240 blocks had none);
> - every name an example imports from `zibri`, `zibri-testing` or `zibri-tsx` in the Key exports of
>   *some* page (about 75 names were in none). One page, not every page using it, at the user's ask:
>   what it catches is a name added without a row, and a rule of every page would repeat `inject` on
>   forty. DOCS_STYLE says so;
> - every dependency and peer of `zibri` in one page's Built on, and only those, "You install it"
>   exactly on the optional peers (no page had a Built on);
> - realistic names and `example.com` (about 130 places: `Test`, `TestCreateDTO`, `MySiemAuditService`,
>   `@test.com`), and "such as" in place of "eg." (68 lines).
>
> Seven agents rewrote the pages by group against it. Headings promoted out of Usage were renamed to
> tasks where they named none, and every link to them fixed; the link check holds it. Comments in
> examples that explained why moved into the prose, and sentences that only repeat a boot error went
> (DOCS_STYLE "what the reader will notice on their own"). Titles are sentence case. Found wrong
> against the code and fixed on the pages: `application-lifecycle.md` showed the framework's
> `event.service.ts` as the reader's file with `register: 'onUse'`; `creating-endpoints.md`'s scopes
> example duplicated `data-source.md`, now a link; `replication.md`'s readiness example duplicated
> `deployment.md`, now a link; `deployment.md` claimed the bundle belongs to another user, which the
> Dockerfile did not do (fixed in the Dockerfile, see the Part 1 row); the `Repository` row and list
> left out `findAllAfter`, `sum`, `average`, `minimum` and `maximum`; `upgrading-to-3.md` never said
> that 2.x version files (`"versions": "all"`, checked on `dev`) refuse the start, now an entry under
> "Before the first start". `reportError` takes `unknown`, so the worker example needs no `as Error`
> (the examples test was red on `reportError(error)` before). Tests: `npx jest
> src/application/docs-style.test.ts src/application/docs-examples.test.ts`, 20 passed.
>
> Left as they are: `di.md`'s "Configuration", "Precedence" and "Scopes" and a few descriptive
> headings elsewhere (linked, renaming them is taste); `request-context.md` still names which
> `AlsUtilities` call enters each context; `leases.md` names that a data source locks for schema
> setup; untyped locals where the inferred type is the point (`http-client.md`'s declared headers)
> or comes from a made-up module (`email.md`'s `mailApi`, `websocket.md`'s `socket.io-client`).

The standard to match is the hand-written voice: `auth-routes.md`, `passkeys.md`, `dpop.md`,
`api-keys.md`, `client-certificates.md`, `scim.md`, `sign-in-through-a-provider.md`,
`provider-tokens.md`, `tenancy.md`, `xml.md`, `document.md`, `models.md`, `costs.md`,
`releases.md`, `architecture.md` and the first forty lines of nearly every other page. Those
pages say what is, in short second-person sentences, with a table where there is a list. The
pages below do not, and they are the long ones: `data-source.md` (1818 lines), `auth.md` (803),
`upgrading-to-3.md` (758), `testing.md` (751), `creating-endpoints.md` (845).

### X8. Pages that explain reasoning instead of stating what is — MAJOR
*Filed 2026-10-21.*

> **Closed 2026-10-23, together with X9 to X12.** Every page except `upgrading-to-3.md` was
> rewritten against `DOCS_STYLE.md` in one pass, since the five findings sit in the same paragraphs.
>
> **The test.** `packages/zibri/src/application/docs-style.test.ts` checks what a single word gives
> away, one case per rule:
> - history (`any more`, `no longer`, `today`, `2.x`, `(yet)`);
> - references into the repository (`evaluation`, `JSDoc`, "in the … module");
> - store internals (`MULTI`/`EXEC`/`WATCH`, Lua, `pg_*`, advisory lock, RxJS, node-cron, ICU, "under the hood");
> - framing ("simply", "easy", "worth knowing", "is what makes", "two things", "deliberately", "on purpose", "let's");
> - pronouns other than "you" and "they";
> - "Why", "The problem" and "Caveats" headings;
> - em dashes in prose outside the See also separator, `<br>`, British spelling;
> - every link between pages naming a page and a heading that exist.
>
> Red at first with about 650 places on 44 pages. "still", "now" and "currently" were dropped from
> the history rule after reading them: nearly all are about time inside one run ("while still
> running", "the currently logged in user"). The link case found two broken anchors that predate
> this pass: `error-handling.md` → `di.md#overriding-existing-injectables`, and `data-source.md` →
> `#scopes`. Both are fixed.
>
> **The rewrite.** Eight agents, by page group. Each quoted paragraph is reduced to what the reader
> does and gets. A reason became one sentence where a rule would look arbitrary without it, a link,
> a `docs/faq.md` entry, or an inline `//` comment at the code holding the decision. Most of those
> comments existed already; new ones are in:
> - `auth.service.ts`;
> - `multithreading.service.ts`;
> - `log-to-email.function.ts`;
> - `open-telemetry.tracer.ts`;
> - `encryption-strategy.interface.ts`;
> - `application.ts`;
> - `typeorm-base-data-source.model.ts`;
> - `entity-ownership.function.ts`;
> - `optimistic-lock-descriptor.ts`;
> - `find-one-options.model.ts`.
>
> `docs/faq.md` is new with two entries, "Why do some options have no default?" and "Why does every
> entity have a tenant?". The auth, events, backup and localization pages link there.
>
> Other changes:
> - **Limits and warnings** are plain sentences or `[!WARNING]`/`[!NOTE]` alerts. The Caveats
>   sections of `tracing.md` and `logging.md` are gone, each limit next to what it concerns.
> - **`replication.md`** has a Key exports table. Its `preStop` manifest and the drain sequence
>   moved to `deployment.md#draining-traffic-before-shutting-down`.
> - **Renamed headings** got their links fixed, `upgrading-to-3.md` → `cron.md` included:
>   - `leases.md` "The problem it exists for";
>   - `events.md` "Why `subscriberId` must stay stable";
>   - the `logging.md` caveats;
>   - `cron.md` "Behaviour";
>   - the three `data-source.md` headings with "— upsert" style suffixes;
>   - `excluding-properties.md` "Caveat: …";
>   - `multithreading.md` "Run a simple function".
>
> **Claims corrected on the way,** each checked against the code by the agent that found it:
> - `application-lifecycle.md`: its `onAppStart` example claimed the app was listening. It runs
>   before the port is bound, so the example now uses `afterAppStart`.
> - `multithreading.md`:
>   - named a `runThreadJobFunction` that does not exist;
>   - said the thread counts must be "smaller than" the available parallelism, where the check is
>     "at most" (the published `MultithreadingOptions` JSDoc said the same and is fixed);
>   - the takeover time is `jobClaimInMs` after the last renewal, not a flat 30 seconds.
> - `events.md`: a run row records how the last attempt ended, `PENDING_RETRY` included. It does
>   not mean the work is done. The inline comment in `event.service.ts` saying a row is written at
>   claim time was stale too, and is fixed.
> - `cron.md`:
>   - the class owns `timezone` and `catchUpWithinMs` as well;
>   - the `distributed: false` list was missing three jobs, and its `syncToDataSource` sentence was
>     wrong.
> - `metrics.md`: `CollectMetricsCronJob` is registered for you, and the page told the reader to
>   register it.
> - `logging.md`: the flush gap is "up to" the interval, not "at least".
> - `error-handling.md`:
>   - the handler steps described logging the code no longer does;
>   - `ErrorUtilities.isRefusal` was missing.
> - `request-context.md`: a websocket request's signal does fire, at its deadline.
> - `app-settings.md`: the list of headers the framework allows was incomplete.
> - `testing.md`: `BACKUP_TEMP_FOLDER` is redirected too.
> - `data-source.md`:
>   - `schemaLock` is not on `DataSourceInterface`;
>   - a lease can hold until a transaction ends (`heldUntil`);
>   - Valkey reads every row only for a filter naming no id, unique or index group;
>   - a changed type on Valkey is converted by the migration.
> - `localization.md`:
>   - `source.xlf` is written before every build;
>   - a requested locale resolves to a supported one of the same language, while `formatPrice`
>     and `formatDate` need the exact key.
> - `excluding-properties.md`: the alternative to `true` is a function.
> - `templating.md` and `email.md`: the Handlebars types are written on every build.
> - `encryption-and-hashing.md`: a run rehashes 500 rows, and `BcryptHashStrategy` needs
>   `bcryptjs` installed.
> - `passkeys.md`: three options are marked Required.
> - `http-client.md`: the body example's `value` is a number.
> - `websocket.md`: `handlerInMs` defaults to 30 seconds.
> - `creating-endpoints.md`: TTF and OTF fonts are compressed.
>
> Published JSDoc with references into the repository was cleaned:
> - the `WebsocketOptions` "today means" sentence;
> - `EventDispatchCronJob` pointing at the docs;
> - the evaluation references in `EventSubscriberRegistration` and `retryDelayFor`, which moved to
>   inline comments.
>
> **What the test cannot see,** and what was judged by reading:
> - sentence length;
> - "rather than" introducing a rejected design;
> - bold mid-paragraph. Bold labels at the start of a paragraph were kept as term labels.
>
> **Left for the structure pass:**
> - the `## Usage` wrappers;
> - incomplete Key exports (Part 1 row);
> - `## Built on`, where node-cron, socket.io and `@peculiar/x509` now belong;
> - example comments that still explain why (the templating metrics example, the encryption
>   `Secret` example);
> - unrealistic names (`MySiemAuditService`, "anna@example.com");
> - reasoning that sits in published JSDoc (`DefaultAuth` "Deliberately", `AuditReason`,
>   `backup-format.ts`, `localize-options.model.ts`).
>
> Two open questions:
> - `backup-format.ts` JSDoc says the format version covers the layout a transport stores under,
>   which the page used to deny. The page now says neither, so one of the two still needs settling.
> - `tracing.md` no longer names `OTEL_RESOURCE_ATTRIBUTES`, since the tracer passes its own
>   resource. Whether the variable still applies is unverified.

CODE_STYLE: "Say what is. Not … why a rule exists, not what happens underneath." The pages that
break it most, with one quote each:

- `replication.md` — the whole page. `:5-7` "Everything here matters the moment there are two,
  because the failures are quiet: both replicas believe they are the only one, both succeed";
  `:121-123` "A database serves its peak throughput at roughly two to three times its core count
  in active connections". No key-exports table, no usage section, a Kubernetes `preStop` manifest
  (`:180-205`) that belongs on `deployment.md`.
- `logging.md:58-239`. `:88-90` "`reason` is too, deliberately: messages are localized and are
  allowed to change wording, so nothing worth alerting on should have to be parsed out of one";
  `:216` "One email per log entry is how a log storm becomes a mail storm".
- `tracing.md` — `:131` "That last one is what makes a trace worth having at all"; `:204`
  "Tracing watches work, and a watcher that can fail the work is worse than no watcher"; the
  Caveats section `:206-224` is a list of negatives.
- `leases.md` — a section titled "The problem it exists for" (`:24`); `:30-31` "Nothing about that
  is loud. Both replicas succeed. The duplicate only shows up in what the work touched."
- `encryption-and-hashing.md:68-119`, `:188-262`, `:273-403` — `:107-112` "That is a deliberate
  trade rather than an omission: naming the column would also stop…"; `:355-356` "Zibri ships no
  such strategy — that would mean depending on one vendor's sdk — so this is a seam rather than a
  feature."
- `auth.md:104-696` — `:155-158` "**There is no default on purpose.** … picking either one for you
  would make 'you forgot to say' look exactly like 'you said this'"; `:303` "A client sending both
  a bearer token and a session cookie is either confused or attacking."
- `cron.md:85-274` — `:103` "whatever made that start happen — a deploy, a failover, a
  configuration change — is the same class of event that would have fixed the failure";
  `:165` "past some age a make-up run stops being a service and becomes a surprise."
- `events.md:98-186` — a heading "Why `subscriberId` must stay stable" (`:98`).
- `data-source.md` — `:465-467` "`findOne` and `findById` throw when nothing matches, because
  reading one specific thing that is not there is usually a bug rather than a result";
  `:776-779` "Last write wins. That is right for most properties and silent data loss for the ones
  two people edit at once"; `:1563` "There are two tools here and they are not interchangeable.
  Picking the wrong one produces something that looks safe and is not"; `:1545` the Postgres
  catalog error text.
- `creating-endpoints.md:786-839` — `:826` "`text/event-stream` must not be, because an encoder
  holds bytes back until it has enough of them to be worth writing"; `:833-834` (inside a code
  example) "it runs on the same thread pool that hashes passwords".
- `application-lifecycle.md:62`, `:103`, `:119-121`, `:154` — "That cap matters more than it
  looks."
- `localization.md:208-261` — `:241` "A column's collation belongs to the schema, so ordering by
  the requesting locale would mean naming a collation in every statement, which takes ordered
  reads off their index."
- `rate-limiting.md:72-126`, `caching.md:61-82`, `:135-168`, `:194-207`, `http-client.md:88-98`,
  `:181-183`, `multithreading.md:99-135`, `websocket.md:235-261`, `backup.md:201-291`,
  `two-factor.md:52-200`, `templating.md:83-101`, `:170-214`.

Recurring tells, which is what "sounds AI-written" means in practice: "X is what makes Y"
(`caching.md:157`, `metrics.md:47`, `tracing.md:102`, `:131`, `:202`, `multithreading.md:114`,
`:116`, `:118`, `:129`), "worth knowing" / "worth a note" (`caching.md:202`, `websocket.md:257`,
`auth.md:635`, `cron.md:270`), "rather than" introducing a rejected design (every page above but
two), mid-sentence bold aphorisms (`leases.md:35-38`, `:167`, `:201`; `multithreading.md:129-131`;
`data-source.md:1223`, `:1225`, `:1664`), "Two things …" / "Three things have to be true" frames
(`auth.md:203`, `:635`; `leases.md:33`; `caching.md:202`; `lifecycle.md:149`, `:207`).

The fix is editorial, not technical: each quoted paragraph reduces to the sentence that says what
the reader gets, and the reasoning moves to an inline `//` comment where CODE_STYLE puts it.

**Verify:** read any page in the list against `auth-routes.md`.

### X9. History, evaluation references and version leftovers in user pages — MAJOR
*Filed 2026-10-21.*

> **Closed 2026-10-23 with X8.** The style test's history and repository-reference cases hold it.
> `auth.md`'s 2.x introduction is folded into the `AuthService` section. The leases incident, the
> `__testing__` reference, the JSDoc quote, "still available", "(yet)", "today means valkey", "any
> more" and "currently the only built-in consumer" are gone. The old hash format is stated as what
> is: bcrypt hashes, such as the ones Zibri 2 wrote, are accepted.

- `leases.md:54-55` "This is not theoretical - it is how invoice numbering got a correct-looking
  lock that still handed out duplicate numbers." — an evaluation finding retold.
- `replication.md:18-19` "Each is held by a test in `src/__testing__/evaluation/cluster/`".
- `events.md:99` "Per the `EventSubscribeOptions` JSDoc, the id 'needs to be unique…'".
- `auth.md:104-109` is the 2.x introduction ("you will probably never use these strategies
  directly … the AuthService is able to determine if a user is logged in, no matter which strategy
  he uses") sitting under the 3.x section that just showed `authService.login`; `auth.md:714` "you
  now also need to register a user repository".
- `encryption-and-hashing.md:140-142` "values written before binding existed"; `:85` "widens a
  window that was always open"; `:11`, `:383` "the password hashes of zibri 2.x".
- `templating.md:6` "Handlebars is **still** available"; `:214` "simply won't work (yet)".
- `caching.md:172` "Look it up inside the redis cache" (the store is `ValKeyCacheStore`).
- `replication.md:53`, `websocket.md:251` "which today means valkey".
- `logging.md:235` "Nothing throttles the code producing logs any more".
- `document.md:2` "the invoicing plugin is currently the only built-in consumer".

**Verify:** `grep -n "2\.x\|evaluation\|any more\|today means\|still available" docs/*.md`.

### X10. Store internals in user pages — MAJOR
*Filed 2026-10-21.*

> **Closed 2026-10-23 with X8.** The style test's "how it works underneath" case reads code blocks
> too, so the Lua script on `leases.md` had to go as well. `costs.md` is its one exception. Each
> mechanism is replaced by the guarantee the reader gets:
> - rate limiting loses no update;
> - one instance runs each tick;
> - a lease outlives its holder only as long as `leaseInMs`.
>
> `localization.md`'s ordering section states a limit ("one order for the whole application") and
> the startup error, without collations or ICU.

CODE_STYLE: "never how Postgres or ValKey implement it internally. If it is ever relevant which
store is underneath, the abstraction is leaking and that is the bug."

- `rate-limiting.md:79` "`WATCH` / `MULTI` / `EXEC` is *not* a working alternative for the valkey
  lock: `WATCH` is state of the connection, and the client multiplexes every command over a single
  one".
- `leases.md:173-185` a Lua script (`redis.call("get", KEYS[1]) == ARGV[1]`); `:245-248`
  "`PostgresDataSource` an advisory lock, which needs no expiry at all: the session owns it and
  the server releases it when the connection drops."
- `data-source.md:166-170` the hash and set key layout; `:181-196` `MULTI`/`EXEC`, grants per row
  key; `:1545` `pg_type_typname_nsp_index`; `:1547` `pg_advisory_lock`.
- `localization.md:239-261` collation per column, ICU builds.
- `encryption-and-hashing.md:75-89` authentication tags, isolation levels and "one statement
  carrying one value to every matching row"; `:359-361` scrypt parameters and memory; `:384` main
  thread vs thread pool.
- `websocket.md:251-253` "Under the hood this builds a socket.io adapter on socket.io's own cluster
  adapter".
- `cron.md:2` "node-cron package … under the hood"; `:219` lease key format; `:225`.
- `events.md:75` "pushes it onto the internal RxJS subject"; `:105` the lease key format.
- `logging.md:127`, `:137`, `:195` buffers, batches and queues.

`costs.md` is the one place the docs deliberately name a store, and it does so in a table of
measured numbers — that is the pattern; prose about mechanisms is not.

**Verify:** `grep -n "MULTI\|EXEC\|advisory\|redis.call\|pg_\|ICU\|collation" docs/*.md`.

### X11. Three voices in one page — MINOR
*Filed 2026-10-21.*

> **Closed 2026-10-23 with X8.** The tutorial voice is gone from every quoted page: "we", "let's",
> "easily", "simply", "stumble across", "That's it!". So are the `<br>` separators, which the style
> test now refuses. `encryption-and-hashing.md` names the exports instead of "the auth module".

Several pages carry a 2.x tutorial voice, a hand-written 3.x reference voice and an essay voice in
one file. `encryption-and-hashing.md:2` "can be easily defined via the `@Property.string` decorator"
→ `:66` "See `PasswordCredentials`/`PasswordCredentialsCreateData` in the auth module" (points at
source, not a page) → `:347` "this is textbook envelope encryption". `di.md:90` "Bascially every
service/functionality of the framework is registered for dependency injection. That makes it really
easy for you" beside `:394-401`. `data-source.md:41` "A data source needs too implement
DataSourceInterface" and `:930` "In most cases you probably don't want to get all entities" beside
`:1286`. `multithreading.md:172` "This is because the execution time will probably be not that long.
(Because you can await the result.)" `excluding-properties.md:2` "At some point in time you will
probably stumble across the problem". `templating.md:216-217` "Let's take the metrics page as an
example… The first thing you'll notice is the strange import". `backup.md:71` "What we did need to
do was add two new entities."

`<br>` as a paragraph separator: `plugin.md` (eight times), `events.md:65-135`,
`application-lifecycle.md:48-50`, `error-handling.md:41`, `multithreading.md`, `caching.md:171`.

**Verify:** read `encryption-and-hashing.md:2-66` then `:68-119`.

### X12. Spelling and consistency — MINOR
*Filed 2026-10-21.*

> **Closed 2026-10-23 with X8.**
> - Every listed typo is fixed, the two in `packages/zibri/README.md` included.
> - The spelling is American, and the style test refuses the British forms.
> - Em dashes in prose are gone except the See also separator, which the style test checks.
> - The " - " dashes on `leases.md` and `replication.md` are gone.
> - The Handlebars type paragraph lives on `templating.md` only, and `email.md` links to it.
>
> The README's two Part 1 rows (body parsers, busboy) are fixed in the same edit. The user still
> runs lint for cspell on the rewritten pages.

Typos: `README.md:11` "opiniated", `:96` "automtically"; `creating-endpoints.md:71` "actual
define", `:467` "differnt"; `di.md:90` "Bascially"; `data-source.md:41` "needs too", `:1403`
"renamend"; `backup.md:32` "retrive"; `websocket.md:29` "incomig", `:72` "can be send", `:4`
"name an"; `email.md:2` "with with", `:144` "extremly"; `localization.md:157` "loale", "than that
will match", "exact match" (×2), `:75` "providing a them to", `:160` "use inject the";
`cron.md:45` "actual able to pickup"; `excluding-properties.md:28` "enumarable"; `auth.md:51`
"Zibris", `:109` "he uses"; `multithreading.md:63` "a bit different"; `xml.md:195` garbled
sentence. British and American spelling mixed across the set: `enrol`/`enrols` (`auth.md`,
`auth-routes.md:71`, `two-factor.md:130`) beside `enrollment`/`enrolls` (`auth-routes.md:72`,
`two-factor.md:174`, `:258`); `honours` (`auth.md:343`) beside `honored` (`two-factor.md:200`).
Dash style: `leases.md` and `replication.md` use " - ", the rest " — ". The Handlebars type
inference paragraph is duplicated verbatim in `templating.md:335-350` and `email.md:141-152`
(one topic per page).

**Verify:** the user runs lint (cspell is wired into it); read the two Handlebars sections.

---

## Part 4: developer experience

Walked through as a developer who has read `getting-started.md` and `architecture.md`, building a
small internal service: scaffold, one entity with a relation, a CRUD controller, validation, auth
with a role, a nightly job, one email, one test, a container.

### X13. The first example on 18 pages is unreadable, because the docs test wrote it — MAJOR
*Filed 2026-10-21.*

> **Closed 2026-10-23.** Wider than filed, at the user's ask: not only does no block import what it
> does not use, but no block may lean on another block's import either, or a forgotten one goes
> unnoticed. `docs-examples.test.ts` keeps compiling a page as one module, and a new case, "imports
> in every block exactly what that block uses", resolves every identifier through the checker and
> fails a block that uses an imported name it does not import itself, or imports a name it does not
> use. A name another block declares counts too, when both blocks' path comments name different
> files (di.md's `TestController` using `TestService` from `src/services/test.service.ts`); a block
> without a path comment may continue the file above it and is not judged on that. Relative imports
> of a name the page declares stay out of the compiled module, so the case also fails an import of a
> name the page declares without `export`; one reader name imported from two relative paths is
> merged. First run: 679 uses without an import and 221 unused imports on 40 pages, then 55
> cross-file uses, all fixed by moving import lines, then imports of three unexported classes
> (`RenameValuePropertyMigration`, `EmailChannel`, `SmsChannel`) and of multithreading.md's
> `fibonacci`, which the service imported from a file the page never showed while the worker file
> declared its own; it is now `src/services/fibonacci.function.ts`, imported by both. The made-up modules went with it:
> `./example-setup` (di.md), `./example-fixtures` (testing.md) and `./example-data`
> (localization.md) are now the reader files each block would import from, and testing.md's
> `ClusterMarkRow` turned out to be a real `zibri-testing` export that the unresolved fake import
> had typed as `any` (the Part 1 TS2307 row). templating.md's metrics example lost a block that only
> held imports and a type; the `?client` paragraph now follows the block with the import. The
> Part 1 rows on the 10-20 name import lines and on testing.md's base options importing
> `DbDataSource` close with this; DOCS_STYLE.md's "Every block stands on its own" names the test.

This is the finding that shapes every other reading experience. `docs-examples.test.ts:98-133`
assembles a page into one module with the imports merged; to make that compile, the imports every
later block needs were pushed into the page's *first* block. So the first thing a reader sees on
`creating-endpoints.md:40-43` is

```ts
import { $ts, BaseEntity, CompressionOptions, CookieAuthStrategy, Controller, defineProvider, Entity, EntityScopeContext, FsUtilities, HttpStatus, InjectRepository, Post, Repository, Response, scopeFor, UnauthorizedError, ZIBRI_DI_TOKENS, ZibriApplication } from 'zibri';
import { applicationOptions } from '../application-options';
import { CreateUserData, GalleryDTO } from '../models';
```

for a class that uses `Controller`. `di.md:27-29` imports eleven names and `./example-setup` for
`class TestService {}`; `testing.md:98-101` imports `CronExpression`, `createPostgresTestDataSource`
and `defaultClusterProviders` into the file that holds the test options; `auth.md:139-143` imports
`MySharedAuthRateLimiter` and `secrets` for a four-line options object; `encryption-and-hashing.md:25`
imports twenty names for an entity using four. 18 of 54 pages carry such a line (grep in Part 1).

The cost is concrete: a developer copying the first example gets unresolved imports and does not
know which of the twenty names matter. The test's own comment says a page is the unit "because
three in five blocks are excerpts"; the fix that keeps the test is to let it *prepend* the merged
import header itself (it already builds one at `:124-125`) instead of requiring the page to carry
it, so each block imports what it uses and nothing else.

**Verify:** a docs-examples case that fails when a block's own `import` line names a symbol the
block does not use — or simply read `di.md:25-35`.

### X14. The scaffold is a web application, not an API — MAJOR
*Filed 2026-10-21.*

> **Closed 2026-10-24.** Not one `--api` switch, at the user's ask, but features toggled one by one,
> like `ng add`. `zi new` asks a fourth question (or takes a fourth argument: a comma list or `none`),
> a checkbox of `pages`, `mailingList`, `metricsDashboard` and `logEmail`, every one checked but the
> mailing list (the user's choice); `mailingList` and `metricsDashboard` need `pages`, and a project
> naming one without it is refused before anything is written. None is a JSON API: no page
> controller, no page templates or components, no stylesheet, no postcss or tailwind config and none
> of their six devDependencies, no `chart.js`, no mailing list plugin, providers or entities; a
> `health.test.ts` is the first test, written in every project. What each feature writes is one table,
> `SCAFFOLD_FEATURE_FILES` in the cli, which `createFile` and the template copy both consult; what it
> installs is `SCAFFOLD_FEATURE_DEPENDENCIES`. `zi add` and `zi remove` reuse the three-way merge of
> `zi upgrade` (moved into a shared `RegeneratingCommand`): the project is generated again with the
> features changed and merged file by file, so `PageController` lands in an edited
> `application-options.base.ts`, an edited feature file is kept on removal, and remove uninstalls the
> feature's packages. Both refuse a project another release generated, so a feature change never
> carries a release's changes along. A manifest from before the features is read as every feature,
> which is what such a cli generated. `resolveWebpackConfiguration` leaves the stylesheet entry, the
> css rule and `mini-css-extract-plugin` out when `assets/public/style.css` does not exist. Webpack
> stays: the build extracts translations, compiles the password reset email with zibri-tsx and
> generates entities, and nothing else runs those steps. The four "Removing …" sections of
> `project-layout.md` became "Choosing the features" and "Adding and removing a feature"; its test
> checks the features table against the cli. With every feature the output is byte for byte what it
> was (the fast parity suite, 113 green), plus the health test the sandbox gained. Tests: new
> `without features` cases and an import-resolution check over every valid combination in
> `new.command.test.ts`, `add.command.test.ts` (including add then remove leaving the first commit's
> tree), `remove.command.test.ts`, an old-manifest case in `upgrade.command.test.ts`, two cases in
> `resolve-webpack-configuration.function.test.ts` (red first), and a heavy case running the ci
> workflow of a featureless project. `re2` and `ts-node` stay installed, as before: what the defaults
> reach for is not a feature.

`zi new` installs 16 devDependencies — webpack, webpack-cli, ts-loader, css-loader,
mini-css-extract-plugin, postcss, postcss-loader, autoprefixer, tailwindcss 3, handlebars-loader,
copy-webpack-plugin, source-map-loader (`new.command.ts:237-256`) — plus `chart.js` and twelve
runtime packages (`:294-299`), among them `re2` (a native module, installed "although nothing
generated declares a `regex` yet", `:284-286`) and `ts-node` (so worker files run as TypeScript in
production). The generated project has a page controller rendering a home page and an assets
explorer with an HTML cache (`:375-431`), a mailing-list plugin with five template providers
(`:537-556`), a tailwind theme (`:1594-1616`) and a webpack config with five custom plugins and a
30-line `externals` block (`:1311-1557`).

A team that wants a JSON API behind a gateway — the enterprise default — gets all of it and has to
find out which parts are load-bearing (the `LocalizationPlugin` is: translations are extracted at
build time and read at startup, `:1374-1394`; `versions/.gitkeep` is, `:308-314`) and which are
not. There is no `zi new --api` and no page saying what to remove. `getting-started.md:61-63`
promises "a deployment carries only what it uses" and the scaffold installs thirteen optional
peers up front because the defaults reach them (`:264-290`, a comment that explains it well — in
the generator, where the reader is not).

Compared to `nest new` (tsc, jest, one controller) or Spring Initializr (pick starters), the
scaffold is the heaviest in the comparison set and the only one whose build pipeline is a bundler
for a server.

**Verify:** `zi new api none public && ls api api/src/**` and count what a JSON API needs.

> **Noted 2026-10-23 by X1:** `docs/project-layout.md` names what an application removes when it
> does not use it, which is the "page saying what to remove" half. Found while writing it: the
> metrics dashboard (`src/templates/pages/metrics/`, `components/chart.tsx`, `components/stat-card.tsx`,
> `assets/public/lib/`, `assets/public/metrics.svg`, `src/tsx.d.ts` and the `chart.js` dependency)
> and `src/templates/emails/log.tsx` are written into every project and used by nothing in it; the
> home page's link to the dashboard is commented out. Only the sandbox's own controllers render
> them. Decided by the user the same day: they stay in the scaffold, as the example of a page with
> charts running in the browser and of an email template. The page calls them examples and names
> what deleting each takes.

### X15. Every entity pays the tenant and the base-class tax — MAJOR
*Filed 2026-10-21.*

> **Closed 2026-10-24.** Three parts, each decided by the user. (1) The tenant tax: tenancy stays
> always on (the recorded decision); `BaseTenantEntity` (`BaseEntity` with the uuid `tenantId`) is
> shipped and every docs example of a tenant entity on a `BaseEntity` extends it now (29 on five
> pages; `Account` and `Note` extend `SoftDeleteEntity` and `ChangeSetEntity`, which do not combine
> with it, filed as X28). tenancy.md has "Serving one tenant": a `TenantService` whose
> `resolveTenant` reads the one tenant row once and answers its id, so callers send no `x-tenant-id`,
> and a membership per user. `tenant.service.test.ts` boots exactly that (a request naming no tenant
> reaches its rows, a member gets in, a user without a membership gets 403) and its entity extends
> `BaseTenantEntity`. The scaffold gets a shared `Tenant` entity (`src/models/tenant.model.ts`, unique
> `name`), and the sandbox's `Company` was renamed to it (user's ask). Default data on both sides is
> now the same file: one transaction for the roles and the administrator, and with the administrator
> the tenant `Default` and their membership in it as its `admin`; before, a fresh project had no
> member anywhere. A first try generated a bare uuid in an env variable, which the user refused: an id
> to know or hardcode, and no tenant behind it. (2) The
> foreign key: the user asked whether `joinColumn` was not already required. It was not: it was
> optional in the input types, and every store refused a relation without it at boot or read; only
> a misspelled one failed to compile. `joinColumn` is required on `manyToOne` and `belongsToOne` now
> (type tests in `property.decorator.test.ts`, red first), the runtime checks for it went, and the
> two that guard the general relation type say "holds no foreign key of its own". models.md says why
> the key property is declared as well. Both declarations stay, by decision. (3) The silent relation
> behaviors stay as documented, by decision.

Declaring an entity:

```ts
@Entity()
export class Task extends BaseEntity {
    @Property.string({ format: 'uuid' })
    tenantId!: string;
    …
}
```

`tenantId` is mandatory on every entity or it must say `@Entity({ tenant: 'shared' })`
(`tenancy.md:72` "does not compile"). Every example on `data-source.md` carries the two lines
(`:214-215`, `:239-240`, `:278-279`, `:311-312`, `:360-361`, `:613-614`, `:649-650`, `:662-663`,
`:788-789`, `:839-840`, `:991-992`, `:1062-1063`, `:1096-1097`, `:1152-1153`, `:1190-1191`,
`:1270-1271`, `:1319-1320`, `:1621-1622`, `:1690-1691`) — the page itself shows what the tax
looks like. A single-tenant internal tool (most enterprise services) still needs a `Membership`
entity with a `@MembershipRepo()` class ("An application with users and no class marked with
`@MembershipRepo()` does not start", `tenancy.md:247`), a `Role` entity with `@RoleRepo()`, roles
at two levels, and an `x-tenant-id` header its callers never send. Multi-tenancy always on is a
recorded decision; the cost is that there is no single-tenant mode and no page telling a
single-tenant team the shortest path (`tenant: 'shared'` everywhere, one platform role level).

Relations double-declare the foreign key — `@Property.manyToOne({ target: () => Team, joinColumn:
'teamId', inverseSide: 'seats' })` *and* `@Property.string({ format: 'uuid' }) teamId`
(`data-source.md:668-672`, `tenancy.md:50-54`) — and name the inverse side on both ends, which is
TypeORM's vocabulary with one more field than TypeORM asks for. What goes wrong silently: a
relation nobody named "comes back unset, which is not the same as empty" (`data-source.md:703`),
and `relations` on a call *replaces* `defaultRelations` rather than adding to it (`:704-705`).

**Verify:** scaffold, add a second entity without `tenantId`, run `tsc`.

### X16. A repository of your own is six arguments of boilerplate, and the only way to a user — MAJOR
*Filed 2026-10-21.*

Every custom repository — and an application with users needs three (`@UserRepo`, `@RoleRepo`,
`@MembershipRepo`) — is written as

```ts
constructor(@InjectRepository(Role) repo: Repository<Role>, @Inject(ZIBRI_DI_TOKENS.LOGGER) logger: LoggerInterface) {
    super(Role, repo, logger, repo.dataSource, getDefaultBeforeSaveHook(), getDefaultBeforeReturnHook());
}
```

(`new.command.ts:1133-1143`, `:1151-1162`, `:1201-1212`; `auth.md:727-734`; `tenancy.md:207-214`;
`roles-and-permissions.md:76-84`). The developer injects the repository they are replacing, hands it
back together with its own data source, and names two framework hook factories whose purpose no
page explains — all to add one `findByEmail`. The published JSDoc on `@MembershipRepo` shows the
two-argument form that does not compile (Part 1). And the wrapper keeps only the driver
(`repository.ts:248`), so applying the pattern to a soft-delete entity silently drops soft deletes
(Part 1, 01 §D6).

Spring Data: `interface RoleRepository extends JpaRepository<Role, UUID>`. NestJS/TypeORM:
`@InjectRepository(Role) private repo: Repository<Role>` and a service around it. Here the
framework's own interfaces (`UserRepositoryInterface`, `MembershipRepositoryInterface`) demand a
class that *is* a repository, so composition is not offered. Fix direction: a `Repository.extend`
or a protected two-argument constructor that resolves the rest, so the six-argument form becomes
the JSDoc's two-argument one.

**Verify:** count `getDefaultBeforeSaveHook()` in `docs/` and in a scaffolded project.

> **Narrowed 2026-10-21 by 01 §D6:** the constructor is `super(Role, repo)` now, in the docs, the
> scaffold and the JSDoc alike, and `getDefaultBeforeSaveHook()` appears in no docs page or
> scaffolded file. What stays open here is the second half: composition is still not offered, since
> `UserRepositoryInterface` and `MembershipRepositoryInterface` are implemented by a class that *is*
> a repository.

> **Closed 2026-10-25 (user's design):** the bug under the finding: the interfaces allowed a class
> holding `Repository<User>` in a property, and auth.md said extending is optional, but the services
> asked `instanceof Repository` to learn the entity, so such a wrapper silently lost membership
> cleanup on user delete, the role checks on users and memberships, and the still-held check on
> role deletes (red-first, 5 of 6). A first fix (a required `entityClass` on the interfaces) was
> replaced the same day by the user's design, which removes the second, error-prone way to a user
> repository altogether:
> - `@RepositoryFor(Entity)` declares a repository class of an entity; the data source lists it in a
>   new required `repositories` (beside `entities`, so it is always loaded). `@InjectRepository`,
>   `repositoryTokenFor` and the class token then hand out the one instance, framework reads
>   included. The framework builds it with the inherited constructor over the data source's
>   repository (no own constructor; dependencies through `inject`), and the decorator's type
>   rejects a wrong entity, a non-repository and a wrong base (Repository for a soft-delete entity).
> - `@UserRepo`, `@MembershipRepo`, `@RoleRepo` are gone. Users, memberships and roles are told
>   apart by unique-symbol marks: `USER_REPOSITORY`/`MEMBERSHIP_REPOSITORY`/`ROLE_REPOSITORY` are
>   members of the interfaces (a new `RoleRepositoryInterface`), on the prototype;
>   `USER_ENTITY`/`MEMBERSHIP_ENTITY`/`ROLE_ENTITY` are statics set by the entity bases (statics, so
>   the mark leaks into no create-data type). Shipped bases `BaseUserRepository<T>(base?)`,
>   `BaseMembershipRepository<T>(base?)`, `BaseRoleRepository<T>(base?)` set them and implement the
>   methods, over `Repository`, `SoftDeleteRepository` or `ChangeSetRepository`.
> - Boot refuses: an unlisted-but-declared class of a stored entity, a listed class without
>   `@RepositoryFor`, of an entity its data source does not declare, two classes for one entity,
>   one class in two data sources, an own constructor, a non-repository, a wrong base, a marked
>   repository of an unmarked entity, a marked entity without a marked repository, a mark on the
>   instance only, and a marked instance no data source lists.
> - `repository-for.decorator.test.ts` (21 cases, the X16 cases among them), the four suites that
>   used the decorators rewritten, ~300 test data sources list `defaultTestServerRepositories`.
>   Sandbox and scaffold generate one-line repositories and `src/data-sources/db/repositories.ts`.
>   data-source.md, auth.md, tenancy.md, roles-and-permissions.md, testing.md, project-layout.md,
>   backup.md and upgrading-to-3.md say so. `BaseUserEntity()` on a soft-delete entity is X28.

### X17. Thirteen providers before the first boot, and no list of them — MAJOR
*Filed 2026-10-21.*

The scaffold's `providers.ts` registers `ERROR_PAGE_TEMPLATE`, `ENCRYPTION_MASTER_OPTIONS`,
`PASSWORD_RESET_EMAIL_TEMPLATE`, `JWT_AUTH_OPTIONS_INPUT`, `PERMISSIONS`, `EMAIL_CONFIG`,
`EMAIL_TRANSPORT`, `EVENT_FAILED_RETENTION_IN_MS`, `CONFIRM_PASSWORD_RESET_URL` and four mailing
list templates (`new.command.ts:477-557`). `testing.md:320-331` is the closest thing to a list of
what has no default ("since it has no default" appears twice). An application that sends no mail
and resets no password still provides a transport, a config and a reset template, or does not
start — `email.md:20` "both are required", `testing.md:325` "so an application that never resets a
password still starts".

What a developer meets: `NoProviderError` at boot, one token at a time, each fixed by finding the
page that owns the token. Compared to Spring Boot's auto-configuration (a feature is configured
when its starter is present) or Nest (nothing is required until a module is imported), the
framework asks for everything its defaults *could* reach. The required-option rule in CODE_STYLE is
right for a security choice; applied to a mail transport in an application with no mail it is a
tax. Fix direction: the table X2 asks for, with a "required when" column; and defaults that
register only when the feature is used (`OnAppInit` already "first finds out whether the
application uses the feature at all", CODE_STYLE:98).

**Verify:** scaffold, delete `providers.ts` entries one at a time, boot, read the error.

> **Closed 2026-10-25.** The list is X2's: `configuration.md` lists every token with its default or
> "Required", and splits the ones without a default into what every application provides and what
> a feature needs. The password reset url and template were already among the latter. The six every
> application provides stay required, by the user's decision. Email, events and thread jobs are
> building blocks that features and plugins rely on being there. The encryption service may be
> called by the application directly, so it can't be derived from the encrypted properties. The
> audit retention is a policy choice. The way out is the one CODE_STYLE already names: replace the
> service. That didn't work for email. `EMAIL_RATE_LIMITER` is a default class provider, and every
> rate limiter declares `onAppInit`, so it was built at every boot and refused one without
> `EMAIL_CONFIG`, even with `EMAIL_SERVICE` replaced. Default providers can now say
> `register: 'onUse'` (`DefaultDiProviderRecord`, read by `initDiContainer`, the same option
> `@Injectable` has). `EMAIL_RATE_LIMITER` uses it, and `EmailService.onAppInit` injects the
> limiter and adds it to the rate limiting service, the way the 2FA code methods add theirs. Events
> and thread jobs needed nothing: a subclass of `EventService` or `MultithreadingService` with an
> empty `onAppInit` boots. Docs: a FAQ entry on why every application sets them up, and
> "Running without email, events or thread jobs" in `configuration.md`, with the email service of an
> application sending no mail. Test: `packages/zibri/src/di/default/zibri-di-providers.default.test.ts`.
> It boots an application without the email config, transport, retentions and the email, event
> and thread job entities once the three services are replaced. That case was red before the
> change, on `EmailRateLimiter`. A second case checks that an application keeping `EmailService`
> still has its limiter among the rate limiters.

### X18. Permissions, roles and the one-permission-per-route rule — MINOR
*Filed 2026-10-21.*

> **Closed 2026-10-25.** Found on the way: a second `@Auth.hasPermission` (or
> `@Auth.hasPlatformPermission`) on the same route or controller replaced the first without a word,
> so "A and B" written as two decorators checked one of them. The second is refused with an
> `InvalidDecoratorCombinationError` as the class is declared (`MetadataUtilities`, the setters the
> two decorators go through; a subclass's own still replaces what it inherits). Test:
> `has-permission.decorator.test.ts`, red for the three stacked cases when written. The user kept
> "a route names one permission": a route needing what two allow gets a permission of its own, which
> covers "A or B" (both roles carry it) and "A and B". The rest, checked: a route naming an undeclared
> permission already fails the start (`AuthService.validateRoutePermissionIsDeclared`, run as each
> route's metadata resolves), which is the decorator side of the user's todo; a platform role never
> makes a user a member is a documented decision (`tenancy.md`); `.with_any_permission` is part of
> permission values, which are dotted snake case everywhere (`invoices.read`), not API names. The
> scaffold's two `typescript/typedef` disables stay (user): the `as const` is the type, and the rule
> has no option for it.

The permission model is sound and well typed (`definePermissions([...] as const)`,
`roles-and-permissions.md:26-54`). Costs met on the way: the scaffold ships two
`// eslint-disable-next-line typescript/typedef` lines in `permissions.ts` (`new.command.ts:1066-1068`)
— the framework's own lint rule and its own idiom disagree, and every project inherits the disable.
A route names exactly one permission: "A route that needs two things is a permission of its own"
(`roles-and-permissions.md:133`), so neither "A or B" nor "A and B" is expressible on a route, and
a platform administrator without a membership gets 403 on every tenant route
(`tenancy.md:183-186`, `:266`). Roles are rows seeded by hand (`:103-123`); nothing validates at
startup that a seeded role names a declared permission — the page says a stored role with an
undeclared permission *does* stop the start (`:262`), which is good, but the user's own todo
(`after-all-findings-fixed.md:18`) says the decorator side is not yet checked.

Naming inside the subsystem is consistent (`hasPermission`/`hasPlatformPermission`,
`Permissions`/`PlatformPermissions`, `Roles`/`PlatformRoles`); the `RoleService` guard names
`.with_any_permission` / `.with_own_permissions` (`:182`) are snake_case in a camelCase API.

**Verify:** read `roles-and-permissions.md:127-155`; try `@Auth.hasPermission(A)` and
`@Auth.hasPermission(B)` on one route.

### X19. A cron schedule edited in code does nothing after the first boot — MAJOR
*Filed 2026-10-21.*

`cron.md:85`: "the stored row wins for those — a change you make through the cron service survives
every restart, and editing `cron` in the class afterwards has no effect." A developer changes
`cron: '0 3 * * *'` to `'0 4 * * *'`, reviews, deploys, and the job keeps firing at 03:00 on every
environment that has ever booted the old value, with no warning. Every framework in the comparison
set (`@Scheduled`, `@Cron`, Rails/Django schedulers) treats the code as the truth; here the
database is, and the only way back is `syncToDataSource: false` or `cronService.changeCron()` from
somewhere. The page documents it clearly in a paragraph that begins "**Who owns which value.**";
the runtime says nothing. Fix direction: log at `warn` on boot when a job's class and row disagree
on `cron`, naming both.

Otherwise the job story is good: `CronJob` + `initialConfig` + `cronJobs: [...]` is three steps,
the three states are explained, and `distributed` is the default.

**Verify:** a `startTestServer` test: boot with one expression, `reInit` with another, read the
row.

> **Closed 2026-10-25 (user's design).** A warning alone would also fire on every boot after a
> deliberate `changeCron`, so the row now tells the two apart. It records what the class declared
> at the last start (`declaredCron`, `declaredActive`). A start whose class declares something else
> is a change to the code, which wins, and the boot logs the replaced schedule. A class that declares
> the same keeps the operator's change across restarts. `active` had the same gap and gets the same
> rule, by the user's decision. A row from before the columns existed is kept as it is, and the class
> is followed from that start on. Both columns are in the upgrade migration. Tests:
> `cron-job.declared-config.test.ts` (in memory, real restarts through `reInit`). Six cases were red
> before the fix, and the two that keep an operator's change were already green.

### X20. The public surface is the whole package — MAJOR
*Filed 2026-10-21.*

`src/index.ts` has 968 `export *` lines (18 of them added in the working tree). `releases.md:5`
makes every reachable name a semver promise. What that promises, among others: `DiContainer`,
`GlobalRegistry`, `Router`, `Parser`, `AlsUtilities`, `MetadataUtilities`, `ReflectUtilities`'
consumers, `WriteDataUtilities`, `ValueConversionUtilities`, `DoublyLinkedList`,
`readNumber`, `nowInNs`, `MaskUtilities`, `TypeOrmRepositoryDriver`, `ValKeyRepositoryDriver`,
`TypeOrmWhereFilterConverter`, `PostgresTypeOrmWhereFilterConverter`, `WhereFilterEvaluator`,
`OpenTelemetrySpan`, `TraceBufferSpanProcessor`, `PayPalPaymentProvider`, every SCIM utility
class, ~25 framework cron jobs (`JwtRefreshTokenCleanupCronJob`, `EventDispatchCronJob`,
`CacheExpiryCleanupCronJob`, …), and `GlobalError`, which `error-handling.md:9` describes as
"used internally by the error handler". The barrel carries comments saying why an internal is
exported ("needed by a driver", `:667`; "for the in memory data source", `:721`; "the shape of
the onConflict argument", `:727`), exports `websocket-channel.model` twice (`:1011-1012`) and keeps
a commented-out line (`:493`).

A curated surface would be the names the docs' key-exports tables list; everything else belongs
behind a `zibri/internal` entry point or a `@internal` tag typedoc hides. Until then the
maintainers cannot rename a utility without a major, and an adopter cannot tell which of 900+
names they are meant to use.

**Verify:** `grep -c "^export \* from" packages/zibri/src/index.ts`; diff the names against the
union of every "Key exports" table.

> **Closed 2026-10-25 (user's design, classified by hand).** `zibri` is the public API and every name
> on it has a Key exports row; everything else is on a new `zibri/internal` entry point
> (`package.json` export, built from `src/internal.ts`), which `releases.md` says any release can
> change and which zibri-testing imports from. The user's rule: public is what an application writes
> (extends, implements, decorates, injects, calls, catches) and every type a public signature reaches;
> internal is what only building a custom version of an extension point needs (a data source or
> driver's machinery, the parser, the router, a two-factor method, SCIM, the tracer, the error
> handler, decorator metadata, the container). By the user's decisions per batch: default
> implementations, self-registered cron jobs, `is…` guards and every error class are public; create
> data of entities only the framework writes is internal unless a public method takes it; writing a
> driver or a data source of your own is public, its helper kit internal; utilities are public unless
> they serve such a custom build. Three guards keep it so:
> - `docs-style.test.ts`, *lists every name the zibri entry point exports in the Key exports of some
>   page*: names read through the compiler, types included (`__testing__/entry-point.utilities.ts`).
>   Red with 1,041 names when written.
> - `entry-points.test.ts`: every name a file behind either barrel exports is on exactly one of them,
>   so a name added to a file split by named re-exports cannot fall through.
> - typedoc builds the reference from `src/index.ts` alone and treats validation warnings as errors
>   (`typedoc.json`, CI's `build:prod`): a type a public signature reaches has to be public, or be
>   listed in `intentionallyNotExported` (stored decorator metadata, the bases public types derive
>   from, type-level machinery). 196 such types were found; the user settled them in one batch.
>
> Found and fixed on the way: templates were meant to `import { createContext, provideContext,
> useContext } from 'zibri'`, but nothing declared the two hooks, so a template using a context did
> not typecheck (zibri-tsx exports them now; `templating.md` "Passing a value to nested components",
> red in `docs-examples.test.ts`). `StreamBodyParser` was a built-in parser nothing exported, so an
> application setting `bodyParsers` could not keep stream bodies (`stream.body-parser.test.ts`, red in
> the typecheck). Two pages linked into the generated reference by file path and pointed at nothing on
> a clean build (`backup.md`, `data-source.md`, now `{@link}`); `auth.md` still listed the removed
> `@UserRepo`; `Bytes`' JSDoc was copied from `Ms` and `MaskUtilities.mask` documented the wrong
> characters; `KnownHeader.IIF_MODIFIED_SINCE`. Six unused names were deleted, and the barrel's
> duplicate line and commented-out export went with the split. Filed from it: 01 §D21 (configurable
> repository hooks); 04 §A15 gained `API_KEY_PREFIX` and the OTP period. Closes 07 §T16 and 09 §Q10.
>
> **Follow-up 2026-10-26.** The split broke every cluster suite: the instance entry imports
> `initDiContainer` from `zibri/internal`, and `clusterModulePaths` handed an instance the parent's
> copy of `zibri` and `zibri-testing` only, so `zibri/internal` resolved through `node_modules` to the
> built package and the instance refused the second copy at boot (`DuplicateFrameworkCopyError`). It
> hands over `zibri/internal` as well now; `cluster-module-paths.test.ts` gained the case (red before).

### X21. Naming is consistent inside a subsystem and inconsistent across them — MAJOR
*Filed 2026-10-21.*

> **Closed 2026-10-25.** The user settled one rule per item; every rename is breaking and none keeps
> an alias.
> - Durations: every public duration ends in `InMs` (`_IN_MS` for tokens), every point in time in
>   `AtMs`, nothing leaves the unit out. The sweep was wider than the finding: about 55 public names,
>   such as `timeoutMs`, `openForMs`, `lockForMs`, `restartAfterMs`, the cache's `ttl`/`defaultTtl`,
>   thread jobs' and events' `timeout`, and the limiter state (`lastRefillAtMs`, `windowStartedAtMs`).
>   The server limits say what they limit: `requestTimeoutInMs`, `headersTimeoutInMs`,
>   `keepAliveTimeoutInMs`, `handlerTimeoutInMs`. pg's `connectTimeoutMS`, Valkey's `requestTimeout`
>   and WebAuthn's `timeout` are other specs' names and stay. The 2.x column `ThreadJobEntity.timeout`
>   is renamed to `timeoutInMs` by the upgrade migration; `catchUpWithinInMs` and
>   `nextReservationExpiresAtMs` are 3.x columns and change in it directly.
> - Page size: `findAll({ limit, offset })`, with `limit: 'all'`, the words of the http query and of
>   `findAllPaginated`/`findAllAfter`. The TypeORM driver translates to `take`/`skip` at its boundary.
> - Login: identifiers and prose say login/logout, `defaultAuth: 'isLoggedIn'` matches
>   `@Auth.isLoggedIn()`, and the `FederatedSignIn*`/`SignInOptions*` names, the `/login-options`
>   route and the two `login-through-a-*.md` pages follow. Account creation says registration
>   (`RegistrationAuthenticatorInterface`). "Sign in with Apple" and "single sign-on" stay.
> - Two-step flows say request/confirm, routes included: `requestLinkIdentity`/`confirmLinkIdentity`
>   (was `startConnection`/`completeConnection`), `requestProviderLogin`/`confirmProviderLogin`,
>   `requestRegistration`/`confirmRegistration`, `requestSecondFactorAtLogin`/
>   `confirmSecondFactorAtLogin` (was `completeLogin`), `requestSecondFactor`, `requestPayment`,
>   `requestSubscription`, and one spelling for 2FA registration (`requestTwoFactorRegistration`,
>   `removeTwoFactorRegistration`). `linkIdentity`, the step after a first login that has no request
>   before it, is `linkTicketIdentity`; FederatedIdentity's `signIn` flag is `forLogin`.
> - `@CurrentUser({ required: false, authStrategies })` replaces the positional boolean.
> - `MembershipService.findActiveMembership(s)`: the service leaves deactivated memberships out, the
>   repository's `findMembership` does not, and the names now say so.
> - Kept on purpose: the `allow*` flags (one prefix, one meaning: permit what is refused by default),
>   `@Cache`/`@Cached` and `@RateLimiter`/`@RateLimited` (declare/apply, the same pattern in both),
>   `AuthController({ strategies })`. `@UserRepo()` and its siblings were already gone.
>
> Tests: `entry-points.test.ts` walks every name the public signatures declare
> (`EntryPointUtilities.resolveMemberNames`) and fails on a duration or point in time without its
> unit and on `take`/`skip` in the data layer; red with 54 names when written. The other renames went
> red in the typecheck first (`@CurrentUser(false)` is an `@ts-expect-error` in
> `current-user.decorator.test.ts`). Found and fixed on the way: `configuration.md` had no
> `REPOSITORY_HOOKS` row (01 §D21); the upgrade guide's "Entra ID identities are known by the object
> id" described identities linked under 2.x, which has no federated login (removed); a JSDoc typo in
> `MailingListServiceInterface`.

Verified against the source, not the pages:

- Durations: 19 tokens end in `_IN_MS`, two in `_MS` (`LOGGER_FLUSH_INTERVAL_MS`,
  `LOGGER_CLEANUP_AFTER_MS`, `zibri-di-tokens.default.ts`). Options: `timeoutInMs` on routes,
  controllers and repository calls; `timeoutMs` on the http client (`http-client.interface.ts:58`);
  `connectTimeoutMS` on the postgres data source (`data-source.md:1793`, pg's spelling passed
  through); `shutdownTimeoutInMs`, `idleTimeoutInMs`, `statementTimeoutInMs`, `handlerInMs`,
  `requestInMs`, `headersInMs`, `keepAliveInMs` (`application-lifecycle.md:109-114` — the last
  four drop "timeout" entirely).
- Page size: `maxLimit` on `CrudController`, `take` on `findAll`, the positional `limit` on
  `findAllPaginated(page, limit)` and on `findAllAfter(cursor, 100)`.
- Marking a repository: `@UserRepo()`, `@RoleRepo()`, `@MembershipRepo()` (abbreviated) beside
  `@InjectRepository()` and `repositoryTokenFor()` (not).
- Auth strategies are `authStrategies` on the application and `strategies` on `AuthController`
  (`auth-routes.md:36`, `:44`); the posture is `defaultAuth: 'requireLogin'` while the decorator is
  `@Auth.isLoggedIn()`.
- Caching decorators: `@Cache`, `@Cached`, `@CacheWrite`, `@CacheDelete`, `@CacheInvalidate`
  (`index.ts:1089-1093`) — a reader cannot tell `@Cache` (declares a cache class) from `@Cached`
  (caches a method) by name. Rate limiting: `@RateLimiter` (declares) and `@RateLimited` (applies).
- `required: false` makes a property optional, `@CurrentUser(false)` makes the user optional, and
  `allowRedundant`, `allowOrphan`, `allowDuplicate`, `allowId` are four unrelated `allow*` flags.
- `findMembership(userId)` on the scaffold's repository versus
  `MembershipService.findMembership(userId, tenantId)` (`roles-and-permissions.md:309-310`): same
  verb, different arity, different meaning.
- `startConnection` / `linkIdentity` versus `requestPasswordReset` / `confirmPasswordReset` — the
  user's own todo (`after-all-findings-fixed.md:10`).

None of these is wrong on its own; together they mean a developer cannot guess a name they have
not read, which is what consistency is for.

**Verify:** `grep -o "[A-Z_]*_MS\b" zibri-di-tokens.default.ts | sort -u`; grep `timeoutMs` and
`timeoutInMs` across `src`.

### X22. What a controller cannot say, and what fails quietly — MINOR
*Filed 2026-10-21.*

> **Closed 2026-10-25 (user: types + send declared only).**
> - A response declared twice: the `@Response` decorators now compile only on a method that can
>   return what they declare (`ResponseDecorator<Declared>`, unions member-wise, `JsonResponse`
>   unwrapped; `response.decorator.test.ts`, red with six unused `@ts-expect-error`). It found a real
>   one: the metrics route declared `Metric[]` and returned `MetricsSnapshot[]`, now a class model.
>   Types cannot see extra properties (a stored row is assignable to a narrower class), so the router
>   writes a JSON response with what its declaration names, nested models, arrays, pages, relations and
>   the shape a oneOf names included; an object allowing additional properties, an `unknown` property,
>   a class declaring no property (`ScimBody`) and a route declaring no class are written as returned
>   (`DeclaredResponseUtilities`; `router-declared-response.test.ts`, red with the password hash, a
>   nested street and a oneOf's chip id in the body). It caught a test declaring one of the two
>   classes its route returns (`form-url-encoded.body-parser.test.ts`). The two-declarations-match
>   rule was already on the page (`creating-endpoints.md`, "Response statuses").
> - `@CurrentUser({ required: false })` under `defaultAuth: 'isLoggedIn'`: behavior kept (it says
>   what the handler is given, not who may call), the page says the route needs `@Auth.skip()`, and
>   `default-auth.test.ts` pins both cases.
> - `findAll` without `limit`: the runtime bound stays (user); most reads are bounded by their `where`.
> - `versions: ['^latest']`: raising the version reports every endpoint that supported only `latest`
>   (`versioning.md`), so a controller disappearing for old clients cannot ship unnoticed.
> - `OmitClass`/`IntersectionClass`: open as code-review 01 §Q4, not re-filed.

Declaring a CRUD controller is the strong part: one `@Property` per field feeds validation,
OpenAPI and storage; `CrudController(Test, CreateDTO, UpdateDTO)` gives five routes in one line;
`OmitClass`/`PickClass` work on controllers and models alike. What the walk-through hit:

- A response is declared twice, once as the TypeScript return type and once as
  `@Response.object(User)`; the page does not say what happens when they disagree, and "Declare two
  responses that could both describe the same value and neither is chosen"
  (`creating-endpoints.md:656-657`) does not say whether that is a boot error or a 500.
- `versions` defaults to `['^latest']` (`versioning.md:41`); a health or auth controller without
  `versions: 'all'` disappears for old clients on the next major, which the scaffold handles
  (`new.command.ts:367`, `:440`) and the page on versioning mentions only through the record check.
- `@CurrentUser()` without `@Auth.isLoggedIn()` answers 401 on its own (`:371`) — good — but
  `@CurrentUser(false)` beside `defaultAuth: 'requireLogin'` still refuses anonymous callers unless
  `@Auth.skip()` is added, which the article example (`:349-369`) does not show.
- `findAll()` with no `take` throws at the ten-thousandth row at runtime (`data-source.md:477`);
  the type does not require a `take`.
- An `OmitClass` of a controller carries routes but `instanceof` is false (01 §Q4), and
  `IntersectionClass` of two controllers can register a route twice; `models.md:247-280` shows the
  happy path only.

**Verify:** read `creating-endpoints.md:640-662` and look for the failure mode.

### X23. Testing: the best part of the DX, with two rough edges — MINOR
*Filed 2026-10-21.*

> **Closed 2026-10-25 (user: createJestConfig helper).** The jose transform had already moved from
> every project into the shipped preset; what was left is that a project's own ES-module-only package
> meant restating the preset's `transformIgnorePatterns`, jose included, since jest replaces that
> array. `zibri-testing/jest-config` exports `createJestConfig({ rootDir, esmPackages, ...jest })`,
> which the preset is built from; `zi new` and the sandbox call it (`create-jest-config.test.ts`, red
> without the function; `new.command.test.ts` "takes its test configuration from zibri-testing"; the
> sandbox's own suites ran green under it). `testing.md` opens with the first test, says why both
> hooks get 30 seconds, and explains the three option modules after it.

`startTestServer({ application: testApplicationOptions })` with an in-process data source and the
scaffold's first test (`new.command.ts:754-787`) is a better starting point than any framework in
the comparison set gives out of the box, and `testing.md:166-200` ("the call first, then the
application, then the harness's own default") is clear. Rough edges: the generated `jest.config.mjs`
carries a transform that compiles `node_modules/jose` through ts-jest because the default auth
strategy loads an ESM-only package (`:1021-1025`) — a hack every project inherits and will meet
again for the next ESM-only dependency; both lifecycle hooks carry a 30 s timeout the page does
not explain; and `testing.md:61-141` spends eighty lines on why the options are split across three
files before the first test.

**Verify:** scaffold, `npm test`.

### X24. Email: the main path shows the template system the scaffold does not use — MINOR
*Filed 2026-10-21.*

> **Closed 2026-10-23 with the structure pass.** `email.md`'s main path renders a tsx email
> (`TaskAssignedEmail` in `src/templates/emails`) with `TsxUtilities.renderEmail` and queues it; the
> `.hbs` path is one sentence linking `templating.md#rendering-a-handlebars-template`, which owns it.
> Found on the way: `defaultSender: 'Test Test'` was no address although `Email.sender` is
> `format: 'email'`, and the `defaultSender` and `maxEmailsPerHour` rows said neither a default nor
> "Required" while both are required (`email-config.model.ts:64,69`).

Sending the first mail: two required providers (X17), then `emailService.queue({...})` — good —
but the only example renders `.hbs` templates with webpack-loader imports (`email.md:96-119`),
while the project just scaffolded has tsx emails (`password-reset.tsx`) and the framework's
`TsxUtilities.renderEmail` is on no page. A developer with the scaffold open and the page open sees
two systems and no bridge; the Handlebars explanation is then repeated on `templating.md:335-350`.

**Verify:** `grep -n renderEmail docs/*.md` — nothing.

### X25. Deployment and configuration — MINOR
*Filed 2026-10-21.*

> **Closed 2026-10-26 (user: a framework environment option).** `SmtpEmailTransport` refuses an empty
> host and a port outside 1-65535 when it is built (`smtp.email-transport.test.ts`, red for four
> cases). So that a new project still runs before it has a mail server, the application options take
> a required `environment: 'development' | 'production'` (`ZibriEnvironment`, checked at startup,
> `GlobalRegistry.getAppData('environment')`): in development an application without a transport
> gets a `LoggingEmailTransport`, which logs each mail with its links; in production it does not
> start (`email.service.environment.test.ts`, red for development and an unknown value). The
> scaffold reads a required `ENVIRONMENT` (`requireOneOfEnv`), `development` in `.env` and blank in
> `.env.example`, so a deployment copying the example has to choose; its providers log in
> development and build the SMTP transport in production; the CI workflow and the docker heavy test
> set it. `getting-started.md` now says the `versions` folder is committed. The schema half of the
> finding stays with 07 Part 2.

The Dockerfile is good (multi-stage, `npm prune`, non-root, exec-form `CMD`, a `HEALTHCHECK` that
needs nothing installed, `new.command.ts:819-876`) and `deployment.md` describes it in the right
voice. Residue: configuration is a hand-written `env.ts` with `requireEnv`/`optionalEnv`/
`requireBooleanEnv` (`:943-1006`) — `optionalEnv` answers `''` for a missing variable, so
`Number(optionalEnv('SMTP_PORT'))` in `providers.ts:522` is `0` when unset and the transport is
constructed with port 0 rather than refused; the schema half is the already-filed 07 Part 2 bullet.
`versions/` must be committed and writable by the running user, which `deployment.md:28-33` says
and `getting-started.md` does not.

**Verify:** read `env.ts` as generated; unset `SMTP_PORT`, boot, send a mail.

### X26. No `llms.txt` — MINOR
*Filed 2026-10-23.*

> **Closed 2026-10-26.** `build:prod` runs `scripts/llms-txt.mjs` after typedoc, which writes
> `llms.txt` (every page in the site's order with its title, address and the first sentence of its
> intro) and `llms-full.txt` (every page whole) into `docs/generated`, the published site's root;
> the README points an assistant at both. Test: `ci-workflows.test.ts` "the docs build", red without
> the script.

`DOCS_STYLE.md` writes the pages for a developer and for the assistant that developer asks. The
docs build (`typedoc.json`) emits HTML only. An assistant asked about Zibri has no index of the pages
to start from, and no single file holding them all, which is what `llms.txt` and `llms-full.txt`
give it and what a growing number of frameworks publish next to their docs site.

**Verify:** `npm run build:prod -w zibri` and look for `llms.txt` in `docs/generated/`.

---

## Already filed

- 07 Part 2 (open): no page on log aggregation or metric label cardinality; nothing validates a
  configuration variable beyond it being present (X25 touches it); no runbook gathering what to do
  when a cron job stopped on error, a backup was refused, a restore could not be undone, an event
  failed, or a lease is held by an instance that is gone. All three still open; not re-filed.
- Round-2 01 §D6 (repository wrapper keeps only the driver) — the documentation half is in Part 1.
- Round-2 01 §D3 (`allowId` and existing ids), 01 §Q4 (`OmitClass`/`PickClass`/`IntersectionClass`
  `instanceof` and duplicated routes) — referenced in X22, not re-filed.
- Round-2 02 §S6, §S9, §S18 — referenced in Part 1 rows on valkey backups, valkey standalone and
  `.zibri/backups`.
- Round-2 03 §H12 (SSE undocumented), §H19 (header parameter case) — referenced in Part 1.
- Round-2 07 §T3, §T4 (the two `di.md` examples), §T16 (mutable singletons on the barrel) —
  referenced in Part 1 and X20.
- 05 §M6 `exactOptionalPropertyTypes` — the `required: false` / `| null` / `| undefined` typing
  pattern every model shows (`models.md:31-34`, `:80-83`) is its visible side; not re-filed.
- `after-all-findings-fixed.md:3` — this chapter is its evaluation; bullet 10 (`startConnection`
  rename) is X21's last item.

## Not reviewed

- `upgrading-to-3.md` beyond its section structure (758 lines; 06/01 own its migration).
- The generated typedoc site (`docs/generated/`, git-ignored) and whether JSDoc on exported
  symbols follows CODE_STYLE's "never names a finding" rule — one instance found by accident
  (`membership-repo.decorator.ts:20`); a systematic pass over published JSDoc is open.
- `packages/tsx/README.md` and the `zibri-tsx` compiler's user-facing error messages.
- Running `zi new` (no installs in this pass); the scaffold is read from its generator and from
  `packages/sandbox`, which the parity test holds equal to it.
- Whether every "Key exports" table is complete against the barrel — spot-checked on ten pages
  (Part 1), not all 54.
- The websocket, SCIM, SAML, LDAP and passkey walk-throughs as a developer (read for voice only).
