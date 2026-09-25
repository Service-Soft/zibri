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
> **The row level half is closed. Permissions and tenancy are not, and are deliberately staged.**
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
>   [01 M21](./01-data-layer.md#m21-a-malformed-id-is-a-500--nothing-checks-the-id-against-the-format-it-declares--partially-fixed).
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
> concept, no role hierarchy, no tenancy - though tenancy is now an ordinary scope rather than a
> mechanism to build. A policy engine is **declined** rather than pending: the seam belongs in the
> framework, the rule engine does not.
>
> Held by `src/__testing__/evaluation/auth-row-ownership.evaluation.test.ts` over real logins - both
> directions of a list, 404 against a control that succeeds, the paginated count, every write path, an
> array valued membership, an owner supplied by a property default, the anonymous and out-of-request
> refusals, a caller the scope does not narrow, `denyAll` answering empty rather than refusing, and
> public rows beside private ones in one table - and by
> `src/data-source/scopes/apply-scope-to-where.test.ts` for the composition, which is pure and needed
> pinning on its own: the scope reaches **every** branch of the caller's OR, its own branches stay an
> OR, and a pairing that contradicts itself is dropped rather than queried.

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
> `maxLength` on the password field - is still the open half of that.
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

### C3. No TOTP replay protection and no brute-force limit — ~~MAJOR~~ **PARTIALLY FIXED**

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

### D4. Master keys are raw in-process values; no KMS/HSM path — ~~MAJOR~~ **PARTIALLY FIXED**

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
> one vendor's sdk, and the seam is the part a framework can honestly provide. There is still no
> asymmetric jwt signing, no `kid` and no JWKS, so a verifier holds the secret that signs; that stays
> under H. And nothing reports how much data is still under an old master, so "the rotation is done"
> is still a judgement rather than a reading - the same gap D2 leaves for data keys.

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
> only as good as the hop count it was given.
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

### F4. CSRF is partial, non-constant-time, and never rotates — ~~MAJOR~~ **MOSTLY FIXED**

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

| Capability | Status |
|---|---|
| OIDC / OAuth2 client (auth code + PKCE) | absent |
| OAuth2 `client_credentials` / M2M | absent |
| SAML 2.0 SP | absent |
| LDAP / Active Directory bind | absent |
| SCIM provisioning / deprovisioning | absent |
| JWKS publication or consumption, `kid`, key rotation | absent |
| Asymmetric JWT signing (RS256/ES256/EdDSA) | absent — `Secret` is a `string` throughout |
| mTLS / client certificate auth | absent |
| API keys / service accounts | absent |
| Multi-tenant identity or tenant isolation primitives | absent |
| Token introspection / revocation endpoint | absent |
| Step-up auth / re-auth for sensitive operations | absent |
| WebAuthn / passkeys / FIDO2 | absent (2FA is TOTP-only) |
| SMS/email OTP as a second factor | absent |

`AuthStrategyInterface` (`src/auth/strategies/auth-strategy.interface.ts`) is extensible, so these
are *implementable* — but its shape is `login(credentials)` / `refreshLogin` /
`requestPasswordReset` / `confirmPasswordReset`, i.e. a local-password model. A redirect-based SSO
flow does not fit: there is no callback/state/nonce plumbing, and `AuthControllerInterface`
(`src/auth/auth-controller.interface.ts`) assumes POST-with-credentials. An enterprise adopting
Zibri writes its entire identity layer from scratch, against an interface that was not designed
for it.
