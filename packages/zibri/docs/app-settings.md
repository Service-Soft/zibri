# App settings
Application-wide settings are defined in the files
- `src/application-options.base.ts`
- `src/application-options.ts`
- `src/__testing__/test-application-options.ts`

They are separated to eg. allow tests to use a in memory data source while the normal app uses postgres.

Besides the providers/controllers/data-sources which are documented in their respective files, there are also options like `security`, that define which browser origins may call your api, and the security headers Zibri sets for you.

Everything here has a working default. This includes CORS, which allows every origin out of the box. You need this page to *narrow* that, to let browsers send cookies with their requests, to run behind a proxy, or if you have opinions about HSTS.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `ZibriApplicationSecurityOptions` | type | The `security` option: `headers`, `cors` and `trustProxy` |
| `CorsOptions` | type | Which browser origins may call the api, and what they may send |
| `CorsOrigin` | type | A single origin, as `https://host` or `http://host` |
| `corsMiddleware` | function | The middleware itself. Registered for you — exported for tests and custom setups |
| `crossOriginCookieMiddleware` | function | Refuses a request that changes something when a page on an origin `cors` does not allow credentials for sent it with cookies. Registered for you |
| `AcceptCrossSitePosts` | decorator | Lets pages on the given origins send one route requests with cookies |
| `AcceptCrossSitePostsOptions`, `AcceptedOrigins` | type | The origins a route accepts, as a list or worked out from its path |
| `defaultCorsOptions` | const | What applies when you configure nothing: every origin, no credentials |
| `HstsOptions` | type | Configuration for the strict transport security header |
| `CspOptions` | type | Every directive of a content security policy |
| `CspOptionsInput` | type | The directives you set, each replacing the default's |
| `CspSource` | type | One source a directive allows, such as `'self'` or `https://host` |

## CORS

CORS is enforced by browsers and by nothing else. It decides what a page on **another origin** may do with your users' credentials — it is not an access control list for your api, and it stops nothing that isn't a browser.

### The default, and when to change it

Out of the box every origin is allowed and credentials are not:

```ts
const corsDefault: CorsOptions = { origins: '*' };
```

Under that, a page on another origin can send a request but the browser attaches **no cookies** to it, so acting as a signed-in user still requires a token that page was deliberately given. That is a reasonable default for a public api or one called with bearer tokens.

Change it as soon as either of these is true:

- your api is only meant to be called by your own front ends
- you use cookie-based auth from a browser, which needs `credentials`

```ts
// src/application-options.base.ts
import { CorsOptions, HttpMethod, KnownHeader, ZibriApplicationSecurityOptionsInput } from 'zibri';

const security: ZibriApplicationSecurityOptionsInput = {
    cors: {
        origins: ['https://app.example.com', 'https://admin.example.com'],
        credentials: true
    }
};
```

An origin is **scheme, host and port**. `https://app.example.com` does not cover `http://app.example.com`, and it does not cover `https://app.example.com:8443`. The type only accepts values starting with `http://` or `https://`, because a bare hostname can never match what a browser sends.

> **`credentials: true` with `origins: '*'` is refused at startup.** It is not a stricter-is-better rule: browsers reject that combination outright, so allowing it would look like the most permissive setting possible while silently breaking cookie auth from every browser. List the origins instead.

### What a request from a disallowed origin does

Nothing visible on the server: the request runs and the response is produced. What changes is that the response carries no `access-control-allow-origin` header, so the **browser** refuses to hand it to the page.

That is the entire mechanism, and it is why CORS is not a security boundary on its own. A non-browser caller — curl, another service, an attacker's script running outside a browser — never sends an origin and is never affected. Protect the endpoints themselves with auth.

The one exception is a request that changes something and carries cookies. Any method other than `GET`, `HEAD` and `OPTIONS`, sent by a browser from a page on another origin with cookies attached, is answered `403` unless that origin is listed in `origins` and `credentials` is `true`, or the route accepts it. This applies to every route, and a page on a sibling subdomain counts as another origin. The refusal is recorded in the audit trail as `authz.check` with the reason `cross-origin`. Requests without cookies, and requests that name no origin, are not affected.

### A route other sites post to

Some routes are posted to by another site's page on purpose, like a payment provider sending the user back, or a [sign-in provider answering with a form post](./sign-in-through-a-provider.md#providers-that-answer-with-a-form-post). Name the origins of those pages with `@AcceptCrossSitePosts`, and that route takes their requests with cookies:

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

The framework's own headers are always allowed: the csrf token, the two-factor code, the trace context and the version header, under whatever names their DI tokens currently give them. Add your own on top:

```ts
const corsWithOwnHeaders: CorsOptions = {
    origins: ['https://app.example.com'],
    additionalAllowedHeaders: ['x-tenant-id']
};
```

Additional rather than replacing, deliberately — a list that replaced the framework's own would disable csrf and two-factor from a browser without saying so.

### Methods

Every method the router can serve is allowed by default. Narrow it if you want to:

