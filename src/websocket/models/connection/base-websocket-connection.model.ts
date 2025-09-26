/**
 * Basic definition of a websocket connection.
 * Your implementation probably needs to extend this.
 */
export type BaseWebsocketConnection = {
    /**
     * The id of the connection.
     */
    readonly id: string,
    /**
     * The id of the user that this connection belongs to.
     */
    readonly userId: string | undefined,
    /**
     * The current offset of the connection.
     * Is used to sync the state of the server with the client after a reconnect.
     */
    offset: number
};