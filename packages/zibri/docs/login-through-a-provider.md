# Login through a provider
Users log in with an account they already have somewhere else: Google, Apple, Microsoft Entra ID, your company's Keycloak, or any other [OpenID Connect](./glossary.md#openid-connect) provider, GitHub or any other provider that speaks plain OAuth2, and any [SAML](./glossary.md#saml) 2.0 identity provider. It ends in the same JWT or cookie login a password gives, so refreshing, logging out and `@Auth.require2fa` work the same.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `FederatedAuthenticatorInterface`, `isFederatedAuthenticator` | interface, function | What a provider's [authenticator](./glossary.md#authenticator) is to the login routes, and the function telling one apart |
| `FederatedRoute` | type | A route whose URL an authenticator gives out: `callback`, `link-identity`, `logout`, `logout/soap` or `logout/back-channel` |
| `FederatedLogoutTokenForm` | class | The logout token an OpenID Connect provider posts to the back-channel logout route |
| `FederatedRouteEndpoint` | type | One of the `routes` of an authenticator: the route, and the method the browser requests its URL with |
| `FederatedLoginRequest`, `FederatedLoginResult` | type, type | What starting a login at a provider takes, and how the login continues once the provider has answered |
| `FederatedMetadata` | type | A document about your application that the provider is set up with, such as the metadata of a SAML service provider |
| `FederatedProviderLogoutMessage`, `FederatedProviderLogout`, `FederatedLogoutAnswer`, `FederatedSoapLogout` | type, type, type, type | A logout at the provider: what it sends the logout routes, which logins it ends, and how the provider is answered |
| `BaseFederatedAuthenticator` | class | What every provider's authenticator extends, whichever protocol it speaks: the redirect, the callback and the links |
| `FederatedLoginStart`, `FederatedAnswerContext`, `FederatedLogin`, `FederatedReauthentication` | type, type, type, type | What an authenticator of another protocol builds the URL at the provider from, checks the answer with, and reads from it: who logged in, or that they log in again |
| `ProviderTokenGrant`, `FederatedProviderSession` | type, type | The tokens of the provider's APIs and the session at the provider, as a login hands them on |
| `BaseOAuthAuthenticator` | class | What every OAuth and OpenID Connect provider's authenticator extends: the client, the scopes and the tokens of the provider's APIs |
| `OAuthCodeExchange` | type | What the answer to an OAuth login is checked and exchanged with: the state, the PKCE verifier, the nonce and the maximum age |
| `OpenIdClient` | type | The module of `openid-client`, which speaks OAuth and OpenID Connect |
| `BaseOidcAuthenticator` | class | Extend it once per OpenID Connect provider, naming the provider and your client there |
| `BaseOAuth2Authenticator` | class | Extend it once per provider that speaks plain OAuth2, naming its endpoints and reading the user from its API |
| `OAuth2Identity` | type | Who logged in, as your authenticator reads it from the provider's API |
| `BaseGitHubAuthenticator` | class | A GitHub account. Extend it with your OAuth app |
| `BaseGoogleAuthenticator` | class | A Google account. Extend it with your client |
| `BaseAppleAuthenticator` | class | An Apple account. Extend it with your services id, team and key |
| `BaseMicrosoftAuthenticator` | class | An account of a Microsoft Entra ID [tenant](./glossary.md#tenant). Extend it with the tenant, your client and whether its registration says when the user logged in, see [Microsoft Entra ID](#microsoft-entra-id) |
| `BaseKeycloakAuthenticator` | class | A user of a Keycloak realm. Extend it with the URL, the realm and your client |
| `BaseSamlAuthenticator` | class | Extend it once per SAML 2.0 identity provider, naming the provider and your application there |
| `SamlIdentityProvider` | type | Where a SAML identity provider's metadata is, or where it logs users in and what it signs with |
| `SamlKeyPair` | type | A key of your application and its certificate, for signed requests and encrypted assertions |
| `SamlNameIdFormat` | enum | Which NameID a SAML identity provider is asked for |
| `NodeSaml` | type | The module of `@node-saml/node-saml`, which speaks SAML |
| `LogoutResult` | class | What a logout answers: where to log out at the provider as well |
| `FederatedSession`, `FederatedSessionMatch`, `FederatedSessionUtilities` | type, type, class | The session at a provider a login was started from, for a strategy of your own to keep with the login and end it by |
| `FederatedSessionColumns` | type | That session as the columns a strategy of your own stores next to the login |
| `OAuthClientAuthentication` | type | How your client proves itself to the provider: a client secret or a private key |
| `OAuthClientSecret` | type | A client secret, or a function resolving it before every exchange |
| `OAuthResponseMode` | type | How the provider sends its answer back: `query` or `form_post` |
| `OidcAuthenticationTime` | type | How an OpenID Connect provider says when the user logged in there: `auth_time` or `none` |
| `OidcDiscoveryAtBoot` | type | What happens when an OpenID Connect provider's metadata cannot be read while the application starts: `required` or `whenReachable` |
| `FederatedCallbackForm` | class | The answer a provider posts to the callback |
| `FederationOptions` | type | What every provider shares, via `ZIBRI_DI_TOKENS.FEDERATION_OPTIONS`. Required |
| `AuthController` | function | Defines the login routes, among the other auth routes. See [the auth routes](./auth-routes.md) |
| `FederatedRouteUtilities` | class | What the login routes share: finding the provider a route names, reading its answer, and where the browser goes next |
| `FederatedAuthenticatorClass` | type | A class of a provider's authenticator, as `FederatedRouteUtilities` finds it |
| `FederatedBindingUtilities` | class | Reads and writes the cookies that tie a login at a provider to the browser that started it |
| `FederatedTicketCredentials` | class | The [ticket](./glossary.md#ticket) a first login continues with at your registration |
| `FederatedHandoverCredentials` | class | The one-time code a login is handed over to the frontend with |
| `FederatedCredentials` | type | What a provider's authenticator logs in with: the one-time code or the ticket |
| `FederatedRegistration` | type | Who logged in, as the provider reports them |
| `FederatedProviderIdentity`, `FederatedProfile` | type | Who logged in at a provider, and what it reports about them |
| `OAuthProviderLogin` | type | Who logged in at a provider, and the tokens the code was exchanged for |
| `FederatedIdentity` | entity | An identity at a provider, linked to a user to log in, to call the provider's APIs, or both |
| `OAuthProviderTokens` | entity | The tokens kept for an identity, for calling the provider's APIs |
| `FederatedLoginAttempt`, `FederatedHandoverCode`, `FederatedRegistrationTicket`, `FederatedConnectionCode` | entity | A login on its way |
| `FederatedLoginFailure` | enum | Why a login failed, as your error page is told |
| `FederatedLoginError`, `FederatedLoginErrorOptions` | error, type | Thrown when the answer of a provider cannot be taken, carrying why for your error page |
| `FederatedLoginAction` | type | What a login through a provider is for, as the audit trail records it: logging in, or connecting a provider |
| `FederatedLinkIdentityRequest` | class | Where the browser goes once the provider is linked, and what the link is for: logging in, the scopes of the provider's APIs, or both |
| `FederatedLinkIdentityStart` | class | Where to send the browser to link a provider to an account |
| `OAuthOfflineAccess` | type | How a provider is asked for a refresh token |
| `ProviderAccessError`, `ProviderAccessFailure` | class, enum | Why there is no access token for calling a provider's APIs |

## Setting it up
Install `openid-client`, and declare the five entities in the data source your users live in:

```ts
// src/data-sources/db/entities.ts
import { FederatedConnectionCode, FederatedHandoverCode, FederatedIdentity, FederatedLoginAttempt, FederatedRegistrationTicket } from 'zibri';

export const federationEntities = [FederatedLoginAttempt, FederatedIdentity, FederatedHandoverCode, FederatedRegistrationTicket, FederatedConnectionCode];
```

Extend the authenticator of your provider with the client you registered there, register it, and give it to the [auth routes](./auth-routes.md):

```ts
// src/auth/google.authenticator.ts
import { AuthController, BaseGoogleAuthenticator, Controller, CookieAuthStrategy, OAuthClientAuthentication, OidcDiscoveryAtBoot, OtpTwoFactorMethod, ZibriApplicationOptions } from 'zibri';

import { User } from '../models/user.model';

export class GoogleAuthenticator extends BaseGoogleAuthenticator<string, User> {
    readonly discoveryAtBoot: OidcDiscoveryAtBoot = 'required';
    readonly clientId: string = process.env['GOOGLE_CLIENT_ID'] ?? '';
    readonly clientAuthentication: OAuthClientAuthentication = {
        method: 'client_secret_basic',
        clientSecret: process.env['GOOGLE_CLIENT_SECRET'] ?? ''
    };
}

@Controller('/auth', { versions: 'all' })
export class AppAuthController extends AuthController({
    strategies: [CookieAuthStrategy],
    authenticators: [GoogleAuthenticator],
    twoFactorMethods: [OtpTwoFactorMethod]
}) {}

export const loginOptions: Pick<ZibriApplicationOptions, 'authenticators' | 'authStrategies' | 'controllers'> = {
    authenticators: [GoogleAuthenticator],
    authStrategies: [CookieAuthStrategy],
    controllers: [AppAuthController]
};
```

In the settings of the client at the provider, enter `{baseUrl}/auth/federated/google/callback` as its redirect URI, with the `baseUrl` of your application options. The `google` is the provider's `name`, which every route the provider sends the browser to is reached under.

The routes are below the path of your auth controller and `/federated`: for `@Controller('/account', { versions: 'all' })` the redirect URI is `{baseUrl}/account/federated/google/callback`. To write the routes yourself, see [Routes of your own](#routes-of-your-own).

Then provide the options every provider shares:

```ts
// src/providers.ts
import { defineProvider, ZIBRI_DI_TOKENS } from 'zibri';

export const federationOptionsProvider = defineProvider({
    token: ZIBRI_DI_TOKENS.FEDERATION_OPTIONS,
    useValue: {
        allowedRedirects: ['https://app.example.com'],
        registrationUrl: 'https://app.example.com/register',
        errorUrl: 'https://app.example.com/login-failed',
        maxAuthenticationAgeInMs: 86400000
    }
});
```

| Option | What it is |
|---|---|
| `allowedRedirects` | Where a login may go once it is done. An entry allows its origin, and its path and everything below it |
| `registrationUrl` | Where a login goes when no user is linked to the identity, see [A first login](#a-first-login) |
| `errorUrl` | Where a login goes when it fails |
| `loggedOutUrl` | Where the browser lands once the provider ended its session, see [Logging out](#logging-out). Required for a [SAML](#saml) identity provider, and for logging out at an OpenID Connect provider |
| `maxAuthenticationAgeInMs` | How long ago the user may have logged in at the provider. An older login makes the provider ask them again |
| `loginAttemptExpiresInMs` | How long the login at the provider may take. 10 minutes by default |
| `registrationTicketExpiresInMs` | How long the registration may take afterwards. 30 minutes by default |
| `handoverCodeExpiresInMs` | How long the code a login is [handed over by](#handing-the-login-over-by-code) stays valid. 1 minute by default |
| `linkIdentityCodeExpiresInMs` | How long the URL that [connects a provider](#connecting-a-provider-to-an-account) stays valid. 1 minute by default |

### Routes of your own
The routes can also be ones you write. An authenticator gives out the URLs of its `routes`, each with the method the browser requests it with:

| Route | Method |
|---|---|
| `callback` | `GET`, or `POST` when the provider posts its answer: a [SAML](#saml) identity provider, or a `responseMode` of `form_post` |
| `link-identity` | `GET` |
| `logout` | `GET` for an OpenID Connect provider, `GET` and `POST` for a [SAML](#saml) identity provider, see [logging out](#logging-out) |
| `logout/soap` | `POST`, by the identity provider itself, for a [SAML](#saml) identity provider only |
| `logout/back-channel` | `POST`, by the provider itself, for an OpenID Connect provider only |

Override `resolveRouteUrl` to name yours, and `routes` to keep the ones you serve. Leave out `link-identity` when you do not [connect providers to accounts](#connecting-a-provider-to-an-account). For the `baseUrl` `https://api.example.com`:

```ts
// src/auth/google.authenticator.ts
import { FederatedRoute, FederatedRouteEndpoint } from 'zibri';

export class OwnRoutesGoogleAuthenticator extends GoogleAuthenticator {
    override get routes(): FederatedRouteEndpoint[] {
        return super.routes.filter(endpoint => endpoint.route === 'callback');
    }

    override resolveRouteUrl(route: FederatedRoute): string {
        return `https://api.example.com/login/google-${route}`;
    }
}
```

Your routes call `requestProviderLogin` and `confirmProviderLogin` of the authenticator, and `AuthServiceInterface.login` with the code the login hands over. `FederatedRouteUtilities` has what the login routes of the auth controller use. `FederatedBindingUtilities` reads and writes the cookie that ties a login to the browser that started it. An authenticator that extends none of the base classes implements `FederatedAuthenticatorInterface`.

Every URL an authenticator gives out is below the `baseUrl`, and reaches a route of your application that answers the URL's method.

## Logging in
The frontend sends the browser to `GET /auth/federated/login/request`, naming the provider and where the browser goes afterwards, see [logging in at a provider](./auth-routes.md#logging-in-at-a-provider). It either logs the user in on the redirect back, or hands the login over by code.

### Logging in on the redirect back
Without a `codeChallenge`, the user is logged in on the redirect back, which only a strategy whose login goes out with the response can do, such as `CookieAuthStrategy`:

```txt
GET /auth/federated/login/request?authenticator=google&redirectTo=https://app.example.com/home
```

The browser logs in at the provider, comes back to the callback, and lands on `redirectTo` with the session cookies set. Read the CSRF token from `GET /auth/csrf-token` once it is back. When your auth controller has more than one such strategy, name it in `strategy`.

### Handing the login over by code
With a `codeChallenge`, the login is handed over by code, for every strategy. The frontend makes a PKCE verifier, a random string it keeps, and sends the browser to `GET /auth/federated/login/request` with its challenge, the base64url SHA-256 of it:

```txt
GET /auth/federated/login/request?authenticator=google&redirectTo=https://app.example.com/home&codeChallenge=...
```

The browser lands on `redirectTo` with a one-time `code` in the query. The frontend logs in with it, together with the verifier:

```txt
POST /auth/login?authenticator=google
{ "code": "...", "codeVerifier": "..." }
```

The code is only good with that verifier, and only once.

## When a login fails
The browser lands on `errorUrl` with an `error`:

| `error` | What happened |
|---|---|
| `cancelled` | The user did not allow the login at the provider |
| `provider_error` | The provider answered with an error, or could not be reached, also while the code was exchanged. Logged as a warning, and recorded with `reason: error` |
| `expired` | The login took too long, was completed already, or was started in another browser |
| `invalid` | The provider's answer could not be verified |
| `already_linked` | The identity being [connected](#connecting-a-provider-to-an-account) is linked to another user |
| `not_for_login` | The identity is linked to a user for [the provider's APIs](#calling-a-providers-apis) only |
| `not_linked` | The user the identity is linked to was deleted while they logged in |
| `refused` | The user may not log in: their account is deactivated or locked, or the authenticator refused the login with a `ForbiddenError`, see [later logins](#later-logins) |
| `failed` | Any other refusal, such as too many login attempts or a `BadRequestError` from the authenticator. Starting over fails the same way |

## A first login
When no user is linked to the identity, the browser lands on `registrationUrl` with a one-time `ticket`. Your registration reads who logged in, creates the user and links the identity, and logs them in with the ticket. Create and link in one transaction, and log in once it is committed:

```ts
// src/controllers/registration.controller.ts
import { AuthServiceInterface, Body, CookieAuthData, CookieAuthStrategy, Controller, Inject, inject, FederatedRegistration, FederatedTicketCredentials, Post, Repository, repositoryTokenFor, Transaction, ZIBRI_DI_TOKENS } from 'zibri';

import { GoogleAuthenticator } from '../auth/google.authenticator';
import { User } from '../models/user.model';

@Controller('/register')
export class RegistrationController {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.AUTH_SERVICE)
        private readonly authService: AuthServiceInterface
    ) {}

    @Post('/google')
    async register(
        @Body(FederatedTicketCredentials)
        credentials: FederatedTicketCredentials
    ): Promise<CookieAuthData<string>> {
        const users: Repository<User> = inject(repositoryTokenFor(User));
        const transaction: Transaction = await users.dataSource.startTransaction();
        try {
            const registration: FederatedRegistration = await this.authService.resolveRegistration(GoogleAuthenticator, credentials, transaction);
            const user: User = await users.create({ email: registration.email ?? '', roles: [] }, { transaction });
            await this.authService.linkTicketIdentity(GoogleAuthenticator, credentials, user.id, transaction);
            await transaction.commit();
        }
        catch (error) {
            await transaction.rollback();
            throw error;
        }
        return await this.authService.login(GoogleAuthenticator, CookieAuthStrategy, credentials, undefined);
    }
}
```

The ticket is only good in the browser the login started in. For a login started with a `codeChallenge`, send the verifier with it, as `codeVerifier`.

A login never finds a user by email. An identity logs in as the user it is linked to, or goes to the registration. Use `emailVerified` before you trust the email the provider reports.

`registration.claims` holds everything the provider proved about who logged in: the claims of the ID token, such as `groups`, `hd` or Entra ID's `oid` and `tid`, or the attributes of a SAML assertion. Read it to admit only the accounts of a domain, to give a new user the roles their groups say, or to find the account a [SCIM](./scim.md) provisioning created for them by its `externalId`.

## Later logins
Every later login with an identity finds the user it is linked to, and hands what the provider proved this time to `resolveLoginUser` of the authenticator, with that user. It answers the user the identity logs in as: updated from the claims, or as they are. Throw an HTTP error to refuse the login, which answers the error to a login [handed over by code](#handing-the-login-over-by-code). A `ForbiddenError` lands the browser on `errorUrl` with `refused`, and any other HTTP error with `failed`.

Keep the roles of a user in step with their groups at the provider, so that someone taken out of a group loses its role at their next login:

```ts
// src/auth/role-google.authenticator.ts
import { inject, repositoryTokenFor, Transaction } from 'zibri';

import { GoogleAuthenticator } from './google.authenticator';
import { Roles } from '../models/roles.enum';
import { User } from '../models/user.model';

export class RoleGoogleAuthenticator extends GoogleAuthenticator {
    protected override async resolveLoginUser(claims: Record<string, unknown>, user: User, transaction: Transaction | undefined): Promise<User> {
        const groups: unknown = claims['groups'];
        const roles: Roles[] = Array.isArray(groups) && groups.includes('app-admins') ? [Roles.ADMIN] : [Roles.USER];
        return await inject(repositoryTokenFor(User)).updateById(user.id, { roles }, { transaction });
    }
}
```

It runs inside the login's transaction. A refresh of the login does not ask the provider again, so it does not run then: an access token keeps the roles it was issued with until it expires, and the user's roles change at their next login.

## Connecting a provider to an account
A user who is logged in connects a provider to their account. A connection with `forLogin: true` adds a way to log in: the user logs in through the provider as well as the way they did before, such as with their password. A connection can also be for [the provider's APIs](#calling-a-providers-apis), with or without logging in.

Connecting starts at `POST /auth/link-identity/request` of the [auth routes](./auth-routes.md), which answers with the URL to send the browser to:

```txt
POST /auth/link-identity/request?authenticator=google
{ "redirectTo": "https://app.example.com/account", "forLogin": true }

200 { "url": "https://accounts.google.com/o/oauth2/v2/auth?..." }
```

The route connects the provider to the user logged in with the request. `forLogin` is required. Connecting again with `forLogin: true` an identity that is linked for the APIs only turns logging in on for it. The route takes a [second factor](./glossary.md#second-factor), or a [recent login](./two-factor.md#accepting-a-recent-login-instead) in its place. In a route of your own, `requestLinkIdentity` of `AuthServiceInterface` does the same.

The frontend sends the browser to the URL. The user [logs in again](#logging-in-again) at the provider, even when the provider still has a session of theirs, and the browser lands on `redirectTo` with the identity linked. An identity that is linked to another user lands on `errorUrl` with `already_linked`. The URL is good once.

### Listing and unlinking
`GET /auth/identities` lists the identities linked to the user logged in with the request, each with the name of the provider it is linked through. Each says whether it logs in, in `forLogin`, and which scopes of the provider's APIs it was granted, in `grantedScopes`. `DELETE /auth/identities/{identityId}` unlinks one, and takes a second factor or a recent login like connecting does:

```txt
GET /auth/identities
200 [{ "authenticator": "google", "identity": { "id": "...", "forLogin": true, "grantedScopes": [] } }]

DELETE /auth/identities/...
```

In routes of your own, `findIdentities` and `unlinkIdentity` of `AuthServiceInterface` do the same. Pass authenticators to `findIdentities` to list only the identities at those providers.

> [!WARNING]
> A user without a password has no way to log in once their last identity that logs in is unlinked, or [stops logging in](#logging-in-and-api-access-apart). Check that they keep a way to log in before you unlink one.

## Calling a provider's APIs
An identity can also let your application call the provider's APIs for the user, such as reading their Google calendar. Name the scopes of those APIs your application may ask for in `apiScopes`, and declare `OAuthProviderTokens` next to the other entities:

```ts
// src/auth/google-calendar.authenticator.ts
import { BaseGoogleAuthenticator, OAuthClientAuthentication, OidcDiscoveryAtBoot } from 'zibri';

import { User } from '../models/user.model';

export class GoogleCalendarAuthenticator extends BaseGoogleAuthenticator<string, User> {
    readonly discoveryAtBoot: OidcDiscoveryAtBoot = 'required';
    readonly clientId: string = process.env['GOOGLE_CLIENT_ID'] ?? '';
    readonly clientAuthentication: OAuthClientAuthentication = {
        method: 'client_secret_basic',
        clientSecret: process.env['GOOGLE_CLIENT_SECRET'] ?? ''
    };
    override readonly apiScopes: string[] = ['https://www.googleapis.com/auth/calendar.readonly'];
}
```

Ask for the scopes when the user turns on what needs them, by [connecting](#connecting-a-provider-to-an-account) the provider with `scopes`. With `forLogin: false`, the identity is linked for the APIs only, and a login through it lands on `errorUrl` with `not_for_login`:

```ts
// src/services/calendar-link.function.ts
import { AuthServiceInterface, FederatedLinkIdentityStart } from 'zibri';

import { GoogleCalendarAuthenticator } from '../auth/google-calendar.authenticator';

export async function requestCalendarLink(authService: AuthServiceInterface, redirectTo: string): Promise<FederatedLinkIdentityStart> {
    return await authService.requestLinkIdentity(GoogleCalendarAuthenticator, {
        redirectTo,
        forLogin: false,
        scopes: ['https://www.googleapis.com/auth/calendar.readonly']
    });
}
```

A login can ask for them as well, with `scopes` on `GET /auth/federated/login/request`, separated by spaces:

```txt
GET /auth/federated/login/request?authenticator=google&redirectTo=https://app.example.com/home&scopes=https://www.googleapis.com/auth/calendar.readonly
```

A scope that is not one of the `apiScopes` is refused. The provider is asked for a refresh token along with the scopes, so the APIs can be called while the user is away. The tokens are kept encrypted, with the scopes the user granted, which can be fewer than were asked for.

Get an access token with the id of the identity, as `findIdentities` lists it, and the scopes you need:

```ts
// src/services/calendar.service.ts
import { AuthServiceInterface, Inject, ZIBRI_DI_TOKENS } from 'zibri';

export class CalendarService {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.AUTH_SERVICE)
        private readonly authService: AuthServiceInterface
    ) {}

    async findEvents(userId: string, identityId: string): Promise<unknown> {
        const accessToken: string = await this.authService.resolveProviderAccessToken(
            userId,
            identityId,
            ['https://www.googleapis.com/auth/calendar.readonly']
        );
        const res: Response = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
            headers: { authorization: `Bearer ${accessToken}` }
        });
        return await res.json();
    }
}
```

A kept access token that has expired, or expires within `accessTokenRefreshMarginInMs`, is replaced with the refresh token first, one request at a time for an identity. When there is no access token, `resolveProviderAccessToken` throws a `ProviderAccessError`. Connect the provider again with the scopes to get one:

| `failure` | What happened |
|---|---|
| `not_connected` | No tokens are kept for the identity |
| `missing_scopes` | The user did not grant every scope asked for |
| `expired` | The access token expired, and the provider issued no refresh token |
| `revoked` | The provider refused the refresh token, because the user removed your application there. The tokens are removed |

`revokeProviderAccess` removes the tokens of an identity and hands them back to the provider. An identity that logs in keeps logging in. One that is linked for the APIs only is unlinked. `unlinkIdentity` hands the tokens back too. The tokens are removed even when the provider cannot be reached, and Microsoft Entra ID takes no tokens back.

```ts
// src/services/calendar-disconnection.function.ts
import { AuthServiceInterface } from 'zibri';

export async function stopCalendarAccess(authService: AuthServiceInterface, userId: string, identityId: string): Promise<void> {
    await authService.revokeProviderAccess(userId, identityId, undefined);
}
```

### Logging in and API access apart
`revokeProviderLogin` stops an identity from logging in, and keeps the tokens of its APIs, so your application goes on calling them. An identity without API access is unlinked. Connecting it again with `forLogin: true` turns logging in on again.

```ts
// src/services/login-disconnection.function.ts
import { AuthServiceInterface } from 'zibri';

export async function stopLoggingInWithGoogle(authService: AuthServiceInterface, userId: string, identityId: string): Promise<void> {
    await authService.revokeProviderLogin(userId, identityId, undefined);
}
```

## Logging in again
Add `reauthenticate=true` to `GET /auth/federated/login/request`, and the provider asks the user to log in again instead of using the session it has. Google and GitHub cannot be asked for that, and have the user pick their account instead. The login time is when the user logged in at the provider, which is what a route accepting a [recent login](./two-factor.md#accepting-a-recent-login-instead) checks. A login at the provider older than `maxAuthenticationAgeInMs` sends the browser back to the provider to log in again, and from there on to `redirectTo`.

A provider that does not say when the user logged in never counts as a recent login: Google, a [provider that speaks plain OAuth2](#providers-that-speak-plain-oauth2), and any OpenID Connect provider whose `authenticationTime` is `none`.

## Logging out
`POST /auth/logout` ends the login, and answers with a `providerLogoutUrl` when the user can log out at the provider the login was started at as well: an OpenID Connect provider that publishes an end session endpoint, or a [SAML](#saml) identity provider with a single logout URL:

```txt
POST /auth/logout
200 { "providerLogoutUrl": "https://idp.example.com/saml/slo?SAMLRequest=..." }
```

Send the browser to the URL. The provider ends its session, and sends the browser back to `{baseUrl}/auth/federated/{name}/logout`, which lands it on `loggedOutUrl`. Without a `providerLogoutUrl`, the logout is done.

A user who logs out at the provider is logged out here as well.

An OpenID Connect provider says so by its back channel: it posts a logout token to `{baseUrl}/auth/federated/{name}/logout/back-channel`, which ends every login started from the session the token names, or every login of the user when it names none. Register that URL at the provider as the back-channel logout URL. A token that is not the provider's, lacks the logout event, or was presented before is refused with `401`. A provider that uses the front channel loads `{baseUrl}/auth/federated/{name}/logout` with `iss` and `sid` instead, which ends the logins of that session. Register the logout URL as the front-channel logout URL, and as the URL the browser comes back to after a logout there.

A SAML identity provider sends the browser to the logout route with a logout request, in the URL or as a posted form, which ends every login started from that session at the provider, and the browser goes back to the provider. A logout request that names no session ends every login the user started at that provider. One that is not signed by the provider is refused with `401`.

The browser goes back to the provider's logout URL for redirects. When the provider's metadata names a logout URL for posted forms only, the route answers with a page that posts the answer there.

A SAML identity provider can also send the logout request without a browser, to `{baseUrl}/auth/federated/{name}/logout/soap`, in a SOAP envelope. It ends the same logins, and is answered in a SOAP envelope. A body that is not a SOAP envelope carrying a logout request is refused with `400`.

## Other providers
Extend `BaseOidcAuthenticator` for any other OpenID Connect provider:

```ts
// src/auth/company.authenticator.ts
import { BaseOidcAuthenticator, OAuthClientAuthentication, OidcAuthenticationTime, OidcDiscoveryAtBoot } from 'zibri';

import { User } from '../models/user.model';

export class CompanyAuthenticator extends BaseOidcAuthenticator<string, User> {
    readonly discoveryAtBoot: OidcDiscoveryAtBoot = 'required';
    readonly name: string = 'company';
    readonly issuer: string = 'https://sso.example.com';
    readonly clientId: string = 'task-tracker';
    readonly clientAuthentication: OAuthClientAuthentication = {
        method: 'client_secret_post',
        clientSecret: process.env['COMPANY_CLIENT_SECRET'] ?? ''
    };
    readonly authenticationTime: OidcAuthenticationTime = 'auth_time';
}
```

| Member | What it is |
|---|---|
| `name` | What the routes of the provider are reached under. Lowercase letters, digits and dashes, and unique |
| `issuer` | The provider's issuer URL |
| `clientId` | Your client at the provider |
| `clientAuthentication` | `client_secret_basic` or `client_secret_post` with a secret, or `private_key_jwt` with a private key. A secret can be a function, which runs before every exchange |
| `authenticationTime` | How the provider says when the user logged in there. `auth_time` for a provider that is asked with `max_age` and puts the time into the ID token, `none` for one that does not say, see [logging in again](#logging-in-again) |
| `discoveryAtBoot` | What happens when the provider's metadata cannot be read while the application starts. `required`: the application does not start. `whenReachable`: while the provider cannot be reached, the application starts with a warning and reads the metadata on the first login. A provider that answers with something other than its metadata, such as for a wrong `issuer`, stops the start either way. Required |
| `metadataMaxAgeInMs` | How long the provider's metadata is kept before it is read again. While it cannot be read again, the metadata read before is used. One day by default |
| `subjectClaim` | The claim an identity is known by, in the ID token of a login and in [a token a request sends](./provider-tokens.md). `sub` by default. `oid` for a provider whose `sub` differs from one client to another, such as [Microsoft Entra ID](#microsoft-entra-id) |
| `logoutTokenMaxAgeInMs` | How long ago a logout token the provider sends may have been issued, which is also how long one is remembered as taken. 10 minutes by default |
| `acrValues` | The classes of authentication a login asks the provider for, as `acr_values`, such as one that stands for a second factor. None by default, see [accepting the provider's second factor](./two-factor.md#accepting-the-providers-second-factor) |
| `scopes` | What the provider is asked for. `openid`, `email` and `profile` by default |
| `allowedAlgorithms` | What the ID token may be signed with. `RS256`, `PS256`, `ES256` and `EdDSA` by default |
| `responseMode` | How the provider sends its answer back. `query` by default, see [form post](#providers-that-answer-with-a-form-post) |
| `reauthenticationPrompt` | The `prompt` that asks the provider to have the user log in again. `login` by default |
| `apiScopes` | The scopes of the provider's APIs a login or a connection may ask for. None by default |
| `offlineAccess` | How the provider is asked for a refresh token: the `offline_access` scope and the `consent` prompt by default |
| `accessTokenRefreshMarginInMs` | How long before it expires a kept access token is replaced, see [calling a provider's APIs](#calling-a-providers-apis). One minute by default |
| `resolveProfile` | Reads the email and names out of the ID token, and out of what the provider sent next to the code. Override it for a provider that names them differently |
| `resolveLoginUser` | Answers the user a later login logs in as, from the claims of the ID token, see [later logins](#later-logins) |

A provider is reached over HTTPS. A provider on `localhost` is reached over HTTP as well.

## Providers that speak plain OAuth2
Some providers, GitHub among them, speak OAuth2 without OpenID Connect. Extend `BaseOAuth2Authenticator` for such a provider, with its endpoints, an issuer its identities are known by, and how to read the user from its API with the access token of the login:

```ts
// src/auth/forge.authenticator.ts
import { BaseOAuth2Authenticator, OAuthClientAuthentication, FederatedProviderIdentity } from 'zibri';

import { User } from '../models/user.model';

export class ForgeAuthenticator extends BaseOAuth2Authenticator<string, User> {
    readonly name: string = 'forge';
    readonly issuer: string = 'https://forge.example.com';
    readonly authorizationEndpoint: string = 'https://forge.example.com/oauth/authorize';
    readonly tokenEndpoint: string = 'https://forge.example.com/oauth/token';
    readonly scopes: string[] = ['read_user'];
    readonly clientId: string = 'task-tracker';
    readonly clientAuthentication: OAuthClientAuthentication = {
        method: 'client_secret_post',
        clientSecret: process.env['FORGE_CLIENT_SECRET'] ?? ''
    };

    protected async resolveIdentity(accessToken: string): Promise<Pick<FederatedProviderIdentity, 'subject' | 'profile'>> {
        const user: unknown = await this.fetchJson('https://forge.example.com/api/user', accessToken);
        if (typeof user !== 'object' || user == undefined || !('id' in user) || typeof user.id !== 'number') {
            throw new Error('The forge answered without the id of the user.');
        }
        return {
            subject: String(user.id),
            profile: { email: undefined, emailVerified: undefined, name: undefined, givenName: undefined, familyName: undefined }
        };
    }
}
```

| Member | What it is |
|---|---|
| `issuer` | What the provider's identities are known by. Keep it the same, since the links to your users are stored under it |
| `authorizationEndpoint` | Where the browser logs in at the provider |
| `tokenEndpoint` | Where the code is exchanged for an access token |
| `revocationEndpoint` | Where tokens are handed back once they are removed. None by default |
| `scopes` | What the provider is asked for |
| `resolveIdentity` | Reads who logged in from the provider's API: an id that stays the same for the account, what the provider reports about them, and as `claims` whatever else its API answered, for the registration and `resolveLoginUser` to read |
| `resolveLoginUser` | Answers the user a later login logs in as, from those `claims`, see [later logins](#later-logins) |
| `fetchJson` | Reads JSON from the provider's API with the access token |

The provider does not say when the user logged in there, so a login through it never counts as a [recent login](./two-factor.md#accepting-a-recent-login-instead). A route that takes a recent login in place of a second factor asks such a user for the second factor.

## Providers that answer with a form post
Some providers send their answer back as a page that posts it to the callback, so the code never appears in a URL. Apple does, and Microsoft Entra ID and Okta can. Set `responseMode` to `form_post` for such a provider:

```ts
// src/auth/okta.authenticator.ts
import { BaseOidcAuthenticator, OAuthClientAuthentication, OAuthResponseMode, OidcAuthenticationTime, OidcDiscoveryAtBoot } from 'zibri';

import { User } from '../models/user.model';

export class OktaAuthenticator extends BaseOidcAuthenticator<string, User> {
    readonly discoveryAtBoot: OidcDiscoveryAtBoot = 'required';
    readonly name: string = 'okta';
    readonly issuer: string = 'https://example.okta.com';
    readonly clientId: string = 'task-tracker';
    readonly clientAuthentication: OAuthClientAuthentication = {
        method: 'client_secret_basic',
        clientSecret: process.env['OKTA_CLIENT_SECRET'] ?? ''
    };
    readonly authenticationTime: OidcAuthenticationTime = 'auth_time';
    override readonly responseMode: OAuthResponseMode = 'form_post';
}
```

The callback URL is the same. It takes the post from the provider's login page and from nowhere else, see [a route other sites post to](./app-settings.md#a-route-other-sites-post-to). The browser carries the cookie of the login along with it only over HTTPS, so an application logging in through such a provider is reached over HTTPS, or on `localhost` while you develop.

## Microsoft Entra ID
Extend `BaseMicrosoftAuthenticator` with the id of the tenant whose accounts log in, the client id and secret of the app registered in it, and how its ID tokens say when the user logged in:

```ts
// src/auth/microsoft.authenticator.ts
import { BaseMicrosoftAuthenticator, OAuthClientAuthentication, OidcAuthenticationTime, OidcDiscoveryAtBoot } from 'zibri';

import { User } from '../models/user.model';

export class MicrosoftAuthenticator extends BaseMicrosoftAuthenticator<string, User> {
    readonly discoveryAtBoot: OidcDiscoveryAtBoot = 'required';
    readonly tenantId: string = process.env['ENTRA_TENANT_ID'] ?? '';
    readonly clientId: string = process.env['ENTRA_CLIENT_ID'] ?? '';
    readonly clientAuthentication: OAuthClientAuthentication = {
        method: 'client_secret_post',
        clientSecret: process.env['ENTRA_CLIENT_SECRET'] ?? ''
    };
    readonly authenticationTime: OidcAuthenticationTime = 'none';
}
```

An ID token of Entra ID says when the user logged in only when the app registration adds `auth_time` to its optional claims. With that claim added, set `authenticationTime` to `auth_time`, and a login through the tenant counts as a [recent login](./two-factor.md#accepting-a-recent-login-instead). Without it, `none`.

An identity of the tenant is known by the account's object id, the `oid` claim, which is the same in the ID tokens of every app registration and in the access tokens issued for an API. So a mobile app registered on its own [calls your API with a token](./provider-tokens.md) as the user who logged in through the web client.

For an app registration that takes the accounts of more than one tenant, set `tenantId` to `organizations` for work accounts, or to `common` for work and personal accounts. Then name the tenants whose accounts log in in `allowedTenantIds`, or `'any'` for every tenant:

```ts
// src/auth/partner-microsoft.authenticator.ts
import { BaseMicrosoftAuthenticator, OAuthClientAuthentication, OidcAuthenticationTime, OidcDiscoveryAtBoot } from 'zibri';

import { User } from '../models/user.model';

export class PartnerMicrosoftAuthenticator extends BaseMicrosoftAuthenticator<string, User> {
    readonly discoveryAtBoot: OidcDiscoveryAtBoot = 'required';
    readonly tenantId: string = 'organizations';
    override readonly allowedTenantIds: string[] = [
        '6f0c3c1e-3a4b-4f7e-9c2d-1b2a3c4d5e6f', // your own tenant
        '0d9e8f7a-6b5c-4d3e-8f2a-1b0c9d8e7f6a' // a partner's tenant
    ];
    readonly clientId: string = process.env['ENTRA_CLIENT_ID'] ?? '';
    readonly clientAuthentication: OAuthClientAuthentication = {
        method: 'client_secret_post',
        clientSecret: process.env['ENTRA_CLIENT_SECRET'] ?? ''
    };
    readonly authenticationTime: OidcAuthenticationTime = 'none';
}
```

An account of a tenant `allowedTenantIds` leaves out lands on `errorUrl` with `refused`, and its tokens are not taken. An identity belongs to the account's own tenant, so the same object id in two tenants is two identities.

## Apple
Extend `BaseAppleAuthenticator` with your services id as the client id, your team id, and the id of the key you created for Sign in with Apple and the contents of its `.p8` file:

```ts
// src/auth/apple.authenticator.ts
import { readFileSync } from 'node:fs';

import { BaseAppleAuthenticator, OidcDiscoveryAtBoot } from 'zibri';

import { User } from '../models/user.model';

export class AppleAuthenticator extends BaseAppleAuthenticator<string, User> {
    readonly discoveryAtBoot: OidcDiscoveryAtBoot = 'required';
    readonly clientId: string = 'com.example.app.login';
    readonly teamId: string = 'TEAM123456';
    readonly keyId: string = 'KEY1234567';
    readonly privateKey: string = readFileSync('apple-login.p8', 'utf8');
}
```

The client secret Apple takes is a token signed with that key, and the authenticator signs a new one for every login. Apple answers with a form post. It sends the user's name next to the code on their first login only, so a registration reads it from `givenName` and `familyName` then or never. The email Apple reports is often an address of its private relay.

## GitHub
Extend `BaseGitHubAuthenticator` with the client id and secret of the OAuth app you registered at GitHub:

```ts
// src/auth/github.authenticator.ts
import { BaseGitHubAuthenticator, OAuthClientAuthentication } from 'zibri';

import { User } from '../models/user.model';

export class GitHubAuthenticator extends BaseGitHubAuthenticator<string, User> {
    readonly clientId: string = process.env['GITHUB_CLIENT_ID'] ?? '';
    readonly clientAuthentication: OAuthClientAuthentication = {
        method: 'client_secret_post',
        clientSecret: process.env['GITHUB_CLIENT_SECRET'] ?? ''
    };
}
```

In the settings of the OAuth app at GitHub, enter `{baseUrl}/auth/federated/github/callback` as its callback URL. The identity is the id of the GitHub account, which stays the same when the user renames it. The email is the account's primary one, with whether GitHub has verified it, and the name is the one name GitHub keeps, in `name`. Logging in again has the user pick their account, since GitHub cannot be told to ask for the password again. An access token of an OAuth app does not expire, and revoking the access withdraws what the user allowed your OAuth app.

## SAML
Install `@node-saml/node-saml`, and extend `BaseSamlAuthenticator` for a SAML 2.0 identity provider, such as Microsoft Entra ID, Okta, ADFS or Keycloak:

```ts
// src/auth/company-saml.authenticator.ts
import { BaseSamlAuthenticator, SamlIdentityProvider } from 'zibri';

import { User } from '../models/user.model';

export class CompanySamlAuthenticator extends BaseSamlAuthenticator<string, User> {
    readonly name: string = 'company-saml';
    readonly issuer: string = 'https://idp.example.com/saml';
    readonly entityId: string = 'https://app.example.com/saml';
    readonly identityProvider: SamlIdentityProvider = { metadataUrl: 'https://idp.example.com/saml/metadata' };
}
```

Register it like any other provider, and add a `loggedOutUrl` to the [options](#setting-it-up). Set the identity provider up with the metadata of your application at `{baseUrl}/auth/federated/company-saml/metadata`, which most identity providers read from the URL. It names the entity id, the callback, the logout route for redirected and posted messages, the SOAP logout route, the NameID asked for and the certificates of your keys.

| Member | What it is |
|---|---|
| `name` | What the routes of the provider are reached under. Lowercase letters, digits and dashes, and unique |
| `issuer` | The entity id of the identity provider |
| `entityId` | The entity id of your application at the identity provider |
| `identityProvider` | Where the identity provider's metadata is, as `metadataUrl`. For a provider that publishes none: its `loginUrl`, the `certificates` it signs with, and its `logoutUrl` if it has one |
| `nameIdFormat` | Which NameID the identity provider is asked for. `SamlNameIdFormat.PERSISTENT` by default |
| `requestedAuthnContext` | The classes of authentication the identity provider is asked for, such as one that stands for a second factor. None by default, which leaves how the user logs in to the provider, see [accepting the provider's second factor](./two-factor.md#accepting-the-providers-second-factor) |
| `signingKey` | The key requests, and logout answers that are posted or sent in a SOAP envelope, are signed with, for a provider that asks for signed messages. None by default |
| `decryptionKey` | The key assertions are encrypted to, for a provider that encrypts them. None by default |
| `acceptedClockSkewInMs` | How far the identity provider's clock may differ from your application's when an answer's times are checked. One minute by default |
| `metadataMaxAgeInMs` | How long the identity provider's metadata is kept before it is read again. One day by default |
| `resolveProfile` | Reads the email and names out of the attributes the provider sends. Override it for a provider that names them differently |
| `resolveLoginUser` | Answers the user a later login logs in as, from the attributes of the assertion and its NameID, see [later logins](#later-logins) |

The metadata is read on the first login and again once `metadataMaxAgeInMs` passed, so a certificate the provider rotates is picked up. With certificates given by hand, list the next one next to the current one before the provider rotates it. A key is a PEM encoded private key and its certificate:

```ts
// src/auth/partner-saml.authenticator.ts
import { readFileSync } from 'node:fs';

import { BaseSamlAuthenticator, SamlIdentityProvider, SamlKeyPair } from 'zibri';

import { User } from '../models/user.model';

export class PartnerSamlAuthenticator extends BaseSamlAuthenticator<string, User> {
    readonly name: string = 'partner-saml';
    readonly issuer: string = 'https://sso.partner.example.com';
    readonly entityId: string = 'https://app.example.com/saml';
    readonly identityProvider: SamlIdentityProvider = {
        loginUrl: 'https://sso.partner.example.com/saml/sso',
        certificates: [readFileSync('partner-idp.crt', 'utf8')],
        logoutUrl: 'https://sso.partner.example.com/saml/slo'
    };
    override readonly signingKey: SamlKeyPair = {
        privateKey: readFileSync('saml-signing.key', 'utf8'),
        certificate: readFileSync('saml-signing.crt', 'utf8')
    };
    override readonly decryptionKey: SamlKeyPair = {
        privateKey: readFileSync('saml-encryption.key', 'utf8'),
        certificate: readFileSync('saml-encryption.crt', 'utf8')
    };
}
```

The NameID is who the user is at the identity provider, and links them to an account. A persistent one stays the same for the user at your application. An email address changes when their email does, which links them to a new identity. A transient NameID, new for every login, is refused. The provider does not say whether it verified the email, so `emailVerified` is undefined.

An answer is taken when it answers the request this browser sent, is signed by the identity provider, and is meant for your application. A login the identity provider starts on its own, such as from the tile of your application in its portal, is refused: point the tile at a page of your frontend that starts the login, or at `GET /auth/federated/login/request` of a login that [logs the user in on the redirect back](#logging-in-on-the-redirect-back).

The identity provider is asked to have the user log in again with `reauthenticate=true`. A login at the provider that is older than `maxAuthenticationAgeInMs` sends the browser back to the provider to log in again, and from there on to `redirectTo`.

The identity provider posts its answer to the callback, so, as with a [provider that answers with a form post](#providers-that-answer-with-a-form-post), the application is reached over HTTPS, or on `localhost` while you develop.

## Requirements
| Package | Used for |
|---|---|
| `openid-client` | Logging in at OpenID Connect and OAuth2 providers, and calling their APIs. You install it |
| `@node-saml/node-saml` | Logging in and logging out at SAML 2.0 identity providers. You install it |

Your data source declares these entities:

| Entity | Needed when |
|---|---|
| `FederatedIdentity`, `FederatedLoginAttempt`, `FederatedHandoverCode`, `FederatedRegistrationTicket`, `FederatedConnectionCode` | An authenticator of a provider is registered |
| `OAuthProviderTokens` | An authenticator of a provider names `apiScopes` |

How large each table grows, and what deletes its rows, is in [framework tables](./framework-tables.md).

## See also
- [Authentication](./auth.md) — strategies, authenticators and the password login
- [Two factor](./two-factor.md) — a recent login in place of a second factor
- [Accepting a provider's tokens](./provider-tokens.md) — a mobile app or a service calling your API with a token of the provider
- [Testing](./testing.md#logging-in-through-a-provider) — a provider running inside your tests