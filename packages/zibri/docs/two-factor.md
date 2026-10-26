# Two factor
A [second factor](./glossary.md#second-factor) is a further proof a user presents beside their login, such as a code from their phone. You require one on the operations that need it. TOTP, the six digit codes an [authenticator](./glossary.md#authenticator) app shows, is built in, as are [passkeys](./passkeys.md#as-a-second-factor) and codes sent by [email or text message](#codes-by-email-or-text-message).

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `TwoFactorServiceInterface` | interface | Enrolling, confirming and removing a user's second factor |
| `TwoFactorService` | class | Enrolls, confirms, checks and removes a user's second factors. Replaceable through `ZIBRI_DI_TOKENS.TWO_FACTOR_SERVICE` |
| `TwoFactorMethod` | interface | The contract a method implements. Implement it to add your own |
| `isTwoFactorMethod`, `TwoFactorMethods` | function, type | Tells a two factor method apart, and a list of two factor method classes |
| `NoRegistrationRequestData` | class | What enrolling a method takes when it takes nothing, such as an authenticator app |
| `Require2faFn`, `Require2faMetadata` | interface, type | The type of `@Auth.require2fa`, with its `skip`, and what it declares: the methods allowed, `reauth` and `providerFactors` |
| `OtpTwoFactorMethod` | class | The TOTP method. Registered by default when you configure none |
| `PasskeyTwoFactorMethod` | class | A [passkey](./glossary.md#passkey) as the second factor, see [passkeys](./passkeys.md#as-a-second-factor) |
| `EmailTwoFactorMethod` | class | A code mailed to the user's address, see [codes by email or text message](#codes-by-email-or-text-message) |
| `SmsTwoFactorMethod` | class | A code sent as a text message |
| `CodeTwoFactorMethod` | class | What the two above are built on. Extend it for another way of sending a code, see [another way of sending](#another-way-of-sending) |
| `SmsServiceInterface` | interface | What sends a text message. You provide it |
| `SendSmsData` | type | A text message: the number and the text |
| `ZIBRI_DI_TOKENS.SMS_SERVICE` | DI token | Injects `SmsServiceInterface`. Required by `SmsTwoFactorMethod` |
| `SmsRegistrationRequestData` | class | What enrolling by text message needs: the phone number |
| `CodeRegistrationConfirmData` | class | What confirming the enrollment of a method sending codes takes: the code that was sent |
| `TwoFactorCodeCredentials` | entity | Where a user receives codes, and whether they confirmed it |
| `TwoFactorCode` | entity | A code that was sent and not yet entered. Kept encrypted |
| `TwoFactorCodeCleanupCronJob` | cron job | Deletes the codes that expired before they were entered. Registered for you |
| `TwoFactorCodeOptions` | type | How many digits a code has, how long it lasts, how often one can be sent, how many wrong ones it takes |
| `ZIBRI_DI_TOKENS.TWO_FACTOR_CODE_OPTIONS` | DI token | Configures the codes |
| `ZIBRI_DI_TOKENS.EMAIL_CODE_HEADER` | DI token | Which header carries a mailed code. Defaults to `x-authorization-email-code` |
| `ZIBRI_DI_TOKENS.SMS_CODE_HEADER` | DI token | Which header carries a texted code. Defaults to `x-authorization-sms-code` |
| `TwoFactorCodeRateLimiter` | class | How often a user is sent a code. Once a minute for each method, counted across instances |
| `SmsCodeLimits` | type | What text messages may cost: how many an hour, how many to one number a day, and to which countries |
| `ZIBRI_DI_TOKENS.SMS_CODE_LIMITS` | DI token | Configures the limits above. Required by `SmsTwoFactorMethod` |
| `SmsCodeBudgetRateLimiter` | class | How many codes the application texts in an hour, counted across instances |
| `SmsCodeNumberRateLimiter` | class | How many codes one number is texted in a day, counted across instances |
| `OtpCredentials` | entity | A user's TOTP secret and whether it has been confirmed |
| `OtpRegistration` | class | What enrolling answers: the qr code url and the secret, to show once |
| `OtpRegistrationConfirmData` | class | What confirming a TOTP enrollment takes: a code the authenticator app shows |
| `OtpCodeAlreadyUsedError` | error | Thrown when a code is presented a second time |
| `InvalidTwoFactorCodeError` | error | Thrown when a presented code is wrong. Throw it from your own method for the same |
| `TwoFactorThrottledError` | error | Thrown while a user has to wait after wrong codes. Answers `429` |
| `TwoFactorFailureStreak` | entity | A user's wrong codes in a row, when the next one is checked, and when they locked the second factor |
| `ZIBRI_DI_TOKENS.TWO_FACTOR_FAILURE_DELAY_IN_MS` | DI token | The wait after the first wrong code. Defaults to 1 second |
| `TwoFactorFailureLimit` | type | The `twoFactorFailureLimit` app option: how many wrong codes in a row lock the second factor, and what the lock refuses |
| `TwoFactorLock` | type | What a lock refuses: `'secondFactor'` or `'account'` |
| `TwoFactorLockedError` | error | Thrown while a user's second factor is locked. Answers `403` |
| `AccountLockedError` | error | Thrown when a user whose account is locked logs in. Answers `403` |
| `RecoveryCodeTwoFactorMethod` | class | Recovery codes, each presented once in place of a second factor, see [recovery codes](#recovery-codes) |
| `RecoveryCodeRegistration` | class | What enrolling recovery codes answers: the codes, to show once |
| `RecoveryCodeRegistrationConfirmData` | class | What confirming recovery codes takes: one code of the set, with or without its dash |
| `TwoFactorRecoveryCode` | entity | One recovery code of a user. Kept hashed |
| `ZIBRI_DI_TOKENS.RECOVERY_CODE_HEADER` | DI token | Which header carries a recovery code. Defaults to `x-authorization-recovery-code` |
| `OtpValidationWindowInMs` | type | The clock skew a code may be accepted across |
| `ZIBRI_DI_TOKENS.OTP_HEADER` | DI token | Which header carries the code. Defaults to `x-authorization-otp` |
| `ZIBRI_DI_TOKENS.OTP_VALIDATION_WINDOW_IN_MS` | DI token | How much skew to allow. Defaults to 30 seconds |
| `Require2faReauth` | type | Whether a route accepts a [recent login](./glossary.md#recent-login) in place of a second factor |
| `Require2faReauthOptions`, `Require2faReauthAllow` | type, type | Accepting a recent login together with how recent it has to be, and whose: `true` for every user, `'onlyAsFallback'` for a user without a second factor the route allows |
| `ReauthenticationRequiredError` | error | Thrown when the route accepts a recent login and the user's is too old |
| `ZIBRI_DI_TOKENS.REQUIRE_2FA_REAUTH` | DI token | What a route that says nothing about `reauth` accepts. Defaults to `false` |
| `ZIBRI_DI_TOKENS.REQUIRE_2FA_REAUTH_WINDOW_IN_MS` | DI token | How recent a login has to be. Defaults to 5 minutes |
| `Require2faProviderFactors` | type | Which second factor presented at the provider a route counts, see [accepting the provider's second factor](#accepting-the-providers-second-factor) |
| `ZIBRI_DI_TOKENS.REQUIRE_2FA_PROVIDER_FACTORS` | DI token | What a route that says nothing about `providerFactors` counts. Defaults to `false` |
| `ProviderAuthentication` | type | How a user proved who they are at the provider: the methods and the class of the authentication, as a login keeps them |
| `TwoFactorAtLogin` | type | The `twoFactorAtLogin` app option: whether a login asks for a second factor, see [asking for a second factor at login](#asking-for-a-second-factor-at-login) |
| `SecondFactorRequiredError` | error | What a login that waits for its second factor answers. `401`, with the [ticket](./glossary.md#ticket) the login continues with |
| `LoginTicket` | entity | A login that waits for its second factor. Kept hashed |
| `LoginTicketCleanupCronJob` | cron job | Deletes the tickets of logins never completed with their second factor. Registered for you when `twoFactorAtLogin` is not `'never'` |
| `ZIBRI_DI_TOKENS.LOGIN_TICKET_HEADER` | DI token | Which header carries the ticket. Defaults to `x-login-ticket` |

## What a second factor is for

A second factor guards an operation, not a session. `@Auth.require2fa()` checks on every request to the route it guards. A user who presented a code at login sends none with their next requests, and is asked again when they change their payment details. Whether the login itself asks for one is `twoFactorAtLogin`, see [asking for a second factor at login](#asking-for-a-second-factor-at-login).

Put it on the operations that matter:

```ts
// src/controllers/account.controller.ts
import { Auth, Body, Controller, Get, Patch } from 'zibri';

import { Account, PaymentDetails } from '../models';

@Controller('/account')
class AccountController {
    @Auth.isLoggedIn()
    @Get('/')
    async read(): Promise<Account> { /* your own code */ }

    @Auth.require2fa()
    @Patch('/payment-details')
    async updatePaymentDetails(@Body(PaymentDetails) data: PaymentDetails): Promise<void> { /* your own code */ }
}
```

Reading the account takes a login, changing the payment details a second factor beside it. Called with no argument, any method the app has configured is accepted. Pass `allowedMethods` to narrow it.

## Accepting a recent login instead

A user without a second factor can still reach a guarded operation by logging in again. Say so with `reauth`:

```ts
// src/controllers/profile.controller.ts
import { Auth, Body, Controller, Ms, Patch } from 'zibri';

import { AddressChange, PasswordChange } from '../models';

@Controller('/profile')
class ProfileController {
    @Auth.require2fa({ reauth: true })
    @Patch('/address')
    async updateAddress(@Body(AddressChange) data: AddressChange): Promise<void> { /* your own code */ }

    @Auth.require2fa({ reauth: { allow: 'onlyAsFallback', windowInMs: Ms.MINUTE } })
    @Patch('/password')
    async updatePassword(@Body(PasswordChange) data: PasswordChange): Promise<void> { /* your own code */ }
}
```

Changing the address takes a second factor or a recent login. Changing the password takes a second factor, or a login in the last minute from a user without one.

| `reauth` | A recent login is accepted |
|---|---|
| `false` | never |
| `true` | from every user |
| `'onlyAsFallback'` | only from a user without a confirmed second factor the route allows |
| `{ allow, windowInMs }` | as `allow` says, within `windowInMs` |

A route that does not set `reauth` takes `ZIBRI_DI_TOKENS.REQUIRE_2FA_REAUTH`, which is `false`. A login is recent for 5 minutes, or for what `ZIBRI_DI_TOKENS.REQUIRE_2FA_REAUTH_WINDOW_IN_MS` says:

```ts
// src/providers.ts
import { defineProvider, Ms, ZIBRI_DI_TOKENS } from 'zibri';

defineProvider({ token: ZIBRI_DI_TOKENS.REQUIRE_2FA_REAUTH, useValue: 'onlyAsFallback' })
defineProvider({ token: ZIBRI_DI_TOKENS.REQUIRE_2FA_REAUTH_WINDOW_IN_MS, useFactory: () => Ms.MINUTE * 10 })
```

Only logging in counts. Refreshing a login keeps the time of the login it continues. A user whose login is too old and who has no second factor to present gets a `401` with:

> Log in again to access this route.

The time comes from `resolveAuthenticatedAt` of the [auth strategy](./glossary.md#auth-strategy) that resolved the user, see [auth](./auth.md). A strategy that cannot say when its user logged in, such as one for api keys, never counts as recent.

With `'onlyAsFallback'`, a user who removes their second factor is back to the login. Guard the route that removes it with `@Auth.require2fa()` without `reauth`.

A recent login proves the password and nothing else. Guard these routes with `'onlyAsFallback'` at most, so a user with a second factor has to present it:

- the routes that enroll a second factor, or a password would be enough to add one of the attacker's own. `POST /2fa/registration/request` of the [auth routes](./auth-routes.md) takes `'onlyAsFallback'`
- with [codes by email](#codes-by-email-or-text-message), the route that changes the account's email address, or a password would be enough to send every code to another mailbox

## Accepting the provider's second factor

A user who logs in [through a provider](./login-through-a-provider.md) may have presented a second factor there. The provider says so with the login: an [OpenID Connect](./glossary.md#openid-connect) provider in the `amr` and `acr` claims of the ID token, a [SAML](./glossary.md#saml) identity provider in the AuthnContextClassRef of the assertion. The login keeps it, refreshes included. Say which of them a route counts in place of a second factor presented here, with `providerFactors`:

```ts
// src/controllers/payment.controller.ts
import { Auth, Body, Controller, Patch } from 'zibri';

import { PaymentDetails } from '../models';

@Controller('/payment')
class PaymentController {
    @Auth.require2fa({ providerFactors: { methods: ['mfa', 'hwk'], contextClasses: ['urn:oasis:names:tc:SAML:2.0:ac:classes:TimeSyncToken'] } })
    @Patch('/details')
    async updateDetails(@Body(PaymentDetails) data: PaymentDetails): Promise<void> { /* your own code */ }
}
```

A login counts when its provider reported one of the `methods`, or one of the `contextClasses`. A user whose login counts is not asked for a code. One whose login does not presents a second factor as on any guarded route, or a recent login where the route accepts one. A [locked](#locking-after-too-many-wrong-codes) second factor is not stood in for by the provider's either.

A route that does not set `providerFactors` takes `ZIBRI_DI_TOKENS.REQUIRE_2FA_PROVIDER_FACTORS`, which is `false`, counting none:

```ts
// src/providers.ts
import { defineProvider, Require2faProviderFactors, ZIBRI_DI_TOKENS } from 'zibri';

defineProvider({ token: ZIBRI_DI_TOKENS.REQUIRE_2FA_PROVIDER_FACTORS, useFactory: (): Require2faProviderFactors => ({ methods: ['mfa'] }) })
```

Ask the provider for the factor with `acrValues` on an OpenID Connect authenticator, or `requestedAuthnContext` on a SAML one, see [login through a provider](./login-through-a-provider.md#other-providers). A user whose login does not count then [logs in again](./login-through-a-provider.md#logging-in-again) and presents the factor at the provider.

The factor comes from the strategy the request addresses, through `resolveProviderAuthentication` of `AuthStrategyInterface`. A strategy that does not implement it, such as one for api keys, never counts. A [token of the provider](./provider-tokens.md) counts by its own `amr` and `acr`.

## Asking for a second factor at login

`twoFactorAtLogin` in your app options says whether a login asks for a second factor once its credentials were accepted:

| `twoFactorAtLogin` | A user with a second factor | A user without one |
|---|---|---|
| `'never'` | logs in on their credentials | logs in on their credentials |
| `'ifEnrolled'` | presents it to log in | logs in on their credentials |
| `'required'` | presents it to log in | enrolls their first before the login completes |

```ts
// src/application-options.ts
import { ZibriApplicationOptions } from 'zibri';

export const loginOptions: Pick<ZibriApplicationOptions, 'twoFactorAtLogin'> = {
    twoFactorAtLogin: 'ifEnrolled'
};
```

With anything but `'never'`, declare `LoginTicket` in your data source.

A login that waits for its second factor answers `401` with `SecondFactorRequiredError`: the body every error has, plus the `ticket` the login continues with and the names of the `methods` the user has enrolled:

```txt
POST /auth/login
{ "email": "ada@example.com", "password": "..." }

401 { "name": "SecondFactorRequiredError", "ticket": "...", "methods": ["otp", "email"], ... }
```

The client sends the ticket in the `x-login-ticket` header to the routes the login continues at, see the [auth routes](./auth-routes.md):

```txt
POST /auth/login/2fa/request?method=email
                                sends the code, or answers the challenge for a passkey

POST /auth/login/2fa/confirm
x-authorization-email-code: 123456
                                answers what the login route answers
```

`confirm` takes the second factor in its header, exactly as a guarded route does, and names the strategy in `strategy` like the login route. A wrong code is refused as on any guarded route, and the ticket stays. The ticket is spent by the login it completes, and expires after 5 minutes.

An empty `methods` list means the user has no second factor, and `twoFactorAtLogin` is `'required'`: the ticket enrolls their first, at `POST /auth/login/2fa/registration/request` and `POST /auth/login/2fa/registration/confirm`, which take what [enrolling](#enrolling-a-user) takes. A user who has a second factor is refused there with `403`.

Rename the header through `ZIBRI_DI_TOKENS.LOGIN_TICKET_HEADER`. CORS follows the token.

A login that waits is recorded as `auth.login.pending`, and the completed one as `auth.login`. In a route of your own, `login` of `AuthServiceInterface` throws the `SecondFactorRequiredError`, which answers as above. A login at a provider that logs in on the redirect back is refused when it waits for a second factor: hand it over by code, see [logging in at a provider](./auth-routes.md#logging-in-at-a-provider).

## Enrolling a user

Enrolling takes two steps, and only the second one enables the second factor. The [auth routes](./auth-routes.md) take them at `POST /auth/2fa/registration/request` and `POST /auth/2fa/registration/confirm`, naming the method in `method` when there is more than one:

```txt
POST /auth/2fa/registration/request?method=otp
200 { "qrCodeUrl": "otpauth://totp/...", "secret": "..." }

POST /auth/2fa/registration/confirm?method=otp
{ "token": "123456" }
```

`DELETE /auth/2fa/{method}` removes it again. In routes of your own, `TwoFactorServiceInterface` does the same:

```ts
// src/services/two-factor-enrollment.function.ts
import { OtpRegistration, OtpTwoFactorMethod, TwoFactorServiceInterface, UserAccount } from 'zibri';

export async function enroll(
    twoFactorService: TwoFactorServiceInterface,
    user: UserAccount,
    otpMethod: OtpTwoFactorMethod
): Promise<void> {
    const registration: OtpRegistration = await twoFactorService.requestTwoFactorRegistration(user, otpMethod, undefined);
    await twoFactorService.confirmTwoFactorRegistration(user, otpMethod, { token: '123456' });
}
```

The first step answers what the user scans: `registration.qrCodeUrl`, the `otpauth` URL to show as a QR code, and `registration.secret`, the same secret to type in where scanning is not an option. The second step takes the first code their app shows, and only then does the second factor satisfy `@Auth.require2fa`.

Neither field is stored. Show them to the user once.

The stored secret is an encrypted property, so configure `ZIBRI_DI_TOKENS.ENCRYPTION_MASTER_OPTIONS`,
see [encryption & hashing](./encryption-and-hashing.md). Without it, enrolling throws.

An unconfirmed enrollment satisfies no check.

Asking for a new enrollment abandons any unfinished one. A confirmed credential stays until the new one is confirmed, so a user setting up a new device keeps the one that works.

## Codes are single use

A TOTP code stays the same for its whole 30-second window, so the same six digits are shown for up to half a minute. Each code is accepted once, as RFC 6238 §5.2 requires. Presenting it again is refused with:

> This two factor code has already been used. Wait for your authenticator to show the next one.

This error is distinct from a wrong code, though both answer `401`, so the user knows to wait instead of looking for a typo. Two operations inside the same 30 seconds need two codes, so the second waits for the next one.

A code spent on one instance is spent on all of them.

### Clock skew

Codes are accepted from 30 seconds either side of now, so an authenticator that has drifted still works. Each window is spent separately, so a drifted clock costs the user no code.

```ts
// src/providers.ts
import { defineProvider, OtpValidationWindowInMs, ZIBRI_DI_TOKENS } from 'zibri';

defineProvider({ token: ZIBRI_DI_TOKENS.OTP_VALIDATION_WINDOW_IN_MS, useFactory: (): OtpValidationWindowInMs => 0 })
```

`0` accepts only the current code. It leaves the least room for replaying a code, and a client whose clock is off by more than a few seconds starts failing. Phone clocks drift.

The type accepts `0`, `30_000`, `60_000` and `90_000`, whole 30-second windows. Every window more is another code an observer could still spend.

## Wrong codes
After a wrong code, the user waits before the next code is checked: 1 second after the first, and twice as long after each wrong code in a row: 2 seconds, 4, 8, and so on. The next correct code ends the streak.

A code presented while the user still has to wait answers `429` with a `Retry-After` header, and is not checked at all, so the right code is refused too until the wait is over. Someone who mistypes loses a second or two. Someone guessing gets a few dozen codes a year.

Only a wrong code counts. A request without a code, a code of the wrong length and a code already used are refused without making anyone wait. Codes for one user are checked one at a time, on every instance: a code arriving while another is still being checked answers `429` too.

Every refused code is recorded as `auth.2fa`.

Change the first wait through `ZIBRI_DI_TOKENS.TWO_FACTOR_FAILURE_DELAY_IN_MS`. It has to be greater than `0`:

```ts
// src/providers.ts
import { defineProvider, Ms, ZIBRI_DI_TOKENS } from 'zibri';

defineProvider({ token: ZIBRI_DI_TOKENS.TWO_FACTOR_FAILURE_DELAY_IN_MS, useFactory: () => Ms.SECOND * 5 })
```

Declare `TwoFactorFailureStreak` in your data source.

A method of your own throws `InvalidTwoFactorCodeError` for a wrong code, so that it counts, and its own error for everything else.

### Locking after too many wrong codes
With `twoFactorFailureLimit` in your app options, a user's second factor is locked once they present that many wrong codes in a row:

```ts
// src/application-options.ts
import { ZibriApplicationOptions } from 'zibri';

export const lockingOptions: Pick<ZibriApplicationOptions, 'twoFactorFailureLimit'> = {
    twoFactorFailureLimit: { maxFailures: 10, lock: 'secondFactor' }
};
```

`maxFailures` is a whole number from 1 to 100. The wait still doubles with each wrong code, so the tenth one in a row comes after about 8 minutes of guessing, and a limit above 30 is never reached. It defaults to `false`, which locks nothing.

While a user's second factor is locked, none of their methods is checked, and a route asking for a second factor answers `403` with `TwoFactorLockedError`. A recent login does not stand in for it either, whatever the route's `reauth` says. What else the lock refuses is `lock`:

| `lock` | Login | How the lock is lifted |
|---|---|---|
| `'secondFactor'` | works | a [recovery code](#recovery-codes), or a [reset](#resetting-a-users-second-factors) |
| `'account'` | refused with `AccountLockedError`, and the user's open logins end when the lock is set | a reset |

Every lock is recorded as `auth.2fa.locked`. Setting `twoFactorFailureLimit` back to `false` lifts every lock.

## Recovery codes
Register `RecoveryCodeTwoFactorMethod` beside your other methods to give users a way back when they lose their device. Enrolling answers 10 codes, which are shown once:

```txt
POST /auth/2fa/registration/request?method=recovery-code
200 { "codes": ["K3QZD-7XWPA", "..."] }

POST /auth/2fa/registration/confirm?method=recovery-code
{ "code": "K3QZD-7XWPA" }
```

Confirming takes one of the codes, which proves the user kept them, and does not spend it. Enrolling again gives a new set, which replaces the old one once it is confirmed.

A code is sent in the `x-authorization-recovery-code` header, with or without its dash and in any case, and works once in place of a second factor. While the user's second factor is [locked](#locking-after-too-many-wrong-codes), recovery codes are the only method checked: a correct one removes the user's other methods, lifts the lock, and lets the request through, so the user enrolls a new authenticator. A wrong one counts towards the wait like any wrong code.

Declare `TwoFactorRecoveryCode` in your data source. Rename the header through `ZIBRI_DI_TOKENS.RECOVERY_CODE_HEADER`.

## Resetting a user's second factors
`resetSecondFactors` removes every second factor of a user, recovery codes included, and lifts a lock. Call it from a support or admin route of your own, for a user who lost everything or whose account is locked:

```ts
// src/services/two-factor-reset.function.ts
import { TwoFactorServiceInterface, UserAccount } from 'zibri';

export async function resetForUser(twoFactorService: TwoFactorServiceInterface, user: UserAccount): Promise<void> {
    await twoFactorService.resetSecondFactors(user);
}
```

The user then enrolls anew. Every reset, and every lock a recovery code lifts, is recorded as `auth.2fa.reset`.

## Codes by email or text message

For users without an authenticator app. A code is sent to them when they are about to do something that needs one, and they send it back with the request.

> [!WARNING]
> Both are weaker than the other methods: a text message can be redirected to another device, and whoever can read a mailbox can read the code. Register them only where you want them.

```ts
// src/application-options.ts
import { EmailTwoFactorMethod, SmsTwoFactorMethod, ZibriApplicationOptions } from 'zibri';

export const options: Partial<ZibriApplicationOptions> = {
    twoFactorMethods: [EmailTwoFactorMethod, SmsTwoFactorMethod]
};
```

Declare `TwoFactorCodeCredentials`, `TwoFactorCode` and `RateLimitStateEntity` in your data source. The codes and the phone numbers are encrypted properties, so configure `ZIBRI_DI_TOKENS.ENCRYPTION_MASTER_OPTIONS` too, see [encryption & hashing](./encryption-and-hashing.md).

Email goes through the [email service](./email.md), so it needs a transport. A text message goes through a sender you provide, because every provider needs an account only you have:

```ts
// src/services/sms-gateway.service.ts
import { SendSmsData, SmsServiceInterface } from 'zibri';

import { smsGatewayClient } from './sms-gateway-client';

export class SmsGatewayService implements SmsServiceInterface {
    async send(data: SendSmsData): Promise<void> {
        await smsGatewayClient.messages.create({ to: data.to, body: data.message });
    }
}
```

```ts
// src/providers.ts
import { defineProvider, ZIBRI_DI_TOKENS } from 'zibri';

import { SmsGatewayService } from './services/sms-gateway.service';

defineProvider({ token: ZIBRI_DI_TOKENS.SMS_SERVICE, useClass: SmsGatewayService })
```

### What text messages cost

Every text message costs you money, and the number is the user's to choose. Say how many codes you text in an hour, how many one number is texted in a day, and to which countries:

```ts
// src/providers.ts
import { defineProvider, SmsCodeLimits, ZIBRI_DI_TOKENS } from 'zibri';

defineProvider({
    token: ZIBRI_DI_TOKENS.SMS_CODE_LIMITS,
    useFactory: (): SmsCodeLimits => ({ maxPerHour: 200, maxPerNumberPerDay: 5, allowedCallingCodes: ['+49', '+43', '+41'] })
})
```

`SMS_CODE_LIMITS` is required with `SmsTwoFactorMethod`.

- A number that starts with none of `allowedCallingCodes` is refused with `400`, when enrolling and when asking for a code.
- A number that was sent `maxPerNumberPerDay` codes is refused with `429`, whichever account asks.
- Once `maxPerHour` codes were texted, every text message is refused with `429` until the hour has room again. Codes by email still go out.

Each is counted across all instances of your application.

### Enrolling

The same two steps as for an authenticator app, at the same routes. The first sends a code, the second confirms it:

```txt
POST /auth/2fa/registration/request?method=sms
{ "phoneNumber": "+4915112345678" }

POST /auth/2fa/registration/confirm?method=sms
{ "code": "654321" }
```

Or through `TwoFactorServiceInterface`:

```ts
// src/services/two-factor-enrollment.function.ts
import { EmailTwoFactorMethod, SmsTwoFactorMethod, TwoFactorServiceInterface, UserAccount } from 'zibri';

export async function enrollByCode(
    twoFactorService: TwoFactorServiceInterface,
    user: UserAccount,
    emailMethod: EmailTwoFactorMethod,
    smsMethod: SmsTwoFactorMethod
): Promise<void> {
    await twoFactorService.requestTwoFactorRegistration(user, emailMethod, undefined);
    await twoFactorService.confirmTwoFactorRegistration(user, emailMethod, { code: '123456' });

    await twoFactorService.requestTwoFactorRegistration(user, smsMethod, { phoneNumber: '+4915112345678' });
    await twoFactorService.confirmTwoFactorRegistration(user, smsMethod, { code: '654321' });
}
```

The email code goes to the address of the account, the text message to the number, which is kept encrypted. An enrollment that was not confirmed satisfies nothing. Asking again gives up on it; a confirmed one stays until the new one is confirmed. `SmsTwoFactorMethod` takes the number in international format and refuses anything else, and so does `SmsRegistrationRequestData` as a request body.

### Asking for a code

`POST /auth/2fa/request?method=email` sends the code to a logged in user who enrolled. In a route of your own, `requestSecondFactor` of `TwoFactorServiceInterface` does the same:

```ts
// src/controllers/account.controller.ts
import { Auth, Controller, CurrentUser, EmailTwoFactorMethod, Inject, Post, Response, TwoFactorServiceInterface, ZIBRI_DI_TOKENS } from 'zibri';

@Controller('/account-codes')
class AccountCodeController {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.TWO_FACTOR_SERVICE)
        private readonly twoFactorService: TwoFactorServiceInterface,
        @Inject(EmailTwoFactorMethod)
        private readonly emailMethod: EmailTwoFactorMethod
    ) {}

    @Auth.isLoggedIn()
    @Response.empty()
    @Post('/email-code')
    async sendEmailCode(@CurrentUser() user: CurrentUser): Promise<void> {
        await this.twoFactorService.requestSecondFactor(user, this.emailMethod);
    }
}
```

The client then sends the code in `x-authorization-email-code` or `x-authorization-sms-code`, with the request to the route that has `@Auth.require2fa()`.

### How codes behave

- A code has 6 digits and is valid for 10 minutes. It is stored encrypted.
- It works once. Entering it uses it up, so each guarded request needs a code of its own.
- A new code replaces the one before it.
- A wrong code counts as a [wrong code in a row](#wrong-codes), so the user waits before the next one is checked.
- A user is sent a code at most once a minute for each method, whether they enroll or log in. Asking sooner is refused with `429` and a `Retry-After` header, and sends nothing. Together with the above, an email or text message user passes at most one guarded request a minute.

Change them with `ZIBRI_DI_TOKENS.TWO_FACTOR_CODE_OPTIONS`:

```ts
// src/providers.ts
import { defineProvider, Ms, TwoFactorCodeOptions, ZIBRI_DI_TOKENS } from 'zibri';

defineProvider({
    token: ZIBRI_DI_TOKENS.TWO_FACTOR_CODE_OPTIONS,
    useFactory: (): TwoFactorCodeOptions => ({ digits: 8, expiresInMs: Ms.MINUTE * 5, resendAfterInMs: Ms.MINUTE * 2 })
})
```

The once a minute is counted by `TwoFactorCodeRateLimiter`, in `RateLimitStateEntity`, so it holds across all instances of your application.

### Another way of sending

To change what the email says, extend `EmailTwoFactorMethod` and override `deliver`, then register your class instead.

For a new way of sending a code, extend `CodeTwoFactorMethod`. Give it a `channel` of its own, which keeps its enrollments and its once a minute apart from the other methods and is its `name` in the routes, and the model of what enrolling takes:

```ts
// src/two-factor/messenger.two-factor-method.ts
import { CodeTwoFactorMethod, Newable, Property, UserAccount } from 'zibri';

import { messenger } from './messenger';

export class MessengerRegistrationRequestData {
    @Property.string()
    handle!: string;
}

export class MessengerTwoFactorMethod extends CodeTwoFactorMethod<MessengerRegistrationRequestData> {
    readonly registrationRequestModel: Newable<MessengerRegistrationRequestData> = MessengerRegistrationRequestData;
    protected readonly channel: string = 'messenger';

    protected async deliver(user: UserAccount, destination: string | undefined, code: string): Promise<void> {
        await messenger.send(destination ?? '', `Your code is ${code}`);
    }

    protected resolveDestination(data: MessengerRegistrationRequestData): string {
        return data.handle;
    }

    protected resolveHeader(): string {
        return 'x-authorization-messenger-code';
    }
}
```

Add a header of your own to `additionalAllowedHeaders` of the CORS options, see [app settings](./app-settings.md).

A method that sends no code implements `TwoFactorMethod`. The [auth routes](./auth-routes.md) read these members of it:

| Member | What it is |
|---|---|
| `name` | What the routes name the method by. Unique |
| `registrationRequestModel` | The body `POST /2fa/registration/request` takes |
| `registrationConfirmModel` | The body `POST /2fa/registration/confirm` takes |
| `registrationRequestResultModel` | What `POST /2fa/registration/request` answers with. Undefined when it answers nothing |
| `secondFactorRequestModel` | What `POST /2fa/request` answers with. Undefined when it answers nothing |
| `requestSecondFactor` | What `POST /2fa/request` does, such as sending a code |

`unlocksLockedFactors` marks a method as the way back from a [lock](#locking-after-too-many-wrong-codes), as recovery codes are: while a user is locked, only such a method is checked.

## Sending the code

Clients send it in the `x-authorization-otp` header. Rename it through `ZIBRI_DI_TOKENS.OTP_HEADER`. CORS follows the token, so a browser client keeps working without further configuration. A passkey goes in a header of its own, see [passkeys](./passkeys.md#as-a-second-factor).

## Requirements
| Package | Used for |
|---|---|
| `otpauth` | Creating and checking the codes of authenticator apps. You install it |

Your data source declares these entities:

| Entity | Needed when |
|---|---|
| `TwoFactorFailureStreak` | A two-factor method is registered |
| `LoginTicket` | `twoFactorAtLogin` is not `'never'` |
| `OtpCredentials` | `OtpTwoFactorMethod` is registered |
| `TwoFactorCodeCredentials`, `TwoFactorCode`, `RateLimitStateEntity` | `EmailTwoFactorMethod` or `SmsTwoFactorMethod` is registered |
| `TwoFactorRecoveryCode` | `RecoveryCodeTwoFactorMethod` is registered |

How large each table grows, and what deletes its rows, is in [framework tables](./framework-tables.md).

## See also
- [Auth](./auth.md) — who the user is, which this builds on
- [Creating endpoints](./creating-endpoints.md#securing-endpoints) — the `@Auth` decorators
- [App settings](./app-settings.md) — CORS and security headers
