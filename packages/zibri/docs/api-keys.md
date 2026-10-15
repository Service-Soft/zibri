# Api keys
A script, a service or an integration calls your api with an api key: a secret it sends with every request, which acts as one of your users. A user holds as many keys as they like, each with a name, the roles it may use and an expiry, and each one is revoked on its own. Your database keeps only a hash of a key.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `ApiKeyAuthStrategy` | class | The auth strategy reading the api key a request sends |
| `ApiKey` | entity | An api key of a user |
| `ApiKeyCreateData` | type | What a new key is created with: its `name`, `roles`, `tenantId`, `expiresAt`, `clientAuthentication` and `requireDpop` |
| `CreatedApiKey` | type | A key that was just created, and the key itself |
| `ApiKeyClientAuthentication` | type | How a key without a secret proves itself, see [clients without a secret](#clients-without-a-secret) |
| `ApiKeyAuthenticationMethod` | enum | The ways a key proves itself |
| `ZIBRI_DI_TOKENS.API_KEY_HEADER` | DI token | Which header carries an api key. Defaults to `x-api-key` |
| `ZIBRI_DI_TOKENS.API_KEY_SERVICE`, `ApiKeyServiceInterface` | DI token, interface | The service keeping the keys, which `AuthService` and every reader of a key go through. Replaceable |

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
import { ApiKey, Auth, AuthServiceInterface, Body, Controller, CreatedApiKey, CurrentUser, Delete, Get, Inject, Param, Post, Property, Response, ZIBRI_DI_TOKENS } from 'zibri';

import { Role } from '../models/role.enum';
import { User } from '../models/user.model';

export class ApiKeyRequest {
    @Property.string({ minLength: 1 })
    name!: string;

    @Property.array({ items: { type: 'string', enum: Role } })
    roles!: Role[];

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
        user: User,
        @Body(ApiKeyRequest)
        request: ApiKeyRequest
    ): Promise<CreatedApiKey> {
        return await this.authService.createApiKey(
            user.id,
            {
                name: request.name,
                roles: request.roles,
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
        user: User
    ): Promise<ApiKey[]> {
        return await this.authService.findApiKeys(user.id, undefined);
    }

    @Response.empty()
    @Auth.isLoggedIn()
    @Delete('/:id')
    async revoke(
        @CurrentUser()
        user: User,
        @Param.path('id', { type: 'string', format: 'uuid' })
        id: string
    ): Promise<void> {
        await this.authService.revokeApiKey(user.id, id, undefined);
    }
}
```

A key is a way into the account that outlives a password change, so guard the route that creates one the way you guard changing a password: `@Auth.require2fa({ reauth: true })` takes a second factor, or a [recent login](./two-factor.md#accepting-a-recent-login-instead).

`createApiKey` answers `400` when the name is empty, when the user does not have one of the roles, or when `expiresAt` has passed. `tenantId` is required: `undefined` makes a key that acts in every [tenant](./tenancy.md) its user is a member of, and the id of a tenant binds the key to that one. Binding a key to a tenant its user is no member of answers `400`, and so does a role the user holds neither of their own nor through a membership there. `expiresAt` is required: `undefined` makes a key that works until it is revoked. `clientAuthentication` is required too: `undefined` makes a key that is a secret, see [clients without a secret](#clients-without-a-secret) for the others. And `requireDpop`: `true` makes a key that is only ever exchanged for tokens [bound to a DPoP key](./dpop.md#tokens-of-clients), and never taken in the api key header.

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

Every key starts with `zibri_`, which tells it apart from a jwt and lets a secret scanner find one that leaked. A request carrying a key and another credential, such as a jwt, is refused with a `401`.

## What a key may do
A request with a key acts as the key's user, holding those of the key's `roles` the user has right now: of their own, which `@Auth.hasPlatformRole` checks, and through their membership in the tenant the request is for, which `@Auth.hasRole` checks. Take a role from the user or their membership, and their keys lose it with the next request. The user a handler gets through `@CurrentUser` holds the same roles, so a check of your own matches the route checks.

A key bound to a tenant acts in that tenant only: a request with it for another tenant answers `403`, whether or not its user is a member there, and a request with it naming no tenant acts in the key's tenant. That is how a client that can send nothing but a url and a token, such as an identity provider [provisioning through SCIM](./scim.md), reaches its tenant. The access tokens the [authorization server](./authorization-server.md) issues for a bound key are bound to the same tenant.

A route that only people may call names the strategies it accepts:

```ts
// src/controllers/profile.controller.ts
import { Auth, Controller, CurrentUser, Get, JwtAuthStrategy } from 'zibri';

@Controller('/profile')
export class ProfileController {
    @Auth.isLoggedIn([JwtAuthStrategy])
    @Get('/')
    profile(
        @CurrentUser()
        user: User
    ): User {
        return user;
    }
}
```

A key never counts as a recent login.

## Listing and revoking
`findApiKeys` lists the keys of a user with their name, roles, expiry and creation, oldest first. Expired keys stay in the list until they are revoked. The key itself is never part of an answer.

`revokeApiKey` revokes one key of the user, and answers `404` for an id that is not a key of theirs. `revokeApiKeys` revokes every key of the user. Ending the logins of a user, such as by a password reset, keeps their keys; [deactivating the user](./auth.md#deactivating-a-user) revokes them.

A key of a deleted user stops working.

## Service accounts
A service that acts on its own rather than for a person gets a user of its own: create a user without a password, with the roles the service needs, a membership in each tenant it works in, and a key for it. Nobody can log in as that user, and its key names the service in your data and in the audit trail.

```ts
// src/controllers/service-account.controller.ts
import { Auth, AuthServiceInterface, Controller, CreatedApiKey, inject, Post, Repository, repositoryTokenFor, ZIBRI_DI_TOKENS } from 'zibri';

@Auth.hasPlatformRole([Role.ADMIN])
@Controller('/service-accounts')
export class ServiceAccountController {
    @Post('/billing')
    async createBilling(): Promise<CreatedApiKey> {
        const users: Repository<User> = inject(repositoryTokenFor(User));
        const billing: User = await users.create({ email: 'billing@services.example.com', roles: [Role.USER] });
        const authService: AuthServiceInterface = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
        return await authService.createApiKey(
            billing.id,
            { name: 'billing', roles: [Role.USER], tenantId: undefined, expiresAt: undefined, clientAuthentication: undefined, requireDpop: false },
            undefined
        );
    }
}
```

## Clients without a secret
A key is also a client of the [authorization server](./authorization-server.md): its id is the `client_id` and the key the `client_secret`, which a service exchanges for a short-lived access token. A key for a client can instead hold no secret at all, and prove itself at the token endpoint some other way. Pass that way as `clientAuthentication`:

| `method` | With | The client proves itself by |
|---|---|---|
| `ApiKeyAuthenticationMethod.PRIVATE_KEY_JWT` | `publicKey`: PEM encoded or a JSON Web Key, an EC, Ed25519 or RSA key | a jwt it signs with the private key |
| `ApiKeyAuthenticationMethod.PRIVATE_KEY_JWT` | `jwksUrl`: the url of the client's JSON Web Key Set, https or on `localhost` | a jwt it signs with one of the keys published there |
| `ApiKeyAuthenticationMethod.TLS_CLIENT_AUTH` | — | a client certificate one of your authorities issued, which your [client certificate strategy](./client-certificates.md) finds the key's user for |
| `ApiKeyAuthenticationMethod.SELF_SIGNED_TLS_CLIENT_AUTH` | `certificate`: PEM encoded, may be self-signed | that client certificate |

```ts
// src/services/billing-client.function.ts
import { ApiKey, ApiKeyAuthenticationMethod, AuthServiceInterface, inject, ZIBRI_DI_TOKENS } from 'zibri';

export async function createBillingClient(billingUser: User): Promise<ApiKey> {
    const authService: AuthServiceInterface = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
    return await authService.createApiKey(
        billingUser.id,
        {
            name: 'billing',
            roles: [Role.USER],
            tenantId: undefined,
            expiresAt: undefined,
            clientAuthentication: { method: ApiKeyAuthenticationMethod.PRIVATE_KEY_JWT, jwksUrl: 'https://billing.example.com/.well-known/jwks.json' },
            requireDpop: true
        },
        undefined
    );
}
```

The answer is the stored `ApiKey`, whose `id` the client sends as `client_id`. Such a key is never sent in the `x-api-key` header; the client always exchanges it for a token. `createApiKey` answers `400` as well when the public key, the url or the certificate cannot be used.

`findApiKeys` lists these keys with the others, with their `authenticationMethod`.

## What gets recorded
Creating a key is recorded as `auth.api-key.created`, and revoking one or all as `auth.api-key.revoked`, each with the `userId`. A request with a key that is refused is recorded as `authz.check`, like any other. See [what gets recorded](./auth.md#what-gets-recorded).

## See also
- [Authentication & authorization](./auth.md) — strategies, authenticators and `AuthService`
- [Issuing tokens to services](./authorization-server.md) — exchanging a key for a short-lived access token
- [Client certificates](./client-certificates.md) — the other way a service calls your api
- [Two factor](./two-factor.md) — guarding the route that creates a key
- [Creating endpoints](./creating-endpoints.md#securing-endpoints) — securing endpoints with the `@Auth` decorators