---
keywords: [webauthn, fido, fido2, biometrics, passwordless, security key, fingerprint]
---

# Passkeys
Users log in with a [passkey](../glossary.md#passkey): a key their phone, laptop or security key holds, which it only uses once they have touched a fingerprint reader, shown their face or typed the device's PIN. There is nothing to type and nothing to steal from your database, and a passkey only works on your site, so a phishing page cannot use it. The login ends in the same JWT or cookie login a password gives, and a passkey is also a [second factor](../glossary.md#second-factor) for `@Auth.require2fa`.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `PasskeyAuthenticator` | class | Logs users in with a passkey, and links passkeys to them |
| `PasskeyTwoFactorMethod` | class | A passkey as the second factor of an operation |
| `AuthController` | function | Defines the passkey routes, among the other auth routes. See [the auth routes](./auth-routes.md) |
| `PasskeyOptions` | type | Where passkeys are used, via `ZIBRI_DI_TOKENS.PASSKEY_OPTIONS`. Required |
| `PasskeyAttestationOptions` | type | Which models of device may hold a passkey |
| `Passkey` | entity | A passkey of a user |
| `PasskeyChallenge`, `PasskeyRegistrationTicket` | entity | A passkey being created or used |
| `PasskeyCeremony` | enum | What a challenge was issued for: a login, a registration, adding a passkey or a second factor |
| `PasskeyCreationOptions`, `PasskeyRequestOptions` | class | What the browser creates and uses a passkey with |
| `PasskeyRegistrationResponse`, `PasskeyAuthenticationResponse` | class | What the browser answers once it has |
| `PasskeyAttestation`, `PasskeyAssertion` | class, class | The `response` of those answers: what the device says when it creates a passkey, and when it uses one |
| `PasskeyAttachment` | enum | Where the device holding a passkey is: built into the device the browser runs on, or another one |
| `PasskeyCredentialType` | enum | The type of credential every answer names: `public-key` |
| `PasskeyRegistrationInput`, `PasskeyLoginInput` | class | Those answers, as the passkey routes take them |
| `PasskeyRegistrationRequest` | class | What requesting a registration takes: the name the device lists the account under |
| `PasskeyTicketCredentials` | class | The [ticket](../glossary.md#ticket) a registration continues with at your own route |
| `PasskeyRegistration` | type | What the passkey of a registration says about the user |
| `PasskeyAdditionRequest` | class | What adding a passkey to a user takes |
| `PasskeyCredentials` | type | What logs in with a passkey: an answer to a login, or the ticket of a registration |
| `PasskeyServiceInterface`, `PasskeyService` | interface, class | Creates and checks passkeys. Replaceable through `ZIBRI_DI_TOKENS.PASSKEY_SERVICE` |
| `FidoMetadataServiceInterface`, `FidoMetadataService` | interface, class | Reads the FIDO Metadata Service. Replaceable through `ZIBRI_DI_TOKENS.FIDO_METADATA_SERVICE` |
| `FIDO_METADATA_SERVICE_URL`, `FIDO_METADATA_SERVICE_ROOT_CERTIFICATES` | constant | Where the FIDO Alliance publishes its metadata, and the roots it signs it under |
| `PasskeyCleanupCronJob` | cron job | Deletes the challenges and tickets that expired. Registered for you |
| `ZIBRI_DI_TOKENS.PASSKEY_HEADER` | DI token | Which header carries a passkey as a second factor. Defaults to `x-authorization-passkey` |

## Setting it up
Install `@simplewebauthn/server`, and declare the three entities in the data source your users live in:

```ts
// src/data-sources/db.data-source.ts
import { Passkey, PasskeyChallenge, PasskeyRegistrationTicket } from 'zibri';

export const passkeyEntities = [Passkey, PasskeyChallenge, PasskeyRegistrationTicket];
```

Register the [authenticator](../glossary.md#authenticator) next to the strategy, and give it to the [auth routes](./auth-routes.md):

```ts
// src/application-options.ts
import { AuthController, Controller, CookieAuthStrategy, OtpTwoFactorMethod, PasskeyAuthenticator, ZibriApplicationOptions } from 'zibri';

@Controller('/auth', { versions: 'all' })
export class AppAuthController extends AuthController({
    strategies: [CookieAuthStrategy],
    authenticators: [PasskeyAuthenticator],
    twoFactorMethods: [OtpTwoFactorMethod]
}) {}

export const passkeyOptions: Pick<ZibriApplicationOptions, 'authenticators' | 'authStrategies' | 'controllers'> = {
    authenticators: [PasskeyAuthenticator],
    authStrategies: [CookieAuthStrategy],
    controllers: [AppAuthController]
};
```

Then say where passkeys are used:

```ts
// src/providers.ts
import { defineProvider, ZIBRI_DI_TOKENS } from 'zibri';

export const passkeyOptionsProvider = defineProvider({
    token: ZIBRI_DI_TOKENS.PASSKEY_OPTIONS,
    useValue: {
        relyingPartyId: 'example.com',
        relyingPartyName: 'Example',
        origins: ['https://app.example.com']
    }
});
```

| Option | What it is |
|---|---|
| `relyingPartyId` | The domain passkeys are bound to. A passkey works on this domain and its subdomains. Required |
| `relyingPartyName` | The name a device shows when it creates a passkey. Required |
| `origins` | The origins of the pages passkeys are created and used on. An answer from any other page is refused. Required |
| `attestation` | Which models of device may hold a passkey, see [restricting the devices](#restricting-the-devices). Any by default |
| `challengeExpiresInMs` | How long a device may take to answer. 5 minutes by default |
| `registrationTicketExpiresInMs` | How long your registration may take after the passkey was created. 30 minutes by default |

> [!WARNING]
> Changing `relyingPartyId` makes every passkey unusable.

## Logging in
The frontend asks for a challenge, has the browser use a passkey with it, and sends the answer to the login route:

```ts
// src/login.ts, in the browser
export async function logInWithPasskey(apiUrl: string): Promise<Response> {
    const options: PublicKeyCredentialRequestOptionsJSON = await (await fetch(`${apiUrl}/auth/login-options`, { method: 'POST' })).json();
    const credential: Credential | null = await navigator.credentials.get({ publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(options) });
    if (!(credential instanceof PublicKeyCredential)) {
        throw new Error('No passkey was used.');
    }
    return await fetch(`${apiUrl}/auth/login?authenticator=passkey`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ response: credential.toJSON() })
    });
}
```

The browser offers the passkeys the device holds for your site, and the one the user picks names them, so a login asks for no email. The login route answers like the password login of the same strategy: with the tokens for a JWT login, with the session cookies for a cookie login. Name the authenticator in `authenticator` when your auth controller has more than one, see [naming the strategy and the authenticator](./auth-routes.md#naming-the-strategy-and-the-authenticator).

A challenge takes one answer, from the origins you listed, within `challengeExpiresInMs`. A device has to have verified its user.

## Registering with a passkey
A user without an account creates one with nothing but a passkey, in three steps:

1. `POST /auth/registration/request` with the name the device lists the account under, such as the email they register with: `{ "name": "ada@example.com" }`. It answers with what `PublicKeyCredential.parseCreationOptionsFromJSON` takes.
2. The browser creates the passkey with `navigator.credentials.create`.
3. `POST /auth/registration/confirm` with `{ "response": credential.toJSON() }`. It answers with a one-time `ticket`.

Your own registration route takes the ticket, creates the user, links the passkey and logs them in with the ticket. Create and link in one transaction, and log in once it is committed:

```ts
// src/controllers/registration.controller.ts
import { AuthServiceInterface, Body, CookieAuthData, CookieAuthStrategy, Controller, Inject, inject, PasskeyAuthenticator, PasskeyRegistration, PasskeyTicketCredentials, Post, Repository, repositoryTokenFor, Transaction, ZIBRI_DI_TOKENS } from 'zibri';

import { User } from '../models';

@Controller('/registration')
export class RegistrationController {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.AUTH_SERVICE)
        private readonly authService: AuthServiceInterface
    ) {}

    @Post('/passkey')
    async register(
        @Body(PasskeyTicketCredentials)
        credentials: PasskeyTicketCredentials
    ): Promise<CookieAuthData<string>> {
        const users: Repository<User> = inject(repositoryTokenFor(User));
        const transaction: Transaction = await users.dataSource.startTransaction();
        try {
            const registration: PasskeyRegistration = await this.authService.resolveRegistration(PasskeyAuthenticator, credentials, transaction);
            const user: User = await users.create({ email: registration.name, roles: [] }, { transaction });
            await this.authService.linkTicketIdentity(PasskeyAuthenticator, credentials, user.id, transaction);
            await transaction.commit();
        }
        catch (error) {
            await transaction.rollback();
            throw error;
        }
        return await this.authService.login(PasskeyAuthenticator, CookieAuthStrategy, credentials, undefined);
    }
}
```

`registration.name` is the name the registration started with, which nothing has proven. Verify an email before you trust it. The ticket logs in once.

A registration asks for a passkey the device stores, so the user can log in with it again. A security key that cannot store one is refused by the browser there.

## Adding a passkey to an account
A user who is logged in adds a passkey in two steps:

1. `POST /auth/link-identity/request?authenticator=passkey` with the name the device lists the account under: `{ "name": "ada@example.com" }`. It answers with what `PublicKeyCredential.parseCreationOptionsFromJSON` takes.
2. The browser creates the passkey, and the frontend sends the answer to `POST /auth/link-identity/confirm?authenticator=passkey` as `{ "response": credential.toJSON() }`, logged in as the same user.

The first step takes a second factor, or a [recent login](./two-factor.md#accepting-a-recent-login-instead) in its place, as changing a password does. In routes of your own, `requestLinkIdentity` and `confirmLinkIdentity` of `AuthServiceInterface` do the same.

A device that cannot store a passkey, such as an older security key, is added as well. Its passkey is a second factor and does not log in, since a login names no passkey and the device has none to offer.

### Listing and removing
A passkey is an identity linked to its user, like an account at a provider. `GET /auth/identities` lists the passkeys among the user's identities, under the authenticator name `passkey`, each with when it was created and last used, whether it is synced to the user's other devices, whether the device stores it and so logs in with it as `discoverable`, and the model of the device as its `aaguid`. `DELETE /auth/identities/{identityId}` removes one. See [listing and unlinking](./login-through-a-provider.md#listing-and-unlinking).

> [!WARNING]
> A user without a password or a provider has no way to log in once their last passkey that logs in is removed.

## As a second factor
Register `PasskeyTwoFactorMethod`, name it in the `twoFactorMethods` of your auth controller, and declare `Passkey` and `PasskeyChallenge`:

```ts
// src/application-options.ts
import { PasskeyTwoFactorMethod, ZibriApplicationOptions } from 'zibri';

export const twoFactorOptions: Pick<ZibriApplicationOptions, 'twoFactorMethods'> = {
    twoFactorMethods: [PasskeyTwoFactorMethod]
};
```

Before a guarded request, the frontend asks `POST /auth/2fa/request?method=passkey` for a challenge, logged in, has the browser use a passkey with it, and sends `credential.toJSON()` as base64url encoded JSON in the `x-authorization-passkey` header. Rename the header through `ZIBRI_DI_TOKENS.PASSKEY_HEADER`; CORS follows the token.

The device always verifies its user. A passkey counts for the user it belongs to only, and each answer once. The passkeys are those the user logs in with: enrolling the method at `POST /auth/2fa/registration/request?method=passkey` and `POST /auth/2fa/registration/confirm?method=passkey` adds a passkey, and removing it removes every passkey of the user. A security key that cannot store a passkey is a second factor too.

A login with a passkey counts as a [recent login](./two-factor.md#accepting-a-recent-login-instead).

## Restricting the devices
Every device can hold a passkey unless you list the models allowed. A device then proves its model when it creates a passkey, and its proof is checked against what the [FIDO Metadata Service](https://fidoalliance.org/metadata/) publishes:

```ts
// src/providers.ts
import { defineProvider, ZIBRI_DI_TOKENS } from 'zibri';

export const companyKeysOnly = defineProvider({
    token: ZIBRI_DI_TOKENS.PASSKEY_OPTIONS,
    useValue: {
        relyingPartyId: 'example.com',
        relyingPartyName: 'Example',
        origins: ['https://app.example.com'],
        attestation: { allowedAaguids: ['cb69481e-8ff7-4039-93ec-0a2729a154a8'] }
    }
});
```

| Option | What it is |
|---|---|
| `allowedAaguids` | The models allowed, by their AAGUID |
| `metadataServiceUrl` | Where the metadata is downloaded from. `FIDO_METADATA_SERVICE_URL` by default |
| `metadataServiceRootCertificates` | The certificates the metadata has to be signed under, PEM encoded. `FIDO_METADATA_SERVICE_ROOT_CERTIFICATES` by default |

A passkey is created only on a device that names an allowed model, proves it with a certificate issued under the root the metadata names for that model, and whose model has not been reported compromised. Anything else answers `403`. Synced passkeys, such as those of a phone's password manager, prove no model.

The metadata is downloaded with the first passkey created, and again once it says it is next updated. Metadata that cannot be downloaded, or is not signed under one of the roots, answers `500`.

## What gets recorded
Logging in with a passkey is a login, and recorded as `auth.login` like every other, see [what gets recorded](./auth.md#what-gets-recorded). Two refusals carry a reason of their own:

| `reason` | What happened |
|---|---|
| `token-reused` | An answer to a challenge came a second time |
| `credential-cloned` | The device's signature count went backwards: it was copied, or its counter is broken. The passkey keeps working on the device that counts on |

Adding a passkey to a user is recorded as `auth.identity.linked`, removing it as `auth.identity.unlinked`.

## Replacing how passkeys are checked
Everything the authenticator, the second factor and the routes do with a passkey goes through `ZIBRI_DI_TOKENS.PASSKEY_SERVICE`, and the metadata through `ZIBRI_DI_TOKENS.FIDO_METADATA_SERVICE`. Provide your own implementation of `PasskeyServiceInterface` or `FidoMetadataServiceInterface` to change either.

## Requirements
| Package | Used for |
|---|---|
| `@simplewebauthn/server` | Checking what the browser answers. You install it |

Your data source declares these entities:

| Entity | Needed when |
|---|---|
| `Passkey`, `PasskeyChallenge` | `PasskeyAuthenticator` or `PasskeyTwoFactorMethod` is registered |
| `PasskeyRegistrationTicket` | `PasskeyAuthenticator` is registered |

How large each table grows, and what deletes its rows, is in [framework tables](../data/framework-tables.md).

## See also
- [Auth](./auth.md) — strategies and authenticators
- [Two factor](./two-factor.md) — the second factor on operations
- [Login through a provider](./login-through-a-provider.md) — logging in with an account somewhere else
