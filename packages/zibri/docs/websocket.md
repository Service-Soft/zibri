# Websocket
The way Zibri handles websocket connections is pretty similar to http. It also supports recovering and replaying a prior connection.

A websocket server is started for an application that declares websockets: one that registers at least one websocket controller, or whose `ZIBRI_DI_TOKENS.WEBSOCKET_OPTIONS` name an `adapterDataSource`. The second covers a server that only pushes — broadcasting to clients without handling any inbound event.

It needs the optional peer dependency `socket.io`. Startup fails when websockets are declared without it, so an application that cannot serve them says so on the way up.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `WebsocketController` | decorator | Registers a class as a websocket controller |
| `WebsocketRoute` | decorator | Registers a method to handle an incoming websocket event |
| `WebsocketBody` | decorator | Parses/validates the body of an incoming websocket message, `WebsocketBody.oneOf` for a body of [several shapes](./creating-endpoints.md#a-body-of-several-shapes) |
| `CurrentWebsocketConnection` | decorator | Injects the connection that sent the current message |
| `BaseWebsocketConnection` | type | The connection object passed to route handlers |
| `WebsocketService` | class | Sends messages to a connection, all connections, or a channel |
| `WebsocketChannel` | entity | Entity used to create and join/leave channels |
| `ZIBRI_DI_TOKENS.WEBSOCKET_SERVICE` | DI token | Injects `WebsocketService` |
| `ZIBRI_DI_TOKENS.WEBSOCKET_OPTIONS` | DI token | Overrides websocket connection options |

## Usage
### Receiving messages
For handling incomig websocket messages, you need to create a websocket controller:

```ts
// src/controllers/test.websocket-controller.ts
import { WebsocketController, WebsocketBody, WebsocketRoute, Property, BaseWebsocketConnection, CurrentWebsocketConnection, defineProvider, Ms, ZIBRI_DI_TOKENS } from 'zibri';

import { CacheDbDataSource } from '../data-sources';

class Test {
    @Property.string()
    value!: string;
}

@WebsocketController()
export class TestWebsocketController {

    @WebsocketRoute('chat message')
    async receiveChatMessage(
        @WebsocketBody(Test)
        message: Test,
        @CurrentWebsocketConnection()
        connection: BaseWebsocketConnection
    ): Promise<void> {
        // ...
    }
}
```

As you can see it is basically exactly the same as a "normal" controller. With all the parsing/validation etc. builtin.

A websocket body is json, or [xml](./xml.md#receiving-an-xml-body) with `type: MimeType.XML`. Its size is bounded by `maxSize`, 100kb by default:

```ts
@WebsocketController()
export class LimitedWebsocketController {
    @WebsocketRoute('short message')
    async receiveShortMessage(@WebsocketBody(Test, { maxSize: '10kb' }) message: Test): Promise<void> {
        // ...
    }
}
```

### Sending messages
Messages can be send by using the websocket service. It provides methods for:
- sending to a specific connection
- sending to all connections
- sending to a channel

```ts
import { WebsocketController, WebsocketBody, WebsocketRoute, Property, Inject, ZIBRI_DI_TOKENS, WebsocketService, BaseWebsocketConnection, CurrentWebsocketConnection } from 'zibri';

export class CreateWebsocketChatMessageDTO {
    @Property.string()
    message!: string;
}

@WebsocketController()
export class SendingWebsocketController {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.WEBSOCKET_SERVICE)
        private readonly websocketService: WebsocketService
    ) {}

    @WebsocketRoute('chat message')
    async receiveChatMessage(
        @WebsocketBody(CreateWebsocketChatMessageDTO)
        message: CreateWebsocketChatMessageDTO,
        @CurrentWebsocketConnection()
        connection: BaseWebsocketConnection
    ): Promise<void> {
        await this.websocketService.sendToAll({
            event: 'chat message',
            message: {
                ok: true,
                data: message,
                senderUserId: connection.userId,
                senderConnectionId: connection.id
            }
        });
    }
}
```

### Handling channels
Channels are created by using a repository with the `WebsocketChannel` entity. See [accessing a data source](./data-source.md#accessing-the-data-source) for more information.

A websocket connection can join or leave them by using the respective methods on the websocket service.
This will also be completely restored when connecting again in the future.

### Deadlines
A handler has a limited time to produce a result, the same way a http route does. `handlerInMs` on the options below sets it for the application, a controller sets it for all of its events, and an event sets its own:

```ts
// src/websocket/chat.websocket-controller.ts
import { WebsocketController, WebsocketRoute } from 'zibri';

@WebsocketController({ eventPrefix: 'chat:', timeoutInMs: 10_000 })
export class ChatWebsocketController {

    // two seconds, because this one answers a keystroke
    @WebsocketRoute('suggest', { timeoutInMs: 2_000 })
    async suggest(): Promise<string[]> {
        return [];
    }

    // as long as it takes
    @WebsocketRoute('export', { timeoutInMs: 'none' })
    async export(): Promise<{ url: string }> {
        return { url: '/files/chat.csv' };
    }
}
```

A handler that runs out of its time is answered on the socket with `ok: false` and status `504`, and its `signal` on the [request context](./request-context.md) fires. **A client that disconnects fires it too**: a message still being handled for a socket that has closed has nowhere left to be answered, so the work stops rather than finishing for nobody.

The handler itself is not stopped — nothing can stop code that is waiting for something. What the framework tells for you is the same three things a http request covers: the http client, a lease being queued for, and a wait for a thread job. See [deadlines](./creating-endpoints.md#deadlines).

## Configuration
By default, the websocket service accepts all connection attempts. You can override this behaviour by providing the following in your providers array:

```ts
// ...
defineProvider({
    token: ZIBRI_DI_TOKENS.WEBSOCKET_OPTIONS,
    useFactory: () => ({ 
        timeoutInMs: Ms.SECOND * 5,
        handlerInMs: Ms.SECOND * 30,
        isAllowedToConnect: () => false
    })
})
// ...
```

### Running more than one instance

A socket belongs to the instance that accepted it. Sending to a channel therefore reaches only the clients connected to *that* instance — roughly one in N of them — and nothing reports that the rest were missed. It looks like it worked.

Name a data source to carry broadcasts to the other instances:

```ts
defineProvider({
    token: ZIBRI_DI_TOKENS.WEBSOCKET_OPTIONS,
    useFactory: () => ({
        timeoutInMs: Ms.SECOND * 5,
        handlerInMs: Ms.SECOND * 30,
        isAllowedToConnect: () => true,
        adapterDataSource: CacheDbDataSource
    })
})
```

It has to be a data source that can carry messages between instances — one implementing `PubSubDataSourceInterface`, which today means a `ValKeyDataSource`. Startup fails with a message saying so if it cannot, rather than quietly running without one.

Under the hood this builds a socket.io adapter on socket.io's own `ClusterAdapter`, so heartbeats, acknowledgements and cross-instance socket lookups are socket.io's implementation. Zibri only supplies the transport. That base class lives in the optional peer dependency `socket.io-adapter`, which naming an `adapterDataSource` is the declaration for — startup fails without it.

Two limits worth knowing:

- **`sendToChannel` with `expectResponse: true` still only reaches this instance's clients.** Fire-and-forget sends go through socket.io rooms and travel; the request/response form iterates the connections this instance holds. Collecting responses from clients on other instances is not supported.
- **Socket.io's own connection state recovery does not span instances.** The adapter reports no message offsets, so only the instance that held the socket can restore it that way. Zibri recovers the rest itself and does so across instances: missed messages are replayed from the persisted `WebsocketMessage` rows in the shared data source, and an authenticated user is put back into the rooms of the channels they belong to. An anonymous connection has nothing linking it to a channel, so it has to join again.

Left unset, broadcasts stay inside the instance that sent them — correct for exactly one instance, and wrong the moment there are two.

## See also
- [Replication](./replication.md) — everything else that changes once there is more than one instance
- [Data source](./data-source.md) — accessing the data source used by `WebsocketChannel` repositories
- [Request context](./request-context.md) — the connection context available while handling a websocket message
