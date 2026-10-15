# Sign-in through a provider
Users sign in with an account they already have somewhere else: Google, Apple, Microsoft Entra ID, your company's Keycloak, or any other OpenID Connect provider, GitHub or any other provider that speaks plain OAuth2, and any SAML 2.0 identity provider. The sign-in ends in the same jwt or cookie login a password gives, so refreshing, logging out and `@Auth.require2fa` work the same.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `FederatedAuthenticatorInterface`, `isFederatedAuthenticator` | interface, function | What a provider's authenticator is to the sign-in routes, and the function telling one apart |
| `FederatedRoute` | type | A route whose url an authenticator gives out: `callback`, `connect` or `logout` |
| `FederatedRouteEndpoint` | type | One of the `routes` of an authenticator: the route, and the method the browser requests its url with |
| `BaseFederatedAuthenticator` | class | What every provider's authenticator extends, whichever protocol it speaks: the redirect, the callback and the links |
| `BaseOAuthAuthenticator` | class | What every OAuth and OpenID Connect provider's authenticator extends: the client, the scopes and the tokens of the provider's apis |
| `BaseOidcAuthenticator` | class | Extend it once per OpenID Connect provider, naming the provider and your client there |
| `BaseOAuth2Authenticator` | class | Extend it once per provider that speaks plain OAuth2, naming its endpoints and reading the user from its api |
| `BaseGitHubAuthenticator` | class | A GitHub account. Extend it with your OAuth app |
| `BaseGoogleAuthenticator` | class | A Google account. Extend it with your client |
| `BaseAppleAuthenticator` | class | An Apple account. Extend it with your services id, team and key |
| `BaseMicrosoftAuthenticator` | class | An account of a Microsoft Entra ID tenant. Extend it with the tenant and your client |
| `BaseKeycloakAuthenticator` | class | A user of a Keycloak realm. Extend it with the url, the realm and your client |
| `BaseSamlAuthenticator` | class | Extend it once per SAML 2.0 identity provider, naming the provider and your application there |
| `SamlIdentityProvider` | type | Where a SAML identity provider's metadata is, or where it signs users in and what it signs with |
| `SamlKeyPair` | type | A key of your application and its certificate, for signed requests and encrypted assertions |
| `SamlNameIdFormat` | enum | Which NameID a SAML identity provider is asked for |
| `LogoutResult` | class | What a logout answers: where to log out at the provider as well |
| `FederatedSession`, `FederatedSessionMatch`, `FederatedSessionUtilities` | type, type, class | The session at a provider a login was started from, for a strategy of your own to keep with the login and end it by |
| `OAuthClientAuthentication` | type | How your client proves itself to the provider: a client secret or a private key |
| `OAuthClientSecret` | type | A client secret, or a function resolving it before every exchange |
| `OAuthResponseMode` | type | How the provider sends its answer back: `query` or `form_post` |
| `FederatedCallbackForm` | class | The answer a provider posts to the callback |
| `FederationOptions` | type | What every provider shares, via `ZIBRI_DI_TOKENS.FEDERATION_OPTIONS`. Required |
| `AuthController` | function | Defines the sign-in routes, among the other auth routes. See [the auth routes](./auth-routes.md) |
| `FederatedRouteUtilities` | class | What the sign-in routes share: finding the provider a route names, reading its answer, and where the browser goes next |
| `FederatedTicketCredentials` | class | The ticket a first sign-in continues with at your registration |
| `FederatedHandoverCredentials` | class | The one-time code a login is handed over to the frontend with |
| `FederatedRegistration` | type | Who signed in, as the provider reports them |
| `FederatedProviderIdentity`, `FederatedProfile` | type | Who signed in at a provider, and what it reports about them |
| `OAuthProviderSignIn` | type | Who signed in at a provider, and the tokens the code was exchanged for |
| `FederatedIdentity` | entity | An identity at a provider, linked to a user to sign in, to call the provider's apis, or both |
| `OAuthProviderTokens` | entity | The tokens kept for an identity, for calling the provider's apis |
| `FederatedLoginAttempt`, `FederatedHandoverCode`, `FederatedRegistrationTicket`, `FederatedConnectionCode` | entity | A sign-in on its way |
| `FederatedSignInFailure` | enum | Why a sign-in failed, as your error page is told |
| `FederatedSignInAction` | type | What a sign-in is for, as the audit trail records it: a login, or connecting a provider |
| `FederatedConnectionRequest` | class | Where the browser goes once the provider is connected, and what the connection is for: signing in, the scopes of the provider's apis, or both |
| `FederatedConnectionStart` | class | Where to send the browser to connect a provider to an account |
| `OAuthOfflineAccess` | type | How a provider is asked for a refresh token |
| `ProviderAccessError`, `ProviderAccessFailure` | class, enum | Why there is no access token for calling a provider's apis |

