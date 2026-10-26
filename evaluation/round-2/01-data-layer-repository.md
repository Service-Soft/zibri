# Data layer: repository, drivers, entities — round 2

Read in full: `packages/zibri/src/data-source/repository/repository.ts` (2959 lines, modified in the
working tree), the whole driver chain (`deadline-aware`, `role-validating` (untracked, new),
`role-reporting` (untracked, new), `membership-reporting`, `traced`, `typeorm.repository-driver.ts`,
`find-upsert-targets.function.ts`), `repository-driver.interface.ts`, `scopes/**`
(`resolve-entity-scope.function.ts` modified), `tenancy/tenant.utilities.ts`, `hooks/**`,
`owned-relation.utilities.ts`, `write-data.utilities.ts`, `validate-write-is-not-blind.function.ts`,
`entity-ownership.function.ts`, `data-source.service.ts`, every `models/options/*.model.ts`, the
keyset files, `change-sets/change-set-repository.ts` and `soft-delete-repository.ts` (both modified),
`entity/decorators/entity.decorator.ts`, the relation half of `property.decorator.ts`,
`base-entity.model.ts`, the four class helpers and `copy-class-properties.function.ts`,
`MetadataUtilities`' model-property store, the relation-resolving part of
`val-key.repository-driver.ts` (1935-2110), `getRepository` of the typeorm base data source, and the
docs `data-source.md`, `costs.md`, `models.md` (deriving models), `tenancy.md` (relations). Cross-checked
against `evaluation/01-data-layer.md` (headings, §M14, the cost table, the MINOR/DX list), 03 §A2's
"what it does not cover" notes, `09`, `10`, `11` and `after-all-findings-fixed.md`. Not read: the rest of
`val-key.repository-driver.ts`, `value-conversion.utilities.ts` and `migration/**` (the data-source
reviewer's), `entity/generation/**`, the where-filter model files beyond `where-filter.model.ts`, and the
bulk of the test suites (only their `it(...)` names were grepped for coverage).

Nothing in this chapter was run; every statement is read off the code at the cited lines.

## CRITICAL

None. The two findings below that touch authorization (D1, D3) each need the application to do
something specific first (ask for a relation on a scoped entity; expose `allowId`), so neither is a
live defect in every deployment. Both are filed MAJOR with that said explicitly.

## MAJOR

### D1. A row read through a relation is not narrowed by its own entity's scope — ~~MAJOR~~ **FIXED**
*Filed 2026-10-21.*

`Repository.scopedWhere` (`repository.ts:388-419`) narrows the filter of *this* entity and hands the
result to the driver, together with `relations` untouched (`toDriverFindOptions`, `repository.ts:306`).
On postgres the driver forwards `relations` straight into typeorm's `find`
(`typeorm.repository-driver.ts:161-172`, `orderAndRelations` at 285-290), which resolves them with a
join. On valkey `resolveRelationOf` builds a fresh `ValKeyRepositoryDriver` for the target entity
(`val-key.repository-driver.ts:2046-2051`) and reads through it. Neither path goes through the target
entity's `Repository`, so `resolveEntityScope` is never asked about the related rows.

Concrete scenario, straight from the docs' own example (`docs/data-source.md:1179-1201`): `Invoice`
declares `restrictedTo: { userId: ctx.currentUser.id }`. `Customer` declares
`@Property.oneToMany(() => Invoice)`. A handler calls `customerRepository.findAll({ relations:
['invoices'] })` — or `Customer` lists `invoices` in `defaultRelations` — and every caller receives every
invoice of every user. `invoiceRepository.findAll()` on the same request answers only theirs. The write
side has the mirror image: `create({ customerId })` on a scoped `Customer` is checked against the
*tenant* of the customer (`validateReferencesInTenant`, `repository.ts:486-535`) but not against its
scope, so a caller can attach rows to a parent they may not read, and through the read half above those
rows then surface to whoever reads the parent.

Deliberateness checked: `docs/data-source.md:1206` says "every repository call is narrowed by it, reads
and writes alike", and the "Reading relations" section (690-721) says nothing about scopes. 03 §A2's two
"what it does not cover" paragraphs list upsert identities, encrypted scope columns and the OpenAPI
document, not relations. The tenant layer deliberately relies on a write-time invariant instead of
narrowing reads (`repository.ts:478-481`), and that reasoning does not transfer to scopes: a scope is a
per-request function of the caller, so no write-time invariant can stand in for it. Nothing in
`auth-row-ownership.evaluation.test.ts` reads through a relation.

Fix direction is not obvious, which is why it is worth deciding rather than patching: either resolve
each level of a relation tree through the target's repository (`scopedWhere` of the target applied as
the nested `where` the drivers already support), which costs a read per level the drivers already pay on
valkey, or refuse at boot a relation whose target declares a scope unless the relation opts in. The
second is cheaper and honest; the first is what a caller expects.

