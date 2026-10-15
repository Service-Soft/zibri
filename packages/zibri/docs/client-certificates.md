# Client certificates
A service calls your api with a client certificate: it shows the certificate to the proxy in front of your application while connecting (mutual TLS), and acts as one of your users. The proxy checks that the client holds the certificate's key and forwards the certificate in a header. Your application takes that header only from the proxy, checks who issued the certificate and that it is valid, and finds the user it belongs to.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `BaseClientCertificateAuthStrategy` | class | Extend it once for every proxy that forwards client certificates |
| `ClientCertificateHeaderFormat` | type | How the proxy writes the certificate into its header |
| `ClientCertificateAuthStrategyInterface`, `isClientCertificateAuthStrategy` | interface, function | What a strategy reading client certificates implements, see [another source of certificates](#another-source-of-certificates) |
| `ClientCertificateUtilities` | class | Checks a certificate's validity, whoever issued it, and whether a request presents the certificate a token is bound to |

## Setting it up
Extend `BaseClientCertificateAuthStrategy` for your proxy:

```ts
// src/auth/ingress-client-certificate.auth-strategy.ts
import { X509Certificate } from 'node:crypto';

import { BaseClientCertificateAuthStrategy, ClientCertificateHeaderFormat, inject, Repository, repositoryTokenFor } from 'zibri';

import { environment } from '../environment';
import { Role } from '../models/role.enum';
import { User } from '../models/user.model';

export class IngressClientCertificateAuthStrategy extends BaseClientCertificateAuthStrategy<Role, User> {
    readonly header: string = 'x-client-cert';
    readonly headerFormat: ClientCertificateHeaderFormat = 'url-encoded-pem';
    readonly trustedProxies: string[] = ['10.0.0.0/8'];
    readonly certificateAuthorities: string[] = [environment.clientCertificateAuthority];

    async resolveUserByCertificate(certificate: X509Certificate): Promise<User | undefined> {
        const email: string | undefined = /^CN=(.+)$/m.exec(certificate.subject)?.[1];
        if (email == undefined) {
            return undefined;
        }
        return await inject<Repository<User>>(repositoryTokenFor(User)).findOne({ where: { email }, required: false });
    }
}
```

And register it next to the strategy your users log in with:

```ts
// src/application-options.ts
import { JwtAuthStrategy, ZibriApplicationOptions } from 'zibri';

export const authOptions: Pick<ZibriApplicationOptions, 'authStrategies'> = {
    authStrategies: [JwtAuthStrategy, IngressClientCertificateAuthStrategy]
};
```

| Member | What it is |
|---|---|
| `header` | The header the proxy forwards the certificate in. Required |
| `headerFormat` | How the proxy writes the certificate into it, see [proxies](#proxies). Required |
| `trustedProxies` | The proxies the header is taken from: addresses, such as `10.0.0.7` or `::1`, and subnets, such as `10.0.0.0/8`. The header of a request whose connection comes from anywhere else is ignored. Required |
| `certificateAuthorities` | The certificates, PEM encoded, of the authorities that sign client certificates directly. Required |
| `resolveUserByCertificate` | Answers the user a certificate belongs to, see [finding the user](#finding-the-user). Required |
| `name` | The name of the security scheme in the OpenAPI spec. `client-certificate` by default |

The application refuses to start when `header`, `trustedProxies` or `certificateAuthorities` is empty, when an entry of `trustedProxies` is neither an address nor a subnet, or when one of `certificateAuthorities` is not a certificate.

## Proxies
| `headerFormat` | What the header holds | Proxies |
|---|---|---|
| `rfc9440` | `:<base64 DER>:`, the standard `Client-Cert` header | HAProxy, Caddy |
| `url-encoded-pem` | URL encoded PEM | nginx (`$ssl_client_escaped_cert`), AWS Application Load Balancer (`X-Amzn-Mtls-Clientcert`) |
| `xfcc` | `x-forwarded-client-cert`, the certificate of its last element | Envoy, Istio |
| `traefik` | URL encoded base64 DER, the client's certificate first | Traefik (`X-Forwarded-Tls-Client-Cert`) |

The proxy sets the header on every request, so a header of the same name that a client sends never reaches your application. With nginx:

```nginx
server {
    listen 443 ssl;
    ssl_certificate /etc/nginx/certs/api.crt;
    ssl_certificate_key /etc/nginx/certs/api.key;
    ssl_client_certificate /etc/nginx/certs/clients.crt;
    ssl_verify_client optional;

    location / {
        proxy_pass http://api:3000;
        proxy_set_header X-Client-Cert $ssl_client_escaped_cert;
    }
}
```

`ssl_verify_client optional` lets requests without a certificate through, for the users that log in. With Envoy, set `forward_client_cert_details` to `SANITIZE_SET` and `set_current_client_cert_details` to forward the certificate.

The proxy checks revocation, such as with `ssl_crl` in nginx.

## Finding the user
`resolveUserByCertificate` gets the certificate once it has passed every check, and answers its user, or `undefined` to refuse the request with a `401`. The request holds the roles of the user you answer. Find the user by whatever names them in your certificates:

- the common name, as in the example above;
- a subject alternative name, such as the SPIFFE id of a service mesh: `certificate.subjectAltName` holds `URI:spiffe://example.com/billing`;
- the fingerprint, `certificate.fingerprint256`, for certificates you keep a list of yourself.

A service that acts on its own gets a user of its own, without a password, like a [service account](./api-keys.md#service-accounts).

## What is checked
A request has a certificate when its connection comes from one of `trustedProxies` and the header holds one. The certificate counts when one of `certificateAuthorities` signed it and the current time lies between its `notBefore` and `notAfter`. A request with a certificate that fails a check is refused with a `401`.

A request carrying a certificate and another credential, such as a bearer token, is refused with a `401`. The exception is an access token bound to that certificate, see [bound tokens](#bound-tokens). A route that only people may call names the strategies it accepts, as in [what a key may do](./api-keys.md#what-a-key-may-do). A certificate never counts as a recent login.

Websocket messages are never identified by a client certificate.

## Bound tokens
A service can also exchange its certificate for an access token at the [authorization server](./authorization-server.md), with an api key whose `clientAuthentication` is `TLS_CLIENT_AUTH` or `SELF_SIGNED_TLS_CLIENT_AUTH`, see [clients without a secret](./api-keys.md#clients-without-a-secret). The token is bound to the certificate: it carries the certificate's thumbprint as `cnf`, and is taken only from a request that presents the same certificate. The request then acts as the token, with the roles the token may use.

The proxy forwards the certificate on the routes of the authorization server as on every other.

## Another source of certificates
The authorization server and bound tokens read the certificate of a request through the registered strategy implementing `ClientCertificateAuthStrategyInterface`, which `BaseClientCertificateAuthStrategy` implements. A strategy of your own reading certificates some other way, such as from the TLS connection itself, implements it as well:

| Method | What it does |
|---|---|
| `findClientCertificate` | Finds the certificate a request presents, whoever issued it |
| `isTrusted` | Whether a certificate may identify a caller: issued by an authority you trust, and valid right now |
| `resolveUserByCertificate` | Answers the user a trusted certificate belongs to |

## See also
- [Authentication & authorization](./auth.md) — strategies, authenticators and `AuthService`
- [Api keys](./api-keys.md) — the other way a service calls your api
- [Issuing tokens to services](./authorization-server.md) — exchanging a certificate for a bound access token
- [Deployment](./deployment.md) — the proxy in front of your application