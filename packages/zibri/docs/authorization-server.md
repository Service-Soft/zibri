# Issuing tokens to services
A service calls your api, or another service of yours, with an access token your application issues: it exchanges its [api key](./api-keys.md) for a short-lived token at your token endpoint, the OAuth2 client credentials grant. The token acts as the user of the key, for the services it names. A service receiving a token asks your application whether it is active, and whoever holds a token can revoke it.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `AuthorizationServerController` | function | Defines the routes of the authorization server, for a controller of yours to extend |
| `AuthorizationServerControllerOptions` | type | Who may introspect tokens, and the services tokens may be issued for |
| `ClientAccessTokenAuthStrategy` | class | The auth strategy issuing the access tokens of clients, and reading them |
| `ClientAccessTokenIssuingAuthStrategyInterface`, `isClientAccessTokenIssuingAuthStrategy` | interface, function | What a strategy issuing the access tokens of clients implements, see [your own token format](#your-own-token-format) |
| `TokenIntrospectingAuthStrategyInterface`, `isTokenIntrospectingAuthStrategy` | interface, function | What a strategy answering at `/introspect` and `/revoke` for its tokens implements |
| `ClientAccessTokenGrant`, `IssuedClientAccessToken` | type | What a token a client is issued may do, and the token |
| `ApiKeyAuthenticationMethod`, `ApiKeyClientAuthentication` | enum, type | How a client proves itself without a secret, see [clients without a secret](./api-keys.md#clients-without-a-secret) |
| `ZIBRI_DI_TOKENS.ACCESS_TOKEN_REVOCATION` | DI token | When an access token stops working once what it was issued for has ended. Defaults to `'onExpiry'` |
| `AccessTokenRevocation` | type | `'onExpiry'` or `'immediately'` |
| `JwtRevokedAccessToken` | entity | The revoked tokens of clients, until they expire |
| `JwtRevokedAccessTokenCleanupCronJob` | cron job | Deletes revoked tokens once they expire |
| `OAuth2Error`, `OAuth2ErrorCode`, `OAuth2ErrorOptions` | class, enum, type | An error answered the way OAuth2 says errors look |
| `ZIBRI_DI_TOKENS.AUTHORIZATION_SERVER_SERVICE` | DI token | The service answering the routes, replaceable |
| `AuthorizationServerServiceInterface`, `AuthorizationServerEndpoint`, `TokenRequest`, `TokenPresentation`, `OAuth2ClientCredentials`, `TokenResponse`, `IntrospectionResponse`, `IntrospectedConfirmation`, `AuthorizationServerMetadata` | type | What a service of your own implements, and what it is handed and answers |

## Setting it up
Declare `ApiKey` in the data source your users live in, and register `ClientAccessTokenAuthStrategy`, which issues the tokens and reads them:

```ts
// src/application-options.ts
import { ApiKeyAuthStrategy, ClientAccessTokenAuthStrategy, JwtAuthStrategy, ZibriApplicationOptions } from 'zibri';

export const authOptions: Pick<ZibriApplicationOptions, 'authStrategies'> = {
    authStrategies: [JwtAuthStrategy, ApiKeyAuthStrategy, ClientAccessTokenAuthStrategy]
};
```

The tokens are signed with the access token key of `ZIBRI_DI_TOKENS.JWT_AUTH_OPTIONS_INPUT`, see [signing with a key pair](./auth.md#signing-with-a-key-pair). `JwtAuthStrategy` logs your users in, and `ApiKeyAuthStrategy` takes [api keys](./api-keys.md) sent in a header; register them when you use them.

Then define the routes, below the path you give them:

```ts
// src/controllers/authorization-server.controller.ts
import { AuthorizationServerController, Controller } from 'zibri';

import { Role } from '../models/role.enum';

@Controller('/oauth2')
export class CompanyAuthorizationServerController extends AuthorizationServerController({
    introspectionRoles: [Role.TOKEN_INTROSPECTION],
    resources: ['https://reports.example.com']
}) {}
```

| Option | What it is |
|---|---|
| `introspectionRoles` | The roles a caller of `/introspect` holds, one of them at least. Required, not empty |
| `resources` | The services, by url, tokens may be issued for besides your application. Required, `[]` for none |

The issuer of every token is your application's `baseUrl`, so set it to the url your clients and services reach.

The application refuses to start when it declares more than one such controller, when it declares no `ApiKey`, when not exactly one of its strategies issues the access tokens of clients, when `introspectionRoles` is empty, or when an entry of `resources` is not an absolute url without a fragment.

## The routes
| Route | What it does |
|---|---|
| `POST /token` | Issues an access token to a client |
| `POST /introspect` | Answers whether a token is active, and what it says |
| `POST /revoke` | Revokes a token |
| `GET /.well-known/oauth-authorization-server` | What the authorization server is and where its routes are, at the root of your application |

They read `application/x-www-form-urlencoded` bodies. `/token` and `/revoke` share the budget of the [builtin auth endpoints](./auth.md#how-often-a-caller-may-try).

## Issuing a token
A client sends its api key's id as `client_id` and the key as `client_secret`, in the `Authorization` header:

```
POST /oauth2/token HTTP/1.1
Authorization: Basic base64(client_id:client_secret)
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&scope=reports.read&resource=https%3A%2F%2Freports.example.com
```

or both in the body, beside `grant_type`. The answer:

```json
{
    "access_token": "eyJhbGciOiJFUzI1NiIsInR5cCI6ImF0K2p3dCJ9...",
    "token_type": "Bearer",
    "expires_in": 3600,
    "scope": "reports.read"
}
```

A token lasts as long as the access tokens of logins, `accessTokenExpiresInMs`, see [how long a login lasts](./auth.md#how-long-a-login-lasts). A client asks for a new one when it expires; there is no refresh token.

| Parameter | What it is |
|---|---|
| `grant_type` | `client_credentials`. Required |
| `scope` | The roles the token may use, separated by spaces. Each one is a role of the api key that its user has. Without it, the token may use all of them |
| `resource` | A service the token is for, one of `resources` or your `baseUrl`. Send it more than once for several. Without it, the token is for your application |

A request with the token acts as the key's user, holding those of the token's roles the user has right now, like a request with the key.

A client sending a DPoP proof in the `DPoP` header is issued a token bound to its key: the answer's `token_type` is `DPoP`, and a request sends the token with the `DPoP` scheme and a proof of the key, see [binding tokens to a key](./dpop.md). A key created with `requireDpop: true` is issued tokens only for a proof.

## Clients
A client is an api key. It authenticates in one of five ways:

| Method | The client sends | The api key |
|---|---|---|
| `client_secret_basic` | `client_id` and `client_secret` in the `Authorization` header | a [key with a secret](./api-keys.md#creating-a-key) |
| `client_secret_post` | `client_id` and `client_secret` in the body | a key with a secret |
| `private_key_jwt` | a jwt it signed as `client_assertion`, with `client_assertion_type` `urn:ietf:params:oauth:client-assertion-type:jwt-bearer` | holds the public key, or the url of the client's JSON Web Key Set |
| `tls_client_auth` | `client_id` in the body, beside a client certificate | the [client certificate strategy](./client-certificates.md) finds the key's user for the certificate |
| `self_signed_tls_client_auth` | `client_id` in the body, beside a client certificate | holds the certificate, which may be self-signed |

[Clients without a secret](./api-keys.md#clients-without-a-secret) shows how to create each kind of key.

A jwt a client signs names the key's id as `iss` and `sub`, your `baseUrl`, the url of `/token` or the url of the route it calls as `aud`, and carries a `jti`. It expires at most an hour ahead, and is taken once.

A token issued over a client certificate is bound to it: it carries the certificate's thumbprint as `cnf`, and a request sending it is taken only beside the same certificate. The certificate is read by the registered strategy implementing `ClientCertificateAuthStrategyInterface`, see [client certificates](./client-certificates.md).

A request whose client cannot be authenticated, whatever the reason, is answered `401` with `invalid_client`.

## Services receiving tokens
A token names who it is for in `aud`: your `baseUrl`, or the services the client asked for. Your application takes only tokens for itself, and refuses a token for another service with a `401`.

A service of yours checks a token in one of two ways:

- **By the keys.** Sign with a [key pair](./auth.md#signing-with-a-key-pair) and declare `JwksController`. The service verifies the signature with the keys at the `jwks_uri` of the [metadata](#metadata), and checks that `iss` is your `baseUrl`, `aud` is its own url and the `typ` header is `at+jwt`.
- **By asking.** The service calls `/introspect`, with a key of its own that has one of `introspectionRoles`.

## Introspection
A caller authenticates the way a client does, or with any credential your application takes, such as an api key in the `x-api-key` header. The caller's roles have to include one of `introspectionRoles`; otherwise the answer is `403` with `insufficient_scope`.

```
POST /oauth2/introspect HTTP/1.1
Authorization: Basic base64(client_id:client_secret)
Content-Type: application/x-www-form-urlencoded

token=eyJhbGciOiJFUzI1NiIsInR5cCI6ImF0K2p3dCJ9...
```

```json
{
    "active": true,
    "scope": "reports.read",
    "client_id": "6f1c0e5e-6c8b-4a59-9d8e-2b4b1c6f0a77",
    "username": "billing@services.example.com",
    "token_type": "Bearer",
    "exp": 1791712800,
    "iat": 1791709200,
    "sub": "0b8f2d3a-9a1e-4c55-8f0e-5e2d6c1b7a90",
    "aud": ["https://reports.example.com"],
    "iss": "https://api.example.com",
    "jti": "c7d2a4f1-3b8e-4f6a-9c0d-1e2f3a4b5c6d"
}
```

It answers for the tokens of every registered strategy implementing `TokenIntrospectingAuthStrategyInterface`: access tokens of clients and of logins, refresh tokens, and api keys. `scope` holds the roles a request with the token holds now, and `cnf` what the token is bound to. A token that does not verify, has expired or was revoked, or whose user is gone or [deactivated](./auth.md#deactivating-a-user), answers `{ "active": false }`.

## Revocation
Whoever holds a token revokes it, without authenticating:

```
POST /oauth2/revoke HTTP/1.1
Content-Type: application/x-www-form-urlencoded

token=eyJhbGciOiJFUzI1NiIsInR5cCI6ImF0K2p3dCJ9...
```

A client that authenticates revokes only its own tokens, and is answered `400` with `unauthorized_client` for any other. The answer is `200`, also for a token that is unknown or revoked already.

| Token | Revoking it |
|---|---|
| Api key | Revokes the key |
| Refresh token | Ends its login, like a logout |
| Access token of a login | Ends its login |
| Access token of a client | Revokes the token |

Access tokens are revoked only while `ACCESS_TOKEN_REVOCATION` is `'immediately'`, see below. Otherwise revoking one answers `400` with `unsupported_token_type`.

## When access tokens stop working
An access token is a jwt that your application verifies without reading anything, so by default it works until it expires: after a logout, after the client's api key is revoked, after it is revoked itself. Set `ACCESS_TOKEN_REVOCATION` to `'immediately'` and every check of an access token also reads whether what it was issued for still exists:

```ts
// src/providers.ts
import { defineProvider, ZIBRI_DI_TOKENS } from 'zibri';

defineProvider({ token: ZIBRI_DI_TOKENS.ACCESS_TOKEN_REVOCATION, useValue: 'immediately' })
```

| Access token of | Stops working when |
|---|---|
| A login | The login ends: a logout, ending the user's logins, a password reset, deactivating the user, or the token revoked |
| A client | The api key is revoked or expires, or the token is revoked |

This covers every access token of `JwtAuthStrategy` and of `ClientAccessTokenAuthStrategy`. With `ClientAccessTokenAuthStrategy`, declare `JwtRevokedAccessToken` in the data source as well; the application refuses to start without it, and registers `JwtRevokedAccessTokenCleanupCronJob`. `'immediately'` needs `REVALIDATE_USER_ON_AUTH_CHECK`, see [what a credential is worth](./auth.md#what-a-credential-is-worth); the application refuses to start with it set to `false`.

A service that checks tokens by the keys learns of none of this. It asks `/introspect` to find out.

## Metadata
`GET /.well-known/oauth-authorization-server` answers what the authorization server is, for clients and libraries that set themselves up from it:

```json
{
    "issuer": "https://api.example.com",
    "token_endpoint": "https://api.example.com/oauth2/token",
    "introspection_endpoint": "https://api.example.com/oauth2/introspect",
    "revocation_endpoint": "https://api.example.com/oauth2/revoke",
    "jwks_uri": "https://api.example.com/.well-known/jwks.json",
    "response_types_supported": [],
    "grant_types_supported": ["client_credentials"],
    "token_endpoint_auth_methods_supported": ["client_secret_basic", "client_secret_post", "private_key_jwt", "tls_client_auth", "self_signed_tls_client_auth"],
    "token_endpoint_auth_signing_alg_values_supported": ["ES256", "ES384", "ES512", "EdDSA", "RS256"],
    "tls_client_certificate_bound_access_tokens": true,
    "dpop_signing_alg_values_supported": ["ES256", "ES384", "ES512", "EdDSA", "RS256"]
}
```

It also lists the methods `/introspect` and `/revoke` take. `jwks_uri` is there when you declare `JwksController` or a class extending it, and names where that controller publishes the keys. `tls_client_certificate_bound_access_tokens` is `true` when a client certificate strategy is registered.

Clients look for the metadata at the root of your `baseUrl`'s host. When your `baseUrl` has a path, eg. `https://example.com/api`, they ask `https://example.com/.well-known/oauth-authorization-server/api`. Forward that url to `{baseUrl}/.well-known/oauth-authorization-server` at your proxy.

## Your own token format
The authorization server issues its tokens through the one registered strategy implementing `ClientAccessTokenIssuingAuthStrategyInterface`, and reads nothing of them itself. A strategy of your own issuing tokens of another format, such as opaque tokens kept in your database, implements it, and is registered in place of `ClientAccessTokenAuthStrategy`:

| Method | What it does |
|---|---|
| `issueClientAccessToken` | Issues a token to a client, for the roles, audience and bindings of the `ClientAccessTokenGrant` |
| `introspectToken` | Answers whether a token is one of its own that may be used right now, and what it says |
| `revokeToken` | Revokes a token `introspectToken` answered as active |

Any strategy implementing `TokenIntrospectingAuthStrategyInterface` is asked at `/introspect` and `/revoke` for the tokens it reads.

## Errors
A refused request answers the way OAuth2 says errors look, and is never cached:

```json
{
    "error": "invalid_scope",
    "error_description": "The client may not use the roles admin."
}
```

| `error` | Status | When |
|---|---|---|
| `invalid_request` | `400` | A parameter is missing, or the client authenticates in more than one way |
| `invalid_client` | `401` | The client could not be authenticated. With `WWW-Authenticate: Basic` when it sent the `Authorization` header |
| `unauthorized_client` | `400` | A client revokes a token that is not its own |
| `unsupported_grant_type` | `400` | `grant_type` is not `client_credentials` |
| `invalid_scope` | `400` | `scope` names a role the client may not use |
| `invalid_target` | `400` | `resource` names a service tokens are not issued for |
| `unsupported_token_type` | `400` | An access token is revoked while access tokens work until they expire |
| `invalid_dpop_proof` | `400` | The DPoP proof is not valid, or a key requiring one sent none |
| `use_dpop_nonce` | `400` | The DPoP proof carries no nonce your application issued. The answer carries one in `DPoP-Nonce` |
| `insufficient_scope` | `403` | The caller of `/introspect` holds none of `introspectionRoles` |

## What gets recorded
| `action` | `outcome` | Carries |
|---|---|---|
| `auth.token.issued` | success / failure | `subject` (the client id), `userId` on success |
| `auth.token.revoked` | success | `userId` |

Revoking any token at `/revoke` is recorded as `auth.token.revoked`, and an introspection by a caller without one of `introspectionRoles` as `authz.check`. See [what gets recorded](./auth.md#what-gets-recorded).

## See also
- [Api keys](./api-keys.md) — the clients, and creating keys without a secret
- [Client certificates](./client-certificates.md) — clients authenticating with a certificate, and bound tokens
- [Binding tokens to a key](./dpop.md) — tokens that work only beside a proof of the client's key
- [Authentication & authorization](./auth.md) — signing with a key pair, and what a jwt has to prove
