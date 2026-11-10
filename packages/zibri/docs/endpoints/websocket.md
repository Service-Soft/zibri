---
keywords: [websockets, ws, socket, realtime, real time, live updates, push]
---

# Websocket
A websocket keeps a connection open between a client and your application, so either side can send a message at any time. You handle incoming messages in a websocket controller, the way you handle HTTP requests in a controller. A client that reconnects is sent the messages it missed.

A websocket server is started for an application that declares websockets: one that registers at least one websocket controller, or whose `ZIBRI_DI_TOKENS.WEBSOCKET_OPTIONS_INPUT` names an `adapterDataSource` or sets `startServer: 'always'`. The last is for a server that only pushes, broadcasting to clients without handling any inbound event. An application that declares websockets provides `WEBSOCKET_OPTIONS_INPUT`, see [configuring websockets](#configuring-websockets).

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `WebsocketController` | decorator | Registers a class as a websocket controller |
| `WebsocketControllerInputData` | type | The options of `@WebsocketController`: an event prefix, the supported versions and a handler timeout |
| `WebsocketRoute` | decorator | Registers a method to handle an incoming websocket event |
| `WebsocketRouteOptions` | type | The supported versions and the handler timeout of one `@WebsocketRoute` |
| `WebsocketEvent`, `LooseWebsocketEvent` | enum, type | The built-in events (an answer, an incomplete replay, a disconnect), and any event name |
| `WebsocketBody` | decorator | Parses/validates the body of an incoming websocket message, `WebsocketBody.oneOf` for a body of [several shapes](./creating-endpoints.md#a-body-of-several-shapes) |
| `WebsocketBodyMetadataInput`, `OneOfWebsocketBodyMetadataInput` | type, type | The options of `@WebsocketBody` and of `WebsocketBody.oneOf` |
| `CurrentWebsocketConnection` | decorator | Injects the connection that sent the current message |
| `BaseWebsocketConnection` | type | The connection object passed to route handlers |
| `SocketIOWebsocketConnection` | class | The connection `WebsocketService` passes to route handlers |
| `WebsocketServiceInterface` | interface | Contract for sending messages, joining and leaving channels and finding connections. Replaceable through ZIBRI_DI_TOKENS.WEBSOCKET_SERVICE |
| `WebsocketService` | class | Sends messages to a connection, all connections, or a channel |
| `WebsocketSendData`, `WebsocketSendToAllData`, `WebsocketSendToChannelData` | type, type, type | What `send`, `sendToAll` and `sendToChannel` take: the event, the message, and whether an answer is expected |
| `WebsocketSendDataMessage`, `WebsocketSendDataSuccessMessage`, `WebsocketSendDataErrorMessage` | type, type, type | The message sent: its `data` when `ok` is `true`, its `error` when `ok` is `false` |
| `WebsocketSendResult`, `WebsocketSendToMultipleResult` | type, type | What sending returns when an answer is expected: the answer of one connection, or the answers of all of them |
| `WebsocketRequestWithConnection` | type | What a connection answered, with that connection |
| `WebsocketResponseHandler` | type | Handles the answer to a message, passed as `responseHandler` |
| `WebsocketChannel` | entity | Entity used to create and join/leave channels |
| `WebsocketMessage` | entity | A sent message, kept to replay what a reconnecting client missed |
| `WebsocketRecipientType` | enum | Whom a message was sent to: all connections, a user or a channel |
| `WebsocketMessageSequence` | entity | The seq the last message was given |
| `WebsocketMessageCleanupCronJob` | cron job | Deletes the messages older than `messageRetentionInMs` |
| `WebsocketReplayIncomplete` | type | What a reconnecting client is sent instead of the messages it missed, when they cannot all be sent |
| `WebsocketAnswer` | type | What one connection answered to a message sent to several, see [waiting for answers](#waiting-for-answers) |
| `ZIBRI_DI_TOKENS.WEBSOCKET_SERVICE` | DI token | Injects `WebsocketService` |
| `ZIBRI_DI_TOKENS.WEBSOCKET_OPTIONS_INPUT` | DI token | The websocket options your application sets, `messageRetentionInMs` among them |
| `ZIBRI_DI_TOKENS.WEBSOCKET_OPTIONS` | DI token | The websocket options in effect, built from `WEBSOCKET_OPTIONS_INPUT` |
| `WebsocketOptions`, `WebsocketOptionsInput` | type, type | The websocket options in effect, and the ones your application sets |

## Configuring websockets
An application with websockets sets how long its messages are kept. Everything else has a default: every connection attempt is accepted, a client has 5 seconds to answer, a handler has 30 seconds, and a reconnecting client is sent at most 1000 messages.

```ts
// src/providers.ts
import { defineProvider, Ms, ZIBRI_DI_TOKENS } from 'zibri';

defineProvider({
    token: ZIBRI_DI_TOKENS.WEBSOCKET_OPTIONS_INPUT,
    useFactory: () => ({
        messageRetentionInMs: Ms.DAY,
        isAllowedToConnect: user => user != undefined
    })
})
```

`isAllowedToConnect` receives the `CurrentUser` of the handshake, `undefined` for an anonymous one.

| Option | What it is |
|---|---|
| `path` | The path clients connect to. A client names the same one as its `path` option. `/socket.io` by default |
| `maxMessageSize` | The most one message from a client may weigh. A client sending a larger one is disconnected. One megabyte by default |
| `pingIntervalInMs` | How often the server checks that a connection is still alive. 25 seconds by default |
| `pingTimeoutInMs` | How long a client has to answer that check before its connection is closed. 20 seconds by default |

An application whose clients only listen registers no websocket controller, so it starts the server itself:

```ts
// src/providers.ts
import { defineProvider, Ms, ZIBRI_DI_TOKENS } from 'zibri';

defineProvider({
    token: ZIBRI_DI_TOKENS.WEBSOCKET_OPTIONS_INPUT,
    useValue: {
        messageRetentionInMs: Ms.DAY,
        startServer: 'always'
    }
})
```

## Receiving messages
To handle incoming websocket messages, create a websocket controller. Its body is a model:

```ts
// src/models/chat-message.model.ts
import { Property } from 'zibri';

export class ChatMessage {
    @Property.string()
    text!: string;
}
```

```ts
// src/controllers/chat-message.websocket-controller.ts
import { BaseWebsocketConnection, CurrentWebsocketConnection, WebsocketBody, WebsocketController, WebsocketRoute } from 'zibri';

import { ChatMessage } from '../models/chat-message.model';

@WebsocketController()
export class ChatMessageWebsocketController {

    @WebsocketRoute('chat message')
    async receiveChatMessage(
        @WebsocketBody(ChatMessage)
        message: ChatMessage,
        @CurrentWebsocketConnection()
        connection: BaseWebsocketConnection
    ): Promise<void> {
        // ...
    }
}
```

A websocket controller works like an HTTP controller, with the same parsing and validation.

A websocket body is JSON, or [XML](./xml.md#receiving-an-xml-body) with `type: MimeType.XML`. Its size is bounded by `maxSize`, 100kb by default:

```ts
// src/controllers/limited.websocket-controller.ts
import { WebsocketBody, WebsocketController, WebsocketRoute } from 'zibri';

import { ChatMessage } from '../models/chat-message.model';

@WebsocketController()
export class LimitedWebsocketController {
    @WebsocketRoute('short message')
    async receiveShortMessage(@WebsocketBody(ChatMessage, { maxSize: '10kb' }) message: ChatMessage): Promise<void> {
        // ...
    }
}
```

## Limiting the size of a message
A message weighs at most `maxMessageSize`, one megabyte by default. A message for an event with a body weighs at most what the body allows: `maxSize` of `@WebsocketBody`, or `maxBodySizes` of `ZIBRI_DI_TOKENS.HTTP_SERVER_LIMITS` for its kind when the body names none, see [how long a request may take](../application/application-lifecycle.md#how-long-a-request-may-take). The whole message counts: the body, the query and the headers, and the buffers it carries. An event with several [versions](./versioning.md) allows what the largest of their bodies does.

```ts
// src/controllers/chat.websocket-controller.ts
import { WebsocketBody, WebsocketController, WebsocketRoute } from 'zibri';

import { ChatMessage } from '../models/chat-message.model';

@WebsocketController({ eventPrefix: 'chat:' })
export class ChatSizeController {
    @WebsocketRoute('send')
    send(@WebsocketBody(ChatMessage, { maxSize: '4kb' }) message: ChatMessage): ChatMessage {
        return message;
    }
}
```

A larger message is refused by its length before it is read, and the connection is closed with code `1009`, over long polling with `413`. A message that is not an event, such as an acknowledgement, weighs at most `maxMessageSize`.

## Sending messages
Send messages with the websocket service. It sends:
- to a specific connection
- to all connections
- to a channel

```ts
// src/controllers/sending.websocket-controller.ts
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

A message arrives as JSON, however it is sent and whichever instance sends it: a bigint arrives as its digits, a date as its ISO string, and a buffer as `{ type: 'Buffer', data }`.

### Waiting for answers
With `expectResponse: true`, `sendToChannel` and `sendToAll` wait for every connection they reach to answer, on every instance, and return one `WebsocketAnswer` per connection: what it answered as `request`, its `connectionId` and its `userId`. A connection that does not answer within `timeoutInMs` is listed too, with `request.body` holding `{ error }`, the error as a `LoggedError`.

```ts
// src/services/presence.service.ts
import { Inject, Injectable, WebsocketAnswer, WebsocketService, ZIBRI_DI_TOKENS } from 'zibri';

@Injectable()
export class PresenceService {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.WEBSOCKET_SERVICE)
        private readonly websocketService: WebsocketService
    ) {}

    async findPresentUserIds(channelId: string): Promise<(string | undefined)[]> {
        const answers: WebsocketAnswer[] = await this.websocketService.sendToChannel({
            channelId,
            event: 'are you there',
            message: { ok: true, data: {}, senderUserId: undefined, senderConnectionId: undefined },
            expectResponse: true
        });
        return answers.map(a => a.userId);
    }
}
```

`findConnectionById` finds the connection of an answer on the instance that holds it.

## Handling channels
Create channels with a repository of the `WebsocketChannel` entity, see [accessing a data source](../data/data-source.md#accessing-the-data-source).

A connection joins or leaves a channel through the methods of the websocket service. When a logged
in user connects again, the connection is put back into the channels of that user.

## Reconnecting
Every stored message has a `seq`, one higher than the message before it. Keep the `seq` of the last message your client received, and send it as `offset` when it connects. `auth` is a function, so every reconnect sends the `seq` the client has reached:

```ts
// src/chat.ts, in the browser
import { io } from 'socket.io-client';
import type { WebsocketMessage } from 'zibri';

let lastSeq: number | undefined;

const socket = io('https://api.example.com', { auth: callback => callback(lastSeq == undefined ? {} : { offset: lastSeq }) });
socket.on('chat message', (message: WebsocketMessage) => {
    lastSeq = message.seq;
});
```

A connecting client is sent every message after its `offset` that it would have received, oldest first. `offset: 0` asks for everything that is kept. A client that sends no `offset` is sent nothing it missed, and receives what is sent from then on. An `offset` that is not a whole number of at least 0 refuses the connection with a 400.

A message is kept for `messageRetentionInMs`. A client that missed more than `maxReplayedMessages`, or missed a message older than `messageRetentionInMs`, is sent none of them. It is sent one `ws:replay-incomplete` instead, whose `data` is a `WebsocketReplayIncomplete`: reload your state, and continue from its `seq`.

A message sent with `persist: false` is not stored, and is not sent again.

## Tenants
A channel belongs to the [tenant](../data/tenancy.md#work-outside-a-request) it was created in, and its
name is unique within that tenant. A channel created outside every tenant is joined and left from
inside any of them. A message belongs to the tenant it was sent in.

`sendToAll` inside a tenant reaches the connections of that tenant's members. Outside every tenant it
reaches every connection. A connection follows the [memberships](../glossary.md#membership) of its user: it receives a tenant's
broadcasts and the messages of the tenant's channels its user is in once a membership in that tenant
is stored, and stops receiving them once it is deleted or deactivated. The user stays in those
channels, and receives them again once they are a member again.

A reconnecting client is sent what it missed in the tenants its user is a member of, and what was
sent outside every tenant.

## Logins
A connection receives as the user its handshake's credential resolves to, for as long as a request
with that credential would be accepted. It is closed when its login ends: a logout, ended logins, a
deactivated user, a revoked token or [API key](../glossary.md#api-key), or a session its provider ended. It is closed when the
credential expires, too. The other logins of the same user stay connected.

A login ends however its rows are written: a refresh token your code deletes through its repository
closes the connections of its login as a logout does, see [writing a strategy of your own](../auth/auth.md#writing-a-strategy-of-your-own).

An access token that works until it expires keeps its connection until then as well, see
[when access tokens stop working](../auth/authorization-server.md#when-access-tokens-stop-working).

## Deadlines
A handler has a limited time to produce a result, as an HTTP route does. `handlerTimeoutInMs` in the [options](#configuring-websockets) sets it for the application, 30 seconds by default. A controller sets it for all of its events, and an event sets its own. Below, `suggest` answers a keystroke and gets two seconds, and `export` takes as long as it needs:

```ts
// src/controllers/chat.websocket-controller.ts
import { WebsocketController, WebsocketRoute } from 'zibri';

@WebsocketController({ eventPrefix: 'chat:', timeoutInMs: 10_000 })
export class ChatWebsocketController {

    @WebsocketRoute('suggest', { timeoutInMs: 2_000 })
    async suggest(): Promise<string[]> {
        return [];
    }

    @WebsocketRoute('export', { timeoutInMs: 'none' })
    async export(): Promise<{ url: string }> {
        return { url: '/files/chat.csv' };
    }
}
```

A handler that runs out of its time is answered on the socket with `ok: false` and status `504`, and its `signal` on the [request context](../application/request-context.md) fires. The `signal` also fires when the client disconnects.

The handler itself runs on until it returns. The `signal` ends the same three waits it ends for an HTTP request: a call of the HTTP client, waiting for a [lease](../glossary.md#lease), and waiting for a thread job. See [deadlines](./creating-endpoints.md#deadlines).

## Running more than one instance

> [!WARNING]
> A socket belongs to the instance that accepted it. Without an `adapterDataSource`, sending to a
> channel or to all connections reaches only the clients connected to the sending instance, and
> nothing reports that the rest were missed.

Name a data source to carry broadcasts to the other instances:

```ts
// src/providers.ts
import { defineProvider, Ms, ZIBRI_DI_TOKENS } from 'zibri';

import { CacheDbDataSource } from './data-sources';

defineProvider({
    token: ZIBRI_DI_TOKENS.WEBSOCKET_OPTIONS_INPUT,
    useFactory: () => ({
        messageRetentionInMs: Ms.DAY,
        adapterDataSource: CacheDbDataSource
    })
})
```

It has to carry messages of any size between instances: a data source implementing `PubSubDataSourceInterface` without a `maxMessageBytes`, such as a `ValKeyDataSource`.

A send [waiting for answers](#waiting-for-answers) collects them from the clients of every instance. It waits `timeoutInMs` and one second more for the other instances, and leaves out the answers of an instance that has not sent them by then.

An instance that loses its connection to the data source connects again and hears the other instances from then on. A broadcast sent while it was reconnecting reaches only the clients of the other instances.

> [!NOTE]
> A reconnecting client is sent what it missed on whichever instance it reconnects to, see
> [reconnecting](#reconnecting). The connection of a logged in user is put back into the channels of
> that user. An anonymous connection that reconnects to a different instance joins its channels
> again.

## Requirements
| Package | Used for |
|---|---|
| `socket.io` | Running the websocket server. You install it |
| `socket.io-adapter` | Carrying broadcasts to the other instances, with an `adapterDataSource`. You install it |
| `socket.io-parser` | Sending every message as JSON. You install it |
| `ws` | Reading the size of a message before the message. You install it |
| `@types/ws` | The types of the server reading the messages |

Your data source declares these entities:

| Entity | Needed when |
|---|---|
| `WebsocketChannel`, `WebsocketMessage`, `WebsocketMessageSequence` | The application declares websockets |

How large each table grows, and what deletes its rows, is in [framework tables](../data/framework-tables.md).

## See also
- [The AsyncAPI document](./async-api.md) — the events of each version, as a client generator and the explorer read them
- [Replication](../data/replication.md) — everything else that changes once there is more than one instance
- [Data source](../data/data-source.md) — accessing the data source used by `WebsocketChannel` repositories
- [Request context](../application/request-context.md) — the connection context available while handling a websocket message
