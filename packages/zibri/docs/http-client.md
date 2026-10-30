# HTTP client
The HTTP client sends requests to other APIs. It validates the response body and headers you declare the same way an incoming request is validated, see [accessing request data](./creating-endpoints.md#accessing-request-data).

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `HttpClientInterface` | interface | Contract for making outgoing HTTP requests |
| `ZIBRI_DI_TOKENS.HTTP_CLIENT` | DI token | Injects `HttpClientInterface` |
| `HttpClient` | class | The default `HttpClientInterface`. Replaceable through ZIBRI_DI_TOKENS.HTTP_CLIENT |
| `UrlUtilities` | class | Checks a URL before calling it: `isLoopback`, `isPrivate` (https or loopback, so nobody can listen in) and `withoutQuery` |
| `HttpOptions`, `HttpOptionsInput` | type, type | The options of one request: query, headers, timeout, attempts, redirects, the request body type and the expected response body and headers |
| `HttpOptionsWithoutResponseBodyInput` | type | The options of a `head` request, which has no response body |
| `HttpClientRedirect` | type | What a request does when it is answered with a [redirect](#following-redirects) |
| `HttpClientHeaderValue` | type | A value a request header can be sent with |
| `HttpClientRequestBodyMimeType`, `HttpClientRequestBody` | type, type | The mime types a request body can be sent as, and the body each one takes, an `XmlString` for XML |
| `HttpClientResponseBodyInput`, `JsonResponseBodyInput`, `XmlResponseBodyInput`, `FormDataResponseBodyInput`, `FormUrlEncodedResponseBodyInput`, `StreamResponseBodyInput` | type, type, type, type, type, type | The `responseBody` of a request: a model class, or the format with its model or shapes |
| `HttpClientResponse` | type | Shape of a response, including validated body and headers |
| `HttpClientResponseForBody` | type | The response a request returns for the `responseBody` it declares |
| `HttpClientResult` | type | What a request resolves to: the response for the `responseBody` and the `responseHeaders` it declares |
| `isHttpClientResponse` | function | Checks whether a value is an `HttpClientResponse` |
| `HttpClientError`, `isHttpClientError` | error, function | Thrown when no response arrives or its body or a header fails to parse or validate, and a check for it |
| `HttpClientErrorRequestData`, `HttpClientErrorResponseData`, `HttpClientErrorOptions` | type, type, type | The request and the response an `HttpClientError` carries, and what it is created with |
| `HttpClientDispatcher` | type | What a request is sent over: a proxy, a CA bundle, a client certificate |
| `ZIBRI_DI_TOKENS.HTTP_CLIENT_OPTIONS_INPUT` | DI token | Deployment-wide timeout, response size limit, dispatcher, circuit breaker and redirects |
| `HttpClientOptions`, `HttpClientOptionsInput` | type, type | The options every request is sent with, and the ones a deployment sets |
| `HttpClientIdempotencyKey` | type | The [idempotency key](#idempotency-keys) a request is sent with |
| `HttpClientCircuitBreakerOptions` | type | When requests to an [origin that keeps failing](#when-an-upstream-keeps-failing) stop being sent |
| `CircuitOpenError` | error | A request that was not sent because its origin's circuit is open |
| `FetchForLibraryOptions` | type | A larger response size limit for one request [handed to a library](#handing-the-client-to-a-library) |
| `MimeType` | enum | Known mime types, used to select a non-default response body format |
| `KnownHeader` | enum | Known header names, used to define expected response headers |
| `FormData` | class | Response body wrapper for `multipart/form-data` responses |

## Making a request
Nothing below declares what the body looks like, so `body` is `undefined` and the unvalidated response is in `rawBody`:

```ts
// src/services/partner-api.service.ts
import { HttpClientInterface, HttpClientResponse, inject, ZIBRI_DI_TOKENS } from 'zibri';

export async function listProjects(): Promise<HttpClientResponse> {
    const http: HttpClientInterface = inject(ZIBRI_DI_TOKENS.HTTP_CLIENT);
    return await http.get('https://partner.example.com/projects');
}
```

`post`, `put`, `patch`, `delete`, `head` and `options` send the other methods. A `head` response has headers and no body, so `head` takes `responseHeaders` and no `responseBody`.

## Setting request body, query and header params
Pass the request body as the second argument of a method that takes one. `get` takes none. For a `post` to an endpoint that expects no body, pass `undefined`.

With `requestBodyType: MimeType.XML`, the body is an `XmlString`, for example one written with `XmlUtilities.generateFrom`. See [XML](./xml.md#writing-a-document).

Set header and query params with the `headers` and `query` options:

```ts
// src/services/partner-api.service.ts
import { HttpClientInterface, HttpClientResponse, inject, ZIBRI_DI_TOKENS } from 'zibri';

export async function postWithParams(): Promise<HttpClientResponse> {
    const http: HttpClientInterface = inject(ZIBRI_DI_TOKENS.HTTP_CLIENT);
    return await http.post(
        'https://partner.example.com/some-endpoint-with-query-and-header-params',
        {
            some: 'data'
        },
        {
            headers: { apiKey: '42' },
            query: { startYear: 2025 }
        }
    );
}
```

## Setting attempts and timeout
By default, the HTTP client:
- waits for 5 seconds before throwing a timeout error
- tries the request exactly once

The timeout covers the whole answer, body included: the clock runs until the body has been read.

Override both with the `attempts` and `timeoutInMs` options:

```ts
// src/services/partner-api.service.ts
import { HttpClientInterface, HttpClientResponse, inject, ZIBRI_DI_TOKENS } from 'zibri';

export async function getWithRetries(): Promise<HttpClientResponse> {
    const http: HttpClientInterface = inject(ZIBRI_DI_TOKENS.HTTP_CLIENT);
    return await http.get(
        'https://partner.example.com/some-endpoint',
        {
            attempts: 3,
            timeoutInMs: 10000
        }
    );
}
```

## Inside a request
A call sent while handling a request is also bound by that request's deadline, and the shorter of the two ends it. A route allowed two seconds holds an upstream connection for two seconds, not for the ten its `timeoutInMs` allows. A call that is backing off before another attempt stops backing off.

It fails with the same `GatewayTimeoutError` the caller was answered with. See [deadlines](./creating-endpoints.md#deadlines).

## What gets retried

`attempts` is the most attempts a request gets. A failure is tried again only when another attempt can help, and when repeating the request is safe.

A request is tried again after a connection that failed, a timeout, or a `408`, `429`, `500`, `502`, `503` or `504`. Any other status is the server's answer to this request, and asking again gets the same answer: a `400` is still malformed, a `409` is still a conflict, a `403` is still forbidden.

`GET`, `HEAD`, `OPTIONS`, `PUT` and `DELETE` are safe to repeat. Sending one of them twice leaves the same result as sending it once.

`POST` and `PATCH` are repeated only after a `429` or a `503`, which say the server has not looked at the request yet. After a connection error or a timeout the request may have been carried out with only the reply lost, so these two methods are not repeated then, unless the request carries an [idempotency key](#idempotency-keys).

Between attempts the client waits, doubling the wait each time up to ten seconds. Half of each wait is random, so callers that failed together do not all come back together. When the response carries a `Retry-After`, the client waits that long instead.

## Idempotency keys
A server that supports idempotency keys answers a repeated key like the first request that carried it, instead of doing the work again. Give a `POST` or `PATCH` one, and it is retried like a `PUT`: also after a connection error, a timeout or a `500`, `502` or `504`.

```ts
// src/services/partner-api.service.ts
import { HttpClientInterface, HttpClientResponse, inject, ZIBRI_DI_TOKENS } from 'zibri';

export async function createOrder(orderId: string): Promise<HttpClientResponse> {
    const http: HttpClientInterface = inject(ZIBRI_DI_TOKENS.HTTP_CLIENT);
    return await http.post('https://partner.example.com/orders', { orderId }, { attempts: 3, idempotencyKey: orderId });
}
```

`idempotencyKey: true` generates a key for the call. Either way, every attempt of the call sends the same key, as `Idempotency-Key`. For a provider that reads it from another header, name it: `idempotencyKey: { value: orderId, header: 'PayPal-Request-Id' }`, where a missing `value` is generated as well.

## When an upstream keeps failing
The client stops calling an origin (scheme, host and port) that failed 5 times in a row. A failure is a request that got no answer, or one answered with `500`, `502`, `503` or `504`. Any other answer resets the count. For the next 30 seconds every request to that origin fails at once with a `CircuitOpenError`, an `HttpClientError` naming the `origin` and when it `reopensAt`, without being sent and without further attempts. After that, one request is let through: an answer closes the circuit, and a failure keeps it shut for another 30 seconds.

Each instance counts on its own. Change the thresholds, or turn it off with `false`:

```ts
// src/providers.ts
import { defineProvider, ZIBRI_DI_TOKENS } from 'zibri';

defineProvider({
    token: ZIBRI_DI_TOKENS.HTTP_CLIENT_OPTIONS_INPUT,
    useValue: { circuitBreaker: { failuresToOpen: 10, openForInMs: 60000 } }
})
```

## Following redirects
A request answered with a redirect goes on to where the redirect leads, up to 20 redirects in a row. A redirect from https to http fails the request with an `HttpClientError` that carries the redirect's status and its `Location` header.

Each redirect is sent as a request of its own. It counts toward the [circuit](#when-an-upstream-keeps-failing) of the origin it goes to, and one timeout covers all of them. A request that a redirect sends to another origin goes without its `Authorization`, `Proxy-Authorization` and `Cookie` headers. A `POST` answered with `301`, `302` or `303`, and any other method but `GET` and `HEAD` answered with `303`, goes on as a `GET` without its body.

The `redirect` option sets what a request does:

| Value | A redirect |
|---|---|
| `'follow'` | Is followed, unless it leads from https to http. The default |
| `'same-origin'` | Is followed when it stays on the origin it came from |
| `'error'` | Fails the request |

Use `'error'` or `'same-origin'` for a URL your users give you, such as the target of a webhook, so the address you checked is the one the request goes to:

```ts
// src/services/webhook.service.ts
import { HttpClientInterface, HttpClientResponse, inject, ZIBRI_DI_TOKENS } from 'zibri';

export async function sendWebhook(targetUrl: string, payload: object): Promise<HttpClientResponse> {
    const http: HttpClientInterface = inject(ZIBRI_DI_TOKENS.HTTP_CLIENT);
    return await http.post(targetUrl, payload, { redirect: 'error' });
}
```

`redirect` in `HTTP_CLIENT_OPTIONS_INPUT` sets it for every request, and a request's own `redirect` wins.

## How large a response may be

A response body is read as it arrives and counted against a limit. An upstream that sends more is stopped at the limit, before the rest is downloaded. A body that declares a `Content-Length` over the limit is turned away before any of it is read.

The limit comes from whichever is more specific:

| | Limit |
|---|---|
| `responseBody` declared | Derived from that model, exactly like a route's request body |
| Nothing declared | `defaultMaxResponseSize`, 10mb by default |
| `stream` response type | None. Nothing is buffered, and the body is yours to consume |

The body of a response that is not ok is read within `defaultMaxResponseSize`, whatever the call declared. Past that, the `HttpClientError` carries the status and the headers and no body.

Change the deployment-wide defaults through DI:

```ts
// src/providers.ts
import { defineProvider, ZIBRI_DI_TOKENS } from 'zibri';

defineProvider({
    token: ZIBRI_DI_TOKENS.HTTP_CLIENT_OPTIONS_INPUT,
    useValue: {
        defaultTimeoutInMs: 30000,
        defaultMaxResponseSize: '50mb'
    }
})
```

A `timeoutInMs` on a single request wins over the default.

## Egress: proxies, CA bundles and mutual TLS

How a connection is made, such as through an egress proxy, with a custom CA bundle, a client certificate, keep-alive or pooling per host, is set by handing the client a `dispatcher`. You build it from `undici`, the package Node's own `fetch` runs on.

```ts
// src/providers.ts
import { ProxyAgent } from 'undici';

import { defineProvider, ZIBRI_DI_TOKENS } from 'zibri';

defineProvider({
    token: ZIBRI_DI_TOKENS.HTTP_CLIENT_OPTIONS_INPUT,
    useValue: {
        dispatcher: new ProxyAgent('http://egress-proxy.internal:3128')
    }
})
```

A CA bundle and a client certificate are the same option, built differently:

```ts
// src/egress.ts
import { readFileSync } from 'node:fs';
import { Agent } from 'undici';

import { clientCert, clientKey } from './certificates';

export const corporateAgent: Agent = new Agent({ connect: { ca: readFileSync('corporate-root.pem', 'utf8') } });
export const partnerAgent: Agent = new Agent({ connect: { cert: clientCert, key: clientKey } });
```

One destination can go out a different way, such as mutual TLS to a single partner:

```ts
// src/services/partner-api.service.ts
import { HttpClientInterface, HttpClientResponse, inject, ZIBRI_DI_TOKENS } from 'zibri';

import { partnerAgent } from '../egress';

export async function getFromPartner(): Promise<HttpClientResponse> {
    const http: HttpClientInterface = inject(ZIBRI_DI_TOKENS.HTTP_CLIENT);
    return await http.get('https://partner.example.com/orders', { dispatcher: partnerAgent });
}
```

A request's own `dispatcher` replaces the application's, and is not merged with it. Put everything that shares an egress path on `HTTP_CLIENT_OPTIONS_INPUT`, so a proxy or a CA bundle is stated once.

With no dispatcher anywhere, a request goes out over Node's own, exactly like a plain `fetch`. The client never installs a global dispatcher, so it never changes where the other libraries in the process send their traffic.

## Handing the client to a library
Some libraries send their own requests and take a fetch function to send them with. Hand them `fetchForLibrary`, so their requests go out with your dispatcher, timeout and response size limit too:

```ts
// src/services/sdk-fetch.service.ts
import { HttpClientInterface, inject, ZIBRI_DI_TOKENS } from 'zibri';

export function createSdkFetch(): (url: string, init: RequestInit) => Promise<Response> {
    const http: HttpClientInterface = inject(ZIBRI_DI_TOKENS.HTTP_CLIENT);
    return async (url, init) => await http.fetchForLibrary(url, init);
}
```

`fetchForLibrary` answers like `fetch`: a status that is not ok is a response, not an error, and nothing is validated or retried. Use `get`, `post` and the others for your own requests.

A library's requests [follow redirects](#following-redirects) the way the application's `redirect` says. A library that asks for `redirect: 'manual'` gets the redirect itself as the response, and one that asks for `redirect: 'error'` gets an error for any.

A library downloading something larger than `defaultMaxResponseSize` allows names its own limit for that request, as `FetchForLibraryOptions`:

```ts
// src/services/sdk-fetch.service.ts
import { HttpClientInterface, inject, ZIBRI_DI_TOKENS } from 'zibri';

export async function downloadLargeList(url: string): Promise<string> {
    const http: HttpClientInterface = inject(ZIBRI_DI_TOKENS.HTTP_CLIENT);
    return await (await http.fetchForLibrary(url, { method: 'GET' }, { maxResponseSize: '100mb' })).text();
}
```

## Defining response data
You declare what the body and the headers of a response look like.

### body
Declare the body with a class whose properties carry `@Property`, as for an incoming body. The example below expects a body with a string `name` and a number `value`, and throws a validation error otherwise.

```ts
// src/services/partner-api.service.ts
import { HttpClientInterface, HttpClientResponse, inject, Property, ZIBRI_DI_TOKENS } from 'zibri';

class Item {
    @Property.string()
    name!: string;

    @Property.number()
    value!: number;
}

export async function getItem(): Promise<HttpClientResponse<Item>> {
    const http: HttpClientInterface = inject(ZIBRI_DI_TOKENS.HTTP_CLIENT);
    return await http.get(
        'https://partner.example.com/item',
        { responseBody: Item }
    );
}
```

For a body other than JSON, declare an object with the expected mime type of the response body:

```ts
// src/services/partner-api.service.ts
import { File, FormData, HttpClientInterface, HttpClientResponse, inject, MimeType, Property, ZIBRI_DI_TOKENS } from 'zibri';

class FormDataItem {
    @Property.file({ allowedMimeTypes: [MimeType.JSON] })
    file!: File;

    @Property.array({ items: { type: 'file', allowedMimeTypes: 'all' }, totalMaxSize: '5mb' })
    files!: File[];
}

export async function getFormData(): Promise<HttpClientResponse<FormData<FormDataItem>>> {
    const http: HttpClientInterface = inject(ZIBRI_DI_TOKENS.HTTP_CLIENT);
    return await http.get(
        'https://partner.example.com/form-data',
        {
            responseBody: {
                modelClass: FormDataItem,
                type: MimeType.FORM_DATA
            }
        }
    );
}
```

An XML response is declared the same way, with `type: MimeType.XML`. See [XML](./xml.md#writing-a-document) for sending one as well.

A response declared with `type: MimeType.OCTET_STREAM` is handed over as a `Readable` of the bytes that arrived, whatever `Content-Type` the service names for them.

When the response can be one of several shapes, list them. The body becomes the first shape it fits, and its type is every shape:

```ts
// src/services/partner-api.service.ts
import { HttpClientInterface, HttpClientResponse, inject, Property, ZIBRI_DI_TOKENS } from 'zibri';

class ItemList {
    @Property.array({ items: { type: 'object', cls: () => Item } })
    items!: Item[];
}

export async function getItemOrList(): Promise<HttpClientResponse<Item | ItemList>> {
    const http: HttpClientInterface = inject(ZIBRI_DI_TOKENS.HTTP_CLIENT);
    return await http.get(
        'https://partner.example.com/items/latest',
        {
            responseBody: {
                shapes: [
                    { type: 'object', cls: () => Item },
                    { type: 'object', cls: () => ItemList }
                ]
            }
        }
    );
}
```

### headers
Declare response headers with the `responseHeaders` option. The example below expects a `Content-Length` header holding a number, and throws a validation error otherwise. The type of `headers` follows what was declared, so it carries the content length as a number, not as the string it arrived as:

```ts
// src/services/partner-api.service.ts
import { HttpClientInterface, inject, KnownHeader, ZIBRI_DI_TOKENS } from 'zibri';

export async function getWithCheckedHeaders(): Promise<number> {
    const http: HttpClientInterface = inject(ZIBRI_DI_TOKENS.HTTP_CLIENT);
    const response = await http.get(
        'https://partner.example.com/item',
        {
            responseHeaders: {
                [KnownHeader.CONTENT_LENGTH]: { type: 'number' }
            }
        }
    );
    return response.headers[KnownHeader.CONTENT_LENGTH];
}
```

## See also
- [Creating endpoints](./creating-endpoints.md#accessing-request-data) — the same validation procedure used for incoming requests
- [Dependency injection](./di.md) — how `ZIBRI_DI_TOKENS.HTTP_CLIENT` is resolved via `inject`
