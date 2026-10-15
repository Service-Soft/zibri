/**
 * What a reconnecting client is sent instead of the messages it missed, when they cannot all be sent.
 */
export type WebsocketReplayIncomplete = {
    /**
     * The seq of the newest message. Reload your state and continue from here.
     */
    seq: number
};