# Authentication & Authorization
The following guide will explain to you how the auth system in Zibri works and how you can extend it.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `BaseUserEntity` | function | Helper base class to extend your own user entity from |
| `AuthService` | class | Manages the registered auth strategies and exposes generic auth checks |
| `DefaultAuth` | type | What a route with no `@Auth` decorator requires. Set on the application options, no default |
| `JwtAuthStrategy` | class | Builtin auth strategy sending a Bearer token, used by default |
| `JwtAuthOptionsInput` | type | Secrets and lifetimes for the jwt strategy, via `ZIBRI_DI_TOKENS.JWT_AUTH_OPTIONS_INPUT` |
| `UserRepo` | decorator | Registers a class as the user repository |
| `UserRepositoryInterface` | interface | Contract for finding a user by email and resolving their credentials |
| `ZIBRI_DI_TOKENS.REVALIDATE_USER_ON_AUTH_CHECK` | DI token | Whether checks read the account or trust the credential. Defaults to reading |
| `AuthRateLimiter` | class | What limits the builtin auth endpoints. Replaceable through `ZIBRI_DI_TOKENS.AUTH_RATE_LIMITER` |
| `AuthRateLimitOptions` | type | How many attempts per caller, over how long |
| `JwtCredentials` | class | Entity storing the credentials for the builtin `JwtAuthStrategy` |
| `repositoryTokenFor` | function | Resolves the DI token for a given entity's repository |

## Usage
### Auth strategies
Zibris auth system is based on so called "auth strategies".

Each strategy comes with all the required functionality built in to
- resolve a user
- login
- logout
- refresh the current login session
- functionality for resetting a password

You can register an auth strategy by defining it on the application options. By default the builtin JwtAuthStrategy is used.

However, you will probably never use these strategies directly, as Zibri provides an AuthService that automatically manages these strategies in the background for you:

### AuthService
The auth service is where the auth strategies are managed. It bundles all their functionality and provides generic methods to eg. check if there is a logged in user, with any of the auth strategies registered.

So you could use the builtin JwtAuthStrategy (registered by default when no auth strategies have been provided) which sends a Bearer token with the currently logged in user data and another custom strategy that might use cookies/anything else to determine the currently logged in user and the AuthService is able to determine if a user is logged in, no matter which strategy he uses.

**A strategy's job is to turn a request into a user, and that is all.** Whether that user is logged
in, holds a role or owns the resource being addressed are all the same question about the same
person, so the auth service answers them itself. A strategy you write implements `resolveUser` and
`hasCredential`, and inherits every check — which also means no strategy can disagree with another
about what "has this role" means.

The user is resolved **once per request**, however many checks a route carries — a route requiring a
login, a role and ownership costs one lookup, not three, and `@CurrentUser` shares it. What is shared
is the answer for one set of strategies, so a `@CurrentUser` naming a narrower set than the checks
did is resolved on its own — the point of naming one is that a credential the parameter excludes
must not be able to fill it.

### What an undecorated route requires
Every application has to say what a route carrying no `@Auth` decorator gets. There is no default,
so this is a required option:

```ts
// src/index.ts
import { Auth, Controller, CookieAuthSessionOptionsInput, defineProvider, Get, HttpMethod, JwtAuthOptionsInput, Ms, ZIBRI_DI_TOKENS, ZibriApplication } from 'zibri';

import { applicationOptions } from './application-options';
import { MySharedAuthRateLimiter } from './rate-limiters';
import { secrets } from './secrets';

const app: ZibriApplication = new ZibriApplication({
    ...applicationOptions,
    defaultAuth: 'requireLogin'
});
```

`'public'` lets such a route through unauthenticated. `'requireLogin'` refuses it to anyone who is
not logged in, so forgetting a decorator on a new endpoint costs a `401` the first time you call it
rather than an endpoint anyone on the internet can reach.

**There is no default on purpose.** An api that is open by design and an api that guards everything
are both perfectly ordinary, and picking either one for you would make "you forgot to say" look
exactly like "you said this". Making it a required option asks the question once, at the only place
where it can be answered, and the compiler asks it rather than a warning in a log nobody reads.

Under `'requireLogin'`, a route that really is public says so with `@Auth.skip()` — on the route or
on the whole controller:

```ts
@Auth.skip()
@Controller('/status')
export class StatusController {
    @Get('/health')
    async health(): Promise<unknown> {
        // reachable by anyone, whatever the application declared
        return { ok: true };
    }
}
```

