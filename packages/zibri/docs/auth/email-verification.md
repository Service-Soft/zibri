---
keywords: [email verification, confirm email, verify email, double opt in, confirmation link]
---

# Verifying email addresses
A user proves that an email address is theirs by following a link mailed to it. Until they do, the address is only what somebody typed, so a password reset link or a code as a [second factor](../glossary.md#second-factor) would go to whoever holds it. With verification on, those go to verified addresses only, a change of address takes effect once the new one is confirmed, and a password login can wait for it.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `EmailVerificationOptions` | type | How addresses are verified, via `ZIBRI_DI_TOKENS.EMAIL_VERIFICATION_OPTIONS`. Defaults to no verification |
| `EmailVerificationEmailTemplate`, `EmailVerificationEmailTemplateProps` | type | The email a link to verify an address is sent in, and what it is given |
| `EmailChangedEmailTemplate`, `EmailChangedEmailTemplateProps` | type | The email the previous address is told of a change in, and what it is given |
| `EmailVerificationPurpose` | type | Whether a link verifies the user's address, `'verification'`, or changes it, `'change'` |
| `EmailVerificationServiceInterface`, `EmailVerificationService` | interface, class | Mails the links and confirms them. Replaceable through `ZIBRI_DI_TOKENS.EMAIL_VERIFICATION_SERVICE` |
| `EmailVerificationToken`, `EmailVerificationTokenCreateData` | entity, class | A link that was mailed, stored hashed, and what one is created with |
| `EmailVerificationTokenInput`, `RequestEmailChangeInput` | class | What the routes take: the token of a link, and the address to change to |
| `AuthControllerEmailVerificationRoutes` | type | The methods of the routes |
| `EmailNotVerifiedError` | error | A 403 for what needs a verified address, asked of a user whose is not |

## Setting it up
Declare `EmailVerificationToken` in the data source your users live in, and provide the options:

```ts
// src/providers.ts
import { defineProvider, EmailVerificationOptions, ZIBRI_DI_TOKENS } from 'zibri';

import { EmailChangedEmail } from './templates/emails/email-changed';
import { VerifyEmailEmail } from './templates/emails/verify-email';

defineProvider({
    token: ZIBRI_DI_TOKENS.EMAIL_VERIFICATION_OPTIONS,
    useValue: {
        // the page of your frontend a link opens
        confirmEmailUrl: 'https://app.example.com/verify-email',
        verificationEmail: VerifyEmailEmail,
        emailChangedEmail: EmailChangedEmail,
        requiredForLogin: true
    } satisfies EmailVerificationOptions
})
```

| Option | What it is |
|---|---|
| `confirmEmailUrl` | Where a link points. The link is this url, a `/` and the token. Required |
| `verificationEmail` | The email a link is sent in. It is given the `link`, the `email` it verifies, the `purpose` and the `user`. Required |
| `emailChangedEmail` | The email the previous address is told of a change in. It is given the `previousEmail`, the `newEmail` and the `user`. Required |
| `requiredForLogin` | Whether a password login waits until the user's address is verified. Required |
| `linkExpiresInMs` | How long a link works. A day by default |

Give `AuthController` `emailVerification: true` for its routes:

```ts
// src/controllers/auth.controller.ts
import { AuthController, Controller, JwtAuthStrategy, OtpTwoFactorMethod, PasswordAuthenticator } from 'zibri';

@Controller('/auth', { versions: 'all' })
export class AppAuthController extends AuthController({
    strategies: [JwtAuthStrategy],
    authenticators: [PasswordAuthenticator],
    twoFactorMethods: [OtpTwoFactorMethod],
    emailVerification: true
}) {}
```

The page at `confirmEmailUrl` takes the token from its path and posts it to the route that confirms it.

## Verifying an address
| Route | Takes | Who calls it |
|---|---|---|
| `POST /auth/request-email-verification` | nothing. Mails the user a link to the address they have | a logged in user |
| `POST /auth/confirm-email-verification` | `{ "token" }`. Marks the address verified | anyone, with the link |

A user's `emailVerifiedAt` is when they verified the address they have, and `null` while they have not. While a link of theirs still works, asking again mails nothing.

With `requiredForLogin`, a password login of a user whose address is not verified is answered `403` with an `EmailNotVerifiedError`, once the password matched, and mails them a link.

## Changing an address
| Route | Takes | Who calls it |
|---|---|---|
| `POST /auth/request-email-change` | `{ "newEmail" }`. Mails a link to the new address | a logged in user, with a second factor or a [recent login](../glossary.md#recent-login) |
| `POST /auth/confirm-email-change` | `{ "token" }`. Changes the address to the new one, verified, and mails the previous address that it was changed | anyone, with the link |

The address stays as it is until the new one is confirmed. Asking for another change replaces the link of the one before.

## What a verified address is needed for
| What | Refused while the address is not verified |
|---|---|
| A password login | with `requiredForLogin` |
| A [password reset](./auth.md#asking-for-a-password-reset) | always. The request is answered the same, and recorded as `failure` / `email-not-verified` |
| Enrolling and being sent a code by [`EmailTwoFactorMethod`](./two-factor.md#codes-by-email-or-text-message) | always |

A user whose address is not verified cannot reset a forgotten password. Verify your existing users' addresses before you turn verification on, such as by setting `emailVerifiedAt` in a migration for the addresses you already trust.

## Changing an address in your own code
A write changing the `email` of a user also writes `emailVerifiedAt`: `null` when the new address is not verified, or when it was. A write without it is refused, so the verification of the previous address never stands for the new one. `updateEmail` of `ZIBRI_DI_TOKENS.USER_SERVICE` takes both.

## What gets recorded
| `action` | `outcome` | Carries |
|---|---|---|
| `auth.email.verified` | success / failure | `userId` |
| `auth.email.change-requested` | success / failure | `userId`, and the new address as `subject` |
| `auth.email.changed` | success / failure | `userId`, and the new address as `subject` on success |

## Requirements
Your data source declares these entities:

| Entity | Needed when |
|---|---|
| `EmailVerificationToken` | `ZIBRI_DI_TOKENS.EMAIL_VERIFICATION_OPTIONS` is provided |

## See also
- [Auth](./auth.md) — logging in, and resetting a password
- [The auth routes](./auth-routes.md) — every route `AuthController` defines
- [Two factor](./two-factor.md) — codes by email as a second factor
- [Email](../templates/email.md) — the templates the links are sent in
