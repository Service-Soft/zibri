# Authentication, Authorization and Security Posture

All paths relative to `packages/zibri/`. This is a defensive review of the project's own code.

---

## A. Authorization model

### A1. Endpoints are open by default; the framework never warns about unprotected routes — ~~CRITICAL~~ **FIXED**

`src/auth/auth.service.ts:211-288` (`checkAccess`) is called for every HTTP route
(`src/routing/router.ts:493`) and every websocket route
(`src/websocket/services/websocket.service.ts:689`). If a route carries no `@Auth.*` metadata,
every branch is skipped and the handler runs unauthenticated.

There is no global default-deny switch: `ZibriApplicationOptions`
(`src/application-options.model.ts:47-90`) has no auth-default field, and `createFullOptions`
(`src/application.ts:403-444`) adds none.

The only warning emitted is the inverse: `src/auth/auth.service.ts:229-238` warns on a *useless*
`@Auth.skip`. `README.md:98` advertises exactly this. So the framework tells you when you
over-annotated, and never when you forgot to annotate.

**Attack:** a developer adds `@Post('/internal/payouts')` and forgets `@Auth.hasRole`. Zero build
error, zero runtime warning, zero test failure. The endpoint is world-writable.

> **Fixed by refusing to have a default at all.** Both candidates were wrong for the same reason.
> Leaving it open is the finding. Turning it around to deny would have been the safer guess, but it
> is still a guess: an api that is open by design and an api that guards everything are both
> perfectly ordinary, and whichever one the framework picks silently, "you forgot to say" becomes
> indistinguishable from "you said this".
>
> So `defaultAuth: 'public' | 'requireLogin'` is a **required** option. The question is asked once,
> at the only place it can be answered, and the compiler asks it - there is no wording of a startup
> warning that beats not being able to build. It sits at the top level beside `authStrategies` rather
> than under `security`, which holds transport concerns; this is an authorization policy.
>
> **The warning this entry asks for was never added, and the inverse one was kept.** The complaint is
> that Zibri warns when you over-annotated and never when you forgot. The fix is not a second
> warning - under a declared default there is nothing left to forget - it is that the existing one
> became a statement about the declared default rather than about the decorators alone. Under
> `'public'` a bare `@Auth.skip` still skips nothing and is still called useless, because a decorator
> that makes a route *look* guarded is worth deleting. Under `'requireLogin'` the same decorator is
> what holds the route open, so it is not. One `if`, and the warning is correct in both worlds
> instead of in one.
>
> **A library controller cannot know which world it is in**, which is the one case that does not
> resolve. `JwtAuthController`, `CookieAuthController` and the mailing list plugin have to state
> their own posture - `/auth/login` is how a caller stops being anonymous, and an application wide
> requirement reaching it would make `'requireLogin'` an api nobody can log into. They say
> `@Auth.skip({ allowRedundant: true })`, in the shape `allowOrphan` already established. Without
> that flag they would be warned about in every application that chose `'public'`, with no way to be
> correct under both.
>
> `@Auth.skip` gained a controller level form for this, and `@Auth.isLoggedIn.skip` opts out of the
> application wide requirement too - it exists to undo a login requirement, and letting the global
> one survive it would have left a decorator that reads like it does something and does not. Its
> "useless" warning is conditional for the same reason. **The other four per check skips are not, and
> that asymmetry is the part worth pinning:** `hasRole.skip`, `belongsTo.skip`, `require2fa.skip` and
> `isNotLoggedIn.skip` say nothing about a login, so they neither become meaningful nor open a route,
> and a route that skipped a role check has not thereby become public. Held by a test rather than by
> this paragraph.
>
> **One defect came out of the class level form, and it was this change that created it.** The five
> conflict checks test `routeX && routeSkip` - route level only - because a controller level
> `@Auth.skip` did not exist to test. Once it did, `@Auth.isLoggedIn()` beside `@Auth.skip()` on the
> same controller became expressible, undetected, and resolved in favour of the check: the skip read
> like it opened the controller and did nothing whatsoever. It now throws
> `InvalidDecoratorCombinationError`, the way the route level pair always has. Precedence was the
> alternative and was rejected - two decorators saying opposite things is a question the author has to
> answer, not one for the framework to answer quietly in either direction.
>
> **Left as it is, deliberately:** a controller level skip warns once per route on the controller
> rather than once for the controller, and a route carrying its own skip on an already skipped
> controller draws both lines. Each is accurate about the decorator it names, and suppressing one
> would mean a route level skip could hide a controller level one that is genuinely dead. The
> underlying noise is that these warnings are emitted from `checkAccess` and so fire per request
> rather than at startup, writing a row through the default db log transport each time. That predates
> this change and is F3(b) wearing different clothes.
>
> **Two values, deliberately.** A richer default - an application wide role, ownership, a second
> factor - was considered and rejected on composition rather than on effort. Every other check
> resolves a user first, so `'requireLogin'` is implied by all of them, and whether a route's own
> decorators replace the default or combine with it is a question that cannot be answered wrong.
> `hasRole([ADMIN])` as a default makes that question real: a route saying `hasRole([USER])` either
> widens or narrows, a route saying only `belongsTo` either keeps the role or does not, and every
> answer is defensible - which is the reliable sign the next reader assumes the other one.
> `require2fa` is the one member that would compose cleanly, being the only check no other check
> implies, and is the door left open.
>
> **What this does not reach:** manually registered routes. `checkAccess` is called from the
> controller path only, so `registerRoute` - the framework's own assets and OpenAPI docs, and
> anything an application registers that way - is outside `defaultAuth` whichever value it is given.
> An application that declared `'requireLogin'` still serves its OpenAPI spec to anyone, which is a
> hole in exactly the direction that surprises people. Said out loud in `docs/auth.md` rather than
> left to be discovered, and filed separately as
> [02-http-runtime-core.md](./02-http-runtime-core.md) §M13, because it is a gap in `registerRoute`
> rather than in this option and it was reachable before this option existed.
>
> Held from both sides, because the same decorator means opposite things under the two values:
> `src/__testing__/evaluation/auth-and-security.evaluation.test.ts` for `'requireLogin'` - an
> undecorated route refused, a route that declares itself public served, the framework's own auth
> routes still reachable - and `src/auth/default-auth.test.ts` for the warning half, against
> `auth.service.test.ts` which declares `'public'` and asserts the warning that is correct there.

### A2. Authorization is role-only — no permissions, scopes, ABAC or row-level security — ~~MAJOR~~ **PARTIALLY FIXED**

The full authorization surface is five decorators: `isLoggedIn`, `isNotLoggedIn`, `hasRole`,
`require2fa`, `belongsTo` (`src/auth/decorators/`). `hasRole` takes a flat `string[]`
(`src/auth/models/has-role-metadata.model.ts`, consumed at `src/auth/auth.service.ts:256-261`).
No permission or scope concept, no role hierarchy, no policy engine, no tenant scoping.

Ownership is `@Auth.belongsTo`, and it only works for single-resource routes with an id path param:
`src/auth/strategies/jwt/jwt.auth-strategy.ts:353-383` reads
`context.request.params?.[targetIdParamKey]`, loads the whole entity, then compares one property.

- **List endpoints have no ownership story at all.** `GET /invoices` cannot be scoped, because
  `belongsTo` requires a path param. Every developer hand-rolls
  `where: { userId: currentUser.id }` on every query; one omission is a cross-tenant data leak.
- **`belongsTo` swallows its own failures** — `jwt.auth-strategy.ts:380-382` and
  `cookie-auth.auth-strategy.ts:344-346` wrap the `InternalError` thrown at `:371` in
  `catch { return false; }`. A typo in `targetIdParamKey` silently degrades to "deny all".
- **Extra full-row read per request** on every `belongsTo` route, discarded after one comparison.

RBAC-only with hand-rolled row filtering is the most common source of IDOR/BOLA findings in
pentests. Multi-tenant SaaS is effectively unsupported.