`@Auth.isLoggedIn.skip()` opts out of it too, since that is precisely what it says.

The generated OpenApi spec says the same thing: a route protected only by the default is documented
as requiring authentication, and only the routes that opted out are documented as public.

Under `'public'` a bare `@Auth.skip()` has nothing to skip, and Zibri warns about it — a decorator
that makes a route look guarded while doing nothing is worth removing. A controller shipped in a
library is the exception: it cannot know which default the application picked, and has to state its
own posture either way. It says so with `@Auth.skip({ allowRedundant: true })`, which is what the
builtin auth controllers use.

Both that warning and the refusal below happen while the route is registered, so they appear once,
at boot, for every route the application declares — not once per request that reaches one.

### Declarations that contradict each other

`@Auth.skip()` beside a check, on the same route or on the same controller, says two things at once:
run this check, and check nothing. So does a check beside its own skip, such as `@Auth.hasRole([…])`
above `@Auth.hasRole.skip()`. There is no reading of either pair a request could be served under, and
an application that registers such a route does not start:

```
InvalidDecoratorCombinationError: InvoiceController.list was decorated with @Auth.hasRole,@Auth.skip
```

Booting is when a deployment can still be stopped, which is why this is a startup failure rather than
a 500 for whoever calls the route first.

Two values, deliberately. Every other check — a role, ownership, a second factor — resolves a user
first, so `'requireLogin'` is implied by all of them, and whether a route's own decorators replace
the application wide default or combine with it is a question that cannot be answered wrong. An
application wide *role* would make that question real, and every answer to it is defensible.

### Protecting manually registered routes

A route registered directly on the router with `registerRoute` is covered by the same default. It
carries no decorators, so it states its posture as data instead:

```ts
inject(ZIBRI_DI_TOKENS.ROUTER).registerRoute({
    httpMethod: HttpMethod.GET,
    route: '/status',
    // the same checks the decorators express. Leave `auth` out to let `defaultAuth` decide,
    // which is what an undecorated controller route does.
    auth: { skip: true },
    handler: () => 'ok'
});
```

`auth` takes `isLoggedIn`, `isNotLoggedIn`, `hasRole` and `require2fa` — the metadata the matching
decorators produce — plus `skip`, which is `@Auth.skip()` for a route that has no method to put it
on. Whichever way a route was written down, the same checks run in the same order and answer with the
same statuses, and the OpenAPI spec documents it the same way.

**Static assets are the exception.** Files in `assets/public` are mounted as express middleware
rather than as routes and are served at `/assets` to anyone, whatever `defaultAuth` says — that is
what the folder is for, and a stylesheet a login page needs has to load before there is a login.
Anything a login should gate belongs behind a route rather than in that folder.

**The OpenApi surface answers anonymously unless the application says otherwise.** `/explorer`, the
scripts it loads and `/explorer/spec/:version` are public whatever `defaultAuth` says, because a
browser reaches the explorer by navigating to it and a navigation carries no `Authorization` header:
a login requirement there is not an explorer only your callers can open, it is one nobody can.

An api whose endpoint map is not for everyone says so in one place. `ZIBRI_DI_TOKENS.OPEN_API_AUTH`
takes the same configuration a manually registered route takes, so the surface can require a login,
require a role, or simply fall back to whatever the application declared:

```typescript
providers: [
    // behind the application's default, whatever it is
    defineProvider({ token: ZIBRI_DI_TOKENS.OPEN_API_AUTH, useFactory: () => ({}) }),
    // or behind a role, regardless of the default
    defineProvider({
        token: ZIBRI_DI_TOKENS.OPEN_API_AUTH,
        useFactory: () => ({ hasRole: { allowedRoles: [Roles.ADMIN] } })
    })
]
```

Reaching it in a browser then depends on the strategy: a cookie session rides along with the
navigation, a bearer token cannot. Under a token-only strategy the spec stays readable by anything
that can set a header — a code generator, a client library — and the explorer page does not.

### What a refusal answers
A refused request gets a `401` when the framework could not establish who the caller is, and a `403`
when it could and the answer is still no:

| Check | Status | Why |
|---|---|---|
| `@Auth.isLoggedIn` / the `'requireLogin'` default | `401` | nobody was resolved, so a credential is the thing that is missing |
| `@Auth.hasRole` | `403` | the caller is known and lacks the role |
| `@Auth.isNotLoggedIn` | `403` | the caller is known, and that is the reason it is refused |
| `@Auth.require2fa` | `401` | a second factor is a further credential the caller can still present |