```ts
const corsWithMethods: CorsOptions = { origins: ['https://app.example.com'], methods: [HttpMethod.GET, HttpMethod.POST] };
```

### Preflights

Browsers ask permission before sending anything that isn't a [simple request](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS#simple_requests) — anything with a custom header, or a method beyond `GET`/`HEAD`/`POST`. That question is an `OPTIONS` request carrying `access-control-request-method`, and Zibri answers it before your routes run.

An `OPTIONS` request **without** that header is not a preflight — it is a client asking what an endpoint supports. Those are routed like any other request and answered with an `Allow` header listing the methods that exist, which is what `OPTIONS` means outside of CORS. Only preflights are short-circuited.

## Security headers

Set on every response, with nothing to configure:

- `x-content-type-options: nosniff`
- `referrer-policy: strict-origin-when-cross-origin`

### HSTS

Sent only over https, since a browser must not learn it over a connection that could have been tampered with. Enabled by default:

```ts
const withHsts: ZibriApplicationSecurityOptionsInput = {
    headers: {
        [KnownHeader.STRICT_TRANSPORT_SECURITY]: { maxAgeSeconds: 15552000, includeSubDomains: true, preload: false }
    }
};
```

Pass `false` to disable it, or `true` for the defaults. `preload` is a one-way door — browsers ship the preload list in their binaries, and getting off it takes months — so turn it on only once you are certain every subdomain will be https indefinitely.

### Content security policy

Every html response carries a content security policy, and so does an svg file, which a browser renders like a page. By default it allows scripts, frames and forms from your own origin only:

```
default-src 'self'; base-uri 'self'; object-src 'none'; form-action 'self'; frame-ancestors 'self';
script-src 'self' 'nonce-…'; script-src-attr 'none'
```

`script-src` always carries a nonce that is new for every response, cached pages included. A script tag carrying that nonce runs, which is how the script `TsxUtilities.renderPage` adds to a page is allowed. A template of your own reads the nonce from the request context:

```ts
import { HttpRequestContext, inject, WebsocketRequestContext, ZIBRI_DI_TOKENS, ZIBRI_REQUEST_CONTEXT_TOKENS } from 'zibri';

const context: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
const nonce: string | undefined = context?.get(ZIBRI_REQUEST_CONTEXT_TOKENS.NONCE);
const inlineScript: string = `<script nonce="${nonce}">/* … */</script>`;
```

When `frame-ancestors` is exactly `'self'` or `'none'`, the matching `x-frame-options` header is sent as well, for browsers that predate the directive.

Set the policy for every response through DI. Each directive you name replaces the default's:

```ts
import { CspOptionsInput, defineProvider, ZIBRI_DI_TOKENS } from 'zibri';

const csp: CspOptionsInput = {
    imgSrc: ['\'self\'', 'https://images.example.com'],
    frameAncestors: ['\'none\'']
};

const cspProvider = defineProvider({ token: ZIBRI_DI_TOKENS.DEFAULT_CSP_OPTIONS_INPUT, useValue: csp });
```

A single response can set its own directives in the same way, or send no policy at all:

```ts
import { HtmlResponse } from 'zibri';

const withCdnScripts: HtmlResponse = HtmlResponse.fromString('<html>…</html>', {
    csp: { scriptSrc: ['\'self\'', 'https://cdn.example.com'] }
});
const withoutPolicy: HtmlResponse = HtmlResponse.fromString('<html>…</html>', { csp: false });
```

The request's nonce is added to `script-src` in both cases, unless it lists `'unsafe-inline'`, which already lets every inline script run. A `FileResponse` takes the same `csp` option. Files other than svg carry no policy unless you set one.

## Running behind a proxy

A load balancer, ingress or CDN in front of your application terminates the connection itself, so
what Zibri sees is that proxy's address over plain http. The client's real address and protocol
arrive in `x-forwarded-*` headers, and `trustProxy` says how much of them to believe:

```ts
const behindOneProxy: ZibriApplicationSecurityOptionsInput = {
    // one proxy in front of the app - the common case for a single ingress
    trustProxy: 1
};
```

It takes a hop count, an address or subnet to trust, a list of them, or `true` for everything.

**Defaults to `false`, and that is not a placeholder.** Those headers are just headers: anyone can
send them, and until something in front of your application overwrites them they are attacker
supplied. Trusting them unconditionally lets a caller pick their own client address — and with it
anything keyed by that address, a [rate limit](./rate-limiting.md) above all.

Once it is set, two things become true rather than approximately true: the address a rate limit
counts per, and whether a request arrived over https — which decides whether session cookies are
marked `Secure` and whether HSTS is sent.

## See also
- [Auth](./auth.md) — protecting the endpoints themselves, which is what CORS does not do
- [Rate limiting](./rate-limiting.md) — what the client address is used for
- [Two factor](./two-factor.md) — requiring a second factor on sensitive operations
- [Creating endpoints](./creating-endpoints.md) — the routes these rules apply to
- [Application lifecycle](./application-lifecycle.md) — where `ZibriApplicationOptions` is passed
