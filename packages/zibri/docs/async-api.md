# The AsyncAPI document
Your application describes its [websocket](./websocket.md) events as an [AsyncAPI](https://www.asyncapi.com/docs/reference/specification/v3.0.0) 3.0 document, one for each version, built from the websocket controllers. AsyncAPI is to events what OpenAPI is to HTTP routes. A client generator writes a client from it, and the explorer at `/explorer` shows it beside the [OpenAPI document](./open-api.md).

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `AsyncApiService`, `AsyncApiServiceInterface` | class, interface | Builds the document of each version. Replaceable through `ZIBRI_DI_TOKENS.ASYNC_API_SERVICE` |
| `ZIBRI_DI_TOKENS.ASYNC_API_SERVERS` | DI token | The servers the document names, under their keys, see [naming the servers](#naming-the-servers). Defaults to the application itself |
| `AsyncApiDefinition` | type | The document of one version |
| `AsyncApiInfo`, `AsyncApiServer`, `AsyncApiChannel`, `AsyncApiOperation`, `AsyncApiOperationReply`, `AsyncApiMessage`, `AsyncApiTag`, `AsyncApiComponents`, `AsyncApiReference` | type, type, type, type, type, type, type, type, type | The parts of the document: what it describes, where a client connects, an event, what the application does on it, its answer, a message, a tag, the reusable parts, and a `$ref` |
| `AsyncApiSecurityScheme`, `AsyncApiSecuritySchemeType`, `AsyncApiOAuthFlow` | type, type, type | How an [auth strategy](./glossary.md#auth-strategy) appears under `securitySchemes`, the kinds of scheme, and one flow of an `oauth2` scheme |
| `AsyncApiExplorerUtilities` | class | Reads the document for the explorer page: the operations by tag, with their events and messages, and the servers |
| `AsyncApiExplorerTag`, `AsyncApiExplorerOperation`, `AsyncApiExplorerServer` | type, type, type | The operations of a tag, one operation with its references resolved, and a server a client connects to |

## Reading the document

| URL | What it answers |
|---|---|
| `/explorer/asyncapi/<version>` | The document of one version as JSON, such as `/explorer/asyncapi/1.0.0`. `404` for a version the application does not have |

The document follows `ZIBRI_DI_TOKENS.OPEN_API_AUTH`, as the OpenAPI document does, see [restricting the explorer](./open-api.md#restricting-the-explorer). Each document is built when the application starts.

## What the document describes

| Part | What it holds |
|---|---|
| `servers` | The application as `application`, at its `baseUrl` and the `path` of the [websocket options](./websocket.md#configuring-websockets), as `ws` or `wss`. Or the ones `ZIBRI_DI_TOKENS.ASYNC_API_SERVERS` names, see [naming the servers](#naming-the-servers) |
| `channels` | One for each event of the version, with its full name as `address`, such as `chat:send`. Its messages are what a client sends, and the answer |
| `operations` | One for each `@WebsocketRoute`, which the application `receive`s, tagged with its controller. Its `reply` is the answer |
| `components.securitySchemes` | One for each registered auth strategy, under its name |

A message a client sends holds the `@WebsocketBody` of the route as `body`, beside the `headers` and the `query` of the message. An XML body is the text of its document, which the document describes with `contentMediaType` and `contentSchema`.

The answer is the message every event is answered with: `ok`, `status` and the `data` the route returns, or `ok: false` with the `error`. It arrives through the acknowledgement of the message, or as the event `ws:response` to a client that sends none.

An operation of a route that requires a login lists every strategy under `security`, and one behind a permission names it in `x-permission` or `x-platform-permission`.

The document holds one event the application sends: `ws:replay-incomplete`, see [reconnecting](./websocket.md#reconnecting). An event your code sends with the websocket service is added to it by [changing the document](#changing-the-document).

A version without websocket routes has a document without servers, channels and operations, and the explorer shows no AsyncAPI tab for it.

## Declaring what an event answers with
The `@Response` decorators of a route say what its `data` is, as they do for an HTTP route, see [defining OpenAPI responses](./creating-endpoints.md#defining-openapi-responses):

```ts
// src/models/chat-message.model.ts
import { Property } from 'zibri';

export class ChatMessage {
    @Property.string()
    text!: string;
}
```

```ts
// src/controllers/chat.websocket-controller.ts
import { Response, WebsocketBody, WebsocketController, WebsocketRoute } from 'zibri';

import { ChatMessage } from '../models/chat-message.model';

@WebsocketController({ eventPrefix: 'chat:' })
export class ChatWebsocketController {
    @Response.object(ChatMessage)
    @WebsocketRoute('send')
    send(@WebsocketBody(ChatMessage) message: ChatMessage): ChatMessage {
        return message;
    }
}
```

A route without one answers with `data` of any shape.

## Naming the servers
The document names the application as the server a client connects to, under the key `application`. `ZIBRI_DI_TOKENS.ASYNC_API_SERVERS` names others in its place, each under a key of its own. A server names the schemes a client connects with in its `security`:

```ts
// src/providers.ts
import { $ts, defineProvider, ZIBRI_DI_TOKENS } from 'zibri';

providers: [
    defineProvider({
        token: ZIBRI_DI_TOKENS.ASYNC_API_SERVERS,
        useFactory: () => ({
            production: {
                host: 'api.example.com',
                protocol: 'wss',
                pathname: '/socket.io',
                description: $ts`Production. A client names the version in the handshake.`,
                security: [{ $ref: '#/components/securitySchemes/jwt' }]
            }
        })
    })
]
```

The explorer shows each of them with its description.

## Changing the document
Extend `AsyncApiService` and provide it under `ZIBRI_DI_TOKENS.ASYNC_API_SERVICE`. `createAsyncApiDefinition` builds the document of one version; call it on `super` and change what it answers, such as to describe an event your code sends:

```ts
// src/services/events-docs.service.ts
import { AsyncApiDefinition, AsyncApiService, Version, ZibriApplication } from 'zibri';

export class EventsDocsService extends AsyncApiService {
    override async createAsyncApiDefinition(app: ZibriApplication, version: Version): Promise<AsyncApiDefinition> {
        const definition: AsyncApiDefinition = await super.createAsyncApiDefinition(app, version);
        return {
            ...definition,
            channels: {
                ...definition.channels,
                'chat-message': { address: 'chat message', messages: { message: { payload: { type: 'object' } } } }
            },
            operations: {
                ...definition.operations,
                sendChatMessage: { action: 'send', channel: { $ref: '#/channels/chat-message' }, messages: [{ $ref: '#/channels/chat-message/messages/message' }] }
            }
        };
    }
}
```

```ts
// src/providers.ts
import { defineProvider, ZIBRI_DI_TOKENS } from 'zibri';

import { EventsDocsService } from './services/events-docs.service';

defineProvider({ token: ZIBRI_DI_TOKENS.ASYNC_API_SERVICE, useClass: EventsDocsService });
```

A websocket service of your own names the path clients connect to with `getPath`. Without it, the server of the document names no path.

## See also
- [Websocket](./websocket.md) — the events the document describes
- [The OpenAPI document](./open-api.md) — the HTTP routes, and the explorer that shows both documents
- [Versioning](./versioning.md) — the versions each document is built for
