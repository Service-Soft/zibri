---
keywords: [magic link, passwordless, email login, sign in link, login without password]
---

# Logging in with a link
A user logs in by a link mailed to their email, without a password. They type their email, follow the link in the mail, and the page it opens logs them in. This suits people who use your application rarely, such as customers looking at a shared project, and the accounts an [invitation without a password](./invitations.md#accepting-without-a-password) creates. A link proves that the user holds the mailbox, which is what a password reset trusts as well.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `LoginLinkAuthenticator` | class | Mails links to log in with, and logs users in with their token |
| `LoginLinkOptions` | type | How links are sent and taken, via `ZIBRI_DI_TOKENS.LOGIN_LINK_OPTIONS`. Required with `LoginLinkAuthenticator` |
| `LoginLinkEmailTemplate`, `LoginLinkEmailTemplateProps` | type | The email a link is sent in, and what it is given |
| `LoginLinkSecondFactor` | type | Whether a login by a link asks for a [second factor](../glossary.md#second-factor): `'twoFactorAtLogin'` or `'none'` |
| `LoginLinkToken` | entity | The token of a link that was mailed. Kept hashed |
| `LoginLinkCredentials` | class | What `POST /auth/login?authenticator=login-link` takes: the `token` |
| `RequestLoginLinkInput` | class | What `POST /auth/request-login-link` takes: the `email` |
| `LoginMethods` | class | What `GET /auth/login-methods` answers: whether the login route takes a `password` and a `loginLink` |

## Setting it up
Declare `LoginLinkToken` in the data source your users live in, and provide the options:

```ts
// src/providers.ts
import { defineProvider, LoginLinkOptions, Ms, ZIBRI_DI_TOKENS } from 'zibri';

import { LoginLinkEmail } from './templates/emails/login-link';

defineProvider({
    token: ZIBRI_DI_TOKENS.LOGIN_LINK_OPTIONS,
    useValue: {
        // the page of your frontend a link opens
        loginLinkUrl: 'https://app.example.com/login-link',
        loginLinkEmail: LoginLinkEmail,
        tokenExpiresInMs: Ms.MINUTE * 15
    } satisfies LoginLinkOptions
})
```

| Option | What it is |
|---|---|
| `loginLinkUrl` | Where a link points. The link is this url, a `/` and the token, with the [tenant](../glossary.md#tenant) of the request asking for it put in by `resolveTenantUrl` of the [`TenantService`](../data/tenancy.md#the-tenant-of-a-request). Required |
| `loginLinkEmail` | The email a link is sent in. It is given the `loginLink`, the `user` and when the link `expiresAt`. Required |
| `tokenExpiresInMs` | How long a link works. 15 minutes by default |
| `secondFactor` | Whether a login by a link asks for a second factor, see [the second factor](#the-second-factor). `'twoFactorAtLogin'` by default |
| `bindToBrowser` | Whether a link works only in the browser that asked for it, see [binding a link to the browser](#binding-a-link-to-the-browser). Off by default |

List `LoginLinkAuthenticator` in the `authenticators` of your application and of `AuthController`, which adds `POST /auth/request-login-link`:

```ts
// src/controllers/auth.controller.ts
import { AuthController, Controller, JwtAuthStrategy, LoginLinkAuthenticator, OtpTwoFactorMethod, PasswordAuthenticator } from 'zibri';

@Controller('/auth', { versions: 'all' })
export class AppAuthController extends AuthController({
    strategies: [JwtAuthStrategy],
    authenticators: [PasswordAuthenticator, LoginLinkAuthenticator],
    twoFactorMethods: [OtpTwoFactorMethod],
    loginMethodsRoute: true
}) {}
```

With `loginMethodsRoute: true`, `GET /auth/login-methods` answers `{ "password": true, "loginLink": true }`, so a login page offers a link next to the password, or in place of it.

The mail is sent in the [locale of the user](../templates/localization.md#the-locale-of-a-user).

## Asking for a link
The login page posts the email:

```txt
POST /auth/request-login-link
{ "email": "ada@example.com" }

204
```

The route answers `204` whatever you send it, in what it says and in how long it takes: an email with an account and one without are indistinguishable. It answers once the email is looked up, and the link and its mail are made after that. A deactivated user gets no link. A new link replaces the one the user had.

The route is on the [budget of the auth routes](./auth.md#how-often-a-caller-may-try) per caller, and on one of the same size per email, whichever callers ask for it. Exceeding either answers `429`.

For your UI, say "if that email has an account, a link is on its way", not that a mail went out.

## Logging in
The link opens the page at `loginLinkUrl`, which takes the token from its path and posts it to the login route:

```txt
POST /auth/login?authenticator=login-link
{ "token": "..." }
```

It answers what a login answers, such as the tokens of `JwtAuthStrategy`. A link logs in once. A link that was used is answered `401` with "This login link is unknown or was used already. Ask for a new one.", an expired one with "This login link expired. Ask for a new one.", and the link of a [deactivated user](./auth.md#deactivating-a-user) `403`.

Log in on a button press of the page, not when it loads: the route takes no `GET`, so a scanner of a mail provider that opens the link spends nothing, and one that also runs the scripts of the page presses no button.

Using a link marks the email of the user as [verified](./email-verification.md), since the link reached it.

## The second factor
With `secondFactor: 'twoFactorAtLogin'`, a login by a link asks for a second factor as [`twoFactorAtLogin`](./two-factor.md#asking-for-a-second-factor-at-login) says, like a login with a password. With `'none'`, a login by a link is complete on its own.

[Codes by email](./two-factor.md#codes-by-email-or-text-message) do not count as the second factor of a login by a link, since the link proved the same mailbox. The login lists the other methods the user enrolled in `methods`, and refuses a code by email with `403`. A user whose only second factor is codes by email counts as a user without one:

| `twoFactorAtLogin` | A user with codes by email alone |
|---|---|
| `'never'` | logs in on the link |
| `'ifEnrolled'` | logs in on the link |
| `'required'` | enrolls another second factor, such as an app for one time passwords, before the login completes |

Codes by email count on a route guarded with `@Auth.require2fa` as they do after any login.

A login by a link does not count as a [recent login](./two-factor.md#accepting-a-recent-login-instead), refreshed or not, for a user with a password of `PasswordAuthenticator` or a second factor: a recent login stands in for a second factor because it proved the password. A route with `@Auth.require2fa({ reauth: true })` takes their second factor, or a login with their password.

For a user with neither, such as one an [invitation without a password](./invitations.md#accepting-without-a-password) created, a link is all they confirm who they are with, so their login by a link counts as a recent login, refreshed or not. What the user has is read when they log in, and holds for that login. Once it is too old, a route accepting a recent login answers them `401` with "Ask for a new login link, and log in with it to access this route.", where every other user is told "Log in again to access this route.".

| The user has | A login by a link is a recent login |
|---|---|
| a password | no |
| a second factor, codes by email included | no |
| neither | yes |

## Binding a link to the browser
With `bindToBrowser: true`, `POST /auth/request-login-link` sets an HttpOnly cookie, `zibri-login-link`, whether or not the email has an account, with the `sameSite`, `domain`, `path` and `secure` of [the session cookie](./auth.md#setting-the-session-cookie-flags). The link then works only in a browser that sends that cookie. Another browser is answered `401` with "This login link works on the device it was asked for on. Open it there, or ask for a new one on this device."

A user who asks for a link on their computer and opens the mail on their phone cannot log in on the phone, so bind links where that is worth the inconvenience.

> [!NOTE]
> The cookie reaches the login route only where the browser sends cookies with it: a frontend on another origin sends its requests with `credentials: 'include'`, and allows them in CORS.

## What gets recorded
| `action` | `outcome` | Carries |
|---|---|---|
| `auth.login-link.requested` | success / failure | `subject`, the email asked for, `userId` when a link went out, `reason: no-such-subject` for an email without an account, `reason: deactivated` for a deactivated user |
| `auth.login-link.used` | success | `userId`, once a link was spent |

A login by a link is recorded as `auth.login` as well, with `reason: refused` for a link that was used, expired or opened in another browser.

## Requirements
Your data source declares these entities:

| Entity | Needed when |
|---|---|
| `LoginLinkToken` | `LoginLinkAuthenticator` is registered |
| `LoginTicket` | `LoginLinkAuthenticator` is registered and `twoFactorAtLogin` is not `'never'` |

## See also
- [Auth](./auth.md) — authenticators, strategies and the budget of the auth routes
- [The auth routes](./auth-routes.md) — every route `AuthController` defines
- [Two factor](./two-factor.md) — the second factor at login, and a recent login in place of one
- [Inviting people](./invitations.md) — invitations that create an account without a password
- [Email](../templates/email.md) — the template a link is sent in
