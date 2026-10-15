# Dependency Injection, Metadata Model and Packaging

All paths relative to `packages/zibri/` unless stated otherwise.

> This area's delegated pass was terminated early by a session limit. The findings below are my
> own direct review of `src/di/di-container.ts`, `tsconfig.base.json`, `package.json`,
> `post-build.mjs` and `docs/di.md`. The DI internals I did **not** cover are listed in
> [09-method-and-coverage.md](./09-method-and-coverage.md).

---

## D. Dependency injection container

### D1. A circular dependency is a stack overflow, not a diagnostic — ~~MAJOR~~ **FIXED**

> **The finding is right that `resolvingStack` was never checked, and wrong that checking it would
> have been enough.** That array was threaded through one call chain, and construction leaves the
> chain: `inject()` called inside a `useFactory` starts a *fresh* stack, losing every frame above it.
> A cycle running through two factories - which is what the test that holds this uses, because two
> classes referring to each other in one module hit the TDZ on the emitted parameter metadata before
> the container is ever asked - was invisible to it. Adding `includes` to the parameter would have
> caught constructor cycles only, and looked like a fix.
>
> So the stack moved onto the container, where it brackets the whole synchronous construction rather
> than one path through it, and the parameter is gone. `NoProviderError` reads the same array, so its
> trail now spans factory boundaries too. **The invariant that makes one array enough is that
> providers are synchronous** - a factory that could `await` would leave its frame across a turn of
> the event loop, and an unrelated request for that token would be reported as a cycle. That is
> written where whoever closes [D6](#d6-no-async-providers--major) will find it.
>
> A cycle now names its participants by *token* rather than by function, since a factory is usually an
> anonymous arrow whose `name` is the property it was written under:
> `Circular dependency: InvoiceService -> PdfService -> InvoiceService`, followed by the way out.
>
> Two things fixed on the way, both in lines this touched: the pop ran even for a `useValue` provider
> that had pushed nothing, taking the caller's frame instead, and a construction that threw left its
> frame behind - which, with a cycle check in place, would have made the next honest attempt at the
> same class look like a cycle. It is a `finally` now.

`src/di/di-container.ts:120-161`

```ts
inject<T>(token: DiToken<T>, resolvingStack: Function[] = []): T {
    if (this.instances.has(token)) { return this.instances.get(token) as T; }
    ...
    if (provider.useClass || provider.useFactory) {
        resolvingStack.push(provider.useClass ?? provider.useFactory);
    }
    const instance: T = this.createInstanceFromProvider(provider, resolvingStack);
    resolvingStack.pop();
```

`resolvingStack` is maintained but **never checked for cycles** — it is used only to decorate a
`NoProviderError` message (`:135`). The instance is cached only *after* construction (`:152-158`),
so with `A → B → A`, `inject(A)` recurses into `inject(B)` which recurses into `inject(A)`, which
still misses the cache.

**Failure:** `RangeError: Maximum call stack size exceeded`, with a stack trace consisting entirely
of `inject` / `createInstanceFromProvider` frames and no indication of which two classes form the
cycle. `README.md:104-108` claims Zibri "handles even complex cases like giving you the specifics
on *why* a dependency injection failed" — the single most common DI failure produces the least
useful possible diagnostic.

### D2. Singleton-only — there is no request scope — ~~MAJOR~~ **FIXED**

> **`cache: boolean` and the new scope were the same setting spelled twice**, so they became one:
> `scope: 'application' | 'request' | 'transient'`, where `'transient'` is what `cache: false` used
> to say. Three providers in the framework's own defaults were the only callers.
>
> A request scoped value is kept on the request context rather than in the container. That is the
> object whose lifetime it shares — created per request, entered while the request is handled,
> dropped with it — so nothing has to remember to clear anything, and there is no second store to
> keep in step with the first.
>
> Two things make the scope safe rather than a new way to leak:
>
> - asking for one where no request bounds its life is an `OutsideRequestScopeError`, instead of a
>   value that then lives forever;
> - building one into something longer lived is a `CapturedRequestScopeError`. This is the failure
>   the scope exists to prevent — a service constructed once would answer every later request with
>   the first one's user or tenant, silently and as the wrong answer rather than as an error. The
>   check reads the *outermost* frame being constructed, not the nearest one, because that is what
>   decides how long everything under it is kept.
>
> `getAllRegisteredTokens()` leaves request scoped tokens out. Every caller injects what it gets
> back, and a request scoped provider outside a request throws — so listing one would have turned
> the startup lifecycle sweep into a failed boot. Transient tokens stay in, since they build a value
> at startup as readily as anywhere else.
>
> The stack the container keeps while constructing now holds providers rather than bare functions,
> which is what lets it read a holder's scope. `nameOf` went with it: a provider knows its own token,
> so nothing has to search the registrations to name what failed.
>
> `docs/di.md` gained the scope table, both errors and the way out of the second, and
> `register: 'onUse'` is documented for the first time.

`src/di/di-container.ts:26` — `private readonly instances: Map<DiToken<unknown>, unknown>` caches
for the process lifetime. `provider.cache !== false` (`:152, :156`) gives an effectively transient
mode, and that is the entire scope model. There is no request, session, or tenant scope.

Consequences:

- A service that needs the current user, tenant, or correlation id cannot be constructed per
  request. Every such service must reach into `AlsUtilities.getCurrentRequestContext()` at call
  time — which is exactly what `ChangeSetRepository.getCreatedBy`
  (`src/change-sets/change-set-repository.ts:453-464`) does, on every write.
- Multi-tenancy cannot be expressed through DI at all: no tenant-scoped repository, no
  tenant-scoped connection.
- `docs/di.md` (126 lines) never mentions scopes. `@Injectable({ register: 'onUse' })` is used in
  the framework's own code (`src/data-source/data-source.service.ts:18`) and is undocumented.

### D3. Providers silently overwrite each other — ~~MAJOR~~ **FIXED, not as written**

> **The fix the finding asks for would break the framework's own configuration mechanism.** Making
> `register` throw on a duplicate token outlaws overriding a default — which is what the whole
> Configuration section of `docs/di.md` is about — and outlaws `[...sharedProviders, myOverride]`,
> an idiom this repository uses in 29 of its own test files. A providers array is read front to back
> and the last entry wins; that is not a silent overwrite, it is a decision written down in one place
> where the next reader can see it.
>
> **What has no decision behind it is two plugins claiming one token.** Neither author wrote the list
> their providers end up in, and the winner is decided by `createFullOptions`, which prepends each
> plugin's providers as it walks `plugins` — so the plugin listed *first* wins, an ordering nobody
> chose as precedence and no plugin can observe. That is now a `ProviderCollisionError` thrown from
> the `ZibriApplication` constructor, before anything is registered at all.
>
> The exception is the application naming the token itself: its own array is registered after every
> plugin, so it has already said which implementation it wants and neither plugin wins. The check
> lives where the composition happens rather than in the container, because intent is only visible
> there — the container is handed providers with no idea who wrote them.
>
> The false `@throws When the provider is invalid` on `DiContainer.register` is replaced by what it
> actually does, and the precedence order is now written down in `docs/di.md`.

`src/di/di-container.ts:100-102`

```ts
register<T>(provider: DiProvider<T>): void {
    this.providers.set(provider.token, provider);
}
```

Last registration wins, with no duplicate detection and no warning — and registration order is
import-order dependent because decorators push into `GlobalRegistry` at module load. A plugin that
registers a provider for a token the application also configures silently replaces it (or is
silently replaced), with nothing to observe.

The JSDoc says `@throws When the provider is invalid`. It never throws.

### D4. `unregister` does not evict instances, and its JSDoc is false — ~~MAJOR~~ **FIXED**

> `DiContainer.unregister` now deletes the cached instance along with the provider, and the entry
> keyed by the provider's class with it — that one exists only as an alias of this provider's
> instance, so leaving it behind would let `inject(TheClass)` keep answering with a value whose
> provider is gone. `inject` reads the instance cache before it looks at a provider at all, which is
> why deleting the provider alone was a no-op for anything already constructed.
>
> Nothing is torn down on the way out, and the JSDoc now says so: the exported `unregister` is
> reachable only before the application is initialized, so no lifecycle hook has run against what is
> being dropped.
>
> **Half of the finding was reading the wrong file.** The documented throw does exist — in
> `unregister.function.ts:12`, which is the public API and refuses to run once the app is
> initialized or started. What was false is the container method's own JSDoc, which had copied the
> `@throws` from its caller. That line is gone.

`src/di/di-container.ts:104-111`

```ts
/**
 * @throws When the app is initialized or started.
 */
unregister<T>(token: DiToken<T>): void {
    this.providers.delete(token);
}
```

The documented throw does not exist, and `this.instances` is not touched — so anything already
constructed under that token stays live and injectable forever. Unregistering after first use is a
no-op with a misleading contract.

### D5. Constructor injection is `design:paramtypes`-based, with a useless failure message — ~~MAJOR~~ **FIXED**

> A parameter the metadata lost now raises an `UninjectableParameterError` that names the class, the
> position, what was recorded, and the file the class was declared in — plus the two things that
> produce it and the way out of each.
>
> **`Object` was the larger half, and it was not reaching the error at all.** A built-in in
> `design:paramtypes` used to be injected like any other token, so the reader was told there is no
> provider for `Object` — a token they never wrote, about a class the message does not name. The
> container now recognises the set TypeScript falls back to (`Object`, `String`, `Number`, `Boolean`,
> `Array`, `Function`, `Symbol`, `Promise`) and stops there instead of asking for it. Nothing that
> resolved before stops resolving: none of those was ever registered, so every case this catches was
> already a failure, only a differently worded one.
>
> **The two causes need different remedies, which is why the message distinguishes them.** A
> recorded built-in means the type was never a class — an interface, a union, a generic, a primitive
> — or that two modules import each other and the class is not defined yet where the decorator runs;
> either way the fix is `@Inject(token)` or breaking the cycle. Nothing recorded at all means there
> is no metadata to read, which is what a missing `emitDecoratorMetadata` looks like from inside the
> container, and used to surface as the literal string `Could not find token`.
>
> Detecting the cycle case apart from the interface case is not possible here — TypeScript emits
> `Object` for both, so by the time the container reads the metadata the two are the same value.
> The message names both rather than guessing.
>
> **The "nothing was recorded" branch was unreachable, which [§M1](#m1-legacy-decorators-plus-emitdecoratormetadata-locks-consumers-to-tsc--major-fixed)
> found by building an application with a toolchain that records nothing.** The parameter count was
> read off the metadata too, so a build with none had zero parameters to resolve and the class was
> constructed with no arguments rather than refused. Fourth round running where the mechanism existed
> and was applied to nothing.

`src/di/di-container.ts:175-194`

```ts
const explicitTokens = MetadataUtilities.getInjectParamTokens(provide);
const paramTypes = MetadataUtilities.getParamTypes(provide);
...
const token = explicitTokens[idx] ?? paramTypes[idx];
if (token === undefined) { throw new InternalError('Could not find token'); }
```

`paramTypes` comes from `emitDecoratorMetadata`. TypeScript emits `Object` for an interface, a
union, a generic, or a type-only import — so those resolve to a `NoProviderError` for `Object`, and
a missing entry produces the literal message `'Could not find token'` with no class name, no
parameter index, and no file. `docs/di.md:45` demonstrates exactly this untagged constructor
injection style.

### D6. No async providers — ~~MAJOR~~ **FIXED**

> `useAsyncFactory` is awaited once, during initialization, and what it resolved to is cached like
> any other value — so a connection, a vault secret or a warmed cache is a provider now, and
> `inject()` stays synchronous everywhere else.
>
> **The design took four rejected attempts, and the reason is worth keeping.** `inject()` is
> synchronous, so any await must already have happened by the time it is called; the container must
> therefore await asynchronous providers before *any* consumer code runs, including other providers'
> factories; to do that it must know the order among them beforehand; and a factory body is opaque
> to it. **So the ordering information has to exist outside the bodies** — there is no third option,
> which is why Nest and Angular both landed on a declaration and Inversify on a second resolve
> function.
>
> What is *not* opaque is a class: constructor parameters and field initializers are read today, so
> a class never declares anything. Only a factory does, with `deps`, and only for what it reaches.
>
> **`inject()` inside a `useAsyncFactory` is refused outright rather than allowed to work by
> accident.** Half-measures were rejected for a good reason: a factory that reaches an already
> resolved value *works*, and is one reordering away from not working — indistinguishable, at the
> call site, from one that is correct. Refusing all of them is what makes the rule unambiguous, and
> it costs nothing in coverage: a factory body always runs while the application initializes, so the
> call is found at the first boot rather than the first time some branch is taken. Only a
> conditional branch inside a body can still hide, and it fails at the next boot that takes it.
>
> The refusal has to hold **after** the factory's awaits too, which is what the async local storage
> mark in `AlsUtilities` is for: a flag set around the call is already cleared by the line after the
> first `await`, and that line is precisely where the order-dependent case lives. `inject()` reads a
> counter before it asks the store anything, so the framework's hottest call pays nothing for this
> once initialization is over.
>
> **Asynchrony is declared, not sniffed.** `useFactory` returning a promise provides the promise —
> that works today and keeps working; only `useAsyncFactory` is waited for. Which also means the
> container knows a provider is unresolved without calling it, so the error path never opens a
> connection it then throws away.
>
> **What the finding also claims is not closed.** The parallel lifecycle (`init`, `beforeAppInit`,
> `onAppInit`, `afterAppInit`, `onAppStart`) still exists and still does more than construction
> ordering. What has changed is that async initialization no longer *has* to go through it.

`inject()` is synchronous and `useFactory` returns `T`, not `Promise<T>`. Any dependency requiring
async initialisation — a database connection, a secret fetched from a vault, a warm cache — cannot
be expressed as a provider. This is why the framework carries an ad-hoc parallel lifecycle
(`init()`, `beforeAppInit`, `onAppInit`, `afterAppInit`, `onAppStart`) instead: the DI container
cannot own construction, so ordering becomes the application's problem. See
[02-http-runtime-core.md](./02-http-runtime-core.md) §M12 for the middleware-ordering consequence.

### D7. The container is a module-level global — ~~MAJOR~~ **FIXED**

> **The finding's own words are what got fixed: "with no error."** `initDiContainer` now refuses to
> run when a second copy of the framework has been loaded into the process, and the message names
> `npm ls zibri` and `peerDependencies` — the two things that actually resolve it.
>
> **Making the copies share was considered and rejected, and the reason is the interesting part.**
> Hoisting the singleton onto a realm-wide slot (`Symbol.for`, the way `reflect-metadata` already
> puts every piece of metadata on the realm's `Reflect`) is easy, and it would give both copies one
> container. It would not make them work. Every *class* would still be distinct — copy A's
> `BaseEntity` is not copy B's, nor its `ValidationError`, nor its `HttpRequestContext` — so every
> `instanceof` across the boundary would keep answering no about a value that is exactly what it
> claims to be. That residue is far harder to trace than the install it came from, and it would
> appear only in whichever code path happened to cross the seam. One error at startup, naming the
> install, is strictly better than most of a fix plus a class of bugs with no visible cause.
>
> **Which is also why no version is read.** Keying the slot by major version only has a job if the
> copies are meant to share it, and they are not. Counting needs nothing but the count, and it stays
> right for the case a version could not have caught anyway: two copies of the *same* version,
> duplicated by a lockfile rather than by a range.
>
> **The count is one increment per module registry**, done at the top of `global-registry.ts` because
> everything that uses the framework loads that module, and a second evaluation of it is precisely
> what a second copy is. `Symbol.for` is looked up in a registry the whole realm shares, so the two
> copies find each other through the one thing that is genuinely global.
>
> Held by `src/global/framework-copies.test.ts`. The second copy is real rather than described:
> `jest.resetModules()` and a re-require produce a second module instance of the same files in one
> realm, which is what two directories in `node_modules` produce, and the test asserts the two
> `GlobalRegistry`s are different objects before asserting the error. That test has to be last in its
> file for the same reason the finding exists — a copy cannot be taken back out of a process.
>
> **It also puts a check under a decision that was until now only a decision.**
> [P1/P2](#p2-the-esm-build-has-no-type-module-marker--major-fixed) were closed by shipping a single
> build rather than a dual one, for exactly this reason: an application reaching the `esm` entry
> through one import and the `cjs` entry through another would have had two containers. That
> reasoning lived in a packaging choice and nowhere else. Now the process says so at startup, however
> the second copy got there.

`src/di/di-container.ts:27` — `private static singleton?: DiContainer`. Two copies of `zibri` in
`node_modules` (a transitive version conflict, a monorepo with mismatched ranges) produce two
containers and two `GlobalRegistry`s that cannot see each other, with no error. Combined with
`GlobalRegistry`'s static arrays ([02](./02-http-runtime-core.md) §C7), the framework's identity is
module-instance identity.

### D9. `@Injectable` registration is a one-shot snapshot, and missing it lies about the cause — ~~MAJOR~~ **FIXED**

> **One line, in the place the finding pointed at.** `inject` already fell back to
> `GlobalRegistry.lazyInjectables` when a token was not in the container; it now falls back to
> `GlobalRegistry.injectables` as well and promotes what it finds, so registration is no longer a
> snapshot taken at `initDiContainer` and a class is resolvable from the moment it is decorated.
>
> **The misleading message needed no work of its own.** It only ever appeared for a class that *was*
> decorated, so making those resolve is what stopped it being a lie. What remains says "did you
> forget to decorate it" to callers who genuinely did.
>
> The fallback undoes an `unregister`, though - the global record outlives the container, so the next
> lookup would put back what was just taken out. A token removed on purpose is remembered as removed,
> which is not [D4](#d4-unregister-does-not-evict-instances-and-its-jsdoc-is-false--major) - an
> already constructed instance still answers from the cache, and that half stays open - but it stops
> this fix from making that one harder.

`init-di-container.function.ts` reads `GlobalRegistry.injectables` **once**:

```ts
for (const injectable of GlobalRegistry.injectables) {
    register(injectable);
}
```

`@Injectable` (and therefore `@DataSource`, `@Entity`-adjacent decorators and everything built on
them) pushes onto that array at *module load*. So whether a class is injectable depends entirely on
whether its module was imported before `initDiContainer()` ran. A module loaded one line later is
decorated, present in `GlobalRegistry.injectables`, and still not in the container.

The failure message actively misleads:

```
NoProviderError: No provider for class "MigrationDataSource".
Did you forget to decorate it with @Injectable()?
```

The class *is* decorated. Nothing in the error mentions ordering, and the suggested fix is already
done — so the natural next step is to add a decorator that is there, conclude the framework is
broken, or start guessing.

**Hit three separate times while building the cluster harness**, in three different disguises, by
someone who by then knew the codebase well:

1. an instance options module `require`d *after* `initDiContainer()` — `NoProviderError` on a class
   carrying `@DataSource()`. Earlier scenarios had worked only because their data source happened to
   be constructed at import time of a statically imported module.
2. moving that construction to be lazy — so it happened inside a function called after
   `initDiContainer()` — reproduced the identical error from a completely different edit.
3. and in between, the inverse: a decorated-but-unused data source pulled in by an unrelated import
   from the same module, which fails boot instead (see D10).

Each time the fix was to move *when the class comes into existence*, and each time the error pointed
at the decorator instead. Ordering is invisible in the source: nothing at a call site says "this
must happen before the container is built", and the constraint is not expressed in any type.

This bites any deferred loading — plugins resolved at runtime, a lazily required module, test
harnesses, anything reading a path from configuration. The lazy path (`register: 'onUse'` →
`GlobalRegistry.lazyInjectables`) is consulted on every `inject`, so it does not have this problem;
the default one does.

Two independent fixes: consult `GlobalRegistry.injectables` on lookup the way `lazyInjectables`
already is, and — regardless — say so in the error. Checking whether the class appears in
`GlobalRegistry.injectables` and reporting *"decorated but registered after the container was
initialized"* would turn a guessing game into a one-line fix.

Held by `src/__testing__/evaluation/di-and-packaging.evaluation.test.ts`, one test per fix. It needs
no containers, so it is the one evaluation test that has actually been run — both are red, and the
message half reproduces the finding word for word:

```
NoProviderError: No provider for class "EvalLateInjectable".
Did you forget to decorate it with @Injectable()?
```

on a class carrying `@Injectable()`. The asymmetry it rests on is `di-container.ts:127`: `resolve`
falls back to `GlobalRegistry.lazyInjectables` and never to `GlobalRegistry.injectables`.

### D10. Defining a data source you do not use fails boot — ~~MAJOR~~ **FIXED**

> **Closed**, held by `bootstrap.evaluation.test.ts`, which now asserts both halves.
>
> `@DataSource({ allowOrphan: true })`, which is not a new idea in this framework — `@Entity`,
> `@Controller` and `@WebsocketController` all have it, and `@DataSource` was the one decorator of the
> four that did not. Off by default, because the check is worth keeping: a data source an application
> meant to use and forgot to list connects to nothing, and the first query is where anybody finds out.
> What the flag says is that *defining* a class is not the same as intending to run it.
>
> **The name matching was the more interesting half.** `ds.name === element.constructor.name` now
> compares class identity, the way the router's equivalent check always did. The finding called this
> "a second problem", and it is worse than that reads: a factory that builds a class per call produces
> classes that all share one name, so every one of them satisfied the check on behalf of the others.
> The validation passed for precisely the case it exists to catch.
>
> Which the framework's own test helper then demonstrated, three times over. `createTestDataSource()`
> is exactly the shared-module shape the finding describes, and turning name matching into identity
> matching found every place the suite relied on it:
>
> - `bootstrap.evaluation.test.ts` builds one per test and hands each application only the newest.
>   Under name matching all six looked registered; under identity matching five are orphans.
> - `payment.plugin.test.ts` builds one inside a helper that runs once per test, so the second test
>   failed on the first test's leftover rather than on the plugin error it was asserting.
> - `where-filter-to-find-options-where-function.test.ts` writes
>   `class DbDataSource extends createTestDataSource() {}`. **A base class is a shape the finding did
>   not anticipate**: the factory returns a *decorated* class, so extending it registers two data
>   sources and deploys one, and the base exists only to be inherited from.
>
> Three files out of a hundred and seventeen, each a real "declared, not deployed" case and each now
> saying so at the call. That ratio is the useful part: the flag is rare, which is what makes leaving
> it off the default the right call.
>
> **The error now names the file.** `MetadataUtilities.getFilePath` is already captured at decoration
> time for every injectable, so the message can say where the class was declared and suggest the flag.
> The finding's last complaint was that the reader had no thread to follow — a data source reaches the
> registry by being imported, and the import is usually indirect.
>
> **Not addressed:** orphaned data sources are still *instantiated* before being judged, because
> `init` injects every registered token first. That is harmless — a constructor runs, nothing
> connects, `DataSourceService` only ever touches `app.options.dataSources` — but it means a data
> source class whose constructor has side effects still gets them.

The original finding, for the record:

`application.ts:394`

```ts
if (isDataSource(element) && !this.options.dataSources.find(ds => ds.name === element.constructor.name)) {
    throw new InternalError([
        `Invalid class marked with @DataSource: ${element.constructor.name}`,
        'The data source has not been included in the application options.'
    ]);
}
```

`@DataSource` registers immediately, and `init` instantiates every registered token before this
check. So the mere *existence* of a decorated data source class anywhere in the module graph fails
the application, whether or not anything uses it.

That makes a shared module which constructs data source classes unusable: a test helper, a factory,
or a library exporting several for callers to choose between breaks every app that imports it for
an unrelated export. Hit while building the cluster harness — importing a constants module for its
entity list pulled in a data source factory call, and every scenario that declared its own data
source stopped booting.

Matching by `ds.name === element.constructor.name` is a second problem: two data sources with the
same class name in different modules satisfy each other's check.

The validation is worth having — a data source you forgot to register is a real mistake. The sharp
edge is that *defining* one is enough to trigger it, and the error names the class without naming
the import that pulled it in, so the reader has no thread to follow.

Held by `src/__testing__/evaluation/bootstrap.evaluation.test.ts`, which declares a decorated data
source inside the test and then boots an application that never mentions it. Note the test has to
be **last in that file**: `@DataSource` registers into the static `GlobalRegistry` at decoration
time and nothing removes it, so the class stays visible to every test declared after it. That
constraint is the finding restated as a property of the test suite.

### D8. `useValue: null` is not cached — MINOR, **FIXED**

> **Fixed by removing the caching rather than by extending it, and that turned a consistency row into
> a defect fix.** The two checks did disagree, but the interesting question was which of them was
> right. A cache exists so that something is not *built* twice; a `useValue` provider builds nothing
> and hands back the same value however often it is asked, so caching one saves nothing at all.
>
> Extending the cache to cover `null` — the reading the finding invites — would have made things worse.
> Registering a provider replaces the provider and never the instance cached under it, so a cached
> value outlives the provider that named it: a token read once as `undefined` and re-registered
> afterwards with a real value would have gone on answering `undefined` forever. Two shipped providers
> are declared exactly that way, `COOKIE_SIGN_SECRET` and `ENCRYPTION_MASTER_OPTIONS`.
>
> So values are no longer cached at all, `createInstanceFromProvider` is unchanged, and a provider
> registered later now takes effect. Both halves have a test.

`src/di/di-container.ts:152` gates caching on `provider.useValue != undefined`, while
`createInstanceFromProvider` (`:164`) branches on `'useValue' in provider`. A provider with
`useValue: null` takes the `in` branch every time and is never cached — harmless in effect, but the
two checks disagree about what "has a value" means.

---

## M. Decorator and metadata model

### M1. Legacy decorators plus `emitDecoratorMetadata` locks consumers to `tsc` — ~~MAJOR~~ **FIXED**

> **The migration this row implies is not available, and the lock it names is narrower than it says.**
> Standard decorators have no parameter decorators — the TC39 proposal excludes them and the
> follow-on is at stage 1 — and no equivalent of `design:paramtypes`. The container reads both
> (`di-container.ts:469-470`), so "support the standard model" is not a decision anybody can take
> yet, whatever it costs.
>
> **What the finding conflates is two options that behave nothing alike, measured rather than
> reasoned about.** A probe compiled with the repo's own compiler both ways: without
> `emitDecoratorMetadata`, `__decorate` and `__param` are still emitted and only `__metadata` goes.
> So every decorator the framework ships keeps working — they are handed everything they record —
> and what is lost is read in exactly **two** places in the whole framework: a constructor parameter
> that names no token, and §M8's check that a number property's declared type matches its `format`,
> which already treated absent metadata as "says nothing" on purpose. `experimentalDecorators` is the
> real requirement, and every toolchain that compiles TypeScript at all implements it.
>
> So the answer is **two supported styles rather than one supported toolchain**: an application that
> names every token with `@Inject` builds under esbuild, Vite and Bun today. That is written down in
> `docs/getting-started.md` under *Build toolchains*, where a reader looks before choosing, rather
> than inside an error message — and `src/build-toolchains.test.ts` compiles one application four
> ways (`tsc`, `tsc` without the option, SWC, esbuild), loads each in a process of its own, and
> asserts they describe themselves identically apart from the two metadata-dependent answers. A claim
> about somebody else's compiler is worth nothing written down alone, because the day it stops being
> true nothing says so.
>
> **The defect that test found on its first run is the reason the round was worth doing.** With no
> metadata the container did not refuse — it built the class **with no arguments at all**. The
> parameter count came from `Math.max(paramTypes.length, highestExplicitIndex + 1)`, and a build that
> records nothing makes both of those zero, so `UninjectableParameterError` — the whole of §D5's work
> — was unreachable and every dependency arrived as `undefined`. The failure then surfaced at the
> first method call, somewhere else entirely: `Cannot read properties of undefined`. The constructor's
> own `length` is the floor now. It is inert wherever the metadata exists, because `design:paramtypes`
> always records at least as many entries as the arity, so this can only ever *add* refusals to builds
> that had none.
>
> **What the second style gives up is named rather than worked around**: §M8's declaration check reads
> the declared type, so a build that records none has nothing for it to read. The value is still
> checked against the format as it is stored, so what moves is when a contradiction is found, not
> whether a wrong value can be written.
>
> **Two things left open, both found on the way.** A constructor that is *inherited* rather than
> declared reports an arity of 0 (an implicit `constructor(...args)`), so a subclass adding no
> constructor of its own is still built with nothing; walking up the prototype chain for it would
> over-count a subclass that deliberately takes none, which is worse. And a **sync** `useFactory`
> declaring parameters is handed nothing and always was — its type says `deps?: never`, and what it
> needs it reaches for with `inject()` — so either that type should refuse parameters outright or the
> container should, which is its own decision rather than this one. **That second half is fixed
> (2026-09-28)**: `useFactory` is typed `() => T` and called with nothing, so a factory declaring a
> required parameter no longer compiles, which `di-container.test.ts` holds with a
> `@ts-expect-error`. The container had been reading parameter metadata off a factory function,
> where there never is any.
>
> **The first half closed too (2026-09-28), found-bug sweep item 8, and it was wider than written
> here.** Probed with the repo's `tsc`: a decorated subclass declaring no constructor gets no
> `design:paramtypes` of its own, and its parent gets none either unless the parent is decorated. So
> `@Injectable() class Sub extends Base {}` over an undecorated `Base(clock: Clock)` was built with
> nothing under the *default* toolchain too, not only in builds without metadata. The container now
> finds the constructor a class runs: it walks up past a class that reports an arity of 0 and has no
> parameter types recorded of its own, to the nearest ancestor that declares parameters. The arity
> and the refusal come from there, and the refusal names both classes. What the walk over-counts is the
> case this entry feared: a subclass declaring `constructor()` that passes its parent something
> itself. Under a build recording types, that constructor's own empty `design:paramtypes` stops the
> walk, so it is built as before. Without them it is indistinguishable from an inherited one and is
> refused. **The user chose that (option A)** over an `@Injectable` opt-out, and chose the error's
> wording: mark the parent's parameters with `@Inject`, or override the constructor in the subclass,
> both of which work under every build. Held by four cases in `di-container.test.ts` (the refusal was
> red first) and by `build-toolchains.test.ts`: an inherited constructor naming its tokens builds
> under all four toolchains, and the empty-constructor subclass builds with metadata and is refused
> without it. Documented in `getting-started.md` under *Build toolchains*.
>
> `@swc/core` was already a devDependency that nothing imported, left behind when the cluster harness
> chose `ts-node` over it; it is what the SWC row is built with. `esbuild` was added for the row that
> cannot be inferred from either of the others.

`tsconfig.base.json:5-7`

```json
"emitDecoratorMetadata": true,
"experimentalDecorators": true,
```

These are TypeScript's pre-standard (Stage 2) decorators. TypeScript 5 ships TC39 standard
decorators, which are a different, incompatible model with no `design:paramtypes` equivalent.

The practical consequence today is the tooling lock-in:

| Toolchain | `emitDecoratorMetadata` |
|---|---|
| `tsc` | supported |
| SWC | supported behind a non-default flag |
| esbuild | **not supported at all** |
| Vite (esbuild transform) | not supported without swapping the transformer |
| Bun | partial |

A company standardised on esbuild or Vite for its Node services cannot build a Zibri application
without changing its build toolchain. This is not documented anywhere.

`isolatedModules: true` is also set (`:11`), which is correct but interacts badly: a constructor
parameter typed via a `import type` binding erases to `undefined` at runtime and hits D5's
`'Could not find token'`.

### M2. The strictest TypeScript options that would catch the confirmed bugs are off — ~~MAJOR~~ **FIXED**

> **Six of the seven are on; `exactOptionalPropertyTypes` was decided against.**
> `noUncheckedIndexedAccess`, `noImplicitOverride`, `noUnusedLocals`,
> `noPropertyAccessFromIndexSignature`, `noFallthroughCasesInSwitch` and `noImplicitReturns` are in
> `tsconfig.base.json`, and the 412 errors they raised are gone from `src` and from the tests alike.
> `noUnusedParameters` stays off because an eslint rule already covers it and the underscore prefix
> it demands makes JSDoc unreadable.
>
> **The finding's own evidence was two-thirds stale, and the flag was right anyway.** Of the three
> confirmed defects listed below, two had already been fixed by other rounds. The flag then found
> four nobody had listed, each of which now has a test:
>
> - `/metrics` answered 500 on a host that reports no network interface — `si.networkStats()` is one
>   entry per interface and a container can have none. Two counters are worth less than the whole
>   snapshot, so the rest is collected either way.
> - the sliding-window rate limiter computed a `NaN` ready time for a reservation wanting more slots
>   than the window holds, and NaN loses every comparison it is put in: the horizon check refused a
>   satisfiable reservation as `QUEUE_TOO_LONG` and reported a wait of NaN.
> - a multipart field the model does not declare answered 500 instead of 400 — the parser read a
>   type off metadata that was not there, where a json body reports the unknown key.
> - `addImportStatement` silently returned a side-effect import unchanged, so generated code was
>   missing an import until it failed to compile in a file nobody looks at. It throws now.
>
> **The argument for a compiler flag is the class of defect it forecloses, not the list of instances
> somebody happened to write down.**
>
> **`exactOptionalPropertyTypes` is a different kind of decision and was declined.** It does not
> check the code; it splits `foo?: string` from `foo: string | undefined` across every optional
> property in the public API, so its 234 errors are largely a question of which of the two each
> option type, each entity and each decorator input means — a modelling pass over the framework's
> surface, with a breaking change at the end of it for anyone who writes `{ logo: undefined }`. Worth
> doing deliberately, not as the tail of a strictness round.

`tsconfig.base.json` enables `strict: true` and nothing beyond it. Absent:
`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noUnusedLocals`,
`noPropertyAccessFromIndexSignature`.

`noUncheckedIndexedAccess` alone would have surfaced, at compile time, several defects confirmed
elsewhere in this review:

- `src/logging/logger.ts:73` — `(new Error().stack ?? '').split('\n')[3]` then `line.match(...)`
- `src/metrics/metrics.service.ts:158` — `stats[0]` destructured without a length check
- `src/data-source/data-sources/postgres-typeorm-data-source.model.ts:198-199` —
  `targetProps[metadata.inverseSide]` cast and immediately dereferenced

`README.md:88` claims all public classes, interfaces and functions are "as strictly typed as
possible". The compiler configuration does not reflect that.

### M3. `any` sits in the core public metadata types — MINOR, **FIXED**

> **Assessed rather than patched, on the user's instruction: for each `any`, find why it is there
> before replacing it, and then say either what would make that reason obsolete or that the type
> system cannot express the alternative.** Three sites, three different answers.
>
> **`application.ts` is stale.** `use` has three typed overloads — `RequestHandler`, `Route`,
> `MiddlewarePhase` — and the file contains no `any` at all any more. Closed as a side effect of
> [02 §M12](./02-http-runtime-core.md)'s middleware phases.
>
> **The five `any`s in `PropertyMetadata` are a variance limit rather than an oversight.**
> `PropertyMetadata` is the metadata of *some* property of *some* entity, so it has to be a supertype
> of every instantiation a consumer can write. `TKey` flows into `EncryptionStrategyInterface<TKey, …>`,
> which declares `generateRandomKey: () => TKey` in a return position *and*
> `serializeKey: (key: TKey) => Buffer` in a parameter position — so it is **invariant**, and under
> `strictFunctionTypes` no ordinary type is a supertype of both `…<Buffer>` and
> `…<RemoteKeyHandle>`. `any` is the only type assignable in both directions, which is exactly why it
> is there. It is also not one site: `EncryptionDescriptor.keys` is already
> `EncryptionPropertyValue<any, any, any, any>`, with two more `no-explicit-any` disables in the
> encrypt and decrypt functions. The `any` is load bearing for the whole encryption configuration path.
>
> **What would make that reason obsolete**: split the declaration type from the stored type. The
> consumer writes a fully generic config on the decorator; what the framework stores and reads back is
> an erased `EncryptionConfig` with no type parameters at all — which costs nothing, because nothing
> that reads metadata needs `TKey`. The strategy is resolved at runtime by the model registry and the
> encryption service, and that is where the single documented cast would live. Five `any`s and three
> downstream disables become one boundary. **What would not work**: `unknown` or `never` in place of
> the parameters (invariance again, in both directions), and an existential type, which TypeScript has
> no syntax for — the callback encoding of one cannot live in a metadata record.
>
> **The two in `EntityMetadata` are fixable, and the fix is larger than the `any`.** The reason is that
> `EntityMetadata` is not generic in its entity while `defaultOrder` and `defaultRelations` are
> entity-keyed maps. `@Entity` itself *is* generic (`TOrderKey`, `TRelationKey`), so the input side is
> already precise and only the stored side is erased; `EntityMetadata<T extends BaseEntity = BaseEntity>`
> would fix both and remove the cast at `repository.ts:212` with it.
>
> What stops that being a small change is the other half of this finding, which is wider than the two
> lines cited: TypeORM's types are in the public API beyond `@Entity`. `FindAllOptions<T>` takes
> `order` straight from `Pick<FindManyOptions<T>, 'order' | 'skip'>` and declares
> `relations?: FindOptionsRelations<T> | (keyof T)[]`, and `UpsertOptions` does the same. Framework
> owned `EntityOrder<T>` / `EntityRelations<T>` in all four places, plus the conversion in
> `typeorm.repository-driver.ts` that already casts, is the actual fix — and it touches the most used
> option type in the framework, so it is a round of its own rather than part of a sweep.
>
> **That round is done, and the wider half was not a type finding at all.** The entry reads as
> cleanliness — an orm's types where the framework's should be. What the type was actually doing is
> promising five shapes that one of the three stores answered and the other two ignored in silence:
>
> | written | postgres | valkey and in memory |
> |---|---|---|
> | `order: { x: 1 }` | sorts | **not sorted at all** — the key is dropped |
> | `order: { x: 'asc' }` | sorts | sorts |
> | `order: { team: { name: 'ASC' } }` | joins and sorts | **not sorted at all** |
> | `order: { x: { nulls: 'FIRST' } }` | honoured | ignored, nulls always last |
> | `relations: { x: false }` | not resolved | **resolved** |
> | `relations: { post: { author: true } }` | nested, and covered by a test | only `post` |
>
> Every row of that came from the declaration rather than from a mistake: `FindOptionsOrder` offers
> four spellings of a direction, a `nulls` placement and unbounded nesting, and the two stores that
> read an order in process were written against what their own callers happened to write. **A public
> type borrowed from a dependency promises everything the dependency does, including the parts
> nothing behind it implements.** That is the whole of why owning it mattered, and it is a better
> reason than the one the entry gives.
>
> **What was decided, rather than what was smallest.** Both halves went the way that keeps the widest
> behaviour: `EntityRelations<T>` is recursive and the two non sql drivers resolve nested relations,
> and `EntityOrder<T>` reaches through a to one relation and they sort by it. What is gone is only
> what nothing honoured — `1`/`-1`, the lowercase spellings, `nulls`, and ordering through a to many
> relation, which multiplies the rows a join answers with and names no single value to sort by. The
> four spellings leaving also made `resolveKeysetOrder`'s `directionOf` translator and its "ordered in
> a way a keyset read cannot continue through" refusal unreachable, and both are gone with them.
>
> **The question the entry does not contain, and the one the answer turned on**: an order naming a
> relation and `relations` are no longer independent, because a value has to be read before it can be
> compared. Three answers were possible — refuse it, resolve and hand it back, resolve and do not.
> The last one was chosen, and then typeorm turned out to have implemented exactly that for years:
> `buildOrder` pushes a join with `select: false` (`SelectQueryBuilder.js:2457-2467`), and `buildWhere`
> does the same for a filter naming a relation (`:2674-2681`). **So postgres already answered the way
> the decision went, and the finding was the other two stores** — which had been handing back a
> relation that only a filter asked for since filters on relations existed. One rule covers both now:
> *a relation read because a filter or an order could not be answered without it is not a relation
> anybody asked for.*
>
> `EntityMetadata<T extends BaseEntity = BaseEntity>` is generic with it, which removed four casts in
> `repository.ts` and the two `no-explicit-any` disables on the decorator. Two casts are left and both
> are the same limit stated twice: an order is a mapped type over the entity, and an unresolved entity
> has no keys to map, so neither `{ ...order, id: 'ASC' }` nor the handover to the orm can be shown to
> be one. The decorator keeps its own boundary cast, for the reason the entry predicted — what is
> written on `@Entity` is checked against the class by its keys, because the class does not exist yet
> at that point.
>
> Covered by `nested-relations.cases.ts`, eight cases on all three stores.
>
> **What is left is the five in `PropertyMetadata`, and they are still the variance limit** described
> above rather than anything this round could reach. Making them obsolete is a change to the
> encryption model — splitting the declared config from the stored one — which is its own decision.
>
> **That split is done (2026-10-04), as described above.** What a declaration is written with keeps
> its five type parameters, so the `encrypt` and `decrypt` options are still checked against the
> strategy they name (checked first: a misspelled, a mistyped and another strategy's option are all
> compile errors). What is stored is `StoredStringPropertyMetadata`, the same shape with no type
> parameters, and `toStoredStringPropertyMetadata` in the property decorator is the one boundary,
> with one cast and the reason beside it. Gone with it: the five `any`s in `PropertyMetadata` and
> `PropertyMetadataInput`, the ones in both descriptors, in `encryptEncryptionProperties` (two),
> `needsReEncryption`, the array item and migration input types, and the string readers in
> validation and both value conversions. `ArrayPropertyItemMetadataInput`, `OneOfShapeMetadataInput`
> and `OneOfShapesMetadataInput` take the same five parameters, so `Property.array` and
> `Property.oneOf` infer them from the item or shape the way `Property.string` does; inside one
> `@Property.oneOf` all named strategies share one key type, which is refused when they do not
> rather than missed. Migration metadata takes the stored form, since a migration never names a
> strategy. Held by type tests in `property.decorator.test.ts`.
>
> **The shared key type is lifted (2026-10-04).** The item and shape input types take what a string in
> them is declared with instead of the five parameters, and `Property.array` and `Property.oneOf` check
> the declaration as written against `StrategyCheckedItemInput` / `StrategyCheckedShapesInput`, which
> work out each string's strategy from that string alone. The shapes of one value can now name
> strategies with different keys and options, each checked against its own. The code that builds the
> metadata takes `AnyStrategyStringPropertyMetadata`, with encryption and hashing as `unknown`, so
> `toStoredStringPropertyMetadata` is still the one cast. The check is reached through an index
> signature: a parameter typed as "the declaration and its check" knows every name the declaration
> uses, which let a misspelled option compile (tried first, six existing type tests went unused).
> TypeScript compares a property against an index signature on its own, so the misspelling is caught
> again. The same reason is why `Property.array` takes one object rather than the union of a file
> array and any other. What is left is narrow: a shape passes if it fits *any* shape's check, so two
> strategies with the same key type whose options differ only in optional fields can take each
> other's options. Migrations store arrays through `createArrayPropertyMetadata` directly, as they
> already did for oneOf. Held by type tests in `property.decorator.test.ts`: mixed encryption
> strategies and an array of such a oneOf, both red before; mixed hash strategies, which already
> compiled because the bundled hash strategies declare methods, which TypeScript checks bivariantly;
> the swapped option on each; and a misspelled option on the items of a shape that is a list.
>
> **Found on the way: request parameters accepted `encryption` and `hash` and did nothing with
> them.** `StringParamMetadata` was built from the string property metadata, so it carried both flags
> and the same five parameters with their `any`s - and nothing reads either flag for a parameter. The
> user decided to remove them: a parameter is read from a request, not stored. `StringParamMetadata`
> and its input have no type parameters now, which took the remaining `any`s of this kind out of the
> parameter decorators, the route types and string validation. Held by type tests in `param.decorator.test.ts`, red
> before.
>
> **The same held for every other shape that is read rather than stored (2026-10-04, the user's
> decision again).** The shapes of a body, a websocket body and a response read by the http client,
> the string shape of a oneOf path parameter, and the list shape of a oneOf query or header parameter
> all accepted `encryption` and `hash`, and nothing acted on them. They now take
> `IncomingStringPropertyMetadataInput`, the string input without both flags, and so does
> `createAnyOfShapesMetadata`. That also removed the last `any`s of this kind, on the path parameter
> shape. Held by type tests in `body.decorator.test.ts` and `param.decorator.test.ts`, red before.
>
> **Found on the way: `encryption` and `hash` on an array item or a string shape were accepted and
> ignored.** `@Property.array({ items: { type: 'string', encryption: true } })` stored every item as
> plaintext, as did a string shape of `@Property.oneOf`: the descriptors only looked at strings
> directly on a model. The user decided to support them rather than refuse them. A
> `StringValueDescriptor` now says where in a property's value its strings sit (the value, each item,
> the value of a named shape, nested as deep as declared), and encrypting, decrypting, hashing, the
> bound-property check of bulk writes and `needsReEncryption` all walk it. Such a property stays out
> of change sets by default like an encrypted string, and an item declaring both `encryption` and
> `hash` is refused as a property is. Held by `encrypted-items.cases.ts` (in-memory here, red before;
> postgres and valkey in `encrypted-items.postgres-valkey.test.ts`) and `change-set-exclusion.test.ts`.

- `src/entity/decorators/property.decorator.ts:27` —
  `StringPropertyMetadata<any, any, any, any, any>` in the central `PropertyMetadata` union, and
  `:50` in `PropertyMetadataInput`.
- `src/entity/decorators/entity.decorator.ts:30, 35` — `FindOptionsOrder<any>` /
  `FindOptionsRelations<any>`, which also leak TypeORM's types directly into the public `@Entity`
  decorator API, so the ORM abstraction is not actually an abstraction at the type level.
- `src/application.ts:143-147` — `use(...args: any[]): void`, so `app.use(anything)` compiles.

### M4. Metadata registration happens at module load, into global arrays — ~~MAJOR~~ **FIXED**

> **Narrowed by its own worst consequence, which was a boot failure for every consumer.** The
> finding is written as a hot-reload and scoping concern. What it actually did was stop applications
> from starting: `import { ZibriApplication } from 'zibri'` loads the barrel, the barrel exports both
> shipped plugins, `@Controller` registers at module load, and startup builds every registered token
> - the lifecycle sweeps do, and so do the three services that check nothing looks like a cache, a
> rate limiter or a user repository without saying so. So `MailingListController` was constructed in
> an application that has never heard of it, asked for `Repository<MailingListSubscriber>`, and
> failed with `NoProviderError` before the first request.
>
> **Nothing in this repository could see it.** All 127 suites import relative paths
> (`../../application`), never the package's own name, so the barrel is never loaded and the plugins
> are never registered. It surfaced the first time `zibri-testing` - a package, importing `zibri`
> the way a consumer does - ran a test ([06 §T2](./06-tooling-ci-and-testing.md)).
>
> `ZibriApplication.dropUndeclaredOrphanControllers()` unregisters a controller that says
> `allowOrphan` and that the application did not declare, once, before any sweep - so every sweep
> sees the same container and the three services needed no change. `allowOrphan` already meant such
> a controller may go unused; that it is not *built* either is the half that was missing.
>
> **Measured rather than assumed, twice.** A bare import registers exactly five injectable classes:
> the two body parsers, the two auth controllers, and the mailing list controller. Every plugin
> *service* is `register: 'onUse'` already. It also registers 33 entities, and those need no
> equivalent fix - a repository provider exists only for what a data source declares. **That second
> claim was wrong the first time it was written**: `DataSourceService` refuses an entity no data
> source declares, and `@Entity({ allowOrphan: true })` is what exempts one. The plugin entities all
> carry it; `ClusterMark` did not, and adding it to a shipped barrel broke 13 tests until it did.
>
> **What is left of the finding is what it actually says**: registration is still a module-load side
> effect into global arrays, there is still no deregistration, and a watch-mode restart still
> re-imports into arrays holding the previous generation.

> **The second round, and the residue was not the hot-reload story above - it was the controller
> defect again, in six more places.** Registration being a module-load side effect costs nothing by
> itself; what made it cost something is that startup then *built* everything registered. Reproduced
> container-free: a service an application never declares and nothing ever injects was constructed at
> boot **and its `onAppInit` ran**. A library shipping `@Injectable()` services therefore ran them
> inside every consumer that imported the module for something else entirely.
>
> Initialization now builds a class only when it has a reason to exist before its first use, and a
> lifecycle hook is how a class says so - readable off the **prototype**, so the question is answered
> without constructing anything. What keeps working is the case that matters: an application's own
> service with an `onAppInit` and nothing injecting it is still built and its hook still runs. That is
> asserted first in the suite, because everything after it narrows what gets built.
>
> **The application-level fix on its own changed nothing observable, and finding out why is the result
> worth keeping.** Five services answer "does anything look like a cache / a rate limiter / a body
> parser / a user repository without being decorated as one?" with
> `getAllRegisteredTokens().map(t => inject(t))` - constructing the entire container in order to
> duck-type the instances. The blockquote above named three of them and nobody had followed it up.
> Each already builds its real list from `getRegisteredProvidersOfVariant`, so only the guard needed
> changing, and it reads `getAllInstantiatedValues()` now. **The variant cannot replace the duck
> typing there**: the guard exists precisely to find a class that has the shape and *not* the
> decorator, so a variant check would match nothing and it would silently stop guarding.
>
> **Shutdown had the same shape, and its own code already argued against it.** The failed-init branch
> explains that it reads `getAllInstantiatedValues()` so as never to force-construct what init never
> touched; the branch below it resolved every registered token, so a value nothing had ever used was
> constructed for the first time on the way out, to be handed a shutdown it had no state for. Both
> branches agree now, and so does `onAppStart`.
>
> **What was designed and then dropped**: `allowOrphan` on `@Injectable`, mirroring the controller
> flag. The user asked what happens to such a service reached only through a late `inject()`, and the
> answer is that its hooks never run, silently. That hole already existed for `register: 'onUse'`,
> whose classes `GlobalRegistry.lazyInjectables` never sweeps, so the flag would only have added a
> second door into it - and "may go unused" beside a lifecycle hook is a contradiction rather than a
> configuration.
>
> **The `onUse` hole closed with it, and getting there cost three wrong designs.** The trilemma is
> real: *do not build what nobody wants*, *always run a used service's hooks*, and *no call-time
> surprises* - any two. Running a missed hook at construction fails on the first, because `inject()`
> is synchronous and a hook may return a promise, so the caller would get a value whose preparation is
> still in flight - a quieter failure than the one being fixed. A **startup** check that a hooked
> class will be built was written and thrown away after it fired on `AssetService`, then `CronService`,
> then `MailingListService`: one is provided under a token of its own, one was replaced by the test
> harness on purpose, and one belongs to a plugin the application never enabled. `@Injectable({ register: 'onUse' })`
> beside a lifecycle hook **is the framework's own idiom**, used by seven shipped services, so no
> startup rule built on it can avoid an allowlist that grows with every service added. Three patches
> in a row is the tell.
>
> So the answer is the one the entry's own neighbour already reached: `UnresolvedAsyncProviderError`
> refuses a value that has to be awaited and was first asked for too late, *at the moment it is asked
> for*, because that is the only moment the question is answerable. `MissedLifecycleHooksError` is the
> same refusal for a class that declares hooks and is first built after the phases it named, and
> `additionalLifecycleServices` on the application options is how an application says it means to run
> one - the escape hatch, named so that it does not read as a registry every service belongs in.
> **What is decidable at startup is what nobody wants; what is decidable at injection is what somebody
> wants.** Neither question can be asked at the other's time.
>
> **The first run found the half of the narrowing that was wrong, and it was a sentence in its own
> comment.** "A provider somebody wrote in the options is one somebody asked for" was applied only to
> providers that are *not* classes, so a class listed in `options.providers` went unbuilt - and with
> it the check that reports a class shaped like a rate limiter that nobody decorated, which is about
> classes somebody put there on purpose. `rate-limiting.service.test.ts` is what said so. A provider
> the application wrote down is now built whatever it is made of, which also restores the two guards
> whose predicates read instance fields.
>
> **Named, not fixed** (the first half since fixed, below): a class first built *during* initialization by something else's constructor,
> after the sweep computed its list, still misses its hooks and is not refused - the state is not yet
> `INITIALIZED`, which is what the refusal keys on. And a class that registers itself by being
> imported, declares no hook, and happens to be shaped like a cache or a rate limiter without the
> decorator is no longer reported, because nothing builds it to be looked at - the narrowing's cost,
> and the smaller half of what those guards were for.
>
> **What the refusal found on its first run was a test asserting against a service the application was
> not running.** `defaultTestProviders` replaces `CRON_SERVICE` with an inert stub, so
> `inject(CronService)` in `cron.test.ts` resolved the class's own record and built a *second*
> instance whose `onAppInit` had never run. Driving a real service by hand is a fair thing for that
> suite to want; it just had no way to say so, and now names the class in
> `additionalLifecycleServices`. An instance is cached under its class as well as its token
> (`di-container.ts:317-319`), so this is the only shape that can reach the refusal at all: a class
> whose token something else was given.

> **The first half of the named residue is fixed (2026-09-28, found-bug sweep item 6), by keying the
> refusal on phases rather than on the application's state.** Initializing is three phases and
> starting two more; `GlobalRegistry` now records each as it finishes (`LifecyclePhase`), and the
> container refuses a class only when a phase whose hook it declares has finished. Each phase runs
> over its list and then over every value first built while it ran that declares its hook, until none
> is left - so a class a constructor or a hook builds mid-initialization takes part in every phase
> still ahead, and one reached after a phase it declares is refused at the `inject`, with the stack
> that reached it. The state check was also too wide on the other side: a class declaring only a
> shutdown hook was refused after startup, though shutdown runs on everything that exists by then.
> Refusing it now would take away a service that works, so it is built. Three cases in
> `application.orphan-registrations.test.ts`, each red on the old check by reading: the joined
> service's `onAppInit` never ran, the early service was built silently, the teardown service was
> refused. Phases stay finished through shutdown, so a hooked class first reached from a shutdown hook is
> refused where it used to be built without its hooks.

> **The last residue, deregistration and the watch-mode restart, closed on re-check (2026-10-13).**
> Neither described the code any more. Deregistration exists: `unregister` removes a provider and
> evicts a built instance before initialization (D4's test), and `dropUndeclaredOrphanControllers` uses
> it. And the watch mode `zi new` generates does not re-import anything in-process: its
> `OnBuildSuccessPlugin` stops the running server and starts the rebuilt bundle in a new `node`
> process, so each generation starts with empty arrays. Only an in-process hot reload (webpack HMR
> keeping the framework loaded) would re-import into them, and nothing ships one. The user chose to
> close it with proof rather than build a registry reset nothing needs. Held by
> `packages/cli/src/commands/new/new.command.test.ts`, which runs the generated plugin against a fake
> compiler and `spawn`: two builds start two processes and stop the first.

Decorators push into `GlobalRegistry.entityClasses` / `injectables` / `lazyInjectables` at import
time (`src/entity/decorators/entity.decorator.ts:77`). Merely importing a controller registers it
permanently. There is no deregistration, no scoping, and no hot-reload story — a watch-mode restart
re-imports modules into arrays that already contain the previous generation.

### M5. A value that can take more than one shape cannot be declared — MAJOR **FIXED**

> **A property holds a value that names its shape; a body, a parameter and the http client take the
> first shape a value fits.** `@Property.oneOf({ shapes: { Signup: …, Invite: … } })` is declared as
> `OneOf<{ Signup: Signup, Invite: Invite }>` and holds `{ shape: 'Signup', value: … }`, while
> `Body.oneOf`, `WebsocketBody.oneOf`, `Param.*({ type: 'oneOf' })` and `responseBody: { shapes }` take
> a value as a caller sends it. A shape is anything an array item can be — including `file` and
> `unknown` — and a value of several shapes can be the items of an array or sit inside a class used as a
> shape. A list of shapes written directly as a shape is refused, since it says what the flattened list
> says. The routes in a version file are stored with it: `StoredRoute.versions` is
> `OneOf<{ All: 'all', Matchers: VersionMatcher[] }>`, an application holding the plain form stops at
> startup and lists every route to rewrite, and a shape of text takes a property declaring narrower
> text, the way `@Property.string()` already did.
>
> **For a body, a parameter and the client the rule is the first shape, in declaration order, that the value fits** — parsed as that shape, and
> passing that shape's rules. It was arrived at by rejecting two earlier drafts, and both rejections are
> worth keeping. *Choosing by JSON kind with a discriminator for classes* was the first proposal; it
> refuses `string | Date`, `bigint | string` and `string[] | number[]`, all of which ordinary models
> declare. *Choosing by kind and resolving only classes during validation* was the second; it made
> readers that never validate — version files, backups, the cache store, a column transformer — either
> refuse or disagree with a request about which shape the same value is. Zod, valibot and serde all
> choose by trying each alternative in order and keeping the first success; Zod's async union runs every
> option in parallel and still picks by declaration order rather than by which settles first, which is
> why `Promise.race` was not an option. Pydantic recommends discriminated unions for predictability and
> class-transformer only supports them, which is the tradeoff this declines.
>
> **The choice is synchronous and judged by the value alone.** The one async part of validation is a
> `required` written as a function of the request, and that cannot take part: a value read back from
> storage has no request, so letting it steer the choice would read the same value as different shapes.
> A left out property whose `required` is a function counts as fitting, and validation afterwards
> checks the chosen shape completely. Each leaf validator was split into its requiredness check and a
> synchronous `*ValueProblems` function, and `shapeProblems` builds on those — so the choice and
> validation cannot disagree about any rule the choice looks at. So `parseObject` stays synchronous and
> chooses the shape itself, which is what keeps TypeORM's transformers usable once entities take it.
> Each shape is tried on a copy, because parsing converts in place and a failed shape would otherwise
> hand its conversions to the next one.
>
> A value that fits no shape is **one** problem naming every shape and what kept the value from each.
> The OpenAPI schema is `anyOf`, not `oneOf`: `oneOf` asserts exactly one match, and first-fit accepts
> values several shapes match.
>
> **The anyOf test found a defect in the OpenAPI builder.** Its cycle guard kept every class it had
> described anywhere in a schema, not only the classes above the one being described, so the second
> property naming the same class, a sibling and no cycle at all, came out as "Circular reference
> omitted". The response fixture already had that case, `primaryTag` beside `tags: Tag[]`, and its
> assertion, `items: { type: 'object' }`, was one the stub satisfied. The guard now forgets a class once
> its schema is built, and that assertion names `Tag`'s properties.
>
> **Bodies, parameters and the http client, the second round.** A body's metadata no longer carries
> `modelClass`, `isArray` and `allowAdditionalProperties`; it carries one `shape`, the same metadata a
> property holds. `@Body(Model)` is an object shape, `isArray` an array of it, and `Body.oneOf` a
> `oneOf` whose shapes are anything a property's can be except a file — so `A[] | B[]` and a body that is
> one model or a list of them are both expressible, which a list of classes plus `isArray` was not.
> The json parser and validation lost their separate list branches: both read the body through the
> same walk a property takes. The raw text is read as json before it is read as a shape, since a text
> shape would otherwise take the json text itself.
>
> A **form data** body of several shapes was the one that needed its own rule, because which fields
> are files, and which of those are lists, is read off a class before there is a value to choose by.
> The form is read as each class in order and becomes the first whose value fits; each shape has to be a
> class, refused where the decorator is written, and `isArray` on a form is refused the same way.
> Parameters take `{ type: 'oneOf', shapes }`; a path parameter's shapes are limited to text, numbers,
> booleans and dates, in the input type and again at declaration for a route registered without types.
> The http client's `responseBody: { shapes }` types the body as every shape through a seventh type
> parameter defaulting to none, and a manually registered route types its handler's body and
> parameters the same way — which is what `ShapeType` and `DeclaredShape` exist for.
>
> **The round found four defects nobody had filed**, each covered by `one-of-bodies-and-params.test.ts`:
>
> - **Validation dropped the parent path of every nested problem.** An object or array handed its own
>   key rather than its full key to its children, so a problem at `middle.inner.label` was reported as
>   `inner.label`. Every problem now carries its whole path; the root of a body is `body`, and an item of
>   a list body is `1.email` like an item of any list, where its own code path wrote `[1].email`.
> - **An unknown key inside a nested object threw** a `ValidationError('body')` on the spot instead of
>   returning a problem, so the other problems of the same request were never reported, and an object
>   query or header parameter answered as though its body had failed.
> - **A body's size limit doubled for every nested class.** `resolveMaxSize` added the running total to
>   itself when it reached an object property, so a `100kb` body with one nested class allowed `200kb`.
> - **The OpenAPI request body ignored `isArray`**, documenting a list body as one object, and a manually
>   registered route typed its handler's list body as one model.
>
> **Storing it, the second round: the value carries the name of its shape.** An entity used to refuse a
> `oneOf` anywhere in what it holds, because first-fit and storage contradict each other. Encryption,
> hashing and exclude change the value between write and read, so the shape a row is written as is not
> the shape it reads back as; defaults fill in after a shape would have been chosen. Every rule that
> would have made storage safe — refuse those four inside a shape, refuse operators a shape cannot
> answer, tell a `Date` from a text in json — was a rule about a value that does not say what it is. So a
> value says it: `{ shape, value }`, written by the driver as it stands, and nothing is ever guessed.
> All four declarations work inside a shape and follow the shape a value names, the descriptors of the
> model registry carry one descriptor per shape, and a `Date` inside a shape reads back as a `Date`
> where a text that looks like one stays text.
>
> **A filter names every shape.** `{ contact: { whenSignup: { email: { like: '%@x' } }, whenInvite: false } }`
> — `{}` matches every row of that shape, `false` none, and leaving a shape out is refused at runtime
> and while compiling, so a shape added later cannot silently keep matching. On postgres a stored value
> is one `jsonb` column, including an array of them, and the filter compiles to
> `(v->>'shape') = $name AND …` per shape joined with `OR`; the type system needed `infer Name` to tell
> a value of several shapes from an ordinary object, because two conditionals with the same `extends`
> type are compared as equal and the generic soft-delete filter broke on it.
>
> **Two defects came out of the storage round**, both older than it. On valkey, reading a to-many or
> has-one relation never passed the transaction on, so a child written inside a transaction was
> invisible to a read inside that same transaction. And answering such a relation read every row of the
> target table to match a foreign key — which a create with children would have paid on every call, now
> that a create hands back the rows it wrote. Both drivers answer from the rows the save itself wrote.
>
> **The last piece was the scopes, and it was three defects rather than the one named here.** A scope's
> filter and a caller's filter meet on the same property, and the code combining them was written for
> what an ownership scope produces - a value, `oneOf`, `includes` - while a scope is an ordinary
> application filter that reaches every key a caller does. A `whenX` filter on both sides was read as an
> equality against a filter object and the branch dropped, so the call answered **no rows**; two
> `isIncludedIn` lists were joined where the conjunction is their intersection, which **widens** what the
> scope allows; and any other key on both sides was answered "impossible", dropping the branch silently.
> Every key now says what two of it mean, in one table the compiler makes exhaustive, and a value of
> several shapes is combined shape by shape: a shape either side refuses is refused, and a shape whose
> two filters contradict each other is closed while the others stay reachable. What a property holds
> inside it is asked for both at once **of the same row** - "a payment of mine over 100", not "a payment
> of mine and a payment over 100" - which is the narrower reading, and the only direction a restriction
> may be read in.
>
> **One pair cannot be written as one condition at all, and that turned into a filter feature.** Two
> patterns are two patterns - "starts with rent" and "ends with 2026" is neither of them and is not a
> third one - so refusing the call was the first answer, and the user's objection replaced it: those
> filters do not contradict, so rows can match both. `like`, `iLike` and `fuzzyLike` take one value or
> several, and several means every one of them holds. Both stores already had it: postgres joins them
> with `AND` (`And(...)` on the operator path, the same `AND` in the jsonb one) and the evaluator
> checks each. The merge then refuses nothing: every pair is either one condition or provably no rows.
>
> **Two bounds on text looked like the same case and were a different one, which is the largest thing
> this round found.** They cannot be narrowed while the framework does not know which text sorts after
> which - and it did not: the evaluator compared text with the runtime's own `localeCompare` while
> postgres compared it with the collation of whatever database it was pointed at, so the same filter
> and the same order answered differently on the two stores, and a keyset walk over a text column
> paged differently. The user asked whether that could be made one answer without paying for it, and
> it can, on one condition: **the collation belongs on the column rather than on the query**. Named by
> a statement it takes every ordered read off its index; declared on the column it is what the index is
> built in, so nothing changes but the answer. So text is ordered by the application's `defaultLocale`
> - `compareText` on the localize service in process, `<locale>-x-icu` on every text column in postgres
> - and the framework refuses a postgres without that collation at startup rather than letting the two
> drift. **Ordering per request is deliberately not offered** and is filed rather than half built.
>
> **The decision an application with several languages has to make is asked for rather than assumed.**
> Localization refuses to start when its supported locales order text differently and nothing says
> that one order is wanted, naming the two locales that disagree - measured by ordering a probe of the
> texts collations actually tailor (`ä`, `ø`, `ñ`, `ch`, `ł`, the dotted and dotless `i`, French
> accents) rather than read out of collation tables no runtime exposes. It can only miss a
> disagreement, never invent one.
>
> **One equality, shared.** The evaluator's value comparison moved to `WhereValueUtilities`, because the
> merge compares the same values the evaluator does and two answers to "is this the same date" is one
> answer too many.
>
> Choosing a shape translates the messages of every rule that fails and discards
> them; making problem messages translate on read was considered and deferred until a measurement asks
> for it.
>
> **A defect nobody had filed came out with it.** `parseObject` and the parser's query and header array
> parameters handed `parseArray` the array's own metadata instead of its items, so every item was read
> as a nested list and none was restored: a `Date[]` in a request body, a query parameter or a nested
> class arrived as strings. The postgres and valkey paths passed `items` and were right, which is why
> the json column tests stayed green. Covered in `parse-object.test.ts` and
> `parser.array-params.test.ts`; `one-of-validation.test.ts` is what exposed it.

*Filed by this work on 2026-09-15, not by the original review.* Found while fixing the explorer, when
`VersionFile` became a decorated model so `parseObject` could restore its dates:
`RouteWithVersionData.versions` is `'all' | VersionMatcher[]`, and nothing in the metadata model can say
that. It was declared `@Property.unknown()`, which is correct for the data and says nothing about it.

Unions are ordinary TypeScript — a string or a list, a literal or an object, one of several payload
classes told apart by a `type` field — and every place the framework takes a value's shape from metadata
takes exactly one:

| Where a shape is declared | What it accepts |
|---|---|
| `@Property` on models and entities | one kind per property, one item kind per array. Parsing (`parseObject`), validation, the OpenAPI schema and the column type all derive from it |
| `@Body(modelClass)`, `@WebsocketBody(modelClass)` | one model class |
| `Param.path` / `.query` / `.header` | one type per parameter |
| `HttpClient` `responseBody.modelClass` | one class |
| `@Response`, several per status | **already a union**: the OpenAPI builder merges them into `oneOf` (`open-api.service.ts:699`). Documentation only - the router does not use response metadata at runtime |
| constructor injection | a union type has no runtime value to inject by; covered by §D5 (declare the token) |

The escape today is `@Property.unknown()` (or `Record` / `unknown` bodies), and it costs what `unknown`
always costs: no parsing — a date inside stays a string, a bigint cannot round-trip (01 §M27 draws that
boundary on purpose) — no validation, and an OpenAPI schema that says nothing. In framework code the
workarounds are `RouteWithVersionData.versions` and `Metric.labels`; the other `@Property.unknown()`
declarations are generics (`CachedValue.value`, `Event.data`, `Change.previousValue`), where unknown is
the honest answer.

**Not the same problem as the `design:type` one.** 01 §M8 and §M25 record that `emitDecoratorMetadata`
writes `Object` for any union, which limits what a decorator can *check against* the declared type. This
finding is about what a declaration can *express*, and holds with or without emitted metadata.

What a fix has to decide, before any code: how a union is written (a list of alternatives tried in
order, or a discriminator field naming the alternative — the latter is what makes parsing and
validation unambiguous and maps to OpenAPI's `discriminator`), how a parse failure against all
alternatives is reported, and how a union property is stored (a json column on postgres, like an object
property today).

---

## P. Packaging and distribution

### P1. The ESM entry point is built by a script that swallows all errors — ~~MAJOR~~ **FIXED**

> **Closed by deleting the build, not by fixing the script** — and the order in which that became
> obvious is the point. The script's own defect is exactly the one it looks like: `renameEsmIndex`
> contains no rename. It reads `dist/esm/index.mjs`, a file `tsc` never emits, so the first
> `readFile` throws ENOENT into a `catch {}` that reports success, and the call is not awaited
> either. Adding the missing `rename` is a two line fix.
>
> Two more layers sat under it, each found by running it rather than reading it:
>
> 1. **The renamed file would not load.** `dist/esm/*.js` contains zero `import`/`export` statements
>    - it opens with `"use strict"; var __importDefault = …`. `tsconfig.esm.json` asked for
>    `module: nodenext`, which takes the format from the nearest `package.json`, and there is no
>    `"type": "module"`, so the esm build emitted CommonJS into a folder named `esm`. Renaming
>    CommonJS to `.mjs` produces `ReferenceError: exports is not defined in ES module scope`.
> 2. **Forcing the format exposes the real blocker.** `--module es2022` does emit real esm, and it
>    then fails with `ERR_MODULE_NOT_FOUND` on its own first relative import: the source writes
>    `from './application'`, and node's esm resolver requires the extension. There is no tsc-native
>    fix - `rewriteRelativeImportExtensions` only helps a source that already writes them - so a real
>    esm build needs a bundler or a rewrite pass over every emitted import.
>
> **What decided it was the DI container, not the build cost.** `GlobalRegistry` and `DiContainer`
> are module level singletons ([D7](#d7-the-container-is-a-module-level-global--major)). In a genuine
> dual package, a consumer graph that reaches both halves holds two of each, and every `inject()` on
> one side is blind to everything registered on the other - a silent, total failure of dependency
> injection rather than a tree-shaking tradeoff. So the package ships one build.
>
> An esm consumer loses nothing that ever worked: `import` of the CommonJS build resolves all 460
> named exports through node's `__exportStar` interop, and `resolveAppRoot` - the one function that
> depends on the consumer's entry point - already falls back from `require.main` (undefined under an
> esm entry) to `process.argv[1]`. Both verified by running them, and both now held by
> `published-package.test.ts`, which loads the built package in a process of its own and asserts
> `require` and `import` reach the same module object.

`post-build.mjs`

```js
const esmIndexJs   = path.resolve('dist/esm/index.js');
const esmIndexMjs  = path.resolve('dist/esm/index.mjs');
const esmIndexMapJs  = `${esmIndexJs}.map`;

async function renameEsmIndex() {
    try {
        let js = await readFile(esmIndexMjs, 'utf8');            // line 13
        ...
        const mapContent = JSON.parse(await readFile(esmIndexMapJs, 'utf8'));   // line 18
        ...
    }
    catch {}                                                     // line 22
}
renameEsmIndex();                                                // line 25 — not awaited
```

Three defects in twenty-five lines:

1. **It reads a file `tsc` did not emit.** Line 13 reads `dist/esm/index.mjs`, but line 18 reads
   `dist/esm/index.js.map` — which only exists if `tsc` emitted `index.js`, not `index.mjs`. The
   `readFile` at line 13 therefore throws ENOENT.
2. **`catch {}` swallows it.** The build reports success either way.
3. **`renameEsmIndex()` is not awaited** (line 25), so even on the happy path the process may exit
   before the writes flush.

`package.json:12-16` declares `"import": "./dist/esm/index.mjs"`. If that file is never produced,
`import { ZibriApplication } from 'zibri'` fails with `ERR_MODULE_NOT_FOUND`. Nothing in CI would
catch this — see [06-tooling-ci-and-testing.md](./06-tooling-ci-and-testing.md) §CI4.

### P2. The ESM build has no `"type": "module"` marker — ~~MAJOR~~ **FIXED**

> Closed with [P1](#p1-the-esm-entry-point-is-built-by-a-script-that-swallows-all-errors--major-fixed),
> which it turned out to be a layer of rather than a finding beside. The missing marker is why the
> esm build emitted CommonJS in the first place, and adding one would have moved the failure from
> "the entry point does not exist" to "the entry point's first relative import does not resolve"
> rather than fixing anything. There is one build and one `default` condition now, so there is no
> second format to mark.

`package.json` has no top-level `"type"` field, and `post-build.mjs` writes no
`dist/esm/package.json` containing `{"type":"module"}` — the standard dual-package technique. Only
`index` is given an `.mjs` extension; every other file under `dist/esm/` stays `.js`.

Node resolves `dist/esm/*.js` as **CommonJS** while those files contain ESM `import`/`export`
syntax. The first relative import out of the entry point therefore fails with
`SyntaxError: Cannot use import statement outside a module`.

Combined with P1, the ESM half of the dual build is unverified end to end.

### P3. Nine mandatory peer dependencies, including a compiler — ~~MAJOR~~ **FIXED**

> **Four of twenty are mandatory now**: `bignumber.js`, `jsonwebtoken` and `rxjs`, which are core,
> and `zibri-tsx`, which is the templating engine. *(Three since 2026-10-05: `jose` replaced
> `jsonwebtoken` as an optional peer, [03 §H12](./03-auth-and-security.md).)* Everything this finding names is optional, each
> one declared by a feature and checked while the application starts.
>
> **The compiler half went first.** `ts-node` is registered on demand, only for a file that is
> actually TypeScript, and marked optional — see [04 §5.1](./04-infrastructure-subsystems.md) for
> the whole of it, including the second call site the finding did not name.
>
> **The count got worse before it got better.** Hiding each peer from the resolver in turn and
> loading the built package said that **13 of the 14 were required to load `zibri` at all**, and
> that three of the four this finding lists as optional were among them - `bcryptjs`,
> `@valkey/valkey-glide` and `handlebars` were each a top level import in a module the barrel
> re-exports. Only `pg` was what it claimed to be. That is
> [04 §5.1b](./04-infrastructure-subsystems.md), which carries the fix and the rule behind it: a
> check belongs where a feature is declared, never where it is used.
>
> So the sentence below about the split being inverted was right for a sharper reason than it gives:
> `pg` was not merely the more defensible thing to call optional, it was the only one of the four
> that was.
>
> **A second compiler was hiding in a place no peer list could show** (found 2026-09-15, from a
> source-map warning in the sandbox's webpack build). The source translation extractor imported
> `typescript` at the top of a module the barrel re-exports, and `typescript` was not a peer at all -
> only a devDependency. So the "hide each peer and load the package" method that found the thirteen
> above structurally could not find this one: it hides what the manifest declares, and this was
> declared nowhere a consumer sees. Two consequences, both invisible in this repository because every
> suite runs with devDependencies installed. **Unbundled**, a production image that prunes its
> devDependencies failed on `require('zibri')`. **Bundled**, the bundler followed the import and
> shipped the compiler inside the application: 8.7 MiB of the sandbox's 15.3 MiB bundle, for a
> function that only ever runs from a webpack config. It is an optional peer now, loaded through the
> same `optionalPeer` as `xmlbuilder2` - the other dependency of the same feature, which had been
> handled correctly all along - and `optional-peer-dependencies.test.ts` carries the three checks the
> others do. **The rule the method needed: a peer check has to start from what the built code
> resolves, not from what the manifest lists** - an undeclared dependency is the one shape a
> manifest-driven check cannot see.
>
> **The method needed one more correction, from the other direction** (found 2026-09-20, when
> tracing added `@opentelemetry/api` as an optional peer). Hiding a package from the resolver
> outright hides it from *every* package in the process, and `prom-client` - a dependency of the
> framework rather than a peer - requires `@opentelemetry/api` at the top of one of its files. So
> the check reported that the framework could not load without it, when what could not load was
> prom-client. The resolver refuses an optional peer only where one of the framework's own files
> asks for it now, which is the whole of what optional claims: **that this package never reaches
> for one while loading**. What another package requires arrives with that package whatever this
> manifest says, and measuring it here measures the wrong manifest. The check still has its teeth -
> hiding a package the framework's own dist does import still refuses `require('zibri')`.

`package.json:57-85` declares thirteen `peerDependencies`; `peerDependenciesMeta` (`:69-81`) marks
only four optional (`bcryptjs`, `pg`, `@valkey/valkey-glide`, `handlebars`).

**Mandatory for every consumer:** `bignumber.js`, `jsonwebtoken`, `otpauth`, `pdfmake`, `rxjs`,
`socket.io`, `ts-node`, `xmlbuilder2`, `zibri-tsx`.

A plain REST API with no PDFs, no websockets, no XML and no 2FA must still install `pdfmake`,
`socket.io`, `xmlbuilder2` and `otpauth`. `ts-node` as a mandatory **runtime** peer of a production
framework (see [04](./04-infrastructure-subsystems.md) §5.1) is the item a supply-chain or
container-hardening review will stop on.

The optional/mandatory split is also inverted relative to actual optionality: `pg` — the primary
database driver — is optional, while `pdfmake` is not.

### P4. The published package ships the entire source tree — ~~MINOR~~ **FIXED**

> **Measured before it was fixed, and it is not minor: the tarball installs 50.0MB, of which 37.6MB
> is one HTML coverage report.** `npm run test:coverage` writes into `src/__testing__/coverage`,
> which `.gitignore` covers — and every consumer of `zibri` was downloading it, along with 232 test
> files. `dist` is 6.5MB and the sources behind it 3.7MB, so the finding's "roughly doubles" is off
> by a factor of five in the wrong direction.
>
> **Why an ignore file could not have caught it, which is the part worth keeping.** `files` is a
> whitelist, and naming a directory in it publishes everything underneath regardless of
> `.gitignore` or `.npmignore` — both were tried and measured making no difference at all. The only
> thing that carves anything back out is a `!` entry in `files` itself, and it has to be written
> without a leading `./`: `"!./src/__testing__"` is silently inert, `"!src/__testing__/**"` works.
> That silence is what let this sit — a wrong exclusion pattern reads exactly like a right one.
>
> ```json
> "files": ["./src", "!src/**/__testing__/**", "!src/**/test/**", "!src/**/*.test.ts",
>           "!src/**/*.test.worker.*", "./dist", ...]
> ```
>
> The `__testing__` exclusion was first written for the top level folder only, which let nested
> fixture folders such as `src/application/__testing__` ship. It matches at any depth now.
>
> **50.0MB → 10.26MB, 4725 files → 3283**, with every one of the 1442 dropped files verified to be
> test material and no source lost.
>
> **The source tree itself stays, deliberately.** `declarationMap` and `sourceMap` are on, so
> following a framework method in an IDE should land on what it does rather than on a stripped
> `.d.ts`; publishing those maps without the sources they point at would be a promise the package
> does not keep. Shipping `dist` alone would have been 6.5MB, and shipping neither maps nor sources
> 4.7MB — both were on the table and both were declined for that reason.
>
> `src/__testing__` is now absent rather than merely unreachable, which makes
> [06](./06-tooling-ci-and-testing.md) §T2 a question that has to be answered rather than one that
> could be shrugged at. See its own note for what answering it costs.
>
> **It came back through the other door, and the test caught it** (2026-09-05). The tarball had 93
> compiled test files in `dist/cjs/__testing__` and was 15.3MB again, from a build that compiled
> none of them: `tsc` overwrites what it emits and removes nothing else, while `files` ships the
> *directory* rather than the build's output, so anything an earlier build left behind goes out with
> the next one — here, output from a day-old run whose configuration reached further. `build` empties
> `dist` first now.
>
> **The exclusions above could not have stopped this and neither could CI.** Every `!` entry is a
> `src` path, because `dist` is supposed to be exactly what the build produced; adding
> `!dist/**/__testing__/**` beside them would hide the next build that genuinely emits the wrong
> thing. And CI builds into a fresh checkout every time, so the only machine where `dist` has a
> history is a developer's — which is also the machine that would have run `npm publish` by hand.
>
> **Past the 15MB ceiling once more, through growth this time, and three things were found
> (2026-10-11, investigated with the user).** The tarball installed 15.36 MiB: sources grew 4.78 →
> 5.96MB since the last commit, mostly real features (authenticators, SCIM, 2FA). Looking instead of
> raising the ceiling found:
> - **21 shared test-case files shipped**: `.cases.ts` (the suffix CODE_STYLE gives them) was in
>   neither the `files` exclusions nor the "ships no test material" check. Red first, then
>   `"!src/**/*.cases.ts"`.
> - **The PDF fonts shipped twice and rendered wrong.** `pdf.utilities.ts` embedded Roboto as two
>   base64 strings — 1.29MB in `src` and again in `dist`. They were *variable* fonts, which pdfkit
>   draws at their default weight only, so bold text in every generated PDF came out regular (red
>   first in the new `pdf.utilities.test.ts`). The optional peer `pdfmake` ships the static cuts
>   itself (`pdfmake/build/vfs_fonts`), so zibri ships no font now and bold maps to Roboto Medium.
> - **Comments were 32% of the built JavaScript.** The build is two passes now:
>   `tsconfig.cjs.code.json` (`removeComments`, no declarations) and
>   `tsconfig.cjs.declarations.json` (declarations only, keeping the JSDoc editors show). The sources
>   ship with every comment and the maps lead to them. A published-package case checks both halves.
>
> **15.36 → 11.44 MiB**, and the ceiling tightened to 12 (the user's choice): growing past it is
> a reason to look at what grew.

`package.json:19-25` — `files: ["./src", "./dist", ...]`. This roughly doubles install size, ships
`src/__testing__/`, and (per [02](./02-http-runtime-core.md) §C6) ships the 382 leaked
`src/di/default/temp/` directories. It also makes the "not exported" problem in
[06](./06-tooling-ci-and-testing.md) §T2 more galling: the test helpers are physically present in
`node_modules` and still unreachable through the `exports` map.

### P5. Version skew across the monorepo — ~~MINOR~~ **FIXED**

`packages/zibri` pins `@types/node: ^25.9.1`; `packages/tsx` and `packages/cli` pin `^22.19.17`.
`packages/zibri` uses `typescript: ^5.9.2`; the other two use `^5.8.3`. The packages are built and
published together from one lockfile, so the type-checking surface differs between packages that
are meant to interoperate.

> **Fixed (2026-09-28), and the declared ranges were the smaller half.** The installed tree held
> four `@types/node` majors: 25 for `zibri` and `zibri-testing`, 22 for the cli and the compiler,
> 24 for the sandbox and every generated project. Every package declares `engines: >=24`, and
> CI tests that floor plus each line node still maintains (`supported-node-majors.mjs`). Node 25
> reached end of life on 2026-06-01, so no CI job runs it. **So the framework was type-checked
> against a runtime newer than the one it promises**, where an api only 25 has compiles and fails
> on 24. `typescript` was one installed copy with ranges that disagreed on paper, except that
> `zibri-tsx` declared `^5.9.2` as its peer and developed against `^5.8.3`, a version it
> refuses to consumers. `eslint` was `^9.24.0` beside `^9.36.0`.
>
> **The rule now: `@types/node` follows the `engines` floor.** `engines` already decides what
> CI runs, so the one declaration decides both. All five manifests declare `@types/node ^24.0.0`,
> `typescript ^5.9.2` and `eslint ^9.36.0`. Three cases in `ci-workflows.test.ts` hold it, and all
> three were red first:
> - A dependency declared by two workspaces uses one range. This is a general rule rather than a
>   list, so a tool added later is covered.
> - `@types/node`'s major equals the floor.
> - A development range never falls below the package's own peer range.
>
> **Checked against Node 24's types before any install**, by pointing a scratch tsconfig at the
> copy the sandbox already had. The shipped build compiles cleanly. One test,
> `jwt-auth.asymmetric.test.ts`, did not: it typed a JWK through `webcrypto.JsonWebKey`, which
> only Node 25's `createPublicKey` accepts. It now uses `JsonWebKeyInput['key']`, which is what
> the function takes on either line.
>
> Kept per package rather than hoisted to the root, by choice: a manifest keeps saying what its
> package builds with, and peer ranges are per package anyway.

### P6. `versions` and `translations` resolve on opposite sides of the bundle — ~~MINOR~~ **FIXED**

> **The asymmetry is the answer, and the entry had it backwards.** Both paths are right, and the
> rule they follow is one sentence: what is read is read from inside the bundle, and what is written
> lives beside it. `assets`, the compiled templates and `translations` are all read from `__dirname`
> and all copied into `dist` by the build. `versions` is the only one the application *writes*, so it
> resolves from the application root — and `FILE_UPLOAD_TEMP_FOLDER`, the other written path, sits
> beside it there.
>
> So "which shape is a deployment" had an answer already, and it was not the one this entry assumed
> either. A deployment is never `dist` alone: the bundle leaves `express`, `handlebars` and `ejs` as
> runtime requires, so an image carries `node_modules` and the `package.json` above them, and that
> directory is what `resolveAppRoot` finds. `dist/versions` could not be read even by a deployment
> that wanted it to be.
>
> **What was actually wrong is the copy, not the resolution.** The generated webpack config copied
> `versions` into `dist/versions`, where nothing reads it and nothing can be made to: `output.clean`
> empties that folder on every build, so a snapshot written there would not survive one. The pattern
> is gone from the generated config and from `packages/sandbox`. It was harmless — the original is
> the one that is read, and the copy was regenerated every build — and it was removed anyway,
> because the folder it created is the thing a person writing a Dockerfile sees before deciding
> whether `versions` needs a `COPY` line of its own. It does.
>
> The rule this settles is written down in [`docs/deployment.md`](../packages/zibri/docs/deployment.md),
> which is where the four-folder layout of a deployment now lives.

*Opened while closing [06 §T1](./06-tooling-ci-and-testing.md), not part of the original review.*

The generated webpack config copies both folders into the bundle
(`webpack.config.js:225-230`, one `CopyPlugin` pattern each). At runtime the framework reads them
from different places — `di/default/zibri-di-providers.default.ts:183,187`:

```ts
VERSIONS_PATH: { useFactory: () => FsUtilities.getPath(resolveAppRoot(), 'versions') },
TRANSLATIONS_PATH: { useFactory: () => FsUtilities.getPath(__dirname, 'translations') },
```

Versions come from *beside* `dist`, so the copy inside it is never read. Translations come from
*inside* `dist`, so the folder the project keeps them in is never read. Same build step, opposite
answers.

Neither is broken today, because the build copies both and each therefore finds something. What has
no answer is which shape a deployment is: the project directory with a `dist` in it, or `dist`
alone. `FILE_UPLOAD_TEMP_FOLDER` and `VERSIONS_PATH` say the first; `TRANSLATIONS_PATH` says the
second, and a deployment that ships only the bundle has translations and no versions.

The symmetry is a trap rather than the fix, which is why this is filed instead of closed: moving
`TRANSLATIONS_PATH` to the application root to match its neighbour breaks exactly the deployment
that ships `dist` on its own. The two are answering different questions about the same build, and
the question to settle is which one the framework means — not which line looks out of place.

Both are DI tokens as of [06 §T1](./06-tooling-ci-and-testing.md), so a project that disagrees can
already say so. This is about the default.