## Setting it up
Install `openid-client`, and declare the five entities in the data source your users live in:

```ts
// src/data-sources/db.data-source.ts
import { FederatedConnectionCode, FederatedHandoverCode, FederatedIdentity, FederatedLoginAttempt, FederatedRegistrationTicket } from 'zibri';

export const federationEntities = [FederatedLoginAttempt, FederatedIdentity, FederatedHandoverCode, FederatedRegistrationTicket, FederatedConnectionCode];
```

Extend the authenticator of your provider with the client you registered there, register it, and give it to the [auth routes](./auth-routes.md):

```ts
// src/auth/google.authenticator.ts
import { AuthController, BaseGoogleAuthenticator, Controller, CookieAuthStrategy, OAuthClientAuthentication, OtpTwoFactorMethod, ZibriApplicationOptions } from 'zibri';

import { Roles } from './roles.enum';
import { User } from './user.entity';

export class GoogleAuthenticator extends BaseGoogleAuthenticator<Roles, User> {
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

export const signInOptions: Pick<ZibriApplicationOptions, 'authenticators' | 'authStrategies' | 'controllers'> = {
    authenticators: [GoogleAuthenticator],
    authStrategies: [CookieAuthStrategy],
    controllers: [AppAuthController]
};
```

In the settings of the client at the provider, enter `{baseUrl}/auth/federated/google/callback` as its redirect uri, with the `baseUrl` of your application options. The `google` is the provider's `name`, which every route the provider sends the browser to is reached under.

