# Websocket
The way Zibri handles websocket connections is pretty similar to http. It also supports recovering and replaying a prior connection.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `WebsocketController` | decorator | Registers a class as a websocket controller |
| `WebsocketRoute` | decorator | Registers a method to handle an incoming websocket event |
| `WebsocketBody` | decorator | Parses/validates the body of an incoming websocket message |
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
import { WebsocketController, WebsocketBody, WebsocketRoute, Property, BaseWebsocketConnection, CurrentWebsocketConnection } from 'zibri';

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
export class TestWebsocketController {
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

## Configuration
By default, the websocket service accepts all connection attempts. You can override this behaviour by providing the following in your providers array:

```ts
// ...
defineProvider({
    token: ZIBRI_DI_TOKENS.WEBSOCKET_OPTIONS,
    useFactory: () => ({ 
        timeoutInMs: Ms.SECOND * 5,
        isAllowedToConnect: () => false
    })
})
// ...
```

## See also
- [Data source](./data-source.md) — accessing the data source used by `WebsocketChannel` repositories
- [Request context](./request-context.md) — the connection context available while handling a websocket message
