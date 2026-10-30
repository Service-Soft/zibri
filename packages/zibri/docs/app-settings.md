# App settings
A generated project defines its application options in three files:
- `src/application-options.base.ts`
- `src/application-options.ts`
- `src/__testing__/test-application-options.ts`

The base holds what a test and a deployment share. The other two add the data source each of them uses, such as an in-memory one for tests and Postgres for the deployment. See [testing](./testing.md#starting-your-application-in-a-test).

Providers, controllers and data sources have pages of their own. The `security` option says which browser origins may call your API, which security headers are sent, and how far to trust a proxy in front of the application.

Everything here has a working default, and CORS allows every origin by default. Change these settings to narrow CORS, to let browsers send cookies with their requests, to run behind a proxy, or to set HSTS.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `ZibriApplicationSecurityOptions` | type | The `security` option: `headers`, `cors` and `trustProxy` |
| `ZibriApplicationSecurityOptionsInput` | type | The `security` option as you write it. Each header you name replaces its default |
| `CorsOptions` | type | Which browser origins may call the API, and what they may send |
| `CorsOrigin` | type | A single origin, as `https://host` or `http://host` |
| `crossOriginCookieMiddleware` | function | Refuses a request that changes something when a page on an origin `cors` does not allow credentials for sent it with cookies. Registered for you |
| `AcceptCrossSitePosts` | decorator | Lets pages on the given origins send one route requests with cookies |
| `AcceptCrossSitePostsOptions`, `AcceptedOrigins` | type | The origins a route accepts, as a list or worked out from its path |
| `defaultCorsOptions` | constant | What applies when you configure nothing: every origin, no credentials |
| `HstsOptions` | type | Configuration for the strict transport security header |
| `CspOptions` | type | Every directive of a content security policy |
| `CspOptionsInput` | type | The directives you set, each replacing the default's |
| `buildCspOptions`, `buildCspHeaders` | function, function | The policy your directives make over `ZIBRI_DI_TOKENS.DEFAULT_CSP_OPTIONS`, and the `Content-Security-Policy` header value of a policy and its nonce |
| `CspSource` | type | One source a directive allows, such as `'self'` or `https://host` |

## CORS

CORS is enforced by browsers alone. It decides what a page on another origin may do with your users' credentials.

### The default, and when to change it

Out of the box every origin is allowed and credentials are not:

```ts
// src/application-options.base.ts
import { CorsOptions } from 'zibri';

const corsDefault: CorsOptions = { origins: '*' };
```

Under that default, a page on another origin can send a request, and the browser attaches no cookies to it. To act as a logged in user, that page needs a token you gave it. This fits a public API, or one called with bearer tokens.

Change it as soon as either of these is true:

- your API is only meant to be called by your own front ends
- you use cookie-based auth from a browser, which needs `credentials`

```ts
// src/application-options.base.ts
import { ZibriApplicationSecurityOptionsInput } from 'zibri';

const security: ZibriApplicationSecurityOptionsInput = {
    cors: {
        origins: ['https://app.example.com', 'https://admin.example.com'],
        credentials: true
    }
};
```

An origin is scheme, host and port. `https://app.example.com` does not cover `http://app.example.com`, and it does not cover `https://app.example.com:8443`. The type accepts only values starting with `http://` or `https://`.

> [!NOTE]
> `credentials: true` needs a list of `origins`. Browsers reject it together with `'*'`.

### What a request from a disallowed origin does

The request runs on the server, and the response is produced. The response carries no `access-control-allow-origin` header, so the browser does not hand it to the page.

> [!WARNING]
> CORS protects nothing on its own. A caller that is not a browser, such as curl, another service or a script, sends no origin and is never affected by it. Protect the endpoints themselves with [auth](./auth.md).

The one exception is a request that changes something and carries cookies. Any method other than `GET`, `HEAD` and `OPTIONS`, sent by a browser from a page on another origin with cookies attached, is answered `403` unless that origin is listed in `origins` and `credentials` is `true`, or the route accepts it. This applies to every route, and a page on a sibling subdomain counts as another origin. The refusal is recorded in the audit trail as `authz.check` with the reason `cross-origin`. Requests without cookies, and requests that name no origin, are not affected.

### A route other sites post to

Some routes are meant to be posted to by another site's page, like a payment provider sending the user back, or a [login provider answering with a form post](./login-through-a-provider.md#providers-that-answer-with-a-form-post). Name the origins of those pages with `@AcceptCrossSitePosts`, and that route takes their requests with cookies:

```ts
// src/controllers/payment-return.controller.ts
import { AcceptCrossSitePosts, Controller, Post } from 'zibri';

@Controller('/payments')
export class PaymentReturnController {
    @AcceptCrossSitePosts({ acceptedOrigins: ['https://checkout.example.com'] })
    @Post('/return')
    async returned(): Promise<void> {
        // your logic
    }
}
```

The origin is the one the browser sends in the `Origin` header. `acceptedOrigins` can also be a function of the route's path parameters, for a route whose origins depend on them. Every request it lets through is recorded in the audit trail as `authz.check` with the reason `cross-origin` and the outcome `success`.

The decorator goes on a route that changes something, and every version of the route declares the same.

### Headers your browser clients may send

The framework's own headers are always allowed, such as `authorization`, `dpop`, the CSRF token, the two-factor codes, the [API key](./glossary.md#api-key), the trace context and the version header, under the names their DI tokens give them. Add your own with `additionalAllowedHeaders`:

```ts
// src/application-options.base.ts
import { CorsOptions } from 'zibri';

const corsWithOwnHeaders: CorsOptions = {
    origins: ['https://app.example.com'],
    additionalAllowedHeaders: ['x-tenant-id']
};
```

They are added to the framework's own headers, which stay allowed.

### Methods

Every method the router can serve is allowed by default. Narrow it if you want to:

```ts
// src/application-options.base.ts
import { CorsOptions, HttpMethod } from 'zibri';

const corsWithMethods: CorsOptions = { origins: ['https://app.example.com'], methods: [HttpMethod.GET, HttpMethod.POST] };
```

### Preflights

Browsers send a preflight before a request with a custom header, or with a method other than `GET`, `HEAD` and `POST`, see [MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS#simple_requests). A preflight is an `OPTIONS` request carrying `access-control-request-method`, and it is answered before your routes run.

A browser keeps the answer for `preflightMaxAgeInMs`, two hours by default, and sends no preflight for the same request in that time. Chromium keeps one for two hours at most, Firefox for a day.

An `OPTIONS` request without that header asks what an endpoint supports. It is routed like any other request, and answered with an `Allow` header listing the methods that exist.

## Security headers

Set on every response, with nothing to configure:

- `x-content-type-options: nosniff`
- `referrer-policy: strict-origin-when-cross-origin`

An answer that depends on who asked, because the route's checks or the handler found out which user sent the request, also carries `cache-control: no-store`. No cache keeps it, so a cache in front of a cookie login never hands one user's answer to another. A route that sets `cache-control` itself, such as through the headers of a [`JsonResponse`](./creating-endpoints.md#answering-with-headers), keeps its own. A file is answered without a cache directive of its own.

### HSTS

Sent over HTTPS only, and enabled by default:

```ts
// src/application-options.base.ts
import { KnownHeader, ZibriApplicationSecurityOptionsInput } from 'zibri';

const withHsts: ZibriApplicationSecurityOptionsInput = {
    headers: {
        [KnownHeader.STRICT_TRANSPORT_SECURITY]: { maxAgeInSeconds: 15552000, includeSubDomains: true, preload: false }
    }
};
```

Pass `false` to disable it, or `true` for the defaults.

> [!WARNING]
> `preload` cannot be undone quickly. Browsers ship the preload list in their binaries, and getting off it takes months. Turn it on only once every subdomain serves HTTPS for good.

### Content security policy

Every html response carries a content security policy, and so does an svg file, which a browser renders like a page. By default it allows scripts, frames and forms from your own origin only:

```
default-src 'self'; base-uri 'self'; object-src 'none'; form-action 'self'; frame-ancestors 'self';
script-src 'self' 'nonce-…'; script-src-attr 'none'
```

`script-src` always carries a nonce that is new for every response, cached pages included. A script tag carrying that nonce runs, which is how the script `TsxUtilities.renderPage` adds to a page is allowed. A template of your own reads the nonce from the request context:

```ts
// src/pages/inline-script.ts
import { HttpRequestContext, inject, WebsocketRequestContext, ZIBRI_DI_TOKENS, ZIBRI_REQUEST_CONTEXT_TOKENS } from 'zibri';

const context: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
const nonce: string | undefined = context?.get(ZIBRI_REQUEST_CONTEXT_TOKENS.NONCE);
const inlineScript: string = `<script nonce="${nonce}">/* … */</script>`;
```

When `frame-ancestors` is exactly `'self'` or `'none'`, the matching `x-frame-options` header is sent as well, for browsers that predate the directive.

Set the policy for every response through DI. Each directive you name replaces the default's:

```ts
// src/providers.ts
import { CspOptionsInput, defineProvider, ZIBRI_DI_TOKENS } from 'zibri';

const csp: CspOptionsInput = {
    imgSrc: ['\'self\'', 'https://images.example.com'],
    frameAncestors: ['\'none\'']
};

const cspProvider = defineProvider({ token: ZIBRI_DI_TOKENS.DEFAULT_CSP_OPTIONS_INPUT, useValue: csp });
```

A single response can set its own directives in the same way, or send no policy at all:

```ts
// src/controllers/page.controller.ts
import { HtmlResponse } from 'zibri';

const withCdnScripts: HtmlResponse = HtmlResponse.fromString('<html>…</html>', {
    csp: { scriptSrc: ['\'self\'', 'https://cdn.example.com'] }
});
const withoutPolicy: HtmlResponse = HtmlResponse.fromString('<html>…</html>', { csp: false });
```

The request's nonce is added to `script-src` in both cases, unless it lists `'unsafe-inline'`, which already lets every inline script run. A `FileResponse` takes the same `csp` option. Files other than svg carry no policy unless you set one.

## Running behind a proxy

Behind a load balancer, ingress or CDN, the application sees the proxy's address, over plain HTTP.
The client's address and protocol arrive in `x-forwarded-*` headers, and `trustProxy` says how much
of them to believe:

```ts
// src/application-options.base.ts
import { ZibriApplicationSecurityOptionsInput } from 'zibri';

const behindOneProxy: ZibriApplicationSecurityOptionsInput = {
    // the number of proxies in front of the application
    trustProxy: 1
};
```

It takes a hop count, an address or subnet to trust, a list of them, or `true` for everything. It
defaults to `false`.

> [!WARNING]
> Any caller can send `x-forwarded-*` headers. Trusting them where nothing in front of the
> application overwrites them lets a caller choose their own client address, and with it anything
> keyed by that address, such as a [rate limit](./rate-limiting.md).

With `trustProxy` set to match your proxies, a rate limit counts by the client's real address, and
the application knows whether a request arrived over HTTPS. That decides whether session cookies are
marked `Secure` and whether HSTS is sent.

## See also
- [Auth](./auth.md) — protecting the endpoints themselves, which is what CORS does not do
- [Rate limiting](./rate-limiting.md) — what the client address is used for
- [Two factor](./two-factor.md) — requiring a second factor on sensitive operations
- [Creating endpoints](./creating-endpoints.md) — the routes these rules apply to
- [Application lifecycle](./application-lifecycle.md) — where `ZibriApplicationOptions` is passed
