# Http Client
When building an API, you most likely will need to integrate some third party API. For that, Zibri provides a http client. In contrast to other packages in this space, response types are not just assumed but actually validated using the same procedure that is also used for incoming http requests. See the [creating endpoints guide](./creating-endpoints.md#accessing-request-data) for more details.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `HttpClientInterface` | interface | Contract for making outgoing http requests |
| `ZIBRI_DI_TOKENS.HTTP_CLIENT` | DI token | Injects `HttpClientInterface` |
| `HttpClientResponse` | type | Shape of a response, including validated body and headers |
| `HttpClientDispatcher` | type | What a request is sent over — a proxy, a CA bundle, a client certificate |
| `ZIBRI_DI_TOKENS.HTTP_CLIENT_OPTIONS_INPUT` | DI token | Deployment-wide timeout, response size limit and dispatcher |
| `FetchForLibraryOptions` | type | A larger response size limit for one request [handed to a library](#handing-the-client-to-a-library) |
| `MimeType` | enum | Known mime types, used to select a non-default response body format |
| `KnownHeader` | enum | Known header names, used to define expected response headers |
| `FormData` | class | Response body wrapper for `multipart/form-data` responses |

## Usage
### Making a request
```ts
// src/services/some-api.service.ts
import { Agent, ProxyAgent } from 'undici';
import { readFileSync } from 'node:fs';

import { defineProvider, FormData, HttpClientInterface, HttpClientResponse, inject, KnownHeader, MimeType, Property, ZIBRI_DI_TOKENS } from 'zibri';

import { clientCert, clientKey, partnerAgent } from './egress';

export async function listTests(): Promise<HttpClientResponse> {
    const http: HttpClientInterface = inject(ZIBRI_DI_TOKENS.HTTP_CLIENT);
    // nothing is declared about the body, so `body` is undefined and the unvalidated response is in `rawBody`
    return await http.get('https://some-api.com/tests');
}
```

### Setting request body, query and header params
To set the request body, you need to provide it as the second argument to a method that supports it (`get` has no request body for example). If you have an endpoint that uses eg. `post` but does not expect a request body then you need to pass undefined instead. 

With `requestBodyType: MimeType.XML`, the body is an `XmlString`, eg. one written with `XmlUtilities.generateFrom`. See [XML](./xml.md#writing-a-document).

To set header or query params on the request, you can use the respective option:

```ts
export async function postWithParams(): Promise<HttpClientResponse> {
    const http: HttpClientInterface = inject(ZIBRI_DI_TOKENS.HTTP_CLIENT);
    return await http.post(
        'https://some-api.com/some-endpoint-with-query-and-header-params',
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

### Setting attempts and timeout
By default, the http client:
- waits for 5 seconds before throwing a timeout error
- tries the request exactly once

The timeout covers the **whole answer**, not just its first line. An upstream that responds instantly and then dribbles its body forever is exactly what a deadline is for, so the clock keeps running until the body has been read.

You can override this by specifying the respective option:

```ts
export async function getWithRetries(): Promise<HttpClientResponse> {
    const http: HttpClientInterface = inject(ZIBRI_DI_TOKENS.HTTP_CLIENT);
    return await http.get(
        'https://some-api.com/some-endpoint',
        {
            attempts: 3,
            timeoutMs: 10000
        }
    );
}
```

### Inside a request
A call sent while handling a request is also bound by that request's deadline, and the shorter of the two is the one that ends it. So a route allowed two seconds does not hold an upstream connection for the ten its own `timeoutMs` allows, and a call that was backing off before another attempt stops backing off.

It fails with the same `GatewayTimeoutError` the caller was answered with, rather than reporting a failed request — nothing went wrong with the call, it was let go. See [deadlines](./creating-endpoints.md#deadlines).

### What gets retried

`attempts` is a ceiling, not a promise. A failure is only tried again when trying again could plausibly help, and when repeating the request is safe.

**Worth another attempt:** a connection that failed, a timeout, or a `408`, `429`, `500`, `502`, `503` or `504`. Every other status is the server's considered answer to this exact request, and asking again produces the same answer — a `400` is still malformed, a `409` is still a conflict, a `403` is still forbidden.

**Safe to repeat:** `GET`, `HEAD`, `OPTIONS`, `PUT` and `DELETE`. Sending one of those twice leaves the same result as sending it once.

`POST` and `PATCH` are repeated in exactly one case: the server said it had not looked at the request yet, which is what a `429` or a `503` means. Neither can have charged a card. A connection error or a timeout is the opposite situation — the request may well have arrived and been carried out with only the reply lost, and nothing on this side can tell that from a request that never landed — so those are never repeated for those methods.

**Between attempts** the client waits, doubling each time up to ten seconds, with half the wait randomised so that a group of callers that failed together do not all return together. If the response carried a `Retry-After`, that is used instead: the server is the only party that knows when it will be ready.

### How large a response may be

A response body is read as it arrives and counted against a limit, so an upstream sending more than was asked for is stopped at the limit rather than downloaded in full and refused afterwards. A body that declares a `Content-Length` over the limit is turned away before any of it is read.

The limit comes from whichever is more specific:

| | Limit |
|---|---|
| `responseBody` declared | derived from that model, exactly like a route's request body |
| nothing declared | `defaultMaxResponseSize`, 10mb out of the box |
| `stream` response type | none — nothing is buffered, and the body is yours to consume |

Change the deployment-wide defaults through DI:

```ts
defineProvider({
    token: ZIBRI_DI_TOKENS.HTTP_CLIENT_OPTIONS_INPUT,
    useValue: {
        defaultTimeoutMs: 30000,
        defaultMaxResponseSize: '50mb'
    }
})
```

A `timeoutMs` on a single request still wins over the default.

### Egress: proxies, CA bundles and mutual TLS

Everything about *how* a connection is made — a corporate egress proxy, a custom CA bundle, a client certificate, keep-alive, per-host pooling — is configured by handing the client a `dispatcher`. Zibri does not build one: you construct it from `undici`, which is what Node's own `fetch` uses underneath.

```ts
import { Agent, ProxyAgent } from 'undici';

defineProvider({
    token: ZIBRI_DI_TOKENS.HTTP_CLIENT_OPTIONS_INPUT,
    useValue: {
        dispatcher: new ProxyAgent('http://egress-proxy.internal:3128')
    }
})
```

A CA bundle and a client certificate are the same option, built differently:

```ts
new Agent({ connect: { ca: readFileSync('corporate-root.pem', 'utf8') } });
new Agent({ connect: { cert: clientCert, key: clientKey } });
```

One destination can go out a different way, which is what mutual TLS to a single partner looks like:

```ts
export async function getFromPartner(): Promise<HttpClientResponse> {
    const http: HttpClientInterface = inject(ZIBRI_DI_TOKENS.HTTP_CLIENT);
    return await http.get('https://partner.example.com/orders', { dispatcher: partnerAgent });
}
```

A request's own `dispatcher` **replaces** the application's rather than merging with it — a dispatcher is one connection policy, and half of two is not a policy. Everything that shares an egress path belongs on `HTTP_CLIENT_OPTIONS_INPUT`, so a proxy or a CA bundle is stated once rather than at every call site.

Naming no dispatcher anywhere uses Node's own, exactly like a plain `fetch`. The client never installs a global dispatcher: that would change where every other library in the process sends its traffic, which is not a framework's decision to make.

### Handing the client to a library
Some libraries send their own requests and take a fetch function to send them with. Hand them `fetchForLibrary`, so their requests go out with your dispatcher, timeout and response size limit too:

```ts
export function createSdkFetch(): (url: string, init: RequestInit) => Promise<Response> {
    const http: HttpClientInterface = inject(ZIBRI_DI_TOKENS.HTTP_CLIENT);
    return async (url, init) => await http.fetchForLibrary(url, init);
}
```

`fetchForLibrary` answers like `fetch`: a status that is not ok is a response, not an error, and nothing is validated or retried. Use `get`, `post` and the others for your own requests.

A library downloading something larger than `defaultMaxResponseSize` allows names its own limit for that request, as `FetchForLibraryOptions`:

```ts
export async function downloadLargeList(url: string): Promise<string> {
    const http: HttpClientInterface = inject(ZIBRI_DI_TOKENS.HTTP_CLIENT);
    return await (await http.fetchForLibrary(url, { method: 'GET' }, { maxResponseSize: '100mb' })).text();
}
```

### Defining response data
Response data only consists of the body and possible headers that have been sent.

#### body
The body works by providing a class that has properties with the `@Property` decorator, same as an incoming body. In the following, we validate that the response body has the properties name and value, which are both strings. If that is not the case, a validation error will be thrown.

```ts
class Item {
    @Property.string()
    name!: string;

    @Property.number()
    value!: number;
}

export async function getItem(): Promise<HttpClientResponse<Item>> {
    const http: HttpClientInterface = inject(ZIBRI_DI_TOKENS.HTTP_CLIENT);
    return await http.get(
        'https://some-api.com/item',
        { responseBody: Item }
    );
}
```

If you want something other than the default json then you can instead define an object with the expected mime type of the response body:

```ts
class FormDataItem {
    @Property.file({ allowedMimeTypes: [MimeType.JSON] })
    file!: File;

    @Property.array({ items: { type: 'file', allowedMimeTypes: 'all' }, totalMaxSize: '5mb' })
    files!: File[];
}

export async function getFormData(): Promise<HttpClientResponse<FormData<FormDataItem>>> {
    const http: HttpClientInterface = inject(ZIBRI_DI_TOKENS.HTTP_CLIENT);
    return await http.get(
        'https://some-api.com/form-data',
        {
            responseBody: {
                modelClass: FormDataItem,
                type: MimeType.FORM_DATA
            }
        }
    );
}
```

An xml response is declared the same way, with `type: MimeType.XML`. See [XML](./xml.md#writing-a-document) for sending one as well.

A response declared with `type: MimeType.OCTET_STREAM` is handed over as a `Readable` of the bytes that arrived, whatever `Content-Type` the service names for them.

When the response can be one of several shapes, list them. The body becomes the first shape it fits, and its type is every shape:

```ts
class ItemList {
    @Property.array({ items: { type: 'object', cls: () => Item } })
    items!: Item[];
}

export async function getItemOrList(): Promise<HttpClientResponse<Item | ItemList>> {
    const http: HttpClientInterface = inject(ZIBRI_DI_TOKENS.HTTP_CLIENT);
    return await http.get(
        'https://some-api.com/items/latest',
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

#### headers
Response headers can be defined by setting the respective option. In the following case, we validate that the response has a content length header and that it is of type number. If it's not, a validation error will be thrown.

```ts
export async function getWithCheckedHeaders(): Promise<number> {
    const http: HttpClientInterface = inject(ZIBRI_DI_TOKENS.HTTP_CLIENT);
    // the response type follows what was declared, so `headers` carries the content length as a
    // number rather than as the string it arrived as
    const response = await http.get(
        'https://some-api.com/item',
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