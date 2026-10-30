# Auth core, sessions, 2FA, authorization, tenancy, rate limiting — round 2

Read in full: `packages/zibri/src/auth/auth.service.ts`, `auth-service.interface.ts` (by use),
`strategies/auth-strategy.interface.ts`, `strategies/jwt/{jwt.auth-strategy,jwt.service,jwt.utilities,jwks.controller}.ts`,
`strategies/cookie/cookie-auth.auth-strategy.ts`, `strategies/api-key/{api-key.auth-strategy,api-key.service}.ts`,
`strategies/authorization-header.utilities.ts`, `authenticators/password/password.authenticator.ts`,
`auth-controller/{auth-controller.model,auth-controller.utilities}.ts`, `auth.rate-limiter.ts`,
`2fa/two-factor.service.ts`, `2fa/methods/{otp,code,recovery-code,passkey}/*.two-factor-method.ts`, `otp.utilities.ts`,
`dpop/dpop.service.ts`, `roles/{role.service,zibri-permissions.model}.ts`, `models/base-user.model.ts`,
`user/user.service.ts`, `decorators/auth.decorator.ts`, `tenancy/**`, `rate-limiting/{rate-limit-keys,rate-limiting.service}.ts`,
`rate-limiting/decorators/rate-limited.decorator.ts`, the `wrap` of `limiter/base-rate-limiter.model.ts`,
`http/cross-origin-cookie.middleware.ts`, `logging/audit-event.model.ts` and `Logger.audit`, the auth block of
`di/default/zibri-di-providers.default.ts`, and the docs `auth.md`, `auth-routes.md`, `roles-and-permissions.md`,
`two-factor.md`, `tenancy.md`, `rate-limiting.md`. Chapter 03 was cross-checked by heading and by the blockquotes of
A3, B2, B3, E1, E2, E3, F2, F3, G1, H9. **The working tree is mid-rework:** `auth.service.ts`, `jwt.auth-strategy.ts`,
`two-factor.service.ts`, `auth-controller.model.ts`, `api-key.auth-strategy.ts`, `rate-limit-keys.ts`,
`zibri-di-providers.default.ts`, `docs/auth.md` and `docs/tenancy.md` are modified, and `auth/roles/` is untracked
(the `hasRole` decorators are deleted in favour of `hasPermission`). Every citation below says which. Not reached:
`passkey.authenticator.ts` / `passkey.service.ts` beyond their `userVerification` setting, the encryption and hash
services (D-series closed, not re-read), the client-access-token strategy, the federated utilities, and the
current red/green state of the `auth-*.evaluation.test.ts` suites.

The user's own list (after-all-findings-fixed.md) is assessed inside the findings: error-message leaks in A7 and A16,
hardcoded constants in A15, the `require2fa` "only if set up" mode in A1, startup validation of `hasPermission` in
A12 (done for routes and stored roles; only in-code calls still warn at runtime), the SSO permission conversion is the
identity-provider reviewer's.

## CRITICAL

None filed. A1 is the one a bank's identity architect would escalate to this level; it is kept at MAJOR because a
TOTP-only deployment can work around it in one custom authenticator.

## MAJOR

### A1. A login cannot be gated on a second factor, and the planned `require2fa` login-route option cannot work as the check is written — MAJOR
*Filed 2026-10-21.*

`@Auth.require2fa` is step-up only. `runChecks` resolves the current account first
(`packages/zibri/src/auth/auth.service.ts:1004-1008`, modified in the working tree) and throws `UnauthorizedError`
when no credential names one; the login route itself is `@Auth.skip` and reaches `authService.login` with nothing
but credentials (`auth-controller/auth-controller.model.ts:190-213`, modified). `AuthService.login`
(`auth.service.ts:274-324`) runs `authenticate` → deactivation → 2FA *lock* → `startLogin`, and nothing in between asks
for a factor. A password alone therefore always yields a full session; `docs/two-factor.md:52-58` says so on purpose
("Not for a session. For an operation."), and 03 §H9 was withdrawn on the strength of that.

What that leaves an adopter without: (1) **MFA at sign-in**, which PCI DSS 8.4, PSD2 SCA and most corporate policies
require for every interactive login, not only for routes somebody remembered to decorate; (2) **an MFA enrolment
policy** ("users holding role X must have a factor"), there is no hook on login that can refuse a user with no
`isRegistered` method; (3) a session that knows whether a factor was ever presented (no `amr`/`acr` claim, nothing
on the cookie session), so a route that wants "a factor at login *or* now" cannot be expressed. Decorating every
route with `require2fa` would demand a fresh TOTP code per request, which is unusable.

The user's list asks for a `require2fa` mode "only if a 2fa method is set up, so we can decorate the login method".
That option by itself would not do it: on the login route `resolveCurrentAccount` has no credential to resolve
(`auth.service.ts:1005-1007`), so the check would 401 before the password is ever read. The user has to come from the
credentials, i.e. the check belongs between `authenticate` and `startLogin` in `AuthService.login`. A workable shape:
a `twoFactorAtLogin: 'never' | 'ifEnrolled' | 'required'` (application option or per authenticator), evaluated in
`login` after `authenticate`, reading the factor from the same headers `validate2fa` reads. For TOTP, passkey and
recovery codes that is complete; for the email/SMS code methods it is not, because `POST /2fa/start` is
`@Auth.isLoggedIn` (`auth-controller.model.ts:674-686`) and a user who is not logged in yet cannot ask for a code, so
those need a pending-login ticket (authenticate → ticket → start code → complete) the framework does not have.

Workaround today: a custom authenticator wrapping `PasswordAuthenticator.authenticate` that calls
`twoFactorService.validate2fa(user, context)` when `isRegistered(user)` — about twenty lines, TOTP/passkey only.

**Verify:** `startTestServer` (in-memory data source) with `OtpTwoFactorMethod` enrolled and confirmed for a user,
`POST /auth/login` with the right password and no `x-authorization-otp` header: it answers 200 with usable tokens.
Then the same with the header: there is no configuration under which the first call answers 401, which is the
assertion to leave red.

