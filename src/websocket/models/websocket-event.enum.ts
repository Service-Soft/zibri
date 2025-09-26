
/**
 * Known websocket events.
 */
export enum WebsocketEvent {
    RESPONSE = 'ws:response',
    DISCONNECT = 'disconnect'
}

/**
 * Type for a websocket event.
 */
export type LooseWebsocketEvent = WebsocketEvent | (string & {});