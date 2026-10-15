# Accepting a provider's tokens
A mobile app or another service already holds a token from your identity provider, such as Keycloak, Microsoft Entra ID or Auth0, and calls your api with it. Your application verifies the token against the keys the provider publishes, checks that it is for your api, and acts as the user the identity it names is [linked to](./sign-in-through-a-provider.md#connecting-a-provider-to-an-account).

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `ProviderTokenAuthStrategy` | class | Builtin auth strategy reading the tokens of your providers |
| `OidcBearerTokens` | type | Which tokens of an OpenID Connect provider a request may send, set as `bearerTokens` of its authenticator |
| `ProviderTokenAuthenticatorInterface`, `isProviderTokenAuthenticator` | interface, function | What an authenticator whose provider's tokens a request may send implements, see [another kind of provider](#another-kind-of-provider) |
| `ProviderToken` | type | What a verified token says: the user, the login time, and what it is bound to |

## Setting it up
Set `bearerTokens` on the authenticator of the provider, and register `ProviderTokenAuthStrategy` next to the strategy your users log in with:

```ts
// src/auth/keycloak.authenticator.ts
import { AuthController, BaseKeycloakAuthenticator, Controller, JwtAuthStrategy, OAuthClientAuthentication, OidcBearerTokens, OtpTwoFactorMethod, ProviderTokenAuthStrategy, ZibriApplicationOptions } from 'zibri';

import { Roles } from './roles.enum';
import { User } from './user.entity';

export class KeycloakAuthenticator extends BaseKeycloakAuthenticator<Roles, User> {
    readonly baseUrl: string = 'https://login.example.com';
    readonly realm: string = 'employees';
    readonly clientId: string = 'web';
    readonly clientAuthentication: OAuthClientAuthentication = {
        method: 'client_secret_basic',
        clientSecret: process.env['KEYCLOAK_CLIENT_SECRET'] ?? ''
    };
    override readonly bearerTokens: OidcBearerTokens = {
        accessTokenAudiences: ['https://api.example.com'],
        accessTokenType: 'any',
        idTokenAudiences: []
    };
}

@Controller('/auth', { versions: 'all' })
export class AppAuthController extends AuthController({
    strategies: [JwtAuthStrategy],
    authenticators: [KeycloakAuthenticator],
    twoFactorMethods: [OtpTwoFactorMethod]
}) {}

export const providerTokenOptions: Pick<ZibriApplicationOptions, 'authenticators' | 'authStrategies' | 'controllers'> = {
    authenticators: [KeycloakAuthenticator],
    authStrategies: [JwtAuthStrategy, ProviderTokenAuthStrategy],
    controllers: [AppAuthController]
};
```

| Member of `bearerTokens` | What it is |
|---|---|
| `accessTokenAudiences` | The audiences your api is known by at the provider. An access token whose `aud` names one of them is taken. Empty to take no access tokens |
| `accessTokenType` | `'at+jwt'` takes only access tokens whose header carries the `typ` `at+jwt` (RFC 9068). `'any'` takes any `typ`, for a provider such as Keycloak or Entra ID marking its access tokens `JWT` |
| `idTokenAudiences` | The clients whose ID tokens are taken, such as the client your mobile app signs in as. Empty to take no ID tokens |

`bearerTokens` is `undefined` by default, and the authenticator takes none of its provider's tokens. The application refuses to start when `ProviderTokenAuthStrategy` is registered and no authenticator takes its provider's tokens, when two authenticators take the tokens of the same provider, or when `bearerTokens` names neither an access token audience nor an ID token audience.

## What a token has to prove
A request sends the token in the `Authorization` header, as `Bearer <token>`. The token is handed to the authenticator whose `issuer` it names, and it is taken when

- it is signed with a key the provider publishes, by one of the authenticator's `allowedAlgorithms`
- its `iss` is the provider's issuer, and it has not expired
- its `aud` names one of `accessTokenAudiences` and its `typ` is what `accessTokenType` says, or its `aud` names one of `idTokenAudiences` and its `typ` is not `at+jwt`
- its `sub` is an identity at the provider linked to a user who signs in through it

The request acts as that user, with the roles the user has now. An identity linked to nobody, or linked for the provider's apis only, is refused with `401`: a token never creates a user.

A token naming your application's own `baseUrl` as its issuer is left to your application's own strategies.

### Bound tokens
A token whose `cnf` names a DPoP key (`jkt`) is taken only with the `DPoP` scheme and a proof of that key, see [binding tokens to a key](./dpop.md). A token whose `cnf` names a client certificate (`x5t#S256`) is taken only beside that certificate, as a [client certificate strategy](./client-certificates.md) of your application reads it. A token bound in any other way is refused.

### The login time
The token's `auth_time` is the time of the login, which a route accepting [a recent login in place of a second factor](./two-factor.md) reads. A token without one never counts as a recent login.

## Another kind of provider
`ProviderTokenAuthStrategy` takes the tokens of every registered authenticator implementing `ProviderTokenAuthenticatorInterface` whose `acceptsProviderTokens` is `true`. `BaseOidcAuthenticator` and the authenticators extending it implement it. For a provider of another kind, implement it on your authenticator:

| Member | What it is |
|---|---|
| `issuer` | The issuer the provider's tokens name as their `iss` |
| `acceptsProviderTokens` | Whether the authenticator takes any of its provider's tokens |
| `findProviderToken(token)` | Verifies a token, and answers the user its identity is linked to, its login time, and the DPoP key and client certificate it is bound to. Answers `undefined` for a token it does not take |

## See also
- [Sign-in through a provider](./sign-in-through-a-provider.md) — signing users in at a provider, and linking their identities
- [Authentication & Authorization](./auth.md) — strategies, authenticators and securing routes
- [Binding tokens to a key](./dpop.md) — DPoP proofs
- [Client certificates](./client-certificates.md) — mutual TLS