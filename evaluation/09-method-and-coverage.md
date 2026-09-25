# Method, Verification Status and Coverage Gaps

Being explicit about what was actually checked, so the report can be trusted where it is strong and
discounted where it is thin.

---

## Method

The review was split into six parallel passes over the working tree (branch `v3`, 2026-08-04):

| Pass | Scope | Outcome |
|---|---|---|
| Data layer | `src/data-source/**`, `src/change-sets/**`, `src/entity/**`, backups | Done directly by me |
| HTTP / runtime core | bootstrap, routing, parsing, middleware, errors, lifecycle, websockets | Completed (delegated) |
| Auth & security | `src/auth/**`, `src/rate-limiting/**`, `src/http/**`, error handling | Completed (delegated) |
| Infrastructure subsystems | cron, events, mail, cache, metrics, logging, threads, HTTP client, plugins | Completed (delegated) |
| DI, metadata, packaging | `src/di/**`, decorators, tsconfig, dual build, peer deps | **Terminated early** — completed directly by me |
| Docs, DX, CLI, TSX compiler | `docs/**`, `packages/cli`, `packages/tsx`, CI/CD, testing | **Terminated early** — completed directly by me |

Every finding cites `path:line`. Delegated findings were required to quote or paraphrase real code
rather than reason from names.

---

## Verified during synthesis

The following were re-read directly rather than accepted from a delegated pass. All matched the
reported code exactly:

| Finding | File |
|---|---|
| Multi-tier tag invalidation is a no-op | `src/caching/cache.service.ts:85-91` |
| Prometheus label uses `req.originalUrl` | `src/metrics/metrics.service.ts:103-126` |
| CORS hardcoded to `*`, no `PATCH`, `OPTIONS` short-circuit | `src/http/cors.middleware.ts:11-19` |
| TOTP `validate` ignores `confirmed`; enrollments accumulate | `src/auth/2fa/methods/otp/otp.two-factor-method.ts:43-85` |

The entire data-layer file ([01](./01-data-layer.md)) is first-hand: I read `repository.ts`,
`data-source.interface.ts`, `typeorm-base-data-source.model.ts`,
`postgres-typeorm-data-source.model.ts`, `val-key-data-source.model.ts`,
`postgres-typeorm-where-filter.converter.ts`, `typeorm.repository-driver.ts`,
`transaction.model.ts`, `typeorm-transaction.model.ts`, `migration.model.ts`,
`run-migrations.function.ts`, `change-set-repository.ts`, `soft-delete-repository.ts`,
`change-set.model.ts`, `entity.decorator.ts`, `property.decorator.ts`,
`base-entity.model.ts`, `string-property-metadata.model.ts`, `where-filter.model.ts` and
`docs/data-source.md`.

[05](./05-di-metadata-and-packaging.md) and [06](./06-tooling-ci-and-testing.md) are first-hand:
`di-container.ts`, `tsconfig.base.json`, `post-build.mjs`, all three `package.json` files,
`start-test-server.function.ts`, `docs/di.md`, `ci.yml`, `cd.yml`,
`packages/tsx/src/parser/type-erasure.ts`.

---

## Reported but not independently re-verified

Findings in [02](./02-http-runtime-core.md), [03](./03-auth-and-security.md) and
[04](./04-infrastructure-subsystems.md) other than those listed above come from delegated passes
with line-level citations. Given that four spot-checks matched exactly, I consider them reliable —
but before acting on any individual item, re-read the cited lines. The ones I would check first,
because they are the most consequential and the most surprising:

1. `src/error-handling/error-handler.ts:31-33` — `globalError.stack = undefined` (every 5xx logs
   with an empty stack).
2. `src/parsing/form-data/form-data-body-parser-cleanup.cron-job.ts:38, 60-65` — the inverted
   cleanup predicate and the double path join. The claimed corroborating evidence is 382 leaked
   directories in `src/di/default/temp/`; that is trivially checkable and would settle it.
3. `src/multithreading/services/multithreading.service.ts:337-340` — the descending sort causing
   LIFO starvation. A one-character finding, worth confirming.
