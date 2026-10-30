# Data layer: repository, drivers, entities — code review

Extracted from the evaluation chapter [01-data-layer-repository.md](../01-data-layer-repository.md);
`D` ids refer to its findings. These are shape, duplication and style, with the evaluation's
severity scale. Cross-cutting: [09-architecture-and-code-quality.md](./09-architecture-and-code-quality.md).

### Q1. `repository.ts` is 2959 lines holding four concerns — MINOR
The class carries the public API, the whole `upsert` preparation (`repository.ts:946-1585`, ~640 lines,
nine private methods and three local types), owned-row writing (752-943, 2872-2959) and the tenant
reference checks (486-564). CODE_STYLE's "group related functions into a utility class" is what
`OwnedRelationUtilities` and `TenantUtilities` already did for the pure halves; the stateful halves
(`prepareUpsert`, `runUpsert`, `writeOwnedRows`) could follow as collaborators taking the driver and
hooks, which would also make the per-call sequence (copy → id → tenant → uuids → hooks → scope →
references → write → read back) visible once instead of five times (`create` 703-749, `createAll`
1593-1645, `prepareUpsert` 1137-1187, `saveUpdate` 2151-2225, `updateEach` 2269-2341).

> **Closed 2026-10-29** (user's decision: three collaborators). `repository.ts` went from 3803 to
> 2904 lines. `ReferenceValidator` (`reference.validator.ts`) holds the tenant reference checks and
> the tenant resolution of updated rows, built from the entity, its metadata and the data source;
> `OwnedRowWriter` (`owned-row.writer.ts`) holds the owned-row halves: taking the values off the
> data, writing, removing and refusing referenced rows, and the missing-id lookup, built with the
> validator and with `updateEach` of another repository handed in as a function, since that method is
> protected and only a repository may call it on another; `UpsertWriter` (`upsert.writer.ts`) holds
> `prepare` and `run` with every private step of the upsert, built with the driver, the validator and
> an `UpsertWriterContext` of the repository's `beforeSave`, `validateWithinScope`, `findAll`,
> `resolveRelated` and `inTransaction` as arrow functions, so a subclass's overrides are what it runs.
> The pure steps went where they belong: `WriteDataUtilities.assignId` and `writeUuidsInLowerCase`,
> `ScopeWhereUtilities.isReadByScope`, `TransactionUtilities.resolveWriteTransaction`, and
> `resolveOutOfScopeError` as a function under `scopes/`. The per-call sequence is two repository
> methods now, `prepareNewRows` (create, createAll) and `prepareChangedRows` (saveUpdate, updateEach),
> generic in the rows so the create data type stays out of the instance type; `applyUpdateAll` and
> `updateAllBound` keep their own order because the bound branch sits inside it. No behavior changed:
> the in-memory shared cases (36 suites), the repository, change-set, tenancy and role suites and the
> layering test are green; the container-backed repository suites are the user's to run.

### Q2. Five hand-written forwarding drivers, two of them near-duplicates — MINOR
`DeadlineAware`, `RoleValidating`, `RoleReporting`, `MembershipReporting` and `Traced` each re-declare all
twelve `RepositoryDriverInterface` methods with `// eslint-disable-next-line jsdoc/require-jsdoc` on each
(e.g. `deadline-aware.repository-driver.ts:28-97`): roughly 400 lines of forwarding. `RoleReporting` and
`MembershipReporting` are the same program — read before, forward, `report` after commit via
`transaction.afterCommit`, swallow and log (`role-reporting.repository-driver.ts:123-162`,
`membership-reporting.repository-driver.ts:146-180`). A forwarding base class (or one interceptor
driver taking before/after callbacks) removes the boilerplate, and an entity-write event would replace
both reporters outright — the user's after-all list item 1 already asks whether the generic systems
can serve each other, and this is the concrete instance. The chain is also wired in a constructor
expression (`repository.ts:250-259`) rather than declared, so adding a sixth is editing nesting.

> **Partly done 2026-10-21**, on the way to closing [01 §D1](../01-data-layer-repository.md): a
> `ForwardingRepositoryDriver` base hands every operation on, and the five wrappers extend it and
> override what they intercept - the reporters and the validator lost their forwarding halves. What
> remains open is the two near-duplicate reporters, which an entity-write event would replace, and
> the chain still being a constructor expression.

> **Closed 2026-10-26 with 09 §Q1:** the validator and both reporters are one
> `WriteObservingRepositoryDriver` and three observers that the services register. The chain is
> three wrappers deep, two of them cross-cutting by the user's call.

### Q3. Service locator in the write hot path — MINOR
Every write through `RoleValidatingRepositoryDriver` resolves `ROLE_SERVICE` (`role-validating.repository-driver.ts:77-79`),
and `USER_SERVICE` and `MEMBERSHIP_SERVICE` (312-319) through `inject()` per call; `removeRows` injects
`USER_SERVICE` per delete (`repository.ts:2890`). Constructor injection is impossible because the drivers
are built inside `Repository`'s constructor before the container is relevant, which is itself a symptom
of Q2: the wrappers are not providers. Cheap today, but a container lookup per statement is the kind of
thing a profiler flags first.

> **Narrowed 2026-10-26 by 09 §Q1:** a write to an entity nobody observes injects nothing once
> `onAppInit` is over, since the seam keeps the observers it found. An observed write still resolves
> the role service per write, through the user and membership observers. `removeRows` still asks
> `USER_SERVICE` per delete: 09 §Q9 closed on runtime imports, and that lookup goes through a token.

> **Closed 2026-10-29.** `repository.container-lookups.test.ts` spies on the container and names
> every token a write resolves; red, a delete by id resolved seven (`TRACER` twice, `REPOSITORY_HOOKS`
> three times, `ENCRYPTION_SERVICE`, `USER_SERVICE`) and a user with roles nine, so the hooks and the
> traced driver were the larger half of the finding. Now none: `Repository` resolves its hook
> services (`RepositoryHookServices`: hooks, encryption, hash) and the user service once, on first
> use rather than in the constructor, since a repository is built while its data source initializes;
> `RepositoryHookUtilities` takes them as arguments; `TracedRepositoryDriver` resolves the tracer once
> and hands it to `TracingUtilities` through the new `tracer` option; `UserWriteObserver` and
> `MembershipWriteObserver` take the role service in their constructors, given when they are
> registered in `onAppInit`. Left alone: the per-user-delete lookups of the membership and auth
> services inside `removeRows`, and the `private get xService()` getters of the services, which are
> not the write hot path.

### Q4. Class helpers: semantics nobody wrote down — MINOR
(09 listed these as unreviewed.) `OmitClass`/`PickClass`/`IntersectionClass` build a fresh class and copy
descriptors and metadata onto it (`omit-class.model.ts:15-17`, `copy-class-properties.function.ts:91-143`),
so an instance is not `instanceof` the base; `PartialClass` extends the base instead
(`partial-class.model.ts:15`), so it is, and inherits the base's `@Entity` metadata through
`getEntityMetadata`'s prototype walk (`metadata.utilities.ts:597-599`) without being registered as an
entity. `PartialClass` lowers `required` on the top level only (nested models stay required).
`IntersectionClass` concatenates controller routes of each base (`copy-class-properties.function.ts:128-135`),
so two bases sharing a method name register the route twice. `copy-class-properties.function.ts` exports
three functions from one `.function.ts` with `jsdoc/require-jsdoc` disabled on each — CODE_STYLE says a
second function beside the first makes a utilities class. `docs/models.md:247-280` documents the
happy path only. None of this is a defect in the tests that exist (`copy-class-properties.function.test.ts`
covers validation), but an adopter building DTOs on these will hit `instanceof` and the route
duplication without a sentence to read.

> **Closed 2026-10-29.** `copy-class-properties.function.ts` is `ClassPropertyUtilities` (`copy`,
> `resolvePrototypeKeys`, `resolveStaticKeys`; the descriptor lookups private, JSDoc instead of the
> disables). The route duplication was the one defect: `copy` drops a route the target holds for a
> method the source defines, so a member two bases of `IntersectionClass` share comes from the last
> base with its route, as its descriptor and reflect metadata already did. `class-property.utilities.test.ts`
> boots a combined controller for it and was red with `shared` registered twice; the same suite pins
> `instanceof` (false for Omit, Pick and Intersection, true for Partial) and that `PartialClass` leaves
> a nested model's requirements, and runs in memory now. `docs/models.md` (Deriving models) states the
> three, `creating-endpoints.md` the route rule. `PartialClass` inheriting the entity metadata stays:
> its effects are the checks, judged only on the properties a body holds (validation.md says so), and
> the scope note in the OpenAPI document.

### Q5. Naming against CODE_STYLE — MINOR
`writeTransaction` (`repository.ts:277`) resolves and records, so it is a `resolveX`; `scopeReads`
(1533), `givesOwnedRows` (757), `conditionsOn` (687), `withTenantKey` (1102), `isAnsweredByOwnedRows` (898)
are predicates and builders named as prose; `getChangesFromData` and `getCreatedBy`
(`change-set-repository.ts:623, 647`) do work (a merge, a request lookup) and are `getX`. Not linter
nits — these are the verbs the guide reserves to say what a call costs.

> **Closed 2026-10-29.** `resolveWriteTransaction`, `resolveConditionsOn`, `hasOwnedRows`,
> `resolveIdentityWithTenantKey` and `isReadByScope` in `repository.ts` (all private);
> `resolveChangesFromData` and `resolveCreatedBy` on `ChangeSetRepository` (protected, so
> `upgrading-to-3.md` names them under *Overridable methods say what they cost*).
> `isAnsweredByOwnedRows` was a predicate already. Renames only; the suites hold the behavior.

### Q6. Stale, store-specific comments in option models — MINOR
`update-by-id-options.model.ts` and `update-all-options.model.ts` carry a commented-out `allowId` with
"that would cause typeorm's manager.save method to create a new entity" — a typeorm detail in a model
file (CODE_STYLE: no data-source specifics outside the data source), and dead code in a type.

> **Closed 2026-10-29.** Both commented-out `allowId` lines and their typeorm sentence are gone; the
> option exists on `CreateOptions` alone, which is where a row may bring its id.

### Q7. Two code paths for one soft delete — MINOR
`SoftDeleteRepository.deleteById` (`soft-delete-repository.ts:245-258`) does `findById` + `saveUpdate` +
`createChangeSet` + `softDeleteOwnedRows` by hand while `deleteAll` goes through `markDeleted`
(289-311). The singular path could be `markDeleted({ id })`, which would also close the small difference
that `deleteById` throws on an already-deleted row and `deleteAll` counts zero.

> **Closed 2026-10-29.** `deleteById` keeps its read first, which is what tells not found from
> conflict from forbidden, and then goes through `markDeleted` with the id composed into the caller's
> condition (`resolveWhereOfRow`), as `deleteAll` does; a write that misses after the read is a
> conflict, as for an update. The dead `entity.deleted` guard went with it. A row already deleted stays
> not found by id and counted zero in bulk: that is the by-id contract, not a divergence.
> `soft-delete-repository.test.ts` holds the conditional delete by id (holds, conflict, not found, one
> change set), and the cost test still sees `findOne`, `updateAll`, `ChangeSet.insert`.
