# Two factor
Requiring a second factor on the operations that deserve one. Ships with TOTP — the six digit codes an authenticator app shows —, with [passkeys](./passkeys.md#as-a-second-factor), and with codes sent by [email or text message](#codes-by-email-or-text-message).

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `TwoFactorServiceInterface` | interface | Enrolling, confirming and removing a user's second factor |
| `TwoFactorMethod` | interface | The contract a method implements. Implement it to add your own |
| `OtpTwoFactorMethod` | class | The TOTP method. Registered by default when you configure none |
| `PasskeyTwoFactorMethod` | class | A passkey as the second factor, see [passkeys](./passkeys.md#as-a-second-factor) |
| `EmailTwoFactorMethod` | class | A code mailed to the user's address, see [codes by email or text message](#codes-by-email-or-text-message) |
| `SmsTwoFactorMethod` | class | A code sent as a text message |
| `CodeTwoFactorMethod` | class | What the two above are built on. Extend it for another way of sending a code, see [another way of sending](#another-way-of-sending) |
| `SmsServiceInterface` | interface | What sends a text message. You provide it |
| `SendSmsData` | type | A text message: the number and the text |
| `ZIBRI_DI_TOKENS.SMS_SERVICE` | DI token | Injects `SmsServiceInterface`. Required by `SmsTwoFactorMethod` |
| `SmsRegisterData` | class | What enrolling by text message needs: the phone number |
| `TwoFactorCodeCredentials` | entity | Where a user receives codes, and whether they confirmed it |
| `TwoFactorCode` | entity | A code that was sent and not yet entered. Kept encrypted |
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
| `TwoFactorRecoveryCode` | entity | One recovery code of a user. Kept hashed |
| `ZIBRI_DI_TOKENS.RECOVERY_CODE_HEADER` | DI token | Which header carries a recovery code. Defaults to `x-authorization-recovery-code` |
| `OtpValidationWindowInMs` | type | The clock skew a code may be accepted across |
| `ZIBRI_DI_TOKENS.OTP_HEADER` | DI token | Which header carries the code. Defaults to `x-authorization-otp` |
| `ZIBRI_DI_TOKENS.OTP_VALIDATION_WINDOW_IN_MS` | DI token | How much skew to allow. Defaults to 30 seconds |
| `Require2faReauth` | type | Whether a route accepts a recent login in place of a second factor |
| `ReauthenticationRequiredError` | error | Thrown when the route accepts a recent login and the user's is too old |
| `ZIBRI_DI_TOKENS.REQUIRE_2FA_REAUTH` | DI token | What a route that says nothing about `reauth` accepts. Defaults to `false` |
| `ZIBRI_DI_TOKENS.REQUIRE_2FA_REAUTH_WINDOW_IN_MS` | DI token | How recent a login has to be. Defaults to 5 minutes |

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

Called with no argument, any method the app has configured is accepted. Pass `allowedMethods` to narrow it.

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
    async updateAddress(@Body(AddressChange) data: AddressChange): Promise<void> { /* a code or a recent login */ }

    @Auth.require2fa({ reauth: { allow: 'onlyAsFallback', windowInMs: Ms.MINUTE } })
    @Patch('/password')
    async updatePassword(@Body(PasswordChange) data: PasswordChange): Promise<void> { /* a code, or a login in the last minute from a user without one */ }
}
```

| `reauth` | A recent login is accepted |
|---|---|
| `false` | never |
| `true` | from every user |
| `'onlyAsFallback'` | only from a user without a confirmed second factor the route allows |
| `{ allow, windowInMs }` | as `allow` says, within `windowInMs` |

A route that does not set `reauth` takes `ZIBRI_DI_TOKENS.REQUIRE_2FA_REAUTH`, which is `false`. A login is recent for 5 minutes, or for what `ZIBRI_DI_TOKENS.REQUIRE_2FA_REAUTH_WINDOW_IN_MS` says:

```ts
import { defineProvider, Ms, ZIBRI_DI_TOKENS } from 'zibri';

defineProvider({ token: ZIBRI_DI_TOKENS.REQUIRE_2FA_REAUTH, useValue: 'onlyAsFallback' })
defineProvider({ token: ZIBRI_DI_TOKENS.REQUIRE_2FA_REAUTH_WINDOW_IN_MS, useFactory: () => Ms.MINUTE * 10 })
```

Only logging in counts. Refreshing a login keeps the time of the login it continues. A user whose login is too old and who has no second factor to present gets a `401` with:

> Log in again to access this route.

The time comes from `resolveAuthenticatedAt` of the auth strategy that resolved the user, see [auth](./auth.md). A strategy that cannot say when its user logged in, such as one for api keys, never counts as recent.

With `'onlyAsFallback'`, a user who removes their second factor is back to the login. Guard the route that removes it with `@Auth.require2fa()` without `reauth`.

A recent login proves the password and nothing else. Guard these routes with `'onlyAsFallback'` at most, so a user with a second factor has to present it:

- the routes that enrol a second factor, or a password would be enough to add one of the attacker's own. `POST /2fa/register` of the [auth routes](./auth-routes.md) takes `'onlyAsFallback'`
- with [codes by email](#codes-by-email-or-text-message), the route that changes the account's email address, or a password would be enough to send every code to another mailbox

## Enrolling a user

Two steps, and the second one is not optional. The [auth routes](./auth-routes.md) take them at `POST /auth/2fa/register` and `POST /auth/2fa/confirm`, naming the method in `method` when there is more than one:

```txt
POST /auth/2fa/register?method=otp
200 { "qrCodeUrl": "otpauth://totp/...", "secret": "..." }

POST /auth/2fa/confirm?method=otp
{ "token": "123456" }
```

`DELETE /auth/2fa/{method}` removes it again. In routes of your own, `TwoFactorServiceInterface` does the same:

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

## Wrong codes
After a wrong code, the user waits before the next code is checked: 1 second after the first, and twice as long after each wrong code in a row — 2 seconds, 4, 8, and so on. The next correct code ends the streak.

A code presented while the user still has to wait answers `429` with a `Retry-After` header, and is not checked at all, so the right code is refused too until the wait is over. Someone who mistypes loses a second or two. Someone guessing gets a few dozen codes a year.

Only a wrong code counts. A request without a code, a code of the wrong length and a code already used are refused without making anyone wait. Codes for one user are checked one at a time, on every instance: a code arriving while another is still being checked answers `429` too.

Every refused code is recorded as `auth.2fa`.

Change the first wait through `ZIBRI_DI_TOKENS.TWO_FACTOR_FAILURE_DELAY_IN_MS`. It has to be greater than `0`:

```ts
import { defineProvider, Ms, ZIBRI_DI_TOKENS } from 'zibri';

defineProvider({ token: ZIBRI_DI_TOKENS.TWO_FACTOR_FAILURE_DELAY_IN_MS, useFactory: () => Ms.SECOND * 5 })
```

Declare `TwoFactorFailureStreak` in your data source. The application refuses to start without it.

A method of your own throws `InvalidTwoFactorCodeError` for a wrong code, so that it counts, and its own error for everything else.

### Locking after too many wrong codes
With `twoFactorFailureLimit` in your app options, a user's second factor is locked once they present that many wrong codes in a row:

```ts
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
POST /auth/2fa/register?method=recovery-code
200 { "codes": ["K3QZD-7XWPA", "..."] }

POST /auth/2fa/confirm?method=recovery-code
{ "code": "K3QZD-7XWPA" }
```

Confirming takes one of the codes, which proves the user kept them, and does not spend it. Enrolling again gives a new set, which replaces the old one once it is confirmed.

A code is sent in the `x-authorization-recovery-code` header, with or without its dash and in any case, and works once in place of a second factor. While the user's second factor is [locked](#locking-after-too-many-wrong-codes), recovery codes are the only method checked: a correct one removes the user's other methods, lifts the lock, and lets the request through, so the user enrolls a new authenticator. A wrong one counts towards the wait like any wrong code.

Declare `TwoFactorRecoveryCode` in your data source. The application refuses to start without it once the method is registered. Rename the header through `ZIBRI_DI_TOKENS.RECOVERY_CODE_HEADER`.

## Resetting a user's second factors
`resetSecondFactors` removes every second factor of a user, recovery codes included, and lifts a lock. Call it from a support or admin route of your own, for a user who lost everything or whose account is locked:

```ts
export async function resetForUser(twoFactorService: TwoFactorServiceInterface, user: BaseUser<string>): Promise<void> {
    await twoFactorService.resetSecondFactors(user);
}
```

The user then enrolls anew. Every reset, and every lock a recovery code lifts, is recorded as `auth.2fa.reset`.

## Codes by email or text message

For users without an authenticator app. A code is sent to them when they are about to do something that needs one, and they send it back with the request. It is weaker than the other methods: a text message can be redirected to another device, and whoever can read a mailbox can read the code. Register them only where you want them.

```ts
// src/app.ts
import { EmailTwoFactorMethod, SmsTwoFactorMethod, ZibriApplicationOptions } from 'zibri';

export const options: Partial<ZibriApplicationOptions> = {
    twoFactorMethods: [EmailTwoFactorMethod, SmsTwoFactorMethod]
};
```

Declare `TwoFactorCodeCredentials`, `TwoFactorCode` and `RateLimitStateEntity` in your data source. The application refuses to start without them. The codes and the phone numbers are encrypted properties, so configure `ZIBRI_DI_TOKENS.ENCRYPTION_MASTER_OPTIONS` too — see [encryption & hashing](./encryption-and-hashing.md).

Email goes through the [email service](./email.md), so it needs a transport. A text message goes through a sender you provide, because every provider needs an account only you have:

```ts
// src/sms/my-provider.sms-service.ts
import { SendSmsData, SmsServiceInterface } from 'zibri';

import { myProvider } from './my-provider';

export class MyProviderSmsService implements SmsServiceInterface {
    async send(data: SendSmsData): Promise<void> {
        await myProvider.messages.create({ to: data.to, body: data.message });
    }
}
```

```ts
// src/providers.ts
import { defineProvider, ZIBRI_DI_TOKENS } from 'zibri';

defineProvider({ token: ZIBRI_DI_TOKENS.SMS_SERVICE, useClass: MyProviderSmsService })
```

The application refuses to start with `SmsTwoFactorMethod` and no `SMS_SERVICE`.

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

The application refuses to start with `SmsTwoFactorMethod` and no `SMS_CODE_LIMITS`.

- A number that starts with none of `allowedCallingCodes` is refused with `400`, when enrolling and when asking for a code.
- A number that was sent `maxPerNumberPerDay` codes is refused with `429`, whichever account asks.
- Once `maxPerHour` codes were texted, every text message is refused with `429` until the hour has room again. Codes by email still go out.

Each is counted across all instances of your application.

### Enrolling

The same two steps as for an authenticator app, at the same routes. The first sends a code, the second confirms it:

```txt
POST /auth/2fa/register?method=sms
{ "phoneNumber": "+4915112345678" }

POST /auth/2fa/confirm?method=sms
{ "code": "654321" }
```

Or through `TwoFactorServiceInterface`:

```ts
export async function enrolByCode(
    twoFactorService: TwoFactorServiceInterface,
    user: BaseUser<string>,
    emailMethod: EmailTwoFactorMethod,
    smsMethod: SmsTwoFactorMethod
): Promise<void> {
    // the code goes to the address of the account
    await twoFactorService.requestRegisterTwoFactorMethodForUser(user, emailMethod, undefined);
    await twoFactorService.confirmRegisterTwoFactorMethodForUser(user, emailMethod, { code: '123456' });

    // the code goes to the number, which is kept encrypted
    await twoFactorService.requestRegisterTwoFactorMethodForUser(user, smsMethod, { phoneNumber: '+4915112345678' });
    await twoFactorService.confirmRegisterTwoFactorMethodForUser(user, smsMethod, { code: '654321' });
}
```

An enrollment that was not confirmed satisfies nothing. Asking again gives up on it; a confirmed one stays until the new one is confirmed. `SmsTwoFactorMethod` takes the number in international format and refuses anything else, and so does `SmsRegisterData` as a request body.

### Asking for a code

`POST /auth/2fa/start?method=email` sends the code to a logged in user who enrolled. In a route of your own, `startSecondFactor` of `TwoFactorServiceInterface` does the same:

```ts
// src/controllers/account.controller.ts
import { Auth, BaseUser, Controller, CurrentUser, EmailTwoFactorMethod, Inject, Post, Response, TwoFactorServiceInterface, ZIBRI_DI_TOKENS } from 'zibri';

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
    async sendEmailCode(@CurrentUser() user: BaseUser<string>): Promise<void> {
        await this.twoFactorService.startSecondFactor(user, this.emailMethod);
    }
}
```

The client then sends the code in `x-authorization-email-code` or `x-authorization-sms-code`, with the request to the route that has `@Auth.require2fa()`.

### How codes behave

- A code has 6 digits and is valid for 10 minutes. It is stored encrypted.
- It works once. Entering it uses it up, so each guarded request needs a code of its own.
- A new code replaces the one before it.
- A wrong code counts as a [wrong code in a row](#wrong-codes), so the user waits before the next one is checked.
- A user is sent a code at most once a minute for each method, whether they enrol or log in. Asking sooner is refused with `429` and a `Retry-After` header, and sends nothing. Together with the above, an email or text message user passes at most one guarded request a minute.

Change them with `ZIBRI_DI_TOKENS.TWO_FACTOR_CODE_OPTIONS`:

```ts
import { defineProvider, Ms, TwoFactorCodeOptions, ZIBRI_DI_TOKENS } from 'zibri';

defineProvider({
    token: ZIBRI_DI_TOKENS.TWO_FACTOR_CODE_OPTIONS,
    useFactory: (): TwoFactorCodeOptions => ({ digits: 8, expiresInMs: Ms.MINUTE * 5, resendAfterMs: Ms.MINUTE * 2 })
})
```

The once a minute is counted by `TwoFactorCodeRateLimiter`, in `RateLimitStateEntity`, so it holds across all instances of your application.

### Another way of sending

To change what the email says, extend `EmailTwoFactorMethod` and override `deliver`, then register your class instead.

For a new way of sending a code, extend `CodeTwoFactorMethod`. Give it a `channel` of its own, which keeps its enrollments and its once a minute apart from the other methods and is its `name` in the routes, and the model of what enrolling takes:

```ts
// src/two-factor/messenger.two-factor-method.ts
import { BaseUser, CodeTwoFactorMethod, Newable, Property } from 'zibri';

import { messenger } from './messenger';

export class MessengerRegisterData {
    @Property.string()
    handle!: string;
}

export class MessengerTwoFactorMethod extends CodeTwoFactorMethod<MessengerRegisterData> {
    readonly requestRegisterModel: Newable<MessengerRegisterData> = MessengerRegisterData;
    protected readonly channel: string = 'messenger';

    protected async deliver(user: BaseUser<string>, destination: string | undefined, code: string): Promise<void> {
        await messenger.send(destination ?? '', `Your code is ${code}`);
    }

    protected resolveDestination(data: MessengerRegisterData): string {
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
| `requestRegisterModel` | The body `POST /2fa/register` takes |
| `confirmRegisterModel` | The body `POST /2fa/confirm` takes |
| `registrationModel` | What `POST /2fa/register` answers with. Undefined when it answers nothing |
| `secondFactorStartModel` | What `POST /2fa/start` answers with. Undefined when it answers nothing |
| `startSecondFactor` | What `POST /2fa/start` does, such as sending a code |

`unlocksLockedFactors` marks a method as the way back from a [lock](#locking-after-too-many-wrong-codes), as recovery codes are: while a user is locked, only such a method is checked.

## Sending the code

Clients send it in the `x-authorization-otp` header. Rename it through `ZIBRI_DI_TOKENS.OTP_HEADER` — CORS follows the token, so a browser client keeps working without further configuration. A passkey goes in a header of its own, see [passkeys](./passkeys.md#as-a-second-factor).

## See also
- [Auth](./auth.md) — who the user is, which this builds on
- [Creating endpoints](./creating-endpoints.md#securing-endpoints) — the `@Auth` decorators
- [App settings](./app-settings.md) — CORS and security headers