> **Closed 2026-10-22.** A required app option `twoFactorAtLogin: 'never' | 'ifEnrolled' | 'required'` (required rather than defaulted, as CODE_STYLE asks of a policy choice; the test harness, which is usually about something else, fills in `'never'`; the scaffold and the sandbox say `'ifEnrolled'`). `AuthService.login` evaluates it after `authenticate`, the deactivation and the account lock, where the user comes from the credentials - the step-up check in `runChecks` cannot do it, as the finding says. The login does not read the factor itself: when the policy applies, it writes a `LoginTicket` (hashed, 5 minutes, spent once; declared in the data source when the option is not `'never'`, swept hourly by `LoginTicketCleanupCronJob`) **outside the request's transaction**, which the refusal rolls back (the lesson of §A2), records `auth.login.pending`, and throws `SecondFactorRequiredError`: a `CustomBodyHttpError`, 401 with the usual body plus `ticket` and the names of the `methods` the user holds. The ticket, in the `x-login-ticket` header (`ZIBRI_DI_TOKENS.LOGIN_TICKET_HEADER`, in the CORS list), continues at four routes of `AuthController`: `POST /login/2fa/start` (the pending-login step the finding said the code methods and passkeys need), `POST /login/2fa/complete` (the factor in its header, through `validate2fa` narrowed to the user's own methods so a wrong code is answered as one, then the ticket spent inside the strategy's transaction and `startLogin` from the authentication the ticket kept, federated session included), and for `'required'` - the enrolment policy of (2) - `POST /login/2fa/register` and `/confirm`, which the service refuses with 403 for a user who already holds a factor, so a password alone can never add an attacker's factor. (3) is covered by the policy rather than a claim: under `'ifEnrolled'` and `'required'` every login of an enrolled user presented a factor, so "a factor at login or now" is `@Auth.require2fa({ reauth: true })`. Not built, deliberately: a per-authenticator policy (a provider sign-in with the provider's own MFA stays under the app-wide option, which 05 §I5 is about), and a pending login on the redirect-back path of a provider sign-in, which is refused like any other refusal there - the handover by code goes through the login route and works. Tests: `auth.service.two-factor-at-login.test.ts` (in memory, otp and email methods): under `ifEnrolled` a user without a factor logs straight in; an enrolled user's password answers 401 with the ticket, `['otp']`, no refresh token and `auth.login.pending` (the finding's Verify assertion); complete with a code logs in and the spent ticket is refused before any code is read; a wrong code keeps the ticket; an email user starts a code with the ticket and completes with it; an expired ticket is refused; an enrolled user's ticket may not enroll. Under `required`: a user with nothing enrolls by ticket and completes, one who does not enroll is refused at complete with 403, an enrolled user is asked as under `ifEnrolled`. Under `never` an enrolled user logs in on the password. Every case but the two controls was red before the fix.

### A2. Refresh rotation treats the ordinary multi-tab race as credential theft and logs the user out everywhere — MAJOR
*Filed 2026-10-21.*

03 §B2 closed the *simultaneous* race: two refreshes that both read `blacklisted: false` are decided by the
compare-and-set, and the loser gets a plain 401 without touching the family (`jwt.auth-strategy.ts:399-415`,
modified; `cookie-auth.auth-strategy.ts:438-456`, unmodified). The *sequential* case is treated as reuse: a request
that reads the row after the winner committed finds `blacklisted: true` and deletes the whole family,
`CredentialReusedError`, audited `token-reused` (`jwt.auth-strategy.ts:376-380`; cookie `refreshLogin`
`:369-375`; and, for *any* request carrying the cookies, `resolveAndValidateSessions` `:540-543`, which ends the
family on every route, not only on refresh).

That sequential case is the normal one for a browser: two tabs sharing `localStorage` (jwt) or the cookie jar (cookie)
both get a 401 when the access credential lapses, both call `/refresh-login`; A's response rotates the row and sets
new cookies or returns a new token; B's request was already on the wire with the old credential and arrives after
A committed. Result: the family A just created is deleted, both tabs are logged out, the SOC gets a
`token-reused` alert that is a false positive, and the user learns to distrust the product. For the cookie strategy
the same happens on an ordinary page load after the session row lapsed, because every request resolving the user
runs `resolveAndValidateSessions`.

Every production token service solves this with a short reuse grace: Auth0's "reuse interval", Keycloak's "refresh
token max reuse", the generic "accept the immediately preceding token for N seconds and hand back the same
successor". Nothing in the B2 blockquote, `docs/auth.md` or the strategies mentions tabs, a grace window or
`Retry-After`; chapter 03's only "two tabs" mention (`:2804`) is about federated sign-in cookies. Not deliberate.

Fix direction: keep the successor on the blacklisted row (`replacedById`, `replacedAt`) and, for a presentation within
a configurable grace (say 30 s) by the same client, answer with the successor's tokens instead of deleting the family;
reuse after the grace, or by a different DPoP key, stays theft. Alternative: a client-side mutex, which the framework
cannot ship for browsers.

**Verify:** `startTestServer`, in-memory data source, `JwtAuthStrategy`: log in, `POST /refresh-login` once and
await it, then `POST /refresh-login` again with the *original* token. Today: 401, the family deleted, the token from
the first refresh refused on the next `@Auth.isLoggedIn` route, and an audit event with `reason: token-reused`.
Repeat for the cookie strategy with the lapsed-session fixture of `auth-controller.cookie.test.ts:324`.

> **Closed 2026-10-22.** Both refresh credentials record `replacedAt` when a rotation spends them, and a spent credential presented within a grace - `refreshTokenReuseGraceInMs` on `JwtAuthOptions` and `COOKIE_AUTH_REFRESH_SESSION_REUSE_GRACE_IN_MS`, 30 s by default, 0 for none - is accepted: nothing is claimed again, and the caller is minted a credential of its own in the same family, so each tab ends up with a live branch (the "hand back the same successor" shape is not possible, since the successor is stored hashed). The grace runs from the first replacement; past it, reuse ends the family as before. For cookies the same grace applies on every route through `resolveAndValidateSessions`, which is where an ordinary page load with the old cookies used to end the login. The concurrent race of 03 §B2 is unchanged: the loser of the compare-and-set still gets a plain 401, and its retry then lands in the grace. A spent token within the grace also logs out (`findRefreshToken`). **Found on the way, and the worse half:** over http the family delete on reuse ran inside the request's transaction, which the `CredentialReusedError` rolled back, so reuse detection had never ended a family through the controller - only `websocket.service.ended-logins.test.ts` saw it work, by committing the transaction by hand. Both strategies now end the family outside the transaction. Tests: `jwt.auth-strategy.reuse-grace.test.ts` and `cookie-auth.auth-strategy.reuse-grace.test.ts` (in memory, grace of 1 s): a second tab gets a credential of its own and both stay live, an ordinary route accepts the old cookies, a replay after the grace answers 401 and the successor is dead with `token-reused` in the trail, and a tab holding the spent token can log out. Five of the six cases were red before the fix, the after-grace ones because of the rollback. The B2 evaluation control now asserts rotation by the new token differing, and the websocket suite runs with a grace of 0.

### A3. Password login has no per-account bound; the per-caller budget counts successful logins and is shared by everyone behind one egress address — MAJOR
*Filed 2026-10-21.*

The only throttle on `POST /login` is `AuthRateLimiter` (`auth.rate-limiter.ts:38-54`, unmodified): a token bucket of
20 per 10 minutes keyed by `RateLimitKeys.perConnection` (`rate-limiting/rate-limit-keys.ts:44-50`, modified), which
is `request.ip`. `BaseRateLimiter.wrap` consumes before the handler runs and never refunds
(`limiter/base-rate-limiter.model.ts:331-356`), so a *successful* login costs the same as a failed one.
`PasswordAuthenticator.authenticate` (`password.authenticator.ts:89-123`, unmodified) keeps no failure count per
account. 03 §E1's blockquote records "no lockout, deliberately", because a per-account counter is a denial of
service "wearing a security feature's clothes".

Two consequences for an enterprise, one on each side of that trade:

1. **Shared egress.** A corporate office, a VPN concentrator, CGNAT, a mobile carrier: hundreds of users present one
   address. Twenty logins per ten minutes per instance is the budget of the whole site; at 09:00 the twenty-first
   employee gets `429`. The framework's own target customer is the one most likely to hit it, and nothing in
   `docs/auth.md:554-580` says that successful logins count.
2. **Distributed guessing.** Credential stuffing comes from thousands of addresses, each spending its 20 guesses on one
   account; the per-address bucket costs the attacker nothing and the account has no limit at all. The 2FA layer
   already has the right primitive, a per-user doubling delay with an optional cap (`two-factor.service.ts:294-313`,
   modified), and NIST 800-63B §5.2.2 asks for exactly a per-account bound (≤100 consecutive failures); PCI DSS
   8.3.4 goes further and *requires* a lockout after ≤10 attempts for ≥30 minutes. §E1's objection is sound against a
   hard default lockout, not against an optional per-account policy an adopter can turn on.

The audit trail does carry `subject` on failed logins, so detection is possible out of band; prevention is not, and
there is no hook to add it short of subclassing `PasswordAuthenticator`.

Fix direction: refund the bucket on success (or count failures only), key the auth limiter by address *and*
submitted subject, and add an opt-in `passwordFailureLimit` shaped like `twoFactorFailureLimit` (delay doubling per
account with a ceiling, optional lock with an unlock path), off by default so §E1's reasoning keeps the default.

**Verify:** unit-level with `startTestServer` and the in-memory data source: 20 correct logins from one address
within 10 minutes, the 21st (also correct) answers 429. Second case: wrong passwords for one account from 25
distinct `X-Forwarded-For` addresses with `trustProxy: 1`, all 25 reach the hash and none is refused.

> **Closed 2026-10-22.** Two of the three directions, and the middle one on purpose not. (1) `RateLimitWrapOptions.refundOnSuccess`: `BaseRateLimiter.wrap` gives back what a call consumed once it returns, through a new private `refund` (a store failure there is counted, never thrown - the call already succeeded). The login route sets it, so the per-address budget counts wrong passwords across all accounts and a successful login costs nothing: the office logs in as often as it likes. (2) An opt-in `passwordFailureLimit: { maxFailures: 1..100, lockForMs }` app option (default `false`), mirroring `twoFactorFailureLimit`: `PasswordAuthenticator` keeps a `PasswordFailureStreak` per user (declared in the data source when the option is set, validated at init), locks the account once the streak reaches the limit, records `auth.password.locked`, and refuses the right password with `PasswordLockedError` - a `401` with the wrong-password message, so nobody learns which accounts exist or are locked by trying; the trail says `reason: locked`. The lock passes after `lockForMs`, a correct password ends the streak, a confirmed password reset lifts the lock, and the streak is written outside the login's transaction, which the refusal rolls back. The comparison still runs on a locked account, so the lock is not readable from the response time. (3) Not keyed by address *and* subject: with the refund in place that key would only buy the office a bigger budget for wrong passwords, and it would remove the one bound on password spraying from a single address, which the per-address count of failures is. Tests: `password.authenticator.limits.test.ts` (in memory, `trustProxy`, budget of 10, limit of 3): eleven correct logins all answer 200; ten wrong ones across two accounts then a 429; three wrong lock the account, the right one answers 401 with the audit rows, and 200 once the lock passed; a correct password ends the streak; a confirmed reset lifts the lock. The first, third and fifth were red before the fix.

### A4. The auth limiter keys IPv6 per address, and a full in-memory store answers 503 to every new caller — MAJOR
*Filed 2026-10-21.*

`RateLimitKeys.perConnection` returns `request.ip` as-is (`rate-limit-keys.ts:49`, modified); no IPv6 prefix
bucketing exists anywhere under `rate-limiting/` or `http/` (grep for `/64`, `ipv6`, `subnet` is empty). A single
residential IPv6 allocation is a /64, so one host owns 2^64 keys of the auth bucket. `AuthRateLimiter` constructs
`new InMemoryRateLimiterStore()` with the default `maxKeys` of 100 000 (`in-memory.rate-limiter-store.ts:13,55,99,156`,
unmodified) and no way to set it without replacing the limiter class; the store refuses a key it has never seen once
full, which `wrap` turns into `RateLimitStoreUnavailableError` (503) under the default `REJECT` policy
(`base-rate-limiter.model.ts:341-351`). 03 §E3's blockquote chose refusing over evicting so that "whoever filled the
store" cannot reset everybody's counter — right for a shaping limiter, wrong for the one gate everybody must pass.

Attack: 100 000 requests from distinct addresses of one /64 inside the 10-minute window (170 req/s, one machine).
From then until the entries expire, every caller the instance has not seen — i.e. every legitimate user arriving
at a new address — gets 503 on `/login`, `/request-password-reset` and the federated callbacks. Three replicas make
it three times the work, not three times safer. Keys already present keep working, which is why §E3's reasoning
holds for them and not for newcomers.

Fix direction: bucket IPv6 by /64 (and offer /48) in `perConnection`; give the auth limiter a store bound large
enough for the window and let `AUTH_RATE_LIMIT_OPTIONS` carry it; for the auth limiter specifically, evicting the
oldest expired-or-not key is the lesser evil, or fall back to `ALLOW` with a metric. Alternative the docs already
name: a `RepositoryRateLimiterStore`, which moves the bound to a million rows but keeps the per-address keying.

**Verify:** unit test on `AuthRateLimiter` with `maxKeys: 50` through a subclass, or `InMemoryRateLimiterStore` directly:
consume 50 distinct IPv6 keys from one /64, then a 51st key from a different prefix: it throws
`RateLimitStoreUnavailableError`. Second assertion, keying: `perConnection()` for `2001:db8::1` and `2001:db8::2`
answers two different keys.

> **Closed 2026-10-22.** `RateLimitKeys.perConnection` counts an IPv6 address by its /64 (`2001:0db8:0001:0002::/64`), an IPv4 address as itself, and an IPv4 address in its IPv6-mapped form (`::ffff:203.0.113.7`, what a dual-stack socket presents) as that IPv4 address, since the /64 of that form is all of IPv4. No /48 option: a /64 is the allocation unit, and a key per /48 would merge the customers of one provider. `AuthRateLimitOptions` carries `maxKeys` (store default otherwise) and a required `onStoreFailure`; the framework's default is `ALLOW`, so a store full of attacker networks lets newcomers in and shows up on `rate_limit_errors_total` and in the store's one-time report rather than answering 503 at the one gate everybody passes. The test server's options and the evaluation suite's override say `ALLOW` too. Tests: `rate-limit-keys.test.ts` (now in memory) "counts every address of one IPv6 /64 as one caller" and "counts an IPv4 address arriving in its IPv6 form as that IPv4 address"; `auth/auth.rate-limiter.test.ts` with room for two callers: `ALLOW` lets a third and fourth through and reports once, `REJECT` refuses the third with `RateLimitStoreUnavailableError` and keeps counting the two it holds. Red before the fix.

### A5. A logout that revoked nothing is audited as a success, and no logout names its user — MAJOR (regression of 03 §G1)
*Filed 2026-10-21.*

`AuthService.logout` records `LOGOUT / SUCCESS` whenever the strategy's `logout` returns (`auth.service.ts:1999-2015`,
modified) and `FAILURE` only when it throws; its own comment says the record is "what makes it visible at all: a
logout that revoked nothing is a live credential somebody believes is dead". Both shipped strategies swallow every
error: `JwtAuthStrategy.logout` wraps the lookup and the family delete in `catch { return undefined; }`
(`jwt.auth-strategy.ts:283-301`, modified), and `CookieAuthStrategy.endFamily` does the same
(`cookie-auth.auth-strategy.ts:339-354`, unmodified). A data source that fails during the delete therefore produces
`auth.logout success` in the trail, and so does a logout presenting an unknown or already spent refresh token.
03 §G1's blockquote (`:2484-2486`) says this exact shape "is now recorded too"; the strategy layer makes that
statement false, which is why it is filed as a regression rather than a new finding.

The second half: the success event carries no `userId` (`auth.service.ts:2003`) because `logout` returns only the
federated session. The jwt strategy knows `refreshToken.userId` and the cookie strategy `refreshSession.userId`; a
SIEM rule "logout without a login", or a per-user timeline, cannot be written against the trail as it is.

Fix direction: let the strategies throw (the controller already answers 200 regardless, which the comment wants),
or have `logout` return `{ userId, federatedSession } | undefined` and audit `FAILURE / refused` for an unknown
token. Neither needs a new mechanism.

**Verify:** `startTestServer`, in-memory data source, jwt: log in, then `POST /logout` with a syntactically valid
refresh token of a different login (or a random one). Expect the audit event to read `failure`; today it reads
`success` and has no `userId`. For the failed-delete case, wrap the refresh token repository's `deleteAll` to throw
through a test provider override and assert the same.

> **Closed 2026-10-22.** A strategy's `logout` answers with the login it ended - `EndedLogin`, whose
> it was and the session at a provider it was started from - or undefined when the data names none,
> and throws when the store could not end it; neither shipped strategy swallows anything any more
> (the cookie strategy's `endFamily` included, whose other callers are the refresh paths that had
> every reason to see a failing store). `AuthService.logout` records `success` with the `userId`,
> `failure / refused` for a credential naming no login, and `failure / error` with the login still
> live - the endpoint answers 200 in every case, as before. `auth.service.logout.test.ts` holds all
> three over http on an in-memory application, the error case by a `deleteAll` that rejects once;
> red first, the trail read `success` without a user for all of them. The audit table on the auth
> page says what the row carries.

## MINOR

### A6. `ACCESS_TOKEN_REVOCATION` and `REVALIDATE_USER_ON_AUTH_CHECK` are silent defaults for a security choice — MINOR
*Filed 2026-10-21.*

`ACCESS_TOKEN_REVOCATION` defaults to `'onExpiry'` (`zibri-di-providers.default.ts:169`, modified) and
`REVALIDATE_USER_ON_AUTH_CHECK` to `true` (`:165`). With the first, a logout, a password reset and `endAccess` leave
every access token of the user working for up to `accessTokenExpiresInMs` (one hour by default, `:207`);
`JwtAuthStrategy.endLogins` says so in its comment (`jwt.auth-strategy.ts:265-269`). 03 §A3's blockquote calls the
stateless path "a choice rather than a default" and the docs describe the trade honestly
(`docs/auth.md:524-552`), but CODE_STYLE's rule is explicit: when both values are legitimate for a security or
policy choice, make it required, because "you forgot to say" must not look like "you said this". `defaultAuth` was
made required for exactly this reason (03 §A1); the revocation mode is the same shape and was not. An auditor
reading "logout revokes the session" in the product's own docs and then finding a live bearer token an hour later
is the concrete scenario.

Fix direction: make `ACCESS_TOKEN_REVOCATION` required on the application options (the compiler asks once), keep
`REVALIDATE_USER_ON_AUTH_CHECK` defaulting to the authoritative value since that one has a safe answer.

**Verify:** a type test in the existing `application-options` typing suite (`@ts-expect-error` on options that omit
the field) once it is required; until then, `startTestServer` with defaults: log in, log out, call an
`@Auth.isLoggedIn` route with the old access token and observe 200.

> **Closed 2026-10-27 (user: keep the default).** `'onExpiry'` stays the default and nothing is made
> required; the trade is the documented one, not a silent one. `auth.md`'s section on what a credential
> is worth gained a WARNING naming what a logout, a password reset and ending the logins leave working,
> and the `POST /logout` row of `auth-routes.md` points to it, which is where the auditor of the scenario
> reads. No test: the behavior is unchanged and the existing `websocket.service.ended-logins.test.ts`
> and authorization-server cases cover both modes.

### A7. `POST /request-password-reset` is a timing oracle for account existence — MINOR
*Filed 2026-10-21.*

03 §B4 equalized the *message* and gave the login path a stand-in hash. The reset request path was not equalized:
for an unknown address the controller does one `findByEmail` and commits (`auth-controller.model.ts:294-299`,
modified); for a known one it also reads the existing token, generates one, creates a row, renders the email
template with the TSX renderer and queues the mail (`password.authenticator.ts:131-171`, unmodified). That is
several round trips and a template render against one read, a difference in the tens of milliseconds that a
remote caller can measure statistically even across the 20-per-10-minutes budget, more so from many addresses (A3).
The audit trail records `no-such-subject`, so the probe is visible, but it works.

The second thing worth noting from the user's error-message recheck: `confirmPasswordReset` answers `Link invalid`
and `Link expired` differently (`:220,224`), which only tells the holder of a 128-bit token that it once existed; harmless.

Fix direction: for an unknown address, run the same stand-in work (render the template for a dummy user, skip the
queue) so both paths cost one template render and one write-sized wait; or answer both paths after a fixed floor.

**Verify:** `startTestServer`, in-memory data source, a mail transport that records: 200 requests alternating a
registered and an unregistered address, compare the medians; the test asserts the medians are within the noise of
each other and is red today.

> **Closed 2026-10-27 (user: answer off the request).** The route answers once the address is looked
> up, the one read both paths cost. `AuthServiceInterface.requestPasswordResetForEmail` (new, the route
> calls it) makes the link, renders and queues the mail and records the audit entry in the background,
> in a transaction of its own; a failure there is recorded with its reason and logged, since nobody is
> waiting for it. Two things the move needed: a per-user lease (`password-reset:<id>`, skip mode), since
> two requests in a row are now both answered before either link exists and both found none, which
> mailed two (the lease also covers two instances, which the old in-request check did not); and
> `AuthService` implements `BeforeAppShutdown`, waiting for the resets still being made before the
> audit trail flushes and the mail transport closes. The audit entry moved from the controller into
> the service with the same fields. Not a statistical test: the medians the Verify note asks for would
> be flaky, and holding the lease shows the property directly. Test:
> `auth-controller.password-reset.test.ts` (in memory, the lease service held at `password-reset:`
> keys): the answer arrives while the reset is held and no token exists yet, the token, mail and
> success entry follow once released; an unknown address is recorded as `no-such-subject`; two
> requests in a row make one token and one mail; a shutdown does not finish while a reset is held and
> the reset is made before it does. Red on the first and the last when written. The jwt and cookie
> controller tests, `password.authenticator.test.ts` and the auth evaluation suite wait for the mail,
> the row or the audit entry instead of reading them right after the answer. `auth.md` says so.

### A8. Enrolling or removing a second factor is not audited; neither is deactivating a membership — MINOR
*Filed 2026-10-21.*

`TwoFactorService` records a lock and a reset (`two-factor.service.ts:320,354`, modified) and every failed
validation (`:194-199`), and nothing for `requestRegisterTwoFactorMethodForUser`,
`confirmRegisterTwoFactorMethodForUser` or `unregisterTwoFactorMethodForUser` (`:82-131`). `AuditAction` has no
member for them (`logging/audit-event.model.ts:29-40`). Adding an authenticator of one's own to a compromised account
is the standard persistence step after a takeover, and removing the victim's is the standard way to lock them
out; both are invisible in the trail while an api key creation (`auth.service.ts:578`) is not. The same gap for
`MembershipService.updateDeactivatedAt` and `deleteMembership` (`membership.service.ts:136-150`, modified): a user
losing a tenant is recorded nowhere, while losing a role is.

**Verify:** `startTestServer`, in-memory data source, OTP: `POST /auth/2fa/register` then `/2fa/confirm`, read the
audit rows of the logger's db transport filtered by `metadata.audit.action` and assert one `auth.2fa.enrolled` (or
whatever name is chosen) with the user id; today none exists.

