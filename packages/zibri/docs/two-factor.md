# Two factor
Requiring a second factor on the operations that deserve one. Ships with TOTP — the six digit codes an authenticator app shows.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `TwoFactorServiceInterface` | interface | Enrolling, confirming and removing a user's second factor |
| `TwoFactorMethod` | interface | The contract a method implements. Implement it to add your own |
| `OtpTwoFactorMethod` | class | The TOTP method. Registered by default when you configure none |
| `OtpCredentials` | entity | A user's TOTP secret and whether it has been confirmed |
| `OtpRegistration` | class | What enrolling answers: the qr code url and the secret, to show once |
| `OtpCodeAlreadyUsedError` | error | Thrown when a code is presented a second time |
| `OtpValidationWindowInMs` | type | The clock skew a code may be accepted across |
| `ZIBRI_DI_TOKENS.OTP_HEADER` | DI token | Which header carries the code. Defaults to `x-authorization-otp` |
| `ZIBRI_DI_TOKENS.OTP_VALIDATION_WINDOW_IN_MS` | DI token | How much skew to allow. Defaults to 30 seconds |

## What a second factor is for

Not for a session. For an **operation**.

A user logs in and is asked for a code. They then do a lot of things, sending no code with any of them, because that first one is spent and gone. When they go to change their payment details, they are asked again.

That is why `@Auth.require2fa()` checks on every request to the route it guards, rather than marking a session as "2fa done". Marking the session would mean one code at login authorizes every sensitive action afterwards — which is the thing a second factor exists to prevent.

So put it on the operations that matter, not on everything:

```ts
// src/controllers/account.controller.ts
import { Auth, BaseUser, Body, Controller, defineProvider, Get, OtpRegistration, OtpTwoFactorMethod, OtpValidationWindowInMs, Patch, TwoFactorServiceInterface, ZIBRI_DI_TOKENS } from 'zibri';

import { Account, PaymentDetails } from '../models';

@Controller('/account')
class AccountController {
    @Auth.isLoggedIn()
    @Get('/')
    async read(): Promise<Account> { /* no code needed */ }

    @Auth.require2fa()
    @Patch('/payment-details')
    async updatePaymentDetails(@Body(PaymentDetails) data: PaymentDetails): Promise<void> { /* code required */ }
}
```

Called with no argument, any method the app has configured is accepted. Pass a list to narrow it.

## Enrolling a user

Two steps, and the second one is not optional.

```ts
export async function enrol(
    twoFactorService: TwoFactorServiceInterface,
    user: BaseUser<string>,
    otpMethod: OtpTwoFactorMethod
): Promise<void> {
    // 1. hand the user something to scan. This does NOT enable 2fa yet
    const registration: OtpRegistration = await twoFactorService.requestRegisterTwoFactorMethodForUser(user, otpMethod, undefined);
    // -> writes OtpCredentials with confirmed: false, and answers what the user has to see:
    //    registration.qrCodeUrl - the otpauth url to render as a qr code
    //    registration.secret    - the same thing to type when scanning is not an option

    // 2. the user types the first code their app shows, proving they scanned it
    await twoFactorService.confirmRegisterTwoFactorMethodForUser(user, otpMethod, { token: '123456' });
    // -> confirmed: true, and only now does it satisfy @Auth.require2fa
}
```

Both fields are derived from the secret and **neither is stored**. Enrollment is the one moment
either is needed in the clear, so keeping a copy would mean a second, unprotected plaintext of the
thing the row exists to protect — the otpauth url embeds the secret verbatim. Render them, then
forget them.

The stored secret is an encrypted property, which means an application using this method has to
configure `ZIBRI_DI_TOKENS.ENCRYPTION_MASTER_OPTIONS` — see
[encryption & hashing](./encryption-and-hashing.md). Without it, enrolling throws.

**An unconfirmed enrollment satisfies nothing.** Until step 2 the secret is one nobody has proven they hold, so it cannot be used to pass a check — otherwise starting an enrollment and never finishing it would *be* the bypass.

Asking for a new enrollment abandons any unfinished one, so a user who gives up halfway and starts again does not leave a second secret behind. A **confirmed** credential is left alone: setting up a new device must not cost you the one that currently works before the new one is proven.

## Codes are single use

A TOTP code stays the same for its whole 30-second window, so the same six digits are shown for up to half a minute. Zibri accepts each one **once**. Presenting it again is refused with:

> This two factor code has already been used. Wait for your authenticator to show the next one.

A distinct error from a wrong code, though both answer `401`. Two sensitive operations close together is a normal thing to do, and telling that user their code was *invalid* sends them hunting for a mistake they did not make.

This is required rather than chosen — RFC 6238 §5.2 says a verifier must not accept a second use, because "the same user twice" and "somebody who watched the code go past" look identical from the server. The cost is real: two operations inside the same 30 seconds means waiting for the next code.

The record is a [lease](./leases.md) keyed by the credentials and the window, so a code spent on one instance is spent on all of them, and it clears itself once the window has passed.

### Clock skew

Codes are accepted from 30 seconds either side of now, so an authenticator that has drifted still works. Each window is spent separately — drifting does not cost a user a code.

```ts
defineProvider({ token: ZIBRI_DI_TOKENS.OTP_VALIDATION_WINDOW_IN_MS, useFactory: (): OtpValidationWindowInMs => 0 })
```

`0` accepts only the current code: the smallest replay surface, but any client whose clock is off by more than a few seconds starts failing, and phone clocks drift.

The type accepts `0`, `30_000`, `60_000` and `90_000` only. A code belongs to a 30-second window or it does not, so `45_000` cannot be honored — it would quietly behave as `30_000`. Listing the values that exist makes that a compile error instead of a surprise, and the ceiling is there because every extra window is another code an observer could still spend.

## Sending the code

Clients send it in the `x-authorization-otp` header. Rename it through `ZIBRI_DI_TOKENS.OTP_HEADER` — CORS follows the token, so a browser client keeps working without further configuration.

## See also
- [Auth](./auth.md) — who the user is, which this builds on
- [Creating endpoints](./creating-endpoints.md#securing-endpoints) — the `@Auth` decorators
- [App settings](./app-settings.md) — CORS and security headers
