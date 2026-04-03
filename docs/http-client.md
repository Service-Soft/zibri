# Http Client
When building an API, you most likely will need to integrate some third party API. For that, Zibri provides a http client. In contrast to other packages in this space, response types are not just assumed but actually validated using the same procedure that is also used for incoming http requests. See the [creating endpoints guide](./creating-endpoints.md#accessing-request-data) for more details.

## Making a request
```ts
import { HttpClientInterface, inject, ZIBRI_DI_TOKENS } from 'zibri';

// ...
const http: HttpClientInterface = inject(ZIBRI_DI_TOKENS.HTTP_CLIENT);
// undefined is assumed for the response body because we did not define anything
const response: HttpClientResponse<undefined> = await http.get('https://some-api.com/tests');
// ...
```

### Setting request body, query and header params
To set the request body, you need to provide it as the second argument to a method that supports it (`get` has no request body for example). If you have an endpoint that uses eg. `post` but does not expect a request body then you need to pass undefined instead. 

To set header or query params on the request, you can use the respective option:

```ts
import { HttpClientInterface, inject, ZIBRI_DI_TOKENS, HttpClientResponse } from 'zibri';

// ...
const http: HttpClientInterface = inject(ZIBRI_DI_TOKENS.HTTP_CLIENT);
const response: HttpClientResponse<undefined> = await http.post(
    'https://some-api.com/some-endpoint-with-query-and-header-params',
    {
        some: 'data'
    },
    { 
        headers: { apiKey: '42' },
        query: { startYear: 2025 }
    }
);
// ...
```

### Setting retries and timeout
By default, the http client:
- waits for 5 seconds before throwing a timeout error
- tries the request exactly once

You can override this by specifying the respective option:

```ts
import { HttpClientInterface, inject, ZIBRI_DI_TOKENS, HttpClientResponse } from 'zibri';

// ...
const http: HttpClientInterface = inject(ZIBRI_DI_TOKENS.HTTP_CLIENT);
const response: HttpClientResponse<undefined> = await http.get(
    'https://some-api.com/some-endpoint',
    { 
        retries: 3,
        timeoutMs: 10000
    }
);
// ...
```

## Defining response data
Response data only consists of the body and possible headers that have been sent.

### body
The body works by providing a class that has properties with the `@Property` decorator, same as an incoming body. In the following, we validate that the response body has the properties name and value, which are both strings. If that is not the case, a validation error will be thrown.

```ts
import { HttpClientInterface, inject, ZIBRI_DI_TOKENS, HttpClientResponse } from 'zibri';

class Item {
    @Property.string()
    name!: string;

    @Property.number()
    value!: number;
}

// ...
const http: HttpClientInterface = inject(ZIBRI_DI_TOKENS.HTTP_CLIENT);
const response: HttpClientResponse<Item> = await http.get(
    'https://some-api.com/item',
    { responseBody: Item }
);
// ...
```

If you want something other than the default json then you can instead define an object with the expected mime type of the response body:

```ts
import { HttpClientInterface, inject, ZIBRI_DI_TOKENS, HttpClientResponse, MimeType, FormData } from 'zibri';

// ...
class FormDataItem {
    @Property.file({ allowedMimeTypes: [MimeType.JSON] })
    file!: File;

    @Property.array({ items: { type: 'file' }, totalMaxSize: '5mb' })
    files!: File[];
}

const http: HttpClientInterface = inject(ZIBRI_DI_TOKENS.HTTP_CLIENT);
const response: HttpClientResponse<FormData<FormDataItem>> = await http.get(
    'https://some-api.com/form-data',
    {
        responseBody: {
            modelClass: FormDataItem,
            type: MimeType.FORM_DATA
        }
    }
);
// ...
```

### headers
Response headers can be defined by setting the respective option. In the following case, we validate that the response has a content length header and that it is of type number. If it's not, a validation error will be thrown.

```ts
import { HttpClientInterface, inject, ZIBRI_DI_TOKENS, HttpClientResponse, KnownHeader } from 'zibri';

// ...
const http: HttpClientInterface = inject(ZIBRI_DI_TOKENS.HTTP_CLIENT);
const response: HttpClientResponse<Item> = await http.get(
    'https://some-api.com/item',
    { 
        responseHeaders: {
            [KnownHeader.CONTENT_LENGTH]: { type: 'number' }
        }
    }
);
// ...
```