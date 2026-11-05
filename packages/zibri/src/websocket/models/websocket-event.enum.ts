
/**
 * Known websocket events.
 */
export enum WebsocketEvent {
    RESPONSE = 'ws:response',
    REPLAY_INCOMPLETE = 'ws:replay-incomplete',
    DISCONNECT = 'disconnect'
}

/**
 * Type for a websocket event.
 */
export type LooseWebsocketEvent = WebsocketEvent | (string & {});