> **Closed 2026-10-27.** Five new `AuditAction` members: `auth.2fa.enrolled` (recorded by
> `TwoFactorService.confirmTwoFactorRegistration`; asking for an enrollment changes nothing in force,
> so it is not recorded), `auth.2fa.removed` (`removeTwoFactorRegistration`), and
> `auth.membership.deactivated`, `.reactivated` and `.deleted` (`MembershipService.updateDeactivatedAt`
> by whether it sets or clears the date, and `deleteMembership`). Each records success, or failure with
> `auditReasonFor`, and rethrows, the shape `RoleService.audited` and the api key paths have. A
> membership entry is recorded inside `runAs` of the membership's tenant, so the entry's `tenantId` is
> the tenant that was lost, and carries the member as `userId`: neither method is told who asks, as
> `deactivateUser` is not, so there is no actor to record. SCIM goes through both methods and is
> covered with them. Not recorded: deleting a user's memberships with the user (`deleteMemberships`),
> which the user's deletion stands for, and writes through the membership repository directly, which
> `tenancy.md` says, as `roles-and-permissions.md` says for roles. No method field: `AuditEntry` has no
> column for it, and adding one is a schema change for every application. Tests:
> `code.two-factor-method.test.ts` (a refused confirmation, a confirmation and a removal, in that order
> with their outcomes) and `membership.service.test.ts` (deactivate, reactivate, delete, each in its
> tenant), in memory; the membership case red with no entries, the 2FA case red on its first run on a
> wrong filter key and not rerun red before the change. `auth.md`'s table, `two-factor.md` and
> `tenancy.md` list them.

