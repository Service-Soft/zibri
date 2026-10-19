# The auth routes
`AuthController` defines the routes a client logs in, refreshes and ends a login with, resets a password with, signs in at a provider with, connects an identity to an account with, and enrols a second factor with. You give it the auth strategies, authenticators and two factor methods your application registers, and it defines the routes they call for.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `AuthController` | function | Defines the auth routes of the given strategies, authenticators and two factor methods |
| `AuthControllerOptions` | type | What `AuthController` is given |
| `AuthControllerClass` | type | A controller class `AuthController` defined: the routes its options call for, and the options |
| `isAuthControllerClass` | function | Tells a class `AuthController` defined apart |
| `AuthControllerStrategyClass`, `AuthControllerAuthenticatorClass` | type | A class of a strategy and of an authenticator the routes log in with |
| `AuthControllerLoginRoutes`, `AuthControllerCsrfTokenRoutes`, `AuthControllerPasswordResetRoutes`, `AuthControllerSignInOptionsRoutes`, `AuthControllerSignUpRoutes`, `AuthControllerFederatedRoutes`, `AuthControllerConnectionRoutes`, `AuthControllerConnectionCompletingRoutes`, `AuthControllerIdentityRoutes`, `AuthControllerTwoFactorRoutes` | type | The methods of the routes, by the classes that call for them |
| `FEDERATED_ROUTE` | constant | Where the routes of a sign-in at a provider are, below the path of the controller: `/federated` |
| `AuthControllerUtilities` | class | What the routes share: finding the class a request names, checking a body against one model, running in a transaction of a strategy |
| `AuthControllerStrategyInterface`, `isAuthControllerStrategy` | interface, function | What a strategy the routes log in with implements |
| `CsrfTokenAuthStrategyInterface`, `isCsrfTokenAuthStrategy` | interface, function | What a strategy issuing csrf tokens implements |
| `AuthControllerAuthenticatorInterface`, `isAuthControllerAuthenticator` | interface, function | What an authenticator the login route logs in with implements |
| `SignInOptionsAuthenticatorInterface`, `isSignInOptionsAuthenticator` | interface, function | What an authenticator handing out a challenge to sign in with implements, such as a passkey |
| `SignUpAuthenticatorInterface`, `isSignUpAuthenticator` | interface, function | What an authenticator signing up a user by itself implements, such as a passkey |
| `ConnectingAuthenticatorInterface`, `isConnectingAuthenticator` | interface, function | What an authenticator whose identities a user connects to their account implements |
| `ConnectionCompletingAuthenticatorInterface`, `isConnectionCompletingAuthenticator` | interface, function | What an authenticator finishing a connection with an answer of the client implements |
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
| `twoFactorMethods` | The two factor methods a user enrols. None for no 2fa routes |

Name exactly what your application registers: its auth strategies that log in, its authenticators, and its two factor methods, including the ones it registers when you configure none, `JwtAuthStrategy`, `PasswordAuthenticator` and `OtpTwoFactorMethod`.

## The routes
Every route is below the path of your controller. A route is there when one of the classes you give calls for it:

