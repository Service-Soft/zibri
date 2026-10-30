# DI, metadata, packaging, build, CI, CLI, testing framework, TSX compiler — code review

Extracted from the evaluation chapter [07-di-packaging-tooling.md](../07-di-packaging-tooling.md);
`T1`–`T15` refer to its findings, and the items below keep their `T16`–`T20` ids. These are shape,
duplication and style, with the evaluation's severity scale.
Cross-cutting: [09-architecture-and-code-quality.md](./09-architecture-and-code-quality.md).

### T16. The barrel publishes the container's internals under a semver promise — MINOR
*Filed 2026-10-21.*

`docs/releases.md:4-14` says the public API is "what you can import from a package's entry points".
`src/index.ts` exports `DiContainer` (`:380`), `initDiContainer` (`:382`), `GlobalRegistry` (`:502`,
whose `injectables`, `lazyInjectables` and `entityClasses` are public mutable arrays,
`global-registry.ts:63-71`), `AlsUtilities` (`:440`), `InternalError` (`:456`) and
`MetadataUtilities` (`:1134`), among 969 export lines. `GlobalRegistry.isAppStarted()` is genuinely
public (`docs/deployment.md:92` uses it); the arrays and the container's `register`/`unregister`/
`reset` are not documented anywhere and are what `zibri-testing` reaches for. Either the barrel is
curated (an `internal` subpath for the harness) or the semver page is narrowed to the documented
exports; today every refactor of the container is a breaking change by the project's own definition.

> **Closed 2026-10-25 with 08 §X20.** The curated barrel: `DiContainer`, `initDiContainer` and the
> registration internals are on `zibri/internal`; `GlobalRegistry` stays public, with its row.

### T17. `getRegisteredProviders` dedupes by `useValue` identity with `??`, so two value providers sharing a primitive collapse — MINOR, latent
*Filed 2026-10-21.*

`di-container.ts:169-182` builds the identity as `useClass ?? useFactory ?? useValue ?? token`.
For a value provider the value itself is the identity, so two tokens with `useValue: 0`, `false` or
the same string are one entry in `getAllRegisteredTokens()`. Today the defaults have one such
primitive (`BACKUP_SHUTDOWN_WAIT_IN_MS: { useValue: 0 }`, `zibri-di-providers.default.ts:237`) and
the only readers inject what they get back, so nothing observable breaks. It is a trap for the next
reader of that list; the identity of a value provider should be its token. Beside it:
`isRegistered`'s JSDoc says "True when injecting it would find something" (`:123-134`) while it reads
only `providers`, not the global record `resolveProvider` falls back to (`:256-279`).

> **Closed 2026-10-29.** The identity of a provider is its class, its factory, or its token: a value
> never. `isRegistered`'s JSDoc says what it reads, a registered provider, and that a globally
> declared injectable not registered yet is not counted although `inject` finds it. Tests, red first,
> in `di-container.test.ts`: two value providers worth `0` are both listed (one was), and a class
> under two tokens is listed once.

### T18. The `@Injectable` decorator writes a `register` property onto stored provider objects as a side channel — MINOR
*Filed 2026-10-21.*

`findExistingProvider` casts a `DiProvider` to `FoundProvider` and assigns `register` onto it
(`di/decorators/injectable.decorator.ts:79-94`) so the caller can compare it. The property is not
part of `DiProvider`, lives on the object the container later registers, and exists only because the
two arrays are the record of which one a provider is in. CODE_STYLE's "`as SomeType` means the model
is wrong" applies: the provider should carry its registration mode, or the lookup should return
which array it came from.

> **Closed 2026-10-29.** `findExistingProvider` answers `{ provider, register }`, the record it was
> found in, and writes nothing onto the stored provider. One cast stays, narrowing a provider of the
> record to the class it was found by, and says so. `di-container.test.ts` and the decorator's
> conflict cases hold the behavior.

### T19. `new.command.ts` generates a project out of string arrays, which is why three suites exist to parse, compare and run what it writes — MINOR
*Filed 2026-10-21.*

1,642 lines (working tree), most of them `'    "module": "NodeNext",'`-style lines
(`new.command.ts:1564-1570` and the whole of the Dockerfile, workflow, env, tsconfig, jest config and
webpack config). 06 §C4 found a missing comma shipping for the lifetime of the scaffold and added a
syntax check; §C5 replaced a snapshot with a generator run; the parity suite diffs against the
sandbox. All three compensate for the same thing: generated files that exist only as string arrays
until a project is made. The 52 `.tsx.tpl` files show the other way already in use. Moving every
generated file to a template with placeholders makes the files readable, lintable and diffable in the
repository, and shrinks the command to the questions and the installs. This is also the precondition
for T5's `zi upgrade`.

> **Closed 2026-10-29 (user's decision: template files).** Every file `zi new` wrote from string
> arrays is a template in `packages/cli/project/`. That folder is a copy of a generated project, with
> each file ending in `.tpl`, so the compiler, the test runner, the linter and npm leave it alone.
> `assets/` was not the place, since it is copied whole into every project's `assets/`.
> `ProjectTemplateUtilities` renders them:
> - `{{name}}` takes a value;
> - `{{#flag}}…{{/flag}}` and `{{^flag}}…{{/flag}}` are sections, by feature and by `defaultAuth`;
> - `{{! … }}` holds the reasons that were `//` comments beside the arrays;
> - a name or flag the command does not pass fails the generation instead of being written.
>
> `new.command.ts` keeps the questions, the installs and which files a project gets, and goes from
> 1457 to 226 lines. `.env` is rendered from the same template as `.env.example`, so the variable list
> has one source, and the workflow reads its secrets from it. `zi upgrade` regenerates through the same
> `generateFiles`, so it reads the same templates. The test helper's hand-kept list of 48 files is now
> a listing of the template folder.
>
> No output changed. The 163 in-memory scaffold tests stay green, and the sandbox parity suite holds
> byte for byte, `recorded-sandbox-diffs.json` unchanged. The other answer combinations are held by
> `new.command.test.ts`'s behavior cases. `project-template.utilities.test.ts` (new, 5) covers the
> sections, the comments and both refusals. The heavy and docker suites are the user's to run.

### T20. The sandbox is the scaffold plus demonstrations, not a reference application — MINOR
*Filed 2026-10-21.*

`packages/sandbox` depends on `zibri: "*"` and `zibri-testing: "*"` (`package.json:31,50`), keeps
`ts-node` in `dependencies` (`:30`), has an empty `description`, `schemaManagement: 'synchronize'`
(`src/data-sources/db/db.data-source.ts:14`) and `defaultAuth: 'public'` (06 §C8, chosen). Its
job in this repository is parity with `zi new` and a place to click through features, and it does
that. What an adopter looking for "what a real Zibri app looks like" does not find is an example with
a domain, migrations in use, service layering, a tenant-aware entity and a test per layer — the
things `docs/` describe one at a time. Worth saying in the sandbox's README so it is not read as the
reference it is not.

> **Closed 2026-10-29 (user's decision: say so in its README).** `packages/sandbox/README.md` (new)
> says what the sandbox is: the files `zi new` writes, held to them by the parity suite, and a place
> to click through features. It says what it is not: no migrations, `defaultAuth: 'public'`,
> demonstrations side by side rather than a domain in layers. It points to `getting-started.md`, and
> the root README's line says the same. `package.json`'s empty description stays: the parity suite
> compares it with what `zi new` writes.