> **A defect in the write half, found by the suite for this finding and fixed elsewhere entirely.**
> Every ordinary partial update on a scoped entity was refused 403. `applyScopeToData` already knew
> not to judge a change against columns it does not carry — `conditionsOn` narrows the scope to the
> keys present in the change — but the change arriving from a route carried *every* declared key,
> because `parseObject` assigned each property of the body class whether or not the payload had it.
> A `PATCH { title }` therefore came out as `{ title, userId: undefined }`, `'userId' in data`
> answered yes, and the check compared `undefined` against the caller's id.
>
> **The fix is in the parser, not the scope**: a property is parsed when the payload carries the
> key, decided on presence rather than on value, so `null` and an explicitly written `undefined`
> both still come through — clearing a column and not mentioning it stay different requests. Held by
> `parse-object.test.ts`.
>
> Worth keeping for what it says about the shape of the bug: the scope check was right, and it was
> reading a change that was lying about which columns it touched. Anything else asking "what does
> this update change" was being told the same thing.
>
> **The row level half is closed. Permissions are not, and are deliberately staged.** Tenancy closed
> on its own, as the multi-tenancy entry of [01's MINOR list](./01-data-layer.md).
>
> Two of the three bullets were already stale by the time this was picked up: `belongsTo` stopped
> swallowing its failures during the A3/A4 rework, and the extra full-row read is gone with the
> decorator itself. What was left is the one that made this a MAJOR - list endpoints having no
> ownership story at all.
>
> **It could not be fixed on the route, and that is the whole finding.** A decorator runs before the
> handler: it knows the caller, the route and the path parameters, and nothing about the query the
> handler is about to run. That is why `belongsTo` only ever worked for routes naming a single row in
> their path. A list-shaped decorator would have been documentation the framework could not enforce,
> so the enforcement had to move to the only place that sees the query - the repository - and the
> declaration with it.
>
> **`@Auth.belongsTo` is removed rather than kept alongside.** Row visibility is now one thing: a
> function on the entity, returning the filter every query on it is narrowed by.
>
> ```ts
> @Entity({
>     scope: {
>         restrictedTo: scopeFor<Invoice>(ctx => {
>             if (!ctx.currentUser) throw new UnauthorizedError($ts`Invoices belong to a user.`);
>             return { userId: ctx.currentUser.id };
>         })
>     }
> })
> ```
>
> `findAll`, `findOne`, `findById`, the paginated count, `updateAll`, `updateById`, `deleteAll`,
> `deleteById` and the create half are all narrowed by it. A handler that writes no filter at all is
> now correct, which is the opposite of the position the finding describes.
>
> **A declarative `belongsToUser` key shipped first and was then deleted**, which is worth recording
> because the deletion is the better design. It could express everything the callback can except
> filling the owner in on create - and that is a *value*, which a filter cannot supply and a
> `@Property({ default })` already does, in the place defaults belong. Keeping both would have been
> two ways to say one thing that behaved differently for an anonymous caller. The callback also gets
> stronger checking, not weaker: `scopeFor<Invoice>` types the filter's columns, values and operators
> at compile time, where the declarative key could only validate the column name at boot.
>
> **What a scope can answer** is four things, and the last two are the reason this shape was needed:
> a filter, an array of filters meaning any of them, `undefined` for no restriction at all, `denyAll`
> for no rows, and throwing to refuse the request outright. `denyAll` and throwing are different
> answers - a caller who is simply outside the data gets an empty list, a caller who may not ask gets
> the exception. Rows that are public and rows that are private now live in one table, which is what
> the declarative key could not express at any price.
>
> **Refusals are 404 on reads**, deliberately: a row the caller may not see and a row that does not
> exist answer identically, so a guarded route cannot be used to learn which ids are real. A *write*
> landing outside the scope is a 403 - that is a caller saying what they intend rather than asking for
> something they cannot see.
>
> **Anonymous and out-of-request are the same position**, and the scope is told about both rather than
> having one chosen for it: `currentUser` is undefined for a public request and for a cron job alike,
> and the entity above throws for both because it has nothing to offer a caller who is nobody. Another
> entity legitimately answers with its public rows. Anything that genuinely reads across the
> restriction says `unscoped: true` (or names the scope), which is a decision written at the call and
> easy to search for. `unscoped` is typed against a framework owned union, so a scope that does not
> exist does not compile.
>
> **`(a or b) and (c or d)` is `ac or ad or bc or bd`**, and getting that wrong is silent. The first
> composition treated the scope's branches as a conjunction, which turns "public **or** mine" into
> "public **and** mine" - fewer rows, so it fails closed, but it is the opposite of what was written
> and it breaks the case the callback exists for. The same bug sat in the write check as an `every`
> that should have been a `some`. Both are pinned by tests now.
>
> **Three defects surfaced while writing it**, none of them filed:
> - `findById` spread its options over `{ id }`, so a caller passing a `where` replaced the id rather
>   than adding to it - reachable from `updateById`, whose pre-read then checked whether *some* row
>   matched instead of whether this one still existed. The id is now combined with the filter.
> - `findAllPaginated` took its `totalAmount` from the caller's filter directly, bypassing the shared
>   find options. On a scoped entity that is a page of the caller's rows beside a count of every row
>   that exists.
> - A malformed id reaches the driver and comes back as a 500 rather than a 404, and the error the
>   server logs carries the failing query. The body the client gets is generic, so nothing leaks
>   outward. Untouched here - it predates this and closed separately as
>   [01 M21](./01-data-layer.md#m21-a-malformed-id-is-a-500--nothing-checks-the-id-against-the-format-it-declares--fixed).
>
> **The audit trail survives on writes only, and that is the honest half.** A refused write names a
> caller who stated what they intended, so it is recorded as `OUT_OF_SCOPE`. A refused *read* is not,
> and cannot be: the repository narrows the query and gets nothing back, which is indistinguishable
> from a row that was never there - the exact property the 404 exists for. Emitting an authorization
> failure for every empty `findOne` on a scoped entity would report ordinary misses as refusals and
> bury the real ones. The reads lost a log line, deliberately, in exchange for not being able to leak
> which ids exist.
>
> **Ordering turned out to be load-bearing.** The write side check has to run *after* `beforeSave`,
> because that hook is where a property's `default` is applied - and filling the owner from the
> current user through a default is an ordinary thing to write. Checking before it ran would have
> inspected a value nothing ends up storing, and left whatever the default produced unchecked.
>
> **A filter that means one thing everywhere has to mean it here too.** A guard refusing a scope whose
> filter carries an `undefined` value was written and then dropped: it closes a real foot-gun
> (`ctx => ({ userId: ctx.currentUser?.id })` is no condition at all once there is no user, so it
> matches everything) but it would have made the same filter behave differently inside a scope than in
> a handler. The docs say to reach for `denyAll` instead. This is the one place the design accepts a
> way to get it wrong in exchange for the filter language staying one language.
>
> **What this does not cover.** `upsert`'s identity is also its conflict target and has to be a
> declared unique group, so the scope cannot be added to it the way it is added to a filter: an
> identity landing outside the scope is refused through the create data, but an identity that says
> nothing about the scoped columns still selects across callers on an entity whose unique group
> excludes them. A column the scope keys on that is itself encrypted or hashed cannot be scoped at
> all, since the stored value is not the one being compared - nothing refuses that configuration yet.
> A route whose only auth decorator was `@Auth.belongsTo` has lost its login gate, so under
> `defaultAuth: 'public'` it is refused inside the handler rather than before it and should carry
> `@Auth.isLoggedIn`. The OpenAPI document can say a route is scoped but never by what, because a
> function cannot be described. And the rest of the finding is untouched: no permission or scope
> concept, no role hierarchy. Tenancy was expected to be an ordinary scope and was built as a layer
> of its own instead, since a scope is what `unscoped` lifts and lifting it must never reach another
> tenant. A policy engine is **declined** rather than pending: the seam belongs in the framework, the
> rule engine does not.
>
> Held by `src/__testing__/evaluation/auth-row-ownership.evaluation.test.ts` over real logins - both
> directions of a list, 404 against a control that succeeds, the paginated count, every write path, an
> array valued membership, an owner supplied by a property default, the anonymous and out-of-request
> refusals, a caller the scope does not narrow, `denyAll` answering empty rather than refusing, and
> public rows beside private ones in one table - and by
> `src/data-source/scopes/apply-scope-to-where.test.ts` for the composition, which is pure and needed
> pinning on its own: the scope reaches **every** branch of the caller's OR, its own branches stay an
> OR, and a pairing that contradicts itself is dropped rather than queried.

> **The `upsert` half has closed, and it had a second hole the paragraph above does not name.** An
> identity saying nothing about the scoped columns did select across callers: the store resolved the
> conflict by the unique group alone, and the change landed on another account's row. The repository
> now narrows the identity's own conflict filter by the scope and hands that to the store, which
> judges the conflicting row within the same window as the write - inside the one statement on
> postgres (`ON CONFLICT … DO UPDATE … WHERE id IN (…)`, the select built by the conversion a read's
> filter goes through), and under the row's grant on valkey. A row outside it is answered with the
> `UniqueConstraintViolationError` inserting the identity would give: to that caller the row does not
> exist, so an insert is what they asked for, and any other answer would tell them more than inserting
> it does.
>
> **The unnamed hole was `onConflict` itself.** Nothing judged it, so the conflict path could move a
> row out of the caller's reach - exactly what an update refuses. A value it sets on a property the
> scope reads is judged before anything is written, the way an update's is. An amount it adds is
> judged on the written row, inside a transaction that rolls back on refusal, because an increment's
> result is only known once it lands (a quota scope such as `{ used: { lesserThanEquals: 100 } }` is
> the shape that needs it). Inside a caller's own transaction that write stays until they roll back
> on the error, which was chosen over refusing every increment on a scoped property. The first version
> judged a `set` after the write as well, which cost every scoped `set` a transaction it did not need
> and left a refused one written inside the caller's - taken out in the performance pass, with a case
> committing the caller's transaction after the refusal.
>
> **What it costs** is in §M12's table in [01](./01-data-layer.md): nothing extra for an ordinary
> scoped upsert on postgres (the reachable rows are one index probe inside the same statement), and
> nothing extra on valkey (the row the grant re-reads is read with what the scope needs and judged
> in process, where the first version read it a second time through the filter). Only a refusal,
> and an increment the scope reads, pay anything.
>
> Postgres evaluates that select with the snapshot the statement started with, so a row another
> writer committed after that is not in it even when it is reachable - a false refusal for two
> concurrent upserts by the same caller. A row that came back with nothing is therefore run once more
> in a fresh statement, which sees that row and lands on it if it may. (It first asked a fresh select
> and re-ran only on a hit; with `upsertAll` the re-run itself is the question, and costs the same
> one statement.) **That race is reasoned, not tested**: no cluster case holds it.
>
> **`upsertAll` carries the same rules per row, and one of its own**: a batch on a scoped entity is
> all or nothing. On postgres the refused row can come after rows the one statement already wrote,
> so a restricted batch of several runs in a transaction and is rolled back whole.
>
> **The encrypted-or-hashed half is withdrawn.** The data layer never transforms a filter value, so
> every filter compares against the stored form, and an exact match on that form is legitimate: a
> deterministic hash the caller computes (`JwtRefreshToken` is found that way), a hash string read off
> a row, an envelope read with `autoDecrypt: false`, or a custom encryption strategy that happens to be
> deterministic - which `EncryptionStrategyInterface` has no flag to declare. A scope comparing such a
> column against the plain value fails closed, with empty reads and refused writes; one comparing
> against the stored form works. A refusal cannot tell the two apart, so there is nothing to refuse.
>
> Held by `src/data-source/tests/scoped-upsert.cases.ts`, run on the in-memory store by
> `scoped-upsert.test.ts` and on postgres and valkey by `scoped-upsert.postgres-valkey.test.ts`: four
> cases red before the fix (another account's row changed, an answer differing from an insert's, a
> `set` moving the row out, an increment carrying it past a quota) beside three controls, and one
> added with the performance pass for a refused `set` inside the caller's committed transaction.
> Three more cover `upsertAll`: a batch landing on the caller's rows as a control, and a batch refused
> for another account's row - with a `set`, so no increment takes the transaction for it - or for an
> increment past the quota, each leaving the caller's own row as it was.

> **Permissions and a role hierarchy are deferred, by decision (2026-10-02).** What is left of this
> finding is the authorization model above the row: `hasRole` takes a flat list, with no permission
> concept and no role hierarchy. An application composes either from roles and scopes today - a
> hierarchy is a role list a scope or a `hasRole` call spells out, a permission is a role named after
> it - so nothing is unreachable, only unshipped. The shape it would take if picked up: a DI token
> mapping each role to the permissions it carries, checked by an `@Auth.hasPermission`, which covers
> a hierarchy as well, since one role's permissions can include another's.

### A3. JWT `isLoggedIn` / `hasRole` never touch the database — ~~CRITICAL~~ **FIXED**

`src/auth/strategies/jwt/jwt.auth-strategy.ts:330-337`

```ts
async isLoggedIn(context): Promise<boolean> {
    const jwt = this.extractAccessTokenFromRequestContext(context);
    if (!jwt) return false;
    const data = await JwtUtilities.verify(jwt, this.accessTokenSecret);
    return !!data;                                    // no user lookup
}
```

`:340-350` (`hasRole`) reads roles straight off the token payload
(`data.payload.roles.includes(r)`). The payload is minted at login (`:399-404`) and never
revalidated. There is no revocation list, no `jti` on access tokens (only on refresh tokens,
`:426`), and no token-version or `iat`-cutoff check. `logout` (`:163-177`) deletes only refresh
tokens; `confirmPasswordReset` (`:279-299`) likewise. Default access-token life is 1 hour
(`src/di/default/zibri-di-providers.default.ts:97`).

**Attack:** an employee is terminated at 09:00, their user row deleted and `ADMIN` stripped. Their
existing access token satisfies `@Auth.isLoggedIn()` and `@Auth.hasRole([ADMIN])` until 10:00.
The same window applies to a stolen token after detection — there is no way to kill it.

The built-in strategies are also **inconsistent**: `CookieAuthStrategy.hasRole`
(`src/auth/strategies/cookie/cookie-auth.auth-strategy.ts:307-317`) resolves the user from the DB
and reads `user.roles`. Swapping strategies silently changes the security semantics.

Immediate session termination on offboarding or compromise is a hard requirement in SOC 2 /
ISO 27001 control sets. There is no mechanism to satisfy it.

> **Fixed, and not where this entry expected.** Patching `hasRole` to read `foundUser.roles` would
> have closed the symptom on one strategy and left the shape that produced it: `isLoggedIn`,
> `hasRole` and `belongsTo` were implemented per strategy, so every new strategy is another chance to
> answer an authorization question from a stale credential. Their two `belongsTo` bodies were already
> identical apart from where the user id came from.
>
> They are gone from `AuthStrategyInterface`. A strategy turns a request into a user and nothing
> else; `AuthService` answers all three over `resolveUser`, so a strategy nobody has written yet
> inherits correct checks rather than a chance to get them wrong.
>
> **The stateless path is kept, as a choice rather than a default.** A strategy may implement
> `resolveClaimedUser`, which names the caller from the credential alone, and
> `REVALIDATE_USER_ON_AUTH_CHECK` decides which one the checks use. It returns `BaseUser` rather than
> the application's entity, which is the honest type: a token carries an identity, not a row. Nothing
> was added to the payload to make this work - `{ id, email, roles }` was already exactly a
> `BaseUser`. `getCurrentUser` never takes it, so `@CurrentUser` is always the stored user.
>
> **One read, not three.** A route requiring a login, a role and ownership asked three times over.
> The answer is memoized per request and per allowed strategy list, and `getCurrentUser` shares the
> entry, so the common case costs one lookup - fewer than before for any handler taking the current
> user.
>
> Two things came out of collapsing `belongsTo`: a missing path parameter now throws instead of
> denying (a route naming a parameter it does not have is a typo, not a failed authorization - the
> `catch { return false }` around it was A2's "silently degrades to deny all"), and a target that
> does not exist still answers denied rather than not-found, so a guarded route cannot be used to
> enumerate ids.
>
> Held by `src/__testing__/evaluation/auth-sessions-and-2fa.evaluation.test.ts`: a revoked role and a
> deleted account are both refused on the next request, against a control proving an untouched
> account still passes.

### A4. The authorization decision and the handler's identity can come from different credentials — ~~MAJOR~~ **FIXED**

`src/auth/auth.service.ts:309-322` (`hasRole`) and `:291-306` (`isLoggedIn`) use
`PromiseUtilities.anyValueTrue` — **any** strategy returning true grants access. But
`getCurrentUser` (`:144-147`) uses `Promise.allSettled` and takes the first fulfilled non-undefined
result in registration order.

`docs/auth.md:36` explicitly recommends running several strategies at once.

**Attack:** with `authStrategies: [JwtAuthStrategy, CookieAuthStrategy]`, a request carrying a
low-privilege Bearer JWT *and* an admin cookie session passes `@Auth.hasRole([ADMIN])` via the
cookie strategy, while `@CurrentUser` returns the JWT's low-privilege user. Classic confused
deputy; audit logs attribute actions to the wrong principal.

> **Fixed, by refusing the ambiguity rather than resolving it.** Strategies gained
> `hasCredential(context)` - is your kind of credential present at all, answered from the request
> with no lookup. Exactly one strategy may claim a request: none means nobody is logged in, one
> resolves it, and **more than one is a 401 before anything is read**.
>
> Picking a winner was the alternative, and every rule for picking is arbitrary. Preferring the
> strategy that satisfies the check is what the old code effectively did, which makes identity a
> function of what an endpoint demands. Preferring registration order silently drops the other
> credential. Neither is something a caller asked for, and a request carrying two identities is a
> client bug or an attack in every case we could construct.
>
> It is also the cheaper shape: the old code resolved *every* strategy on every request through
> `Promise.allSettled` and took the first that answered. Now the credential that is present selects
> the one strategy that runs, so a deployment with three strategies does one lookup rather than three.
>
> Presence, never validity: a bad token still claims the request. Answering "no credential" for a
> token that fails to verify would let an attacker pair a junk bearer header with a victim's cookie
> and have the cookie quietly win - the exact substitution this closes.

---

## B. JWT correctness

### B1. `verify()` pins nothing — ~~MAJOR~~ **FIXED**

`src/auth/strategies/jwt/jwt.utilities.ts:44`

```ts
const jwt = verify(token, secret, { complete: true }) as EncodedJwtAccessToken<Role>;
```

This is the only verification path (used at `jwt.auth-strategy.ts:216, 321, 335, 345, 363`). No
`algorithms`, `issuer`, `audience`, `maxAge` or `clockTolerance`.

jsonwebtoken v9 saves this from being critical — it defaults `algorithms` to `HS_ALGS` for a
symmetric key and rejects unsigned tokens — so `alg: none` and RS256→HS256 confusion are blocked
*by the dependency*, not by Zibri. A jsonwebtoken major bump, a fork, or a resolution override
silently reopens algorithm confusion.

What is actually broken today:

- **`issuer` is signed but never verified.** `jwt.auth-strategy.ts:425` sets it on refresh tokens;
  nothing checks it on the way back in.
- **No `audience`.** Two Zibri services sharing a secret accept each other's tokens.
- **The type assertion is unchecked.** The code reads `data.payload.id` and `data.payload.roles`
  (`:326, :349`) with no runtime shape validation.

> **Closed on all three counts, plus one the finding did not name.** `JwtUtilities.verify` now pins
> `algorithms: ['HS256']` and requires an `issuer`, and returns its payload as `unknown` so no caller
> can read a shape it has not checked. Access tokens are signed with the issuer too - only refresh
> tokens carried one - and it is the application's `name`, which means nothing to configure and a
> rename that logs everyone out. The docs say so.
>
> **`EncodedJwtAccessToken` was the unchecked assertion, in type form.** `verify` was declared as
> returning it for *both* kinds of token, so the refresh path was statically typed as holding a
> payload shape it never has. Nothing read it, so nothing broke - but the type was what made the cast
> look safe. It is now `EncodedJwt<Payload = unknown>`, with `EncodedJwtAccessToken` kept as an alias,
> and each caller narrows through a type guard beside the payload model it belongs to.
>
> **The type-claim option was declined in favour of refusing identical secrets.** Which secret
> verifies a token is what separates the two kinds; a `typ` claim would have made that explicit but
> also invalidated every live token on upgrade. Instead the strategy refuses to construct when
> `JWT_ACCESS_TOKEN_SECRET === JWT_REFRESH_TOKEN_SECRET` - the same shape as `corsMiddleware` refusing
> credentials with a wildcard origin. A misconfiguration that made a 30 day refresh token usable as a
> bearer credential now stops the application instead of surviving in it.
>
> **The framework's own fixtures had that misconfiguration.** Both test-server secrets were `'test'`,
> as were both sandbox secrets. So the check earned itself immediately, and the answer was to fix the
> fixtures rather than soften the check.
>
> **Not done: `audience`.** With the issuer verified it would carry no information the issuer does not
> already carry, for a single-audience api - which is the only shape the framework can currently be.
> Worth revisiting alongside H.
>
> **The rename consequence has a second half nobody wrote down: replicas.** "A rename logs everyone
> out" is the version across *time*; across *processes* it says two replicas that do not share a name
> refuse each other's callers, because each verifies against its own. The application `name` is
> therefore a deployment-wide constant rather than a label - it belongs with the secret, not with the
> log prefix - and a deployment that derives it per pod has no working authentication at all behind a
> load balancer.
>
> Found by the cluster harness, which had done exactly that: `cluster-instance.entry.ts` booted each
> replica as `instance-0`, `instance-1`, so a token minted on one was rejected by the other. It
> surfaced as `otp-replay.cluster.test.ts` refusing a code that had never been presented, and the
> refusal reads `authz.check failure (not-logged-in)` - the second factor never runs, because the
> caller is not logged in over there. Both replicas now boot under one name; which process a request
> reached is a separate identity, read from the environment.
>
> `baseline.cluster.test.ts` holds it now, beside the other properties nothing else in the suite means
> anything without: *accepts a caller on one instance once another one logged them in*.

### B2. Refresh-token rotation has a read-modify-write race — ~~MAJOR~~ **FIXED**

`src/auth/strategies/jwt/jwt.auth-strategy.ts:215-243`

```ts
const refreshToken = await this.refreshTokenRepository.findOne({ where: { value: tokenValue }, transaction }, false);
if (refreshToken.blacklisted) { /* delete family, throw */ }
const res = await this.createRefreshToken(user, refreshTokenValue, refreshToken.familyId, transaction);
await this.refreshTokenRepository.updateById(refreshToken.id, { blacklisted: true }, { transaction });
```

The transaction is `READ_COMMITTED` (`src/auth/strategies/jwt/jwt-auth.controller.ts:91`). The
`SELECT` takes no row lock and the `UPDATE` is unconditional, not a compare-and-set on
`blacklisted = false`.

**Failure:** two concurrent `POST /auth/refresh-login` with the same token — trivially produced by
a mobile client with two in-flight requests, or by an attacker racing a stolen token. Both read
`blacklisted = false`, both mint a new token in the same family, both commit. The family now has
two live branches: either a legitimate user is logged out later when the other branch triggers
family deletion, or an attacker holds a valid rotated token that the victim's own rotation will
not invalidate. Reuse detection is defeated exactly in the scenario it exists for.

Same defect in the cookie strategy: `cookie-auth.auth-strategy.ts:269-299`.

`README.md:42` markets "advanced features like automatic reuse detection". `docs/auth.md` does not
document rotation, reuse detection, or this concurrency constraint at all.

Held by `src/__testing__/evaluation/auth-sessions-and-2fa.evaluation.test.ts`, which asserts both
halves separately: that the family keeps one live token, and that only one of the two concurrent
callers is answered 200. They fail for different reasons and a fix could close one without the
other.

> **Closed**, and it needed no new mechanism - it is a compare-and-set, which `updateAll` became in
> [10, build order step 6](./10-leases-and-claims.md). The unconditional
> `updateById(id, { blacklisted: true })` became
> `updateAll({ value, blacklisted: false }, { blacklisted: true })`, and the rows reported back decide
> the race: exactly one caller changes the row, the other gets an empty array. `SELECT ... FOR UPDATE`
> inside the caller's transaction makes the second one wait and then re-check the predicate, so it
> sees the row no longer matches instead of overwriting it. Same change in the cookie strategy.
>
> **The claim also moved before the mint.** Minting first meant the loser had already created its
> branch of the family by the time it found out it had lost.
>
> **The losing caller deliberately does not delete the family**, which is worth stating because it
> looks like a weakening. Reuse of an *already* blacklisted token still destroys it - that check is
> above and unchanged, and is what reuse detection is for. Losing this race is a client with two
> requests in flight, and ending its session would turn a retry into an attack on itself. The
> distinction exists precisely because the read happens before the claim: "was blacklisted when I
> looked" and "was blacklisted while I worked" are different events.
>
> **Follow-up, agreed but not yet built:** the compare-and-set is only reachable through `updateAll`,
> so a single-row conditional update has to be written as a filter that happens to match one row.
> `updateById` should take the same condition - `updateById(id, data, { where })` - the way `findById`
> is already sugar for `findAll({ where: { id } })`. That means making `UpdateByIdOptions` generic
> over the entity and routing the conditional path through `saveUpdate`, which both repository
> subclasses override around.

**Both confirmed red on the first run**, with the sequential control green. Two `POST
/auth/refresh-login` in one `Promise.all` produce **two 200s and two live tokens in the same
family**, differing only in `jti` and by one millisecond of `expirationDate`. No special timing, no
load, no retry loop — a mobile client with two in-flight requests reproduces it.

### B3. `rotateSessions` mints a fresh session *after* detecting reuse — ~~MAJOR~~ **FIXED**

`src/auth/strategies/cookie/cookie-auth.auth-strategy.ts:269-299`

```ts
if (currentRefreshSession.blacklisted) {
    await this.logout({ clearCookies: true, refreshSessionId: currentRefreshSession.id, transaction });
}
// no return / no throw
await this.refreshSessionRepository.updateById(currentRefreshSession.id, { blacklisted: true }, { transaction });
const newRefresh = await this.createRefreshSession(...);
const newSession = await this.createSession(newRefresh, transaction);
this.setSessionCookie(newSession);
this.setRefreshSessionCookie(newRefresh);
```

`logout` deletes the entire family (`:209-213`), then execution falls through and creates a
brand-new refresh session **and** access session in the same family, setting both cookies. The
reuse-detection branch hands the token presenter a working session instead of denying them.

Today the callers pre-check `blacklisted` (`:236`, `:452`), so the branch is mostly unreachable —
meaning it is untested dead code on the critical path that becomes reachable the moment B2's race
lands or a caller is added.

**Deliberately not held by a test.** Re-checked while writing the B2 tests: both callers bail
before `rotateSessions` sees a blacklisted session, so nothing that drives the endpoint can reach
the branch, and a test that called the private method directly would assert how the code is written
rather than what it does. Recorded as an `it.todo` with that reasoning in
`auth-and-security.evaluation.test.ts`. The thing to watch is the fix for B2: closing that race by
widening a pre-check rather than by a compare-and-set makes this branch live.

> **Closed by making the branch end.** It logs out and then throws `CredentialReusedError`, so
> falling through to mint anything is no longer possible by construction.
>
> **It was already unreachable twice over, which is the interesting part.** B2's fix made the claim a
> compare-and-set, and `logout` deletes the row first, so the update could only fail - the presenter
> of a reused credential got a 401 either way. But it got it because a delete happened to make an
> unrelated write fail, three statements later, in a `catch` written for a different case entirely.
> That is not the same as the code being right, and the finding's own warning was about exactly this
> shape: safe by accident stops being safe when something nearby changes.
>
> **It also simplified the G1 work.** The catch below had to distinguish genuine reuse from a client
> with two requests in flight, which took a flag read before the claim. With the reuse branch ending
> where it detects reuse, that catch has one meaning again: a lost race, which must *not* be recorded
> as reuse, because a client retrying would otherwise show up in the audit trail as a stolen
> credential.
>
> Still not held by an HTTP test, for the reason above: both callers check `blacklisted` first, so
> nothing that drives the endpoint reaches it. The difference is that it is now correct rather than
> merely unreached.

### B4. Login is a timing oracle; password reset is a direct enumeration oracle — ~~MAJOR~~ **FIXED**

`src/auth/strategies/jwt/jwt.auth-strategy.ts:132-159` — an unknown email makes `findByEmail`
throw before any KDF work; a known email runs a full scrypt. The response body is identical but
latency differs by orders of magnitude, and there is no dummy-hash on the miss path. Same shape in
`cookie-auth.auth-strategy.ts:170-199`.

Password reset does not even need timing —
`src/auth/strategies/jwt/jwt-auth.controller.ts:105-119`:

- unknown email → **404**
- known email, no active token → **204** (recorded as 204, observed as 200 once a test existed, and
  204 again since void handlers stopped answering 200 — the number moved twice, the oracle did not)
- known email, active token → **429** (`jwt.auth-strategy.ts:246-249`)

Three distinguishable responses on an unauthenticated, unrate-limited endpoint.

The 429 branch is also a **denial of password reset**: `activePasswordResetTokenAlreadyExists`
(`:301-313`) refuses a new token while one is live (5 min,
`zibri-di-providers.default.ts:104`). Polling every 4 minutes permanently prevents a target from
resetting their password.

> **Fixed, in both halves, and they needed different things.**
>
> **The reset endpoint answers one way.** The controller looks the address up with
> `required: false` and simply does nothing when there is no user, so an unregistered address is
> indistinguishable from a registered one. The 429 is gone: a request while a token is still live
> returns without sending a second mail. Three responses became one.
>
> Silence was chosen over resending the same token or issuing a fresh one, both of which answer 204
> just as well. The account already holds a usable link - the mail goes to *its* inbox no matter who
> asked - so there is nothing to do rather than something to refuse, and neither alternative can be
> triggered repeatedly to fill somebody's mailbox.
>
> That also dissolves the denial of reset this entry describes, though not the way the entry frames
> it. The victim was never locked out: the attacker's request mails a working link **to the victim**.
> What the 429 actually leaked was that the address exists *and* that somebody asked about it
> recently, which is worse than the nuisance it was filed as.
>
> **The login oracle is not fixed by making the messages match**, which they already did. An unknown
> address returned out of `findByEmail` before any key derivation ran; a known one waited for a full
> scrypt. Both strategies now resolve the stored password first and run **exactly one comparison on
> every path** - against a stand-in hash when there is nothing real to compare against. Putting the
> stand-in in the existing `catch` would have been wrong in a way worth naming: the wrong-password
> path already ran a hash, so it would have paid for two and become distinguishable from both others.
>
> The stand-in is hashed from a value nobody holds, using the default strategy, so it costs what a
> real comparison costs and follows a change of strategy for free. It is produced once per process -
> the first miss pays for making it, which is one request out of all of them.
>
> **What this costs, and it is worth stating:** an unknown address now burns a full KDF, so the login
> endpoint became slightly more attractive as a CPU exhaustion lever. E1's limiter bounds it to
> twenty attempts per caller per ten minutes, and D1 - scrypt's fixed work factor, and the missing
> `maxLength` on the password field - is still the open half of that. *(Both closed since: D1 for the
> work factor, E1 for the length.)*
>
> Held by `src/__testing__/evaluation/auth-and-security.evaluation.test.ts`: the reset half compares
> the two statuses directly, and the timing half asserts that a comparison *happened* for an unknown
> address rather than measuring how long it took, because a timing assertion is a flaky test of a
> real property.

### B5. Password reset tokens are stored in plaintext — ~~MAJOR~~ **FIXED**

`src/auth/models/password-reset-token.model.ts:20-21` — `@Property.string() value!: string;`.
Generated as `randomBytes(16).toString('hex')` (`jwt.auth-strategy.ts:252`), so entropy is fine,
but persisted raw. The framework's own `@Property.string({ hash: true })` mechanism is not applied
to its own reset tokens.

Any SQL injection, read-replica exposure, backup leak, or over-privileged support query yields
live reset tokens for every pending reset → immediate account takeover, no cracking required. Same
for `CookieAuthRefreshSession.csrfToken` and `JwtRefreshToken.value`.

> **Fixed, but not with the mechanism this entry names.** `@Property.string({ hash: true })` cannot
> be applied to any of these: `ScryptHashStrategy` salts with `randomBytes`, so the same token hashes
> differently every time, and every one of these values is *looked up by value* - the token arrives
> on its own, with no email or id in the request to find its row by. Turning `hash: true` on would
> have made every lookup miss. `equal` does not rescue it either: comparing needs a candidate row,
> and finding one would mean loading every live token and running a KDF against each.
>
> The mechanism that was missing is a **deterministic** hash, and the framework turned out to have
> the seam for it already - `HashOptions` carries a per property `strategy`, and the stored envelope
> is `name.version.hashedValue` with no per call randomness. So `Sha256HashStrategy` is a strategy
> like any other, asked for by the property, and the column stays searchable: hash what the caller
> presented and query for it.
>
> **Unsalted and fast is correct here, which is worth stating plainly because it looks wrong.** Slow
> salted KDFs exist because passwords are guessable - the cost is per guess, and the salt defeats
> precomputed tables and stops equal passwords sharing a hash. A `randomBytes(16)` token has 2^128
> candidates and is unique by construction, so neither property has anything to do. Against a
> password both are exactly what is missing, which is the real hazard of adding this.
>
> **So the strategy declares `deterministic: true` and the service refuses to make one the default.**
> `findDefaultStrategy` fell back to `strategies[0]`, meaning registration order alone decided what
> every password was hashed with - and getting that wrong is silent, because the hashes still look
> like hashes. That is now an error rather than an ordering convention.
>
> **What it buys, stated narrowly:** passwords in this table were already scrypt-hashed, so a leaked
> backup was a cracking exercise rather than a compromise - except for these tokens, which were
> presented to the api verbatim. A read-only copy of the database is no longer an immediate takeover.
> It does nothing against an attacker with *write* access, who can insert a digest of a token they
> chose; an HMAC would close that and was rejected, because someone who can write rows can equally
> insert a user with a password hash they know.
>
> **Hashing the column broke the flow that uses it, and the tests caught it.** The strategy read the
> token back off the created entity to build the reset link - so once the property was hashed, the
> mail carried a hash of the user's own token and every reset failed. The token now exists in exactly
> one place, a local before the write, which is the same shape C1 arrived at for the qr code: a value
> derived once, needed in the clear at one moment, and never recoverable afterwards.
>
> That is also why three suites had to change how they get the token. They read it out of the
> repository, which no longer holds it; they now take it from the link in the mailed email, which is
> the only place it exists and the path a user actually takes. **Reading it from the row is what let
> the stored value and the mailed one drift apart without a single test noticing.**
>
> **The plaintext moved rather than vanished, which is worth being exact about.** A reset link is the
> token in the clear by definition, so the queued email row holds it until the mail is sent. `persist`
> defaults to false and a sent mail is deleted, so that window is the queue latency rather than the
> token's lifetime - but `...data.emailData` spread last, so an application asking for `persist: true`
> kept the link in the database indefinitely, long outliving the five minutes the token is good for.
> Both strategies now pin `persist: false` after the spread. Refresh tokens are unaffected: nothing
> mails those, and they are the ones that live for 30 days.
>
> **Not covered, and worth its own entry:** the cookie strategy's session and refresh-session ids are
> the cookie values *and* the primary keys, so a database read still yields usable sessions there.
> Hashing a primary key is not possible; it needs a separate secret column, which is a different
> change from this one. `CookieAuthRefreshSession.csrfToken` is also still plaintext - it is compared
> rather than looked up, so it could take the same treatment, but its comparison is F4's subject and
> the two should move together.
>
> Held by `src/__testing__/evaluation/auth-and-security.evaluation.test.ts`, which asserts the
> property metadata rather than the column, and by every existing auth suite: a broken lookup would
> take password reset and refresh-login down with it. `src/auth/hash/hash.service.test.ts` pins the
> determinism and the ordering guard.
>
> **Found later (2026-10-05, while planning H2), and fixed:** a confirmed reset did not end cookie
> logins. `CookieAuthStrategy.confirmPasswordReset` deleted the user's sessions but not their refresh
> sessions, and a refresh session whose session is gone rotates into a new one. So whoever held the
> cookies before the reset, usually the reason for it, stayed logged in with one call to
> `refresh-login`. The jwt strategy deleted its refresh tokens and was not affected. Held by
> `cookie-auth.controller.test.ts`, where the cookies from before a reset can no longer refresh.

### B6. Insecure token-lifetime defaults — ~~MAJOR~~ **FIXED**

`src/di/default/zibri-di-providers.default.ts:98` and `:137` — 100 days for both
`JWT_REFRESH_TOKEN_EXPIRES_IN_MS` and `COOKIE_AUTH_REFRESH_SESSION_EXPIRES_IN_MS`.
`docs/auth.md` does not mention these tokens, their defaults, or how to change them.

> **Both are 30 days.** A refresh credential is a live login for its whole lifetime, so the number is
> how long a stolen one stays worth stealing; 100 days was a third of a year. 30 is the usual "stay
> signed in" window, and short enough that the value is not the thing that fails a review.
>
> **The undocumented half mattered more than the number**, and is the reason this was worth its own
> entry rather than a one line diff: `docs/auth.md` named none of these tokens, so a team following
> the documentation shipped 100 day sessions without ever seeing a number to disagree with. All five
> lifetimes are now in one table there, with the refresh one called out as the one to think about and
> an example of shortening it.

---

## C. Two-factor authentication

### C1. TOTP secrets are stored in plaintext — ~~MAJOR~~ **FIXED**

`src/auth/2fa/methods/otp/otp-credentials.model.ts:20-22` — `@Property.string() secret!: string;`.
Not `{ encryption: true }`, despite the framework shipping exactly that feature. A database read
yields every user's TOTP seed; the compromise is undetectable and unrevocable without re-enrolling
every user.

> **Fixed, and the finding was half the story.** `secret` is `{ encryption: true }` now - encrypted
> rather than hashed, because validating a code means recomputing it from the seed, so it has to come
> back out.
>
> The other half: `OtpCredentials.qrCodeUrl` stored `totp.toString()`, an `otpauth://…?secret=…` url
> with the same seed embedded in plaintext. Encrypting one column and leaving the other would have
> been theatre.
>
> **Deleting it was wrong too, and the user caught that.** The url is what a user scans to enroll -
> the column existed because someone meant to show it. What was actually broken is that nothing ever
> read it back: `requestRegisterForUser` returned `void`, so an application had no way to obtain the
> qr code at all. A write-only column holding a copy of the secret was the symptom, not the disease.
>
> So `TwoFactorMethod` gained a third generic for what enrolling *answers*, defaulting to `void`
> because a method that mails a code has nothing to show. `OtpTwoFactorMethod` returns
> `OtpRegistration` - the url and the secret, the latter for typing in when a camera is not an option
> - both derived in memory and neither stored. Enrollment is the one moment either is needed in the
> clear. It is a class rather than a type so that an application returning it from an endpoint gets
> OpenAPI generation for free.
>
> **A new requirement falls out of this:** an application using the builtin TOTP method must now
> configure `ENCRYPTION_MASTER_OPTIONS`, or enrolling throws. That token had no default and, per D4,
> was not documented at all; it is now named in both `docs/two-factor.md` and
> `docs/encryption-and-hashing.md`.
>
> **Encrypting it made a fixture bug visible, which is worth recording because the same mistake is
> available in production.** Every replica has to unwrap the data key with the *same* master key, and
> the test providers minted theirs with `randomBytes(32)` at module load - once per process, so each
> forked replica held a different key under the same id. A secret written by one replica was then
> unreadable to the others. Nothing had encrypted anything across replicas before, so nothing had
> ever asked.
>
> How it presented is the part worth keeping: `has2fa` swallows whatever `validate` throws, so a key
> nobody could use was reported as a **wrong code**. Recorded against
> [02-http-runtime-core.md](./02-http-runtime-core.md) §M8, which is the finding for that shape.
>
> Held by the metadata assertion in `auth-and-security.evaluation.test.ts` and by the 2FA suites,
> which enroll and validate for real - an encrypted seed that failed to round-trip would fail every
> one of them. `cluster/otp-replay` is what actually caught the key problem, and only because its
> first case asserts that the replica which did *not* enroll accepts the code: without that control
> the second case still saw one acceptance and one refusal, and would have gone green while proving
> nothing.

### C2. Unconfirmed TOTP enrollments satisfy 2FA — ~~CRITICAL~~ **FIXED** **[verified]**

`src/auth/2fa/methods/otp/otp.two-factor-method.ts:73-85`

```ts
async validate(user, context): Promise<void> {
    const credentials = await this.otpCredentialsRepository.findAll({ where: { userId: user.id } });
    const token = this.extractTokenFromRequestContext(context);
    for (const c of credentials) {
        if (OtpUtilities.validate(c.secret, token)) return;   // never checks c.confirmed
    }
    throw new UnauthorizedError(...);
}
```

`OtpCredentials.confirmed` exists (`otp-credentials.model.ts:24-26`, default `false`) and
`confirmRegisterForUser` sets it (`otp.two-factor-method.ts:59`), but `validate` ignores it.

Compounding: `requestRegisterForUser` (`:43-49`) inserts a new row on every call with no delete of
prior rows and no cap.

**Attack:** anyone who reaches the register-request endpoint (it is the application's job to gate
it — see A1) obtains a secret that immediately satisfies `@Auth.require2fa` with no confirmation
step. 2FA is bypassed by enrolling a second factor you control. Even without that, a user who
abandons an enrollment mid-flow leaves a permanently valid unconfirmed secret behind.

> **Fixed**, in all three places the finding names.
>
> `validate` reads `confirmed: true` only. An enrollment nobody finished is a secret nobody has
> proven they hold, so accepting it meant the second factor could be satisfied by starting an
> enrollment and skipping the step that exists to verify it.
>
> `confirmRegisterForUser` now matches `confirmed: false` only. Confirming is what proves the
> authenticator holds *this* secret, so a code from an already confirmed credential proves nothing
> about the new one and must not stand in for it.
>
> `requestRegisterForUser` deletes the user's unconfirmed rows before inserting - asking for a new
> enrollment abandons any unfinished one. Confirmed credentials are deliberately left alone: a user
> setting up a new device must not lose the factor that currently works before the new one is proven.
> That closes the "no delete of prior rows and no cap" half without needing a cap.

### C3. No TOTP replay protection and no brute-force limit — ~~MAJOR~~ **FIXED**

`src/auth/2fa/methods/otp/otp.utilities.ts:15-18` uses otpauth's default `window` of 1 → a ±1-step
(~90 s) acceptance band. No used-code store, no per-user counter, no attempt throttle anywhere in
`TwoFactorService` (`src/auth/2fa/two-factor.service.ts:89-106`).

Worse, the OTP is re-validated **per request**: `@Auth.require2fa` calls `has2fa` on every
protected call (`src/auth/auth.service.ts:263-269`), reading the code from a header
(`otp.two-factor-method.ts:88`). The same 6-digit code is transmitted on every request for its
whole validity window and is replayable by anyone who observes it once. With no rate limit (E1),
a 90-second window admits unlimited guesses against a 10^6 space.

> **Replay is fixed. The brute-force half is not** - that is E1, and it is still open.
>
> *Re-checked 2026-10-01: the pointer above is stale and the half it points at is not.* E1 has closed,
> but its limiter guards login and the password reset routes only. A code is presented to an
> `@Auth.require2fa` route, and nothing in `TwoFactorService` or the otp method counts failed codes,
> so a wrong guess there is still free: a caller holding a valid session can try codes against the
> acceptance window without limit. Only a code that matched is spent. This half has no other owner.
>
> **The brute-force half closed 2026-10-02.** `TwoFactorService.validate2fa` counts wrong codes per
> user, and after the n-th wrong code in a row the next code is checked only after 2^(n-1) times
> `TWO_FACTOR_FAILURE_DELAY_IN_MS` (1 second by default; 0 is refused at boot, because it would switch
> the wait off). A code presented during the wait answers `429` with `Retry-After`, **unchecked**:
> checking it and only delaying the answer would still tell the guesser whether it was the one. A
> correct code ends the streak, which lives in `TwoFactorFailureStreak`.
>
> What decided the shape, from the standards rather than taste. NIST 800-63B counts per account and
> per authenticator; RFC 4226 §7.3 counts per device and requires the limit to span sessions; Auth0
> and django-otp both count per user or device. Microsoft's AuthQuake (2024) counted per session and
> was beaten by opening sessions in parallel. **Per user, not per caller**: the caller reaching a
> `require2fa` route already holds the user's session, so the per-account lockout argument E1 rejected
> for login does not apply - nobody without the account can make its codes fail - and an address
> costs that caller nothing. **Doubling, not a budget**: 5 per 15 minutes still hands a persistent
> guesser about 480 codes a day, roughly 41% over a year against the three codes the default skew
> accepts; doubling leaves a few dozen a year, about 0.008%, and costs a typo one second.
>
> **Parallel guesses are the part that is easy to get wrong.** Reading the streak, checking and
> writing are three steps, so a hundred codes sent at once would all read the same streak. The check
> runs under a lease keyed `2fa:<userId>` in `skip` mode - one check per user at a time, on every
> instance - and a code arriving while another is checked answers `429` too. Shared across instances
> for free, because the code check already reads the data source on every call; the in-memory
> argument E1 made for login does not hold here.
>
> **Only a wrong code counts.** `InvalidTwoFactorCodeError` is what a method throws for one; no code,
> a malformed code and a spent code are not guesses, and counting them would make a client that asks
> before it has a code pay for it. Exported, so a custom method opts its wrong codes in.
>
> **Found on the way, and fixed with it:** `OtpCodeAlreadyUsedError` never reached a caller. `has2fa`
> caught every method's error and answered `false`, and the route then threw one generic message, so
> `docs/two-factor.md`'s promise that a replay is told apart from a typo was not kept. The route now
> passes the refusal on through `validate2fa`. With several allowed methods it still answers the
> generic message, because each method's reason describes a factor the caller may never have meant to
> present. Also changed with it: a method that *could not answer* - a data source that is down - is
> no longer a `401` but rethrown, so a client is not sent to ask its user for a new code against an
> outage; that matches what login already does.
>
> ~~**Deferred, on purpose: an optional hard limit.**~~ NIST also allows disabling the factor after at
> most 100 wrong codes in a row, which caps the *total* chance of a hit instead of its rate. It needs
> a way back for the user whose factor was disabled - a re-enrollment flow, proving the account
> another way and enrolling a new authenticator - and that flow is worth having anyway, for a lost
> device. This is the context to add both in. Noted at `recordFailure` in `two-factor.service.ts`.
>
> **Both closed 2026-10-13.** The app option `twoFactorFailureLimit` is `false` (the default) or
> `{ maxFailures, lock }`; the n-th wrong code in a row with n at the limit sets `lockedAt` on the
> streak and answers `TwoFactorLockedError` (403). The user first wanted it required by the two-answers
> rule, then overrode that: `false` by default, so no existing app changes.
>
> **"Disabled" cannot mean "removed", and that decided the shape.** Deleting the guessed factor would
> leave the user with none, and every route with `reauth: true` or `'onlyAsFallback'` would then let the
> session through on its recent login - so a guesser holding a session could send wrong codes on
> purpose to strip the factor. A locked factor stays registered and refuses everything, and a recent
> login does not stand in for it either (`AuthService.validate2faOrReauth` asks `resolveLock` first).
>
> **Two locks, the user's call** (they asked whether a strict admin would want login refused too):
> `'secondFactor'` refuses every `require2fa` route; `'account'` also refuses login
> (`AccountLockedError`) and ends the user's open logins when it is set, because the guesser already
> holds a session - presenting a code takes one - and refusing new logins alone would leave them it.
>
> **The way back is two things, both the user's choice:** `RecoveryCodeTwoFactorMethod` (10 one-time
> codes, sha256-hashed and findable, confirmed by presenting one, a new set replacing the old only once
> confirmed) and `TwoFactorService.resetSecondFactors` for an app's own support route. While locked,
> only a method declaring `unlocksLockedFactors` is checked; a correct recovery code removes the
> user's other methods (the disabled authenticator is not given back - NIST's re-enrollment), lifts
> the lock and lets the request through, a wrong one counts towards the wait. An account lock is
> lifted only by a reset, since a recovery code needs a login to be presented.
>
> **What the doubling does to the limit, worth knowing when choosing it:** the n-th wrong code waits
> 2^(n-1) seconds, so 30 in a row take over 17 years and NIST's 100 is never reached. The limit only
> bites at small values (10 is reached after about 8.5 minutes); the docs say so. `maxFailures` outside
> 1-100 or not whole is refused at boot. Turning the limit back to `false` lifts every lock, since a
> lock is read under the limit set now.
>
> Held by `two-factor.service.failure-limit.test.ts` (in memory, over http, both locks: locking at the
> limit and saying so; the right code of a locked method unchecked; a recent login refused while
> locked; a recovery code unlocking and removing the locked method; a wrong recovery code counted;
> login still working under `'secondFactor'`, refused with the refresh ended under `'account'`; a reset
> lifting either; the recovery set replaced only once confirmed; the boot refusals).
>
> Held by `two-factor.service.test.ts` (doubling, the right code refused during the wait and ending
> the streak, what does not count, both boot refusals) and by the C2/C3 block of
> `auth-sessions-and-2fa.evaluation.test.ts` over HTTP (the `429` and its `Retry-After`, ten parallel
> wrong codes counting as one, the replay message reaching the caller).
>
> `OtpUtilities.validate` now returns *which* step matched instead of a boolean, and that step is
> recorded as spent. The record is a lease keyed `otp:<credentialsId>:<step>`, retained rather than
> released, so the grant itself is the "already used" marker and lapses once the step can no longer
> be presented. Cross-instance for free, and `LeaseCleanupCronJob` already sweeps it - a per-process
> store would have let a replay simply pick a different replica.
>
> Spending the **step** rather than the code string is the part worth keeping in mind: the same six
> digits are shown for a whole step, so the digits alone cannot say which use they were.
>
> **`re-validated per request` was recorded as a flaw and is not one.** The reasoning was that a code
> travels on every request for its whole validity window. But 2FA here is step-up: it is presented
> for a single operation - a login, a payment change - and nothing is sent in between. A code per
> protected operation is the correct shape, and the alternative considered while writing this
> (establish 2FA once per session) would have been strictly weaker, since one code at login would
> then authorize every dangerous action after it.
>
> **What this costs**, and it is a real cost rather than a hidden one: two step-up operations inside
> the same 30 seconds mean the second is refused, because RFC 6238 §5.2 requires exactly that. The
> mitigation is an error that says so - `OtpCodeAlreadyUsedError`, distinct from a wrong code though
> both answer 401 - so a legitimate user is told to wait rather than told they mistyped.
>
> The acceptance window is `OTP_VALIDATION_WINDOW_IN_MS`, typed as the multiples of the 30 second
> period rather than as a number. 45 seconds is not a narrower 60, it is 30 wearing a misleading
> label, so the values that cannot be honored are not expressible.

> **The cross-replica half is covered separately**, in
> `src/__testing__/evaluation/cluster/otp-replay.cluster.test.ts`. It is the only place the choice of
> a lease over a per-process store can be observed at all: a code accepted on one replica is refused
> on the other, and two replicas given the same code at the same moment let exactly one through. The
> single process suite would pass identically against a store that never left the process, which is
> the mistake this is here to catch.

C2 and C3 are both held by `src/__testing__/evaluation/auth-sessions-and-2fa.evaluation.test.ts`,
and both are **confirmed red** — an unconfirmed enrollment and a replayed code each answer 200 on a
`@Auth.require2fa` route, against a green control proving a confirmed enrollment authenticates. C4
below is confirmed too: 401 for a user holding a valid second factor.

### C4. `@Auth.require2fa()` with no argument denies everyone — ~~MAJOR~~ **FIXED**

Found while writing the C2/C3 tests, not in the original review.

`require-2fa.decorator.ts:22-24` stores `allowedMethods: allowedMethods ?? []`, and
`TwoFactorService.has2fa` (`two-factor.service.ts:88-105`) declares
`allowedMethods: TwoFactorMethods = this.twoFactorMethods` — a parameter default, which only
applies when the argument is `undefined`. `auth.service.ts:265` passes
`require2faMetadata.allowedMethods`, so the empty array wins: `Promise.any([])` rejects
immediately, the `catch` returns `false`, and the route answers 401 to a user holding a perfectly
valid second factor.

The unqualified form is the one a developer reaches for first, and its failure looks exactly like a
wrong code rather than like a misconfiguration. Passing `[]` explicitly should arguably mean "no
method is acceptable"; omitting the argument should mean "any configured method". Today they are
the same value and cannot be told apart.

> **Fixed**, and by taking exactly the distinction the paragraph above asks for. The decorator stores
> `allowedMethods` as given, so omitting it leaves `undefined` and `has2fa`'s parameter default -
> every configured method - applies as it was always meant to. `[]` remains expressible and still
> means "no method is acceptable", which denies everyone; it is now something a caller has to ask
> for rather than what they get by default.
>
> `Require2faMetadata.allowedMethods` was already optional, so the `?? []` was the whole defect: one
> `??` turning the common form of a decorator into a route nobody could pass.

## D. Cryptography, secrets, encryption

### D1. scrypt work factor is hardcoded and cannot be raised — ~~MAJOR~~ **FIXED**

`src/auth/hash/strategies/scrypt.hash-strategy.ts:36-44`

```ts
export type ScryptHashOptions = { saltLength?: number };
const hash = await this.scrypt(value, salt, this.keyLength) as Buffer;
```

No `N`, `r`, `p` or `maxmem` are passed, so Node's defaults apply (N=16384, r=8, p=1). OWASP's
current guidance is N=2^17. The options type exposes **only `saltLength`** — there is no supported
way to increase the work factor short of forking the strategy. `ScryptHashStrategy` is the default
(`zibri-di-providers.default.ts:139`) and `docs/encryption-and-hashing.md:59` documents it as such
without stating the parameters.

`BcryptHashStrategy` (`src/auth/hash/strategies/bcrypt.hash-strategy.ts:30`) defaults to
`rounds ?? 10`, also below current guidance, and `bcryptjs` is pure JS, so it burns the main
thread rather than the libuv pool.

> **Closed by writing the cost into the hash.** `ScryptHashOptions` now carries `cost`, the default
> comes from `ZIBRI_DI_TOKENS.SCRYPT_COST`, and the shipped value is what current guidance asks for
> (n=2^17, r=8, p=1) rather than node's n=2^14. `maxmem` is derived from the parameters instead of
> being a separate knob, since a `maxmem` that does not fit the cost can only ever produce a failure.
>
> **The version bump this seemed to need does not work, and that is worth recording.** `version` is a
> registry key: `findStrategy` matches name *and* version exactly, and `validateNoMissingHashStrategy`
> refuses to boot when a stored strategy row has no registered match. Bumping `ScryptHashStrategy` to
> `v2` would therefore break every existing `scrypt.v1.…` hash *and* stop the application starting.
> Serving several versions from one strategy is a registry redesign, not a parameter change. Instead
> the **value** is self-describing - `n=…,r=…,p=…:salt:hash` - and `equal` falls back to node's
> defaults for the old two-part form, which is exactly what those hashes were made with.
>
> **Not done: bcrypt.** Its `rounds` was already configurable, so the finding's second half is about
> the default being 10 and `bcryptjs` being pure JS. Raising the default has the same migration
> question and the same answer as scrypt, but bcrypt is not the default strategy and nothing ships
> using it; swapping `bcryptjs` for a native binding is a dependency decision rather than a fix.

### D2. Hash and key deprecation are dead features — ~~MAJOR~~ **FIXED**

`HashService.needsRehash` (`src/auth/hash/hash.service.ts:100-105`) reads
`HashStrategyStatus.DEPRECATED` and is called from exactly one place: a test
(`src/auth/hash/hash.service.test.ts:58`). No login path calls it, so marking a hash strategy
`DEPRECATED` does nothing and stored passwords are never upgraded.

Identically, `EncryptionService.needsReEncryption`
(`src/auth/encryption/encryption.service.ts:360-371`) has no production caller. Marking a data key
`DEPRECATED` never re-encrypts the rows it protects. The only rotation that actually runs is
master-key re-wrap at startup (`:689-702`), which touches the key rows, not the data.

Cryptographic agility and key rotation are audit line items. The API surface implies both are
supported; the code delivers neither.

> **The hash half is closed.** Both builtin strategies call `needsRehash` after a successful password
> comparison and, when it says so, write the plaintext back - the entity hook re-hashes it with the
> current strategy and cost. Marking a strategy `DEPRECATED` now moves accounts off it as they sign
> in, and so does raising the scrypt cost, because `needsRehash` answers on either ground.
>
> **It is in the strategies, not in `AuthService`, and that was a deliberate answer to "shouldn't this
> be central?".** `resolveCredentialsFor` returns `CredentialsType` - fully generic - so the service
> has no typed handle on a password field or on which repository holds it. A central implementation
> would have to guess the field name, derive the repository from `credentials.constructor`, and do
> nothing at all for a strategy that has no stored password. It would also re-read the user and
> credentials that the strategy already has in hand. If a third password-based strategy appears, the
> thing to add is an optional `upgradeCredentials?` on `AuthStrategyInterface` so the service owns
> *when* and the strategy owns *how*.
>
> A failed upgrade is logged and swallowed: the caller proved who they are, and a write that did not
> happen means a hash stays old, not that a valid login should be refused.
>
> Held over http by `jwt-auth.password-upgrade.test.ts`: a server stores a password at a low cost,
> is redeployed on the same database with the cost raised, and the next login rewrites the hash and
> still works afterwards. Until the todo audit only `needsRehash` itself was
> tested, which says nothing about whether a login ever asks it.
>
> **The encryption half is closed too, and needed three things rather than one.**
>
> `EncryptionRotationCronJob` is registered by the encryption service itself, `distributed: true`, and
> rewrites at most 500 rows an hour. No progress is stored: "needs rewriting" is a property of the row,
> so the next run finds whatever is left, and nothing goes stale when rows are inserted or deleted
> underneath it. It resolves which entities can hold an encrypted value once, at init, from the data
> sources' entity lists.
>
> It also sweeps values written before D3's row binding existed, so binding reaches data that was
> already in the database instead of only new writes. That is why `needsReEncryption` takes
> `shouldBeBoundToRow`: whether an unbound value is wrong is not something the value can answer,
> because a property may have asked not to be bound, and sweeping those would never finish.
>
> **The job could not see what it needed to judge, which produced the more broadly useful change.**
> A repository decrypts on the way out, so the envelope - which key wrote a value, whether it is
> bound - is gone before a caller sees it. Rather than let the job reach into the driver, reads take
> `autoDecrypt: false` (the user's idea, and better than what was asked for: it makes inspecting a
> stored value a supported thing rather than a back door). `BeforeReturnHook` takes it as a third
> parameter; writes always pass true.
>
> **There was also no way to deprecate a key.** The finding says the API implies deprecation is
> supported and the code delivers nothing - that turned out to be literally true: no method set
> `DEPRECATED`, so it was reachable only by writing the row, which bypasses the key cache and leaves
> the process believing the key is fine. `deprecateKey` closes that, and refuses the default key.
>
> **What it does not cover.** A key cannot be deleted until the sweep is done, and nothing reports how
> much is left beyond a log line when a run hits its budget. The sweep reads every row of every entity
> holding an encrypted property to find work, because the envelope is not queryable - fine hourly on a
> modest database, and the thing to revisit on a large one. And a row whose values cannot be decrypted
> at all is logged and skipped forever rather than escalated.
>
> **The report closed 2026-10-13, shared with §D4.** `EncryptionServiceInterface.resolveRetiredKeyUsage`
> counts, on demand (the user's choice over counts recorded by each sweep), the stored values under
> every deprecated data key, and the data keys and recorded backups under every entry of
> `oldMasterKeys` and `oldMasterStrategies`. The walk over a row's encrypted values is shared with the
> sweep (`findEncryptedValues`), and so is the list of entities that can hold one.
>
> **The user's question is what shaped it: is 0 really "unused"?** A backup taken before a rename
> holds the old column and was the example. Working it through: a backup holding the data source with
> the key table brings its data keys back on restore, so deleting a live key does not hurt it - but it
> needs the master keys those rows were encrypted under, *whether or not the backup is encrypted*. The
> first draft counted backups by their archive key, so every unencrypted backup counted for nothing,
> and the report would have called a master key unused that a restore still needs (the application
> refuses to start with a key row under an unlisted master). And a backup that does *not* hold the key
> table - encrypted entities in one data source, keys in another that is not backed up - needs its
> data keys to still exist, which a live count cannot see either (the user's follow-up). So each backup
> now records when it is taken what it will need: `masterKeys`, and `dataKeyIds` only when it does not
> hold the key table. The report counts backups from that record.
>
> **Stated as the boundary, by the user's choice:** a value encrypted by calling `encrypt` directly, or
> in a column no current model declares, is not counted, and the sweep does not rewrite it either. The
> JSDoc and `docs/encryption-and-hashing.md` say so. `BACKUP_FORMAT_VERSION` was not raised for the two
> new record fields: format 1 has never been released, so there is no reader of a format-1 record
> without them. The 3.0 upgrade migration in `docs/upgrading-to-3.md` adds them empty to 2.x backups,
> which a restore refuses by format anyway.
>
> Held by `encryption.service.retired-keys.test.ts` (in memory: nothing retired; a deprecated key
> counted until the sweep empties it; a backup without the key table counted per data key; a data key
> written under the old master by an instance not yet given the new one), and by the backup suites
> (an encrypted and an unencrypted backup each counted towards the master of its time).

### D3. Encrypted values have no context binding — ~~MAJOR~~ **FIXED**

`src/auth/encryption/encryption.service.ts:236-244` — everything needed to decrypt is read out of
the encrypted value envelope itself. The AES-GCM strategy supports AAD
(`src/auth/encryption/strategies/aes-gcm.encryption-strategy.ts:44-46`), but the entity hook passes
none by default (`src/global/model-registry/decrypt-encryption-properties.function.ts:56-59`).
The envelope header (`strategyName.version.keyId`,
`src/auth/encryption/encryption.utilities.ts:41-43`) is also **outside** the GCM tag, i.e.
unauthenticated metadata.

**Attack:** anyone with a write primitive on the database (SQLi, a permissive admin CRUD endpoint,
a compromised ETL job) copies user A's encrypted SSN encrypted value into user B's row. It decrypts
cleanly and is served to B. Encryption at rest gives confidentiality against a stolen disk and
zero integrity binding against a tampering adversary.

> **Fixed.** An encrypted value now carries the row it was written to inside its authentication tag,
> so the copied value refuses to decrypt anywhere else. On by default, `encryption: { bindToRow:
> false }` to opt out per property. The envelope header goes into the aad too, which is the second
> half of the finding.
>
> **The version is not what carries this, and that was the whole design problem.** A strategy is
> looked up by name and version and its keys hang off that pair, so a bump partitions the keys and
> needs every stored value migrated before the app can read them - the same trap as the scrypt cost in
> D1, and the same answer: the *value* describes itself. `aes-256-gcm.v1.<keyId>.b.<iv>.<tag>.<ct>` is
> bound to its row, `.u.` to its envelope only, and a three-segment value is one written before any of
> this and still decrypts. The marker is covered by the tag, so downgrading or stripping it fails.
>
> **The binding names the row and deliberately not the entity or the property.** That was the user's
> question and it changed the design: naming the column would also stop a value moving between two
> encrypted columns of one row - but that is the *same operation* as renaming the column, and the
> encryption cannot tell them apart. A value that stays in its row and is read under another name is
> either an attack or a migration. Refusing it makes renames destroy every value in the column,
> silently, at the next read; allowing it leaves the same-row move open. Renames are far more common,
> so that is the one that had to keep working. Any move that crosses rows changes the id regardless.
>
> **Two things had to move for the row id to exist when it is needed.** `create`/`createAll`/`upsert`
> now assign the id before the save hooks instead of leaving it to the driver, so a hook can see which
> row it is preparing - useful well past encryption, and it makes ids come from one place across data
> sources. And `updateAll` cannot carry one bound value to many rows, by construction: it reads the
> rows it matched, encrypts one value per row, and writes them through `driver.save` - a single call,
> the same primitive bulk creation uses. That path only runs when a bound property is actually in the
> update data.
>
> **The atomicity note this originally carried was overstated and is now corrected.** The read does
> not cost a guarantee the single statement had: at the isolation level either gets by default, a row
> inserted mid-update is missed by both. What changes is the width of the window, and a caller who
> needs the two to be one thing supplies a transaction - both halves run inside it.
>
> **What it does not cover.** Moving a value between two encrypted columns of the same row, which is
> the deliberate trade above. A migration that rewrites rows under new ids, which has to re-encrypt as
> it goes. And values already stored stay unbound until their row is written again - sweeping them is
> D2's open half.

### D4. Master keys are raw in-process values; no KMS/HSM path — ~~MAJOR~~ **FIXED**

*Closed on 2026-10-03: what kept it partly open was a kms strategy zibri will not ship, which is a
decision, and the missing report of what is still under an old master, the residue [§D2](#d2-hash-and-key-deprecation-are-dead-features--major-fixed)
closed with too. That residue is listed once for both in [11](./11-whats-left.md).*

`src/auth/encryption/encryption-master-options.model.ts:6-15` —
`EncryptionMasterKey<TKey> = { id: string, value: TKey }`. The master key material is a plain
value handed to the DI container at boot and held in `EncryptionService.options` for process
lifetime. No envelope-encryption hook to AWS/GCP/Azure KMS, Vault or PKCS#11, no key-handle
abstraction, no way to keep the root key off the application host.

`docs/encryption-and-hashing.md`'s "Configuration" section (`:58-59`) mentions only strategy
overrides and **never mentions `ENCRYPTION_MASTER_OPTIONS` at all** — despite the service throwing
`NoProviderError` without it (`encryption.service.ts:110-112`). A reader of the docs cannot
configure the feature.

Same for JWT: `JWT_ACCESS_TOKEN_SECRET` / `JWT_REFRESH_TOKEN_SECRET` are `string`s injected once
at construction (`jwt.auth-strategy.ts:99-119`). Symmetric only, no RS256/ES256, no JWKS, no
`kid`, no rotation window — a secret change invalidates every outstanding token instantly.

> **The seam this asks for already existed and nobody could tell**, which is a different problem
> from the one the entry describes and needed a different fix. `EncryptionStrategyInterface<TKey>`
> puts the key type in the caller's hands, every method on it may be async, and the master strategy
> is injected as an instance rather than a class. So `EncryptionMasterKey.value` never had to be key
> material: a strategy whose `TKey` is an arn and whose `encrypt`/`decrypt` call out to a kms fits
> the interface as written. What was missing was any statement that this was allowed, anything
> proving it worked, and a `value` documented as "The actual value".
>
> **So the fix is a test that could only pass if the seam is real**, not a new abstraction. The
> evaluation suite now re-initializes the application with a master strategy whose keys live in a map
> the framework cannot reach, keeping the aes-gcm one as an old master. Booting rewrites every data
> key under the remote master, a row written before the change still decrypts, and a new one round
> trips - so unwrapping and wrapping both went through a handle. Adding a `KeyProvider` interface on
> top of that would have been a second abstraction over a working one.
>
> **Writing the test found a type that made the feature unusable.** `oldMasterStrategies` was
> `EncryptionStrategyInterface<unknown>[]`, and a strategy that needs a `Buffer` cannot be handed an
> `unknown` - so the one field whose entire purpose is holding strategies you are migrating *away*
> from accepted nothing without a cast at the call site. It is `any` now, with the reason written
> down: this is a list whose elements deliberately do not share a key type, which is the case
> TypeScript has no other way to express.
>
> **It also found a defect that only a second boot could ever show.** `onAppInit` read
> `strategyRepository.findAll()` with no relations, so every strategy row already in storage came back
> with `keys` undefined - and everything downstream treats `keys` as an array it searches and pushes
> to. A first boot hides this completely: the table is empty, so every strategy is one the process
> just created and still holds the keys it was handed. Only a boot against a populated table reaches
> the unloaded relation, which is exactly what re-initializing with a new master does, and is why this
> presented as the rotation test failing rather than as an encryption bug. Fixed by
> `findAll({ relations: ['keys'] })`. The general shape is worth naming: a service that populates its
> own cache during first boot cannot be tested by booting once, and `reInit` is the cheapest way to
> get the second boot.
>
> **The documentation gap was real and larger than "not mentioned".** The paragraph about
> `ENCRYPTION_MASTER_OPTIONS` had been added under a *hashing* heading, where nobody configuring
> encryption would look. It is a Configuration subsection now, with what the master key actually
> protects - data keys, not rows - because that is what makes the cost of rotating one a handful of
> key rows rather than every encrypted column, and it is the fact that decides whether a remote
> strategy is affordable. Two obligations a remote strategy has are stated with it, since nothing
> checks them: it has to put `options.keyId` in the envelope it returns, and it has to honour
> `options.binding` or D3's row binding silently stops applying to what it writes.
>
> **The jwt half got the rotation window and nothing else, deliberately.** Asymmetric signing, `kid`
> and JWKS are a feature; a secret you cannot replace without logging everybody out is a defect, and
> it is the one that bites. `previousAccessTokenSecrets` and `previousRefreshTokenSecrets` verify but
> never sign, so a rotation costs nobody their session, and a secret is dropped once the tokens it
> signed have expired.
>
> **That turned four DI tokens into one options object**, `JWT_AUTH_OPTIONS`, resolved from
> `JWT_AUTH_OPTIONS_INPUT` over defaults the way the localize options are. Six loose tokens for one
> strategy's configuration was the alternative, and it was the user's call: the two lists only make
> sense next to the secrets they are lists of.
>
> **The distinctness check got stricter as a side effect, and had to.** B1 refused an access secret
> equal to the refresh secret. With pools, a *previous* refresh secret equal to the current access
> secret reopens exactly the hole B1 closed, so the check is now that every secret across all four
> fields is a different value. That also refuses a previous secret repeated as the current one, which
> is a rotation that did not rotate.
>
> **What this does not cover.** Zibri ships no kms strategy and will not - that means depending on
> one vendor's sdk, and the seam is the part a framework can honestly provide. Asymmetric jwt signing,
> the `kid` and a published JWKS have since closed under H, so a verifier no longer has to hold the
> key that signs. ~~And nothing reports how much data is still under an old master, so "the rotation is done"
> is still a judgement rather than a reading - the same gap D2 leaves for data keys.~~ **Closed
> 2026-10-13 with §D2's report**, see there: data keys and recorded backups are counted per old master
> key and master strategy, every backup by the master keys it recorded when it was taken.

### D5. The hash hook is not idempotent — ~~MINOR (live foot-gun)~~ **FIXED**

`src/data-source/hooks/hooks.default.ts:40` runs `hashHashProperties` on every save, create or
update, and `src/global/model-registry/hash-hash-properties.function.ts:41-49` hashes any string
present on a `hash: true` property with no check for whether it is already a `HashString`.

Any read-modify-write flow — a generic `PATCH /credentials/:id` that echoes back the loaded
entity, an admin CRUD screen, a data migration — double-hashes the stored password and permanently
locks the user out.

> **Closed by refusing the write rather than skipping it.** `HashService.isHash` recognises an
> envelope whose strategy is registered, and the hook throws when a hash property is handed one.
>
> **Refusing was chosen over silently skipping, and the difference matters more than it looks.**
> Skipping would make a write that *meant* to change the password quietly not change it - the caller
> gets a success and the old password still works. Refusing also removes the security hole in the
> other direction: with skipping, a plaintext that happened to look like an envelope would be stored
> in the clear, whereas a false positive here is a loud error.
>
> The false-positive risk is reduced anyway by asking the strategy rather than trusting the prefix.
> `isHashedValue` is optional on `HashStrategyInterface`; scrypt implements it by parsing its own
> encoding, so `scrypt.v1.hunter2` is not mistaken for a hash. A strategy that does not implement it
> is taken at its word.
>
> **This does change behaviour for generic CRUD**, which was the argument against it: an admin screen
> that PATCHes a whole entity now gets an error instead of a locked-out user. That is the trade, and
> the docs state it with the fix.
>
> **Refusing immediately found a caller nobody had thought about: `deleteAll` and `deleteById`.**
> Both load the rows and run the *save* hook over them before removing, so every delete was re-hashing
> an already hashed password. It was invisible because the row then disappeared - the corruption was
> real, it just had nowhere to land.
>
> **Two wrong fixes preceded the right one, and both are worth recording.** The first was to stop
> calling `beforeSave` on delete at all. That was wrong: the hook is an extension point, and the
> delete path genuinely needs part of it - `restoreExcludeProperties` turns the non-enumerable getters
> on a loaded entity back into properties the driver can see. Removing the call would have taken a
> seam away to fix a default implementation.
>
> The second was to skip *both* crypto transforms on delete, on the assumption that neither could
> matter to a row about to vanish. Encryption does matter: `deleteAll` loads through a find, so
> `beforeReturn` has already decrypted the row, and the delete result goes through `beforeReturn`
> again on the way out. Re-encrypting is what balances that second pass, and skipping it fed
> plaintext to `decrypt`. Hashing is the one that is never a round trip, because it has no read half
> to undo it - which is the whole asymmetry this finding rests on, and it took a failing 2FA suite to
> see it.
>
> So `beforeSave`'s second parameter went from `setDefault: boolean` to a `SaveOperation` of
> `create | update | delete`. The boolean was already an operation flag wearing a disguise - `true`
> meant create, `false` meant update *or* delete, and conflating those last two is precisely the bug.
> The default hook now restores excluded properties and encrypts on all three, and returns before
> hashing on a delete. A custom hook can finally tell what it is being asked to do, which is the part
> worth keeping regardless of what the default does with it.
>
> **Soft delete is the case worth stating explicitly**, because it looks like a counter-example and
> is not: `SoftDeleteRepository` only calls through to the hard delete when `hardDelete: true`.
> Otherwise it writes `{ deleted: true }` through `updateById`, which arrives as an `update` carrying
> no encrypted or hashed property at all. The row surviving is exactly why that path has to keep
> running the transforms - and it does.

---

## E. Rate limiting and DoS

### E1. Zero rate limiting on the framework's own auth endpoints; no lockout anywhere — ~~CRITICAL~~ **FIXED**

`src/auth/strategies/jwt/jwt-auth.controller.ts` defines `/auth/login`, `/auth/refresh-login`,
`/auth/request-password-reset`, `/auth/verify-password-reset-token`, `/auth/confirm-password-reset`
and `/auth/logout`. Not one carries `@RateLimited`. The only `@RateLimited` in the framework is on
the email service (`src/email/email.service.ts:108`).

There is no failed-attempt counter, no lockout, no exponential backoff and no CAPTCHA hook.

**Attack:** unlimited online password guessing, plus unlimited TOTP guessing (C3), plus unlimited
reset-token guessing against `POST /auth/verify-password-reset-token`
(`jwt-auth.controller.ts:122-151` — an unauthenticated oracle confirming whether a reset token is
valid, unthrottled).

Perverse interaction with D1: because scrypt is slow *and* runs on the event loop, the login
endpoint is simultaneously brute-forceable and a CPU-exhaustion DoS vector. `@Property.string()` on
`JwtCredentialsDto.password` (`src/auth/strategies/jwt/jwt-credentials.model.ts:39-40`) sets no
`maxLength`, so the KDF input size is attacker-controlled up to the body limit.

> **Fixed.** `AuthRateLimiter` guards login and the three password reset routes on both builtin
> controllers: twenty attempts per ten minutes, **per caller**, which E2's new default gives for free.
> One budget across all four, because they are one activity - trying to get in - and a person who
> fumbles a password and then asks for a reset stays well inside it.
>
> **No lockout, deliberately.** A per account counter that refuses the account itself hands anyone a
> way to lock any user out by guessing at them, which is a denial of service wearing a security
> feature's clothes. Counting per caller costs an attacker an address per bucket and costs a
> legitimate user nothing.
>
> **The limit is per instance**, because the default store is in memory: three replicas allow three
> times as much. Said out loud in `docs/auth.md` rather than hidden, with the alternative next to it -
> `AUTH_RATE_LIMITER` takes a limiter built on `RepositoryRateLimiterStore` for a deployment that
> wants an exact limit and will accept a data source round trip on the login path.
>
> Configurable at both levels, which are different questions: `AUTH_RATE_LIMIT_OPTIONS` tunes the
> numbers, `AUTH_RATE_LIMITER` replaces the algorithm and the store.
>
> **What this does not fix:** the CPU cost of a single guess. Ten slow hashes per caller per ten
> minutes is a far smaller lever than an unbounded one, but D1 (scrypt on the event loop) and the
> missing `maxLength` on the password field are still open and still worth closing.
>
> *Re-checked 2026-10-01:* D1 has closed since, for the work factor alone, so the `maxLength` half has
> no owner. `JwtCredentialsDto.password` and the cookie strategy's counterpart are still a bare
> `@Property.string()`, which leaves the input to the key derivation as long as the body limit lets
> it be.
>
> **Closed 2026-10-01.** `PASSWORD_MAX_LENGTH` (1024, exported) is the `maxLength` of the password on
> both login bodies and of `newPassword` on both reset-confirm bodies - the reset shares it, because a
> password set there longer than login accepts would be one its owner can never log in with. 1024
> rather than NIST's floor of 64: SP 800-63B asks a verifier to permit *at least* 64 and forbids
> truncation, so the cap is set far past any passphrase or password-manager output while still
> bounding a derivation to what a normal password costs. A constant rather than a DI token, because
> it is read where the decorators run, and `docs/auth.md` asks an application to put the same cap on
> its own registration field. Held by the login and reset tests of both controller suites: one
> character over answers `400`, the cap itself still reaches the comparison.

### E2. The default rate-limit key is the literal string `'global'` — ~~MAJOR~~ **FIXED**

`src/rate-limiting/limiter/base-rate-limiter.model.ts:28` and `:317`. `keyFn` receives the
**controller method arguments** — body/params/query — not the request, so there is no built-in
per-IP or per-user keying helper. `docs/rate-limiting.md:75-88` shows the canonical example with
no `keyFn` at all, and `docs/rate-limiting.md:2` nonetheless claims limiting is "per key (eg. per
user or IP)".

**Attack:** a developer follows the docs and adds `@RateLimited(LoginRateLimiter)` to their login
route. Every user now shares one bucket, and a single attacker locks out the entire customer base.
The secure configuration is strictly harder to write than the DoS-enabling one.

> **Fixed by turning the default around.** `@RateLimited(L)` with no key now counts per caller - the
> client address over http, the connection over a websocket - so the sentence above describes a
> working per caller limit rather than a lockout. The shared bucket is still available and still
> right for some limits, but it has to be asked for: `keyFn: RateLimitKeys.GLOBAL`.
>
> **The capability was never missing, only the default and the discoverability.** A `keyFn` could
> always read the request through `CURRENT_REQUEST_CONTEXT` - the caching docs do exactly that for
> cache keys. `RateLimitKeys.perConnection` / `perUser` are packaging, and `perUser` is the only one
> worth having as code: resolving the current user means the right strategy list, `required: false`,
> and a fallback for anonymous callers that is easy to leave out.
>
> `keyFn` takes a plain key as well as a function, which is not only ergonomics - a zero argument
> function pins the decorator's argument tuple to `[]` through inference and breaks any `countFn`
> beside it.
>
> `EmailRateLimiter` now says `GLOBAL` explicitly. `maxEmailsPerHour` is what the mail server will
> accept rather than what a caller may ask for, and a mail queued while handling a request would
> otherwise have been counted against whoever triggered it.
>
> Two limiters resolved the key: `BaseRateLimiter.wrap` and `SemaphoreRateLimiter.wrap`, the second
> with its own hardcoded `'global'`. That is one `resolveKey` on the base class now, or the default
> would have been per caller in one limiter and shared in the other.

### E3. In-memory store is unbounded; cleanup is O(keys) every 10 seconds — ~~MAJOR~~ **FIXED**

`src/rate-limiting/stores/in-memory.rate-limiter-store.ts:15` is a plain `Map` with no size cap and
no LRU; entries are evicted only lazily or by the cleanup cron.

`src/rate-limiting/rate-limiting-cleanup.cron-job.ts:15` runs every 10 seconds.
`BaseRateLimiter.cleanup` (`base-rate-limiter.model.ts:497-539`) does `store.keys()` then a
`Promise.all` over every key with a `get` and an `atomicUpdate`, plus
`updateActiveReservationsGauge` (`:553-569`) which re-reads every key again serially.

With `RepositoryRateLimiterStore` this is catastrophic: each `atomicUpdate` takes a distributed
lock (`src/rate-limiting/stores/repository.rate-limiter-store.ts:31-43`) and issues a SELECT plus
an UPDATE. 100k keys ⇒ ~300k queries plus 100k lock round-trips at unbounded concurrency, every 10
seconds, on every instance.

**Attack:** key by IP (the only sensible choice), send traffic from a botnet or with spoofed
`X-Forwarded-For`, and each distinct key permanently allocates an entry. Memory grows without
bound and the cron degenerates into a self-inflicted database DoS.

Note the cleanup job is now explicitly `distributed: false`, because the default store is per
instance and each instance has its own map to expire. That is correct, and it means the cost above
is paid by *every* replica rather than one — which matters only for the shared-store case, where the
work is redundant. A shared store wants one cleaner; an in-memory store needs all of them. The job
cannot currently express both.

> **Fixed.** Two separate problems, and the interesting one is not the one the finding leads with.
>
> **The cost.** `cleanup` no longer walks keys. The store answers two questions instead:
> `deleteExpired(now)` drops everything expired in one operation — against a repository that is a
> single filtered delete rather than N — and `keysWithExpiredReservations(now)` returns only the keys
> actually holding capacity nobody is going to use. On a healthy limiter that list is empty, so a run
> costs two operations regardless of key count, and the updates that are left run through
> `PromiseUtilities.allChunked` rather than an unbounded `Promise.all`, because against a shared
> store each one takes a lock. Finding those keys cheaply needed `nextReservationExpiryMs` mirrored
> into a column of its own on `RateLimitStateEntity`, the same trick `expiresAtMs` already used.
> `updateActiveReservationsGauge` is gone entirely: it re-read every key to recompute a number that
> was already being maintained incrementally, so cleanup now just tells `recordReservationClosed` how
> many it removed. That leaves the cleanup job's `distributed: false` correct *and* cheap, so the
> "cannot express both" complaint no longer needs answering — running it everywhere costs two
> operations per limiter per instance.
>
> **The unbounded map.** `InMemoryRateLimiterStore` takes `maxKeys`, 100 000 by default, and a full
> store **refuses** a key it has never seen rather than growing. Keys it already holds keep counting
> exactly. Refusing rather than evicting was the user's call and is the right one: evicting would
> hand whoever filled the store a way to reset everybody else's counter, so the limit would stay on
> paper and stop applying in fact — the failure the limiter exists to prevent. Refusing costs one
> limited endpoint instead of the process. An expired entry's slot is reused rather than counted, and
> a store that is full only of expired entries sweeps before it refuses.
>
> **What it does not cover.** No eviction policy at all, so a legitimately large key space has to be
> configured up or moved to a shared store — the store says so once, as an error, rather than
> guessing. `maxKeys` is per store rather than a global budget across limiters. And nothing bounds
> the *repository* store, which is the data source's problem rather than this one's, but is
> unaddressed either way.

### E4. The distributed lock is TTL-based with no fencing — ~~MAJOR~~ **FIXED**

`src/rate-limiting/stores/val-key.rate-limiter-lock.ts:11-69` — `LOCK_TTL_MS = 5000`,
`LOCK_RETRY_DELAY_MS = 5`, `MAX_LOCK_ATTEMPTS = 400`. The compare-and-delete release script
prevents deleting someone else's lock but does not prevent the critical section from running past
expiry. If `run()` — which contains a DB `findOne` plus `updateById` — exceeds 5 s (GC pause, pool
wait, Postgres under load), the lock expires, a second instance acquires it, and both execute the
read-modify-write. The update is silently lost. No fencing token, no version check on the write.

Under contention: 400 × 5 ms ≈ 2 s of hot spin, then `InternalError` (`:71-73`) which `wrap()`
rethrows (`base-rate-limiter.model.ts:340-346`) → the request 500s. There is no fail-open or
fail-closed policy. `docs/rate-limiting.md:63-70` presents the lock as the correctness solution and
mentions none of this.

> **Fixed**, but by demoting the lock rather than by fencing it.
>
> A fencing token would have to be minted somewhere and compared against something stored, which ends
> up being a column on the row — at which point the lock is not what is providing the guarantee. So
> the guarantee moved to where it belongs: `RateLimitStateEntity` carries a `version`, and
> `RepositoryRateLimiterStore` writes with `where: { id, version: read }`. `updateById`'s `where`
> already existed for exactly this, applied as part of the write so nothing can act between the check
> and the update. A writer that lost re-reads and runs the updater again, up to three times. The lock
> is now contention avoidance: it keeps the retry rare, and losing it costs a retry rather than an
> update. Its TTL, retry delay and attempt count are untouched — tuning them without measurement
> would be guessing, and correctness no longer depends on them.
>
> The 500 is also gone. Anything that fails inside `measureStoreOperation` becomes
> `RateLimitStoreUnavailableError` — a **503**, because the request was fine and retrying is
> reasonable — and `onStoreFailure` on the limiter decides between refusing (the default) and letting
> the call through. Which one is right depends on whether the limit protects something or only shapes
> traffic, which the framework cannot know; both are counted on the limiter's error metric either
> way. The error deliberately does not set `name`, so the response says `ServiceUnavailableError`
> rather than advertising that a rate limiter is what gave up.
>
> **What it does not cover.** Nothing renews the lock while a slow section holds it, so a section
> that outlives the TTL still produces the contention the version then absorbs — measurably more
> retries, never a lost update. The version is a plain counter with no wraparound handling, which at
> one write per request is a non-problem worth naming anyway. And `InProcessRateLimiterLock` has no
> TTL at all, so none of this applies to a single-instance app.

### E5. The compare-and-set retry has no backoff, so contention becomes a failed request — ~~MAJOR~~ **FIXED**

*Opened while closing [04 §2.7](./04-infrastructure-subsystems.md), not part of the original review.*

`repository.rate-limiter-store.ts:15,45-57` — three attempts, and the retry is immediate. Losing the
compare-and-set means another writer got in between this one's read and its write, which means both
lost at the *same instant* — so retrying at once puts them straight back into the same race.
Exhausting the three throws an `InternalError`, and a rate limiter that throws is a request that
fails.

**This is [04 §2.3](./04-infrastructure-subsystems.md) again in a different subsystem**: a retry loop
with no delay against something that needs one. E4's own note predicted the conditions — "a section
that outlives the TTL still produces the contention the version then absorbs — measurably more
retries" — and the retry count was never revisited against that.

Found by `val-key-data-source.test.ts` failing on the case that deliberately removes the lock and
runs ten concurrent updates, which is the worst the TTL can do. Simulating the loop at 1 ms round
trips, 200 runs each:

| | 10 contenders | 25 | 50 |
|---|---|---|---|
| 3 attempts, no backoff | 7 gave up in the worst run | 22 | 47 |
| 8 attempts, full jitter | **0** | **0** | 1 |

> **Eight attempts, and each retry waits a random point inside a doubling window.** The randomness is
> the load-bearing half, not the count: a fixed delay moves the collision rather than breaking it up,
> because every writer that lost is waiting the same amount. Unlike
> [04 §2.3](./04-infrastructure-subsystems.md), where a lease already decides which replica proceeds
> and jitter would have bought nothing, here every contender is a real racer.
>
> **Giving up eventually is still right** — past a point the contention is the problem and the error
> says so. What was wrong was giving up early enough that ordinary contention reached it.

---

## F. Transport, CORS, cookies, headers

### F1. `Access-Control-Allow-Origin: *` hardcoded and unconfigurable — ~~CRITICAL~~ **FIXED** **[verified]**

See [02-http-runtime-core.md](./02-http-runtime-core.md) §C1 for the full finding.
`ZibriApplicationSecurityOptions` (`src/application-options.model.ts:33-44`) exposes exactly one
field: HSTS.

> **Closed.** `ZibriApplicationSecurityOptions` now carries `cors` beside `headers`, so an api can be
> locked to its own front ends. See §C1 for the detail, including why the default is still `'*'` and
> why credentials with a wildcard is refused rather than allowed.

### F2. Cookie `Secure` is derived from an attacker-supplied header, and defaults off — ~~MAJOR~~ **FIXED**

`src/auth/strategies/cookie/cookie-auth.auth-strategy.ts:552-562`

```ts
const secure = context.request.secure || context.request.headers[KnownHeader.X_FORWARDED_PROTO] === 'https';
context.response.cookie(this.sessionOptions.name, session.id, { ...this.sessionOptions, secure });
```

Express's `trust proxy` is never enabled anywhere in `src/`. Behind any load balancer or ingress
`req.secure` is **false**, so the framework falls back to the raw `X-Forwarded-Proto` header. If
the proxy does not overwrite that header (many do not by default), a client controls it.

Any deployment where the proxy forwards `X-Forwarded-Proto: http` or omits it sets the session and
refresh-session cookies **without `Secure`**. There is no static `secure: true` option —
`CookieAuthSessionOptionsInput` (`:49`) explicitly `Omit`s `secure` from what a developer may
configure.

Defaults are also weak: `sameSite: 'lax'` (`zibri-di-providers.default.ts:124`, `:131`), cookie
names `sessionId` / `refreshSessionId` with no `__Host-` or `__Secure-` prefix.

The same missing `trust proxy` breaks `req.ip` (`src/logging/logger.ts:90` logs the proxy's IP for
every request) and would break any IP-keyed rate limiting.

> **The forwarded header half is closed; the cookie defaults are not.**
> `ZibriApplicationSecurityOptions` carries `trustProxy`, and the application passes it to express
> before any middleware runs, so `req.secure` and `req.ip` mean what they say for as many hops as the
> deployment declares. The three places that read `X-Forwarded-Proto` by hand - both cookie writers
> and the HSTS header - now read `req.secure` only, so none of them can be told what to think by
> whoever sent the request.
>
> Defaulting to `false` is deliberate and stays: a forwarded header is attacker supplied until
> something in front of the application overwrites it, and trusting one by default would hand every
> caller a client address of their choosing.
>
> **Closed by making `secure` configurable.** It is no longer `Omit`ed from
> `CookieAuthSessionOptionsInput`: set it and it is used, leave it and it is derived from `req.secure`
> as above. An api that knows it is https only can now say so, and saying so cannot be undone by a
> `trustProxy` that is wrong or was never set - which was the residual risk, since the derivation is
> only as good as the hop count it was given. Held by `cookie-auth.controller.test.ts`, including a
> login that sends `X-Forwarded-Proto: https` itself and still gets a derived cookie without `Secure`.
>
> **`sameSite` and `__Host-` were considered and deliberately not changed.** `strict` breaks following
> a link into an authenticated page, which is a product decision rather than a framework default. A
> `__Host-` name requires `Secure`, so shipping it as the default would break every deployment on
> `http://localhost` - it works today (`path: '/'` is already the default and no `Domain` is set) and
> the docs recommend it for any api sharing a registrable domain with something it does not control,
> but opting in is the application's call.

### F3. Hand-rolled cookie parser: last-wins duplicates and an unauthenticated 500 — ~~MAJOR~~ **FIXED**

`src/http/cookie.middleware.ts:8-23` replaces `cookie-parser` (stated at `:52-53`).

**(a) Duplicate-cookie shadowing.** `Object.fromEntries` keeps the **last** occurrence;
`cookie-parser` keeps the first. Combined with the absence of `__Host-` prefixes (F2), an attacker
who can set a cookie for the parent domain — a compromised sibling subdomain, XSS anywhere under
`*.example.com` — can inject a second `sessionId` that shadows the victim's. Because the
attacker's cookie is a legitimately signed value from their own session, the HMAC check passes:
session fixation / login-CSRF, with the victim silently operating inside the attacker's account.

**(b) Unauthenticated log-flooding DoS.** `decodeURIComponent` is called on raw attacker input with
no try/catch. `Cookie: a=%` throws `URIError`, express forwards it to `errorHandler`
(`src/error-handling/error-handler.ts:25`), which classifies it as non-external and calls
`logger.error` (`:108-110`). Default transports include `LoggerTransport.db(LogLevel.INFO)`
(`zibri-di-providers.default.ts:65-70`), so every malformed cookie writes a row to the application
database, with a two-week retention. A single unauthenticated client fills the logs table at
request rate.

> **Closed, both halves.** `parseCookieHeader` builds into a `Map` and keeps the **first** occurrence
> of a name, and every percent-decode is attempted rather than assumed: an input that is not valid
> encoding is used as it stands, which is what `cookie-parser` does too. Neither is a judgement call -
> the previous behavior was not a different reading of the spec, it was `Object.fromEntries` and a
> bare `decodeURIComponent` doing what they do.
>
> **The duplicate half is the one worth stating precisely.** The attacker's shadowing cookie is
> signed by their own real login, so the HMAC check passes and *cannot* be what rejects it. Ordering
> is the only thing that separates the two cookies, which makes "first wins" a security property
> rather than a parsing preference. It is also a weak one, and the docs now say so: it depends on the
> browser emitting most-specific-first, and the real fix is a `__Host-` name the parent domain cannot
> set at all. That is available today - `path: '/'` is already the default and no `Domain` is ever
> set, so `name: '__Host-sessionId'` works over https - but it is not the default, which is the part
> of F2 still open.
>
> **Two things came out of writing the tests.** The parser split on `'; '`, so `a=1;b=2` - legal, and
> what some clients send - parsed as a single cookie named `a` with the value `1;b=2`. And a cookie
> named `__proto__` was safe only by accident: `Object.fromEntries` defines own properties, so the
> obvious rewrite into an object built by assignment would have introduced prototype pollution where
> there was none. The `Map` is there for that reason.
>
> **Still open:** the log-flooding shape is only closed at this instance. Nothing rate limits the db
> log transport, so any other unauthenticated input that reaches a non-external error still writes a
> row per request - the cookie parser was one route to that, not the mechanism.

### F4. CSRF is partial, non-constant-time, and never rotates — ~~MAJOR~~ **FIXED**

CSRF validation lives entirely inside `CookieAuthStrategy.isCsrfTokenValid`
(`cookie-auth.auth-strategy.ts:470-484`) and only runs when an auth-decorated route resolves a
session. There is no global CSRF middleware, so any state-changing route that is not
`@Auth`-decorated (see A1) has no CSRF defence at all.

The token is compared with `===` (`:483`) rather than `timingSafeEqual` — inconsistent with the
framework's own cookie unsigning, which does use `timingSafeEqual` (`cookie.middleware.ts:41`).

Most importantly it is deliberately preserved across rotation (`:283-289`), so one CSRF token is
valid for the entire 100-day session-family lifetime and is returned in the login response body
(`:192`). It is never regenerated on privilege change or re-authentication.

> **Rotation and constant-time comparison are closed; the missing global middleware is not.**
> `rotateSessions` mints a fresh token, the retired one stops being accepted, and the comparison is
> `timingSafeEqual` over bytes with the length checked first - matching what the framework's own
> cookie signature check already did.
>
> **Rotating turned out to need a delivery channel, not just a new token.** Rotation happens in two
> places, and only one of them has a response body to put a token in: `refreshLogin` returns it, but a
> session also renews itself *inside an ordinary request* when the session cookie expires, and that
> response belongs to whatever route the client happened to be calling. Rotating without solving that
> would have replaced a token that lived too long with one the client could not learn - a silent 401
> on the next unsafe request. Both paths now reissue on the `x-csrf-token` response header.
>
> **Which exposed a second gap in the CORS work.** `corsMiddleware` set `Access-Control-Allow-Headers`
> but never `Access-Control-Expose-Headers`, so a browser hid every response header the framework
> answered with. Being allowed to *send* the csrf token is not being allowed to *read one back* - the
> header channel would have worked same-origin and silently failed cross-origin, which is the
> deployment shape configurable CORS exists for. The framework's own headers are now exposed on the
> same principle they are allowed on.
>
> **Still open: there is no global CSRF middleware.** The check runs inside the cookie strategy, so it
> covers a route exactly when that route resolves a session. A1 narrowed this a lot - under
> `defaultAuth: 'requireLogin'` every undecorated route resolves one - but under `'public'`, and for
> anything carrying `@Auth.skip()`, nothing checks. That is defensible where it is true (a route the
> session did not authorize is not a route csrf protects) and wrong where an application reads the
> cookie itself. The docs state the boundary rather than implying coverage.
>
> Also unchanged: the token is still returned in the login response body, which is how a
> header-submitted token has to reach a client in the first place.

> **The global half closed (2026-10-02) as a fetch metadata guard, not a global token check.** A
> token check on every route would cost a session read per unsafe request and refuse a public form
> posted by a logged in client that had no reason to send the token; and the token only ever answered
> "did a page of ours send this", which the browser now says directly. `crossOriginCookieMiddleware`
> runs on every route, last in the security phase: a request with an unsafe method that carries a
> `Cookie` header and comes from another origin is refused 403 unless `cors` lists that origin with
> `credentials: true`, and recorded as `authz.check` / `cross-origin`.
>
> "Another origin" is `Sec-Fetch-Site` other than `same-origin` or `none`, and **`same-site` counts**:
> lax cookies reach the api from a sibling subdomain, which is where `SameSite` stops protecting, and
> a sibling can be user content. Without fetch metadata it falls back to `Origin` against the address
> the request was sent to; with neither header it is not a page, and is let through - every browser
> that matters sends one or the other on an unsafe request. Any cookie qualifies rather than the
> session cookie alone, since the case the finding names is an application reading a cookie of its
> own; a cross-origin write without cookies carries no ambient authority and is untouched.
>
> **`cors` is the allowlist on purpose**: `credentials` already is the declaration of which origins may
> send cookies, so a second list would be a second place to say it that could disagree. `'*'` admits
> nobody, because it cannot be combined with credentials - under it no foreign origin was ever meant to
> send them.
>
> **No per-route exemption** was added: nothing in the framework receives a cross-site cookie-carrying
> post on purpose. A SAML POST binding or a payment provider posting back would, and is the case that
> would reopen this - with lax cookies neither carries one today. Held by
> `src/http/cross-origin-cookie.middleware.test.ts` (refused cross-site, same-site and by origin alone;
> let through for an allowed origin, its own origin, no cookies, a non-browser caller, and a read)
> and by a case in `auth-and-security.evaluation.test.ts` on an `@Auth.skip()` post route, with the
> audit event.

---

## G. Auditability and error handling

### G1. Failed logins and authorization denials are never logged — ~~MAJOR~~ **FIXED**

`src/error-handling/error-handler.ts:103-111` — `UnauthorizedError` extends `HttpError` extends
`ExternalError`, so `isExternalError` is true and nothing is logged. Same for
`TooManyRequestsError` and `NotFoundError`.

There is no separate security or audit log anywhere in `src/auth/**` — no successful-login event,
no failed-login event, no authorization-denial event, no 2FA-failure event, no
password-reset-requested event, and no refresh-token-reuse-detected event (the one place reuse is
detected, `jwt.auth-strategy.ts:228-231`, deletes the family and throws without a single log line).

Unusable for SIEM integration. Brute-force detection is impossible because the events do not
exist. This alone fails most SOC 2 CC7 / ISO 27001 A.12.4 assessments.

> **Closed.** `LoggerInterface` gained a sixth method, `audit`, and the auth subsystem calls it:
> login, refresh, logout, both password reset endpoints, second factor validation, and every
> authorization denial. Each event carries a closed-set `action` and `outcome`, the account where one
> is knowable, and a closed-set `reason` where the attempt failed. It rides the existing transports
> at `info`/`warn` with the event under `context.metadata.audit`, so it is queryable without a second
> logging subsystem and lands wherever the deployment already sends logs.
>
> **The alternative was a dedicated `AuditLog` entity, and it was declined.** It would have meant a
> second entity, service, cleanup cron, transport set and DI token family to say the same things -
> and an application that had already pointed its logging somewhere would have had to point auditing
> there separately. `audit` being a method on the logger makes replacing the sink the same act as
> replacing the logger.
>
> **Emitted from `AuthService`, not from the strategies.** The wrappers there were pass-throughs, so
> every event is recorded once, for every strategy including custom ones, without an author having to
> remember to. Two things it genuinely cannot know from there, and both are handled explicitly rather
> than papered over: `subject` is read off an `email` field on the credentials and is simply absent
> for a strategy that identifies users otherwise, and reuse of a spent refresh credential is only
> visible inside the strategy that detects it.
>
> **Reuse detection needed an error class rather than a second log call.** Logging it at the
> detection site *and* at the wrapper would have counted one attempt twice, which is worse than
> useless for a rule that counts. So `CredentialReusedError` extends `UnauthorizedError` without
> touching `name` - the response is byte for byte the ordinary 401, and only the trail can tell.
> Writing it forced the cookie strategy's two paths to "already used" apart: genuine reuse and a
> client with two requests in flight ended at the same throw, and recording a retry as a stolen
> credential would have been an alert generator rather than a fix.
>
> **The `refused` / `error` split is the part that was not in the finding.** A user store that is down
> refuses every login exactly like a wrong password, and a trail that records both the same way reads
> an outage as a credential stuffing run. `auditReasonFor` maps anything that is not a 4xx to `error`,
> and unwraps the `AggregateError` from `Promise.any` so that a second factor counts as refused only
> if every configured method refused it. `has2fa`'s bare `catch { return false; }` - the swallow that
> made the M8 cluster failure present as a 401 - now records what it caught before returning.
>
> `logout` was the same shape and is now recorded too: it swallowed every error and answered as if it
> had worked, so a logout that revoked nothing was a live credential somebody believed was dead. The
> response is unchanged on purpose; the record is the fix.
>
> **The password reset event had to move, and that is the one worth reading twice.** It started in
> `AuthService.requestPasswordReset`, which turned out to be reachable *only when the address belongs
> to somebody* - the controllers resolve the user first and skip the call otherwise. So the trail
> recorded every reset that went out and nothing at all for the requests worth watching: the ones
> naming addresses nobody holds. B4 makes those answer identically, so they leave no other trace
> anywhere. It now lives in the two auth controllers, after the commit, and records
> `failure` / `no-such-subject` when the address does not resolve. The strategy cannot host it - it is
> handed a resolved user, so by the time it runs the interesting requests are already gone.
>
> **Still open:** no event for an allowed request, which is an access log and a different problem
> (see 04). Audit entries share
> `LOGGER_CLEANUP_AFTER_MS` retention with their level, so keeping them
> longer than ordinary logs means routing them elsewhere - the docs say so rather than the framework
> pretending otherwise. And nothing rate limits the trail itself, so an endpoint under attack writes
> a row per attempt.
>
> **The `refused` / `error` split was unreachable for the case it was written for, which its first
> test found.** `UserService` asks every `@UserRepo` at once and caught *every* rejection as "not
> found", so a user store that was down never reached `auditReasonFor` as anything but a 404. The
> strategies were right - both rethrow what is not an `HttpError` - and never saw one. It now tells a
> repository that does not hold the user (an http error below 500) from one that could not be asked,
> and throws the second when nobody found anything. One store being down still does not lock out the
> users of another. The predicate is `ErrorUtilities.isRefusal`, shared with `auditReasonFor`, so the
> two cannot disagree about what a refusal is. Held by `user-service.store-outage.test.ts`.

### G2. Authorization errors leak the authorization model — MINOR, **FIXED**

> **Half of it had already closed on its own, and the half that had not was asserting it was fixed.**
>
> The `belongsTo` branch that named the internal entity class is gone rather than answered: ownership
> is declared as a `scope` on the entity and enforced by the repository, so no authorization check has
> an entity class left to name. The "to to" typo went with it.
>
> The role message is now `You do not have permission to access this route.` The roles were the whole
> authorization model handed to the one caller who had just proved they hold none of them — walk the
> routes with any account at all and you have a map of which role guards which endpoint.
>
> **The refresh token half was the interesting one.** `jwt.auth-strategy.ts` already carried a comment
> saying *"the same 401 and the same message as any other refused refresh - the difference is carried
> by the class, which is what the audit trail reads and the caller never sees"*. The class part was
> true; the message part was not, and had never been. Four states still answered with four
> distinguishable strings, one of which — "has already been used" — tells whoever is holding a stolen
> token that the theft worked. All four are `Invalid refresh token.` now, with `CredentialReusedError`
> and `AuditReason.TOKEN_REUSED` still separating them where it matters.
>
> **Nothing was lost, because the seam already existed.** `AuditReason` has `MISSING_ROLE`,
> `TOKEN_REUSED` and `REFUSED`, each recorded with the account that was refused, and its own doc
> comment says why it is a closed set rather than a message. The distinctions moved from the response
> body to the place that was built to hold them.
>
> The two password reset messages — `Link invalid` and `Link expired` — were left as they are. A reset
> link reaches the person it was mailed to, and an attacker would have to hold a real token before the
> distinction told them anything.

`ExternalError` messages are returned verbatim (`error-handler.ts:41-46`).
`src/auth/auth.service.ts:260` returns
`"You need to have one role of ${allowedRoles} to access this route."` and `:283-286` returns
`"You need to to have access to the ${targetEntity.name} entity with the id ${targetId}..."` —
disclosing the exact roles guarding each endpoint and internal entity class names to an
unauthenticated caller. (The "to to" typo is also user-visible.)

Refresh-token failures are likewise distinguishable by message —
`"Error verifying token: Invalid Token"` vs `"The given refresh token has already been used."` vs
`"The given refresh token is expired."` (`jwt.auth-strategy.ts:218, 230, 234`) — telling an
attacker holding a stolen token exactly which state it is in.

Internal errors *are* correctly masked (`src/error-handling/error.utilities.ts:17-22`), so this is
bounded — the auth subsystem specifically opted into verbose external messages.

---

## H. Enterprise identity: what does not exist

Verified by `grep -rniEl "oidc|openid|saml|ldap|jwks|mtls" src --include="*.ts"` — the sole hit is
`document/pdf.utilities.ts` (unrelated).

Written first as one table of capabilities, which kept the whole section partly closed for as long as
any row was open. Split into findings on 2026-10-04 (the user's call), so that each can be worked on
and closed on its own. Multi-tenant identity, a row of that table, was folded into the multi-tenancy
entry of [01's MINOR list](./01-data-layer.md), which already tracked tenancy.

`AuthStrategyInterface` (`src/auth/strategies/auth-strategy.interface.ts`) is extensible, so these
are *implementable* — but its shape is `login(credentials)` / `refreshLogin` /
`requestPasswordReset` / `confirmPasswordReset`, i.e. a local-password model. A redirect-based SSO
flow does not fit: there is no callback/state/nonce plumbing, and `AuthControllerInterface`
(`src/auth/auth-controller.interface.ts`) assumes POST-with-credentials. An enterprise adopting
Zibri writes its entire identity layer from scratch, against an interface that was not designed
for it. That is H2's to change, and H3 builds on it; the others fit the interfaces as they stand or
sit beside them.

### H1. Access tokens can only be signed with a shared secret — **FIXED**

Every verifier of an access token had to hold the secret that signs it, which let it mint tokens too,
and there was no `kid` and no published key set.

> **Asymmetric access tokens closed (2026-09-27)**, held by `jwt-auth.asymmetric.test.ts`, which runs
> without a container. `accessTokenKey` (renamed from `accessTokenSecret`, as is
> `previousAccessTokenKeys`) takes a string, which stays HS256, or `{ algorithm, key }`. The token
> carries the key's RFC 7638 thumbprint as `kid`, and `JwksController` publishes the public keys at
> `/.well-known/jwks.json`, current key first.
>
> **The allowlist is per key, not per token.** A token is checked only against keys whose `kid` is the
> one in its header, and each check allows exactly that key's algorithm. So a secret never meets a
> token that names a key pair, and hmac computed over a published public key fails even when it names
> the real `kid`. The test for that names the `kid` on purpose, so it is the key pair's check that
> refuses it rather than there being no candidate key at all.
>
> **Decided with the user:**
> - *Access tokens only.* A refresh token is verified only by its issuer and is stored hashed, so a
>   key pair buys it nothing, and `refreshTokenSecret` keeps its name because a secret is all it holds.
> - *ES256/384/512 plus RS256.* RS256 is kept for interop, since it is the one algorithm OIDC requires
>   of every verifier. PS\* and RS384/512 were dropped: nobody needs them for interop and they add no
>   strength. The user's first question was whether EC is post-quantum safe. It is not, and nothing
>   JOSE widely supports is: ML-DSA exists only as an IETF draft for JOSE, and verifiers cannot read
>   it yet. For short-lived signed tokens that is less pressing than for encryption, because there is
>   no "harvest now" attack on a signature. And a `kid` plus previous keys is exactly what makes the
>   eventual migration a rotation.
> - *EdDSA is absent* because `jsonwebtoken` has no EdDSA, and changing the library was not worth
>   one algorithm. It is H12 now, open, rather than counted as decided against (the user, 2026-10-04).
>
> **Found by the first run, both in my own code:** `createPublicKey` refuses a `KeyObject` that is
> already public, so a previous key configured as its public half (the whole point of it) failed to
> boot. And the RSA case depended on another suite having seeded its user.
>
> **What the strategy checks at boot:** the signing key is private, every key fits its algorithm
> (type, curve, RSA of at least 2048 bits), and all keys are distinct by thumbprint. So a key
> configured once as its private half and once as its public half is still one key. `JwksController`
> refuses to start when there is no key pair to publish.

### H2. No sign-in through an OpenID Connect / OAuth2 provider — **FIXED**

No authorization code flow with PKCE, so a user cannot sign in with the company's identity provider,
and no consumption of that provider's JWKS to verify the tokens it issues (publishing our own is H1).
This is where the interfaces change: a redirect, a callback, and the state and nonce that tie the two
together, none of which `login(credentials)` and a POST-with-credentials controller have room for.

> **Narrowed (the user, 2026-10-05):** H2 is signing in through an OpenID Connect provider. Accepting
> the tokens such a provider issues as bearer credentials on our api is H14, a provider that speaks
> plain OAuth2 without OpenID Connect is H15, adding a provider to an account that is already
> logged in is H16, and a provider answering with a form post, such as Apple, is H17.
>
> **Design (with the user, 2026-10-05):**
>
> - **Signing in at a provider is a login with a different proof**, the reasoning H13 used for
>   re-authentication. The provider is not a strategy: the flow ends in the existing jwt or cookie
>   session, so refresh, logout, revocation, `auth_time` and `require2fa` keep working unchanged.
> - **Strategies become sessions, and authenticators prove who someone is.** A strategy keeps
>   `hasCredential`, `resolveUser`, `resolveClaimedUser`, `resolveAuthenticatedAt`, `refreshLogin` and
>   `logout`, and gains `startLogin(authentication)` and `endLogins(userId)`. Everything about the
>   password moves into a `PasswordAuthenticator`: checking it, the timing stand-in, re-hashing, and the
>   reset with its email. OIDC is a second authenticator, and H4's LDAP and H10's passkeys fit the
>   same interface. Without the split, an app that only signs in through a provider had to configure a
>   password reset email it would never send.
> - **Type inference is kept by naming both halves where they meet** (the user's condition):
>   `AuthService.login(authenticator, strategy, credentials)` takes the credentials type from the
>   authenticator and the auth data type from the strategy, with the user type tying the two. A
>   controller is that meeting point. Type tests hold it.
> - **A password reset ends the user's logins in every registered strategy,** not only in the one whose
>   controller was used, since ending a login is the session's job. `PasswordCredentials` replaces
>   `JwtCredentials` and `CookieAuthCredentials`, which held the same thing.
> - **A first sign-in is the application's business** (the user's call): no framework option decides
>   whether an unknown identity is refused, created or matched by email. The framework's callback
>   redirects an identity no user is linked to to a required `registrationUrl`, with a one-time
>   registration ticket. The application's own controller reads the verified claims from the ticket
>   without spending it, creates the user and links the identity, using framework tools for each step,
>   and then logs in with the ticket as the credential, which the OIDC authenticator spends. Links are
>   stored as issuer and `sub`, and a later sign-in never matches by email.
> - **Every login goes through `AuthService.login` and an authenticator** (the user, 2026-10-05). A
>   public `startLogin(strategy, user)` was drafted for the registration step and dropped: it would let
>   any code start a login for any user with nothing proven, and every way in turned out to be a
>   credential an authenticator can check - a password, the provider's callback, the one-time code of
>   the jwt handover, a registration ticket. One entry point also keeps the audit trail, the rate limit
>   and the login time in one place. `startLogin` stays on the strategy interface, as what
>   `AuthService.login` hands the authentication to.
> - **`jose` replaces `jsonwebtoken`, and `openid-client` does the protocol.** `openid-client` is
>   OpenID Certified. The reason not to change JWT libraries for one algorithm (H12) no longer holds
>   once there is a second reason, and `jose` brings EdDSA with it. Both are ESM only, which the
>   supported Node versions load from CommonJS. `openid-client`'s requests go through `HttpClient`.
> - **What protects the round trip:**
>   - `state`, `nonce` and the PKCE verifier live in a single-use login attempt row with a short
>     lifetime, stored hashed, and tied to the browser by an httpOnly cookie whose hash the row holds.
>     Without that tie, an attacker could send a victim the callback of the attacker's own sign-in and
>     log the victim into the attacker's account.
>   - PKCE always, and a callback url per provider, which keeps one provider's response from being
>     passed off as another's.
>   - The ID token's signature against the provider's key set, its algorithm from an allowlist,
>     `iss`, `aud`, `azp`, `exp`, `iat` and `nonce`.
>   - `redirectTo` only from a required allowlist, or the authorize route is an open redirect.
> - **Handing the login to the frontend after the redirect:**
>   - Cookie strategy: the callback sets the cookies and redirects. The csrf token comes from a new
>     `GET /auth/csrf-token`, which also covers a page reload, after which an SPA had no way to get
>     its token back: `refresh-login` itself asks for it.
>   - Jwt strategy: tokens never travel in a url. The callback redirects with a one-time code that is
>     exchanged by POST, and the login only starts then. The client's own PKCE on that code is
>     required; without it, an attacker could finish their own sign-in and send a victim the redirect,
>     whose SPA would then log into the attacker's account.
> - **The login time is the provider's `auth_time`,** which always sending `max_age` makes the provider
>   include. A provider that silently reuses its own session has not produced a fresh login, so H13's
>   window must not count it as one. A re-authentication sends `prompt=login`.
> - **Out of H2:** logging out at the provider (by redirect or by its back-channel call), keeping the
>   provider's tokens to call its apis, counting the provider's MFA (`amr`) as the second factor, a
>   multi-tenant issuer such as Entra's `common`, and H14–H16.
>
> **Order:** `jose` and EdDSA first (closing H12), then the split, then `GET /auth/csrf-token`, then the
> OIDC flow with an in-process fake provider, then a Keycloak container test, the docs and the upgrade
> guide.
>
> **Progress (2026-10-05):** `jose` and EdDSA are in (H12), and so is `GET /auth/csrf-token`. The split
> is built: `AuthenticatorInterface` and `PasswordAuthenticator`, an `authenticators` application
> option defaulting to the password, `startLogin` and `endLogins` on both strategies, and
> `AuthService.login(authenticator, strategy, credentials, transaction)` with type tests in
> `auth.service.test.ts`. Decided on the way, with the user: `UserRepositoryInterface` loses
> `resolveCredentialsFor`, since `PasswordAuthenticator` reads `PasswordCredentials` by user id itself;
> `PasswordCredentials` holds no copy of the email, which drifted when a user changed theirs; the reset
> routes stay on both controllers. `password.authenticator.test.ts` holds a reset through the jwt
> controller ending a cookie login of the same user.
>
> **The 2.x passwords (2026-10-05).** No data source operation could move rows from one entity to
> another, and copying them through repositories fails on the hash hook, which refuses a value that is
> hashed already. Two migration helpers on `DataSourceInterface`, on every store, decided with the
> user:
> - `renameEntity` moves what is stored under a table name to the one the entity declares, and refuses
>   a target that holds entities.
> - `mergeEntity` moves the rows next to the ones stored. A row breaking the entity's id or one of its
>   declared uniques is left out, so the table merged first wins. It is a separate helper rather than
>   a mode of the rename, so a mistyped table name fails instead of pouring rows into the wrong entity.
>
> Many to many relations move with both, at either end. A first draft refused them, and the user
> rejected that as missing functionality:
> - Postgres renames the join tables and their columns, which the orm names after both tables. The
>   names before come from building the metadata again with the entity under its old table name, not
>   from repeating the orm's naming rules. A merge copies the join rows of the moved rows, points the
>   foreign keys of the other tables at the entity's table, and moves a numeric id sequence past the
>   moved ids.
> - ValKey and in memory keep one set per side, named after the property, so a merge also adds the
>   moved ids to the other side's sets under the name that side uses now.
>
> The upgrade guide merges `jwt_credentials`, then `cookie_auth_credentials`, into `PasswordCredentials`.
> The guide's step runs in `password.authenticator.test.ts` against a store seeded the 2.x way. The
> helpers have shared cases in `migration-helpers.cases.ts`, plus a two-version boot in
> `moved-entities.cases.ts`.
>
> **Two valkey defects this found, both fixed:**
> - `updateStoredRows`, under every property migration helper, read the id set from the server, so it
>   skipped the rows the same migration had created or moved there. Case: "converts the entities the
>   migration created itself".
> - A `ValKeyTransaction` key deleted and then written again read as the old fields merged with the
>   new. The commit deletes the key first, so the stored fields are gone. Case: "reads a row it deleted
>   and created again as it created it" in `val-key-data-source.test.ts`.
>
> Both cases need valkey, so they were written after the fix and not seen red here. The second one
> failed on its first container run, but for its own reason: `create` drops an id it is handed unless
> `allowId` is set, so the row it read back by the old id did not exist. It now sets `allowId`.
>
> The same run found the postgres merge failing on every uuid id. It reset the table's sequence in
> one statement that skipped tables without one, but postgres plans `max(id)` either way, and a uuid
> has no max. The sequence is now looked up first. The numeric-id branch that resets it is not run by
> any case, because no entity in the repository declares a numeric primary key.
>
> **The OIDC flow (2026-10-08), closing H2.** Built, with an in-process fake provider and a Keycloak
> container test, which passed on its first run. Decided with the user on the way:
> - **One authenticator per provider.** `BaseOidcAuthenticator` is abstract: an application extends
>   it with `name`, `issuer`, `clientId` and `clientAuthentication`. Google, Microsoft Entra ID (single
>   tenant) and Keycloak ship as abstract subclasses that fix the issuer. What every provider shares
>   is one required `OIDC_OPTIONS` token: allowed redirects, registration url, error url and the
>   `max_age`. The callback url comes from the application's `baseUrl`; a `publicUrl` option was
>   drafted and dropped, because `baseUrl` already says it.
> - **The PKCE verifier and the nonce are worked out from the cookie**, by HMAC of its secret. The
>   design said "stored hashed", which cannot work for the verifier: it goes to the token endpoint in
>   the clear. Now the attempt row holds only hashes (of `state` and of the cookie secret), so a
>   database read finishes no sign-in. One cookie per attempt, named after its id, so two tabs signing
>   in at once do not overwrite each other.
> - **The registration ticket is bound like the login was started**: the cookie for a cookie login,
>   the frontend's PKCE verifier for a jwt one. So a ticket copied out of a url is useless elsewhere.
> - **Every failure redirects to a required `errorUrl`** with an `OidcSignInFailure`. A fault (not a
>   refusal) is thrown on as a 500 instead, so an outage does not read as a failed sign-in.
> - **A registration commits, then logs in.** Logging in inside the registration's transaction would
>   need the user lookup to take a transaction, and user repositories can sit in different data
>   sources. The user chose the order over a transaction-aware user lookup. `authenticate` takes the
>   login's transaction regardless, so spending a code or a ticket rolls back with a failed login.
> - **Accepted signing algorithms** are checked on the ID token's header after openid-client has
>   verified it: the client metadata that would narrow them takes a single algorithm.
>
> Built for it, and usable on their own: `Response.redirect` and `RedirectResponse`;
> `HttpClient.fetchForLibrary`, so openid-client's requests use the application's dispatcher,
> deadline and size limit (named so it reads as being for libraries, at the user's request); and
> `TestBrowser` and `startFakeOidcProvider` in zibri-testing.
>
> **A harness defect this found, fixed:** `resolveApplicationOptions` in zibri-testing dropped
> `authenticators`, so every test server ran with the password authenticator whatever it was given.
> Not seen red on its own, but every OIDC case fails without the fix.
>
> `base-oidc.authenticator.test.ts` holds 22 cases on the in-memory data source:
> - both handovers;
> - the browser binding;
> - single use;
> - a declined sign-in;
> - a wrong audience, a wrong nonce and a stale `auth_time`;
> - the redirect allowlist;
> - the registration;
> - no matching by email;
> - the startup checks.
>
> `base-keycloak.authenticator.test.ts` signs in against a real Keycloak, through its login page,
> for what only a real provider shows:
> - the extra `iss` and `session_state` on its callback;
> - enforced PKCE;
> - its claim names;
> - `prompt=login`;
> - `auth_time` across a reused provider session;
> - `private_key_jwt`, which the fake provider does not check.
>
> For it, `TestBrowser` keeps cookies per origin, so a provider's own login session works. No upgrade
> guide entry: OIDC is new, and an authenticator ignoring the new `transaction` parameter compiles and
> behaves as before.
>
> Apple's form post is H17, fixed since.

### H3. No SAML 2.0 service provider — **FIXED**

The other protocol enterprise identity providers speak, still the only one some of them do. A
redirect-based flow like H2's, so it builds on the callback plumbing H2 adds, with signed xml
assertions in place of tokens.

> **Design (with the user, 2026-10-09):**
> - **A neutral base, and the shared names say so.** What every protocol shares (the login attempt
>   bound to the browser, linking, the registration ticket, the handover and connection codes) moved
>   into `BaseFederatedAuthenticator`; `BaseOAuthAuthenticator` extends it and keeps openid-client,
>   PKCE and the provider's tokens. The shared `OAuth*` names became `Federated*`, the routes
>   `/auth/federated/:provider/...` and the token `FEDERATION_OPTIONS`: the old names were no longer
>   exact once a second protocol used them, and 3.0 is unreleased.
> - **`@node-saml/node-saml` checks the answers**, an optional peer. The user asked whether zibri's own
>   xml parser changes that: it does not, a signature is checked over the canonicalized xml (exclusive
>   c14n, xml-dsig), which a parser does not do. The parser reads the identity provider's metadata.
>   `zibri-testing` takes `xml-crypto` and `xml-encryption` to sign and encrypt as a provider does.
> - **A sign-in the identity provider starts on its own is refused.** A portal tile points at the
>   authorize route, or a frontend page that starts the sign-in.
> - **Scope:** the metadata url, encrypted assertions, signed requests, single logout.
> - **A sign-in at the provider older than `maxAuthenticationAgeInMs` starts again with `ForceAuthn`**
>   rather than being refused, since SAML has no `max_age` to ask for. The provider ignoring
>   `ForceAuthn` a second time is `invalid`.
> - **The NameID is persistent by default**, configurable to an email or unspecified; a transient one
>   is refused, since it links a new identity on every sign-in.
> - **Single logout is precise**: a login keeps the session at the provider (NameID and SessionIndex),
>   and a logout request from the provider ends exactly the logins of that session, or every login of
>   the user when it names none. A logout here answers where to log out at the provider.
>
> **Mine:**
> - **The answer has to name this browser's request, with nothing stored.** The request id is
>   derived from the attempt's binding cookie, and node-saml's request cache is one per answer that
>   knows only that id, with `validateInResponseTo: always`. An unsolicited answer, or the answer to
>   another browser's request posted with this browser's relay state, is refused.
> - **Either the response or the assertion is signed, and the signature covers the assertion**
>   (node-saml with both `want*Signed` off). The issuer, the NameID and the AuthnInstant are checked
>   here, after node-saml.
> - **The metadata is read once a day, one read at a time**, and the last good one is used while the
>   provider is unreachable. Its `entityID` has to be the configured `issuer`, so a metadata url of
>   another provider fails the sign-in with a `500` rather than trusting its certificates.
> - **No separate SAML controller.** Only one controller per base route is allowed with
>   `versions: 'all'`, so the metadata and logout routes live in both federated controllers, behind
>   the protocol hooks `resolveMetadata`, `createLogoutUrl` and `readProviderLogout`.
> - **A login keeps its provider session as keys, not as the NameID.** Both strategies' refresh rows
>   carry `federatedProvider`, a key of the user at the provider, a key of the session, and what a
>   logout request names, and copy them on rotation. `AuthStrategyInterface.logout` answers the
>   session and gains `endFederatedLogins`. A logout request's verification failing is a `401`, not a
>   sign-in failure, since it is not a sign-in.
> - **`signedOutUrl` is required for a SAML authenticator at boot**: the round trip of a logout here
>   lands on it.
>
> **Breaking, for the user to know:** the `OAuth*` → `Federated*` names and routes; the logout routes
>   of both strategies answer `200` with a `LogoutResult` instead of `204`; `AuthStrategyInterface`
>   gains `endFederatedLogins` and `logout` answers the session; four nullable columns on
>   `CookieAuthRefreshSession` and `JwtRefreshToken`, three on the handover code and registration
>   ticket.
>
> **Found on the way, and fixed:**
> - **node-saml takes a logout request without a signature.** `hasValidSignatureForRedirect` answers
>   true when there is no `Signature` parameter, so anybody could send a user a link that ends the
>   logins of whoever it names. Zibri requires `Signature` and `SigAlg` on a logout request before
>   node-saml sees it; red when the check is removed. An answer to a logout from here is taken
>   unsigned, since all it does is land the browser on the application's own page.
> - **The service provider metadata named no certificates** unless node-saml was handed the private
>   keys as well, which it takes as the sign that a key is in use. They are not written into the
>   document.
> - **Two controllers on one base route failed the boot**, and the suite's `beforeAll` failing left the
>   fake identity providers listening; `afterAll` stops each on its own.
> - **The H11 todo was still in the evaluation suite** after H11 closed; it points at its test now.
>
> **Tests.** `base-saml.authenticator.test.ts` (30 cases, cookie and jwt, in memory): a linked user, a
> first sign-in through the registration, an answer posted twice, another browser's answer with this
> browser's state, an unsolicited answer, another audience or issuer, expired, unsigned, signed by
> another key, without an AuthnStatement, changed after signing, a transient NameID, a refusal by the
> provider, a sign-in too old restarted and landing, `reauthenticate`, signed requests with encrypted
> assertions, a post from another origin, the published metadata, metadata about another provider,
> and single logout: the provider ending exactly one session, every session when it names none,
> after a refresh, refused unsigned or signed by another key, and a logout here round tripping
> through the provider for both strategies, signed for a provider that asks. Broken on purpose and
> seen red: `InResponseTo`, the issuer check, the transient check, the signature required on a logout
> request, the session in the match (red for both strategies), and the copy on rotation for each
> strategy. The cookie strategy's showed only once a logout here was tested after a refresh, since a
> logout from the provider finds the family through the spent row as well. `zibri-testing` gained
> `startFakeSamlProvider`, with single logout. The Keycloak container suite gained a SAML client:
> a sign-in verified against Keycloak's own metadata and signatures, the registration, and a logout
> round trip; it needs a container runtime and has not run yet.
>
> **Not built:** the SOAP and artifact bindings; a logout request posted rather than redirected; a
> sign-in the identity provider starts (refused, above).

### H4. No LDAP / Active Directory bind — **FIXED**

No way to check a password against a directory instead of the user table. A bind takes a name and a
password, so this fits `login(credentials)` as it stands and does not wait for H2.

> **Design (with the user, 2026-10-09):**
> - **Search, then bind.** A service account the application is given binds and searches for the
>   entry the typed name belongs to; a second bind as that entry checks the password. It works on
>   every directory, whatever the tree looks like, and reads the entry's attributes on the way.
> - **A first sign-in goes through a hook on the authenticator.** An entry that no user is linked to
>   yet is handed to the application's `resolveFirstSignIn(entry, transaction)`, which creates a user,
>   finds one, or refuses; the link is then stored. One login request, since a directory's people are
>   vetted already, rather than H2's registration ticket.
> - **TLS always**: `ldaps://`, or `ldap://` with StartTLS, and a CA for a company's own. A plain
>   connection is refused at boot, since a bind sends the password in the clear.
> - **Tested against real directories in containers, from official sources only**: the 389 Directory
>   Server project's own image, and Samba's Active Directory domain controller built from Debian's
>   package, since neither OpenLDAP nor Samba publishes an official image. An in-process fake
>   directory in `zibri-testing` covers everything else.
>
> **Mine:**
> - **`ldapts`**, an optional peer; `ldapjs` was archived by its maintainers. The fake directory
>   reuses its BER codec and messages, and matches filters itself.
> - **An entry is linked by the directory's own id** (`entryUUID` by default, `nsUniqueId` on 389
>   Directory Server, `objectGUID` in `BaseActiveDirectoryAuthenticator`), never by its DN or email,
>   which change when someone moves or marries. The links are a new entity, `LdapIdentity`.
> - **An empty password is refused before the directory sees it**: a bind with a name and no password
>   is an unauthenticated bind, which a directory answers with success.
> - **The search filter is built from filter objects, not text**, so `ann*` is the name `ann*` and
>   never a wildcard.
> - **`ldap://` always means StartTLS**, so there is no setting for a connection in the clear at all.
>   Its TLS options go to the upgrade, since the client takes TLS options on the client itself as
>   TLS from the first byte.
> - **A wrong password, an unknown name and a locked account answer the same 401**, and an unknown
>   name binds all the same, so it takes as long. A directory that cannot be reached or trusted, or a
>   service account that cannot bind, is a 500 audited as an error, not a refused sign-in.
> - **Two first sign-ins as one entry wait for each other** through a lease, so the hook makes one
>   user. A linked entry whose user was deleted is refused rather than handed to the hook again.
> - **The audit trail records the typed name** as the login's `subject`, which until now only knew
>   an `email`.
>
> **Found on the way, and fixed:**
> - **Directories refuse a locked account with three different codes**: Active Directory with
>   `invalidCredentials`, 389 Directory Server an inactivated account with `unwillingToPerform`, and a
>   lockout after too many tries with `constraintViolation`. Taking only the first as a refusal would
>   have answered the other two with a 500, as an outage. Red first, against the fake directory
>   answering each way.
>
> **Breaking, in `zibri-testing`:** `createFakeSamlKeyPair` and `FakeSamlKeyPair` are now
> `createFakeKeyPair` and `FakeKeyPair`, which also make a TLS server's certificate.
>
> **Tests.** `base-ldap.authenticator.test.ts` (19 cases, in memory, against `startFakeLdapDirectory`):
> a linked entry found by the service account and bound, any username attribute, the first sign-in
> hook and the user it answers found from then on, two first sign-ins at once, StartTLS, a wrong
> password, an unknown name and a locked account alike, the bind for an unknown name, an empty
> password, a name read as a filter, a name two entries have, outside the search base, a hook
> refusing, a deleted user, an untrusted directory and a wrong service account as 500s, the typed
> name audited, and the startup checks. `base-active-directory.authenticator.test.ts` (2 cases):
> account name and user principal name as one user, an `objectGUID` written as Active Directory shows
> it, from bytes that are text and bytes that are not. Broken on purpose and seen red: the empty
> password guard, the filter built from text, StartTLS skipped, the lease, the audited username, and
> each locked-account code. Two container suites, `base-ldap.authenticator.heavy.test.ts` against 389
> Directory Server and `base-active-directory.authenticator.heavy.test.ts` against a Samba domain
> controller, check a real directory's TLS, ids, StartTLS and refusals; they need a container
> runtime. `*.heavy.test.ts` now belongs to `test:heavy`. Both confirmed green by the user on
> 2026-10-10, after three rounds on the containers: 389 Directory Server wanted an authority beside
> its certificate rather than one self-signed certificate as both, and Debian's `samba-ad-dc` only
> recommends the package holding the schema, `samba-ad-provision`.
>
> **Second round (with the user, 2026-10-10): what the first left out.**
> - **Groups and roles, through a hook on every later sign-in.** `resolveSignIn(entry, user,
>   transaction)` is required next to `resolveFirstSignIn`, and answers the user the sign-in logs in
>   as, so the application keeps roles (or anything else) in step with the directory: someone taken
>   out of a group loses its role at their next sign-in. The framework finds the groups: the required
>   `groupSearchBase` (`undefined` reads none) and `groupFilter`/`memberAttribute` give
>   `entry.groups`, nested groups included, one search per level of nesting with a loop of groups
>   ending it. Active Directory finds them in one search with its in-chain matching rule. Groups are
>   read as the service account and only after the password is checked, so a wrong password takes
>   no longer for a known name than before. A declarative group→role map was the other option; the
>   hook lets the application update anything and keeps user writes out of the framework.
> - **Several servers: `url` became `urls`**, breaking. A sign-in starts at a random one, to spread
>   the load, and moves on while one cannot be reached; an answer of the directory, such as a refused
>   service account, comes from a server that was reached and moves on to none. A refused password
>   never asks another server.
> - **`DOMAIN\name`: a required `netbiosName`** on `BaseActiveDirectoryAuthenticator`. The prefix of
>   this domain is taken off and the rest looked up as `sAMAccountName`; another domain's prefix is
>   refused like an unknown name, since in a forest with trusts `OTHER\anna` is somebody else. Reading
>   the name from the directory's configuration partition was the other option.
> - **Found on the way, in `zibri-testing`:** two fake directories had certificates of one name, and a
>   client trusting both checked one against the other's and refused it. Each now has a name of its
>   own. The fake directory also answers Active Directory's in-chain rule.
> - **Tests**: `base-ldap.authenticator.test.ts` is at 29 cases (the hook of a later sign-in, groups
>   nested and in a loop with roles following a membership change, groups read as the service account
>   after the password, none without a base, failover, the random start, a refused password asking no
>   other server, no server reachable, and two more startup checks); the Active Directory one at 4
>   (`DOMAIN\name` of this domain and of another, groups by the in-chain rule). Broken on purpose and
>   seen red: the random start, failover, nesting, the prefix check, and the hook on a later sign-in.
>   Both container suites gained a nested-groups case, the Samba one a `DOMAIN\name` case; they have
>   not run yet.
>
> **Not built:** ending the sessions of someone disabled in the directory, which is H7. A session
> already open keeps the roles it started with until then.

### H5. No identity for machines: API keys, service accounts — **FIXED**

Every caller is a user with a password. A service calling another, a script, an integration all have
to be given a user account and log in as one, with nothing that names them as a machine, scopes what
they may do, or lets one key be revoked without the others.

> **Fixed (2026-10-10), with the user.** Decided together:
>
> - **OAuth2 `client_credentials` moved to [H8](#h8-no-oauth2-token-endpoints-client_credentials-introspection-and-revocation--open).**
>   It makes zibri an authorization server (a form encoded token endpoint with its own error format),
>   the same family as introspection and revocation, so the three are designed together. Machines
>   get everything they need from keys meanwhile.
> - **A machine is a user of the application.** A service account is a user row the application
>   creates without a password. Roles, `@CurrentUser`, row scopes and the audit trail work unchanged,
>   and the same keys give people personal keys. A separate principal type would have had to be
>   handled by every place that types the caller as a user.
> - **A key is limited to a subset of roles**, not to scopes: permissions are deferred (A2), and a
>   second vocabulary next to roles would need an answer for what a normal login's scopes are. A
>   request holds the key's roles that the user has *now*, so taking a role from the user takes it
>   from the keys.
> - **The key travels in `x-api-key`** (`ZIBRI_DI_TOKENS.API_KEY_HEADER`, CORS and OpenAPI follow
>   it), not as a prefixed bearer token, which would have tied the jwt strategy to this one.
> - **Ending the logins of a user keeps their keys.** A forgotten password must not break every
>   integration. Creating a key is audited, and the docs guard the create route with
>   `@Auth.require2fa({ reauth: true })` like adding a passkey.
>
> Mine:
>
> - **`AuthStrategyInterface` split** (breaking for strategies written against it). It is now the
>   request side (`hasCredential`, `resolveUser`, `resolveClaimedUser?`, `resolveAuthenticatedAt`,
>   `securityScheme`, `name`); `LoginAuthStrategyInterface` extends it with `startLogin`, `logout`,
>   `refreshLogin`, `endLogins` and `endFederatedLogins`. The evaluation's own api key fixture
>   (`auth-sessions-and-2fa.evaluation.test.ts`) had to implement those by throwing, with a comment
>   saying a stub would suggest a login flow that does not exist; that was the cause, so it was fixed
>   rather than copied. `AuthService.login`, `refreshLogin` and `logout` take a login strategy, and
>   `endLogins` / `endFederatedLogins` skip strategies without logins. `AuthStrategies` lost its three
>   `any`s with it.
> - **The narrowed roles are on the user itself**, not beside it: the handler's `@CurrentUser` holds
>   them too, so a check written in a handler cannot be wider than the key.
> - **Kept as a sha256 hash, findable** (like refresh tokens): 256 random bits need no slow hash, and
>   the key arrives alone. `value` is `exclude`d, so a listed key never carries even the hash.
> - **`expiresAt` is required on creation** (`undefined` = until revoked), a role the user lacks or an
>   expiry in the past is a `400`, and revoking another user's key is a `404`. Management goes through
>   `AuthService` (`createApiKey`, `findApiKeys`, `revokeApiKey`, `revokeApiKeys`), which finds the
>   registered `ApiKeyAuthStrategy` and refuses when there is none. Audit actions
>   `auth.api-key.created` and `auth.api-key.revoked`.
>
> Tested in memory over http in `api-key.auth-strategy.test.ts` (15 cases), each of these mutations
> seen red: the role narrowing removed, the expiry check removed, revoking without the user's id.
> Docs: new page `docs/api-keys.md`, `auth.md` (strategy kinds, exports, audit rows).
>
> **Not built:** a last-used time per key (a write per request), and cleaning up expired keys (they
> stay listed until revoked). The key prefix (`zibri_`) came with H7, which sends keys as bearer
> tokens.

### H6. No client certificate (mTLS) authentication — **FIXED**

No caller can be identified by a client certificate. TLS ends at the deployment rather than in the
process ([02 §M11](./02-http-runtime-core.md)), so this would read a certificate the proxy forwards,
and has to trust only a proxy that is configured to send one.

> **Fixed (2026-10-10), with the user.** `BaseClientCertificateAuthStrategy`, a request side strategy
> (no logins, like api keys) an application extends once per proxy. Decided together:
>
> - **The application maps a certificate to a user** through `resolveUserByCertificate`, rather than
>   users registering certificates like api keys. An internal PKI or a service mesh names the caller
>   in the certificate, and a renewal with the same name needs nothing; pinning by fingerprint is a
>   lookup in that same hook. The request holds the roles of the user it answers.
> - **The strategy names its proxies** (`trustedProxies`, addresses and CIDR subnets, required,
>   checked with node's `BlockList`), against the address of the connection itself, never `req.ip`.
>   `security.trustProxy` was not reused: a hop count there says how many headers to believe, not who
>   connected, and a certificate is public, so whoever connects is all that makes the header true.
> - **The application checks issuer and validity too** (`certificateAuthorities`, required): the
>   issuing authority by name and by signature, and `notBefore`/`notAfter`. A proxy set to accept any
>   certificate (nginx `optional_no_ca`) still proves the client holds the key, but a self signed
>   certificate could then claim any name. Revocation stays with the proxy, where CRLs and OCSP are
>   configured.
>
> Mine:
>
> - **Four header formats**, a required `headerFormat`: `rfc9440` (`:base64 DER:`), `url-encoded-pem`
>   (nginx `$ssl_client_escaped_cert`, AWS ALB), `xfcc` (Envoy and Istio; the certificate of the last
>   element, which the nearest proxy wrote, parsed past quoted commas and semicolons) and `traefik`.
>   An empty header, or an `xfcc` whose last element carries no certificate, is no credential, so it
>   does not turn a bearer request into a refused two credential request. A header from an address
>   that is not a trusted proxy is ignored rather than refused, for the same reason.
> - **Websocket messages never have a certificate**: their headers are written by the client into the
>   message and never pass the proxy.
> - **openapi3-ts's `oas31` types leave out `mutualTLS`**, which OpenAPI 3.1 has. Fixed in zibri's own
>   model (`OpenApiSecuritySchemeType`, and `OpenApiDefinition`/`OpenApiComponentsObject` carrying it)
>   rather than cast, since every consumer of the document type is zibri's.
> - `createFakeKeyPair` (zibri-testing) takes `notBefore`/`notAfter`.
>
> Tested in memory over http in `base-client-certificate.auth-strategy.test.ts` (15 cases: the user
> found, another or no authority, before and after validity, a user not found, a header that is no
> certificate, an empty header beside a bearer token, a certificate beside a bearer token, a route for
> other strategies, the OpenAPI scheme, five boot refusals, and an untrusted address ignored), the
> formats in `client-certificate-header.utilities.test.ts` (9). Broken on purpose and seen red: the
> signature check, the validity check, the proxy check, and the quote handling of `xfcc`. Behind a
> real nginx (`url-encoded-pem`) and a real Envoy (`xfcc`, with the subject after the certificate
> holding a comma), the same cases from `client-certificate-proxy.cases.ts`: a certificate through the
> handshake, a header the client sent dropped by the proxy, a self signed certificate the proxy took
> without checking refused by the application. In `base-client-certificate.auth-strategy.nginx.test.ts`
> and `.envoy.test.ts`; not run yet. Docs: new page `docs/client-certificates.md`, `auth.md`,
> `deployment.md`.
>
> **Not built:** a check of the extended key usage (the proxy's TLS library checks it during the
> handshake). A service mesh that forwards the calling
> sidecar's certificate on every request, beside an end user's bearer token, gets the two credential
> `401`; such an application registers no client certificate strategy for those routes' callers, or
> sets Envoy to forward nothing there.

### H7. No provisioning or deprovisioning (SCIM) — **FIXED**

Users exist when they register and stop existing when they are deleted here. An identity provider
cannot create them ahead of time or, more importantly, remove the access of someone who left.

> **Fixed (2026-10-11), with the user.** SCIM 2.0 (RFC 7643/7644) for users and groups. Decided
> together:
>
> - **A controller the application lists**, `ScimController(provisioner, { roles })`, extended like
>   `CrudController`: SCIM's paths, filters, patch semantics and error format are fixed by the RFC,
>   and the H19 rule concerns login routes. The application's part is `BaseScimProvisioner` and its
>   four hooks (`resolveProvisionedUser`, `resolveUpdatedUser`, `resolveGroupMembership`,
>   `resolveDeletedUser`); the protocol is `ScimService` behind `ZIBRI_DI_TOKENS.SCIM_SERVICE`.
> - **The identity provider calls with an api key sent as a bearer token** (H5), of a service account
>   holding one of `roles`; the routes accept `ApiKeyAuthStrategy` alone. Keys now start with
>   `zibri_`, the api key strategy takes `Authorization: Bearer zibri_…`, and the jwt strategy claims
>   only a bearer token shaped like a jwt (three segments), so neither knows of the other. H5's "key
>   prefix" is built with it.
> - **Users and groups**: groups are how roles get provisioned, `resolveGroupMembership` gets a user
>   and every group they are in whenever that changes (member added or removed, group renamed or
>   deleted).
> - **A framework-known deactivated state**, after the user asked why deleting is not enough
>   (providers send `active: false` and delete weeks later or never; a reactivated person keeps their
>   account and data; the provider keeps reading the resource). Stored as `deactivatedAt` on the user
>   (`BaseUserEntity` declares it), written through a new required
>   `UserRepositoryInterface.updateDeactivatedAt` — the user chose the column over a framework entity.
>   `AuthService.deactivateUser` ends every login and revokes the api keys (for good: reactivating
>   does not bring a key back); `AuthService.login` refuses a deactivated user with
>   `AccountDeactivatedError` (403, audit reason `deactivated`), after every authenticator, and the
>   request side drops one. A deployment trusting claims keeps a deactivated user's access token until
>   it expires, as with every account change there. Audit `auth.user.deactivated` / `reactivated`.
> - **General http features** (the user's call, including that a json body takes every `+json` type
>   unless it names one): `MimeType.JSON_SCIM`; `JsonMimeType`; a json body's `type` is any json type,
>   `MimeType.JSON` reading all of them and a named one only itself (the parser normalizes `+json`
>   like the xml types); a json response may list json types in `mimeTypes`, negotiated by `Accept`;
>   `CustomBodyHttpError`, answered with its own body (SCIM errors use it).
>
> Mine: filters are answered by the data source, not in memory — `eq` on `id`, `userName` (kept
> lower case in `userNameKey`, unique), `externalId`, `active`, and for groups `displayName` and
> `members[value eq]`, joined by `and`/`or` and multiplied out into a `Where` array (at most 100
> alternatives); anything else is `invalidFilter`, which RFC 7644 allows. A patch engine applies
> add/remove/replace with value paths (`emails[type eq "work"].value`, adding the item a filter
> describes), the Entra ID forms (`Add`, `"False"`, removing members by a value list) and extension
> attributes. Lists answer at most 200, with `attributes`/`excludedAttributes`. A delete deactivates
> first, then hands the user to the hook. Each change runs in one transaction, a unique violation
> becomes `409 uniqueness`. Audit `scim.user.*`, `scim.group.*`.
>
> Found on the way, fixed: `UserService.updateDeactivatedAt` found the user's repository with a read
> outside the transaction, so deactivating a user created in the same transaction answered 404 — now
> every repository is asked to write inside it (red first: provisioning a user inactive). The json
> body parser, error handler and response suites now boot in memory.
>
> Tested in memory over http in `scim-controller.model.test.ts` (16), `scim-filter.utilities.test.ts`
> and `scim-patch.utilities.test.ts` (14), `auth.service.deactivation.test.ts` (5), json bodies (3
> new), json responses (3), the error with its own body (1), the bearer api key (1). Broken on purpose
> and seen red: the request-side and login deactivation checks, the `+json` normalization, skipping
> deactivation on `active: false`, not reapplying groups to removed members, the quote handling.
>
> **The rest of the protocol, built on the user's request (2026-10-11).** Decided together: filters
> beyond `eq` with `not` over every operator, which needed `notLike`/`notILike` in the data layer
> for every data source (the user's choice over refusing that combination); nested groups count for
> roles all the way up, as the LDAP authenticators do; a resource whose user the application deleted
> counts as gone — removed as it is found, so the provider provisions anew; bulk limits are
> options with defaults (1000, 1MB); a route answers with headers of its own through a new general
> `JsonResponse` result (the user's choice over a declaration on `@Response` or injecting the
> response). Mine: `ScimWhereUtilities` turns the filter into `Where` branches, pushing `not` down by
> De Morgan and combining `and` with the existing `ScopeWhereUtilities.applyToWhere`; `members`
> compares with `eq` only, since `ne` on a list means "has another member". ETags are a `version`
> column declared `optimisticLocking`, so every write is a compare-and-set (`If-Match` mismatch 412,
> concurrent change 409); `If-None-Match` gets its 304 from express by the ETag the route sets.
> Members are users or groups (`memberType`); a group whose members change, however, gets a new
> version. Bulk applies operations in order, defers one that refers to a `bulkId` created later,
> and answers a circle with 409 per operation. `/Schemas` follows RFC 7643 8.7.1 without `groups`,
> which user resources do not return; `meta.location` is the app's `baseUrl` plus the controller's
> path.
>
> **Found on the way, fixed red first:** the evaluator (in memory, ValKey) read a backslash in a
> `like` pattern literally where postgres reads it as an escape, so one filter answered differently
> per data source and no data source could match a literal `%` portably; it follows postgres now,
> documented. Not a bug: zibri never seemed to answer 304, but that was the test client — fetch adds
> `Cache-Control: no-cache` to a request carrying `If-None-Match`.
>
> Tested in memory: SCIM end to end 25 (9 new), filter/patch 14, `JsonResponse` 2, `notLike` and the
> escape in the shared filter cases (now also run in memory). Broken on purpose and seen red: the
> wildcard escaping, the `If-Match` check, following parent groups, removing orphans, the version
> bump of a group losing a member, `notLike` matching a missing value.
>
> **The three left out above, built on the user's question (2026-10-11)** — they had been left out
> without asking, which they were not to be. Decided together: filters and sorts on any attribute go
> through a search table SCIM keeps (`ScimUserValue`, one row per value: attribute, path, position
> in a multi-valued attribute, value in lower case, whether a sort reads it), the user's choice over
> filtering inside stored objects in the data layer or a fixed list of extra columns. Mine: a part
> of the filter no column answers is found ahead of the rest (`findIndexedFilters`) and joins the
> `Where` branches as `id oneOf`/`notOneOf`, so `not`, `and`, `or` work unchanged; a value path is
> evaluated per value (`{user}#{position}`), so `emails[type eq "work" and value co "x"]` holds for one
> email, and `not` inside it is taken against every value of the attribute; `ne` is the negation of
> `eq`, as for the columns, so a user without the attribute matches it. A sort by a value reads the
> rows marked for it (the primary value, else the first) and pages across those without one, last
> ascending and first descending as a column's nulls are. `groups` on a user is read from the
> memberships (`direct`/`indirect`), ignored on writes, in `/Schemas`, and filterable by
> `groups.value`/`groups.display` (a filter on groups, then the users under them). Bulk breaks a
> circle at the first operation creating what another of it refers to: created without the items
> and attributes referring to the circle, replaced with its whole data once the rest is applied
> (RFC 7644 3.7.1: MUST try); a circle without such an operation still answers 409.
>
> **Found on the way, fixed red first:** `sortBy=id&sortOrder=descending` sorted ascending — the tie
> breaking `id: 'ASC'` overwrote the sort's own direction.
>
> Answered `invalidFilter` on purpose: `meta.version`, `meta.location`, `meta.resourceType` and
> `groups.type`/`groups.$ref` — none is kept as a value and no identity provider filters by them. A
> sort by a value with a filter reads the ids of every user the filter finds, as a code comment says.
> Tested in memory: SCIM end to end 28 (3 new, 2 changed). Broken on purpose and seen red: the
> correlation inside a value path, the primary value for a sort, breaking the circle. Ending the
> sessions of someone disabled in a directory (H4) is still not built: a directory has no push.

### H8. No OAuth2 token endpoints: `client_credentials`, introspection and revocation — **FIXED**

No RFC 7662 endpoint a resource server can ask whether a token is still active, and no RFC 7009
endpoint a client can hand a token back to. Revocation exists inside the application (sessions can
be ended), but nothing outside it can use or trigger it.

No OAuth2 `client_credentials` grant (RFC 6749 §4.4) either, through which a service exchanges a
client id and secret for a short-lived access token. Moved here from H5 (2026-10-10, with the user):
all three make zibri an OAuth2 authorization server, and are designed together. Machines call the
api with [api keys](#h5-no-identity-for-machines-api-keys-service-accounts--fixed) meanwhile.

> **Design (with the user, 2026-10-11):**
> - **A client is an api key.** `client_id` is the key's id, `client_secret` the key itself, so every
>   key works at once with no second entity, list or revoke route. Revoking the key ends the client.
> - **When issued access tokens stop working is a DI setting**, defaulting to when they expire (today's
>   behaviour). Set to at once, an access token names the login or client it belongs to, and both
>   introspection and the application's own checks refuse it once that ended: a logout, ended logins,
>   a revoked key or a revoked token. It covers every jwt access token, logins included.
> - **Introspection takes a required `roles` option**, as `ScimController` does: a resource server is a
>   service account calling with its client credentials or a key, holding one of them.
> - **Clients authenticate with a secret (basic and post), `private_key_jwt` and mTLS.** A key for
>   `private_key_jwt` holds a public key (PEM or JWK) or a JWKS url, and no secret, so it works only at
>   the token endpoint. mTLS covers both RFC 8705 methods: `tls_client_auth`, where the application's
>   client certificate strategy maps the certificate to the user who must own the key, and
>   `self_signed_tls_client_auth`, where the key holds the certificate's thumbprint. Tokens issued
>   over mTLS are bound to the certificate (`cnf`).
> - **Tokens carry `aud`.** A client asks for another service with RFC 8707's `resource`; a required
>   option lists the services tokens may be issued for, and the application itself is always one.
>   The application refuses a token issued for another service.
> - **`iss` is the application's `baseUrl`, on access and refresh tokens alike**, in place of its
>   `name`: RFC 8414 wants the issuer to be an https url and RFC 9068 wants access tokens to carry
>   it. The user chose refresh tokens too, for consistency; tokens issued before the upgrade are
>   refused once, so everyone logs in again a single time.
>
> Decided by me, open to the user:
> - **The routes come from a factory the application extends**, as SCIM's do: the token endpoint,
>   introspection, revocation and RFC 8414 metadata at `/.well-known/oauth-authorization-server`.
>   They are a protocol other systems call, like SCIM, which the user ruled outside H19.
> - **The token is a jwt signed with the jwt strategy's access token key**, so the JWKS route lets a
>   resource server verify it and the jwt strategy accepts it here. No refresh token for
>   `client_credentials` (RFC 6749 §4.4.3). `scope` is roles, as H5 decided: a request may ask for
>   fewer, and the answer names those granted.
> - **Holding a token is enough to revoke it**, since revoking only takes access away. A client that
>   authenticates may revoke only its own tokens (RFC 7009 §2.1). Introspection answers for api keys
>   as well.
> - **A bound token sent with its certificate is one credential**, not two: the certificate is the
>   proof the token asks for, and the one-credential rule would otherwise refuse every bound token.
>
> **Fixed (2026-10-12), as designed.** `AuthorizationServerController({ introspectionRoles, resources })`
> defines `POST /token` (rate limited), `/introspect` and `/revoke` (rate limited), answered by
> `AuthorizationServerService` behind `ZIBRI_DI_TOKENS.AUTHORIZATION_SERVER_SERVICE`, which also
> registers the RFC 8414 metadata. Errors are `OAuth2Error`, a `CustomBodyHttpError`, which gained
> `headers` for `WWW-Authenticate: Basic` on `invalid_client` and `Cache-Control: no-store`.
> `ZIBRI_DI_TOKENS.ACCESS_TOKEN_REVOCATION` (`'onExpiry'` default, `'immediately'`) needs
> `REVALIDATE_USER_ON_AUTH_CHECK` and refuses to boot without it.
>
> Settled on the way, mine, open to the user:
> - **`ClientAccessTokenAuthStrategy`, a strategy of its own for client tokens.** Taken by the jwt
>   strategy, a client token passed `@Auth.isLoggedIn([JwtAuthStrategy])`, the documented way to keep
>   a route to people. Which strategy claims a bearer jwt is read from its unverified payload
>   (`client_id` or not), the same presence rule every strategy uses. It narrows the user's roles to
>   the token's, as the api key strategy does, and checks `cnf` against the forwarded certificate.
> - **What revoking an access token does.** A login's access token carries its refresh family as
>   `sid`; revoking it ends that login, which is what "live" means for it in immediate mode. A
>   client's token carries a `jti` and is kept in `JwtRevokedAccessToken` until it expires, cleaned by
>   a cron job the service registers, and the entity is required only with an authorization server in
>   immediate mode. In `'onExpiry'` revoking an access token answers `unsupported_token_type`
>   (RFC 7009 §2.2.1) rather than a `200` that did nothing.
> - **A client jwt lives at most an hour and is spent once**, by a retained lease on its `jti`, so a
>   captured one cannot be replayed on any replica. Its `aud` may be the issuer, the token url or the
>   url of the route it is sent to.
> - **A JWKS url has to be https or loopback**, checked when the key is created; fetched through the
>   http client and cached per url. `UrlUtilities.isLoopback`/`isPrivate` replace two copies of a
>   loopback host set (SAML, OAuth).
> - `typ` is pinned: access tokens are `at+jwt` (RFC 9068), refresh tokens `JWT`, so neither verifies
>   as the other even before the key difference.
>
> Not built, with the reason:
> - **`client_secret_jwt`**: an hmac assertion is signed with the secret, and a key is stored only as
>   its hash, so there is nothing to verify it with.
> - **Introspecting or revoking a cookie session**: a session is not a token handed to another
>   service; it is ended by a logout.
> - ~~**DPoP (RFC 9449)**: sender-constrained tokens without mTLS. Not in the design; asked about.~~
>   Built, see below.
>
> Found on the way, fixed: the form body parser read a single value for an array property as a
> string, so one `resource` failed validation (red first: "reads a list field sent once as a list of
> one item").
>
> Tested in memory over http in `authorization-server-controller.model.test.ts` (33): boot refusals,
> metadata, every client authentication method (a JWKS served on 127.0.0.1, a self-signed and an
> authority-issued certificate), scope and role demotion, `resource`/`aud`, introspection of each
> token kind and its roles, revocation of each kind and ownership, both revocation modes, and a
> resource server verifying a token by the published keys. `jwt-auth.controller.test.ts` (containers)
> gained a foreign audience and the issuer/audience check; `jwt-auth.asymmetric.test.ts` forges with
> the new claims. Broken on purpose and seen red: the replay check, the `cnf` binding, the `aud` check,
> `isAccessTokenLive`, role narrowing, the strategy split.
>
> **Reworked (2026-10-12): no concrete strategy is depended on.** The user found the authorization
> server, `ClientAccessTokenAuthStrategy`, `AuthService` and SCIM reaching for `JwtAuthStrategy`,
> `ApiKeyAuthStrategy` and `BaseClientCertificateAuthStrategy` by class. Decided by the user:
> storage and signing become services, request-reading becomes capabilities.
> - `ApiKeyService` (`API_KEY_SERVICE`) keeps the keys; `AuthService`, the strategy and the
>   authorization server go through it. Whatever reads keys calls `registerReader` at boot, which
>   checks `ApiKey` is declared; creating a key nothing reads is still refused.
> - `JwtService` (`JWT_SERVICE`) holds the access token key, signs and verifies; the jwt strategy keeps
>   only its refresh secret, and `JwksController` reads the service.
> - Capabilities with type guards, resolved through `AuthService.resolveStrategies`:
>   `TokenIntrospectingAuthStrategyInterface` (each strategy introspects and revokes its own tokens),
>   `ClientAccessTokenIssuingAuthStrategyInterface` (extends it; the server requires exactly one, checked
>   in `afterAppInit`), `ClientCertificateAuthStrategyInterface`. The authorization server no longer
>   needs `JwtAuthStrategy` or `ApiKeyAuthStrategy`; its three "refuses to start" cases now pin the new
>   needs (no issuer, two issuers, no `ApiKey`), and one starts with `ClientAccessTokenAuthStrategy` alone.
> - The revoked-token denylist moved to `ClientAccessTokenAuthStrategy`; every revocation at `/revoke`
>   is recorded as `auth.token.revoked`.
>
> Found on the way, fixed red first: a route's strategy list (`@Auth.hasRole(roles, [ApiKeyAuthStrategy])`)
> answered 500 when the application registered a subclass instead (`inject` of an unregistered class),
> and SCIM's boot check refused the subclass; `AuthService.strategyFor` now matches registered
> strategies extending a listed class ("starts with a strategy extending ApiKeyAuthStrategy, and
> provisions through its keys").
>
> **DPoP (RFC 9449), built (2026-10-12).** Decided by the user: client tokens and logins; nonces one
> DI setting `DPOP_NONCES`; a login option `requireDpop`; both later set to default `false` by the user;
> an api key's `requireDpop` is a required create field, and a secret key requiring it is never taken
> in the header. `DpopService` (`DPOP_SERVICE`) checks a proof once per request: typ, embedded public
> key, `htm`, `htu` below `baseUrl`, `iat` within five minutes, `ath`, a stateless nonce signed with the
> access token key (`typ` `dpop-nonce+jwt`), and the `jti` spent by a retained lease. Bound tokens carry
> `cnf.jkt`, travel with the `DPoP` scheme, and a downgrade either way is refused; refresh tokens keep
> the key on their row and refuse before being spent. Errors are 400 at routes issuing tokens and 401
> with a `DPoP` challenge at resources; CORS allows `DPoP` and exposes `DPoP-Nonce`. `FakeDpopKey` in
> zibri-testing signs proofs.
>
> Tested in memory: `jwt-auth.dpop.test.ts` (10: defaults, binding, replay, url/method/`ath`/age,
> refresh, bearer logins, required logins, nonces at login and resource) and the authorization server
> suite (38: bound client tokens, introspection, a key requiring DPoP, a nonce at `/token`). Broken on
> purpose and seen red: the replay check, the bearer downgrade.
>
> **Advertised urls follow the declared controller (2026-10-12).** An authorization server with an
> issuing strategy of the application's own, related to no framework strategy, now has a test (opaque
> tokens through `/token`, a route, `/introspect`, `/revoke`). Found while checking which documented
> paths a standard fixes, fixed red first: the metadata's `jwks_uri` was hardcoded to
> `/.well-known/jwks.json` and given only for `JwksController` itself, so a class extending it at
> another path was left out of the metadata; and a federated authenticator built `/auth/federated/{name}/…`
> itself, so a controller extending `JwtFederatedController` at another path sent providers to routes
> that did not exist. Both now read the declared controller's base route (`ControllerUtilities.resolveUrl`,
> subclass-aware guards `isJwksControllerClass` and `isFederatedControllerClass` over the new
> `BaseFederatedController`), and a provider without a federated controller refuses to start. Only
> `/.well-known/oauth-authorization-server` is fixed by a standard (RFC 8414); for a `baseUrl` with a
> path, its §3.1 location on the host root is documented as forwarded by the proxy.
>
> **Routes of the application's own (2026-10-12).** Refusing to start without a federated controller
> made the framework's controllers mandatory, where they are meant as a shortcut; and everything
> federated was typed to `BaseFederatedAuthenticator`, another shortcut. Now the routes, `AuthService` and
> the name check depend on `FederatedAuthenticatorInterface` (duck-typed `isFederatedAuthenticator`),
> which carries `routes` and `resolveRouteUrl`. The base class resolves from the declared controller,
> and an application overrides it or implements the interface itself. While the application starts,
> `AuthService.onAppStart` checks every url an authenticator gives out: below the `baseUrl`, and
> matched by a registered route (`RouterInterface.findMethods`, matching with `path-to-regexp`, which
> express 5's router is built on). On start rather than init, since a route registered on the
> router directly can arrive after init. Tests, red first: a sign-in through hand-written routes, a
> sign-in through the federated routes with an authenticator that only implements the interface,
> and refusals naming the url that reaches no route or is not below the `baseUrl`. Methods too:
> `routes` is `FederatedRouteEndpoint[]`, and the base class derives the callback's method from
> `answersWithFormPost()` (POST for SAML and `form_post`, GET otherwise; `connect` and SAML's
> `logout` GET), so a hand-written GET callback for a provider that posts its answer is refused,
> naming both methods. A getter rather than a field, because `responseMode` is a field a subclass
> sets after the base class's initializers ran. Red first for an OAuth2 `form_post` authenticator
> and an interface-only one declaring a POST logout.

### H9. No step-up authentication for sensitive operations — **WITHDRAWN**

Recorded as: a session that logged in once can do everything its roles allow for as long as it
lives, with no way to require a fresh factor before changing an email, a password or a payout address.

> **Withdrawn (2026-10-04): it exists.** `@Auth.require2fa` is step-up. It asks for a second factor on
> every request to the route it guards, and never marks a session as having passed one. The code is
> spent by the operation it opened (C3). The original table's "absent" contradicted C3's own note
> that "2FA here is step-up", and the split copied that over without checking it against the
> decorator.
>
> Not built: accepting a fresh login in place of the second factor. A route that wants a fresh proof
> asks for the second factor, so a user who has not enrolled one cannot pass it. That is H13.
>
> Held by the H9 block of `auth-sessions-and-2fa.evaluation.test.ts`: a logged-in session without a
> code gets 401 on a `require2fa` route while the same token opens a login-only one, and the same
> session with a code gets through.

### H10. No WebAuthn / passkeys — **FIXED**

The second factor is TOTP only, and there is no passwordless sign-in. A passkey is also the one
factor here that phishing cannot get past, since it is bound to the origin.

> **Design (with the user, 2026-10-08):**
> - **`@simplewebauthn/server` checks the ceremonies**, an optional peer like `otpauth` and `jose`.
>   Writing it ourselves would mean owning CBOR, COSE keys and attestation formats, which is binary
>   parsing with security riding on it. `zibri-testing` takes `@peculiar/x509`, which the library
>   already brings along, to build the certificates of a fake device's attestation and of a fake
>   metadata service.
> - **One stored passkey serves both sign-in and the second factor**: a passwordless
>   `PasskeyAuthenticator`, and a two factor method for `@Auth.require2fa`. A passkey login counts as a
>   recent login for H13 with nothing added.
> - **An account can be made with a passkey alone, and making it logs in.** The verified registration
>   is a one-time credential the authenticator spends, the way H2's registration ticket is. One device
>   prompt, not a registration followed by a sign-in.
> - **Attestation is optional, with an allowlist of device models.** By default none is asked for,
>   and the device's model id (AAGUID) is kept with the passkey. An application can require
>   attestation and name the models it accepts, checked against the FIDO Metadata Service.
> - **Decided by me, open to the user:** sign-in asks for no email first. The browser offers the
>   passkeys it holds for the site, and the one picked names the user. Asking for an email first
>   would answer whether an address holds an account (B4). The cost is that a security key which
>   cannot store a passkey works only as a second factor.
> - **Required options**, as nothing can derive them: the domain passkeys are bound to (`rpId`) and
>   the frontend origins allowed, since a frontend can be served from another host than the api.
> - **A challenge round trip**: unlike a TOTP code, a passkey signs a challenge the server issued, so
>   both sign-in and the second factor get a step that issues one, single use and short lived.
>
> **Second round (with the user, 2026-10-08):**
> - **A passkey is a linked identity**, so `findIdentities` and `unlinkIdentity` list and remove it
>   beside a provider's. The sign-up is H2's ticket: `resolveRegistration`, `linkIdentity`, then a login
>   that spends the ticket.
> - **`startConnection` becomes generic**: each authenticator types what starting a connection takes and
>   answers. OAuth takes `{ redirectTo, signIn, scopes }` and answers a url; a passkey answers the
>   options the browser creates it with. A breaking change to H16's call, for one entry point H19 can
>   build routes from.
> - **The application's own route starts adding a passkey**, as it does for a provider, so the
>   application decides what guards it. A passkey added through a stolen session outlives a password
>   change, so the docs show it behind `@Auth.require2fa({ reauth: true })`. Only the step that
>   finishes it is a framework route, and it checks that the same user is logged in.
> - **As a second factor, a passkey always verifies the user** (fingerprint or PIN), with no option
>   (the user's call over a required option). A security key without a PIN cannot be one.
> - **A signature counter that goes backwards refuses the sign-in and audits it**, and the passkey
>   stays. Synced passkeys always count 0 and are never refused for it.
> - **The library's `MetadataService` and `SettingsService` are not used**: both are process-wide
>   singletons, and without trusted roots its chain check passes any self-made certificate, so a
>   device could claim any model. Zibri downloads the metadata through `HttpClient`, checks its chain
>   against roots the application configures, and checks a device's attestation against the roots
>   the metadata names for its model.
>
> **Built (2026-10-09), closing H10.** `PasskeyAuthenticator`, `PasskeyTwoFactorMethod`, and
> `JwtPasskeyController` / `CookieAuthPasskeyController` under `/auth/passkey`. Settled on the way:
> - **The ceremonies live in `PasskeyService`, behind `ZIBRI_DI_TOKENS.PASSKEY_SERVICE`**, and the
>   metadata in `FidoMetadataService` behind `FIDO_METADATA_SERVICE`: the user's call, so an
>   application can replace either. Its checks at boot run in `onAppInit`, only when the application
>   registers the authenticator or the method, and the sign-up's ticket table is required only with
>   the authenticator. The user had me write the rule into CODE_STYLE.md: a framework service is an
>   interface and a token, and its boot checks go in `onAppInit`.
> - **The routes that sign nobody in go to the service, not the authenticator**, so an application
>   that takes passkeys only as a second factor gets its challenge route without registering the
>   authenticator.
> - **A challenge is spent before its answer is checked, and outside the login's transaction**, so a
>   wrong answer cannot be retried against it and a rolled back login does not give it back. One
>   answered twice is `token-reused` in the trail; one whose device count fell behind is the new
>   `credential-cloned`, through a `CredentialClonedError` like `CredentialReusedError`. The library
>   is handed a count of 0 and the counts compared here, since its own error says nothing a caller
>   could tell a copied device by.
> - **The library's `Buffer`-free types**: everything handed to it is a `Uint8Array<ArrayBuffer>`.
>   `PasskeyCreationOptions` and `PasskeyRequestOptions` are model classes typed with the library's
>   own types, so the routes document them and its answers are assignable without a cast.
> - **The second factor arrives as base64url json in `x-authorization-passkey`** (`PASSKEY_HEADER`,
>   which CORS follows), validated against `PasskeyAuthenticationResponse` like a body.
>
> **Found on the way, and fixed:**
> - **The FIDO list is 10.6 MB** (October 2026), over the http client's 10 MB default, so every
>   attested registration would have failed on the size limit. `fetchForLibrary` takes a
>   `maxResponseSize` for one request now, red first in `http-client.test.ts`, and the metadata
>   download names 100 MB. The real list (no. 290, 520 models) verifies with the same steps under the
>   default roots: a chain of three to GlobalSign R46, RS256. Checked once by hand, not in a test,
>   since a test would depend on the FIDO Alliance being reachable.
> - **`mds3.fidoalliance.org` redirects to `mds.fidoalliance.org`**, which is the default url.
> - **The metadata cache was keyed by url alone** in my first draft, so a list verified under one set
>   of roots would have answered for another. Keyed by url and roots before it shipped.
>
> **Tests.** `auth-passkey.evaluation.test.ts` (3 cases, jwt) and `passkey.authenticator.test.ts`
> (23 cases, cookie and jwt, in memory): sign-up and sign-in, a recent login, a ticket once and only
> once linked, one answer per challenge, a challenge for another ceremony or past its time, another
> origin under the site, a device that does not verify its user, a copied security key (refused,
> recorded, the original keeps working), synced passkeys, adding to a password account and listing
> and removing, finishing for another user, the second factor of its own user only and once, the
> boot checks, a 2fa-only application without the ticket table, and attestation: an allowed model
> (metadata downloaded once), a listed but not allowed one, no proof, a proof from an unlisted maker
> naming an allowed model, a compromised model, and metadata not signed under the configured root.
> The chain check and the counter check were each broken on purpose and seen red. `zibri-testing`
> gained `FakePasskeyDevice` and `startFakeFidoMetadataService`.
>
> **Not built:** a sign-in that asks for an email first, for security keys that cannot store a
> passkey (mine, above). Nothing has run against a real browser or a real device: the fake device
> produces what WebAuthn specifies, and what the library accepts.

### H11. No SMS or email code as a second factor — **FIXED**

Only an authenticator app can be a second factor, which leaves out every user who does not have
one. Weaker than TOTP (an SMS can be redirected), so it is a choice an application should be able
to make, not a default.

> **Design (the user, 2026-10-09):**
>
> - **Two methods and nothing beside them.** `EmailTwoFactorMethod` and `SmsTwoFactorMethod`
>   implement `TwoFactorMethod` and ride on `TwoFactorService`, which already does the enrolling, the
>   throttle on wrong codes and the audit. A first draft had a `TwoFactorCodeService` with its own
>   enroll, confirm, verify and remove: the same surface as `TwoFactorMethod` again, which the user
>   turned down. The logic two methods share is an abstract `CodeTwoFactorMethod` instead.
> - **The code goes to the address of the account** (the user's choice over a separately enrolled
>   address). Anyone who can read that mailbox passes this factor, which `EmailTwoFactorMethod`
>   says in its docs.
> - **A text message has no vendor.** `SmsServiceInterface` and `ZIBRI_DI_TOKENS.SMS_SERVICE`, with
>   no default, like the mail transport; an application without a sender is refused at boot. No new
>   dependency.
> - **No controller for now** (the user). Asking for a code is `sendCodeToUser`, called from a route
>   of the application, as enrolling an authenticator app is. The dynamic auth routes of H19 are
>   where a shipped route belongs.
>
> **Mine:**
>
> - **A code belongs to the credentials it was sent for.** A user with a confirmed factor who
>   starts enrolling again, or somebody holding their session, is mailed a code for the new
>   enrollment. Were codes kept per user, that code would pass the factor already in force; kept per
>   credentials, it is a wrong code there.
> - **At most one code a minute for each user and channel**, enrolling included. It is taken before
>   an enrollment is touched: a turned away request must not delete the enrollment whose code is on
>   its way (red when the order is swapped). This is also what keeps a text message from being paid
>   for a hundred times.
> - **The phone number is an encrypted property**, like the secret of an authenticator app.
> - **Request data of the email method is `void`**, not `never`: `never` is not assignable from the
>   `any` of `TwoFactorMethods`.
>
> **Review (the user, 2026-10-09), and what changed after it:**
>
> - **No limit on wrong codes of its own.** The first build counted wrong tries per code, voided it
>   after five and checked one code at a time per credentials under a lease. A guarded request
>   reaches a method only through `TwoFactorService.validate2fa`, which already checks one code per
>   user at a time and doubles the wait after each wrong one. Both went; a wrong code is an
>   `InvalidTwoFactorCodeError` and feeds that streak like any method's.
> - **The once a minute is a rate limiter**, `TwoFactorCodeRateLimiter` (GCRA, capacity 1) under
>   `ZIBRI_DI_TOKENS.TWO_FACTOR_CODE_RATE_LIMITER`, rather than a kept lease. Its refusal carries the
>   real `Retry-After`; the lease claimed the whole interval. Its store is in memory, so the limit is
>   per instance, the same choice `AuthRateLimiter` makes and documents.
> - **The code is encrypted, not hashed.** An unsalted SHA-256 of six digits is reversed by trying all
>   10^6 within the minutes the code lives. `PasskeyChallenge` hashes because its values are 32 random
>   bytes. Compared in constant time.
> - **A channel is a string the method names**, not a closed enum, so a third method extending
>   `CodeTwoFactorMethod` has enrollments and a limit of its own.
> - **Confirming replaces the factor in force in a transaction**, so a failure in between cannot leave
>   the user without either. The codes of the replaced credentials can no longer be reached and expire.
> - **`SmsTwoFactorMethod` validates the number itself**, against `SmsRegisterData`, since enrolling is
>   also called from code rather than only from a body.
> - **Found by `optional-peer-dependencies.test.ts` (the user's run): the framework no longer loaded
>   without `re2`.** `SmsRegisterData` declared its number with a `regex`, which needs the optional
>   `re2` as the decorator runs, and the barrel decorates the class on load. A number is now the
>   built-in string format `'phone'` (E.164), checked by a fixed pattern the framework owns, as
>   `'email'` and `'uuid'` are.
> - **The docs said to accept a recent login for changing the email address.** With the email method,
>   a password alone would then move every code to another mailbox. The page now says to guard that
>   route, and the routes that enrol a factor, without `reauth`. The user asked whether `reauth` made
>   the email method unnecessary: it does not, a recent login proves the password again, a mailed code
>   proves the mailbox as well.
> - **Asking for a code stays `sendCodeToUser` on the method** (the user), a stopgap until H19 gives
>   `TwoFactorMethod` a generic way to start a second factor that the passkey options fit as well.
>
> Held by `code.two-factor-method.test.ts` (17 cases, in memory): both methods enrol with a code
> that was delivered and count only once confirmed, take a code once, keep it encrypted, refuse one
> sent to somebody else, refuse the code of a new enrollment for the factor in force, take the right
> code after wrong ones and make the user wait in between, let a new code replace the old, refuse a
> malformed phone number from code, remove codes with their enrollment, refuse a code once its time
> is up, throttle a second send with a `Retry-After` for each channel separately, and refuse to start
> without the entities, without a sender, and with a setting that is not a whole number. Broken on
> purpose and seen red: the confirmed-only lookup and the order of the throttle (first build), the
> encryption, the number check and the channel in the limit's key (after the review).
> `zibri-testing` gained `RecordingEmailTransport` and `RecordingSmsService`.
>
> **Not built:** a shipped route to ask for a code (H19), a code sent to an address other than the
> account's, and a hard limit that disables the factor (see the residue in 11).

### H12. No EdDSA for access tokens — **FIXED**

Asymmetric access tokens take ES256/384/512 and RS256 (H1), not EdDSA, because `jsonwebtoken` has
none. Closing it means a second JWT library for one algorithm, or replacing the one in use.

> **Fixed (2026-10-05) by replacing `jsonwebtoken` with `jose`**, which H2 needs anyway (see its
> design). `accessTokenKey` takes `{ algorithm: 'EdDSA', key }` with an Ed25519 key, and
> `JwksController` publishes it as an `OKP` key, its thumbprint computed from the members RFC 7638
> requires of that type.
>
> - **`EdDSA` rather than `Ed25519`.** RFC 9864 registers `Ed25519` as the fully specified name and
>   deprecates `EdDSA`, which leaves the curve to the key. Verifiers today know `EdDSA`, and the
>   newer name can be added beside it once they know that one too. `jose` reads both.
> - **`jose` is an optional peer, like `otpauth`** (the user's call when installing it). It is loaded
>   through `optionalPeer` rather than imported, so the barrel still loads without it, and
>   `JwtAuthStrategy` asks for it as it is constructed, so a missing package stops the boot rather
>   than the first login. `zi new` installs it, since the generated app takes the default strategy.
> - **Keys go to `jose` as `KeyObject`s, a shared secret included, and times as numbers.** Loaded
>   through node's own `require`, `jose` runs outside the realm a test runner gives its code, and it
>   recognizes a secret handed over as bytes, and a `Date`, with `instanceof`. Both would be refused
>   from another realm.
> - **A token without `exp` is now refused** (`requiredClaims`) rather than taken to never expire,
>   which is what both libraries do by default. Every token signed here has one, so this changes
>   nothing for them.
>
> **Found on the way, and fixed:** the forgery tests of `jwt-auth.asymmetric.test.ts` signed payloads
> without `auth_time`, which H13 made required. They were refused by the shape check before the
> signature was ever looked at, so they passed whatever the signature check did. They now sign a
> complete access token for the real user, and a new control test shows the same token signed with
> the application's own key is accepted, so a refusal can only come from the signature.
>
> Held by `jwt-auth.asymmetric.test.ts`, which runs without a container: an Ed25519 key signs,
> verifies with the public key alone, is published as an `OKP` key a verifier can rebuild, and an
> elliptic curve key configured for `EdDSA` is refused at boot.

### H13. A `require2fa` route cannot take a fresh login in place of a second factor — **FIXED**

A user who has not enrolled a second factor cannot pass a `require2fa` route at all. An application
that would accept "this user just proved who they are" in place of a code has no way to say so.

> **Design (the user, 2026-10-05):**
>
> - **Re-authenticating is logging in again, not a strategy of its own.** `AuthStrategyInterface`
>   gains `resolveAuthenticatedAt(context)`: when the caller last authenticated, or `undefined` for a
>   strategy that cannot say, such as an API key. It is required, so every strategy answers. For JWT
>   the time travels in the token (OIDC's `auth_time`) and survives `refreshLogin` unchanged, since a
>   refresh is not a login. Going through `login` means re-authenticating shares the login rate
>   limit, and H2's provider login and H10's passkeys count as re-authentication with nothing added.
> - **`require2fa` takes an options object**, `{ methods?, reauth? }`, replacing the positional list
>   of methods. `reauth` is `false`, `true`, `'onlyAsFallback'`, or
>   `{ allow: true | 'onlyAsFallback', windowInMs? }`. The object form has no `false`, because a
>   window means nothing for it.
> - **The defaults come from DI providers, and `reauth` defaults to `false`.** A route accepts a login
>   in place of a second factor only where the application says so. The window has a default of its
>   own.
> - **`'onlyAsFallback'`** accepts the login only from a user without a confirmed enrollment in any
>   of the methods the route allows, which needs a new `TwoFactorMethod` method to answer that.
>   Unconfirmed counts as none (C2). A user who removes their factor drops to the fallback, so
>   removing a factor belongs behind a `require2fa` without it, and the docs have to say so.
> - **The refusal names what the route takes**, so a client can offer a code or a login.
>
> **Built (2026-10-05) as designed**, with these details settled on the way:
>
> - **The options are `Require2faMetadata` itself**, so the decorator and a manually registered route
>   take the same shape. That makes the methods `allowedMethods`, matching the metadata, rather than
>   the `methods` the sketch used. The DI tokens are `REQUIRE_2FA_REAUTH` (`false`) and
>   `REQUIRE_2FA_REAUTH_WINDOW_IN_MS` (5 minutes). Both values stay undefined in the decorator and are
>   resolved when the route is checked.
> - **The JWT claim is `auth_time` in seconds, on both tokens.** It is the OIDC claim, so a resource
>   server reading the token through the JWKS finds it under the standard name; a comment on the
>   payload type says why it is not a camel cased `Date`. The refresh token carries it so a rotation can
>   copy it. Required, not optional: 2.x refresh tokens are deleted by the upgrade migration and 2.x
>   access tokens carry no issuer, so no token from before the claim is still accepted.
> - **The cookie strategy stores `authenticatedAt` on `CookieAuthRefreshSession`**, which rotation
>   copies. Its `resolveAuthenticatedAt` reads the row without validating again, since validating
>   rotates a lapsed session and the user was already resolved in the same request; a second
>   rotation would present a spent refresh session and end the login as reuse. The upgrade migration
>   adds the column with a 1970 default for sessions 2.x started, so they never count as recent.
> - **`TwoFactorMethod.isRegisteredForUser`** and **`TwoFactorServiceInterface.isRegistered`** answer
>   the fallback. `AuthService` asks it first under `'onlyAsFallback'` and only after the login time
>   under `true`, so a recent login costs no lookup.
> - **Under `true` the login time is checked before the code** (questioned by the user, kept). Either
>   one lets the user through, so the order changes no outcome. It only decides what happens to a code
>   sent alongside a recent login. Checked first, a wrong code would count toward the failure streak
>   and could throttle a user whose login alone was enough, and a right one would be spent. Checked
>   after the login time, the code is ignored, and anyone who watched it would also need the session,
>   which passes on the login anyway. Checking a code that was sent before the login time would need
>   `TwoFactorMethod` to say whether the request carries its credential; it is not built.
> - **`ReauthenticationRequiredError`** ("Log in again to access this route.") is the refusal for a user
>   with no second factor and a login that is too old. A user who holds a factor gets the factor's own
>   refusal.
>
> **Found on the way, and fixed with it:** `JwtAuthStrategy.refreshLogin` answered with the refresh
> token row's `value`, which the hash hook had already hashed. The first refresh worked and the next
> one could never match, so every jwt login ended at its second refresh. Nothing refreshed twice in a
> row, which is why B2's rotation tests did not see it. It now answers with the token it signed;
> `jwt-auth.controller.test.ts` refreshes with the token a refresh returned.
>
> Held by the H13 blocks of `auth-sessions-and-2fa.evaluation.test.ts`:
> - the default refusal;
> - the window;
> - the fallback, including an unconfirmed enrollment;
> - the login time surviving a refresh;
> - a strategy that cannot answer;
> - the object form without `false`, as a type test;
> - the application default, last in the file because it re-initializes the server.
>
> The cookie half is held by `cookie-auth.controller.test.ts`: a login read from the refresh session,
> and a lapsed session rotated inside the guarded request keeping its time.

### H14. No way to accept an identity provider's tokens as bearer credentials — **FIXED**

A mobile app or another service that already holds an access token from the company's identity
provider cannot call the api with it. Doing so means verifying the token against the provider's key
set, checking that it was issued for this api, and finding the user it names. That is a strategy as
the interface stands (`hasCredential`, `resolveUser`), with no redirect, and it shares the provider's
discovery and key set cache with H2.

> **Fixed (2026-10-12).** Decided with the user:
> - **One strategy, a capability on the authenticator.** `ProviderTokenAuthStrategy` hands a token to
>   the registered authenticator implementing `ProviderTokenAuthenticatorInterface` (`issuer`,
>   `acceptsProviderTokens`, `findProviderToken`) whose issuer the token names. `BaseOidcAuthenticator`
>   implements it, reusing its discovery and keeping the provider's key set (jose's remote JWKS,
>   fetched through the application's http client). A provider of another kind implements the
>   interface; the strategy needs no base class. It refuses to start without an authenticator taking
>   its provider's tokens, and with two taking the same provider's, of which only the first would
>   ever be asked.
> - **Routing by issuer.** The jwt and client token strategies took every jwt between them, by whether
>   it carries `client_id`. An RFC 9068 access token carries one, so a provider's token would have been
>   read as a client's, and one without it as a login's. `findJwtKind` now leaves a jwt whose
>   unverified `iss` is not the application's own to `ProviderTokenAuthStrategy`, which claims those
>   naming a registered provider. A jwt naming no issuer stays with the jwt strategy, where it does
>   not verify. A jwt naming an unknown issuer is claimed by nobody, which a guarded route answers
>   `401` as before.
> - **Which tokens: JWT access tokens, and ID tokens on request.** `OidcBearerTokens` on the
>   authenticator: `accessTokenAudiences` (the api's audiences at the provider, no default),
>   `accessTokenType` (`'at+jwt' | 'any'`, required: RFC 9068's marking separates access tokens from
>   ID tokens, and Keycloak and Entra still send `JWT`) and `idTokenAudiences` (the clients whose ID
>   tokens are taken, Google's and Apple's pattern for mobile backends; empty by default). A token
>   marked `at+jwt` is never taken as an ID token. `bearerTokens` itself is `undefined` by default,
>   since registering the strategy is the explicit yes, and the boot check makes forgetting it loud.
>   Opaque tokens through introspection (RFC 7662) were offered and not wanted.
> - **People only.** The user is the one the identity (`iss`, `sub`) is linked to for signing in, with
>   their current roles; a token never registers anyone, and an identity linked for the apis only is
>   refused. Machine tokens a service got for itself were offered and not wanted.
> - **Bound tokens.** `cnf.jkt` is taken only with a proof of the key, through `DpopService`;
>   `cnf.x5t#S256` only beside the certificate, through `ClientCertificateUtilities.isSentWithBoundCertificate`,
>   moved out of `ClientAccessTokenAuthStrategy` so both use it. A `cnf` binding to anything else is
>   refused rather than taken as unbound. The certificate case mattered: the certificate strategy steps
>   aside for every certificate-bound token, so without the check such a token would have worked
>   without its certificate.
> - **The login time** is the token's `auth_time`, undefined without one.
>
> `auth-provider-tokens.evaluation.test.ts` is green: a mobile app's access token acts as its linked
> user. `provider-token.auth-strategy.test.ts` (18 cases) holds both token shapes, the application's
> own tokens left to its strategies, another api's audience, a forged signature, expiry, an unlinked
> and an api-only identity, `at+jwt` against `any`, ID tokens per audience, an access-token-marked
> token for the mobile client, a provider taking none of its tokens, DPoP and certificate binding,
> an unknown `cnf`, the login time through `@Auth.require2fa`, and the three boot refusals. Seen red:
> the routing (every accepting case refused as two credentials without it), the certificate binding,
> the unknown `cnf` and the shared provider. The fake provider gained `createJwtAccessToken` and
> `createIdToken`. `base-keycloak.authenticator.test.ts` gained a mobile client whose real access
> token (`typ` `JWT`, the api as audience by a mapper) calls the api as the linked user; it needs a
> container, and has not run yet. Entra's per-application `sub` may differ between a sign-in's ID
> token and an api's access token, which would leave such a token unlinked; not verified against Entra.

### H15. No sign-in through a provider that speaks plain OAuth2 — **FIXED**

Some providers, GitHub among them, implement OAuth2 without OpenID Connect. They issue no ID token,
so who signed in has to be read from a provider-specific user endpoint instead of a signed token.
H2's flow covers the redirect and the code exchange, and this would add that lookup.

> **Fixed (2026-10-08).** Decided with the user:
> - **A shared base.** The whole round trip - attempts, the browser binding, state and PKCE, the code
>   exchange, handover codes, registration tickets, connecting and linked identities - moved into
>   `BaseOAuthAuthenticator`. A subclass answers one question in `resolveSignIn`: who signed in, and
>   when. `BaseOidcAuthenticator` verifies the ID token and adds `nonce` and `max_age` to the
>   authorization request. `BaseOAuth2Authenticator` takes its endpoints by configuration, as such a
>   provider publishes nothing to discover, and reads the user from the provider's api in
>   `resolveIdentity`, through `fetchJson`, which goes through the application's http client.
> - **Everything shared renamed from OIDC to OAuth** (the user's call; OIDC is unreleased): the entities
>   (`OAuthIdentity`, `OAuthLoginAttempt`, `OAuthHandoverCode`, `OAuthRegistrationTicket`,
>   `OAuthConnectionCode`), `OAuthOptions` and `ZIBRI_DI_TOKENS.OAUTH_OPTIONS`, `OAuthSignInFailure`,
>   `OAuthRouteUtilities`, `CookieAuthOAuthController` and `JwtOAuthController`, the routes under
>   `/auth/oauth/:provider`, the fake provider in zibri-testing (`startFakeOAuthProvider`), and the docs
>   page, now `sign-in-through-a-provider.md`. What only OpenID Connect has keeps its name.
> - **A plain OAuth2 sign-in never counts as a recent login.** The provider does not say when the user
>   signed in, and may have reused its own session, which H2 decided must not pass as a fresh login.
>   Its login time is the epoch, as for the 2.x cookie sessions, so a route accepting a recent login in
>   place of a second factor asks such a user for the factor.
> - **Provider authenticators are named `Base{Provider}Authenticator`** (the user's call, after the
>   rename): `BaseGoogleAuthenticator`, `BaseAppleAuthenticator`, `BaseMicrosoftAuthenticator`,
>   `BaseKeycloakAuthenticator`, `BaseGitHubAuthenticator`. Which protocol a provider speaks is nothing
>   an application cares about, and `Base` says the class is there to be extended.
> - **GitHub is built in** (`BaseGitHubAuthenticator`). The identity is the numeric id of the
>   account, which survives a rename, the email the primary one from `/user/emails` with GitHub's
>   verified flag, and re-authentication asks with `prompt=select_account`, the only prompt GitHub
>   takes. `reauthenticationPrompt` lets any provider name its own.
>
> `auth-oauth2.evaluation.test.ts` is green: a provider issuing no ID token signs a linked user in,
> read from its api. `base-oauth2.authenticator.test.ts` holds the login time on both strategies (a
> refresh session and an access token at the epoch), the authorization request without `nonce` and
> `max_age`, the registration from the api's answer, and an api that does not answer going to the
> error url. `base-github.authenticator.test.ts` plays GitHub's two endpoints, `null`s included.
> The fake provider gained `issuesIdToken: false` and `resources` for it. The OIDC suites passed
> unchanged through the move.
>
> Written after the base class rather than before it, so not seen red against the real gap; every
> assertion is one only the plain OAuth2 path makes true. Not verified against GitHub itself.

### H16. No way to add an identity provider to an account that already exists — **FIXED**

A user who has an account cannot connect a provider to it ("connect your Google account"), so their
next sign-in through that provider finds no user. Connecting has to be explicit and has to come from
a session that is already logged in. Matching an existing account by the email the provider reports
would let anyone who controls that address at the provider take the account.

> **Fixed (2026-10-08).** Decided with the user:
> - **The application's own route starts it**, guarded however the application decides, through
>   `AuthService.startConnection(authenticator, redirectTo)`. It connects the user logged in with the
>   request and nobody else. The docs guard the route with `@Auth.require2fa({ reauth: true })`, as
>   for changing a password: a linked identity is a way into the account that outlives the session
>   and a password reset.
> - **Two steps, so the sign-in's cookie is first party.** `startConnection` answers with a one-time
>   url (`OidcConnectionCode`, valid for a minute) to `GET /auth/oidc/:provider/connect`, which the
>   browser navigates to. That route sets the cookie and sends the browser on to the provider. A cookie
>   set on the answer to the frontend's own request is a third party cookie whenever the frontend runs
>   on another site, and browsers drop those. The attempt row holds the user, and the callback links
>   the identity instead of logging in.
> - **Always `prompt=login`**, so the user sees which account they link. A provider session somebody
>   else left in a shared browser would otherwise be linked without anyone noticing.
> - **Never moved between users.** An identity linked to another user is refused with
>   `already_linked`. One linked to the same user is taken again.
> - **Through `AuthService`, like a login** (the user's call, in review). `BaseOidcAuthenticator`
>   implements a new `IdentityLinkingAuthenticatorInterface`, and `AuthService` takes the authenticator
>   class as its first argument, as `login` does. The registration helpers `resolveRegistration` and
>   `linkIdentity` moved there too.
> - **Listing and unlinking**, added on the user's call. `findIdentities(userId, transaction,
>   authenticators?)` lists across providers, each entry with the name of its authenticator, typed by
>   the authenticators when they are given. `unlinkIdentity(userId, identityId, transaction)` finds the
>   authenticator holding the identity itself. Unlinking the last identity of a user without a password
>   locks them out, which the docs leave to the application to check.
> - **Recorded in the audit trail**: `auth.identity.linked` and `auth.identity.unlinked`, success and
>   failure. A refusal at the callback carries what the sign-in was for (`OidcSignInAction`), so a
>   refused connection is not recorded as a failed login.
>
> `auth-oauth-connect.evaluation.test.ts` is green: a user logged in with a password connects a
> provider, and the provider's next sign-in, reporting another email, logs into that account. The
> connection blocks of `base-oidc.authenticator.test.ts` hold:
> - a form post provider;
> - `prompt=login`;
> - no logged in user;
> - the redirect allowlist;
> - an identity linked to another user, and one linked to the same user;
> - the answer in another browser;
> - the url taken once;
> - listing, unlinking and the refusals of both;
> - a jwt login.
>
> The type tests are in `auth.service.test.ts`.
>
> **Found afterwards (2026-10-08, while planning H18): every connection through Google failed.**
> Google takes `none`, `consent` and `select_account` as a `prompt` and answers anything else,
> `login` included, with an error page, and `BaseGoogleAuthenticator` kept the base's `login`. A
> sign-in with `reauthenticate=true` failed the same way. Nothing caught it because the fake provider
> took every prompt. It now takes a `supportedPrompts` option, and `base-google.authenticator.test.ts`
> (new) runs a sign-in again against one that takes only Google's three. It was red with
> `Invalid prompt: login` before the fix. Google now asks for `select_account`, as GitHub does: neither
> can be told to ask for the password again, so the user at least sees which account they connect.
> Microsoft and Keycloak document `login`. Apple documents no `prompt` at all, so what it does with one
> is unknown here.

### H17. No sign-in through a provider that answers with a form post — **FIXED**

H2's callback is a GET: the provider sends the browser back with the code and `state` in the query.
OpenID Connect also defines `response_mode=form_post`, where the provider answers with a page that
submits a form to the callback instead, so the code never appears in a url. Apple requires it as
soon as the name or email is asked for, and Entra and Okta offer it.

H2's flow cannot take that answer. Each sign-in is tied to the browser by an httpOnly cookie with
`SameSite=Lax`, and a browser leaves a Lax cookie off a POST that another site submitted. The callback
then finds no cookie and refuses the sign-in, which is right for a forged callback and wrong here.

Two ways through, to decide when this is built:
- The POST callback answers with a 303 to the GET callback, carrying the parameters. A top level GET
  navigation does carry Lax cookies. But it puts back into a url what `form_post` kept out of one,
  and Apple's first sign-in posts the user's name there, the only time Apple ever sends it.
- A cookie with `SameSite=None` (which needs `Secure`) for providers that post. The browser then sends
  it on every cross-site request, which `state` and the single-use attempt still guard.

Apple has two more differences: its client secret is a JWT the application signs with its own key and
renews at least every six months, and the name comes as a form field next to the code, not in the
ID token.

`auth-oidc-form-post.evaluation.test.ts` drives a sign-in at a fake provider answering with a form
post, and posts the answer to the callback without cookies, as a browser does. It is red: the
callback takes no POST.

> **Fixed (2026-10-08).** The evaluation test is green. Decided with the user:
> - **The second way: `SameSite=None; Secure`**, only for an authenticator with
>   `responseMode: 'form_post'`. The ticket's cookie goes back to Lax after the callback, because the
>   registration is the application's own page.
> - **The global cross-origin check would refuse that post** (a write with cookies from another
>   origin), which neither way above had accounted for. The user chose a route opt-out with a
>   *required* `acceptedOrigins`: `@AcceptCrossSitePosts({ acceptedOrigins })`, a list or a function
>   of the path parameters. The check stays global, so writes handled by plain express middleware stay
>   covered. The router puts decorated routes on an express router of its own, which the middleware
>   asks, so paths match exactly the way the routes do. The OIDC callback answers with the origin of
>   the provider's authorization endpoint for a form-post provider, and with none for any other.
>   Refused at boot: the decorator on GET/HEAD/OPTIONS, and versions of one route that disagree (the
>   check runs before the version is known). An accepted request is audited as a success.
> - **A url-encoded body type** (`MimeType.FORM_URL_ENCODED`, a default body parser) rather than reading
>   the raw body in the callback, so an html form posts to any route.
> - **A built-in `BaseAppleAuthenticator`.** Its client secret is a function, which a secret can now be
>   for any provider: it is signed (ES256, `node:crypto`) before every exchange, because the
>   configuration lives as long as the process. It takes the `.p8` text rather than a `CryptoKey`,
>   because a class the container builds cannot await an import. `resolveProfile` gets the answer the
>   provider sent too, unsigned, which is where Apple's name is.
>
> **Two form-data defects found on the way, both fixed:** a field sent once per item was handed on as
> raw strings, so a `number[]` was a 400; a field sent as text and as a file was an `InternalError`,
> so any caller could make it a 500. Both cases sit in the container-backed form-data suite. Also
> `FormDataValue` lacked `string[]`, which a cast had hidden.
>
> Not verified against Apple itself; in particular that its ID tokens carry `auth_time`, without which
> every sign-in is refused as invalid.

### H18. No way to connect a provider for access to its apis — **FIXED**

A linked identity (H16) says who someone is at a provider. It holds nothing to act for them there. An
application that wants to read a user's Google Drive or calendar needs the provider's access and
refresh tokens, asked for with the scopes of those apis, kept encrypted and refreshed. H2 left keeping
the provider's tokens out. A link made for api access is also a way to sign in, since a linked
identity is one; whether the two can be had apart belongs to this finding.

> Raised by the user while reviewing H16 (2026-10-08).
>
> **Fixed (2026-10-08).** Decided with the user:
> - **Sign-in and api access can be had apart, chosen per connection.** `startConnection` takes
>   `{ signIn, scopes? }`, and `signIn` is required: both answers are legitimate, and connecting for a
>   calendar should not quietly add a way into the account. `OAuthIdentity` gained `signIn` and
>   `grantedScopes`. A sign-in through an identity linked for the apis only is refused with
>   `not_for_sign_in`, not sent to the registration, because an identity stays linked to one user.
>   Connecting again with `signIn: true` turns signing in on; nothing turns it off silently.
> - **Scopes are named per call**, with incremental authorization: they are asked for when a feature
>   needs them. The authenticator's `apiScopes` is an allowlist (also the user's call), because the
>   scopes of a sign-in come from its url and anyone can craft one. A scope off the list is a 400 at
>   the authorize route and an `InternalError` at `startConnection`, which only application code calls.
> - **A sign-in can ask for api access too** (the user's call, against my recommendation of connections
>   only). The tokens ride on the registration ticket, encrypted, until `linkIdentity` moves them to the
>   new identity. For a known identity they are kept right away.
> - **`identityId` is always required** to get a token (the user's call), and the method is
>   `resolveProviderAccessToken(userId, identityId, scopes)`. The user rejected `resolveAccessToken`
>   because it reads like the jwt strategy's own token. `revokeProviderAccess(userId, identityId)` goes
>   with it. Both find the authenticator holding the identity the way `unlinkIdentity` does, through a
>   new capability interface, `ProviderAccessAuthenticatorInterface`.
> - **Revoked at the provider where it can be done**: RFC 7009 at the endpoint discovery or
>   `revocationEndpoint` names, and GitHub's own `DELETE /applications/{client_id}/grant`. The tokens
>   are removed here first, and a provider that cannot be reached is logged, not thrown, so it cannot
>   block a disconnect. Microsoft publishes no revocation endpoint.
> - **Audited**: `auth.provider-access.granted` and `.revoked`, with the scopes, on a new optional
>   `scopes` field of `AuditEvent`. A refresh the provider refuses is recorded as revoked as well.
>
> Decided by me, and why:
> - **The tokens get their own entity, `OAuthProviderTokens`.** `findIdentities` hands identities
>   out, and the docs return them straight from a controller, so tokens on the identity would be one
>   forgotten exclusion away from a response. It is required only when `apiScopes` is set.
> - **One refresh at a time per identity**, under a lease (`oauth-tokens:{identityId}`, wait mode).
>   A provider that rotates refresh tokens refuses the old one once it has answered, so two refreshes
>   racing would lose the access for good. Who refreshed meanwhile is told by the access token having
>   changed, not by it being fresh. The first version asked "fresh?", and its own test caught it
>   refreshing twice: a token that lives shorter than the 60 second margin is never fresh.
> - **`resolveProviderAccessToken` takes no transaction.** A refresh writes the rotated refresh
>   token, which must survive the caller rolling back.
> - **Offline access per provider**, in an `offlineAccess` member: OIDC's `offline_access` with
>   `consent`, Google's `access_type=offline` with `include_granted_scopes` and `consent`, and
>   Microsoft's `offline_access` without `consent`. Plain OAuth2 asks for nothing, and GitHub's OAuth app
>   tokens do not expire.
> - **Not encrypted through `upsert`**: its conflict path would encrypt for a row id it does not know,
>   and the encryption is bound to the row. The tokens are written as find, then update or create, and
>   a create that loses a race updates the winner.
>
> Not covered: an application cannot turn signing in off for an identity and keep its api access.
> `unlinkIdentity` removes both. Nothing has asked for it yet.
>
> `auth-oauth-api-access.evaluation.test.ts` was red before (nothing it uses existed) and is green: a
> user logged in with a password connects a provider for its calendar only, the application reads the
> calendar twice with a refresh each time, and a sign-in through the identity is refused. The
> `keeping a provider's tokens` block of `base-oidc.authenticator.test.ts` (13 cases) holds:
> - what is asked for, with and without scopes;
> - the allowlist, at the route and in code;
> - api-only connections, and turning signing in on;
> - declined scopes;
> - one refresh for two requests at once against a rotating provider;
> - a refresh the provider refuses;
> - revoking for an identity that signs in, and for one that does not;
> - unlinking;
> - an identity linked to sign in only;
> - tokens from a first sign-in kept through the registration.
>
> `base-oauth2.authenticator.test.ts` holds `expired` without a refresh token and a configured
> revocation endpoint. `base-google.authenticator.test.ts` holds Google's parameters, and
> `base-github.authenticator.test.ts` the grant withdrawn through GitHub's api. The fake provider
> gained refresh tokens, expiring and rotating tokens, declined scopes, a revocation endpoint, and a
> record of token and api requests.
>
> Found on the way, in H16's blockquote: every connection through Google failed on `prompt=login`.

### H19. The auth routes are wired by hand, one controller per strategy and authenticator — **FIXED**

An application lists the controller of every pairing it uses: `JwtAuthController` or
`CookieAuthController` for the password, and `JwtOAuthController` or `CookieAuthOAuthController` for
providers. The framework knows which strategies and authenticators are registered, and its own
services already set up what they need (they register their cron jobs and routes themselves), yet
these routes depend on the application picking the right classes. Each new strategy beside jwt and
cookie would add another controller per authenticator.

The user's direction (2026-10-08): build the auth routes from what is registered, the way
`CrudController` builds a controller class from an entity. A generic auth controller, put together
from the registered strategies and authenticators, would cover the password and the providers alike
and take in a new strategy without a new controller. To settle when this is built: what the routes are
when several strategies are registered, since the jwt and cookie routes share their paths today; and
how an application opts out of a route or puts its own in its place.

> Raised by the user while reviewing H15 (2026-10-08). The docs' sentence about entering the callback url
> at GitHub was what led to it; that one is the provider's own settings, which no framework can do.
>
> **Fixed (2026-10-13).** `AuthController(options)` defines one controller class from the strategies,
> authenticators and two factor methods it is given, which the application extends with its own
> `@Controller`. The six controllers (`JwtAuthController`, `CookieAuthController`, the federated and
> passkey pairs) and `BaseFederatedController` are gone. Decided with the user:
> - **A factory the application extends, not routes registered behind its back.** Opting out is not
>   registering it, or `OmitClass` for single routes. The factory's type resolves which routes exist,
>   so omitting one that is not there does not compile (`@ts-expect-error` cases in the test).
> - **Generic routes, the choice in the request.** One `POST /login` for every authenticator and
>   strategy, named in the query parameters `authenticator`, `strategy` and `method`, required only
>   when there is more than one to choose from. The body is a `oneOf` of the models, and checked again
>   against the model of the class the request names, since the first model a body fits may be another
>   authenticator's. Routes the provider sends the browser to keep `:provider` in the path: it is the
>   redirect uri registered there, and a callback that names its provider is the mix-up defense.
> - **A route exists only when a class calls for it**: the csrf token for a strategy issuing one, the
>   reset routes for `PasswordAuthenticator`, sign-in options and sign-up for passkeys, the federated
>   routes for a provider, the 2fa routes for a method.
> - **One controller serves every strategy** (option a), rather than one per strategy under its own path.
> - **Checked at start**: at most one controller defined by the factory, and its options exactly the
>   registered strategies that log in, authenticators the login route logs in with, and two factor
>   methods. A class that declares only part of a capability (`HalfSignUpAuthenticator` in the test)
>   is refused when the class is defined.
> - **Capabilities are interfaces, not base classes** (framework classes are shortcuts): an
>   authenticator or strategy outside Zibri takes part by implementing `AuthControllerAuthenticatorInterface`,
>   `AuthControllerStrategyInterface`, `SignInOptionsAuthenticatorInterface` and the rest, which carry
>   the models of their bodies as instance members. No statics: the user rejected them, so the body
>   size a model needs is worked out from its property metadata, lazily, on the first request
>   (`resolveMaxBodySize`), and `Body` and `Response.object` take a function answering the class.
> - **A sign-in at a provider either logs in on the redirect back or hands the login over by code.**
>   With a `codeChallenge` it hands it over, for every strategy. Without one only a strategy whose login
>   goes out with the response (`logsInWithResponse`, cookies) can log in on the redirect; any other is
>   refused with 400 at the authorize route, before the user signs in at the provider for nothing. The
>   attempt records the strategy, so the callback logs in with the one the sign-in named.
> - **`TwoFactorMethod` gained required members**: `name`, the models of its routes, and
>   `startSecondFactor`, which replaces `sendCodeToUser` and is what `POST /2fa/start` calls (the
>   stopgap of H11's code methods). JWKS stays its own controller. Sign-up beyond the passkey ticket is
>   out of scope.
>
> Decided by me, for the user to review:
> - `POST /2fa/register` takes `require2fa({ reauth: 'onlyAsFallback' })`: a user's first factor can
>   only be enrolled on a recent login, and a user who has one has to present it. Removing takes
>   `require2fa()`, connecting and unlinking `require2fa({ reauth: true })`.
> - `startConnection` refuses a scope off the allowlist with `BadRequestError`, not H18's
>   `InternalError`: a route calls it now, with the client's request.
> - `TwoFactorServiceInterface.startSecondFactor` and `AuthServiceInterface.completeConnection`, so the
>   routes go through the services; `NoRegisterData` for a method that enrols with an empty body;
>   `zi new` writes `AppAuthController`.
>
> Found on the way: a jwt-only application answered a sign-in without a `codeChallenge` with "Name one
> of  in strategy", an empty list. Red first in `base-oidc.authenticator.test.ts`, which now asserts the
> message.
>
> `auth-controller.model.test.ts` (15 cases) holds the route groups and their types, the refusals at
> definition and at start, choosing strategy and authenticator per request with the body checked
> again, refresh and logout, enrolling OTP over http, the OpenAPI document, and `OmitClass`. Every
> suite that used the old controllers was ported, among them the password, passkey, OIDC, OAuth2,
> SAML, GitHub, Apple, Google and Keycloak suites and their evaluation tests. Red checks, each reverted:
> the body check again, the start check (4 failures), `onlyAsFallback`, the eager body size path (a
> `ReferenceError` at load in `one-of-bodies-and-params.test.ts`), and the empty-list message.

### H20. A tenant cannot bring its own sign-in — **open**

*Filed by this work on 2026-10-13, while building multi-tenancy ([01 MINOR](./01-data-layer.md)).*

Every authenticator — OIDC, OAuth2, SAML, LDAP — is configured in code for the whole application.
An enterprise customer of a multi-tenant application expects to connect their own identity provider
to their tenant, set up at runtime as data, and to have their members sign in through it, the way
SCIM is per tenant. Nothing models a connection per tenant, and no login resolves one. Kept out of
multi-tenancy on purpose: it is a feature on top of the isolation, not part of it.

### H21. Nothing bounds what text message codes cost — MAJOR, **FIXED**

*Filed on the re-check of 2026-10-15.*

> **Closed 2026-10-15.** Both decisions the user's:
>
> - **A required `SMS_CODE_LIMITS`** (`SmsCodeLimits`: `maxPerHour`, `maxPerNumberPerDay`,
>   `allowedCallingCodes`), with no defaults - cost and markets are the application's. `SmsTwoFactorMethod`
>   refuses to start without it or with a value that cannot be a limit. A new optional hook,
>   `CodeTwoFactorMethod.claimDelivery`, runs after the per-user claim and before anything changes, on
>   enrolling and on `startSecondFactor`; the sms method checks the calling code there (400), then the
>   number's daily count, then the application's hourly budget (429 each). Per number before the
>   budget, so one number asked for again and again is refused without spending everybody else's.
>   Checked on every send, so a country taken off the list stops at once.
> - **Counted in the data source.** `TwoFactorCodeRateLimiter`, `SmsCodeBudgetRateLimiter` and
>   `SmsCodeNumberRateLimiter` keep their state in `RateLimitStateEntity` through
>   `RepositoryRateLimiterStore`, with the in-process lock - the version compare is what keeps the
>   count right across instances, as `rate-limiting.md` says. That moved them out of the default
>   providers: every rate limiter declares `onAppInit`, so a default provider is built at boot in every
>   application, and one reading a repository would fail every application without the table. They
>   are injected by class instead and built by the code methods' `init`, which validates the entity and
>   adds them to the new `RateLimitingServiceInterface.addLimiter` (idempotent, so it does not matter
>   which `onAppInit` runs first). `ZIBRI_DI_TOKENS.TWO_FACTOR_CODE_RATE_LIMITER` is gone with it.
>
> Held by `code.two-factor-method.test.ts` (in memory): refusing to start without the limits and
> without the entity, a number outside the countries (nothing sent, nothing stored), one number past its
> daily count across three accounts, the hourly budget across numbers with email still sent, and the
> wait between codes surviving a restart. The cases were mutation-checked rather than red first - the
> first red run failed at boot on the new tokens before reaching behaviour - by disabling
> `claimDelivery` (the three limit cases fail) and putting the code limiter back on an in-memory store
> (the restart case fails). **Breaking:** apps with a code method declare `RateLimitStateEntity`; apps
> with the sms method provide `SMS_CODE_LIMITS`.
>
> Found on the way, and fixed: `RepositoryRateLimiterStore` kept every limiter's state in one table
> under the key it was handed, so two limiters given the same key - two app limiters keyed by user id -
> counted on one row, and `getAll`/`keys`/`size` reported every limiter's rows. The user chose a
> required namespace: a third constructor argument, kept in a new `namespace` column of
> `RateLimitStateEntity` (unique together with `key`, replacing the unique key) and part of every read,
> write and lock key. A second store of a taken namespace is refused, like an `InjectionToken` key -
> within the running application rather than the process, by `DiContainer`, since every application a
> process runs builds its limiters anew. Held by `rate-limiting/stores/repository.rate-limiter-store.test.ts`
> (in memory, four cases, three red first: a count of 3 on the shared row, the other namespace's keys
> listed, a duplicate accepted). **Breaking:** the constructor takes the namespace, and an existing
> table needs the column.

`SmsTwoFactorMethod` ([H11](#h11-no-sms-or-email-code-as-a-second-factor--fixed)) sends a code to
whatever number a user enrolls with (`SmsRegisterData.phoneNumber`, any number in international
format), and the only limit is `TwoFactorCodeRateLimiter`: one code per user and channel per
`resendAfterMs`, in memory and so per instance
(`src/auth/2fa/methods/code/two-factor-code.rate-limiter.ts`, `code.two-factor-method.ts:270-275`).
There is no limit per destination, per country or for the application as a whole, and no list of
countries a number may be in.

So every account is one text message a minute per instance, to a number its owner chose, at the
application's expense. With sign-up open, an attacker registers accounts and enrolls premium-rate
numbers they are paid for ("SMS pumping", or toll fraud), and both `requestRegisterForUser` and the
`2fa/start` route send without the user ever having proved anything about the number. An email code
costs nothing to send; a text message is the one channel where the framework spends money on a
caller's behalf, and it is the one with no budget.