| Route | There when | Takes | Who calls it |
|---|---|---|---|
| `POST /login` | always | the credentials of the authenticator, eg. `{ "email", "password" }` | anyone |
| `POST /refresh-login` | always | what the strategy refreshes with, eg. `{ "refreshToken" }` | anyone |
| `POST /logout` | always | what the strategy logs out with, eg. `{ "refreshToken" }`, or `{ "clearCookies" }` for the login of the cookies the request carries. Answers where to log out at the provider the login was started at, if any | anyone |
| `GET /csrf-token` | a strategy issues csrf tokens, such as `CookieAuthStrategy` | nothing. Answers the token of the login the request carries | anyone |
| `POST /request-password-reset` | `PasswordAuthenticator` | `{ "email" }`, see [asking for a password reset](./auth.md#asking-for-a-password-reset) | anyone |
| `POST /verify-password-reset-token` | `PasswordAuthenticator` | `{ "resetToken" }`. Answers `{ "isValid" }` | anyone |
| `POST /confirm-password-reset` | `PasswordAuthenticator` | `{ "resetToken", "newPassword" }` | anyone |
| `POST /sign-in-options` | an authenticator hands out a challenge to sign in with, such as `PasskeyAuthenticator` | nothing. Answers the challenge | anyone |
| `POST /registration-options`, `POST /register` | an authenticator signs up users by itself, such as `PasskeyAuthenticator` | what the sign-up starts with, and the client's answer. `register` answers the ticket your own sign-up route creates the user with | anyone |
| `GET /federated/authorize` | an authenticator signs users in at a provider | see [signing in at a provider](#signing-in-at-a-provider) | anyone |
| `GET`/`POST /federated/:provider/callback`, `GET /federated/:provider/connect`, `GET`/`POST /federated/:provider/logout`, `GET /federated/:provider/metadata` | an authenticator signs users in at a provider | what the provider sends the browser with | the browser, sent by the provider |
| `POST /federated/:provider/logout/soap` | a [SAML](./sign-in-through-a-provider.md#logging-out) identity provider | a logout request in a SOAP envelope. Answers in one | the identity provider |
| `POST /connect` | an authenticator connects identities to an account, such as a provider or `PasskeyAuthenticator` | what the connection is for, eg. `{ "redirectTo", "signIn" }`. Answers what the browser goes on with | a logged in user, with a second factor or a recent login |
| `POST /connect/complete` | an authenticator finishes a connection with an answer of the client, such as `PasskeyAuthenticator` | the client's answer | a logged in user |
| `GET /identities` | an authenticator links identities to users | nothing. Answers the identities of the user, each with the authenticator it signs in through | a logged in user |
| `DELETE /identities/:identityId` | an authenticator links identities to users | nothing | a logged in user, with a second factor or a recent login |
| `POST /2fa/register` | a two factor method | what the method enrols with, eg. `{ "phoneNumber" }`, or nothing. Answers what the user is shown, eg. the qr code of an authenticator app | a logged in user, with their second factor when they have one, a recent login otherwise |
| `POST /2fa/confirm` | a two factor method | what confirms the enrollment, eg. `{ "token" }` | a logged in user |
| `DELETE /2fa/:method` | a two factor method | nothing | a logged in user, with their second factor |
| `POST /2fa/start` | a two factor method | nothing. Sends a code, or answers the challenge for a passkey | a logged in user |

A recent login is one of the last 5 minutes, see [accepting a recent login instead](./two-factor.md#accepting-a-recent-login-instead).

## Naming the strategy and the authenticator
A request names the strategy it logs in, refreshes or logs out with in the query parameter `strategy`, the authenticator it proves its login with in `authenticator`, and the two factor method in `method`, each by its `name`:

```txt
POST /auth/login?authenticator=password&strategy=cookie
{ "email": "ada@example.com", "password": "..." }
```

A parameter is required when there is more than one to choose from, and left out otherwise: an application logging in with jwts by password is sent `POST /auth/login` with `{ "email", "password" }`. A body that is not what the authenticator it names takes is answered with `400`.

## Signing in at a provider
The frontend sends the browser to the authorize route, naming the provider:

| Query parameter | What it is |
|---|---|
| `authenticator` | The name of the provider, eg. `google` |
| `redirectTo` | Where the browser lands once the sign-in is done |
| `codeChallenge` | The challenge of a PKCE verifier the frontend keeps, see below |
| `strategy` | The strategy that logs in on the redirect back, see below |
| `reauthenticate` | `true` to have the provider sign the user in again |
| `scopes` | The scopes of the provider's apis to ask for, separated by spaces |

The sign-in either logs in on the redirect back, or hands the login over by code. With a `codeChallenge` it hands it over: the browser lands on `redirectTo` with a one-time `code`, which the frontend logs in with at `POST /login`, as `{ "code", "codeVerifier" }`. Without one it logs in on the redirect, which only a strategy whose login goes out with the response can do, such as `CookieAuthStrategy`. For any other strategy, such as `JwtAuthStrategy`, a sign-in without a `codeChallenge` is answered with `400`.

The routes the provider sends the browser to name the provider in their path, eg. `/auth/federated/google/callback`, which is the redirect uri you enter at the provider. See [sign-in through a provider](./sign-in-through-a-provider.md).

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

## What the application checks while it starts
The application refuses to start when
- more than one of its controllers is defined by `AuthController`
- the options name other strategies than the registered ones that log in, other authenticators than the registered ones the login route logs in with, or other two factor methods than the registered ones
- a class given to a route does not declare all the route reads, see [your own authenticator or strategy](#your-own-authenticator-or-strategy)

## Your own authenticator or strategy
A strategy or an authenticator of your own takes part in the routes by the interfaces it implements:

| Interface | Members | For |
|---|---|---|
| `AuthControllerStrategyInterface` | `authDataModel`, `refreshLoginModel`, `logoutModel`, `logsInWithResponse`, `startTransaction` | logging in, refreshing and logging out with the strategy |
| `CsrfTokenAuthStrategyInterface` | `resolveCsrfToken` | `GET csrf-token` |
| `AuthControllerAuthenticatorInterface` | `credentialsModel` | `POST login` |
| `SignInOptionsAuthenticatorInterface` | `signInOptionsModel`, `resolveSignInOptions` | `POST sign-in-options` |
| `SignUpAuthenticatorInterface` | `signUpRequestModel`, `signUpOptionsModel`, `signUpAnswerModel`, `ticketModel`, `resolveSignUpOptions`, `completeSignUp` | `POST registration-options` and `POST register` |
| `FederatedAuthenticatorInterface` | see [routes of your own](./sign-in-through-a-provider.md#routes-of-your-own) | the routes of a sign-in at a provider |
| `ConnectingAuthenticatorInterface` | `connectionRequestModel`, `connectionStartModel` | `POST connect` |
| `ConnectionCompletingAuthenticatorInterface` | `connectionAnswerModel`, `completeConnection` | `POST connect/complete` |
| `IdentityLinkingAuthenticatorInterface` | see [connecting a provider to an account](./sign-in-through-a-provider.md#connecting-a-provider-to-an-account) | `GET identities` and `DELETE identities/:identityId` |

A model is the class of a body or of an answer. `PasswordAuthenticator`, `PasskeyAuthenticator`, `BaseLdapAuthenticator`, `BaseFederatedAuthenticator` and the authenticators extending them, `JwtAuthStrategy` and `CookieAuthStrategy` implement the interfaces of their routes. A two factor method takes part by the members of `TwoFactorMethod`, see [another way of sending](./two-factor.md#another-way-of-sending).

## See also
- [Authentication & Authorization](./auth.md) — strategies, authenticators and securing routes
- [Sign-in through a provider](./sign-in-through-a-provider.md) — signing users in at a provider, and connecting it to an account
- [Passkeys](./passkeys.md) — signing in, signing up and adding a passkey
- [Two factor](./two-factor.md) — enrolling and presenting a second factor
- [Sign-in through a directory](./sign-in-through-a-directory.md) — logging in with a password a directory checks
