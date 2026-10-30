# Authentication and authorization
Logging users in, and deciding what each request may do. An [authenticator](./glossary.md#authenticator) checks who someone is, such as by email and password. An [auth strategy](./glossary.md#auth-strategy) carries the login from one request to the next, such as in a bearer token. The `@Auth` decorators guard your routes with the user the strategy resolves.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `BaseUserEntity`, `BaseUser` | function, type | The base class your user entity extends, and what every user has: an email, their platform roles and when they were deactivated. Extends `BaseEntity`, or the `SoftDeleteEntity` or `ChangeSetEntity` it is given |
| `SoftDeletingUserEntityOptions` | type | What `BaseUserEntity(SoftDeleteEntity, options)` asks: `deletedUserKeepsEmail`, whether a soft deleted user keeps their email taken. Required |
| `BaseUserRepository`, `UserRepositoryInterface` | function, interface | The base class the repository of your user entity extends, and what the framework reads and writes users through |
| `UserRepositoryClass`, `isUserRepository` | type, function | The class `BaseUserRepository` answers, and tells a user repository apart |
| `USER_ENTITY`, `USER_REPOSITORY` | constant | Mark an entity and a repository as the ones of users. `BaseUserEntity` and `BaseUserRepository` set them |
| `isBaseUser` | function | Tells a user apart: a value with an `id`, an `email` and `roles` |
| `UserService`, `UserServiceInterface`, `isUserService` | class, interface, function | Finds users by id and by email, and changes their deactivation and roles. Replaceable through `ZIBRI_DI_TOKENS.USER_SERVICE` |
| `FindUserOptions` | type | Whether looking a user up requires one to be found |
| `UserAccount` | type | A user without their roles: what a stored user and the [`CurrentUser`](./roles-and-permissions.md#in-your-own-code) of a request have in common, and what the two factor methods take |
| `AuthService`, `AuthServiceInterface` | class, interface | Manages the registered auth strategies and authenticators, logs users in and runs the auth checks. Replaceable through `ZIBRI_DI_TOKENS.AUTH_SERVICE` |
| `RouteAuthService`, `RouteAuthServiceInterface` | class, interface | Resolves what the `@Auth` decorators of a route and the `auth` of a manually registered route require, the application's `defaultAuth` included, while the routes are registered. Replaceable through `ZIBRI_DI_TOKENS.ROUTE_AUTH_SERVICE` |
| `AuthenticatorInterface` | interface | Contract for proving who someone is, such as by password |
| `isAuthenticator`, `Authenticators` | function, type | Tells an authenticator apart, and a list of authenticator classes |
| `IdentityLinkingAuthenticatorInterface` | interface | Contract for an authenticator whose users log in with an identity they have somewhere else, linked to them. See [connecting a provider](./login-through-a-provider.md#connecting-a-provider-to-an-account) |
| `IdentityLinkingAuthenticators` | type | A list of such authenticator classes |
| `isIdentityLinkingAuthenticator` | function | Tells an authenticator linking identities to users apart |
| `FederatedAuthenticatorInterface` | interface | Contract for an authenticator that logs users in at a provider. See [routes of your own](./login-through-a-provider.md#routes-of-your-own) |
| `LinkedIdentity` | class | An identity linked to a user, with the name of the authenticator it is linked through |
| `ProviderAccessAuthenticatorInterface` | interface | Contract for an authenticator that keeps a provider's tokens, so its apis can be called for a user. See [calling a provider's apis](./login-through-a-provider.md#calling-a-providers-apis) |
| `isProviderAccessAuthenticator` | function | Tells an authenticator keeping a provider's tokens apart |
| `RefreshResolvingAuthenticatorInterface`, `isRefreshResolvingAuthenticator` | interface, function | Contract for an authenticator that has a say in every refresh of a login, such as a [directory](./login-through-a-directory.md#a-disabled-entry), and tells one apart |
| `AuthController` | function | Defines the routes a client logs in, refreshes, logs out, resets a password and enrolls a [second factor](./glossary.md#second-factor) with. See [the auth routes](./auth-routes.md) |
| `PasswordAuthenticator` | class | Builtin authenticator checking an email and password, used by default. Also resets a forgotten password |
| `PasskeyAuthenticator` | class | Builtin authenticator logging users in with a [passkey](./glossary.md#passkey). See [passkeys](./passkeys.md) |
| `BaseLdapAuthenticator`, `BaseActiveDirectoryAuthenticator` | class | Authenticators to extend, checking a password against a directory. See [login through a directory](./login-through-a-directory.md) |
| `PasswordCredentials` | class | Entity storing the passwords `PasswordAuthenticator` checks |
| `PasswordCredentialsCreateData` | class | What a password is stored with: the user's id and the password, hashed as it is stored |
| `PasswordCredentialsDto` | class | What a login with a password takes: the email and the password |
| `PasswordResetToken` | entity | A token confirming a password reset. Kept hashed |
| `RequestPasswordResetData` | type | What mailing a user a reset link takes: the user, overrides for the email, and the transaction |
| `ConfirmPasswordResetData` | class | What confirming a reset takes: the token from the link, the new password, and the transaction |
| `PasswordResetEmailTemplate`, `PasswordResetEmailTemplateProps` | type, type | The email a reset link is sent in, via `ZIBRI_DI_TOKENS.PASSWORD_RESET_EMAIL_TEMPLATE`, and what it renders: the link and the user |
| `PasswordFailureLimit` | type | The `passwordFailureLimit` app option: how many wrong passwords in a row [lock an account](#locking-an-account-after-too-many-wrong-passwords), and for how long. Defaults to `false` |
| `PasswordFailureStreak` | entity | A user's wrong passwords in a row, and until when they lock the account |
| `Authentication` | type | Who an authenticator authenticated, and when |
| `DefaultAuth` | type | What a route with no `@Auth` decorator requires. Set on the application options, no default |
| `IsLoggedInFn`, `IsNotLoggedInFn` | interface, interface | The types of `@Auth.isLoggedIn` and `@Auth.isNotLoggedIn`, with their `skip` |
| `IsLoggedInMetadata`, `IsNotLoggedInMetadata`, `SkipAuthMetadata` | type, type, type | What `@Auth.isLoggedIn`, `@Auth.isNotLoggedIn` and `@Auth.skip` declare: the strategies allowed, and whether a skip with nothing to skip is allowed |
| `ResolvedAuthMetadata`, `ResolvedRouteAuth` | type, type | The checks the `@Auth` decorators of a route and its controller resolve to, and whether the route requires a login once `defaultAuth` applies |
| `RouteAuthConfiguration` | type | The checks of a [manually registered route](#protecting-manually-registered-routes), with `skip` for one reachable without a login |
| `AccountDeactivatedError` | class | What a login of a [deactivated user](#deactivating-a-user) is refused with |
| `AuthStrategyInterface` | interface | Contract for saying who a request is from |
| `ClaimedUser` | type | Who a credential says its caller is, by `id` and `roles`, as `resolveClaimedUser` of a strategy answers it, see [what a credential is worth](#what-a-credential-is-worth) |
| `LoginAuthStrategyInterface` | interface | Contract for an auth strategy that also starts, refreshes and ends logins |
| `isAuthStrategy`, `isLoginAuthStrategy`, `AuthStrategies` | function, function, type | Tell an auth strategy and one carrying logins apart, and a list of auth strategy classes |
| `EndedLogin` | type | A login a strategy ended: whose it was, and the session at a provider it started from |
| `CredentialLimits` | type | What the credential of a request may do beyond being its user, such as an [api key](./api-keys.md): the permissions it may use and the [tenant](./glossary.md#tenant) it is bound to |
| `CredentialEntity` | type | An entity the credentials of a strategy are checked against, and whether removing or inserting one of its rows ends a credential, see [writing a strategy of your own](#writing-a-strategy-of-your-own) |
| `TokenIntrospectingAuthStrategyInterface`, `ClientAccessTokenIssuingAuthStrategyInterface`, `ClientCertificateAuthStrategyInterface` | interface | What a strategy can do besides saying who a request is from, see [what a strategy can do](#what-a-strategy-can-do) |
| `JwtAuthStrategy` | class | Builtin auth strategy sending a Bearer token, used by default |
| `JwtAuthData` | class | What a JWT login and its refresh answer: the access and refresh token, the user's id and their roles |
| `JwtRefreshToken` | entity | A refresh token of a JWT login. Kept hashed |
| `JwtRefreshLoginData`, `JwtRefreshLoginDto` | class, class | What refreshing a JWT login takes: the refresh token and the transaction, and the body a refresh and a logout are sent with |
| `Jwt` | class | A token and when it expires |
| `JwtAccessTokenPayload`, `isJwtAccessTokenPayload` | type, function | What an access token says about its user, their `id` and `roles` and nothing personal such as the email, and tells a verified payload of that shape apart |
| `CookieAuthStrategy` | class | Builtin auth strategy keeping a login in session cookies, with a [CSRF token](#sending-the-csrf-token) |
| `CookieAuthData` | class | What a cookie login and its refresh answer: the user's id and roles, the CSRF token, and when the session and the refresh session expire |
| `CookieAuthRefreshLoginData`, `CookieAuthRefreshLoginDto` | class, class | What refreshing a cookie login takes, the transaction, and the empty body a refresh is sent with, since the cookies carry the login |
| `CookieAuthLogoutData`, `CookieAuthLogoutDto` | class, class | What ending a cookie login takes, whether to clear the cookies and the transaction, and the body a logout is sent with |
| `CookieAuthSessionOptionsInput` | type | The name and the attributes of a session cookie, such as `sameSite` and `secure`, via `ZIBRI_DI_TOKENS.COOKIE_AUTH_SESSION_OPTIONS` and `ZIBRI_DI_TOKENS.COOKIE_AUTH_REFRESH_SESSION_OPTIONS` |
| `CookieAuthSession`, `CookieAuthRefreshSession` | entity | A session and a refresh session of a cookie login. Kept hashed |
| `ApiKeyAuthStrategy` | class | Builtin auth strategy reading an api key of a user. See [api keys](./api-keys.md) |
| `BaseClientCertificateAuthStrategy` | class | Auth strategy reading the client certificate a proxy forwards. See [client certificates](./client-certificates.md) |
| `ClientAccessTokenAuthStrategy` | class | Builtin auth strategy reading the access tokens the authorization server issues to clients. See [issuing tokens to services](./authorization-server.md) |
| `ProviderTokenAuthStrategy` | class | Builtin auth strategy reading the tokens your identity providers issue. See [accepting a provider's tokens](./provider-tokens.md) |
| `AuthorizationServerController` | function | Defines the routes issuing, introspecting and revoking tokens. See [issuing tokens to services](./authorization-server.md) |
| `ZIBRI_DI_TOKENS.ACCESS_TOKEN_REVOCATION` | DI token | When an access token stops working once its login has ended. Defaults to `'onExpiry'`, see [what a credential is worth](#what-a-credential-is-worth) |
| `JwtAuthOptionsInput` | type | Keys, secrets, lifetimes and `requireDpop` for the jwt strategy, via `ZIBRI_DI_TOKENS.JWT_AUTH_OPTIONS_INPUT` |
| `JwtAuthOptions` | type | The options the jwt strategy runs with, as `ZIBRI_DI_TOKENS.JWT_AUTH_OPTIONS` holds them |
| `ZIBRI_DI_TOKENS.JWT_SERVICE`, `JwtServiceInterface` | DI token, interface | The service signing and verifying access tokens with the access token key, replaceable |
| `JwtService` | class | Signs and verifies access tokens. Replaceable through `ZIBRI_DI_TOKENS.JWT_SERVICE` |
| `MissingJwtSecretError` | error | Thrown at startup when the access token key or the refresh token secret is not configured |
| `JwtSignOptions`, `JwtVerifyOptions`, `VerifiedJwt` | type, type, type | What a token is signed with besides its payload and key, what it has to say to verify, and a verified token: its payload, when it was issued and expires, and its audience |
| `JwtKey` | type | A key a token is signed or verified with, and the one algorithm a token checked against it may name |
| `ZIBRI_DI_TOKENS.API_KEY_SERVICE`, `ApiKeyServiceInterface` | DI token, interface | The service keeping api keys, replaceable. See [api keys](./api-keys.md) |
| `ZIBRI_DI_TOKENS.DPOP_NONCES` | DI token | Whether [DPoP](./glossary.md#dpop) proofs carry a nonce your application issued. Defaults to `false`, see [binding tokens to a key](./dpop.md) |
| `JwtConfirmation`, `isJwtConfirmation` | type, function | What a token is bound to, a client certificate or a DPoP key, and tells one apart. See [binding tokens to a key](./dpop.md) |
| `JwtAsymmetricKey` | type | A key pair to sign access tokens with, in place of a shared secret |
| `JwtAsymmetricAlgorithm` | type | The algorithms a key pair signs with: `'ES256'`, `'ES384'`, `'ES512'`, `'EdDSA'` and `'RS256'` |
| `JwksController`, `isJwksControllerClass` | class, function | Publishes the public keys access tokens are signed with at `/.well-known/jwks.json`, and tells it and the classes extending it apart |
| `Jwks`, `Jwk` | class, class | What `/.well-known/jwks.json` answers: the public keys, each as a JSON Web Key |
| `UserRepositoryInterface` | interface | Contract for finding a user by email and resolving their credentials |
| `ZIBRI_DI_TOKENS.REVALIDATE_USER_ON_AUTH_CHECK` | DI token | Whether checks read the account or trust the credential. Defaults to reading |
| `ZIBRI_DI_TOKENS.MAX_LOGINS_PER_USER` | DI token | How many logins a user holds at most, see [where a user is logged in](#where-a-user-is-logged-in). Defaults to no limit |
| `AuthRateLimiter` | class | What limits the builtin auth endpoints. Replaceable through `ZIBRI_DI_TOKENS.AUTH_RATE_LIMITER` |
| `AuthRateLimitOptions` | type | How many attempts per caller, over how long |
| `PASSWORD_MAX_LENGTH` | constant | The longest password the builtin auth endpoints accept: 1024 characters |
| `repositoryTokenFor` | function | Resolves the DI token for a given entity's repository |

## Registering strategies and authenticators
The auth system has two parts.

An **authenticator** proves who someone is. `PasswordAuthenticator` checks an email and a password, and resets a forgotten password by email. A user can also [log in through a provider](./login-through-a-provider.md) such as Google or your company's Keycloak, [through a directory](./login-through-a-directory.md) such as Active Directory, or [with a passkey](./passkeys.md).

An **auth strategy** says who a request is from. `JwtAuthStrategy` and `CookieAuthStrategy` carry a login from one request to the next. They
- resolve the user of a request
- start a login for a user an authenticator has authenticated
- refresh and end logins

`ApiKeyAuthStrategy` resolves the user of a request from an [api key](./api-keys.md) instead, `BaseClientCertificateAuthStrategy` from a [client certificate](./client-certificates.md), `ClientAccessTokenAuthStrategy` from an access token [issued to a service](./authorization-server.md), and `ProviderTokenAuthStrategy` from a token [your identity provider issued](./provider-tokens.md). None of them starts logins. `JwtAuthStrategy` takes only the access tokens of logins, so `@Auth.isLoggedIn([JwtAuthStrategy])` keeps a route to people. A route naming a strategy also takes the registered strategies extending it.

### What a strategy can do
A strategy can do more than say who a request is from. Each of these abilities is an interface, with a function telling a strategy that implements it apart. `AuthService.resolveStrategies` answers the registered strategies that implement one:

| Interface | What the strategy does | Asked by | Builtin |
|---|---|---|---|
| `LoginAuthStrategyInterface` | Starts, refreshes and ends logins | `AuthService.login` and the login routes | `JwtAuthStrategy`, `CookieAuthStrategy` |
| `TokenIntrospectingAuthStrategyInterface` | Answers whether a token of its own is active, and revokes it | `/introspect` and `/revoke` of the [authorization server](./authorization-server.md) | `JwtAuthStrategy`, `ApiKeyAuthStrategy`, `ClientAccessTokenAuthStrategy` |
| `ClientAccessTokenIssuingAuthStrategyInterface` | Issues the access tokens of clients | `/token` of the authorization server | `ClientAccessTokenAuthStrategy` |
| `ClientCertificateAuthStrategyInterface` | Reads the client certificate of a request | Clients authenticating with a certificate, and bound tokens | `BaseClientCertificateAuthStrategy` |

```ts
// src/services/certificate-readers.function.ts
import { AuthServiceInterface, BaseUser, ClientCertificateAuthStrategyInterface, inject, isClientCertificateAuthStrategy, ZIBRI_DI_TOKENS } from 'zibri';

export function findCertificateReaders(): ClientCertificateAuthStrategyInterface<string, BaseUser<string>>[] {
    const authService: AuthServiceInterface = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
    return authService.resolveStrategies(isClientCertificateAuthStrategy);
}
```

Any authenticator can start a login of any strategy that carries logins: the [auth routes](./auth-routes.md) check a password and start a jwt or a cookie login with it. You register both on the application options, and give them to the auth routes. By default `PasswordAuthenticator` and `JwtAuthStrategy` are used:

```ts
// src/application-options.ts
import { JwtAuthStrategy, PasswordAuthenticator, ZibriApplicationOptions } from 'zibri';

export const authOptions: Pick<ZibriApplicationOptions, 'authenticators' | 'authStrategies'> = {
    authenticators: [PasswordAuthenticator],
    authStrategies: [JwtAuthStrategy]
};
```

A password reset ends every login of the user, in every registered strategy, and keeps their api keys. Every login goes through an authenticator, so the credentials of a login are typed by the authenticator and its answer by the strategy:

```ts
// src/services/log-in.function.ts
import { AuthServiceInterface, JwtAuthData, JwtAuthStrategy, PasswordAuthenticator, PasswordCredentialsDto } from 'zibri';

export async function logIn(authService: AuthServiceInterface, credentials: PasswordCredentialsDto): Promise<JwtAuthData<string>> {
    return await authService.login(PasswordAuthenticator, JwtAuthStrategy, credentials, undefined);
}
```

## Writing a strategy of your own
`AuthService` runs every check against the registered strategies. A route asking for a login passes with a user from any of them: a bearer token of `JwtAuthStrategy`, a session cookie of `CookieAuthStrategy`, or a strategy of your own.

A strategy turns a request into a user. The auth service answers every check with that user: whether they are logged in, hold a permission or own the resource. A strategy you write implements:

| Member | What it answers |
|---|---|
| `hasCredential` | Whether the request carries its kind of credential, see [one credential per request](#one-credential-per-request) |
| `resolveUser` | The user of the request |
| `resolveAuthenticatedAt` | When its user logged in, which a route accepting a [recent login](./two-factor.md#accepting-a-recent-login-instead) reads. `undefined` when the strategy cannot say |
| `resolveExpiresAt` | When its credential stops being accepted, read when a [websocket connection](./websocket.md#logins) made with it is checked again. `undefined` for a credential that does not expire |
| `resolveProviderAuthentication` | For logins at a provider: how the user proved who they are there, which a route [counting the provider's second factor](./two-factor.md#accepting-the-providers-second-factor) reads |
| `credentialEntities` | The entities its credentials are checked against, such as the sessions of its logins, each with the write that ends a credential: `'remove'` for a row a login lives in, `'insert'` for a row revoking one. Each row has the `userId` of its user. `[]` for a strategy that stores nothing |

Once a write ending such a row commits, the [websocket connections](./websocket.md#logins) of its user are checked again, however the row was written. A strategy whose logins live outside a data source calls `disconnectEndedLogins` on the websocket service with the user and the transaction where it ends one.

A strategy that starts logins implements `LoginAuthStrategyInterface`, which adds starting, refreshing and ending them. Before a refresh rotates anything, it hands the user to `AuthService.resolveRefreshUser` with the transaction, and continues the login as the user it answers. An authenticator such as a [directory](./login-through-a-directory.md#a-disabled-entry) may update the user there, or refuse the refresh.

The user is resolved once per request, however many checks a route carries, and `@CurrentUser` shares that lookup. A `@CurrentUser` naming a narrower set of strategies than the checks is resolved on its own, so a credential it excludes never fills it.

## What an undecorated route requires
Every application says what a route carrying no `@Auth` decorator gets. `defaultAuth` has no default, see [why some options have no default](./faq.md#why-do-some-options-have-no-default):

```ts
// src/index.ts
import { ZibriApplication } from 'zibri';

import { applicationOptions } from './application-options';

const app: ZibriApplication = new ZibriApplication({
    ...applicationOptions,
    defaultAuth: 'isLoggedIn'
});
```

`'public'` lets such a route through unauthenticated. `'isLoggedIn'` refuses it to anyone who is not logged in, so a forgotten decorator answers `401` instead of opening the endpoint to everyone.

Under `'isLoggedIn'`, a public route says so with `@Auth.skip()`, on the route or on the whole controller:

```ts
// src/controllers/status.controller.ts
import { Auth, Controller, Get } from 'zibri';

@Auth.skip()
@Controller('/status')
export class StatusController {
    @Get('/health')
    async health(): Promise<unknown> {
        return { ok: true };
    }
}
```

`@Auth.isLoggedIn.skip()` opts out of it too.

The generated OpenAPI spec documents a route protected only by the default as requiring authentication, and only the routes that opted out as public.

Under `'public'`, a bare `@Auth.skip()` has nothing to skip, and the application logs a warning for it. A controller shipped in a library cannot know which default the application picked, so it states its own posture with `@Auth.skip({ allowRedundant: true })`, which logs nothing. The builtin auth controllers use it.

A route, and a controller, carries either `@Auth.skip()` or checks. A check never sits beside its own skip either, such as `@Auth.hasPermission(…)` above `@Auth.hasPermission.skip()`.

## Protecting manually registered routes

A route registered directly on the router with `registerRoute` is covered by the same default. It carries no decorators, so it states its posture as data instead:

```ts
// src/routes/status.route.ts
import { HttpMethod, inject, ZIBRI_DI_TOKENS } from 'zibri';

inject(ZIBRI_DI_TOKENS.ROUTER).registerRoute({
    httpMethod: HttpMethod.GET,
    route: '/status',
    auth: { skip: true },
    handler: () => 'ok'
});
```

Without `auth`, `defaultAuth` decides, as on an undecorated controller route. `auth` takes `isLoggedIn`, `isNotLoggedIn`, `hasPermission`, `hasPlatformPermission` and `require2fa`, the metadata the matching decorators produce. It also takes `skip`, which is `@Auth.skip()` for a route that has no method to put it on. The same checks run in the same order and answer with the same statuses as on a decorated route, and the OpenAPI spec documents the route the same way.

Files in `assets/public` are served at `/assets` to anyone, whatever `defaultAuth` says, since a login page needs its stylesheet before there is a login. Put anything a login should gate behind a route.

The OpenAPI explorer and its documents answer anonymously by default, whatever `defaultAuth` says, see [restricting the explorer](./open-api.md#restricting-the-explorer).

## What a refusal answers
A refused request gets a `401` when the caller could not be identified, and a `403` when they could and the answer is still no:

| Check | Status | Meaning |
|---|---|---|
| `@Auth.isLoggedIn` / the `'isLoggedIn'` default | `401` | nobody was resolved, so a credential is missing |
| a request for a [tenant](./tenancy.md#the-tenant-of-a-request) | `403` | the caller is known and is no member of the tenant |
| `@Auth.hasPermission` / `@Auth.hasPlatformPermission` | `403` | the caller is known and none of their roles carries the [permission](./roles-and-permissions.md) |
| `@Auth.isNotLoggedIn` | `403` | the caller is known, and that is the reason it is refused |
| `@Auth.require2fa` | `401` | a second factor is a further credential the caller can still present |

Clients act on the difference. HTTP clients and SPA auth libraries read a `401` as a stale credential to refresh and retry, and a `403` as a final answer.

Row level restrictions are not route checks. An entity that declares a `scope` narrows every query on it to the rows the caller may see. A row outside that answers `404`, the same as a row that does not exist, so a guarded route does not reveal which ids exist. A scope may also refuse the request outright, with whatever it throws. See [restricting which rows a caller may see](./data-source.md#restricting-which-rows-a-caller-may-see).

`@Auth.require2fa` answers `401` because the caller still has a second factor to present. This is the reading [RFC 9470](https://www.rfc-editor.org/rfc/rfc9470.html) gives step-up authentication.

Your own handlers get the same two: throw `UnauthorizedError` or `ForbiddenError` from
[error handling](./error-handling.md).

## One credential per request
`hasCredential` answers whether a request carries your kind of credential at all, such as a header being there or a cookie being set, without looking anything up. It selects the strategy that runs, so only that strategy looks anything up.

Exactly one strategy may claim a request. None means nobody is logged in. More than one is refused with a `401`, before anything is read:

> This request carries more than one credential (jwt, cookie). Send exactly one.

Answer `hasCredential` from presence, never validity. A token that fails to verify still claims the request, so a junk header cannot pair with someone else's cookie and have the cookie win.

## Naming the session cookie
A `Cookie` header may carry the same name more than once, and the browser sends the most specific first: a cookie set on `app.example.com` arrives ahead of one set on `example.com`. The first one is kept, so a cookie set for the parent domain, such as by a sibling subdomain, does not replace yours.

If your api shares a registrable domain with anything you do not control, give the cookie a `__Host-` name. The browser then refuses to set it from a parent domain:

```ts
// src/providers.ts
import { CookieAuthSessionOptionsInput, defineProvider, ZIBRI_DI_TOKENS } from 'zibri';

defineProvider({
    token: ZIBRI_DI_TOKENS.COOKIE_AUTH_SESSION_OPTIONS,
    useFactory: (): CookieAuthSessionOptionsInput => ({ name: '__Host-sessionId', sameSite: 'strict' })
})
```

A `__Host-` cookie has to be `Secure`, `Path=/` and carry no `Domain`, so it works over HTTPS only.

A malformed cookie, such as `Cookie: a=%` with its invalid percent encoding, is not an error: its raw value is used as it stands.

## Setting the session cookie flags
`httpOnly` and `signed` are always on. `sameSite` defaults to `lax`, `path` to `/`. The cookies are signed with the secret of `ZIBRI_DI_TOKENS.COOKIE_SIGN_SECRET`, which `CookieAuthStrategy` requires.

`secure` follows whether the connection was HTTPS: `req.secure`, which honors the forwarded protocol for as many hops as `security.trustProxy` declares. The `X-Forwarded-Proto` header is never read on its own, because the client controls it.

If your api is HTTPS only, set it:

```ts
// src/providers.ts
import { CookieAuthSessionOptionsInput, defineProvider, ZIBRI_DI_TOKENS } from 'zibri';

defineProvider({
    token: ZIBRI_DI_TOKENS.COOKIE_AUTH_SESSION_OPTIONS,
    useFactory: (): CookieAuthSessionOptionsInput => ({ name: 'sessionId', path: '/', sameSite: 'lax', secure: true })
})
```

An explicit `true` always wins, so a missing or wrong `trustProxy` cannot downgrade the cookie to one the browser sends over plain HTTP. `false` turns the flag off. Use it for local development only.

## Sending the CSRF token
The browser attaches your session cookie to every request to your api, including ones another site caused. The CSRF token tells your frontend's requests apart from those. It goes in the `x-csrf-token` header, named by `ZIBRI_DI_TOKENS.CSRF_TOKEN_HEADER`, which another origin cannot set unless your CORS configuration lets it.

The token is checked on unsafe methods only: `GET`, `HEAD` and `OPTIONS` are exempt. It is also checked only on routes that resolve the session.

A request with a valid session and a missing or wrong token counts as no login. On a route that needs a login, it is answered `403` with a `CsrfTokenRefusedError` instead of the `401` for no login, so your frontend reads the current token and retries rather than logging in again. It is recorded as `authz.check` with `reason: csrf`.

`login` and `refresh-login` return the token in the response body. A client holding only the cookies, such as after a page reload, reads the token of its login from [`GET /auth/csrf-token`](./auth-routes.md#the-routes).

Each token belongs to one refresh session. A refresh that rotates the session issues a new one, and the previous one stops being accepted.

The session cookie expires after `COOKIE_AUTH_SESSION_EXPIRES_IN_MS`, a day by default. The next request carrying the refresh cookie renews the session inside that request, whichever route it calls. It answers with new cookies, and with the new token in the `x-csrf-token` response header. A client reads the token off every response and keeps the most recent:

```ts
// src/csrf-token.ts, in the browser
let csrfToken: string | undefined = undefined;

export function rememberCsrfToken(response: Response): void {
    const token: string | null = response.headers.get('x-csrf-token');
    if (token != undefined) {
        csrfToken = token;
    }
}
```

From another origin, naming your origin in the CORS configuration is enough. The `x-csrf-token` header is listed in both `Access-Control-Allow-Headers` and `Access-Control-Expose-Headers`, so the token can be sent and read back.

Routes that never resolve a session do not check the token: every undecorated route under `defaultAuth: 'public'`, and anything carrying `@Auth.skip()` under either setting. On those, and on every other route, a request that changes something and carries cookies is refused when a page on another origin sent it, unless your CORS configuration lets that origin send credentials. See
[app settings](./app-settings.md#what-a-request-from-a-disallowed-origin-does).

## What a jwt has to prove
A token is accepted only when all of this holds:

| Checked | What it ensures |
|---|---|
| Signature, against the key for that kind of token | It came from you and nobody edited it |
| `alg` is the algorithm of that key | The algorithm comes from the key, never from the token |
| Not expired | `exp`, from the lifetimes above |
| `iss` matches your application's `baseUrl` | A token of another application sharing your secret is refused |
| `aud` of an access token is your `baseUrl` | A token issued for [another service](./authorization-server.md#services-receiving-tokens) is refused |
| The `typ` header is `at+jwt` for an access token, `JWT` for a refresh token | One kind of token is never taken as the other |
| The payload has the shape that kind of token carries | An authentic token of the wrong kind is refused |
| A token bound to a DPoP key comes with the `DPoP` scheme and a proof of that key, see [binding tokens to a key](./dpop.md) | A token that leaked without the key is worth nothing |

The issuer is your `baseUrl` from the application options, without a trailing slash, and every access token names it as its audience too. There is nothing to configure.

> [!WARNING]
> Changing `baseUrl` invalidates every token already issued, which logs everybody out. Every replica verifies against its own `baseUrl`, so all of them boot with the same one: the public URL of the deployment. With a URL derived per pod, such as from a hostname or a container id, each replica refuses the tokens of the others, and callers behind a load balancer are logged out at random.

Everything the strategy needs comes from one token, `JWT_AUTH_OPTIONS_INPUT`. The access token key and the refresh token secret have no default, since a shipped default would give every application the same signing key:

```ts
// src/providers.ts
import { defineProvider, JwtAuthOptionsInput, ZIBRI_DI_TOKENS } from 'zibri';

defineProvider({
    token: ZIBRI_DI_TOKENS.JWT_AUTH_OPTIONS_INPUT,
    useFactory: (): JwtAuthOptionsInput => ({
        accessTokenKey: process.env['JWT_ACCESS_SECRET'],
        refreshTokenSecret: process.env['JWT_REFRESH_SECRET']
    })
})
```

`requireDpop`, `false` by default, binds every login to a [DPoP key](./dpop.md) when `true`.

The jwt service, `ZIBRI_DI_TOKENS.JWT_SERVICE`, holds the access token key. It signs and verifies the access tokens of every strategy issuing them, `ClientAccessTokenAuthStrategy` included.

Every key has a different value: the key that verifies a token is what tells an access token from a refresh token.

### Signing with a key pair
A string is a shared secret: every service that verifies your access tokens holds it, and so can also mint them. Give `accessTokenKey` a key pair instead, and a verifier needs only the public key:

```ts
// src/providers.ts
import { readFileSync } from 'node:fs';
import { JwtAsymmetricKey } from 'zibri';

const accessTokenKey: JwtAsymmetricKey = {
    algorithm: 'ES256',
    key: readFileSync('/run/secrets/jwt-access-key.pem', 'utf8')
};
```

`key` is a `KeyObject` or PEM encoded. The one tokens are signed with has to be the private key.

| `algorithm` | Key |
|---|---|
| `ES256` | Elliptic curve, P-256 |
| `ES384` | Elliptic curve, P-384 |
| `ES512` | Elliptic curve, P-521 |
| `EdDSA` | Edwards curve, Ed25519 |
| `RS256` | RSA, at least 2048 bits. For verifiers that accept nothing else |

Only your application verifies refresh tokens, so `refreshTokenSecret` stays a shared secret.

Each token names its key in the `kid` header, the key's RFC 7638 thumbprint. Declare `JwksController` and your public keys are served as a JSON Web Key Set at `/.well-known/jwks.json`, current key first, for any verifier to fetch:

```ts
// src/application-options.ts
import { JwksController } from 'zibri';

import { AppAuthController } from './controllers/auth.controller';

controllers: [AppAuthController, JwksController]
```

`JwksController` requires a key pair among the access token keys. To publish the keys at another path, extend it: `@Controller('/keys', { versions: 'all' })` on a class extending `JwksController` publishes them at `/keys/jwks.json`.

### Replacing a key
Replace a key by moving the old one to the previous keys. An unset variable is left out of them:

```ts
// src/providers.ts
import { JwtAuthOptionsInput } from 'zibri';

function previous(key: string): string[] {
    const value: string | undefined = process.env[key];
    return value == undefined ? [] : [value];
}

const rotatingSecrets = (): JwtAuthOptionsInput => ({
    accessTokenKey: process.env['JWT_ACCESS_SECRET'],
    previousAccessTokenKeys: previous('JWT_PREVIOUS_ACCESS_SECRET'),
    refreshTokenSecret: process.env['JWT_REFRESH_SECRET'],
    previousRefreshTokenSecrets: previous('JWT_PREVIOUS_REFRESH_SECRET')
});
```

New tokens are always signed with the current key. A previous key only verifies, so tokens issued before the change work until they expire, and a rotation logs nobody out.

> [!WARNING]
> Replacing the refresh token secret without keeping the old one in `previousRefreshTokenSecrets` logs out everyone who does not hold a valid access token at that moment.

A previous key pair only verifies, so its public key is enough, and `JwksController` keeps publishing it after the current one. The algorithm can change with the key: moving from a shared secret to a key pair, or from `RS256` to `ES256`, is a rotation like any other.

Drop a previous key once it is older than the lifetime of the tokens it signed: an hour for access tokens, 30 days for refresh tokens by default.

## What a credential is worth
Checks are decided on the account as it is right now, not on what the credential said when it was issued. Delete a user or take a role away, and their next request is refused.

That costs a lookup per request. Turn it off:

```ts
// src/providers.ts
import { defineProvider, ZIBRI_DI_TOKENS } from 'zibri';

defineProvider({ token: ZIBRI_DI_TOKENS.REVALIDATE_USER_ON_AUTH_CHECK, useFactory: () => false })
```

Then a strategy that can name its caller from the request alone, as `JwtAuthStrategy` does from the token payload, answers checks without reading anything. Strategies that cannot answer without a lookup ignore the setting, and `@CurrentUser` always gives you the stored user.

In a [tenant](./glossary.md#tenant), an access token of `JwtAuthStrategy` then carries the roles of the user's [memberships](./glossary.md#membership) as well, by tenant, so a check in a tenant reads no membership either. A role given or taken in a tenant applies to a login at its next refresh, and the token grows with every tenant the user is a member of.

> [!WARNING]
> With `REVALIDATE_USER_ON_AUTH_CHECK` set to `false`, a revoked account keeps working until its access token expires. Shorten `accessTokenExpiresInMs` to the window you accept for a terminated account.

Reading the account does not say whether the login still exists: by default an access token works until it expires, after a logout as well. Set `ACCESS_TOKEN_REVOCATION` to `'immediately'`, and every check of an access token also reads whether its login still exists. A logout, ending the user's logins and a password reset then take its access tokens away at once:

```ts
// src/providers.ts
import { defineProvider, ZIBRI_DI_TOKENS } from 'zibri';

defineProvider({ token: ZIBRI_DI_TOKENS.ACCESS_TOKEN_REVOCATION, useValue: 'immediately' })
```

`'immediately'` requires `REVALIDATE_USER_ON_AUTH_CHECK` to be `true`. It covers the tokens
[issued to services](./authorization-server.md#when-access-tokens-stop-working) too.

> [!WARNING]
> With `ACCESS_TOKEN_REVOCATION` at its default `'onExpiry'`, a logout, a password reset and ending a user's logins leave the access tokens already issued working until they expire, an hour by default. Set it to `'immediately'` where a logout has to end access at once.

## How often a caller may try
The builtin auth endpoints, login and the three password reset routes, are rate limited per caller. They share one budget of 20 attempts per 10 minutes. A caller is an IPv4 address or an IPv6 /64, the block one subscriber holds. A login that succeeds costs nothing of the budget, so the budget counts wrong passwords, whichever accounts they were for. Exceeding it answers `429`.

Tune the numbers without replacing anything:

```ts
// src/providers.ts
import { defineProvider, Ms, RateLimitStoreFailurePolicy, ZIBRI_DI_TOKENS } from 'zibri';

defineProvider({
    token: ZIBRI_DI_TOKENS.AUTH_RATE_LIMIT_OPTIONS,
    useFactory: () => ({
        maxAttempts: 20,
        windowInMs: Ms.MINUTE * 15,
        onStoreFailure: RateLimitStoreFailurePolicy.ALLOW
    })
})
```

The limiter keeps counts for 100 000 callers at once, or `maxKeys`. `onStoreFailure` says what a
caller it has no room for gets: `ALLOW` lets them in and counts it on the limiter's error metric,
`REJECT` answers `503`. It defaults to `ALLOW`.

> [!NOTE]
> The default limiter keeps its counts in memory, so the limit is per instance: three replicas allow three times as much.

For an exact limit across a deployment, replace the limiter with one built on `RepositoryRateLimiterStore`:

```ts
// src/providers.ts
import { defineProvider, ZIBRI_DI_TOKENS } from 'zibri';

import { SharedAuthRateLimiter } from './services/shared-auth-rate-limiter';

defineProvider({ token: ZIBRI_DI_TOKENS.AUTH_RATE_LIMITER, useClass: SharedAuthRateLimiter })
```

See [rate limiting](./rate-limiting.md). A caller is told apart by their address, so behind a proxy, set `security.trustProxy`.

## Locking an account after too many wrong passwords
With `passwordFailureLimit` in your app options, an account is locked once that many wrong passwords
in a row were presented for it, from wherever they came:

```ts
// src/application-options.ts
import { Ms, ZibriApplicationOptions } from 'zibri';

export const lockingOptions: Pick<ZibriApplicationOptions, 'passwordFailureLimit'> = {
    passwordFailureLimit: { maxFailures: 10, lockForInMs: Ms.MINUTE * 30 }
};
```

`maxFailures` is a whole number from 1 to 100. `passwordFailureLimit` defaults to `false`, which locks nothing.

Declare `PasswordFailureStreak` in your data source.

While the account is locked, the right password is refused like a wrong one, with `401` and the same
message. The lock passes after `lockForInMs`, and a [confirmed password reset](#asking-for-a-password-reset)
lifts it before then. A correct password ends the streak, so ten wrong ones spread over a year lock
nothing. Every lock is recorded as `auth.password.locked`, and a login refused by one as
`auth.login` with `reason: locked`.

## How long a password may be
Login and confirming a password reset accept passwords of up to `PASSWORD_MAX_LENGTH` (1024)
characters. A longer one answers `400`. Put a lower or the same limit on your own password fields, such as
registration, so that every password a user can set is one they can log in with:

```ts
// src/models/register-data.model.ts
import { PASSWORD_MAX_LENGTH, Property } from 'zibri';

export class RegisterData {
    @Property.string({ format: 'email' })
    email!: string;

    @Property.string({ minLength: 12, maxLength: PASSWORD_MAX_LENGTH })
    password!: string;
}
```

## Deactivating a user
`AuthService.deactivateUser` takes a user's access away and keeps the user: their logins end, their api keys are revoked, and until `reactivateUser` they cannot log in, by password, provider, directory or passkey alike, and no request acts as them. A login of a deactivated user answers `403` with an `AccountDeactivatedError`. A reactivated user logs in again; their api keys stay revoked.

`deactivatedAt` on the user holds when they were deactivated. `BaseUserEntity` declares it, and your user repository writes it in `updateDeactivatedAt`, see [creating and registering user models](#creating-and-registering-user-models).

With `ZIBRI_DI_TOKENS.REVALIDATE_USER_ON_AUTH_CHECK` set to `false`, an access token handed out before the deactivation works until it expires; it is not refreshed. [Provisioning through SCIM](./scim.md) deactivates the users a tenant's identity provider created and sets inactive.

`AuthService.endAccess` ends a user's logins and revokes their api keys too, but leaves them able to log in again. A [directory](./login-through-a-directory.md#a-disabled-entry) does this to a user whose entry was disabled.

## What gets recorded
Auth failures answer with an `ExternalError`, which the error handler does not log. The auth
subsystem records its own events in the [audit trail](./audit.md) instead:

| `action` | `outcome` | Carries |
|---|---|---|
| `auth.login` | success / failure | `subject` (the email, or the username of a [directory](./login-through-a-directory.md), as submitted), `userId` on success, `reason: credential-cloned` when a [passkey](./passkeys.md#what-gets-recorded) comes from a copied device, `reason: deactivated` for a [deactivated user](#deactivating-a-user), `reason: locked` for a [locked account](#locking-an-account-after-too-many-wrong-passwords) |
| `auth.login.pending` | success | `subject`, `userId`, see [asking for a second factor at login](./two-factor.md#asking-for-a-second-factor-at-login) |
| `auth.refresh-login` | success / failure | `userId` on success, `reason: token-reused` when a spent credential comes back, `reason: deactivated` when the user's [entry in a directory](./login-through-a-directory.md#a-disabled-entry) was disabled |
| `auth.logout` | success / failure | `userId` on success, `reason: refused` when what was presented names no login, `reason: error` when the login could not be ended and is still live |
| `auth.password-reset.requested` | success / failure | `subject`, `userId` when a reset actually went out |
| `auth.password-reset.confirmed` | success / failure | Nothing else |
| `auth.password.locked` | success | `userId`, see [locking an account](#locking-an-account-after-too-many-wrong-passwords) |
| `auth.password.changed` | success / failure | `userId`, `reason: refused` for a wrong current password, see [changing a password](#changing-a-password) |
| `auth.login.ended`, `auth.logins.ended` | success / failure | `userId`, for one login and for every login a user ended, see [where a user is logged in](#where-a-user-is-logged-in) |
| `auth.2fa` | failure | `userId` |
| `auth.2fa.enrolled` | success / failure | `userId`, see [enrolling a user](./two-factor.md#enrolling-a-user) |
| `auth.2fa.removed` | success / failure | `userId` |
| `auth.identity.linked` | success / failure | `userId` on success, see [connecting a provider](./login-through-a-provider.md#connecting-a-provider-to-an-account) |
| `auth.identity.unlinked` | success / failure | `userId` |
| `auth.identity.login-revoked` | success / failure | `userId`, see [logging in and api access apart](./login-through-a-provider.md#logging-in-and-api-access-apart) |
| `auth.provider-access.granted` | success | `userId`, and the `scopes` of the provider's apis, see [calling a provider's apis](./login-through-a-provider.md#calling-a-providers-apis) |
| `auth.provider-access.revoked` | success / failure | `userId`, and the `scopes` on success |
| `auth.api-key.created` | success / failure | `userId`, see [api keys](./api-keys.md) |
| `auth.api-key.revoked` | success / failure | `userId` |
| `auth.token.issued` | success / failure | `subject` (the client id), `userId` on success, see [issuing tokens to services](./authorization-server.md#what-gets-recorded) |
| `auth.token.revoked` | success | `userId` |
| `auth.user.deactivated` | success / failure | `userId`, see [deactivating a user](#deactivating-a-user) |
| `auth.user.reactivated` | success / failure | `userId` |
| `auth.access.ended` | success / failure | `userId`, see [deactivating a user](#deactivating-a-user) |
| `auth.membership.deactivated`, `auth.membership.reactivated`, `auth.membership.deleted` | success / failure | `userId` of the member, in the tenant of the membership, see [members and their roles](./tenancy.md#members-and-their-roles) |
| `authz.check` | failure | `userId`, and which check said no |

A failed login records the submitted address in the clear, so one client trying many accounts and many clients trying one account both show. A recorded subject says what was submitted, not that the account exists.

A password reset request is recorded, although the endpoint tells the caller nothing. An address nobody holds is recorded as `failure` / `no-such-subject`: nothing was reset. A run of those against a list of addresses is someone probing for accounts.

`reason` separates refused from broken. `refused` means the credential was rejected. `error` means something failed while deciding, such as a user store that is down.

The events come from `AuthService`, so a strategy of your own is audited too. For such a strategy:

- `subject` is read from an `email` field on the credentials. A strategy that names its users another way records no subject.
- Reuse of a spent refresh credential is visible only inside the strategy that detects it. Throw `CredentialReusedError`, and it is recorded as `token-reused` while the response stays an ordinary `401`.

## How long a login lasts
The lifetimes, and where to set them:

| Token | Default | Where to set it |
|---|---|---|
| Access token | 1 hour | `accessTokenExpiresInMs` on `JWT_AUTH_OPTIONS_INPUT` |
| Refresh token | 30 days | `refreshTokenExpiresInMs` on `JWT_AUTH_OPTIONS_INPUT` |
| Cookie session | 1 day | `COOKIE_AUTH_SESSION_EXPIRES_IN_MS` |
| Cookie refresh session | 30 days | `COOKIE_AUTH_REFRESH_SESSION_EXPIRES_IN_MS` |
| Password reset token | 5 minutes | `PASSWORD_RESET_TOKEN_EXPIRES_IN_MS` |

A refresh credential is a live login for its whole lifetime, so its length is how long a stolen one stays useful. 30 days is the usual "stay logged in" window. Shorten it for anything administrative:

```ts
// src/providers.ts
import { defineProvider, JwtAuthOptionsInput, Ms, ZIBRI_DI_TOKENS } from 'zibri';

import { secrets } from './secrets';

defineProvider({
    token: ZIBRI_DI_TOKENS.JWT_AUTH_OPTIONS_INPUT,
    useFactory: (): JwtAuthOptionsInput => ({ ...secrets, refreshTokenExpiresInMs: Ms.DAY * 7 })
})
```

Shortening the access token instead limits how long a revoked account can still act, see [what a credential is worth](#what-a-credential-is-worth).

A refresh credential is spent by the refresh that presents it, and the login carries on with the
one that refresh answers. A credential a refresh just spent is still accepted for a grace:
`refreshTokenReuseGraceInMs` on `JWT_AUTH_OPTIONS_INPUT` and
`COOKIE_AUTH_REFRESH_SESSION_REUSE_GRACE_IN_MS`, 30 seconds by default. Within it, every tab
that presents the spent credential gets one of its own in the same login. Past it, presenting a
spent credential ends the login everywhere and is recorded as `token-reused`. `0` accepts no spent
credential.

The stored cookie session and refresh session outlive their cookies by
`COOKIE_AUTH_ROW_GRACE_IN_MS`, five minutes by default, for a client or a replica whose clock runs behind.

## Asking for a password reset
`POST /auth/request-password-reset` answers the same whatever you send it, in what it says and in how long it takes: an address that exists, one that does not, and one that already has a reset in flight are indistinguishable. The route is unauthenticated, so any difference would tell anyone whether an address holds an account. It answers once the address is looked up, and the link and its email are made after that. A shutdown waits for them.

To start a reset from your own code the same way, call `requestPasswordResetForEmail` on `ZIBRI_DI_TOKENS.AUTH_SERVICE` with the address.

## Changing a password
A logged in user changes their password at `POST /auth/change-password`, with `{ "currentPassword", "newPassword" }`. A wrong current password is answered `403`, and counts against the account like a wrong password at a login, see [locking an account](#locking-an-account-after-too-many-wrong-passwords). The route shares the login's [budget](#how-often-a-caller-may-try).

Changing the password ends every other login of the user, in every strategy, and keeps the one asking. In your own code, `changePassword` of `AuthServiceInterface` does the same, given the user's id, the passwords with a transaction, and the request.

## Where a user is logged in
`GET /auth/logins` answers the logins of the user asking, one per device or browser, the most recently used first:

| Field | What it is |
|---|---|
| `id` | What `DELETE /auth/logins/:loginId` ends the login by |
| `strategy` | The strategy carrying the login, such as `jwt` |
| `current` | Whether the request asking carries this login |
| `authenticatedAt` | When the user logged in |
| `lastUsedAt` | When the login started or was last refreshed |
| `expiresAt` | When it ends unless it is refreshed before |
| `userAgent`, `ipAddress` | The client that last used it, as the request that started or refreshed it said. A `User-Agent` is kept to 512 characters |

`POST /auth/logout-everywhere` ends every login of the user, the one asking included. Like a logout, an access token already issued works until it expires, unless [`ACCESS_TOKEN_REVOCATION`](#what-a-credential-is-worth) is `'immediately'`. `findLogins`, `endLogin` and `endOwnLogins` of `AuthServiceInterface` do the same in your own code. `JwtAuthStrategy` and `CookieAuthStrategy` list their logins. A strategy of your own does by implementing `LoginListingAuthStrategyInterface`.

To limit how many logins a user holds, provide `ZIBRI_DI_TOKENS.MAX_LOGINS_PER_USER`. A login starting past the limit ends the user's login used least recently, recorded as `auth.login.ended`:

```ts
// src/providers.ts
import { defineProvider, ZIBRI_DI_TOKENS } from 'zibri';

defineProvider({ token: ZIBRI_DI_TOKENS.MAX_LOGINS_PER_USER, useValue: 5 })
```

For your UI:

- A success does not mean an email was sent. Say "if that address is registered, check your inbox", not that an email went out.
- While a reset token is still live, asking again sends nothing. Tokens last 5 minutes by default.
- While addresses are [verified](./email-verification.md), a reset link goes to a verified address only.

## Creating and registering user models
A user holds at least an email and an array of roles: their own roles, whose permissions `@Auth.hasPlatformPermission` checks, each one [declared](./roles-and-permissions.md) as a platform role. The roles a user holds in a tenant live on their [membership](./tenancy.md#members-and-their-roles) in it. A password is optional, since a user who logs in through a provider has none.

Extend `BaseUserEntity`:

```ts
// src/models/user.model.ts
import { BaseUserEntity, Entity } from 'zibri';

@Entity({ tenant: 'shared' })
export class User extends BaseUserEntity() {
    // your custom properties that your users should have
}
```

Users are read through the repository of the user entity: a user is found by email through it, for example by `JwtAuthStrategy`, and their deactivation and roles are written through it. Extend `BaseUserRepository`, declare it with `@RepositoryFor`, and list it in the `repositories` of the data source, see [writing a repository of your own](./data-source.md#writing-a-repository-of-your-own):

```ts
// src/repositories/user.repository.ts
import { BaseUserRepository, RepositoryFor } from 'zibri';

import { UserCreateData } from '../models';
import { User } from '../models/user.model';

@RepositoryFor(User)
export class UserRepository extends BaseUserRepository<User, UserCreateData>() {}
```

`UserCreateData` is what a user is created with. `BaseUserRepository` implements `UserRepositoryInterface`: `findByEmail`, `updateDeactivatedAt`, which stores when a user was [deactivated](#deactivating-a-user), and `updateRoles`, which stores the [roles](./roles-and-permissions.md#managing-roles) a user is given or loses. Override one to read or write a user differently.

A user entity that [soft deletes](./glossary.md#soft-delete) passes the class it extends to both bases. `deletedUserKeepsEmail` says whether a soft deleted user keeps their email taken, see [unique among only some rows](./data-source.md#unique-among-only-some-rows):

```ts
// src/models/account.model.ts
import { BaseUserEntity, BaseUserRepository, Entity, RepositoryFor, SoftDeleteEntity, SoftDeleteRepository } from 'zibri';

@Entity({ tenant: 'shared' })
export class Account extends BaseUserEntity(SoftDeleteEntity, { deletedUserKeepsEmail: false }) {}

@RepositoryFor(Account)
export class AccountRepository extends BaseUserRepository<Account>(SoftDeleteRepository) {}
```

Deleting a user deletes, in the same transaction, their [memberships](./tenancy.md#members-and-their-roles) and every row auth keeps for them: their password, second factors, passkeys, API keys, identities at providers and directories with the tokens kept for them, their logins and their reset token. A soft deleted user keeps them, and gets them back with a restore. The roles written on a user are checked against the roles of the application.

An authenticator, auth strategy or two factor method of your own that keeps rows per user implements `deleteUserRows(userIds, transaction)`, and is called with every user deleted for good.

`BaseUserEntity` and `BaseUserRepository` mark their classes as the ones of users, with `USER_ENTITY` and `USER_REPOSITORY`. A user entity or user repository of your own declares the mark itself: `static readonly [USER_ENTITY]: true = true` on the entity, and a getter `get [USER_REPOSITORY](): true` on the repository. An application with several user entities lists a user repository for each.

A user logs in with a password once `PasswordCredentials` holds one for them. A registration route creates both in one transaction:

```ts
// src/controllers/register.controller.ts
import { Auth, Body, Controller, inject, PasswordCredentials, PasswordCredentialsCreateData, Post, Repository, repositoryTokenFor, Response, Transaction } from 'zibri';

import { RegisterData } from '../models/register-data.model';
import { Roles } from '../models/roles.enum';
import { User } from '../models/user.model';
import { UserRepository } from '../repositories/user.repository';

@Auth.skip()
@Controller('/users')
export class UserController {

    @Response.empty()
    @Post('/register')
    async register(
        @Body(RegisterData)
        data: RegisterData
    ): Promise<void> {
        const users: UserRepository = inject(UserRepository);
        const credentials: Repository<PasswordCredentials, PasswordCredentialsCreateData> = inject(repositoryTokenFor(PasswordCredentials));
        const transaction: Transaction = await users.dataSource.startTransaction();
        try {
            const user: User = await users.create({ email: data.email, roles: [Roles.USER] }, { transaction });
            await credentials.create({ userId: user.id, password: data.password }, { transaction });
            await transaction.commit();
        }
        catch (error) {
            await transaction.rollback();
            throw error;
        }
    }
}
```

The password is stored hashed.

A user repository that does not hold the user throws a `NotFoundError`, which `findOne` already does for you. Any other http error below 500 counts the same way. Every other error means the repository could not be asked: when no repository found the user and one of them failed like that, a login answers 500 and is audited as an `error` rather than as a refusal.

## Requirements
| Package | Used for |
|---|---|
| `jose` | Signing and verifying JWTs. You install it |

Your data source declares these entities:

| Entity | Needed when |
|---|---|
| `PasswordCredentials`, `PasswordResetToken` | `PasswordAuthenticator` is registered |
| `PasswordFailureStreak` | `PasswordAuthenticator` is registered and `passwordFailureLimit` is not `false` |
| `JwtRefreshToken` | `JwtAuthStrategy` is registered |
| `CookieAuthSession`, `CookieAuthRefreshSession` | `CookieAuthStrategy` is registered |

How large each table grows, and what deletes its rows, is in [framework tables](./framework-tables.md).

## See also
- [The auth routes](./auth-routes.md) — logging in, refreshing, logging out, resetting a password and enrolling a second factor over http
- [Login through a provider](./login-through-a-provider.md) — Google, Microsoft, Keycloak and other OpenID Connect providers, and GitHub and other plain OAuth2 providers
- [Accepting a provider's tokens](./provider-tokens.md) — mobile apps and services calling your api with a token of your identity provider
- [Login through a directory](./login-through-a-directory.md) — Active Directory, OpenLDAP and other LDAP directories
- [Passkeys](./passkeys.md) — logging in with a passkey, and a passkey as the second factor
- [Api keys](./api-keys.md) — scripts, services and integrations calling your api
- [Client certificates](./client-certificates.md) — services calling your api with mutual TLS
- [Issuing tokens to services](./authorization-server.md) — OAuth2 client credentials, introspection and revocation
- [Binding tokens to a key](./dpop.md) — DPoP, logins and tokens that work only beside a proof of the client's key
- [Provisioning through SCIM](./scim.md) — an identity provider creating, changing and deactivating your users
- [Two factor](./two-factor.md) — requiring a second factor on sensitive operations
- [Creating endpoints](./creating-endpoints.md#securing-endpoints) — securing endpoints with the `@Auth` decorators
- [Data sources](./data-source.md) — repositories and entities used by the user model
- [Error handling](./error-handling.md) — errors thrown by the auth system
- [Glossary](./glossary.md) — what authenticator, strategy, credential, identity and login mean
