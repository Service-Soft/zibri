# Binding tokens to a key
A client binds its tokens to a key pair it holds: it signs a proof with the private key for every request, and sends it in the `DPoP` header (RFC 9449). A token bound to the key works only beside a proof of that key, so a token that leaks without the key is worth nothing. Logins of `JwtAuthStrategy` and the tokens your [authorization server](./authorization-server.md) issues to clients are bound this way.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `ZIBRI_DI_TOKENS.DPOP_NONCES` | DI token | Whether a proof carries a nonce your application issued. Defaults to `false` |
| `ZIBRI_DI_TOKENS.DPOP_PROOF_MAX_AGE_IN_MS` | DI token | How long ago a proof may have been signed, and how far ahead of the clock it may claim to be. Defaults to five minutes |
| `ZIBRI_DI_TOKENS.DPOP_NONCE_LIFETIME_IN_MS` | DI token | How long a nonce your application issued works. Defaults to five minutes |
| `ZIBRI_DI_TOKENS.DPOP_SERVICE` | DI token | The service checking proofs, replaceable |
| `DpopServiceInterface` | interface | What a service of your own implements |
| `DpopService` | class | Checks the [DPoP](./glossary.md#dpop) proofs of requests. Replaceable through `ZIBRI_DI_TOKENS.DPOP_SERVICE` |
| `AuthorizationToken` | type | An access token a request sends, and its scheme |
| `AuthorizationHeaderUtilities` | class | Reads the access token of a request's authorization header |

## Setting it up
There is nothing to set up: a client sending a proof is bound to its key. Two settings make it stricter:

```ts
// src/providers.ts
import { defineProvider, JwtAuthOptionsInput, ZIBRI_DI_TOKENS } from 'zibri';

import { environment } from './environment';

export const dpopProviders = [
    defineProvider({ token: ZIBRI_DI_TOKENS.DPOP_NONCES, useFactory: () => true }),
    defineProvider({
        token: ZIBRI_DI_TOKENS.JWT_AUTH_OPTIONS_INPUT,
        useFactory: (): JwtAuthOptionsInput => ({
            accessTokenKey: environment.jwtAccessSecret,
            refreshTokenSecret: environment.jwtRefreshSecret,
            requireDpop: true
        })
    })
];
```

| Setting | What it is |
|---|---|
| `DPOP_NONCES` | `true` and every proof carries a nonce your application issued, see [nonces](#nonces). `false`, the default, and a proof carries none |
| `requireDpop` of the JWT options | `true` and every login is bound to a key: a login, a refresh and an access token without a proof are refused. `false`, the default, and a login is bound when it is started with a proof |
| `DPOP_PROOF_MAX_AGE_IN_MS` | How far the time a proof was signed may be from now, either way. Five minutes by default. Raise it for clients whose clocks run off by more |
| `DPOP_NONCE_LIFETIME_IN_MS` | How long a nonce works. Five minutes by default |

## Logins
A client binds a login by sending a proof with the request that starts it, such as `POST /auth/login`. The access token names the key's thumbprint as `cnf.jkt`, and so does every access token the login is refreshed into. A refresh sends a proof of the same key; one without it is refused with `400` and spends nothing.

```
POST /auth/login HTTP/1.1
Content-Type: application/json
DPoP: eyJ0eXAiOiJkcG9wK2p3dCIsImFsZyI6IkVTMjU2IiwiandrIjp7...

{ "email": "ada@example.com", "password": "..." }
```

A logout takes no proof: it only ever takes access away.

## Sending a bound token
A request sends a bound token with the `DPoP` scheme, and a proof for itself that carries the token's hash:

```
GET /invoices HTTP/1.1
Authorization: DPoP eyJhbGciOiJIUzI1NiIsInR5cCI6ImF0K2p3dCJ9...
DPoP: eyJ0eXAiOiJkcG9wK2p3dCIsImFsZyI6IkVTMjU2IiwiandrIjp7...
```

A bound token sent with the `Bearer` scheme, an unbound one sent with the `DPoP` scheme, and a request without a proof of the token's key are refused with `401`.

## Tokens of clients
A client sends a proof to `/token` and is issued a token bound to its key, with the `token_type` `DPoP`. An [API key](./api-keys.md) created with `requireDpop: true` is issued tokens only for a proof, and is never taken in the API key header itself. [Introspection](./authorization-server.md#introspection) answers the key's thumbprint as `cnf.jkt`, and `token_type` `DPoP`.

## What a proof is
A proof is a JWT the client signs with its private key, and carries the public key in its header:

| Part | What it holds |
|---|---|
| `typ` of the header | `dpop+jwt` |
| `alg` of the header | `ES256`, `ES384`, `ES512`, `EdDSA` or `RS256` |
| `jwk` of the header | The public key, without its private members |
| `jti` | An id the proof is taken once by |
| `htm` | The method of the request |
| `htu` | The URL of the request below your `baseUrl`, without its query |
| `iat` | When it was signed, within `DPOP_PROOF_MAX_AGE_IN_MS` of now, five minutes by default |
| `ath` | The SHA-256 of the access token, base64url encoded, on a request sending one |
| `nonce` | The nonce your application issued, while `DPOP_NONCES` is `true` |

## Nonces
While `DPOP_NONCES` is `true`, a proof carries a nonce your application issued. A proof without one, or with one that expired, is answered with a new one in the `DPoP-Nonce` header: `400` with `use_dpop_nonce` from a route that issues tokens, and `401` challenging with `DPoP error="use_dpop_nonce"` from any other. The client signs the proof again with the nonce, and keeps sending it until it is answered a new one. A nonce works for `DPOP_NONCE_LIFETIME_IN_MS`, five minutes by default, on every replica of your application.

## Errors
| `error` | Status | When |
|---|---|---|
| `invalid_dpop_proof` | `400` from a route issuing tokens, `401` from any other | The proof is not valid for the request, was taken before, or a login or key that requires one sent none |
| `use_dpop_nonce` | `400` from a route issuing tokens, `401` from any other | The proof carries no nonce your application issued |

A `401` challenges with the `DPoP` scheme in the `WWW-Authenticate` header, and names the algorithms a proof may be signed with.

## See also
- [Authentication & authorization](./auth.md) — logins and the JWT options
- [Issuing tokens to services](./authorization-server.md) — tokens of clients
- [Client certificates](./client-certificates.md) — binding tokens to a certificate instead
- [Testing](./testing.md) — `FakeDpopKey`, a key that signs proofs in a test