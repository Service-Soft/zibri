import { ZibriApplication } from '../../application';
import { Newable } from '../../types/newable.type';
import { OmitStrict } from '../../types/omit-strict.type';
import { BaseWebsocketConnection } from '../models/connection/base-websocket-connection.model';
import { LooseWebsocketEvent } from '../models/websocket-event.enum';
import { CreateWebsocketMessageData } from '../models/websocket-message.model';
import { WebsocketRequestWithConnection } from '../models/websocket-request.model';
import { WebsocketResponseHandler } from '../models/websocket-response.model';

/**
 * The message data for sending a websocket success message.
 */
export type WebsocketSendDataSuccessMessage = OmitStrict<
    CreateWebsocketMessageData, 'event' | 'recipientType' | 'recipientId' | 'error' | 'data' | 'status'
>
& Required<Pick<CreateWebsocketMessageData, 'data'>>
& Partial<Pick<CreateWebsocketMessageData, 'status'>>
& {
    /**
     * Whether or not the send message was a success.
     */
    ok: true
};

/**
 * The message data for sending a websocket error message.
 */
export type WebsocketSendDataErrorMessage = OmitStrict<
    CreateWebsocketMessageData, 'event' | 'recipientType' | 'recipientId' | 'error' | 'data'
>
& Required<Pick<CreateWebsocketMessageData, 'error'>>
& {
    /**
     * Whether or not the send message was a success.
     */
    ok: false
};

/**
 * The message data for sending a websocket message.
 */
export type WebsocketSendDataMessage = WebsocketSendDataSuccessMessage | WebsocketSendDataErrorMessage;

/**
 * Input for sending websocket data.
 */
export type WebsocketSendData<Connection extends BaseWebsocketConnection, B extends boolean> = {
    /**
     * The connection to send to.
     */
    connection: Connection,
    /**
     * The event to send to.
     */
    event: LooseWebsocketEvent,
    /**
     * The actual message to sent.
     */
    message: WebsocketSendDataMessage,
    /**
     * Whether or not a response is expected.
     */
    expectResponse?: B,
    /**
     * An optional handler for the response, if the implementation supports that.
     * If not set and a response is expected, it gets emitted the default way.
     */
    responseHandler?: WebsocketResponseHandler,
    /**
     * Whether or not the message should be persisted in the data source.
     */
    persist?: boolean
};

/**
 * Input for sending to all connections.
 */
export type WebsocketSendToAllData<B extends boolean> = OmitStrict<WebsocketSendData<never, B>, 'connection'>;

/**
 * Input for sending to a channel.
 */
export type WebsocketSendToChannelData<B extends boolean> = OmitStrict<WebsocketSendData<never, B>, 'connection'> & {
    /**
     * The id of the channel to send to.
     */
    channelId: string
};

/**
 * The result of sending to a single connection.
 */
export type WebsocketSendResult<
    B extends boolean,
    Connection extends BaseWebsocketConnection
> = (B extends false ? void : WebsocketRequestWithConnection<Connection>)
    | Promise<B extends false ? void : WebsocketRequestWithConnection<Connection>>;

/**
 * The result of sending to multiple connections.
 */
export type WebsocketSendToMultipleResult<
    B extends boolean,
    Connection extends BaseWebsocketConnection
> = (B extends false ? void : WebsocketRequestWithConnection<Connection>[])
    | Promise<B extends false ? void : WebsocketRequestWithConnection<Connection>[]>;

/**
 * A service for handling websockets.
 */
export interface WebsocketServiceInterface<Connection extends BaseWebsocketConnection> {
    /**
     * Attaches the service to the application.
     */
    attachTo: (app: ZibriApplication) => void | Promise<void>,
    /**
     * Registers a websocket controller that listens to events.
     */
    registerController: (controllerClass: Newable<unknown>) => void | Promise<void>,
    /**
     * Sends a message to a single connection.
     */
    send: <B extends boolean>(data: WebsocketSendData<Connection, B>) => WebsocketSendResult<B, Connection>,
    /**
     * Sends a message to a single channel.
     */
    sendToChannel: <B extends boolean>(data: WebsocketSendToChannelData<B>) => WebsocketSendToMultipleResult<B, Connection>,
    /**
     * Sends a message to all connections.
     */
    sendToAll: <B extends boolean>(data: WebsocketSendToAllData<B>) => WebsocketSendToMultipleResult<B, Connection>,
    /**
     * Disconnects the given connection.
     */
    disconnect: (connection: Connection) => void | Promise<void>,
    /**
     * Adds the given connection to the channel with the given id.
     */
    joinChannel: (connection: Connection, channelId: string) => void | Promise<void>,
    /**
     * Removes the given connection from the channel with the given id.
     */
    leaveChannel: (connection: Connection, channelId: string) => void | Promise<void>,
    /**
     * Finds the websocket connection with the given id.
     */
    findConnectionById: (id: string) => Connection | Promise<Connection>,
    /**
     * Finds the websocket connection with the given user id.
     */
    findConnectionByUserId: (userId: string) => Connection | Promise<Connection>,
    /**
     * Gets all currently active connections.
     */
    getConnections: () => Connection[] | Promise<Connection[]>
}