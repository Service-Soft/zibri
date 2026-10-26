# API keys
A script, a service or an integration calls your API with an [API key](./glossary.md#api-key): a secret it sends with every request, which acts as one of your users. A user holds as many keys as they like, each with a name, the permissions it may use and an expiry, and each one is revoked on its own. Your database keeps only a hash of a key.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `ApiKeyAuthStrategy` | class | The [auth strategy](./glossary.md#auth-strategy) reading the API key a request sends |
| `ApiKey` | entity | An API key of a user |
| `ApiKeyCreateData` | type | What a new key is created with: its `name`, `permissions`, `tenantId`, `expiresAt`, `clientAuthentication` and `requireDpop` |
| `CreatedApiKey` | type | A key that was just created, and the key itself |
| `ApiKeyClientAuthentication` | type | How a key without a secret proves itself, see [clients without a secret](#clients-without-a-secret) |
| `ApiKeyAuthenticationMethod` | enum | The ways a key proves itself |
| `ZIBRI_DI_TOKENS.API_KEY_HEADER` | DI token | Which header carries an API key. Defaults to `x-api-key` |
| `ApiKeyOptions` | type | How often a key's last use is written down, and how long an expired key is kept |
| `ZIBRI_DI_TOKENS.API_KEY_OPTIONS` | DI token | Configures the options above |
| `ApiKeyCleanupCronJob` | cron job | Deletes the keys that expired longer ago than `deleteExpiredAfterInMs`. Registered for you |
| `ZIBRI_DI_TOKENS.API_KEY_SERVICE`, `ApiKeyServiceInterface` | DI token, interface | The service keeping the keys, which `AuthService` and every reader of a key go through. Replaceable |
| `ApiKeyService` | class | Keeps the API keys of the users. Replaceable through `ZIBRI_DI_TOKENS.API_KEY_SERVICE` |

## Setting it up
Declare `ApiKey` in the data source your users live in, and register `ApiKeyAuthStrategy` next to the strategy your users log in with. Keys are created once something reads them: `ApiKeyAuthStrategy`, or the [authorization server](./authorization-server.md) for keys that are only exchanged for tokens.

```ts
// src/application-options.ts
import { ApiKeyAuthStrategy, JwtAuthStrategy, ZibriApplicationOptions } from 'zibri';

export const authOptions: Pick<ZibriApplicationOptions, 'authStrategies'> = {
    authStrategies: [JwtAuthStrategy, ApiKeyAuthStrategy]
};
```

## Creating a key
Write a route of your own that creates a key through `AuthService`. The answer holds the key itself, which nobody sees again after it:

```ts
// src/controllers/api-key.controller.ts
import { ApiKey, Auth, AuthServiceInterface, Body, Controller, CreatedApiKey, CurrentUser, Delete, Get, Inject, Param, Permission, PlatformPermission, Post, Property, Response, ZIBRI_DI_TOKENS } from 'zibri';

import { Permissions, PlatformPermissions } from '../models/permissions';
import { User } from '../models/user.model';

const ALL_PERMISSIONS: Readonly<Record<string, Permission | PlatformPermission>> = { ...Permissions, ...PlatformPermissions };

export class ApiKeyRequest {
    @Property.string({ minLength: 1 })
    name!: string;

    @Property.array({ items: { type: 'string', enum: ALL_PERMISSIONS } })
    permissions!: (Permission | PlatformPermission)[];

    @Property.string({ format: 'uuid', required: false })
    tenantId?: string;

    @Property.date({ required: false })
    expiresAt?: Date;
}

@Controller('/api-keys')
export class ApiKeyController {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.AUTH_SERVICE)
        private readonly authService: AuthServiceInterface
    ) {}

    @Auth.require2fa({ reauth: true })
    @Post('/')
    async create(
        @CurrentUser()
        user: CurrentUser<User>,
        @Body(ApiKeyRequest)
        request: ApiKeyRequest
    ): Promise<CreatedApiKey> {
        return await this.authService.createApiKey(
            user.id,
            {
                name: request.name,
                permissions: request.permissions,
                tenantId: request.tenantId,
                expiresAt: request.expiresAt,
                clientAuthentication: undefined,
                requireDpop: false
            },
            undefined
        );
    }

    @Auth.isLoggedIn()
    @Get('/')
    async list(
        @CurrentUser()
        user: CurrentUser<User>
    ): Promise<ApiKey[]> {
        return await this.authService.findApiKeys(user.id, undefined);
    }

    @Response.empty()
    @Auth.isLoggedIn()
    @Delete('/:id')
    async revoke(
        @CurrentUser()
        user: CurrentUser<User>,
        @Param.path('id', { type: 'string', format: 'uuid' })
        id: string
    ): Promise<void> {
        await this.authService.revokeApiKey(user.id, id, undefined);
    }
}
```

A key is a way into the account that outlives a password change, so guard the route that creates one the way you guard changing a password: `@Auth.require2fa({ reauth: true })` takes a [second factor](./glossary.md#second-factor), or a [recent login](./two-factor.md#accepting-a-recent-login-instead).

`createApiKey` answers `400` when the name is empty, when a permission is not [declared](./roles-and-permissions.md#declaring-permissions), when no role of the user carries one of the permissions, or when `expiresAt` has passed. `tenantId` is required: `undefined` makes a key that acts in every [tenant](./tenancy.md) its user is a member of, and the id of a tenant binds the key to that one. Binding a key to a tenant its user is no member of answers `400`, and so does a permission carried neither by a role of the user's own nor by one of their [membership](./glossary.md#membership) there. `expiresAt` is required: `undefined` makes a key that works until it is revoked. `clientAuthentication` is required too: `undefined` makes a key that is a secret, see [clients without a secret](#clients-without-a-secret) for the others. `requireDpop: true` makes a key that is only ever exchanged for tokens [bound to a DPoP key](./dpop.md#tokens-of-clients), and never taken in the API key header.

## Sending a key
A request sends the key in the `x-api-key` header:

```
GET /invoices HTTP/1.1
x-api-key: zibri_3q2-7wEAAAB6t...
```

Rename the header through `ZIBRI_DI_TOKENS.API_KEY_HEADER`; CORS and the OpenAPI spec follow the token. A client that can send no header of its own sends the key as a bearer token instead:

```
GET /invoices HTTP/1.1
Authorization: Bearer zibri_3q2-7wEAAAB6t...
```

Every key starts with `zibri_`, which tells it apart from a JWT and lets a secret scanner find one that leaked. A request carrying a key and another credential, such as a JWT, is refused with `401`.

## What a key may do
A request with a key acts as the key's user, holding those of the key's `permissions` the user's roles carry right now: the roles of their own for `@Auth.hasPlatformPermission`, and those of their membership in the tenant the request is for for `@Auth.hasPermission`. Take a role from the user or their membership, and their keys lose what it carried with the next request. The `platformPermissions` and `permissions` of the user a handler gets through `@CurrentUser` are the same, so a check of your own matches the route checks.

A key bound to a tenant acts in that tenant only: a request with it for another tenant answers `403`, whether or not its user is a member there, and a request with it naming no tenant acts in the key's tenant. A client that sends nothing but a URL and a token, such as an identity provider [provisioning through SCIM](./scim.md), reaches its tenant this way. The access tokens the [authorization server](./authorization-server.md) issues for a bound key are bound to the same tenant.

A route that only people may call names the strategies it accepts:

```ts
// src/controllers/profile.controller.ts
import { Auth, Controller, CurrentUser, Get, JwtAuthStrategy } from 'zibri';

import { User } from '../models/user.model';

@Controller('/profile')
export class ProfileController {
    @Auth.isLoggedIn([JwtAuthStrategy])
    @Get('/')
    profile(
        @CurrentUser()
        user: CurrentUser<User>
    ): CurrentUser<User> {
        return user;
    }
}
```

A key never counts as a recent login.

## Listing and revoking
`findApiKeys` lists the keys of a user with their name, permissions, expiry, last use and creation, oldest first. The key itself is never part of an answer.

`lastUsedAt` is when the key was last used: sent with a request, exchanged at the [token endpoint](./authorization-server.md), or through an access token it was exchanged for, while [`ACCESS_TOKEN_REVOCATION`](./authorization-server.md#when-access-tokens-stop-working) is `'immediately'`. It is written down at most once an hour, so it tells a key nobody uses from one an integration depends on. A key never used has none.

An expired key stays in the list for 30 days, and is then deleted. Change both with `ZIBRI_DI_TOKENS.API_KEY_OPTIONS`:

```ts
// src/providers.ts
import { ApiKeyOptions, defineProvider, Ms, ZIBRI_DI_TOKENS } from 'zibri';

defineProvider({
    token: ZIBRI_DI_TOKENS.API_KEY_OPTIONS,
    useFactory: (): ApiKeyOptions => ({ recordUseAfterInMs: Ms.DAY, deleteExpiredAfterInMs: Ms.DAY * 90 })
})
```

`recordUseAfterInMs: 0` writes down every use, and `deleteExpiredAfterInMs: 0` deletes a key as soon as it expired.

`revokeApiKey` revokes one key of the user, and answers `404` for an id that is not a key of theirs. `revokeApiKeys` revokes every key of the user. Ending the logins of a user, such as by a password reset, keeps their keys; [deactivating the user](./auth.md#deactivating-a-user) revokes them.

The keys of a user are deleted with the user. A key of a soft deleted user stops working, and is kept until the user is restored or deleted for good.

## Service accounts
A service that acts on its own, for no person, gets a user of its own: create a user without a password, with the roles the service needs, a membership in each tenant it works in, and a key for it listing the permissions it uses. Nobody can log in as that user, and its key names the service in your data and in the audit trail.

```ts
// src/controllers/service-account.controller.ts
import { Auth, AuthServiceInterface, Controller, CreatedApiKey, inject, Post, Repository, repositoryTokenFor, ZIBRI_DI_TOKENS } from 'zibri';

import { Permissions, PlatformPermissions } from '../models/permissions';
import { Roles } from '../models/roles.enum';
import { User } from '../models/user.model';

@Auth.hasPlatformPermission(PlatformPermissions.SERVICE_ACCOUNTS_MANAGE)
@Controller('/service-accounts')
export class ServiceAccountController {
    @Post('/billing')
    async createBilling(): Promise<CreatedApiKey> {
        const users: Repository<User> = inject(repositoryTokenFor(User));
        const billing: User = await users.create({ email: 'billing@services.example.com', roles: [Roles.USER] });
        const authService: AuthServiceInterface = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
        return await authService.createApiKey(
            billing.id,
            { name: 'billing', permissions: [Permissions.INVOICES_READ], tenantId: undefined, expiresAt: undefined, clientAuthentication: undefined, requireDpop: false },
            undefined
        );
    }
}
```

## Clients without a secret
A key is also a client of the [authorization server](./authorization-server.md): its id is the `client_id` and the key the `client_secret`, which a service exchanges for a short-lived access token. A key for a client can instead hold no secret at all, and prove itself at the token endpoint some other way. Pass that way as `clientAuthentication`:

| `method` | With | The client proves itself by |
|---|---|---|
| `ApiKeyAuthenticationMethod.PRIVATE_KEY_JWT` | `publicKey`: PEM encoded or a JSON Web Key, an EC, Ed25519 or RSA key | a JWT it signs with the private key |
| `ApiKeyAuthenticationMethod.PRIVATE_KEY_JWT` | `jwksUrl`: the URL of the client's JSON Web Key Set, over HTTPS or on `localhost` | a JWT it signs with one of the keys published there |
| `ApiKeyAuthenticationMethod.TLS_CLIENT_AUTH` | Nothing | a client certificate one of your authorities issued, which your [client certificate strategy](./client-certificates.md) finds the key's user for |
| `ApiKeyAuthenticationMethod.SELF_SIGNED_TLS_CLIENT_AUTH` | `certificate`: PEM encoded, may be self-signed | that client certificate |

```ts
// src/services/billing-client.function.ts
import { ApiKey, ApiKeyAuthenticationMethod, AuthServiceInterface, inject, ZIBRI_DI_TOKENS } from 'zibri';

import { Permissions } from '../models/permissions';
import { User } from '../models/user.model';

export async function createBillingClient(billingUser: User): Promise<ApiKey> {
    const authService: AuthServiceInterface = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
    return await authService.createApiKey(
        billingUser.id,
        {
            name: 'billing',
            permissions: [Permissions.INVOICES_READ],
            tenantId: undefined,
            expiresAt: undefined,
            clientAuthentication: { method: ApiKeyAuthenticationMethod.PRIVATE_KEY_JWT, jwksUrl: 'https://billing.example.com/.well-known/jwks.json' },
            requireDpop: true
        },
        undefined
    );
}
```

The answer is the stored `ApiKey`, whose `id` the client sends as `client_id`. Such a key is never sent in the `x-api-key` header; the client always exchanges it for a token. `createApiKey` answers `400` as well when the public key, the URL or the certificate cannot be used.

`findApiKeys` lists these keys with the others, with their `authenticationMethod`.

## What gets recorded
Creating a key is recorded as `auth.api-key.created`, and revoking one or all as `auth.api-key.revoked`, each with the `userId`. A request with a key that is refused is recorded as `authz.check`, like any other. See [what gets recorded](./auth.md#what-gets-recorded).

## Requirements
Your data source declares these entities:

| Entity | Needed when |
|---|---|
| `ApiKey` | `ApiKeyAuthStrategy` or the authorization server is registered |

How large each table grows, and what deletes its rows, is in [framework tables](./framework-tables.md).

## See also
- [Authentication & authorization](./auth.md) — strategies, authenticators and `AuthService`
- [Issuing tokens to services](./authorization-server.md) — exchanging a key for a short-lived access token
- [Client certificates](./client-certificates.md) — the other way a service calls your API
- [Two factor](./two-factor.md) — guarding the route that creates a key
- [Creating endpoints](./creating-endpoints.md#securing-endpoints) — securing endpoints with the `@Auth` decorators