### A9. The cookie strategy's documented in-request renewal cannot happen in a browser, and a missing csrf header is reported as "not logged in" — MINOR
*Filed 2026-10-21.*

`createSession` stores `expirationDate = now + sessionExpiresInMs + 5 min` while the cookie goes out with
`maxAge: sessionExpiresInMs` (`cookie-auth.auth-strategy.ts:164-170,649-661`, unmodified). A browser honouring
`Max-Age` drops the session cookie five minutes *before* the row expires, so the path that rotates a lapsed session
inside an ordinary request (`:552-558`) is only reachable by a client that keeps sending an expired cookie, which is
how `auth-controller.cookie.test.ts:192,324,444` reach it (they age the row in the database). In a browser the
behaviour is: after `sessionExpiresInMs` every request is `401` until the client calls `/refresh-login`.
`docs/auth.md:369-374` ("reissued whenever the session rotates, which includes the rotation that happens inside an
ordinary request once the session cookie expires") and the `hasCredential` comment (`:197-199`) describe the
unreachable path. Clients written to the docs work anyway, which is why this is minor; a client written without a
refresh call will not.

Second half: on an unsafe method without the `x-csrf-token` header, `resolveAndValidateSessions` returns `undefined`
(`:544-546`), so the caller is treated as anonymous: `401 You need to be logged in` and an audit event
`not-logged-in`, not a csrf refusal. A front end missing the header gets a message that sends it to re-login, and
the trail cannot tell a csrf failure from an anonymous call (the middleware's `cross-origin` reason only covers the
cross-site case).

Fix direction: either align the cookie's `Max-Age` with the row (so the in-request renewal is real) or document the
401-then-refresh flow; and throw a dedicated `ForbiddenError` with its own audit reason for a missing/wrong csrf
token on a request that does carry a valid session.

**Verify:** `startTestServer`, cookie strategy, a client that drops cookies past `Max-Age` (undici's cookie jar, or
compute it): wait past `sessionExpiresInMs` set to one second, call an `@Auth.isLoggedIn` route and observe 401 with
no `x-csrf-token` response header. Second: `POST` with valid cookies and no csrf header, assert status 403 and audit
reason `csrf` — red today (401, `not-logged-in`).

> **Closed 2026-10-27.** The first half was already gone when this was reached: a lapsed session is
> recognized by the refresh cookie arriving alone (`resolveAndValidateSessions`), so the in-request
> renewal happens for a browser that dropped the session cookie at its `Max-Age`, which
> `cookie-auth.auth-strategy.reuse-grace.test.ts` ("renews the session inside a request that carries
> the refresh cookie alone") holds and `auth.md` describes. The second half: the strategy throws
> `CsrfTokenRefusedError` (new, public, a `ForbiddenError`) for an http request with a valid refresh
> session and a missing or wrong csrf token; a websocket keeps reading as no cookie login.
> `AuthService.resolveUserOf` catches it, answers no login and remembers it per request, so a route
> skipping auth and a login started again with stale cookies work as before; `runChecks` throws it
> where a login is needed and records `authz.check` with the new `AuditReason.CSRF`. Test:
> `cookie-auth.auth-strategy.csrf.test.ts` (in memory): a missing and a wrong token on a route needing
> a login answer 403 with two `csrf` entries and the right token 200; an `@Auth.skip` route serves the
> request as anonymous; logging in again with the cookies works. Red with 401 when written.
> `auth.md`, `error-handling.md` and `upgrading-to-3.md` (a front end acting on every 401) say so.

### A10. Deleting a user leaves their sessions, refresh tokens and api keys behind, and a cookie session of a deleted user answers 404 naming the id — MINOR
*Filed 2026-10-21.*

`Repository.removeRows` deletes a user's memberships in the same transaction and nothing else
(`data-source/repository/repository.ts:2884-2913`); `AuthService.endLogins` / `revokeForUser` are called by
`deactivateUser` and `endAccess` only (`auth.service.ts:631-647`). Rows in `JwtRefreshToken`, `CookieAuthSession`,
`CookieAuthRefreshSession` and `ApiKey` outlive the user until their cleanup crons, which is a data-retention
oddity rather than a hole, because every strategy re-reads the user. But `CookieAuthStrategy.resolveUser` calls
`userService.findById(sessions.session.userId)` with `required` defaulted (`cookie-auth.auth-strategy.ts:221`),
which throws `NotFoundError` out of `readPrincipal`, so a browser still holding the cookies of a deleted user gets
`404 Could not find user with id "<uuid>"` on every route, including `@Auth.skip` ones that resolve the user, instead
of the 401 the jwt strategy answers (`jwt.auth-strategy.ts:486`, `required: false`).

**Verify:** `startTestServer`, cookie strategy, in-memory data source: log in, delete the user through its
repository, call `GET` on any route: expect 401 (red: 404). Then count `CookieAuthRefreshSession` rows for the id
and assert zero.

> **Closed 2026-10-26.** The rows half closed with §A18: a user deleted for good is deleted with their
> sessions, refresh tokens and api keys. A soft deleted user keeps them on purpose, so the 404 stayed
> for them, and on two more paths than filed: the cookie strategy's in-request renewal and both
> strategies' refresh looked the user up as required too. `CookieAuthStrategy.resolveUser`, its
> renewal and refresh (`findRefreshUser`, formerly `resolveRefreshUser`) and `JwtAuthStrategy`'s refresh
> now find the user with `required: false`: a request is answered as for no login (401, or served as to
> nobody on an `@Auth.skip` route), a renewal renews nothing, and a refresh is refused with the
> strategy's ordinary refusal. Tests: `cookie-auth.auth-strategy.deleted-user.test.ts` (a route needing
> a login, an `@Auth.skip` route reading an optional user, a request carrying the refresh cookie alone,
> a refresh, and a user deleted for good) and `jwt.auth-strategy.deleted-user.test.ts` (a refresh),
> in memory, with a soft deleting user; red with 404 on all five soft delete cases.

### A11. The account lifecycle routines an enterprise expects are left to the application — MINOR
*Filed 2026-10-21.*

What `AuthController` and `AuthService` do not have, each verified by grep over `src/auth` and `docs/`:
a change-password operation (verify the current password, write, end the *other* logins; `docs/two-factor.md:98-100`
shows the route as application code), a forced-password-change flag (the leftover
`// TODO: set require password change to false` at `password.authenticator.ts:236` names a feature that does not
exist), email verification or a change-of-email flow (the email 2FA method sends codes to whatever `user.email`
holds), a logout-everywhere route (`endLogins` exists, `auth.service.ts:1969`, no route calls it for the current
user), session listing and a per-user session cap, and password history. PCI DSS 8.3.6/8.3.7/8.3.9 and most
internal policies ask for most of these; each is a day's work for an application, but every application writes
them again and the ones that forget `endLogins` on a password change ship a known bug. The documented password
*policy* stance (maximum length only, `docs/auth.md:582-597`) is defensible under NIST 800-63B; the missing
*operations* are not a policy choice.

**Verify:** no executable form beyond absence; an evaluation test that posts to `/auth/change-password` and asserts
200 then a 401 for the previous session on a second client is the shape to leave red.

> **Closed 2026-10-28 (user: change password, logout everywhere, session listing with device info
> and a cap ending the oldest, email verification and change, stored as `emailVerifiedAt` on the
> user, enforced for the email second factor, reset mails, optionally login, and a notice to the
> old address).** Forced password change and password history were not chosen and stay with the
> application; the `TODO` naming the former stays where it is.
>
> - **Logins.** A new capability, `LoginListingAuthStrategyInterface` (`findLogins`, `endLogin`,
>   `resolveLoginId`), which `JwtAuthStrategy` and `CookieAuthStrategy` implement over their refresh
>   families. Each refresh row records `issuedAt`, `userAgent` (cut to 512) and `ipAddress` of the
>   request that issued it (`resolveLoginDevice`), and the jwt row `authenticatedAt`, so a login lists
>   where it was last used from. `AuthService` gains `findLogins` (marking the request's own login
>   `current`), `endLogin`, `endOwnLogins` and `changePassword`; `AuthController` gains
>   `POST /logout-everywhere`, `GET /logins`, `DELETE /logins/:loginId` and `POST /change-password`
>   (by the classes, like every other route group). Change password verifies through
>   `PasswordAuthenticator.authenticate`, so a wrong password counts against the streak and a lock
>   holds; a wrong one is a 403, since the caller is logged in; every other login ends, the one asking
>   stays. `MAX_LOGINS_PER_USER` (undefined by default, a whole number of at least 1) ends the least
>   recently used login once one past it starts. New audit actions: `auth.password.changed`,
>   `auth.login.ended`, `auth.logins.ended`.
> - **Email.** `emailVerifiedAt` on `BaseUserEntity`; `EmailVerificationService` behind
>   `EMAIL_VERIFICATION_SERVICE`, on only when `EMAIL_VERIFICATION_OPTIONS` is provided (link url, two
>   templates, required `requiredForLogin`, `linkExpiresInMs`); the entity `EmailVerificationToken`
>   (hashed, one live verification link at a time, the change link replaced by the next) with an hourly
>   cleanup job and a place in `deleteUserRows`; four routes behind `AuthController`'s new
>   `emailVerification` option (a fourth generic, so the routes are in the type only then, and a boot
>   error when the option is set without the token); a change requested with a second factor or a
>   recent login. A refused login mails the link itself, after the password matched, so no
>   unauthenticated resend route exists to leak anything. A write observer refuses a write changing a
>   user's `email` without `emailVerifiedAt`, so a change made around the flow cannot inherit the old
>   verification; `UserRepositoryInterface`/`UserServiceInterface` gain `updateEmail` for it. Reset
>   mails refused for an unverified address are recorded as `email-not-verified` (new `AuditReason`)
>   and no longer logged as errors. New audit actions `auth.email.verified`, `.change-requested`,
>   `.changed`; new public error `EmailNotVerifiedError`.
> - **Found on the way.** `updateHeldRoles`'s reads ran outside the caller's transaction (fixed under
>   §A12), and `UserService.findById`/`findByEmail` could not read inside one at all.
>
> Tests (in memory): `auth-controller.logins.test.ts` (listing with the current login and the
> clients, ending one and refusing another user's, logout everywhere, change password with the 403,
> the audit and the other login ended, the cap, and listing and ending with cookies) and
> `email-verification.test.ts` (a login refused until verified and the mailed link verifying it, a
> change confirmed by the new address with the notice to the old, reset only to a verified address,
> the email second factor refused for an unverified one, a change around the flow refused). The
> jwt cases were red with 404 before the routes; the cookie case and the cap's listing were written
> after their implementation; `email-verification.test.ts` was red only because its modules did not
> exist. Docs: `auth.md` (changing a password, where a user is logged in, the cap), `auth-routes.md`,
> the new page `email-verification.md`, `two-factor.md`, `configuration.md`, `framework-tables.md`,
> and `upgrading-to-3.md` (the new columns in the shipped migration, `emailVerifiedAt` and the
> repository methods for an application's own user entity).

### A12. Roles carry only what they list: no inheritance or wildcard, so every new permission needs a data migration before anybody passes its routes; role assignment is a read-modify-write — MINOR
*Filed 2026-10-21.*

`RoleService.resolvePermissionsOf` is a lookup of the stored `permissions` array of each role
(`auth/roles/role.service.ts:259-272`, untracked new file), `RoleUtilities` has no wildcard or parent notion (grep
`*`, `inherit` is empty), and `docs/roles-and-permissions.md:87` says an "admin" role is one that lists every
permission. Startup refuses a stored role carrying a permission the code no longer declares (`:830-846`), which is
right, but the reverse is silent: a release that declares `invoices.export` and decorates a route with it serves
403 to every caller, admins included, until an operator edits the role rows on every environment. For an application
with a few hundred permissions that is a migration per release, written by hand, with no helper in the framework.
Positively: the startup validation the user's list asks for exists for routes (`auth.service.ts:1280-1301`,
`validateRouteAuth` for manual routes) and stored roles; only in-code `hasPermission` calls fall back to a one-time
warning (`:1248-1257`), which the branded `Permission` type already turns into a compile error for a typo.

Second, smaller: `updateHeldRoles` reads the roles and writes `change(held)` in two statements
(`role.service.ts:504-538`), and its comment accepts that two concurrent assignments without a transaction lose one.
A security-relevant write should not depend on the caller passing a transaction; an atomic array append/remove in
the driver (both stores can do it) fixes the cause.

Fix direction for the first: a `'*'` / prefix wildcard in stored permissions resolved at index time, or a
`superuser` level, or a seed helper that adds newly declared permissions to named roles at boot.

**Verify:** `startTestServer`, in-memory data source: seed a role with every declared permission, then boot a
second time with one more permission declared and a route guarded by it; a holder of the role gets 403. For the
second: two concurrent `assignRole` calls without a transaction for one user, assert both roles held (red
intermittently; run 50 times).

> **Closed 2026-10-27 (user: wildcards; a per-user lease).** First half: a stored role may carry
> `PermissionWildcard`s (new public type), `'*'` for every permission of its level and `'prefix.*'`
> for every one below the prefix. `RoleUtilities.expandPermissions` expands them when the shared and
> the tenant indexes are built, against what the code declares, so a release declaring a permission
> gives it to every matching role without a migration; a wildcard matching nothing stays literal, so
> the startup check of stored roles names it like an undeclared permission, and a write is refused
> for it (`isDeclaredIn`). A role carrying a wildcard needs the `.with_any_permission` guard: holding
> every permission today does not cover what the wildcard hands out tomorrow. `definePermissions`
> refuses a permission holding a `*`. `BaseRole.permissions` is typed with the wildcard. Second half:
> `updateHeldRoles` reads and writes under a lease (`roles:<user>` or `roles:<tenant>:<user>`, wait
> mode, `heldUntil` the caller's transaction), and a transaction already holding the key goes ahead
> (`withHeldRoles`), or a second change in it would wait for itself. Writing the test found the
> in-transaction read was outside the transaction, so two assignments in one transaction lost the
> first as well: `FindUserOptions` and `UserRepositoryInterface.findById`/`findByEmail` take the
> transaction, and `findActiveMembership`/`MembershipRepositoryInterface.findMembership` an optional
> one. Tests: `role.service.wildcard.test.ts` (expansion at both levels, refusal of a wildcard
> matching nothing at either level, the guard, the expansion as a pure function, `definePermissions`
> refusing `*`) and `role.service.assignment.test.ts` (two platform and two tenant roles given at once
> keep both, two in one transaction keep both), in memory, all red when written.
> `roles-and-permissions.md` says so, and its seed example uses `'*'` and `'invoices.*'`.

### A13. Access tokens carry the user's email and role names — MINOR
*Filed 2026-10-21.*

`generateAccessToken` puts `id`, `roles`, `email`, `auth_time`, `sid` and `cnf` in every access token
(`jwt.auth-strategy.ts:669-676`, modified), and `introspectToken` answers `username: user.email` to any caller
with the introspection permission (`:530`). A bearer token travels through browser storage, proxy logs and
third-party resource servers; an email address in it is personal data under GDPR that now lives wherever the token
is logged, and the role names map the authorization model for whoever reads a captured token. The stateless path
(`resolveClaimedUser`, `:493-502`) is the only consumer of `email` and `roles`, and it only needs `id` and `roles`;
03 §A3's blockquote says nothing was *added* to the payload to make it work, which is true and is the reason the
email is still there. OAuth profiles (RFC 9068) put identity in `sub` and leave profile claims to the ID token.

**Verify:** unit test decoding the token from `startLogin` and asserting the payload has no `email`; red today.

> **Closed 2026-10-27 (user: drop email, keep roles).** `JwtAccessTokenPayload` and the RFC 9068
> `JwtClientAccessTokenPayload` lose `email`, and their guards stop asking for it, so a token issued
> before still verifies. `roles` stays for the stateless check. `resolveClaimedUser` answers the new
> public `ClaimedUser` (`id`, `roles`) instead of a `BaseUser` it could no longer fill, and
> `AuthService` keeps claims in a memo of their own: with revalidation on, `resolvePrincipal` is
> `resolveCurrentAccount`, the same memo entry `getCurrentUser` reads, as before. Tests:
> `jwt-auth.asymmetric.test.ts` ("carries who the user is by id, and not their email") and the RFC
> 9068 case of `authorization-server-controller.model.test.ts`, in memory, red with the address in
> both. `auth.md` and `upgrading-to-3.md` (a frontend reading the email off the token) say so.
> Running the in-memory auth suites for it found 03 §H11's favicon regression, noted there.

### A14. `REVALIDATE_USER_ON_AUTH_CHECK: false` saves no read in a tenant and weakens platform checks for nothing — MINOR
*Filed 2026-10-21.*

With the setting off, `readPrincipal` takes the claimed user from the token (`auth.service.ts:1632-1638`,
modified) and `hasPlatformPermission` decides on the token's stale `roles` (`:1208-1213`), but every request in a
tenant still runs `readMembership` → `membershipService.findMembership` against the store (`:1383-1399`), and
`require2fa`'s `resolveCurrentAccount` reads the row regardless (`:1005`). So in a multi-tenant application the
option trades revocation latency for zero saved round trips on any tenant route. `docs/auth.md:529-539` presents it
as "checks that touch no data source". Either the membership should also be carried by the credential in that
mode (a `tenants`/`memberships` claim, with the same staleness caveat), or the docs should say the option is for
single-tenant deployments only.

**Verify:** `RoundTripCounter.describe()` around an `@Auth.hasPermission` route in a tenant with the option
`false`: the count equals the count with it `true`.

> **Closed 2026-10-27 (user: a membership claim in the token).** With the option `false`, the access
> token of `JwtAuthStrategy` carries `tenant_roles`, the roles of the user's active memberships by
> tenant, read once per login and refresh (`resolveTenantRoles`). `ClaimedUser` carries them as
> `tenantRoles`, and `AuthService.resolveCheckedMembership` answers the permission and membership
> checks from them, honoring a credential bound to another tenant as the read did; without the claim,
> or with the option `true`, it reads the membership as before. `getCurrentUser` and
> `getCurrentMembership` still read the stored rows, as `@CurrentUser` is the stored user.
> Staleness and token size are the accepted cost: a role given or taken in a tenant applies at the
> next refresh, and the token grows with the tenants. Client access tokens carry no claim, so they
> keep reading. Not changed: `require2fa`'s `resolveCurrentAccount` still reads the account on the
> routes declaring it, which the finding notes beside the membership. Test:
> `auth.service.trusted-credentials.test.ts` (in memory, the counter on the data source): a permission
> granted and one refused in the user's tenant, and a request in a tenant they are no member of, all
> without a read of the membership; red with two and one. `auth.md` says so.

### A15. Hardcoded constants in the reworked auth code: which deserve a token — MINOR
*Filed 2026-10-21.*

From the user's list. Worth a DI token (a deployment can legitimately disagree): the DPoP proof age and nonce
lifetime, both five minutes (`dpop/dpop.service.ts:32,37`, unmodified; enterprise clock skew and RFC 9449 leave
this to the server); the 2FA per-user check lease of 30 s and the throttled `Retry-After` of +1 s
(`two-factor.service.ts:176,188`); the cookie row grace of five minutes (`cookie-auth.auth-strategy.ts:658,676`,
see A9); the auth limiter's store bound (A4); the recovery-code count and length
(`recovery-code.two-factor-method.ts:29,34`, a bank commonly wants 8 or 16); and, by the user's decision during 08
§X20 (2026-10-25), `API_KEY_PREFIX` (`zibri_`, which a deployment wants for its own secret scanning) and the OTP
period `OTP_PERIOD_IN_SECONDS` (30 s). Both are on `zibri/internal` since X20; the token is what becomes public. Fine
as constants: `PASSWORD_MAX_LENGTH` (read where decorators run, per §E1), the reset token's 16 random bytes, the OTP secret's
15 bytes, `MIN_RSA_MODULUS_LENGTH`, the recovery code alphabet. Already configurable and correctly so:
`TWO_FACTOR_CODE_OPTIONS`, `AUTH_RATE_LIMIT_OPTIONS`, `API_KEY_OPTIONS`, the OTP window.

**Verify:** none needed beyond a typecheck once the tokens exist; the DPoP one gets a test that a proof `iat` six
minutes old is accepted when the token says seven.

> **Closed 2026-10-28.** New tokens, each defaulting to the constant it replaces:
> `DPOP_PROOF_MAX_AGE_IN_MS` and `DPOP_NONCE_LIFETIME_IN_MS` (five minutes), `COOKIE_AUTH_ROW_GRACE_IN_MS`
> (five minutes), `RECOVERY_CODE_OPTIONS` (`{ count, length }`, 10 and 10, a length below 10 refused at
> init, and the codes drawn from as many bytes as the length needs), `OTP_PERIOD_IN_SECONDS` (30, the
> validation window refused at init unless a whole number of periods, `OtpUtilities` taking the period
> as a parameter), and `prefix` on `API_KEY_OPTIONS` (`zibri_`, letters and digits ending in `_`, read
> through the new `ApiKeyServiceInterface.getKeyPrefix`; the internal constant is `DEFAULT_API_KEY_PREFIX`).
> The methods and the cookie strategy read theirs when used, so a subclass keeps its constructor. The
> auth limiter's store bound was configurable already (`maxKeys`, §A4). Kept as constants on purpose:
> the 2FA check's 30-second lease, which is renewed while the check runs and only bounds a crashed
> holder, and its one-second `Retry-After`, which says how long another check of the same user takes;
> neither is a policy a deployment disagrees with. Writing the DPoP test found a defect: the proof
> check passed `maxTokenAge` and `clockTolerance` of five minutes each, which jose adds together, so a
> proof of up to ten minutes passed and was remembered as spent for only as long as the age it was meant
> to have. `verifyDpopProof` checks the age itself now, five minutes either way. Tests (in memory):
> `jwt-auth.dpop.test.ts` (a six-minute proof refused by default, red with 200, and taken with seven),
> `two-factor.options.test.ts` (the defaults, 16 codes of 16 and a 60-second period whose app code
> confirms, the refusals at start), `api-key.auth-strategy.test.ts` (a key with `acme_` issued and
> taken, the same key with `zibri_` refused) and `cookie-auth.auth-strategy.row-grace.test.ts`; red
> before the tokens existed. Docs: `dpop.md`, `two-factor.md`, `api-keys.md` (a WARNING that a new prefix
> strands the keys issued before), `auth.md`, `configuration.md`.

### A16. Recheck of what auth refusals tell the caller — MINOR (mostly clean)
*Filed 2026-10-21.*

From the user's list, re-read after the rework. Clean: login (`Invalid email or password.` for unknown address,
wrong password and password-less account alike, with the stand-in hash, `password.authenticator.ts:95-121`);
deactivation and the account lock are only reported *after* the password matched (`auth.service.ts:300-305`);
password reset request (identical answer, A7's timing aside); `verify-password-reset-token` (boolean over a 128-bit
token); permission refusals never name the permission (`:1057-1061`); 2FA refusals only reach a holder of the
session. Leaks, all small: the multiple-credential refusal lists the strategy names
(`:1684-1686`), `resolveNamed` enumerates the registered authenticators and strategies in its 400
(`auth-controller.utilities.ts:76,82`), both of which the OpenAPI document publishes anyway;
`UserService.findById` puts the id in a 404 that the cookie path can surface (A10). Nothing here changes a rating;
listed so the recheck is on record.

**Verify:** the existing `auth-controller.jwt.test.ts` oracle cases cover the clean items; A7 and A10 carry the two
that are not.

> **Closed 2026-10-28 (on record, no change).** The two that were not clean are closed with their own
> findings: the reset timing with §A7, the 404 naming a user id with §A10. What stays named is the
> strategies of a request carrying several credentials and the authenticators and strategies of a
> request naming none of them, which the OpenAPI document lists for anyone anyway. The refusals added
> since (`CsrfTokenRefusedError` of §A9, `EmailNotVerifiedError` and the 403 of a wrong current password
> of §A11) are answered only after a valid session or a matching password, so they tell nobody anything
> they did not prove.

### A17. An expired, unused password reset token is never deleted — MINOR
*Filed and closed 2026-10-26*, found by 08 §X27's research into what ends each framework table's rows.

A `PasswordResetToken` was deleted when it was used, or when the next reset its user asked for found
it expired. A token nobody used and whose user never asked again stayed, one per such user, while every
other expiring table of the framework has an hourly job.

> **Closed 2026-10-26 (user: a cleanup job).** `PasswordResetTokenCleanupCronJob` deletes expired
> reset tokens every hour; `PasswordAuthenticator.init` registers it, so it runs for an application
> that logs in with a password and for no other. Test:
> `password-reset-token-cleanup.cron-job.test.ts` (in memory, the real cron service): registered with
> the password authenticator, an expired token deleted and a current one kept, not registered for an
> application listing only another authenticator; red without the job.

### A18. Deleting a user leaves every auth row of theirs behind — MAJOR
*Filed and closed 2026-10-26*, found by 08 §X27's research into what ends each framework table's rows.

`Repository.removeRows` deleted a user's memberships with the user, and nothing else. Their
`PasswordCredentials` (a password hash), `PasswordResetToken`, `PasswordFailureStreak`, `OtpCredentials`,
`TwoFactorCodeCredentials` with their `TwoFactorCode`s, `TwoFactorRecoveryCode`s, `TwoFactorFailureStreak`,
`Passkey`s and the passkey challenges and tickets bound to them, `ApiKey`s, `FederatedIdentity`s with their
`OAuthProviderTokens`, the federated attempts, handover and connection codes bound to them, `LdapIdentity`s,
`JwtRefreshToken`s, cookie sessions and `LoginTicket`s stayed: tables growing with every user ever
deleted, keeping personal data, secrets and a provider's tokens of somebody who is gone.

> **Closed 2026-10-26 (user: in the same transaction, as memberships).** Authenticators, auth
> strategies and two factor methods take an optional `deleteUserRows(userIds, transaction)`, which
> every shipped one keeping rows per user implements (one batched delete per table, guarded by the
> same conditions under which the table is declared); `TwoFactorService`, `PasskeyService` and
> `ApiKeyService` have it on their interfaces. `AuthServiceInterface.deleteUserRows` calls every
> registered authenticator, strategy and method, the services, and deletes the login tickets;
> `removeRows` calls it beside `deleteMemberships`, so it runs only when the user row is really
> removed: a soft delete keeps everything, and a restore brings the user back whole. Federated and
> directory authenticators delete only their own identities (by issuer, by directory), and an OAuth
> provider's kept tokens go before them, without being revoked at the provider (a request inside the
> delete's transaction). Kept on purpose: `AuditEntry` (the trail outlives its subject, ended by its
> retention), `Email` (a persisted mail is a record; a queued one is addressed by email, not by user),
> `ScimUser` (the identity provider owns it; `ScimService` already forgets one whose user is gone).
> Test: `auth.service.user-rows.test.ts`, one in-memory application with every shipped authenticator,
> strategy and method that keeps rows: a deleted user's rows are gone from every table and another
> user's are all there; a soft deleted user keeps them and a hard delete removes them. Red with all 22
> tables when written. `framework-tables.md`, `auth.md`, `api-keys.md` and
> `login-through-a-directory.md` say so. One behavior follows: a directory entry whose user was
> deleted for good logs in as a first login again, as an identity at a provider already did, where
> it was refused while the dangling link stayed (`base-ldap.authenticator.test.ts`, case rewritten).

