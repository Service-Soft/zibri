import { BaseUser } from '../../auth/models/base-user.model.ts';
import { DataSourceInterface } from '../../data-source/data-sources/data-source.interface.ts';
import { HandlerTimeout } from '../../http/handler-timeout.type.ts';
import { Newable } from '../../types/newable.type.ts';
import { OmitStrict } from '../../types/omit-strict.type.ts';

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
    handlerInMs: HandlerTimeout,
    /**
     * The data source that carries broadcasts between instances.
     *
     * A socket belongs to the instance that accepted it, so `sendToChannel` reaches only the
     * clients connected to *that* instance - roughly one in N of them, with nothing to report that
     * the rest were missed. Naming a data source here makes broadcasts travel to the others through
     * it.
     *
     * Has to be a data source that can carry messages between instances, which today means a
     * ValKeyDataSource - see PubSubDataSourceInterface. Startup fails with a message saying so if it
     * cannot.
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
    isAllowedToConnect: <T extends BaseUser<string>>(user: T | undefined) => boolean | Promise<boolean>,
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
    maxReplayedMessages: number
};

/**
 * What an application with websockets provides: how long its messages are kept, and whichever of the
 * other options it sets.
 */
export type WebsocketOptionsInput = Pick<WebsocketOptions, 'messageRetentionInMs'>
    & Partial<OmitStrict<WebsocketOptions, 'messageRetentionInMs'>>;