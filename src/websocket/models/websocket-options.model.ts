import { BaseUser } from '../../auth/models/base-user.model';

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
     * Whether or not the provided user is allowed to connect to a websocket at all.
     */
    isAllowedToConnect: <T extends BaseUser<string>>(user: T | undefined) => boolean | Promise<boolean>
};