4. `src/routing/router.ts:465` — `new HttpRequestContext(request, res, undefined, undefined)` being
   the only non-test call site. The claim is that this makes `HAS_2FA` return `false`
   unconditionally, which is severe enough to warrant a test.
5. `src/plugin/invoicing/services/invoice-number.service.ts:99-120` — the invoice-numbering race.

---

## Not reviewed at all

These were in scope for the two terminated passes and I covered them only partially or not at all.
They are gaps in the report, not clean bills of health.

### DI internals

Covered: the container, resolution algorithm, scope model, packaging.
**Not covered:**

- Behaviour with two copies of `zibri` in `node_modules` (asserted as a risk, not tested).
- The metadata registry's behavior with duplicate class names — `@Entity` keys off the class
  reference, but `tableName` defaults to `toSnakeCase(target.name)`, so two classes named `User` in
  different modules collide on table name. Untested.
- `MetadataUtilities` prototype-chain walking and inheritance semantics for `OmitClass`,
  `PickClass`, `PartialClass`, `IntersectionClass` — the README's headline DX feature, entirely
  unreviewed.
- Whether the DI container's `lazyInjectables` promotion (`di-container.ts:127-132`) is safe under
  concurrent first-resolution.

### The TSX compiler (`packages/tsx`)

Covered: packaging, export conditions, the structural risk of a hand-written compiler, one
representative module (`type-erasure.ts`).
**Not covered:**

- What TypeScript/JSX syntax the lexer and parser actually reject, and whether rejection is a clear
  diagnostic or a silent miscompile. This is *the* question for adoption risk and it needs a
  fuzzing pass or a syntax-matrix test, not a read-through.
- Source-map fidelity of the generated output.
- The webpack plugin, the client-bundle/vendor splitting, and the `?client` marker semantics.
- The MJML parity layer (`src/email/**`) — whether `mjml-parity.test.ts` covers enough of MJML's
  behavior to be trusted.
- Total LOC of the hand-written compiler, which I chose not to spend context measuring.

### The Handlebars type-inference parser

`packages/zibri/src/handlebars/**` — not read. Flagged in
[06](./06-tooling-ci-and-testing.md) §X3 as carrying the same structural risk as the TSX compiler,
by analogy rather than by inspection.

### The CLI (`packages/cli`)

Covered: package metadata, dependencies, CI wiring, the "accepted sandbox differences" approach at
a conceptual level.
**Not covered:**

- What `zi new` actually generates — specifically whether the scaffold ships `synchronize: false`,
  a Dockerfile, a health endpoint, environment-based configuration, and a test setup. Given
  [01](./01-data-layer.md) §C1, the `synchronize` default in the template is the single most
  important thing to check here.
- The upgrade path for an already-generated project.
- The 40+ `.tsx.tpl` templates.

### Plugins

`src/plugin/**` — only the invoicing number service and the PayPal client were touched, both
incidentally. The mailing-list and payment plugins are essentially unreviewed.

### Other

- `src/document/**` (PDF generation), `src/localization/**` (XLIFF extraction), `src/assets/**`
  beyond the caching-header observation, and `src/validation/**` beyond the regex recompilation.
- No dynamic verification of any kind: nothing was executed, no test was run, no build was
  performed, no profiler or load generator was used. Every performance claim is a reading of the
  code, not a measurement.
- The `packages/sandbox` app was used only to confirm that `CrudController` exists.

---

## Suggested next passes

In priority order, if this review is continued:

1. **The TSX compiler syntax matrix** — the largest unquantified risk in the repository.
2. **What `zi new` generates** — cheap to check, and it determines whether every new Zibri project
   starts with `synchronize: true`.
3. **`OmitClass` / `PickClass` / `IntersectionClass` semantics** — a headline feature that no pass
   examined, sitting on top of a metadata system with known inheritance complexity.
4. **A dynamic pass**: boot two replicas against one Postgres and observe the cron, event and mail
   duplication predicted in [04](./04-infrastructure-subsystems.md). Turning those from
   code-reading into reproductions would make the central argument of this review incontestable.