The routes are below the path of your auth controller and `/federated`: for `@Controller('/sign-in', { versions: 'all' })` the redirect uri is `{baseUrl}/sign-in/federated/google/callback`. To write the routes yourself, see [Routes of your own](#routes-of-your-own).

Then provide the options every provider shares:

```ts
// src/providers.ts
import { defineProvider, ZIBRI_DI_TOKENS } from 'zibri';

export const federationOptionsProvider = defineProvider({
    token: ZIBRI_DI_TOKENS.FEDERATION_OPTIONS,
    useValue: {
        allowedRedirects: ['https://app.example.com'],
        registrationUrl: 'https://app.example.com/register',
        errorUrl: 'https://app.example.com/sign-in-failed',
        maxAuthenticationAgeInMs: 86400000
    }
});
```

| Option | What it is |
|---|---|
| `allowedRedirects` | Where a sign-in may go once it is done. An entry allows its origin, and its path and everything below it |
| `registrationUrl` | Where a sign-in goes when no user is linked to the identity, see [A first sign-in](#a-first-sign-in) |
| `errorUrl` | Where a sign-in goes when it fails |
| `signedOutUrl` | Where the browser lands once the provider ended its session, see [Logging out](#logging-out). Required for a [SAML](#saml) identity provider |
| `maxAuthenticationAgeInMs` | How long ago the user may have signed in at the provider. An older sign-in makes the provider ask them again |
| `loginAttemptExpiresInMs` | How long the sign-in at the provider may take. 10 minutes by default |
| `registrationTicketExpiresInMs` | How long the registration may take afterwards. 30 minutes by default |
| `handoverCodeExpiresInMs` | How long the code a login is [handed over by](#handing-the-login-over-by-code) stays valid. 1 minute by default |
| `connectionCodeExpiresInMs` | How long the url that [connects a provider](#connecting-a-provider-to-an-account) stays valid. 1 minute by default |

### Routes of your own
The routes can also be ones you write. An authenticator gives out the urls of its `routes`, each with the method the browser requests it with:

| Route | Method |
|---|---|
| `callback` | `GET`, or `POST` when the provider posts its answer: a [SAML](#saml) identity provider, or a `responseMode` of `form_post` |
| `connect` | `GET` |
| `logout` | `GET`, for a [SAML](#saml) identity provider only |

Override `resolveRouteUrl` to name yours, and `routes` to keep the ones you serve. Leave out `connect` when you do not [connect providers to accounts](#connecting-a-provider-to-an-account):

```ts
// src/auth/google.authenticator.ts
import { FederatedRoute, FederatedRouteEndpoint } from 'zibri';

// for the baseUrl https://api.example.com
export class OwnRoutesGoogleAuthenticator extends GoogleAuthenticator {
    override get routes(): FederatedRouteEndpoint[] {
        return super.routes.filter(endpoint => endpoint.route === 'callback');
    }

    override resolveRouteUrl(route: FederatedRoute): string {
        return `https://api.example.com/login/google-${route}`;
    }
}
```

Your routes call `startSignIn` and `completeSignIn` of the authenticator, and `AuthServiceInterface.login` with the code the sign-in hands over. `FederatedRouteUtilities` has what the sign-in routes of the auth controller use. An authenticator that extends none of the base classes implements `FederatedAuthenticatorInterface`.

The application refuses to start while a url an authenticator gives out is not below the `baseUrl`, or reaches no route of it that answers the url's method.

## Signing in
The frontend sends the browser to the authorize route, naming the provider and where the browser goes afterwards, see [signing in at a provider](./auth-routes.md#signing-in-at-a-provider). The sign-in either logs in on the redirect back, or hands the login over by code.

### Logging in on the redirect back
Without a `codeChallenge`, the sign-in logs in on the redirect back, which only a strategy whose login goes out with the response can do, such as `CookieAuthStrategy`:

```txt
GET /auth/federated/authorize?authenticator=google&redirectTo=https://app.example.com/home
```

The browser signs in at the provider, comes back to the callback, and lands on `redirectTo` with the session cookies set. Read the csrf token from `GET /auth/csrf-token` once it is back. When your auth controller has more than one such strategy, name it in `strategy`.

### Handing the login over by code
With a `codeChallenge`, the sign-in hands the login over by code, for every strategy. The frontend makes a PKCE verifier, a random string it keeps, and sends the browser to the authorize route with its challenge, the base64url sha256 of it:

```txt
GET /auth/federated/authorize?authenticator=google&redirectTo=https://app.example.com/home&codeChallenge=...
```

The browser lands on `redirectTo` with a one-time `code` in the query. The frontend logs in with it, together with the verifier:

```txt
POST /auth/login?authenticator=google
{ "code": "...", "codeVerifier": "..." }
```

The code is only good with that verifier, and only once.

## When a sign-in fails
The browser lands on `errorUrl` with an `error`:

| `error` | What happened |
|---|---|
| `cancelled` | The user did not allow the sign-in at the provider |
| `provider_error` | The provider answered with an error, or could not be reached |
| `expired` | The sign-in took too long, was completed already, or was started in another browser |
| `invalid` | The provider's answer could not be verified |
| `already_linked` | The identity being [connected](#connecting-a-provider-to-an-account) is linked to another user |
| `not_for_sign_in` | The identity is linked to a user for [the provider's apis](#calling-a-providers-apis) only |

## A first sign-in
When no user is linked to the identity, the browser lands on `registrationUrl` with a one-time `ticket`. Your registration reads who signed in, creates the user and links the identity, and logs them in with the ticket. Create and link in one transaction, and log in once it is committed:

```ts
// src/controllers/registration.controller.ts
import { AuthServiceInterface, Body, CookieAuthData, CookieAuthStrategy, Controller, Inject, inject, FederatedRegistration, FederatedTicketCredentials, Post, Repository, repositoryTokenFor, Transaction, ZIBRI_DI_TOKENS } from 'zibri';

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
            await this.authService.linkIdentity(GoogleAuthenticator, credentials, user.id, transaction);
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

The ticket is only good in the browser the sign-in started in. For a sign-in started with a `codeChallenge`, send the verifier with it, as `codeVerifier`.

A sign-in never finds a user by email. An identity signs in as the user it is linked to, or goes to the registration. Use `emailVerified` before you trust the email the provider reports.

## Connecting a provider to an account
A user who is logged in connects a provider to their account. A connection with `signIn: true` adds a way to sign in: the user signs in through the provider as well as the way they did before, such as with their password. A connection can also be for [the provider's apis](#calling-a-providers-apis), with or without signing in.

Connecting starts at the connect route of the [auth routes](./auth-routes.md), which answers with the url to send the browser to:

```txt
POST /auth/connect?authenticator=google
{ "redirectTo": "https://app.example.com/account", "signIn": true }

200 { "url": "https://accounts.google.com/o/oauth2/v2/auth?..." }
```

The route connects the provider to the user logged in with the request. `signIn` is required. Connecting again with `signIn: true` an identity that is linked for the apis only turns signing in on for it. The route takes a second factor, or a [recent login](./two-factor.md#accepting-a-recent-login-instead) in its place. In a route of your own, `startConnection` of `AuthServiceInterface` does the same.

The frontend sends the browser to the url. The user [signs in again](#signing-in-again) at the provider, even when the provider still has a session of theirs, and the browser lands on `redirectTo` with the identity linked. An identity that is linked to another user lands on `errorUrl` with `already_linked`. The url is good once.

### Listing and unlinking
`GET /auth/identities` lists the identities linked to the user logged in with the request, each with the name of the provider it is linked through. Each says whether it signs in, in `signIn`, and which scopes of the provider's apis it was granted, in `grantedScopes`. `DELETE /auth/identities/{identityId}` unlinks one, and takes a second factor or a recent login like connecting does:

```txt
GET /auth/identities
200 [{ "authenticator": "google", "identity": { "id": "...", "signIn": true, "grantedScopes": [] } }]

DELETE /auth/identities/...
```

In routes of your own, `findIdentities` and `unlinkIdentity` of `AuthServiceInterface` do the same. Pass authenticators to `findIdentities` to list only the identities at those providers.

A user who has no password can no longer sign in once their last identity is unlinked. Check that they keep a way to sign in before you unlink one.

## Calling a provider's apis
An identity can also let your application call the provider's apis for the user, such as reading their Google calendar. Name the scopes of those apis your application may ask for in `apiScopes`, and declare `OAuthProviderTokens` next to the other entities:

```ts
// src/auth/google-calendar.authenticator.ts
import { BaseGoogleAuthenticator, OAuthClientAuthentication } from 'zibri';

import { Roles } from './roles.enum';
import { User } from './user.entity';

export class GoogleCalendarAuthenticator extends BaseGoogleAuthenticator<Roles, User> {
    readonly clientId: string = process.env['GOOGLE_CLIENT_ID'] ?? '';
    readonly clientAuthentication: OAuthClientAuthentication = {
        method: 'client_secret_basic',
        clientSecret: process.env['GOOGLE_CLIENT_SECRET'] ?? ''
    };
    override readonly apiScopes: string[] = ['https://www.googleapis.com/auth/calendar.readonly'];
}
```

Ask for the scopes when the user turns on what needs them, by [connecting](#connecting-a-provider-to-an-account) the provider with `scopes`. With `signIn: false`, the identity is linked for the apis only, and a sign-in through it lands on `errorUrl` with `not_for_sign_in`:

```ts
// src/services/calendar-connection.function.ts
import { AuthServiceInterface, FederatedConnectionStart } from 'zibri';

export async function startCalendarConnection(authService: AuthServiceInterface, redirectTo: string): Promise<FederatedConnectionStart> {
    return await authService.startConnection(GoogleCalendarAuthenticator, {
        redirectTo,
        signIn: false,
        scopes: ['https://www.googleapis.com/auth/calendar.readonly']
    });
}
```

A sign-in can ask for them as well, with `scopes` on the authorize route, separated by spaces:

```txt
GET /auth/federated/authorize?authenticator=google&redirectTo=https://app.example.com/home&scopes=https://www.googleapis.com/auth/calendar.readonly
```

A scope that is not one of the `apiScopes` is refused. The provider is asked for a refresh token along with the scopes, so the apis can be called while the user is away. The tokens are kept encrypted, with the scopes the user granted, which can be fewer than were asked for.

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

A kept access token that has expired, or is about to, is replaced with the refresh token first, one request at a time for an identity. When there is no access token, `resolveProviderAccessToken` throws a `ProviderAccessError`. Connect the provider again with the scopes to get one:

| `failure` | What happened |
|---|---|
| `not_connected` | No tokens are kept for the identity |
| `missing_scopes` | The user did not grant every scope asked for |
| `expired` | The access token expired, and the provider issued no refresh token |
| `revoked` | The provider refused the refresh token, because the user removed your application there. The tokens are removed |

`revokeProviderAccess` removes the tokens of an identity and hands them back to the provider. An identity that signs in keeps signing in. One that is linked for the apis only is unlinked. `unlinkIdentity` hands the tokens back too. The tokens are removed even when the provider cannot be reached, and Microsoft Entra ID takes no tokens back.

```ts
// src/services/calendar-disconnection.function.ts
import { AuthServiceInterface } from 'zibri';

export async function stopCalendarAccess(authService: AuthServiceInterface, userId: string, identityId: string): Promise<void> {
    await authService.revokeProviderAccess(userId, identityId, undefined);
}
```

## Signing in again
Add `reauthenticate=true` to the authorize route, and the provider asks the user to sign in again instead of using the session it has. Google and GitHub cannot be asked for that, and have the user pick their account instead. The login time of a sign-in is when the user signed in at the provider, which is what a route accepting a [recent login](./two-factor.md#accepting-a-recent-login-instead) checks. A sign-in through a [provider that speaks plain OAuth2](#providers-that-speak-plain-oauth2) never counts as a recent login.

## Logging out
`POST /auth/logout` ends the login, and answers with a `providerLogoutUrl` when the user can log out at the provider the login was started at as well. A [SAML](#saml) identity provider with a single logout url is such a provider:

```txt
POST /auth/logout
200 { "providerLogoutUrl": "https://idp.example.com/saml/slo?SAMLRequest=..." }
```

Send the browser to the url. The provider ends its session, and sends the browser back to `{baseUrl}/auth/federated/{name}/logout`, which lands it on `signedOutUrl`. Without a `providerLogoutUrl`, the logout is done.

A user who logs out at the provider is logged out here as well. The provider sends the browser to the same route with a logout request, which ends every login started from that session at the provider, and the browser goes back to the provider. A logout request that names no session ends every login the user started at that provider. One that is not signed by the provider is refused with `401`.

## Other providers
Extend `BaseOidcAuthenticator` for any other OpenID Connect provider:

```ts
// src/auth/company.authenticator.ts
import { BaseOidcAuthenticator, OAuthClientAuthentication } from 'zibri';

import { Roles } from './roles.enum';
import { User } from './user.entity';

export class CompanyAuthenticator extends BaseOidcAuthenticator<Roles, User> {
    readonly name: string = 'company';
    readonly issuer: string = 'https://sso.example.com';
    readonly clientId: string = 'my-app';
    readonly clientAuthentication: OAuthClientAuthentication = {
        method: 'client_secret_post',
        clientSecret: process.env['COMPANY_CLIENT_SECRET'] ?? ''
    };
}
```

| Member | What it is |
|---|---|
| `name` | What the routes of the provider are reached under. Lowercase letters, digits and dashes, and unique |
| `issuer` | The provider's issuer url |
| `clientId` | Your client at the provider |
| `clientAuthentication` | `client_secret_basic` or `client_secret_post` with a secret, or `private_key_jwt` with a private key. A secret can be a function, which runs before every exchange |
| `scopes` | What the provider is asked for. `openid`, `email` and `profile` by default |
| `allowedAlgorithms` | What the ID token may be signed with. `RS256`, `PS256`, `ES256` and `EdDSA` by default |
| `responseMode` | How the provider sends its answer back. `query` by default, see [form post](#providers-that-answer-with-a-form-post) |
| `reauthenticationPrompt` | The `prompt` that asks the provider to have the user sign in again. `login` by default |
| `apiScopes` | The scopes of the provider's apis a sign-in or a connection may ask for. None by default |
| `offlineAccess` | How the provider is asked for a refresh token: the `offline_access` scope and the `consent` prompt by default |
| `resolveProfile` | Reads the email and names out of the ID token, and out of what the provider sent next to the code. Override it for a provider that names them differently |

A provider is reached over https. A provider on `localhost` is reached over http as well.

## Providers that speak plain OAuth2
Some providers, GitHub among them, speak OAuth2 without OpenID Connect. Extend `BaseOAuth2Authenticator` for such a provider, with its endpoints, an issuer its identities are known by, and how to read the user from its api with the access token of the sign-in:

```ts
// src/auth/forge.authenticator.ts
import { BaseOAuth2Authenticator, OAuthClientAuthentication, FederatedProviderIdentity } from 'zibri';

import { Roles } from './roles.enum';
import { User } from './user.entity';

export class ForgeAuthenticator extends BaseOAuth2Authenticator<Roles, User> {
    readonly name: string = 'forge';
    readonly issuer: string = 'https://forge.example.com';
    readonly authorizationEndpoint: string = 'https://forge.example.com/oauth/authorize';
    readonly tokenEndpoint: string = 'https://forge.example.com/oauth/token';
    readonly scopes: string[] = ['read_user'];
    readonly clientId: string = 'my-app';
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
| `authorizationEndpoint` | Where the browser signs in at the provider |
| `tokenEndpoint` | Where the code is exchanged for an access token |
| `revocationEndpoint` | Where tokens are handed back once they are no longer kept. None by default |
| `scopes` | What the provider is asked for |
| `resolveIdentity` | Reads who signed in from the provider's api: an id that stays the same for the account, and what the provider reports about them |
| `fetchJson` | Reads json from the provider's api with the access token |

The provider does not say when the user signed in there, so a sign-in through it never counts as a [recent login](./two-factor.md#accepting-a-recent-login-instead). A route that takes a recent login in place of a second factor asks such a user for the second factor.

## Providers that answer with a form post
Some providers send their answer back as a page that posts it to the callback, so the code never appears in a url. Apple does, and Microsoft Entra ID and Okta can. Set `responseMode` to `form_post` for such a provider:

```ts
// src/auth/okta.authenticator.ts
import { BaseOidcAuthenticator, OAuthClientAuthentication, OAuthResponseMode } from 'zibri';

import { Roles } from './roles.enum';
import { User } from './user.entity';

export class OktaAuthenticator extends BaseOidcAuthenticator<Roles, User> {
    readonly name: string = 'okta';
    readonly issuer: string = 'https://example.okta.com';
    readonly clientId: string = 'my-app';
    readonly clientAuthentication: OAuthClientAuthentication = {
        method: 'client_secret_basic',
        clientSecret: process.env['OKTA_CLIENT_SECRET'] ?? ''
    };
    override readonly responseMode: OAuthResponseMode = 'form_post';
}
```

The callback url is the same. It takes the post from the provider's sign-in page and from nowhere else, see [a route other sites post to](./app-settings.md#a-route-other-sites-post-to). The browser carries the cookie of the sign-in along with it only over https, so an application signing in through such a provider is reached over https, or on `localhost` while you develop.

## Apple
Extend `BaseAppleAuthenticator` with your services id as the client id, your team id, and the id of the key you created for Sign in with Apple and the contents of its `.p8` file:

```ts
// src/auth/apple.authenticator.ts
import { readFileSync } from 'node:fs';

import { BaseAppleAuthenticator } from 'zibri';

import { Roles } from './roles.enum';
import { User } from './user.entity';

export class AppleAuthenticator extends BaseAppleAuthenticator<Roles, User> {
    readonly clientId: string = 'com.example.app.sign-in';
    readonly teamId: string = 'TEAM123456';
    readonly keyId: string = 'KEY1234567';
    readonly privateKey: string = readFileSync('apple-sign-in.p8', 'utf8');
}
```

The client secret Apple takes is a token signed with that key, and the authenticator signs a new one for every sign-in. Apple answers with a form post. It sends the user's name next to the code on their first sign-in only, so a registration reads it from `givenName` and `familyName` then or never. The email Apple reports is often an address of its private relay.

## GitHub
Extend `BaseGitHubAuthenticator` with the client id and secret of the OAuth app you registered at GitHub:

```ts
// src/auth/github.authenticator.ts
import { BaseGitHubAuthenticator } from 'zibri';

import { Roles } from './roles.enum';
import { User } from './user.entity';

export class GitHubAuthenticator extends BaseGitHubAuthenticator<Roles, User> {
    readonly clientId: string = process.env['GITHUB_CLIENT_ID'] ?? '';
    readonly clientAuthentication: OAuthClientAuthentication = {
        method: 'client_secret_post',
        clientSecret: process.env['GITHUB_CLIENT_SECRET'] ?? ''
    };
}
```

In the settings of the OAuth app at GitHub, enter `{baseUrl}/auth/federated/github/callback` as its callback url. The identity is the id of the GitHub account, which stays the same when the user renames it. The email is the account's primary one, with whether GitHub has verified it, and the name is the one name GitHub keeps, in `name`. Signing in again has the user pick their account, since GitHub cannot be told to ask for the password again. An access token of an OAuth app does not expire, and revoking the access withdraws what the user allowed your OAuth app.

## SAML
Install `@node-saml/node-saml`, and extend `BaseSamlAuthenticator` for a SAML 2.0 identity provider, such as Microsoft Entra ID, Okta, ADFS or Keycloak:

```ts
// src/auth/company-saml.authenticator.ts
import { BaseSamlAuthenticator, SamlIdentityProvider } from 'zibri';

import { Roles } from './roles.enum';
import { User } from './user.entity';

export class CompanySamlAuthenticator extends BaseSamlAuthenticator<Roles, User> {
    readonly name: string = 'company-saml';
    readonly issuer: string = 'https://idp.example.com/saml';
    readonly entityId: string = 'https://app.example.com/saml';
    readonly identityProvider: SamlIdentityProvider = { metadataUrl: 'https://idp.example.com/saml/metadata' };
}
```

Register it like any other provider, and add a `signedOutUrl` to the [options](#setting-it-up). Set the identity provider up with the metadata of your application at `{baseUrl}/auth/federated/company-saml/metadata`, which most identity providers read from the url. It names the entity id, the callback, the logout route, the NameID asked for and the certificates of your keys.

| Member | What it is |
|---|---|
| `name` | What the routes of the provider are reached under. Lowercase letters, digits and dashes, and unique |
| `issuer` | The entity id of the identity provider |
| `entityId` | The entity id of your application at the identity provider |
| `identityProvider` | Where the identity provider's metadata is, as `metadataUrl`. For a provider that publishes none: its `signInUrl`, the `certificates` it signs with, and its `logoutUrl` if it has one |
| `nameIdFormat` | Which NameID the identity provider is asked for. `SamlNameIdFormat.PERSISTENT` by default |
| `signingKey` | The key requests are signed with, for a provider that asks for signed requests. None by default |
| `decryptionKey` | The key assertions are encrypted to, for a provider that encrypts them. None by default |
| `resolveProfile` | Reads the email and names out of the attributes the provider sends. Override it for a provider that names them differently |

The metadata is read on the first sign-in and again once a day, so a certificate the provider rotates is picked up. With certificates given by hand, list the next one next to the current one before the provider rotates it. A key is a PEM encoded private key and its certificate:

```ts
// src/auth/partner-saml.authenticator.ts
import { readFileSync } from 'node:fs';

import { BaseSamlAuthenticator, SamlIdentityProvider, SamlKeyPair } from 'zibri';

import { Roles } from './roles.enum';
import { User } from './user.entity';

export class PartnerSamlAuthenticator extends BaseSamlAuthenticator<Roles, User> {
    readonly name: string = 'partner-saml';
    readonly issuer: string = 'https://sso.partner.example.com';
    readonly entityId: string = 'https://app.example.com/saml';
    readonly identityProvider: SamlIdentityProvider = {
        signInUrl: 'https://sso.partner.example.com/saml/sso',
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

The NameID is who the user is at the identity provider, and links them to an account. A persistent one stays the same for the user at your application. An email address changes when their email does, which links them to a new identity. A transient NameID, new for every sign-in, is refused. The provider does not say whether it verified the email, so `emailVerified` is undefined.

An answer is taken when it answers the request this browser sent, is signed by the identity provider, and is meant for your application. A sign-in the identity provider starts on its own, such as from the tile of your application in its portal, is refused: point the tile at a page of your frontend that starts the sign-in, or at the authorize route of a sign-in that [logs in on the redirect back](#logging-in-on-the-redirect-back).

The identity provider is asked to have the user sign in again with `reauthenticate=true`. A sign-in at the provider that is older than `maxAuthenticationAgeInMs` sends the browser back to the provider to sign in again, and from there on to `redirectTo`.

The identity provider posts its answer to the callback, so, as with a [provider that answers with a form post](#providers-that-answer-with-a-form-post), the application is reached over https, or on `localhost` while you develop.

## See also
- [Authentication](./auth.md) — strategies, authenticators and the password login
- [Two factor](./two-factor.md) — a recent login in place of a second factor
- [Accepting a provider's tokens](./provider-tokens.md) — a mobile app or a service calling your api with a token of the provider
- [Testing](./testing.md#signing-in-through-a-provider) — a provider running inside your tests