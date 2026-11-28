import { SentWebsocketMessage } from './sent-websocket-message.model';

/**
 * A handler for processing websocket responses. Is sent by the client.
 *
 * It is handed the message as it is sent, which carries no `seq` when it is sent with `persist: false`.
 */
// the type of a method rather than of a function, which is checked bivariantly: a handler of 3.2, declared to
// take a WebsocketMessage with its required seq, still compiles.
// TODO 4.0: (res: SentWebsocketMessage) => void | Promise<void>
export type WebsocketResponseHandler = {
    // eslint-disable-next-line typescript/method-signature-style
    handle(res: SentWebsocketMessage): void | Promise<void>
}['handle'];