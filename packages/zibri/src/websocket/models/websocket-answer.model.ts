import { WebsocketRequest } from './websocket-request.model';

/**
 * What one connection answered to a message sent to several, whichever instance holds it.
 */
export type WebsocketAnswer = {
    /**
     * What the connection answered. A connection that did not answer in time is listed too, with a
     * body of `{ error }`, the error as a `LoggedError`.
     */
    request: WebsocketRequest,
    /**
     * The id of the connection, which `findConnectionById` finds on the instance that holds it.
     */
    connectionId: string,
    /**
     * The user of the connection, undefined for an anonymous one.
     */
    userId: string | undefined
};