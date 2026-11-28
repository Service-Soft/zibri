import { type OmitStrict } from '../../types/omit-strict.type';
import { type WebsocketMessage } from './websocket-message.model';

/**
 * A websocket message as a client receives it. A stored message carries the `seq` the client sends back as its
 * `offset` when it connects again. A message sent with `persist: false`, such as the answer to a message of the
 * client, carries none, as it is never sent again.
 */
export type SentWebsocketMessage = OmitStrict<WebsocketMessage, 'seq'> & Partial<Pick<WebsocketMessage, 'seq'>>;