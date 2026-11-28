/**
 * The board to receive the changes of over the websocket, as the `subscribe` and `unsubscribe` events of the
 * `ProjectBoardWebsocketController` take it, and answer it.
 */
export type ProjectBoardSubscriptionModel = {
    /**
     * The id of the project.
     */
    projectId: string
};
