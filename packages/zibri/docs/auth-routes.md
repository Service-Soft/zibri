# The auth routes
`AuthController` defines the routes a client logs in, refreshes and ends a login with, resets a password with, logs in at a provider with, connects an identity to an account with, and enrolls a [second factor](./glossary.md#second-factor) with. You give it the [auth strategies](./glossary.md#auth-strategy), [authenticators](./glossary.md#authenticator) and two factor methods your application registers, and it defines the routes they call for.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `AuthController` | function | Defines the auth routes of the given strategies, authenticators and two factor methods |
| `AuthControllerOptions` | type | What `AuthController` is given |
| `AuthControllerClass` | type | A controller class `AuthController` defined: the routes its options call for, and the options |
| `AuthControllerRoutes` | type | The routes `AuthController` defines for the given strategies, authenticators and two factor methods |
| `isAuthControllerClass` | function | Tells a class `AuthController` defined apart |
| `AuthControllerStrategyClass`, `AuthControllerAuthenticatorClass` | type | A class of a strategy and of an authenticator the routes log in with |
| `AuthControllerLoginRoutes`, `AuthControllerCsrfTokenRoutes`, `AuthControllerPasswordResetRoutes`, `AuthControllerLoginOptionsRoutes`, `AuthControllerRegistrationRoutes`, `AuthControllerFederatedRoutes`, `AuthControllerLinkIdentityRoutes`, `AuthControllerLinkIdentityConfirmingRoutes`, `AuthControllerIdentityRoutes`, `AuthControllerTwoFactorRoutes` | type | The methods of the routes, by the classes that call for them |
| `FEDERATED_ROUTE` | constant | Where the routes of a login at a provider are, below the path of the controller: `/federated` |
| `AuthControllerUtilities` | class | What the routes share: finding the class a request names, checking a body against one model, running in a transaction of a strategy |
| `AuthControllerStrategyInterface`, `isAuthControllerStrategy` | interface, function | What a strategy the routes log in with implements |
| `CsrfTokenAuthStrategyInterface`, `isCsrfTokenAuthStrategy` | interface, function | What a strategy issuing CSRF tokens implements |
| `AuthControllerAuthenticatorInterface`, `isAuthControllerAuthenticator` | interface, function | What an authenticator the login route logs in with implements |
| `LoginOptionsAuthenticatorInterface`, `isLoginOptionsAuthenticator` | interface, function | What an authenticator handing out a challenge to log in with implements, such as a [passkey](./glossary.md#passkey) |
| `RegistrationAuthenticatorInterface`, `isRegistrationAuthenticator` | interface, function | What an authenticator registering a user by itself implements, such as a passkey |
| `LinkIdentityRequestingAuthenticatorInterface`, `isLinkIdentityRequestingAuthenticator` | interface, function | What an authenticator whose identities a user links to their account implements |
| `LinkIdentityConfirmingAuthenticatorInterface`, `isLinkIdentityConfirmingAuthenticator` | interface, function | What an authenticator confirming a link with an answer of the client implements |
| `CsrfToken` | class | What `GET csrf-token` answers with |
| `RequestPasswordResetInput`, `PasswordResetTokenInput`, `PasswordResetTokenValidity`, `ConfirmPasswordResetDto` | class | What the password reset routes take and answer with |

## Setting it up
Extend the class `AuthController` defines with a `@Controller` of your own, and register it:

```ts
// src/controllers/auth.controller.ts
import { AuthController, Controller, CookieAuthStrategy, JwtAuthStrategy, OtpTwoFactorMethod, PasswordAuthenticator } from 'zibri';

import { GoogleAuthenticator } from '../auth/google.authenticator';

@Controller('/auth', { versions: 'all' })
export class AppAuthController extends AuthController({
    strategies: [JwtAuthStrategy, CookieAuthStrategy],
    authenticators: [PasswordAuthenticator, GoogleAuthenticator],
    twoFactorMethods: [OtpTwoFactorMethod]
}) {}
```

| Option | What it is |
|---|---|
| `strategies` | The auth strategies that log in. At least one |
| `authenticators` | The authenticators a login is proven with. At least one |
| `twoFactorMethods` | The two factor methods a user enrolls. None for no 2FA routes |

Name exactly what your application registers: its auth strategies that log in, its authenticators, and its two factor methods, including the ones it registers when you configure none, `JwtAuthStrategy`, `PasswordAuthenticator` and `OtpTwoFactorMethod`. An application has one controller `AuthController` defines.

## The routes
Every route is below the path of your controller. A route is there when one of the classes you give calls for it:

| Route | There when | Takes | Who calls it |
|---|---|---|---|
| `POST /login` | always | the credentials of the authenticator, such as `{ "email", "password" }` | anyone |
| `POST /refresh-login` | always | what the strategy refreshes with, such as `{ "refreshToken" }` | anyone |
| `POST /logout` | always | what the strategy logs out with, such as `{ "refreshToken" }`, or `{ "clearCookies" }` for the login of the cookies the request carries. Answers where to log out at the provider the login was started at, if any | anyone |
| `GET /csrf-token` | a strategy issues CSRF tokens, such as `CookieAuthStrategy` | nothing. Answers the token of the login the request carries | anyone |
| `POST /request-password-reset` | `PasswordAuthenticator` | `{ "email" }`, see [asking for a password reset](./auth.md#asking-for-a-password-reset) | anyone |
| `POST /verify-password-reset-token` | `PasswordAuthenticator` | `{ "resetToken" }`. Answers `{ "isValid" }` | anyone |
| `POST /confirm-password-reset` | `PasswordAuthenticator` | `{ "resetToken", "newPassword" }` | anyone |
| `POST /login-options` | an authenticator hands out a challenge to log in with, such as `PasskeyAuthenticator` | nothing. Answers the challenge | anyone |
| `POST /registration/request`, `POST /registration/confirm` | an authenticator registers users by itself, such as `PasskeyAuthenticator` | what the registration starts with, and the client's answer. `registration/confirm` answers the [ticket](./glossary.md#ticket) your own registration route creates the user with | anyone |
| `GET /federated/login/request` | an authenticator logs users in at a provider | see [logging in at a provider](#logging-in-at-a-provider) | anyone |
| `GET`/`POST /federated/:provider/callback`, `GET /federated/:provider/link-identity`, `GET`/`POST /federated/:provider/logout`, `GET /federated/:provider/metadata` | an authenticator logs users in at a provider | what the provider sends the browser with | the browser, sent by the provider |
| `POST /federated/:provider/logout/soap` | a [SAML](./login-through-a-provider.md#logging-out) identity provider | a logout request in a SOAP envelope. Answers in one | the identity provider |
| `POST /federated/:provider/logout/back-channel` | an [OpenID Connect](./login-through-a-provider.md#logging-out) provider | a logout token, posted as a form. Ends the logins of the session it names | the provider |
| `POST /link-identity/request` | an authenticator links identities to an account, such as a provider or `PasskeyAuthenticator` | what the link is for, such as `{ "redirectTo", "forLogin" }`. Answers what the browser goes on with | a logged in user, with a second factor or a [recent login](./glossary.md#recent-login) |
| `POST /link-identity/confirm` | an authenticator confirms a link with an answer of the client, such as `PasskeyAuthenticator` | the client's answer | a logged in user |
| `GET /identities` | an authenticator links identities to users | nothing. Answers the identities of the user, each with the authenticator it logs in through | a logged in user |
| `DELETE /identities/:identityId` | an authenticator links identities to users | nothing | a logged in user, with a second factor or a recent login |
| `POST /2fa/registration/request` | a two factor method | what the method enrolls with, such as `{ "phoneNumber" }`, or nothing. Answers what the user is shown, such as the QR code of an authenticator app | a logged in user, with their second factor when they have one, a recent login otherwise |
| `POST /2fa/registration/confirm` | a two factor method | what confirms the enrollment, such as `{ "token" }` | a logged in user |
| `DELETE /2fa/registration/:method` | a two factor method | nothing | a logged in user, with their second factor |
| `POST /2fa/request` | a two factor method | nothing. Sends a code, or answers the challenge for a passkey | a logged in user |
| `POST /login/2fa/request` | a two factor method | nothing. Sends a code, or answers the challenge for a passkey, for a login that waits for its second factor | anyone, with the login ticket |
| `POST /login/2fa/registration/request`, `POST /login/2fa/registration/confirm` | a two factor method | what `2fa/registration/request` and `2fa/registration/confirm` take, for the user of a login that waits for a second factor and has none | anyone, with the login ticket |
| `POST /login/2fa/confirm` | a two factor method | nothing, with the second factor in its header. Answers what `login` answers | anyone, with the login ticket |

A recent login is one of the last 5 minutes, see [accepting a recent login instead](./two-factor.md#accepting-a-recent-login-instead). The login ticket is what `POST /login` answers when the application asks for a second factor at login, sent in the `x-login-ticket` header, see [asking for a second factor at login](./two-factor.md#asking-for-a-second-factor-at-login).

## Naming the strategy and the authenticator
A request names the strategy it logs in, refreshes or logs out with in the query parameter `strategy`, the authenticator it proves its login with in `authenticator`, and the two factor method in `method`, each by its `name`:

```txt
POST /auth/login?authenticator=password&strategy=cookie
{ "email": "ada@example.com", "password": "..." }
```

A parameter is required when there is more than one to choose from, and left out otherwise: an application logging in with JWTs by password is sent `POST /auth/login` with `{ "email", "password" }`. A body that is not what the authenticator it names takes is answered with `400`.

## Logging in at a provider
The frontend sends the browser to `GET /federated/login/request`, naming the provider:

| Query parameter | What it is |
|---|---|
| `authenticator` | The name of the provider, such as `google` |
| `redirectTo` | Where the browser lands once the login is done |
| `codeChallenge` | The challenge of a PKCE verifier the frontend keeps, see below |
| `strategy` | The strategy that logs in on the redirect back, see below |
| `reauthenticate` | `true` to have the provider ask the user to log in again |
| `scopes` | The scopes of the provider's APIs to ask for, separated by spaces |

It either logs the user in on the redirect back, or hands the login over by code. With a `codeChallenge` it hands it over: the browser lands on `redirectTo` with a one-time `code`, which the frontend logs in with at `POST /login`, as `{ "code", "codeVerifier" }`. Without one it logs in on the redirect, which only a strategy whose login goes out with the response can do, such as `CookieAuthStrategy`. For any other strategy, such as `JwtAuthStrategy`, a login without a `codeChallenge` is answered with `400`.

The routes the provider sends the browser to name the provider in their path, such as `/auth/federated/google/callback`, which is the redirect URI you enter at the provider. See [login through a provider](./login-through-a-provider.md).

## Leaving out a route
Leave out a route with `OmitClass`, by the method of the route, and write your own in its place:

```ts
// src/controllers/auth.controller.ts
import { AuthController, Controller, JwtAuthStrategy, OmitClass, OtpTwoFactorMethod, PasswordAuthenticator } from 'zibri';

@Controller('/auth', { versions: 'all' })
export class OwnPasswordResetAuthController extends OmitClass(
    AuthController({ strategies: [JwtAuthStrategy], authenticators: [PasswordAuthenticator], twoFactorMethods: [OtpTwoFactorMethod] }),
    ['requestPasswordReset', 'verifyPasswordResetToken', 'confirmPasswordReset']
) {}
```

The methods are only those of the routes your classes call for, so leaving out one that is not there does not compile. To write every auth route yourself, register no controller `AuthController` defined, and call `AuthServiceInterface`.

## Your own authenticator or strategy
A strategy or an authenticator of your own takes part in the routes by the interfaces it implements, and declares every member of the routes it is given to:

| Interface | Members | For |
|---|---|---|
| `AuthControllerStrategyInterface` | `authDataModel`, `refreshLoginModel`, `logoutModel`, `logsInWithResponse`, `startTransaction` | logging in, refreshing and logging out with the strategy |
| `CsrfTokenAuthStrategyInterface` | `resolveCsrfToken` | `GET csrf-token` |
| `AuthControllerAuthenticatorInterface` | `credentialsModel` | `POST login` |
| `LoginOptionsAuthenticatorInterface` | `loginOptionsModel`, `resolveLoginOptions` | `POST login-options` |
| `RegistrationAuthenticatorInterface` | `registrationRequestModel`, `registrationOptionsModel`, `registrationAnswerModel`, `ticketModel`, `requestRegistration`, `confirmRegistration` | `POST registration/request` and `POST registration/confirm` |
| `FederatedAuthenticatorInterface` | see [routes of your own](./login-through-a-provider.md#routes-of-your-own) | the routes of a login at a provider |
| `LinkIdentityRequestingAuthenticatorInterface` | `linkIdentityRequestModel`, `linkIdentityStartModel` | `POST link-identity/request` |
| `LinkIdentityConfirmingAuthenticatorInterface` | `linkIdentityAnswerModel`, `confirmLinkIdentity` | `POST link-identity/confirm` |
| `IdentityLinkingAuthenticatorInterface` | see [connecting a provider to an account](./login-through-a-provider.md#connecting-a-provider-to-an-account) | `GET identities` and `DELETE identities/:identityId` |

A model is the class of a body or of an answer. `PasswordAuthenticator`, `PasskeyAuthenticator`, `BaseLdapAuthenticator`, `BaseFederatedAuthenticator` and the authenticators extending them, `JwtAuthStrategy` and `CookieAuthStrategy` implement the interfaces of their routes. A two factor method takes part by the members of `TwoFactorMethod`, see [another way of sending](./two-factor.md#another-way-of-sending).

## See also
- [Authentication & Authorization](./auth.md) — strategies, authenticators and securing routes
- [Login through a provider](./login-through-a-provider.md) — logging users in at a provider, and connecting it to an account
- [Passkeys](./passkeys.md) — logging in, registering and adding a passkey
- [Two factor](./two-factor.md) — enrolling and presenting a second factor
- [Login through a directory](./login-through-a-directory.md) — logging in with a password a directory checks
