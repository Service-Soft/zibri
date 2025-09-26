import { WebsocketMessage } from './websocket-message.model';

/**
 * A handler for processing websocket responses. Is sent by the client.
 */
export type WebsocketResponseHandler = (res: WebsocketMessage) => void | Promise<void>;