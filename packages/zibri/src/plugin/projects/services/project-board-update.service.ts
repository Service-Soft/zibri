import type { ZibriApplication } from '../../../application/application';
import { Repository } from '../../../data-source/repository/repository';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { Injectable } from '../../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { InternalError } from '../../../error-handling/internal-error.model';
import { OnAppInit } from '../../../global/on-app-init.interface';
import { FilterUtilities } from '../../../routing/filter/filter.utilities';
import { type BaseWebsocketConnection } from '../../../websocket/models/connection/base-websocket-connection.model';
import { WebsocketChannel } from '../../../websocket/models/websocket-channel.model';
import { type WebsocketServiceInterface } from '../../../websocket/services/websocket-service.interface';
import { PROJECT_BOARD_WEBSOCKET_EVENT, type ProjectBoardMessage } from '../models/project-board-message.model';
import { Project } from '../models/project.model';
import { ProjectBoardWebsocketController } from '../project-board.websocket-controller';
import { ZIBRI_PROJECTS_PLUGIN_DI_TOKENS } from '../projects.tokens';
import { type ProjectAccessServiceInterface } from './project-access-service.interface';
import { type ProjectBoardUpdateServiceInterface } from './project-board-update-service.interface';

/**
 * Names the channel of the subscriptions of one user to the board of one project.
 * @param projectId - The project.
 * @param userId - The user.
 * @returns The name of the channel.
 */
function channelNameOf(projectId: string, userId: string): string {
    return `${channelPrefixOf(projectId)}${userId}`;
}

/**
 * Names what the channels of the subscriptions to the board of a project start with.
 * @param projectId - The project.
 * @returns The start of their names.
 */
function channelPrefixOf(projectId: string): string {
    return `zi.projects.board:${projectId}:`;
}

/**
 * Default implementation of the project board update service: a websocket channel per project and user, which a
 * change is sent to once its user is found to still see the project.
 */
// a channel per user rather than one per project: a message sent to a channel reaches every connection in it, on
// every instance, and a connection cannot be left out of it. With one per user, the user who no longer sees the
// project is told nothing more by not being sent to, and their channel is deleted, which ends its replay and its
// rejoining on a reconnect as well. Checked as each change is sent, so a share taken away, a membership ended or a
// project moved below one they do not see all end it with the next change, whichever instance they are connected to
@Injectable({ register: 'onUse' })
export class ProjectBoardUpdateService implements ProjectBoardUpdateServiceInterface, OnAppInit {
    private enabled: boolean = false;

    private get channelRepository(): Repository<WebsocketChannel> {
        return inject(repositoryTokenFor(WebsocketChannel));
    }

    private get projectRepository(): Repository<Project> {
        return inject(repositoryTokenFor(Project));
    }

    private get websocketService(): WebsocketServiceInterface<BaseWebsocketConnection> {
        return inject(ZIBRI_DI_TOKENS.WEBSOCKET_SERVICE);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    get isEnabled(): boolean {
        return this.enabled;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    onAppInit(app: ZibriApplication): void {
        this.enabled = app.options.websocketControllers.some(
            controller => controller === ProjectBoardWebsocketController
                || Object.prototype.isPrototypeOf.call(ProjectBoardWebsocketController, controller)
        );
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async subscribe(connection: BaseWebsocketConnection, projectId: string): Promise<void> {
        // through the scope sharing narrows it by, so a project the caller does not see is answered 404
        const project: Pick<Project, 'id' | 'tenantId'> = await this.projectRepository.findById(
            projectId,
            { select: { id: true, tenantId: true } }
        );
        const userId: string = this.getUserId(connection);
        const name: string = channelNameOf(project.id, userId);
        const channel: WebsocketChannel = await this.channelRepository.upsert(
            { name },
            { tenantId: project.tenantId, name, userIds: [] },
            { name: { set: name } }
        );
        await this.websocketService.joinChannel(connection, channel.id);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async unsubscribe(connection: BaseWebsocketConnection, projectId: string): Promise<void> {
        const channel: WebsocketChannel | undefined = await this.channelRepository.findOne({
            where: { name: channelNameOf(projectId, this.getUserId(connection)) },
            required: false
        });
        if (channel != undefined) {
            await this.websocketService.leaveChannel(connection, channel.id);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async publish(message: ProjectBoardMessage): Promise<void> {
        if (!this.enabled) {
            return;
        }
        try {
            await this.send(message);
        }
        catch (error) {
            // the change it tells of is written: a subscriber that missed it reloads the board once it reconnects
            inject(ZIBRI_DI_TOKENS.LOGGER).warn(
                `Could not send the change of the board of the Project ${message.projectId}: ${String(error)}`
            );
        }
    }

    /**
     * Sends a change of a board to the channel of each user subscribed to it who sees the project, and deletes the
     * channels of the others.
     * @param message - The change.
     */
    private async send(message: ProjectBoardMessage): Promise<void> {
        const channels: WebsocketChannel[] = await this.channelRepository.findAll({
            where: { name: { like: `${FilterUtilities.escapeLike(channelPrefixOf(message.projectId))}%` } },
            limit: 'all'
        });
        const accessService: ProjectAccessServiceInterface = inject(ZIBRI_PROJECTS_PLUGIN_DI_TOKENS.PROJECT_ACCESS_SERVICE);
        const deleted: boolean = message.type === 'project-deleted';
        await Promise.all(channels.map(async channel => {
            const userId: string | undefined = channel.userIds[0];
            // a deleted project is seen by nobody any more: its subscribers are told, and its channels go
            const sees: boolean = !deleted && userId != undefined && await accessService.resolveSeesProject(userId, message.projectId);
            if (sees || (deleted && userId != undefined)) {
                await this.websocketService.sendToChannel({
                    channelId: channel.id,
                    event: PROJECT_BOARD_WEBSOCKET_EVENT,
                    message: { ok: true, data: message, senderUserId: undefined, senderConnectionId: undefined },
                    expectResponse: false,
                    persist: true
                });
            }
            if (!sees) {
                await this.channelRepository.deleteById(channel.id);
            }
        }));
    }

    /**
     * Gets the user of a connection, which a subscription is of.
     * @param connection - The connection.
     * @returns The id of its user.
     * @throws When it has none, which the routes of the controller refuse before.
     */
    private getUserId(connection: BaseWebsocketConnection): string {
        if (connection.userId == undefined) {
            throw new InternalError('A board is subscribed to by a user, and the connection has none.');
        }
        return connection.userId;
    }
}