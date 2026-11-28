import { type BaseWebsocketConnection } from '../../../websocket/models/connection/base-websocket-connection.model';
import { type ProjectBoardMessage } from '../models/project-board-message.model';

/**
 * Interface for the service that pushes the changes of the board of a project to the websocket connections
 * subscribed to it, as far as their users still see the project.
 */
export interface ProjectBoardUpdateServiceInterface {
    /**
     * Whether the application registered a websocket controller extending `ProjectBoardWebsocketController`, without
     * which nothing is pushed.
     */
    readonly isEnabled: boolean,
    /**
     * Subscribes a connection of the caller to the board of a project they see.
     * @param connection - The connection.
     * @param projectId - The id of the project.
     * @throws A NotFoundError for a project the caller does not see.
     */
    subscribe: (connection: BaseWebsocketConnection, projectId: string) => Promise<void>,
    /**
     * Ends the subscription of a connection of the caller to the board of a project.
     * @param connection - The connection.
     * @param projectId - The id of the project.
     */
    unsubscribe: (connection: BaseWebsocketConnection, projectId: string) => Promise<void>,
    /**
     * Sends a change of a board to every connection subscribed to it whose user still sees the project, and ends the
     * subscriptions of the users who no longer do.
     * @param message - The change.
     */
    publish: (message: ProjectBoardMessage) => Promise<void>
}