**Verify:** in-memory `startTestServer`: two scoped entities with a `oneToMany` between them, two logged-in
users, rows of both; `parentRepository.findAll({ relations: ['children'] })` as user A must hand back only
A's children on every data source. Add the write half: `childRepository.create({ parentId: <B's parent> })`
as A should be refused.

> **Closed 2026-10-21, together with §D2, by the first of the two directions the finding offered.** A
> call now resolves a *related narrowing* beside its own scoped filter: for every entity it reaches
> through a relation - the ones it resolves, the ones its filter names, and the ones the narrowing of
> an entity reached names in turn - the rows the caller may see of that entity, which is its
> `restrictedTo` scope combined with `deleted: false` when it soft deletes. `unscoped` on the call
> lifts the scopes of the related entities as well. The narrowing travels to the driver as `related`
> on every read, on `updateAll`, and as a trailing parameter of `updateEach` and `upsert`, and every
> store applies it wherever a relation is resolved or judged: the rows a relation holds at every
> level, a `where` through a relation, and `length`, `includes` and `isIncludedIn`.
>
> **Postgres keeps loading relations as joins, narrowed in the join.** A plain join hands back every
> related row there is, so the typeorm driver joins each relation under an alias of its own with the
> related entity's narrowing as the join's condition - rendered by the converter that renders every
> other filter, with its parameters renamed past the orm's per-query numbering, and kept as an
> inner select only where the narrowing itself reaches through a relation. A read with relations
> stays one query (two when it pages) however deep the tree goes; `repository-costs.cases.ts`
> measures a relation of a relation at that. (A first version read every relation as rows of the
> related entity instead, one read per relation per level, which the costs table showed to be the
> wrong trade.) Valkey reads a relation that way, through `RelationResolutionUtilities` (the
> in-memory driver keeps its own loader because it is synchronous by design). A filter through a
> to-many relation is judged in SQL, so the three sub-select operators got an inner select naming
> the rows the caller may see, built the same way.
>
> **The write half closed with it**: a write pointing a row at a row the caller may not see is
> refused the way one pointing at another tenant's row is, through `validateReferences` (the former
> `validateReferencesInTenant`), which reads the rows pointed at under the scopes the call is not
> exempt from. One existing case asserted a `404` for linking a hidden child; it is a `403` now,
> answered alike for a hidden row, another tenant's and a missing one.
>
> **Found on the way:** the many-to-many `length`/`includes`/`isIncludedIn` operators on postgres
> read the junction table's first and second column as own and target, which is right on the side
> that owns the junction table and swapped on the inverse side - a count of `tag.accounts` was
> comparing the account column against the tag's id. They read the orm's `joinColumns` and
> `inverseJoinColumns` now, which the orm registers on the owning side only - the inverse side reads
> them off its inverse relation, swapped, the way the orm's own join does (a first version read them
> per side and failed on the inverse side on the first postgres run). And the five forwarding drivers got
> the base class [code-review 01 §Q2](./code-review/01-data-layer-repository.md) asked for, so the
> two reporters and the validator override only what they intercept.
>
> **Proof:** `scoped-relations.cases.ts`, run on the in-memory store (`scoped-relations.test.ts`,
> green) and on postgres and valkey (`scoped-relations.postgres-valkey.test.ts`, not run here): a
> relation list, a to-one relation, a relation of a relation, `findAll`, a page and a stream, a
> filter through a to-many and a to-one relation, `length`, `includes`, `isIncludedIn`, a many-to-many
> relation from both sides including the inverse-side count, a related entity answering `denyAll`,
> `unscoped`, and the write half. **Not covered:** an order through a relation the caller may not
> see still sorts by the hidden row's value; the tenant of related rows still rests on the
> write-time invariant rather than on narrowing, as before; and the `deleted` option of a call
> chooses the rows of its own entity only, by design (see §D2).

### D2. Soft deleted rows come back through relations and nested filters — ~~MAJOR~~ **FIXED**
*Filed 2026-10-21.*

`SoftDeleteRepository` hides deleted rows by adding `deleted: false` to every filter it forwards
(`soft-delete-repository.ts:91-140`, `softDeleteWhereToWhere` 366-375). That condition is on the entity
being queried only. Rows loaded through a relation go through the same two driver paths as D1, and
neither carries a `deleted` condition — `grep deleted` over `typeorm.repository-driver.ts`, the typeorm
where converter and the valkey driver's relation code finds nothing. So `project.tasks` includes every
task that was soft deleted, `{ tasks: { length: 0 } }` is false for a project whose tasks are all
deleted, and `{ tasks: { where: { title: 'x' } } }` matches on deleted rows.

The framework knows the related rows are marked deleted: it marks them itself in
`softDeleteOwnedRows` (`soft-delete-repository.ts:322-337`) and restores them in `restoreOwnedRows`. A
caller who soft deletes a task and then reads the project sees the task again, which is the one thing a
soft delete must not do. For an adopter this is a data-exposure bug on the retention feature they chose
the framework for.

Checked: `soft-delete-relations.test.ts` tests what a soft delete *hands back*, not what a later read of
the owner shows. `validateSoftDeletedRelations` (`data-source.service.ts:261-279`) only enforces that
cascading targets soft delete too. Docs (`data-source.md:1733-1761`) say "Every read and write leaves
soft deleted rows out", unqualified.

Fix: the same seam as D1 — a relation resolved through the target's repository gets `deleted: false` for
free; short of that, the drivers need the condition injected per level from the target's entity
metadata.

**Verify:** in-memory `startTestServer`: `Project extends SoftDeleteEntity` with `tasks: Task[]`, `Task
extends SoftDeleteEntity`; create a project with two tasks, `taskRepository.deleteById(t1)`, then
`projectRepository.findById(p, { relations: ['tasks'] })` must hold one task, and
`projectRepository.count({ where: { tasks: { length: 1 } } })` must be 1. Run the `.cases.ts` form on all
three stores.

> **Closed 2026-10-21 with §D1**, through the same seam: a soft delete entity reached through a
> relation is narrowed to `deleted: false`, combined with its scope when it has one, so a relation
> holds only live rows, a filter through it is judged on live rows and a count of it counts them -
> and a to-one relation pointing at a deleted row holds nothing. **Decided:** the `deleted` option of
> a call chooses among the rows of its own entity and says nothing about related ones;
> `projects.findById(p, { relations: ['tasks'], deleted: 'include' })` reaches a deleted project and
> still its live tasks. A deleted related row is reached through its own repository. Proof: the two
> soft delete cases of `scoped-relations.cases.ts`, in-memory green, postgres and valkey not run here.

### D3. `create` with `allowId` silently overwrites a stored row, bypassing the update-side checks — MAJOR
*Filed 2026-10-21.*

`writeNewRows` (`repository.ts:1656-1663`) says it: "A row given its id with `allowId` may be stored
already, so those are saved, which updates such a row", and calls `driver.save`, whose contract is
"entries with an existing id are updated" (`repository-driver.interface.ts:106`). Everything before it
ran as a CREATE: `applyScopeToData(own, CREATE)` judges *the new data* against the scope
(`repository.ts:597-598`) and never looks at the stored row; `TenantUtilities.movesRow` is only applied
on UPDATE (`repository.ts:591-596`); `validateWriteIsNotBlind` is not called at all on the create path;
`assignTenant` (`tenant.utilities.ts:169`) fills the active tenant in.

So with tenant A active and a scope of `{ userId: me }`, `create({ id: X, userId: me, ... }, { allowId:
true })` where X is tenant B's row owned by somebody else passes every check — the data is in scope and
in tenant — and the `save` rewrites row X with `tenantId = A`, `userId = me` and whatever else the data
carries. The row changes tenant and owner in one call, something `updateById` refuses twice over, and a
`ChangeSetRepository` records it as a CREATE. On a `SoftDeleteEntity` a deleted row is resurrected the
same way. `allowId` exists for client-generated ids (offline-first clients, imports, `uuid-values.cases.ts:94`),
which is exactly where the id arrives from the caller.

The docs disagree with the code: `data-source.md:745` says "With `allowId`, a row with an `id` that no
row has yet is created with it" and `repository-error-handling.test.ts:114` tests only the fresh-id case.
Nothing tests an existing id. Not CRITICAL because an application has to pass `allowId: true` on a path
fed by callers, and a v4 uuid is not guessable — but ids leak into urls and shared links routinely.

Fix: make `create` refuse an id a row already holds (`insert` instead of `save` when `allowId` is set,
and let the unique violation on the primary key become `UniqueConstraintViolationError`), which is what
the docs already promise. The owned-row path already does the right thing with `findMissingIds`
(`repository.ts:866-885`).

**Verify:** in-memory `startTestServer` with two tenants and two users: user A in tenant A calls
`create({ id: <B's row>, ... }, { allowId: true })`; expect a refusal and B's row unchanged, on every
store. Add the optimistic-locking variant: an entity with `optimisticLocking` on `name`, same call,
expect a refusal rather than an overwrite.

> **Closed 2026-10-21, the way the finding proposed.** `writeNewRows` always inserts; with `allowId`
> it first reads which of the given ids a stored row holds - through `findMissingIds`, unscoped,
> across tenants and deleted rows included, the read the owned-row path already made - and refuses
> any held one with a `UniqueConstraintViolationError` naming `id`. One read per call, noted in
> `costs.md`. Cases in `uuid-values.cases.ts` (a held id, in either spelling, through `create` and
> `createAll`, with the row unchanged and nothing of the batch written) and `tenant-isolation.cases.ts`
> (tenant A given tenant B's row id), both red first with the create resolving and the row rewritten.
> The optimistic-locking variant goes through the same refusal and got no case of its own. The
> docs say it under the repository methods, and the option's JSDoc says it. The backup sync, the log
> transport and SCIM create with ids no row holds, and the one valkey case that deletes and recreates
> an id inside a transaction still passes, since the read sees the delete.

### D4. A numbered or cursor page costs six round trips and a transaction on postgres — MAJOR
*Filed 2026-10-21.*

(From `after-all-findings-fixed.md`, item 7.) `findAllPaginated` and `findAllAfter` call
`driver.findAndCount` (`repository.ts:1954`, `2034`). The typeorm driver opens a `REPEATABLE READ`
transaction around the page and the count when the caller passed none
(`typeorm.repository-driver.ts:301-324`). On postgres that is: `START TRANSACTION`, `SET TRANSACTION
ISOLATION LEVEL REPEATABLE READ` (typeorm issues them as two statements), `SET LOCAL
idle_in_transaction_session_timeout` (`postgres-typeorm-data-source.model.ts:769-770`, on every
transaction), the page `SELECT`, the `COUNT`, `COMMIT`. `docs/costs.md:23-24` records the 6 and
`repository-costs.cases.ts` pins it, so it is known and accepted; ValKey answers the same call in 2.

Why it matters: this is the read behind every list endpoint, and each call now holds a pooled connection
across six round trips and a transaction. At the pool size of 20 (01 §M7) and a 2 ms network, a list
endpoint is ~12 ms of serial latency before any query time, and a few hundred concurrent list views
exhaust the pool. The reason recorded in §M5 (page and total must describe one moment) is sound; the
mechanism chosen is the most expensive way to get it. Postgres answers both in one statement and one
snapshot with a window function (`SELECT ..., count(*) OVER() AS total ... LIMIT/OFFSET`), or two
statements in one `WITH` — no transaction, one round trip. The typeorm `find` the driver uses cannot
express it; a query-builder read for the paging path can, and the driver already builds one for
similarity ordering (`similarityOrderedQuery`, 217-249).

A second cost sits on top for a typeorm `find` with `take` and joined relations: typeorm issues a
distinct-id query and then the row query, so a page with `defaultRelations` is seven. Not measured by
the cost cases (they measure an entity with no default relations).

**Verify:** extend `repository-costs.cases.ts` with a `findAllPaginated` row on an entity whose
`defaultRelations` names a relation, and keep the postgres expectation at the number the fix reaches
(the docs table is the assertion). The in-memory data source cannot show this; it needs the postgres
suite.

> **Closed 2026-10-22.** One statement reads the page and its total, with no transaction: the total is a scalar subquery (`(SELECT COUNT(*) FROM … "zi_total" WHERE <totalWhere ?? where>)`) selected next to the rows and read off the first raw row through `getRawAndEntities()`. A statement is one snapshot, which is what the transaction was buying. Two shapes in `TypeOrmRepositoryDriver.pageQuery`: a query that joins nothing takes the window with `offset`/`limit` directly; one that joins anything (relations read, or an order through a relation) takes the window over the ids alone - `"Alias"."id" IN (SELECT "zi_page"."Alias_id" FROM (<same query without result relations, LIMIT/OFFSET>) "zi_page")` - so a to-many join cannot multiply the rows a window counts, and the orm's own two-statement paging (`skip`/`take` with joins) is never entered. The typeorm `toParameterizedSql` renderer the converter already used for narrowing became public on the converter and the data source, so the driver's two embedded statements rename their `orm_param_N` after `zi_page`/`zi_total` and cannot collide with the outer statement's. The one case a total is a round trip of its own is a page holding no rows (past the last page, or after the last row of a walk): no row, no total, so `count` is asked.
>
> `docs/costs.md`: `findAllPaginated` and `findAllAfter` 6 → 1 on postgres; two new rows, `findAllPaginated` with relations (1 / 3) and with a relation of a relation (1 / 5), the second being the to-many shape the finding's "seven" was about; a bullet for the empty page. **Not run here** (postgres): `repository-costs.postgres-valkey.test.ts` is the red-first assertion and the user's run is what confirms the numbers, including the valkey column's new rows. Guards for the rewrite: new `paged-reads.cases.ts` (to-many relations in a window, page past the end, order through a relation, filter through a relation, cursor walk totals, page after the last row, page in the caller's transaction), run in memory here (7/7) and on postgres and valkey by the user; `repository.test.ts` "orders through a relation it joins, while paging the rows" covers the similarity-ordered window inside the derived table.

### D5. What the repository cannot express: aggregates, projection, a raw query, an increment outside `upsert` — MAJOR
*Filed 2026-10-21.*

The public surface is the fifteen methods in `docs/data-source.md:446-461` plus `findAllAfter`. Read off
`FindAllOptions` (`models/options/find-all-options.model.ts`) and the driver interface, there is no:

- aggregate or grouping — no `sum`, `avg`, `min`/`max`, `group by`, `distinct`. "Total revenue per
  customer this month" is `stream` plus arithmetic in the application, over every row.
- projection — every read loads every column (`select` exists only inside the driver, `findIds` at
  `typeorm.repository-driver.ts:414-431`, and is not public). A table with a `jsonb` document or a
  large text column pays it on every list.
- atomic arithmetic outside `upsert` — `updateAll(where, data: UpdateData)` takes values only
  (`repository.ts:2417-2421`); `AtomicUpdate`'s `increment` is reachable solely through `upsert`, which
  needs a declared unique identity. "Add 1 to `views` on every row matching a filter" has no atomic form.
- a raw query or query-builder escape hatch — `TypeOrmBaseDataSource.ds` is `protected`
  (`typeorm-base-data-source.model.ts:374`), so the only way is a data-source subclass reaching into
  typeorm, undocumented and outside scopes, tenancy, tracing, deadlines and the statement timeout.
- a pessimistic read lock for a read-then-write a caller owns (`FOR UPDATE` exists only inside
  `updateAll`'s locked path, 569-577).

01 §M14 closed by adding `count`, `exists`, `upsert`, `stream` and the cursor, and its own text lists
nothing about aggregates or projection, so this is new rather than a regression. For an enterprise
adopter it is the single most common reason to pick a framework "for the CRUD and something else for
reporting", which is also where every guarantee this layer gives (scopes, tenancy, deadlines) stops
applying. The architecture reviewer owns the ORM question; what belongs here is that the *repository*
contract has no seam for any of these, so the answer today is bypass rather than extension.

Fix direction: a `select` on the read options and an `increment`-capable `updateAll` are small; a scoped
`aggregate({ where, groupBy, sum: [...] })` that runs the same `scopedWhere` is the one that keeps the
guarantees. A documented raw-query hook on the data source that at least threads the deadline and
transaction would be the honest minimum.

**Verify:** a type test in the real test file (`@ts-expect-error` on `updateAll(where, { views: {
increment: 1 } })` and on `findAll({ select: ['id'] })`) documents the gap today; the fix is what turns
it into a runtime test.

> **Progress 2026-10-22: increment done; projection and aggregates in design; raw query split out as D18.** Scope by the user's call: projection, increment and aggregates now, with aggregates as explicit methods with spelled-out names (no single `aggregate`). The raw query hook is its own finding, D18, with typeorm-passthrough versus Kysely to be evaluated first.
>
> **Increment.** `updateAll(where, { views: { increment: 1 }, label: 'x' })` (`UpdateAllData<T, UpdateData>` maps each key of the update data to its value or, for a number, `Increment`; `UpdateIncrementUtilities.resolveValuesAndIncrements` splits them).
> - `{ increment }` counts as an amount on number properties only. For object, unknown and relation properties it is a value like any other, which answers the user's question about a property named `increment`. On any other property it is refused. Whole-number properties take whole amounts, and `bignumber` is refused.
> - The amounts reach the driver as `DriverUpdateAllOptions.increments`. Postgres writes `COALESCE(col, 0) + :increment_N` in the same `UPDATE`. ValKey and in-memory add on the held row through `WriteDataUtilities.resolveIncremented`.
> - An increment of a property the scope reads is judged on the written rows, inside a transaction that is rolled back with a `ForbiddenError`, as upsert does.
> - The bound-encryption path writes the amounts as a second `updateAll` in its transaction.
> - Change sets record the value each row holds after the update.
> - Found while typing it: a private member returning `UpdateData`, and the two overrides that still took plain `UpdateData`, made the repository's type parameters unmeasurable, so `CrudController` failed structurally. The overrides now take `UpdateAllData` and the split lives in a utilities class.
>
> Tests: `update-increment.cases.ts` (10 cases, in memory 10/10, postgres and valkey by the user, including 20 concurrent adds), `change-set-repository.increment.test.ts`.
>
> **Found on the way, fixed red first:** `SoftDeleteRepository` did not override `stream` or `findAllAfter`, so both handed back soft-deleted rows, against `data-source.md`'s "every read leaves soft deleted rows out". Both are overridden now, with a new `SoftDeleteStreamOptions` (two cases in `soft-delete-repository.test.ts`).
>
> **Projection (`select`), done.** Shape by the user's calls: both forms (`['name']` and `{ name: true, address: { city: true }, purchases: { total: true } }`); `relations` decides inclusion and `select` narrows keys of the row and of every included relation, at any depth into objects and arrays of objects.
> - `EntitySelectionUtilities.validateImpossibleSelect` runs before the read, after `defaultRelations` are applied. It refuses an undeclared property, a reach into a value with no properties, and a relation that is not included, naming the relation and the `relations` to pass.
> - An included relation the selection leaves out is not handed back, and on postgres not joined.
> - Every entity keeps `id`, which row-bound decryption needs.
> - A selected property whose `exclude` or encryption is decided by a function gets its row read whole; the result is still narrowed, and a warning is given once per selection (`findPropertiesNeedingWholeRow`). Callbacks of unselected properties do not count.
> - `findAllAfter` reads its order keys too, for the cursor, and drops them before handing back.
> - Narrowing happens in the repository after the return hooks (`project`, which carries hidden excluded properties over as hidden), so every store hands back the same shape. Postgres reads only the selected columns: `findOptions.select` for the row, and `leftJoin` + `addSelect` per narrowed relation. ValKey and in-memory read whole rows.
> - Types: `EntitySelection<T>`, `Selected<T, S>`, `Projected<T, S>` (`S` undefined gives `T`), through a `const S` generic on `findAll`, `findOne`, `findById`, `findAllPaginated`, `findAllAfter`, `stream` and the `SoftDeleteRepository` overrides. An unselected property is a type error.
>
> Tests: `entity-selection.cases.ts`, 11 cases with type assertions (in memory 11/11, postgres and valkey by the user), plus a postgres-only statement check that unselected columns are not read. All 183 in-memory suites: the same 17 container-only failures as before, no new ones.
>
> **Closed 2026-10-22 with aggregates.** `sum` and `average` take a `NumberKeysOf<T>`; `minimum` and `maximum` take an `OrderedKeysOf<T>` and answer the property's own type.
> - `count` gained the same `groupBy` option. Grouped, each answers `(Pick<T, G[number]> & { <method name>: value })[]` (`Aggregated<T, G, Name, Value>`, typed through a `const G` generic).
> - Answers follow SQL: a row holding no value is left out; a sum or count of nothing is 0 and the others answer undefined.
> - It is refused before the read when a sum or average is not of a number, a minimum or maximum not of a number or date, or a group key is not a single plain value or is encrypted (`AggregateUtilities.validate*`).
> - Scopes and tenancy narrow the rows as on every read; `SoftDeleteRepository` overrides all five with `deleted`.
> - A new driver method `aggregate`: postgres runs one `SELECT SUM/AVG/MIN/MAX/COUNT … GROUP BY` and reads strings and dates back through the property's type (`AggregateUtilities.resolveValue` / `resolveGroup`); valkey and in-memory share `AggregateUtilities.resolveRows`.
> - `costs.md` has two new rows, postgres 1 and valkey 2 (the valkey numbers reasoned, not measured).
>
> Tests: `aggregate.cases.ts`, 7 cases with type assertions (in memory 7/7, postgres and valkey by the user), plus a grouped soft-delete count. The upgrade guide tells implementers of their own driver about `aggregate` and `increments`. **None of D5 has run on postgres or valkey here.**

### D6. A custom repository built on an injected `SoftDeleteRepository` silently drops soft deletes and change sets — MAJOR
*Filed 2026-10-21.*

The documented way to add methods to a repository (`docs/auth.md:718-735`, `roles-and-permissions.md:72-82`,
`tenancy.md:203-213`, mirrored in `packages/sandbox/src/repositories/*.repository.ts`) is
`class UserRepository extends Repository<User> { constructor(@InjectRepository(User) repo, ...) {
super(User, repo, logger, repo.dataSource, getDefaultBeforeSaveHook(), getDefaultBeforeReturnHook()) } }`.
The base constructor takes `repo.driver` off the injected repository (`repository.ts:248-249`) and
nothing else: whether `repo` was a `SoftDeleteRepository` or `ChangeSetRepository` is lost, and the
subclass behaves as a plain `Repository` over the raw driver.

The shipped `BaseUserEntity` extends `BaseEntity` (`auth/models/base-user.model.ts:34`), so the sandbox
is fine. An application whose `User extends SoftDeleteEntity` — a common choice for retention — copies
the page and gets a `UserRepository` whose `findByEmail` finds deleted users (a deactivated account logs
in), whose `updateRoles` writes no change set, and whose `deleteById` hard deletes. Nothing warns: the
constructor has no check, the `@UserRepo` decorator has none, and the base class's
`isSoftDeleteEntityNewable` is only consulted by the data source's own `getRepository`
(`typeorm-base-data-source.model.ts:1057`).

The same constructor is the reason for a smaller trap: the two hook arguments *replace* the defaults,
so an application passing a hook of its own to add validation silently switches off defaults, encryption
and hashing (`hooks.default.ts:54-77`); the repository even branches on `isDefaultBeforeSaveHook`
(`repository.ts:2837`), so custom hooks are anticipated and composition is not offered.

Fix: refuse in the `Repository` constructor a `repo` that is a `SoftDeleteRepository`/`ChangeSetRepository`
when `this` is not one, naming the class to extend; and take the hooks from `repo` when a repository is
built on one, so the six-argument `super` becomes `super(User, repo)` (which is what
`membership-repo.decorator.ts:20` already shows in its own JSDoc example — the docs and the JSDoc
disagree today).

**Verify:** in-memory `startTestServer`: `class Account extends SoftDeleteEntity`, a
`class AccountRepository extends Repository<Account>` built as the docs show; soft delete a row through the
injected repository, then `findAll()` on the custom one must not hand it back — today it does. The fix
turns the test into "the constructor refuses it".

> **Closed 2026-10-21, both halves of the fix.** `Repository`, `ChangeSetRepository` and
> `SoftDeleteRepository` take `(entityClass, repo)` when built on the repository the data source made:
> the logger, the data source, the two hooks and, for change sets, the auth service and the change set
> repository are read off `repo`. The six-argument form stays for a repository over a driver, or one
> with hooks of its own. A class built on a repository it does not extend is refused as it is built,
> naming the class to extend. `custom-repository.test.ts` holds the refusal, a `SoftDeleteRepository`
> of your own that keeps soft deleting, and a plain one whose default hook still runs; red first. The
> three docs pages, the scaffold, the sandbox, the fixtures and the three suites with custom
> repositories all use the two-argument form now, `data-source.md` got "A repository of your own",
> and the published JSDoc of `@RoleRepo` matches `@UserRepo` and `@MembershipRepo`. That also closes
> the boilerplate half of 08 §X16; its other half, that the user, role and membership interfaces
> demand a class that *is* a repository, stays open there.

### D18. There is no documented way to run a query the repository cannot express — MAJOR
*Filed 2026-10-22*, split out of D5 by the user's call: the raw query hook is a decision of its own,
not one of D5's small additions.

`TypeOrmBaseDataSource.ds` is `protected` (`typeorm-base-data-source.model.ts`), so a query the
repository has no form for (a report joining five tables, a window function, a `FOR UPDATE SKIP
LOCKED` a caller owns) is reached only by a data source subclass reaching into typeorm. That path is
undocumented and runs outside everything the repository threads through a call: the caller's
transaction, the request's deadline and statement cancellation, the statement timeout, tracing and
the round trip counter. Scopes and tenancy cannot apply to sql the framework did not write, and that
is the honest limit of any such hook. Everything else can.

Evaluate before building, by the user's call: (a) pass typeorm's `query(sql, parameters)` through a
documented `DataSource.query` that threads transaction, deadline, timeout and tracing, which is
small and untyped; or (b) a typed query builder such as Kysely, whose queries are checked against
a database type the framework could generate from the entity metadata. The evaluation should
answer:
- What a Kysely database type generated from `@Entity`/`@Property` metadata covers: column names,
  nullability, jsonb, enums, relations as foreign keys, tenant columns.
- Whether Kysely can run on the connection typeorm already pools, so a raw query joins a repository
  transaction rather than taking a second pool.
- What it costs as a dependency: an optional peer, size, ESM.
- Whether (b) replaces the need for D5's aggregate methods or sits next to them.

**Verify:** a test that runs a hand-written `SELECT` inside a repository transaction and inside a
request whose deadline has passed: it must see the transaction's uncommitted row, and must be
cancelled with the deadline error rather than running on.

> **Closed 2026-10-26 (user: Kysely is a GitHub issue; fix the deadline on the existing builder and
> document it).** The premise above was wrong: `SqlDataSourceInterface.query(Entity, { transaction,
> alias })` already hands out a typeorm query builder, on the caller's transaction when it names
> one, and `PostgresDataSource` implements it. What was true: it was documented as one Key exports
> row and nothing else, its statements ran on pool connections the request's deadline did not know
> (the driver's `whileCancellable` covered the repository's own statements only), and nothing said
> that scopes and tenancy do not reach it. Cancellation moved from the driver into the data source:
> a typeorm subscriber (`beforeQuery`/`afterQuery`, which typeorm waits for before it releases a
> connection) watches every statement the orm sends inside a request and cancels it when the
> request's signal fires, so the repository and a builder are stopped by the same path.
> `whileCancellable`, the `StatementCancellingDataSource` model and the per-statement runner it made
> the driver take out under a deadline alone are gone (09's frame table, row 11, describes them);
> `onConnection` now takes a runner only for a statement limit, and `cancelStatementOn` is private.
> `data-source.md` "Writing a query by hand": an example, that the query sees its transaction and
> is stopped with its request, that values come back as the database answers them, and a WARNING
> that it reads across every tenant and scope. Tests: `statement-cancellation.test.ts` "a query
> built by hand" (Postgres): a `pg_sleep(3)` builder read in a route with a 300 ms deadline ends
> well before three seconds (red before: nothing watched its connection), and a builder on the
> caller's transaction sees the row the transaction created.

## MINOR

### D7. The scope function is evaluated once per row and up to three times per single-row write — MINOR
*Filed 2026-10-21.*

`resolveRestriction` (`repository.ts:433-455`) calls the entity's `restrictedTo` every time. `updateById`
reaches it from `exists` → `scopedWhere` (2128), from `applyScopeToData` (2174) and from `scopedWhere`
again (2188); with `relations` the read-back adds a fourth and a `ChangeSetRepository` a fifth.
`createAll` calls `applyScopeToData` inside the per-row `Promise.all` (1606-1620), `updateEach` likewise
(2288-2292), `updateAllBound` per row (2692-2697): a batch of a thousand rows runs the scope a thousand
times. `getCurrentUser`/`getCurrentMembership` are memoized per request
(`resolve-entity-scope.function.ts:39-47`), the scope function itself is not, and the docs encourage
`async` scopes that `await ctx.hasPermission(...)` (`data-source.md:1259-1266`); a scope that reads a
membership list from a repository — the "row that belongs to several users" shape — pays a round trip
per evaluation. Resolve once per call and thread it, as `upsert` already does (`repository.ts:995`).

**Verify:** unit test on the in-memory data source: a scope that counts its invocations; `createAll` of
50 rows must invoke it once (today 50), `updateById` once (today 3).

> **Closed 2026-10-26.** Resolved once per call rather than threaded: the steps of a write go through
> public methods the soft delete and change set repositories override (`updateById` checks through
> `exists`), so a restriction handed down explicitly could not reach them. `withinTimeout`, which
> every public method runs in, now opens a call on the repository's own `AsyncLocalStorage`; a call
> made inside it joins it, and `resolveRestriction` answers from what the call already resolved when
> everything the answer is made of is the same: the request context (whose user and membership are
> memoized per request already), the active tenant, `unscoped` and `acrossTenants`. A step running in
> another tenant or request asks again. The call is closed when the outermost one returns, so work it
> leaves running resolves anew. Test: `repository.scope-evaluations.test.ts` (in memory, a counting
> scope): create, createAll of 50, findById, findAll, exists, updateById, updateAll, deleteById and
> deleteAll each ask once, and createAll, updateById, updateAll and deleteById on a soft deleting
> entity; red with createAll 50, updateById 3 and updateAll 3. `data-source.md` says a call asks the
> scope once.

### D8. `deleteAll` and `deleteById` judge the scope in a read and delete by id afterwards, outside a transaction — MINOR
*Filed 2026-10-21.*

`applyDeleteAll`'s default path (`repository.ts:2837-2845`) reads the matching ids under the scoped
filter and then `removeRows(ids)` → `driver.remove(ids)` (2894), a `DELETE WHERE id IN (...)` with no
scope on it and no transaction when the entity has no owned relations. `deleteById` is the same two
steps (2783-2787). `updateAll` puts the scope into the statement itself (2504-2508) precisely so that a
row cannot change under it. A row whose scope column (owner, status) is changed by another caller between
the two statements is deleted by someone who may no longer see it. The window is one round trip wide;
it is the "two writers" shape 10 was written about, and the asymmetry with `updateAll` is the part that
will surprise a reviewer. Fix: hand the scoped filter to `remove` (the driver already converts filters)
or delete through `updateAll`'s locked path.

**Verify:** cluster suite or a two-connection postgres test: hold the id read, move the row's owner on
another connection, let the delete proceed; the row must survive.

> **Closed 2026-10-26 (user: the scope goes into the delete, and a conflict when a row moved).**
> `RepositoryDriverInterface.remove(ids, where, transaction, related)` removes only the rows among the
> ids that still match `where`, judged in the same write, and answers with the ids it removed:
> postgres one `DELETE … WHERE id IN … AND <filter> RETURNING id`, or for a filter through a relation
> the locked ids first (`findLockedIds`, as `updateEach`); valkey holds the matching rows
> (`holdRowsMatching`) in a transaction and removes those; the in-memory store judges and removes
> with nothing awaited between. The forwarding drivers pass it on, and the role and membership
> reporting drivers report only what was removed. `Repository.removeRows` takes a `RemovalReach`
> (the caller's write reach, `resolveRemovalReach`): rows that were handed out first - to a
> `beforeDelete`, back through `returnDeleted`, by `deleteById` - or whose own rows went with them
> fail the whole delete with a `ConflictError` and remove nothing (in a transaction when more than one
> row); a `deleteAll` that only counts stays one statement and leaves a moved row out of its count.
> `ChangeSetRepository` removes wholly, since a row's change sets go with it. Test:
> `delete-scope.cases.ts`, run by `delete-scope.test.ts` (in memory) and
> `delete-scope.postgres-valkey.test.ts`: a row handed to someone else between the read and the
> removal (moved in a `REPOSITORY_HOOKS` `beforeDelete`) is kept and the delete fails, a batch with one
> such row deletes none, and a row that stayed is deleted; red in memory for the first two when written.
> `data-source.md` (restricting rows) and `upgrading-to-3.md` (an own driver's `remove`).

> **Reworked 2026-10-26 (user: the closure above cost round trips).** The user's run of
> `repository-costs.postgres-valkey.test.ts` showed the transaction around a handed-out batch on
> postgres (`deleteAll` returning the rows: 3 for one row, 6 for twenty, growing with the batch) and
> the held rows on valkey (`deleteAll` 4 → 11, returning the rows 6 → 13). Now
> `remove(ids, reach, transaction)` takes a `RemovalReach { where, related, wholly }`
> (`removal-reach.model.ts`, public) and judges it in the one call it makes anyway: postgres adds
> `AND (SELECT COUNT(*) FROM t within WHERE <ids> AND <reach>) = n` to the statement when the rows go
> wholly, so one statement is all or nothing without a transaction (a single row is on its own);
> valkey judges the reach on the rows it reads for their index entries (`resolveRowsWithinReach`,
> the evaluator on `fromFields`) and, outside a transaction, guards the write on those rows as read
> (`applyGuardedValKeyWrites` takes `ValKeyWriteGuards { values, hashes }`, the script compares a
> hash field by field), read and judged again when one was written meanwhile, a `ConflictError` when
> they keep being written; a filter through a relation still holds the rows (`holdRowsMatching`,
> `findLockedIds`). `Repository.removeRows` no longer opens a transaction for a reach; "wholly" also
> covers a row gone by then (`deleteAll` returning rows that another caller deleted one of fails,
> new case in `delete-scope.cases.ts`). Costs are back at the documented 2 / 3 and 4 / 6, the same for
> one row as for twenty. Not reproducible without valkey: a row written between the valkey read and
> its guarded write (the guard path itself); the user's run of the costs and delete-scope suites is
> what confirms the statement and the script.

### D9. A keyset walk ordered by a `bigint` or `bignumber` property fails after the first page, with the wrong error — MINOR
*Filed 2026-10-21.*

`resolveKeysetOrder` accepts every `number` property (`keyset-order.model.ts:20, 94`), formats included.
`keysetValuesOf` (`after-cursor-where.function.ts:45-61`) accepts `string | number | boolean` and throws
a plain `Error` "holds no value on this row" for a `bigint` or `BigNumber`, so the first full page of
`findAllAfter(undefined, 100, { order: { amount: 'ASC' } })` on a `format: 'bigint'` column ends in a
500 after the rows were read. Had it got through, `valueFor` (92-100) would `Number(value)` the cursor
and lose precision past 2^53. Either refuse those formats in `resolveKeysetOrder` with the message the
other refusals get, or carry them as strings the way the docs say they travel through json
(`number-property-metadata.model.ts:73`).

**Verify:** unit test on `keysetValuesOf` with a `bigint` value, and an in-memory `findAllAfter` ordered by
a `format: 'bigint'` property over 150 rows.

> **Closed 2026-10-26 (carried as strings, the way the docs say these formats travel through json).**
> `KeysetOrderKey.type` names `bigint` and `bignumber` from the property's format (`keyTypeOf`);
> `keysetValuesOf` writes a bigint's digits and a `BigNumber` through `toFixed()` (never the exponent
> form), `valueFor` reads them back as `BigInt` and `BigNumber` and answers a hand-edited value that is
> not one with the cursor's existing 400 ("The cursor could not be read."); `pastValue` compares both
> with `greaterThan`/`lesserThan`. The docs already said a walk refuses only a nullable property or a
> value with no order, so nothing to document. Tests: two cases in `number-formats.cases.ts` (run in
> memory, and on postgres and valkey by `number-formats.postgres-valkey.test.ts`): a walk ordered by
> six bigints next to each other past 2^53, pages of two, and one by three decimals apart only past a
> double's digits, descending, pages of one; and in `after-cursor-where.function.test.ts` the cursor
> round trip of both formats without a lost digit and the 400 for `'1.5'`/`'twelve'` on a bigint key.
> All red in memory when written, with the error the finding names.

### D10. Bulk soft delete marks owned rows one owner at a time — MINOR
*Filed 2026-10-21.*

`softDeleteOwnedRows` (`soft-delete-repository.ts:322-337`) loops `for (const ownerId of ownerIds)` and
calls `markDeleted` per owner per relation; each `markDeleted` is a `saveUpdateAll` (a locked update,
read-back, change sets) plus the recursion into the next level. A `deleteAll` matching 2,000 projects
with two cascading relations issues ~4,000 `markDeleted` calls, each several statements, inside one
transaction holding every row it touched. The inline comment gives the reason ("each row notes its own
owner"), which is a limitation of the repository API — there is no "set a column from another column" —
not of the stores: on sql it is one `UPDATE ... SET deleted = true, deleted_with = project_id WHERE
project_id IN (...)`. CODE_STYLE's "Do not loop per entry where one call would do" names this shape.
`updateEach` already writes per-row values in one statement (`typeorm.repository-driver.ts:647-702`) and
could carry `deletedWith` per row after one id read.

**Verify:** extend `repository-costs.cases.ts` with a soft-delete entity owning a cascading relation and
assert the round trips of `deleteAll` over 20 owners do not scale with the owner count.

> **Closed 2026-10-26 (the `updateEach` route the finding names).** `softDeleteOwnedRows` calls
> `markDeletedAlong(foreignKey, ownerIds, transaction)` once per relation on the target repository: one
> `findAll` of the owned rows (no relations, nothing decrypted), then one `saveUpdateEach` writing each
> row `{ deleted: true, deletedWith: <its own foreign key> }` under `deleted: false`, the DELETE change
> sets together, and the recursion over the rows written. `Repository.saveUpdateEach` is new (protected,
> beside `saveUpdateAll`): `updateEach` without a change set and without refusing a row it did not land
> on, so a task deleted on its own in between is left out as the locked update left it out. Both go
> through `applyUpdateEach`; found on the way and fixed there: the owned rows of an `updateEach` were
> paired with the written rows by position, which a left-out row would shift, now by id.
> `markDeleted` lost its `deletedWith` parameter (always null now). The test is in memory rather than
> in `repository-costs.cases.ts`, where the calls are listed and need no container:
> `change-set-repository.costs.test.ts` soft deletes one project and twenty, two cascading tasks each,
> and asserts the same calls for both and that every task's `deletedWith` is its own project. Red when
> written (38 calls more for twenty).

### D11. The role and membership reporting drivers read every matched row into memory on a bulk write — MINOR
*Filed 2026-10-21.*

`MembershipReportingRepositoryDriver.updateAll` (`membership-reporting.repository-driver.ts:117-130`) and
`.remove` (99-109), `RoleReportingRepositoryDriver.updateAll` (`role-reporting.repository-driver.ts:100-106`)
and `RoleValidatingRepositoryDriver.updateAll`/`updateEach` (`role-validating.repository-driver.ts:99-108,
151-159`, the latter when no tenant is active) call `inner.find({ where })` with no `take`. That read sits
below `UNBOUNDED_FIND_ALL_LIMIT`, so "revoke every membership of tenant X" or "move every membership of
user Y" over 100k memberships holds 100k rows for the sake of a `userId:tenantId` set. Roles are few;
memberships are not. The set the reporter needs (`userId`, `tenantId`) is a projection the driver could
ask for, and the "after commit" shape duplicated across both reporters is what the user's
after-all list (item 1) describes as a candidate for one generic entity-write event.

**Verify:** `RoundTripCounter`/memory assertion in a membership cluster or in-memory test: `updateAll`
over N memberships must not read N rows back.

> **Closed 2026-10-26.** A membership `updateAll` reads what each check needs through the driver's
> `aggregate` with a `groupBy`, never the rows: `MembershipReportingRepositoryDriver` reads the distinct
> `userId`/`tenantId` pairs, and `RoleValidatingRepositoryDriver` reads the distinct tenants the
> written roles are checked against. Both now pass the write's `related` as well, which the row read
> left out. Left as they are, since none of them can hold an unbounded set:
> - the reads of `remove`, `save` and `updateEach` are bounded by the ids the caller hands in (the
>   `updateEach` filter names every id, as the driver interface says);
> - the role-entity reads of `RoleReportingRepositoryDriver.updateAll` and of the role-validating
>   driver's role branch read roles, which an application declares and which are few, and the rename
>   check needs each one.
>
> Test: `membership-reporting.repository-driver.test.ts`, in memory with a `RoundTripCounter`. It
> moves every membership of a user in 20 tenants to another user and writes roles to every membership
> of a user in 20 tenants. It asserts:
> - the calls are `aggregate` and `updateAll` with no `find`;
> - the reported pairs are both users in every tenant;
> - an unknown role is still refused.
>
> Red when written (`TestMembership.find` where `aggregate` was expected). The "after commit" shape
> both reporters share stays the generic entity-write event idea of the after-all list.

### D12. A soft deleted child given by id to a `oneToMany` write answers 404 — MINOR
*Filed 2026-10-21.*

(From `after-all-findings-fixed.md`, item 17.) `writeOwnedRows` (`repository.ts:831-841`) updates the rows
given with an id through `repository.updateEach(given)`; on a `SoftDeleteRepository` that is narrowed to
`deleted: false` (`soft-delete-repository.ts:201-209`), the deleted child matches nothing,
`validateUpdateWasWritten(0, missing)` reads it through the same guard and throws `NotFoundError`
(`repository.ts:2316-2319`, 2395-2407). With `allowId: true` on a create the id is first found by
`findMissingIds` with `deleted: 'include'` (880-882) and then meets the same 404. So "update the
project with tasks `[{ id: deletedTask }]`" is a `Could not find Task` to the caller, who can see no
reason, and the same payload sent before the task was deleted succeeded. The two honest answers are to
restore-and-link (the write names the row, which is what a restore does) or to refuse with an error
naming the deleted row; the current 404 names neither.

**Verify:** in-memory `startTestServer` with `Project`/`Task` soft delete entities: delete a task, then
`projectRepository.updateById(p, { tasks: [{ id: task.id }] })`; assert the chosen behaviour.

> **Closed 2026-10-26, both answers, as an option (the user's call).**
> - `oneToMany` and `hasOne` take `deletedRows: DeletedRelatedRows` (`'refuse' | 'restore'`). The
>   decorator defaults it to `'refuse'`, and `OwnedRelation` carries it.
> - Every write taking `WriteRelationsOptions` takes `deletedRelatedRows`. It overrides the relation
>   at every level the write reaches, since `writeOwnedRows` hands it on in `childOptions`.
> - **Restore:** `writeOwnedRows` writes the given rows through `updateEach` with `deleted: false`
>   under `deleted: 'include'`, which is the soft delete repository's existing restore path:
>   `deletedWith: null` plus `restoreOwnedRows`. Nothing is read first; a live row is written the
>   same either way.
> - **Refuse:** `Repository.validateUpdateWasWritten` is protected now, and `SoftDeleteRepository`
>   overrides it. When the update missed and `deleted` was `'exclude'`, it reads the row
>   `deleted: 'only'` under the caller's scope. A hit throws
>   `ConflictError('The Task with id "…" is deleted.')`, and the transaction rolls the whole write
>   back. The read happens only once the update has missed, so a write that succeeds costs what it
>   did.
> - A direct `updateById` of a deleted row keeps its 404 from `ChangeSetRepository`'s own read first,
>   and the `deleted: 'include'` paths skip the check.
>
> Tests: three cases in `owned-relations.cases.ts`, so they run in memory, on Postgres and on Valkey.
> - The default refuses with the named `ConflictError` and keeps nothing of the save.
> - `deletedRelatedRows: 'restore'` restores the stop and the ticket deleted along with it.
> - `Household.lodgers` now declares `deletedRows: 'restore'` and restores, unless the write says
>   `'refuse'`.
>
> All three were red when written, with the 404 from the finding. Documented in `data-source.md`
> (§Saving and deleting the rows of a relation, Key exports). `DeletedRelatedRows` is exported. No
> upgrade entry: the option is new, and the old answer was never documented.

### D13. `deleteById` has no condition and no `relations`; `stream` has no order anywhere — MINOR
*Filed 2026-10-21.*

Option-type inconsistencies an application developer meets early: `DeleteByIdOptions` is
`BaseRepositoryOptions` alone (`models/options/delete-by-id-options.model.ts`), so there is no
compare-and-delete (`updateById` has `where`, `upsert` has `where`), and no way to say which relations the
returned row carries (`findById` inside it resolves `defaultRelations`, 2783). `validateWriteIsNotBlind`
guards updates only, so an `optimisticLocking` property stops nothing on a delete.

`StreamOptions` omits `order` (`models/options/stream-options.model.ts`) because "a data source that
filters in the application would have to hold every one of them" (`docs/data-source.md:557-561`, 01 §M14).
That is a valkey limit applied to postgres, which streams an ordered cursor without holding anything; an
ordered export is the most common streaming job. Deliberate, recorded, and still the kind of lowest-common-denominator
decision an adopter counts against the abstraction. A per-store capability (refuse at runtime on a store
that cannot) would keep the type honest where it matters.

**Verify:** type tests with `@ts-expect-error` on `deleteById(id, { where })` and `stream({ order })`
record the gap; a postgres stream test with `order` is the fix's test.

> **Closed 2026-10-26.** The user's calls: a delete must name the locked properties as an update
> must; Valkey orders a stream by holding ids and order values.
>
> **`deleteById(id, { where, relations })`**
> - `DeleteByIdOptions<T>` is `BaseRepositoryOptions & Pick<WriteRelationsOptions<T>, 'relations'> & { where }`,
>   generic with a default. `SoftDeleteByIdOptions<T>` follows.
> - The new protected `Repository.resolveRowToDelete` reads the row with the condition, so the
>   `beforeDelete` hook never runs for a row that will not be deleted. On a miss it reads again
>   without the condition, under the scope: a row that is there gives `ConflictError` ("changed
>   since it was read, so it was not deleted"), any other gives a 404, as `validateUpdateWasWritten`
>   answers. The store then judges the condition again as it removes the row
>   (`resolveRemovalReach(options.where, …, true)`), which catches a write in between.
> - The soft delete path uses the same read. Its `saveUpdate` carries the `where`.
>
> **Optimistic locking on deletes**
> - `validateWriteIsNotBlind(entityClass, undefined, where)` means a delete: every locked property
>   has to be named, `undefined` deleting regardless, with a message of its own.
> - Called in `deleteById`, `deleteAll` and the soft delete paths of `SoftDeleteRepository`.
> - Deletes that go along with an already-checked one say "regardless" through the new
>   `OptimisticLockDescriptor.resolveRegardlessWhere`: `removeOwnedRows` (cascade), the left-out
>   delete in `writeOwnedRows`, and both membership deletes of `BaseMembershipRepository`.
> - The shipped `CrudController.deleteById` now refuses a locked entity with an `InternalError`, as
>   its `updateById` already does for a locked property. It has no way to take a version, which is
>   left as it is.
>
> **`stream({ order })`**
> - `StreamOptions` and `DriverStreamOptions` keep `order`. The repository passes the caller's order
>   only, never `defaultOrder`, made total with the id (`totalOrder`) and checked by
>   `FuzzySearchUtilities.validateOrderable`.
> - Postgres puts the order into the id cursor through `selectQuery`, narrowed to the id, which
>   covers relation and similarity orders. The batch read-back drops the order.
> - Valkey's `resolveIdsInOrder` reads the matches a batch at a time with the filter and order
>   relations only, keeps `{ id, values }`, and sorts with the comparators `applyOrder` uses, now
>   shared through `resolveSorts`. The second pass reads in that order, without the order relations.
> - The in-memory driver orders the ids through `findRows`.
>
> **Also found:** D12 had put `deletedRelatedRows` on `DeleteAllOptions` through `BulkWriteOptions`.
> `DeleteAllOptions` now picks only `relations`.
>
> **Tests**
> - `locked-delete.cases.ts` (new, with in-memory and Postgres/Valkey runners), six cases: the
>   condition holds or answers a conflict, a missing row is a 404, a blind delete or `deleteAll` is
>   refused and `name: undefined` deletes regardless, `relations` on the returned row, locked rows
>   cascaded and left out regardless, and the soft delete with a lock.
> - `paged-reads.cases.ts`, three stream cases: descending with relations, ordered through a
>   relation that is not handed out, and 1,100 rows across batches.
> - `repository-costs.cases.ts` measures `stream` in an order and `deleteById` with a condition: 2/3
>   and 2/3, measured. On Valkey a condition costs nothing more, since `removeByIds` judges the reach
>   on the rows it reads to remove them anyway.
> - Because an equal count proves nothing about the condition, `delete-scope.cases.ts` gained a case
>   that retags the row between the read and the removal and expects a `ConflictError` with the row
>   kept. It runs on all three stores.
>
> **The user's container run**
> - The run found `ScimService.removeOrphans` deleting `ScimUser` rows, whose `version` is locked,
>   without naming it, which gave a 500 in `scim-controller.model.test.ts`. It now names
>   `version: undefined`, since a resource whose user is gone goes whatever its version.
> - The first search for internal deletes of locked entities had been cut off at 20 lines. A full
>   search finds only `ScimUser` and `ScimGroup`, and their other deletes name `version`.
> - The ordered stream case asserted `'customer' in o`, which an orm-built entity always satisfies
>   under ES2022 class fields. It now asserts the value, as the other relation cases do.
>
> Six cases were red when written. Docs: `data-source.md` (§Two people editing the same thing, the
> stream paragraph, Key exports), `costs.md`, and the driver paragraph of `upgrading-to-3.md` (stream
> order). The delete rule gets no upgrade entry, since `optimisticLocking` is new in 3.

### D14. A `where` through a relation lets a row with nothing related pass any filter a null satisfies — MAJOR
*Filed 2026-10-21, from the first postgres run of the 09 §Q3 conformance file.*

`{ children: { where: { label: { not: 'x' } } } }` found every probe without children on postgres, and
the evaluator (which decides the write side) none of them. The typeorm converter answered a `where`
through a relation with nested find options, which the orm turns into a `LEFT JOIN` plus a condition
over the joined columns. Joined with no related row those columns are null, and every filter a null
satisfies - `not`, `notOneOf`, `notLike`, `notILike`, `null` - is satisfied by the row that has nothing
related. The same for a relation to one row: a child pointing at no probe passed
`{ probe: { where: { text: { not: 'a' } } } }`. The documented meaning
(`docs/data-source.md`, "A relation to many rows takes the same operators, with the related rows as its
items"; `where` "asks for an array holding at least one item that matches") is the evaluator's. A scope
written as `{ memberships: { where: { userId: { not: me } } } }` read rows the write side refused.

**Verify:** the relation cases of `where-conformance.cases.ts` on postgres.

> **Closed 2026-10-21.** A `where` on a relation is answered by a statement over the related rows -
> `EXISTS (SELECT 1 FROM related WHERE related.fk = row.id AND related.id IN (<the filter, rendered as
> a read of the related entity>))` - the way `length`, `includes` and `isIncludedIn` already were, for
> every relation kind (a relation holding the key itself reads it through its own table, keyed by the
> id the statement knows). The filter inside is rendered by the same `convert`, so narrowing, nested
> relations and or-branches inside it need nothing of their own; the or-distribution the join needed is
> reduced to a list of conditions on a relation, which becomes one branch per condition. The
> conformance file got the null-satisfying keys on a relation to many rows, a list of conditions on a
> relation, and a block of cases over the children with three pointing at no probe: `is`/`not`/`oneOf`
> with an entity and null, `where` with every null-satisfying key, or-branches, a filter through the
> relation of the relation, and an impossible value through the relation. Green in memory (the
> evaluator never joined); the postgres run is the user's.

### D15. A list of objects compared as a whole matches nothing on postgres — MAJOR
*Filed 2026-10-21, from the first postgres run of the 09 §Q3 conformance file.*

`{ parts: [] }` found no probe with an empty list of parts on postgres, and the evaluator every one. A
list of objects is one jsonb column; the converter compared it with `Equal(values)`, which hands the
list to the driver as an array, and array text (`{}`) read as json is an empty *object*. A list holding
objects is not valid json as array text at all, so `{ parts: [{ ... }] }` failed the statement. `not`
with a list went the same way.

**Verify:** `PART_CONDITIONS` of `where-conformance.cases.ts` on postgres.

> **Closed 2026-10-21.** The base converter asks the dialect for an array equality
> (`buildArrayEqualsOperator`), which postgres answers with `Equal` for an array column and with the
> list bound as a json document (`col = $1::jsonb`) for a jsonb one; `not` with a list is the negation
> of the same. The conformance file compares a list of objects as a whole, negates one, and holds
> `includes` and `isIncludedIn` with objects to the evaluator as well. Green in memory; the postgres run
> is the user's.

### D16. A number with a fraction on a whole-number property fails the statement on postgres — MAJOR
*Filed 2026-10-21, from the first postgres run of the 09 §Q3 conformance file.*

`{ count: 1.5 }` on a `format: 'integer'` property raised `invalid input syntax for type bigint: "1.5"`
on postgres - a 500 to the caller - where the evaluator answers no rows. Every comparison went the same
way (`{ greaterThan: 0.5 }`), since the column is `bigint` and the value reaches it as text. A query
parameter `?count=1.5` on an integer filter was a failed request on one store and an empty page on the
other, the pair `dropImpossibleConditions` exists to make agree - for uuids only.

**Verify:** `INTEGER_CONDITIONS` of `where-conformance.cases.ts` on postgres; `drop-impossible-conditions.test.ts`.

> **Closed 2026-10-21.** `dropImpossibleConditions` judges a whole-number property the way it judges a
> uuid one, through one `DeclaredFormat` per format: a value with a fraction names no row (an equality
> drops the branch, `oneOf` the option), a negation of one is refused with the same `BadRequestError`,
> and a bound with a fraction becomes the bound on the whole number next to it (`greaterThan: 0.5` →
> `greaterThan: 0`, `greaterThanEquals: 0.5` → `1`, `lesserThan: 9.5` → `10`, `lesserThanEquals: 9.5` →
> `9`), which is the same question and one a typed column answers. Unit cases for each in
> `drop-impossible-conditions.test.ts`; the conformance file's integer conditions cover every key with
> a fraction and now hold a refusal on one side to a refusal on the other. Documented next to the uuid
> rule in `docs/data-source.md`.

### D17. `not`, `oneOf` and `notOneOf` naming a related row compare the column with the row itself — MAJOR
*Filed 2026-10-22, from the second postgres run of the 09 §Q3 conformance file (the children cases §D14 added).*

`{ probe: { not: aProbe } }` on a relation to one row rendered `"probeId" != [object Object]` on
postgres and failed the statement; `oneOf`/`notOneOf` with rows bound the rows as json text against a
uuid column. Only `is` unwrapped a row to its id (`typeorm-where-filter.converter.ts`, the `is`
handler). The evaluator compared the resolved row with the named row deeply, so two reads of the same
row with different relations resolved were different rows to it.

**Verify:** the `is`/`not`/`oneOf`/`notOneOf` cases over the children in `where-conformance.cases.ts` on postgres.

> **Closed 2026-10-22.** The converter's `not`, `oneOf` and `notOneOf` unwrap a related row to its
> id through `WhereValueUtilities.unwrapRelation`, as `is` did; the evaluator unwraps both sides for
> `is`, `not`, `oneOf` and `notOneOf` on a relation to one row, so a row is the row named when the ids
> match, whatever else either carries. Green in memory; the postgres run is the user's.

### D19. A check cannot compare two properties, nor a date — MINOR
*Filed 2026-10-24, from 08 §X5.*

A check (`EntityMetadata.checks`) is a `where` filter, and a filter compares a property against a
value: there is no way to name another column on the right-hand side. So "a stay ends after it starts"
cannot be a rule every row follows, and the user decided against folding it into the validation work:
since 08 §X5 a request answers it through `before: (stay: Stay) => stay.endsAt` or `@ValidateCustom`,
and every other write path (cron jobs, scripts, a second service on the same tables) does not. Dates
are refused in a check outright (`entity.decorator.test.ts` "refuses a check that compares a date":
the literal would be written into the schema), so `endsAt` after a fixed date is not one either.
Each store has to judge it the same way: a `CHECK` expression on postgres, the evaluator on valkey and
in memory - and `validateChecks`'s reading of stored lists on valkey has to take the new form.

**Verify:** declare `checks: [whereFor<Stay>({ endsAt: { after: ??? } })]` - nothing names `startsAt`.

> **Closed 2026-10-26.** The user's calls: a reference inside the filter, with its type inferred from
> the filter it is in, and references wherever a filter goes.
>
> **Types**
> - `propertyOf('startsAt')` (`property-of.function.ts`) returns a branded `PropertyReference<K>`, a
>   plain `{ property }` at run time.
> - `WhereFilter<T>` hands `T` down as `Of` to `WhereFilterProperty`. `DateWhereFilter<Of>` and
>   `NumberWhereFilter<N, Of>` take a reference in their comparisons, to
>   `PropertiesHolding<Of, Date | AnyNumber>`. `Of` defaults to `object`, so standalone filter types
>   are unchanged.
> - No type argument is needed: a property of another kind, an undeclared one, or a reference in a
>   value position is a compile error.
>
> **One class for every reader:** `PropertyReferenceUtilities`, reading references only under the
> eight comparison keys, so a JSON value holding a `property` key stays a value.
>
> **Each reader**
> - **Evaluator** (Valkey, in memory, request validation): `resolveAgainst` swaps each reference for
>   what the object holds, null when nothing, which no comparison matches.
> - **Postgres columns:** a `Raw` comparing the column with the sibling of its alias path, which
>   works through relation joins as well.
> - **Postgres JSON values:** `JsonbOperatorContext.sibling` reads a property beside the compared one
>   in the same object. A list item or a shape's value has none, and is refused there.
> - **Checks and uniques** (`keyWhereToSql`): the four date comparisons are accepted, against a date
>   literal or a reference, written as `"endsAt" > "startsAt"`. The decorator now hands it the property
>   metadata, so a kind mismatch is refused when the entity is declared.
> - **Run-time validation:** `dropImpossibleConditions` checks references in queries for an undeclared
>   or other-kind property.
> - **Scope merging:** `ScopeWhereUtilities.tighter` merges two references to the same property, and
>   refuses a reference beside a literal on the same key like any bounds it cannot compare.
> - `CheckConstraintViolationError.resolveProperties` lists referenced properties after the one
>   compared, which the validation service's "body lacks a compared property" rule and the error's
>   `properties` both use.
> - Valkey's stored check list needed no change: a date reads back as an ISO string, which
>   `WhereValueUtilities.compare` compares as a date, and a reference is plain JSON.
>
> **Tests**
> - `where-conformance.cases.ts`: `Probe.until` comes from its own picker, so the existing rows are
>   unchanged. A new case holds each store to the evaluator on 18 reference filters (dates, numbers,
>   with literals, branches and alternatives) plus two through a relation's `where`. Type tests use
>   `@ts-expect-error`.
> - `entity-checks.cases.ts`: two cases, a two-property check (create and update refused, both
>   properties named) and a fixed-date check.
> - `entity.decorator.test.ts`: the test that refused a date check now takes date and reference
>   checks and asserts their SQL. A new test refuses an undeclared or other-kind reference at
>   declaration.
> - `validation.service.test.ts`: a body breaking the check gets its code, and an update lacking the
>   start is left to the data source.
>
> The tests were written before the code, but they could not load until `propertyOf` existed, so
> their first red was a failed import rather than a failed assertion. Docs: `data-source.md` (§Rules
> every row follows, new §Comparing two properties of a row, Key exports), `validation.md`'s choosing
> table, and the `EntityCheck` JSDoc. No upgrade entry, since this is additive with defaulted type
> parameters.

### D20. A check the data source refuses answers without the check's code — MINOR
*Filed 2026-10-24, from 08 §X5.*

Since 08 §X5 a check carries a `code` and a `message`, and a request body breaking it is answered
with both in `problems`. A write the data source refuses, which is what a partial update leaving out a
property the check compares reaches, still throws `CheckConstraintViolationError` built from the filter
alone (`typeorm.repository-driver.ts`, `val-key.repository-driver.ts` `validateChecks`, the in-memory
driver): a generic message, no code, no `problems` in the 400. The stores hold the filters only - on
valkey the list persisted with the keys, which a newer release beside this one may extend - so the
error has to find the declared check by the identity of its filter, and fall back to the filter alone
for a check only the store knows.

**Verify:** `PATCH` a `Chore` of `entity-checks.cases.ts` with `{ status: 'done' }` over http: 400
without `problems`, `name` `CheckConstraintViolationError`.

> **Closed 2026-10-26.** The refusal now answers with the check as its one problem, under the key
> `body` (the user's choice: it is what the validation answers for the same check on a top-level
> body, and the store cannot tell which object of the request a row came from).
>
> **The error**
> - `CheckConstraintViolationError` takes the entity class instead of its name. It finds the declared
>   check by its filter: by reference first (Postgres maps the constraint name back to the declared
>   filter, in memory holds it), then by JSON (Valkey hands back a copy read from its stored list).
> - A filter the entity does not declare, which is a check a newer release beside this one listed, is
>   answered as a check written as its filter alone: code `check`, message naming its properties.
> - It carries `code` and `problems`. The message is translated for the request's locale, as
>   `ValidationError` does it. The error message itself still names the entity and the properties.
> - The decorator's `checkOf` moved onto the error as `resolveFilterCheck`, so the decorator and the
>   fallback write a filter-alone check the same way.
> - The global error handler puts `problems` in the body for this error as well.
>
> **Tests**
> - `entity-checks.cases.ts` (every store): `Chore` gains a filter-alone check on `status`. Two cases:
>   an update leaving out the completion date gets `completedAtRequired` and its message under
>   `body`, and a create breaking the filter-alone check gets `check`.
> - `entity-checks.test.ts` (in memory): the Verify step over http, now answering 400 with the
>   problem, plus the error built from a copy of a declared filter (the Valkey path) and from a filter
>   the entity does not declare.
>
> Red first: 5 failures, then green. Docs: `data-source.md` (§Rules every row follows, Key exports),
> `validation.md` (§Answering the checks of an entity), and `error-handling.md`'s handler steps. No
> upgrade entry, since the error is new in 3.

### D21. An application cannot configure the hooks every row passes through before it is written and returned — MINOR
*Filed 2026-10-25, from 08 §X20.*

Every repository runs a before-save hook (default values, encryption, hashing, excluded properties) and a
before-return hook (decryption, excluded properties). The data sources build each repository with
`getDefaultBeforeSaveHook()` and `getDefaultBeforeReturnHook()` (`typeorm-base-data-source.model.ts`,
`val-key-data-source.model.ts`), and the only other way in is `Repository`'s six-argument constructor, which a
repository declared with `@RepositoryFor` does not have: the framework builds it, with no constructor of its own.
An application wanting to normalize, audit or stamp every row has no place to say so.

The user's decisions: configurable both globally, for every repository, and on one repository through
`@RepositoryFor`; an application's hook **wraps** the default, receiving it and deciding when to call it, so
leaving encryption or hashing out is something the code says rather than what a replacement does by accident.
The hook types (`BeforeSaveHook`, `BeforeReturnHook`, `SaveOperation`) and the two default factories are public
since X20. Delete keeps its shortcut: a delete through the default hook skips the hand-back pass
(`isDefaultBeforeSaveHook`), which a wrapping hook has to keep or drop explicitly.

**Verify:** an in-memory test server whose global hook stamps a property and whose `@RepositoryFor` hook on one
entity uppercases another: both arrive in the stored row, and an encrypted property is still stored encrypted.

> **Closed 2026-10-25.** The user refined the shape while it was built: on one repository the hooks are
> methods, not decorator options, and deletes have a hook of their own. `Repository` has protected
> `beforeSave(data, operation)`, `beforeDelete(row)` and `beforeReturn(row, autoDecrypt)`; a `@RepositoryFor`
> class overrides them and calls `super` to keep the default. For every repository, `RepositoryHooks` under
> `ZIBRI_DI_TOKENS.REPOSITORY_HOOKS` (default `{}`) holds `beforeSave`, `beforeDelete` and `beforeReturn`,
> each receiving the `wrapped` hook; the methods run around them, they around the default
> (`RepositoryHookUtilities`, the renamed `hooks.default.ts`). `SaveOperation.DELETE` is gone with the
> delete moving to `beforeDelete`, and with it `isDefaultBeforeSaveHook`: `deleteAll` keeps reading ids
> only while neither the class overrides `beforeDelete` nor the hooks declare one. For an override to hold
> for rows written through a relation, which reach their entity via `dataSource.getRepository`, each data
> source's `getRepository` hands out the listed class (`RepositoryForUtilities.resolveRepository`, on
> `zibri/internal`), and `registerRepositoryProvidersFor` no longer builds it a second time. The hook
> parameters of the repository constructors and `getDefaultBeforeSaveHook`/`getDefaultBeforeReturnHook` are
> removed; `BeforeDeleteHook` and `RepositoryHooks` are public. `repository-hooks.test.ts` (in memory, red
> before: no token) covers both levels, a relation write, the kept shortcut and a global `beforeDelete`;
> the custom-hook case of the renamed `repository-hook.utilities.delete.test.ts` moved there. Documented in
> `docs/data-source.md` "Running your own code on every row", `costs.md`, and `upgrading-to-3.md` (where a
> hook passed to the constructor goes).

## Code quality and architecture

Moved to [code-review/01-data-layer-repository.md](./code-review/01-data-layer-repository.md) (Q1–Q7).

## Already filed

- `findAll` refusing above 10,000 rows is a design the adopter must know about → 01 §M4/§M14, FIXED
  (deliberate; not re-filed).
- Bulk updates on change-set entities read every matching row for the before state → 01 §M3/§M12, FIXED
  (residue recorded in `docs/costs.md`).
- Text ordered by one locale → 01 §M28, open.
- `unique` on an encrypted property → 01 §M36, open (deferred).
- Date model (instant vs calendar date) → 01 §M37, open (deferred).
- No read-replica routing → 01 §M39, open.
- Primary key is one string id → 01 §M40, open.
- Search across several columns → 01 §M62, open.
- Valkey deadlock ends by timeout → 10 §10.6, open (deferred).
- `exactOptionalPropertyTypes` over the option types → 05 §M6, open.
- `hasRole`/`hasPermission` naming non-existent roles at startup → after-all item 18, noted by 03 §A2's
  closing paragraph; not this chapter's area.

## Not reviewed

The valkey driver beyond relation resolution (its `find`, index, unique and transaction code), the
in-memory data source's evaluator, `value-conversion.utilities.ts`, `migration/**`, the where converters,
`entity/generation/**`, the `where/*.model.ts` filter types beyond the root, `entity-relations.utilities`
and `entity-order.utilities`, the encryption/hash service interaction beyond `hooks.default.ts` and
`decrypt-encryption-properties.function.ts`, and the bulk of the `.cases.ts` suites (names only).