The split matters because clients act on it. Every mainstream http client and SPA auth library reads
a `401` as *"this credential is stale — refresh it and retry"*, so answering a missing role with one
sends it into a refresh loop that succeeds at refreshing and never at the request. A `403` says the
credential is fine and retrying is pointless, which is the only thing the client can usefully do
something about.

Row level restrictions are not in this table because they are not route checks. An entity that
declares a `scope` narrows every query on it to the rows the caller may see, so a row outside that is
`404` — the same answer as for a row that does not exist, which is what keeps a guarded route from
telling anyone which ids are real. A scope may also refuse the request outright, with whatever it
throws. See [restricting which rows a caller may see](./data-source.md#restricting-which-rows-a-caller-may-see).

`@Auth.require2fa` sits on the `401` side deliberately: a caller who has not presented a second
factor still has one to present, so this really is a request for a further credential rather than a
verdict on the caller — the reading [RFC 9470](https://www.rfc-editor.org/rfc/rfc9470.html) gives
step-up authentication.

Your own handlers get the same two: throw `UnauthorizedError` or `ForbiddenError` from
[error handling](./error-handling.md).

### One credential per request
`hasCredential` asks whether a request carries your kind of credential at all — a header being
there, a cookie being set — without looking anything up. It is what selects the strategy that runs,
so registering three strategies costs one lookup per request rather than three.

Exactly one strategy may claim a request. None means nobody is logged in; **more than one is
refused with a 401**, before anything is read:

> This request carries more than one credential (jwt, cookie). Send exactly one.

A client sending both a bearer token and a session cookie is either confused or attacking. Resolving
it either way would mean one identity satisfies the check while the handler acts as the other — a
browser attaches its cookie to every request, so whoever supplies the second credential would decide
which of the two a route sees.

Answer it from presence, never validity. A token that fails to verify still claims the request;
saying "no credential" for it would let a junk header pair with someone else's cookie and have the
cookie win.

### A cookie sent twice
A `Cookie` header may carry the same name more than once, and the browser sends them most-specific
first: a cookie set on `app.example.com` arrives ahead of one set on `example.com`. **Zibri keeps the
first.**

That ordering is the only thing separating the two. Anything able to write a cookie for the parent
domain — a sibling subdomain, or script injected anywhere under it — can send a second `sessionId`,
and it is signed by its own real login, so no signature check rejects it. Ordering is what stops it
from deciding who the request is.

That is a defence you get for free, not one to rely on. If your api shares a registrable domain with
anything you do not control, give the cookie a `__Host-` name so the browser refuses to set it from a
parent domain at all:

```ts
defineProvider({
    token: ZIBRI_DI_TOKENS.COOKIE_AUTH_SESSION_OPTIONS,
    useFactory: (): CookieAuthSessionOptionsInput => ({ name: '__Host-sessionId', sameSite: 'strict' })
})
```

A `__Host-` cookie has to be `Secure`, `Path=/` and carry no `Domain`, so it only works over https —
which is also the only place a session cookie belongs.

Malformed cookies are ignored rather than rejected. `Cookie: a=%` is not valid percent encoding, but
it is not the request's fault and it is not worth an error: the raw value is used as it stands.

### Session cookie flags
`httpOnly` and `signed` are always on and are not configurable. `sameSite` defaults to `lax`, `path`
to `/`.

`secure` is decided per request from whether the connection was https — `req.secure`, which honours
the forwarded protocol for as many hops as `security.trustProxy` declares. The `X-Forwarded-Proto`
header is never read on its own, because the client controls it.

If your api is https-only, say so instead of relying on that:

```ts
defineProvider({
    token: ZIBRI_DI_TOKENS.COOKIE_AUTH_SESSION_OPTIONS,
    useFactory: (): CookieAuthSessionOptionsInput => ({ name: 'sessionId', path: '/', sameSite: 'lax', secure: true })
})
```

An explicit `true` always wins, so a missing or wrong `trustProxy` cannot downgrade the cookie to one
the browser will send over plain http. `false` turns the flag off outright — useful for local
development, and nowhere else.

### Cross-site request forgery
The browser attaches your session cookie to every request to your api, including ones another site
caused. The csrf token is what tells your front end's requests apart from those: it goes in the
`x-csrf-token` header, which another origin cannot set unless your CORS configuration lets it.

**Checked on unsafe methods only.** `GET`, `HEAD` and `OPTIONS` are exempt. The check also only runs
on routes that resolve the session — if a route never asks who you are, the token was not what
authorized it.

**Getting the token.** `login` and `refresh-login` return it in the response body. It is also
reissued whenever the session rotates, which includes the rotation that happens inside an ordinary
request once the session cookie expires. That reissue arrives on the `x-csrf-token` *response*
header, because that response belongs to whichever route you were calling. Read it off every
response and keep the most recent:

```ts
let csrfToken: string | undefined = undefined;

export function rememberCsrfToken(response: Response): void {
    const token: string | null = response.headers.get('x-csrf-token');
    if (token != undefined) {
        csrfToken = token;
    }
}
```

A client that only ever reads the login response will work until its first rotation and then start
getting 401s, so wire up the header before you rely on long-lived sessions.

**Each token belongs to one refresh session.** Rotation issues a new one and the previous one stops
being accepted, which bounds how long a leaked token is worth anything to whoever leaked it.

From another origin this needs no extra configuration beyond naming your origin: the framework lists
its own headers in both `Access-Control-Allow-Headers` and `Access-Control-Expose-Headers`, so the
token can be sent and read back.

**What it does not cover:** routes that never resolve a session — every undecorated route under
`defaultAuth: 'public'`, and anything carrying `@Auth.skip()` under either setting. The check lives in
the cookie strategy rather than in a global middleware, so it runs where a session is read. A public
route that acts on the session cookie's authority has to check for itself.

### What a jwt has to prove
A token is accepted only when all of this holds:

| Checked | Why |
|---|---|
| Signature, against the secret for that kind of token | It came from you and nobody edited it |
| `alg` is `HS256` | The algorithm is pinned rather than read off the token |
| Not expired | `exp`, from the lifetimes above |
| `iss` matches your application's `name` | Another application sharing your secret is still not you |
| The payload has the shape that kind of token carries | A signature says a token is authentic, not that it is the *right* token |

**The issuer is your `name` from the application options.** Nothing to configure — but that makes the
name part of your token contract in two directions. Renaming your application invalidates every token
already issued, so treat a rename as a forced logout. And every replica of the application verifies
against its own name, so all of them have to boot under the same one: a `name` derived per pod — from
a hostname, a container id, an ordinal — means a token minted by one replica is refused by every
other, and behind a load balancer that reads as callers being randomly logged out. Set it to a
constant for the deployment, alongside the secrets.

**Everything the strategy needs comes from one token,** `JWT_AUTH_OPTIONS_INPUT`. Only the two
secrets have no default, because a framework that shipped one would give every application the same
signing key:

```ts
defineProvider({
    token: ZIBRI_DI_TOKENS.JWT_AUTH_OPTIONS_INPUT,
    useFactory: (): JwtAuthOptionsInput => ({
        accessTokenSecret: process.env['JWT_ACCESS_SECRET'],
        refreshTokenSecret: process.env['JWT_REFRESH_SECRET']
    })
})
```

**Every secret has to be a different value.** Which secret verifies a token is the only thing that
tells an access token from a refresh token. Give both the same value and a refresh token — 30 days,
meant to be spent once — verifies as a bearer credential for its whole life. The strategy refuses to
start when any two of the configured secrets match.

#### Replacing a secret
A secret is replaced by moving the old one aside rather than overwriting it:

```ts
// an unset variable is not a secret, so it is left out rather than passed on as undefined
function previous(key: string): string[] {
    const value: string | undefined = process.env[key];
    return value == undefined ? [] : [value];
}

const rotatingSecrets = (): JwtAuthOptionsInput => ({
    accessTokenSecret: process.env['JWT_ACCESS_SECRET'],
    previousAccessTokenSecrets: previous('JWT_PREVIOUS_ACCESS_SECRET'),
    refreshTokenSecret: process.env['JWT_REFRESH_SECRET'],
    previousRefreshTokenSecrets: previous('JWT_PREVIOUS_REFRESH_SECRET')
});
```

New tokens are always signed with the current secret. A previous one only ever verifies, so tokens
issued before the change keep working until they expire and nobody is logged out by a rotation. It
matters most for the refresh secret, which is a live login: replacing it without a window signs out
everyone who is not holding a valid access token at that moment.

**Drop a previous secret once it is older than the lifetime of the tokens it signed** — an hour for
access tokens, 30 days for refresh tokens by default. Until then it is a second key that can mint
nothing but still verifies everything it ever signed, which is exactly as long as you want it to
exist and no longer.

Secrets are symmetric throughout: there is no asymmetric signing, no JWKS and no `kid`, so a verifier
has to hold the same secret that signs.

### What a credential is worth
Checks are decided on the account as it is right now, not on what the credential said when it was
issued. Delete a user or take a role away and the next request is refused, rather than the first one
after their token happens to expire.

That costs a lookup per request. A deployment that would rather not pay it can say so:

```ts
defineProvider({ token: ZIBRI_DI_TOKENS.REVALIDATE_USER_ON_AUTH_CHECK, useFactory: () => false })
```

Then a strategy that can name its caller from the request alone — `JwtAuthStrategy` can, from the
token payload — answers checks without reading anything. **The trade is real: revocation then takes
until the access token expires**, so shorten `accessTokenExpiresInMs` to whatever window you are
willing to give a terminated account. Strategies that cannot answer without a lookup ignore the
setting and stay authoritative, and `@CurrentUser` always gives you the stored user either way.

### How often a caller may try
The builtin auth endpoints — login, the three password reset routes — are rate limited **per
caller**, sharing one budget of 20 attempts per 10 minutes. A person who mistypes a password twice
and then asks for a reset stays well inside it; unlimited attempts would make the login endpoint both
a way in and a way to keep the event loop busy, since checking a password runs a deliberately slow
hash. Exceeding it answers `429`.

Tune the numbers without replacing anything:

```ts
defineProvider({
    token: ZIBRI_DI_TOKENS.AUTH_RATE_LIMIT_OPTIONS,
    useFactory: () => ({ maxAttempts: 20, windowInMs: Ms.MINUTE * 15 })
})
```

**The default limiter keeps its counts in memory, so the limit is per instance** — three replicas
allow three times as much. That is the honest default: sharing the counts means a round trip on the
login path and a data source that has to be up for anyone to log in at all. If you want an exact
limit across a deployment, replace the limiter itself with one built on `RepositoryRateLimiterStore`:

```ts
defineProvider({ token: ZIBRI_DI_TOKENS.AUTH_RATE_LIMITER, useClass: MySharedAuthRateLimiter })
```

See [rate limiting](./rate-limiting.md), and note that a per caller limit is only as good as the
client address — behind a proxy, set `security.trustProxy`.

### What gets recorded
Auth failures answer with an `ExternalError`, and the error handler does not log those — a 401 is the
api working, not breaking. So the auth subsystem records its own trail through
[`logger.audit`](./logging.md#the-audit-trail):

| `action` | `outcome` | Carries |
|---|---|---|
| `auth.login` | success / failure | `subject` (the email as submitted), `userId` on success |
| `auth.refresh-login` | success / failure | `userId` on success, `reason: token-reused` when a spent credential comes back |
| `auth.logout` | success / failure | — |
| `auth.password-reset.requested` | success / failure | `subject`, `userId` when a reset actually went out |
| `auth.password-reset.confirmed` | success / failure | — |
| `auth.2fa` | failure | `userId` |
| `authz.check` | failure | `userId`, and which check said no |

Three of these are worth a note.

**Failed logins record the address that was tried**, in the clear. One client against many accounts
and many clients against one account are different attacks and neither is visible without it. A
recorded subject says what was submitted, not that the account exists.

**Password reset requests are recorded even though the endpoint tells the caller nothing.** The reply
is the same whether or not the address is known, on purpose — which leaves the trail as the only
place that says an address was asked about at all. An address nobody holds is recorded as
`failure` / `no-such-subject`: nothing was reset, and a run of those against a list of addresses is
what probing for accounts looks like from the inside.

**`reason` separates refused from broken.** A user store that is down refuses every login exactly the
way a wrong password does. `refused` means the credential was rejected; `error` means something
failed while deciding, and a trail that cannot tell them apart reads an outage as an attack.

The events come from `AuthService`, not from the strategies, so a custom auth strategy is audited
without having to remember to be. Two things it cannot know for you: `subject` is read from an
`email` field on the credentials, so a strategy that names its users some other way records none
rather than a wrong one, and reuse of a spent refresh credential is only visible inside the strategy
that detects it — throw `CredentialReusedError` and it is recorded as `token-reused` while the
response stays an ordinary 401.

### How long a login lasts
Two credentials, with two different jobs:

| Token | Default | Where to set it |
|---|---|---|
| Access token | 1 hour | `accessTokenExpiresInMs` on `JWT_AUTH_OPTIONS_INPUT` |
| Refresh token | 30 days | `refreshTokenExpiresInMs` on `JWT_AUTH_OPTIONS_INPUT` |
| Cookie session | 1 day | `COOKIE_AUTH_SESSION_EXPIRES_IN_MS` |
| Cookie refresh session | 30 days | `COOKIE_AUTH_REFRESH_SESSION_EXPIRES_IN_MS` |
| Password reset token | 5 minutes | `PASSWORD_RESET_TOKEN_EXPIRES_IN_MS` |

The refresh credential is the one worth thinking about: it is a live login for its whole lifetime, so
its length is how long a stolen one is worth stealing. 30 days is the usual "stay signed in" window —
shorten it for anything administrative:

```ts
defineProvider({
    token: ZIBRI_DI_TOKENS.JWT_AUTH_OPTIONS_INPUT,
    useFactory: (): JwtAuthOptionsInput => ({ ...secrets, refreshTokenExpiresInMs: Ms.DAY * 7 })
})
```

Shortening the **access** token instead is what limits the damage of a revoked account still being
able to act — see [what a credential is worth](#what-a-credential-is-worth).

### Asking for a password reset
`POST /auth/request-password-reset` answers the same way whatever you send it: an address that exists,
one that does not, and one that already has a reset in flight are indistinguishable. That is
deliberate — the route is unauthenticated, so anything that told the three apart would turn it into a
way to ask whether somebody holds an account here.

Two consequences worth knowing before you build a UI on it:

- **A success does not mean an email was sent.** Say "if that address is registered, check your
  inbox" rather than "we sent you an email".
- **While a reset token is still live, asking again does nothing.** The account already has a usable
  link in its inbox, and mailing a second one on demand would make the endpoint a way to fill
  somebody's mailbox. Tokens last 5 minutes by default.

### Creating and registering user models
Another crucial part of the auth system are users. They need to contain at least an email and an array of roles. A password is actually not required, as some strategies might use third party providers like google etc.

Zibri provides a helper class you can easily extend from:

```ts
// src/models/user.model.ts
import { Entity, Property, BaseUserEntity } from 'zibri';

import { Company } from './company.model';
import { Roles } from './roles.enum';

@Entity()
export class User extends BaseUserEntity(Roles) {
    // your custom properties that your users should have
}
```

For the builtin user service you now also need to register a user repository, so that a user can be found by email over multiple data source entities (used eg. by the default JwtAuthStrategy):

```ts
// src/repositories/user.repository.ts
import { getDefaultBeforeReturnHook, getDefaultBeforeSaveHook, Inject, inject, InjectRepository, JwtCredentials, LoggerInterface, Repository, repositoryTokenFor, UserRepo, UserRepositoryInterface, ZIBRI_DI_TOKENS } from 'zibri';

import { UserCreateData } from '../models';

// The whole "extends Repository<User, UserCreateData>" is not required, but in most cases it makes a lot of sense
@UserRepo()
export class UserRepository extends Repository<User, UserCreateData>
    implements UserRepositoryInterface<Roles, User, JwtCredentials> {

    constructor(
        @InjectRepository(User)
        repo: Repository<User>,
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        logger: LoggerInterface
    ) {
        super(User, repo, logger, repo.dataSource, getDefaultBeforeSaveHook(), getDefaultBeforeReturnHook());
    }

    async findByEmail(email: string): Promise<User> {
        return await this.findOne({ where: { email } });
    }

    async resolveCredentialsFor(user: User): Promise<JwtCredentials> {
        const repo: Repository<JwtCredentials> = inject(repositoryTokenFor(JwtCredentials));
        return repo.findOne({ where: { userId: user.id } });
    }
}
```

## See also
- [Two factor](./two-factor.md) — requiring a second factor on sensitive operations
- [Creating endpoints](./creating-endpoints.md#securing-endpoints) — securing endpoints with the `@Auth` decorators
- [Data sources](./data-source.md) — repositories and entities used by the user model
- [Error handling](./error-handling.md) — errors thrown by the auth system