## Code quality and architecture

Moved to [code-review/04-auth-core.md](./code-review/04-auth-core.md) (Q1–Q5).

## Already filed

- A tenant bringing its own sign-in → 03 §H20, open (deferred on purpose).
- Password maximum length as the only policy → 03 §E1 residue; closed 2026-10-01 per its blockquote, still counted
  in 11 — the index and the chapter disagree, worth reconciling.
- No lockout, per-caller budget only → 03 §E1 closed with "no lockout, deliberately"; A3 argues the reasoning covers a
  default lockout and not an opt-in per-account policy.
- Full in-memory store refuses new keys → 03 §E3 closed; A4 is the consequence for the auth limiter.
- Refresh rotation race → 03 §B2/§B3 closed for the simultaneous case; A2 is the sequential case it did not consider.
- Logout audited even when swallowed → 03 §G1 closed; A5 is a regression of what the blockquote claims.
- Stateless checks and `ACCESS_TOKEN_REVOCATION` → 03 §A3/§A4 closed; A6 and A14 are about the default and the
  tenant interaction.
- Step-up authentication → 03 §H9 withdrawn as "it exists"; A1 is the half (gating the login) that does not.
- Audit volume and retention → 03 §G3 closed; A8 is about missing events, not volume.
- Row-level authorization → 03 §A2 closed by scopes; not re-reviewed here. The repository reviewer files two
  gaps in round-2 01 §D1/§D3 (rows loaded through `relations`/`defaultRelations` are not narrowed by the related
  entity's scope; `create(..., { allowId: true })` on an existing id bypasses the update scope judgement, the
  tenant-move refusal and optimistic locking). The auth-side angle: `runChecks` deliberately checks no ownership
  and delegates it entirely to the repository (`auth.service.ts:1027-1031`, modified), and `docs/auth.md:279-283`
  promises callers that a row outside the scope is indistinguishable from a missing one; both findings are
  therefore authorization bypasses from this chapter's point of view, and §A2's "what it does not cover" list
  should name them.
- Permissions declared in code, roles as data, tenant roles → 03 §A5–§A10 closed (files untracked in the tree);
  A12 covers what the model still cannot express.

## Not reviewed

`passkey.authenticator.ts` and `passkey.service.ts` (only `userVerification: 'required'` at `:150,183,365` was
checked; the FIDO MDS path, challenge binding and counter handling were not), `encryption.service.ts`,
`hash.service.ts` and their strategies (03 D-series closed, not re-read), `client-access-token.auth-strategy.ts`,
`base-client-certificate.auth-strategy.ts`, everything under `authenticators/{federated,oidc,oauth,oauth2,saml,ldap}`
and `scim/`, `authorization-server/` (other reviewer), websocket authentication and the tenant rooms, the
`RoleValidatingRepositoryDriver` and `MembershipReportingRepositoryDriver` in the data layer, the sandbox and CLI
templates, and whether the `auth-*.evaluation.test.ts` suites are currently red or green.
