import { type CurrentUser } from '../../auth/decorators/current-user.decorator';
import { DataSourceInterface } from '../../data-source/data-sources/data-source.interface';
import { FileSize } from '../../entity/models/file-property-metadata.model';
import { HandlerTimeout } from '../../http/handler-timeout.type';
import { Route } from '../../routing/controller-route-configuration.model';
import { Newable } from '../../types/newable.type';
import { OmitStrict } from '../../types/omit-strict.type';

/**
 * Options regarding websockets.
 */
export type WebsocketOptions = {
    /**
     * The timeout to be used when a message should trigger a response.
     * @default 5000
     */
    timeoutInMs: number,
    /**
     * How long a handler has to produce a result, for every event that does not say otherwise.
     *
     * The one above bounds a client answering this server; this one bounds your own code. An event
     * declares its own with `timeoutInMs`, and `'none'` - here or on an event - means the handler is
     * given as long as it needs.
     * @default 30000
     */
    handlerTimeoutInMs: HandlerTimeout,
    /**
     * When the websocket server is started.
     *
     * `'whenDeclared'` starts it for an application that registers a websocket controller or names
     * an `adapterDataSource`. `'always'` starts it either way, for an application whose clients only
     * listen to what it sends, from its http routes for example.
     * @default 'whenDeclared'
     */
    startServer: 'whenDeclared' | 'always',
    /**
     * The data source that carries broadcasts between instances.
     *
     * A socket belongs to the instance that accepted it, so `sendToChannel` reaches only the
     * clients connected to *that* instance - roughly one in N of them, with nothing to report that
     * the rest were missed. Naming a data source here makes broadcasts travel to the others through
     * it.
     *
     * Has to be a data source that can carry messages between instances: one implementing
     * PubSubDataSourceInterface, such as a ValKeyDataSource. Startup fails with a message saying so
     * if it cannot.
     *
     * Left undefined, broadcasts stay inside the instance that sent them. Correct for exactly one
     * instance, and wrong the moment there are two.
     * @default undefined
     */
    adapterDataSource?: Newable<DataSourceInterface>,
    /**
     * Whether or not the provided user is allowed to connect to a websocket at all.
     * @default () => true
     */
    isAllowedToConnect: (user: CurrentUser | undefined) => boolean | Promise<boolean>,
    /**
     * How long a sent message is kept to be replayed to a client that reconnects. A client that was
     * away for longer is sent a `ws:replay-incomplete` instead.
     */
    messageRetentionInMs: number,
    /**
     * How many missed messages a reconnecting client is sent at most. A client that missed more is
     * sent a `ws:replay-incomplete` instead.
     * @default 1000
     */
    maxReplayedMessages: number,
    /**
     * The path clients connect to, which a client names as its `path` option.
     * @default '/socket.io'
     */
    path: Route,
    /**
     * The most one message from a client may weigh. A client sending a larger one is disconnected.
     * @default '1mb'
     */
    maxMessageSize: FileSize,
    /**
     * How often the server checks that a connection is still alive.
     * @default 25000
     */
    pingIntervalInMs: number,
    /**
     * How long a client has to answer that check before its connection is closed.
     * @default 20000
     */
    pingTimeoutInMs: number
};

/**
 * What an application with websockets provides: how long its messages are kept, and whichever of the
 * other options it sets.
 */
export type WebsocketOptionsInput = Pick<WebsocketOptions, 'messageRetentionInMs'>
    & Partial<OmitStrict<WebsocketOptions, 'messageRetentionInMs'>>;