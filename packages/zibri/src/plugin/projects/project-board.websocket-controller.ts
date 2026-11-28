import { Auth } from '../../auth/decorators/auth.decorator';
import { inject } from '../../di/inject.function';
import { CurrentWebsocketConnection } from '../../websocket/decorators/current-websocket-connection.decorator';
import { WebsocketBody } from '../../websocket/decorators/websocket-body.decorator';
import { WebsocketRoute } from '../../websocket/decorators/websocket-route.decorator';
import { type BaseWebsocketConnection } from '../../websocket/models/connection/base-websocket-connection.model';
import { ProjectBoardSubscription } from './models/project-board-subscription.model';
import { ZIBRI_PROJECTS_PLUGIN_DI_TOKENS } from './projects.tokens';
import { type ProjectBoardUpdateServiceInterface } from './services/project-board-update-service.interface';

/**
 * The websocket events subscribing to the live changes of the board of a project and ending a subscription, below the
 * `eventPrefix` of the websocket controller that extends it. A subscribed connection receives every change as a
 * message of `PROJECT_BOARD_WEBSOCKET_EVENT`, for as long as its user sees the project. Each message names the tenant
 * of the project, in `x-tenant-id` of its headers.
 */
// no @WebsocketController of its own, for the reason the http controllers of the plugins have none: the application's
// class extending this one says what the events are prefixed with
export class ProjectBoardWebsocketController {
    private get boardUpdateService(): ProjectBoardUpdateServiceInterface {
        return inject(ZIBRI_PROJECTS_PLUGIN_DI_TOKENS.PROJECT_BOARD_UPDATE_SERVICE);
    }

    /**
     * Subscribes the connection to the live changes of the board of a project its user sees.
     * @param subscription - The project.
     * @param connection - The connection that receives the changes.
     * @returns The project subscribed to.
     */
    @Auth.isLoggedIn()
    @WebsocketRoute('subscribe')
    async subscribe(
        @WebsocketBody(ProjectBoardSubscription)
        subscription: ProjectBoardSubscription,
        @CurrentWebsocketConnection()
        connection: BaseWebsocketConnection
    ): Promise<ProjectBoardSubscription> {
        await this.boardUpdateService.subscribe(connection, subscription.projectId);
        return { projectId: subscription.projectId };
    }

    /**
     * Ends the subscription of the connection to the changes of the board of a project.
     * @param subscription - The project.
     * @param connection - The connection that stops receiving the changes.
     * @returns The project unsubscribed from.
     */
    @Auth.isLoggedIn()
    @WebsocketRoute('unsubscribe')
    async unsubscribe(
        @WebsocketBody(ProjectBoardSubscription)
        subscription: ProjectBoardSubscription,
        @CurrentWebsocketConnection()
        connection: BaseWebsocketConnection
    ): Promise<ProjectBoardSubscription> {
        await this.boardUpdateService.unsubscribe(connection, subscription.projectId);
        return { projectId: subscription.projectId };
    }
}