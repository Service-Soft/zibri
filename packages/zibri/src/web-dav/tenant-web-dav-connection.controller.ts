import { type ZibriApplication } from '../application/application';
import { Auth } from '../auth/decorators/auth.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { type OnAppInit } from '../global/on-app-init.interface';
import { HttpStatus } from '../http/http-status.enum';
import { Response } from '../open-api/decorators/response.decorator';
import { Body } from '../routing/decorators/body.decorator';
import { Delete } from '../routing/decorators/delete.decorator';
import { Get } from '../routing/decorators/get.decorator';
import { Param } from '../routing/decorators/param.decorator';
import { Patch } from '../routing/decorators/patch.decorator';
import { Post } from '../routing/decorators/post.decorator';
import { validateEntitiesRegistered } from '../utilities/validate-entities-registered.function';
import { NewTenantWebDavConnection } from './new-tenant-web-dav-connection.model';
import { TenantWebDavConnectionChange } from './tenant-web-dav-connection-change.model';
import { type TenantWebDavConnectionServiceInterface } from './tenant-web-dav-connection-service.interface';
import { TenantWebDavConnection } from './tenant-web-dav-connection.model';
import { ZibriWebDavPermissions } from './zibri-web-dav-permissions.model';

/**
 * The routes of the connections of the tenant of the request to WebDAV servers, below the path of the controller that
 * extends it: listing them, adding one once a request to its folder succeeds, changing one, and deleting one nothing
 * uses. A password is taken, and never answered. Listing is behind `web-dav-connections.read`, everything else behind
 * `web-dav-connections.manage`.
 */
// no @Controller of its own, for the reason MailingListController has none: the application's class extending this
// one says where the routes are. Every decorator is on a route rather than the class, which the application's class
// would not inherit
export class TenantWebDavConnectionController implements OnAppInit {
    // read when used rather than injected, for the reason MailingListController reads its repository so
    private get connectionService(): TenantWebDavConnectionServiceInterface {
        return inject(ZIBRI_DI_TOKENS.TENANT_WEB_DAV_CONNECTION_SERVICE);
    }

    onAppInit(app: ZibriApplication): void {
        validateEntitiesRegistered(TenantWebDavConnectionController.name, app, TenantWebDavConnection);
    }

    @Auth.hasPermission(ZibriWebDavPermissions.WEB_DAV_CONNECTIONS_READ)
    @Response.array(TenantWebDavConnection)
    @Get('/')
    async findConnections(): Promise<TenantWebDavConnection[]> {
        return await this.connectionService.findConnections();
    }

    @Auth.hasPermission(ZibriWebDavPermissions.WEB_DAV_CONNECTIONS_MANAGE)
    @Response.error(HttpStatus.BAD_REQUEST)
    @Response.error(HttpStatus.CONFLICT)
    @Response.object(TenantWebDavConnection)
    @Post('/')
    async createConnection(
        @Body(NewTenantWebDavConnection)
        connection: NewTenantWebDavConnection
    ): Promise<TenantWebDavConnection> {
        return await this.connectionService.createConnection(connection);
    }

    @Auth.hasPermission(ZibriWebDavPermissions.WEB_DAV_CONNECTIONS_MANAGE)
    @Response.error(HttpStatus.BAD_REQUEST)
    @Response.error(HttpStatus.NOT_FOUND)
    @Response.error(HttpStatus.CONFLICT)
    @Response.object(TenantWebDavConnection)
    @Patch('/:connectionId')
    async updateConnection(
        @Param.path('connectionId', { type: 'string', format: 'uuid' })
        connectionId: string,
        @Body(TenantWebDavConnectionChange)
        change: TenantWebDavConnectionChange
    ): Promise<TenantWebDavConnection> {
        return await this.connectionService.updateConnection(connectionId, change);
    }

    @Auth.hasPermission(ZibriWebDavPermissions.WEB_DAV_CONNECTIONS_MANAGE)
    @Response.error(HttpStatus.NOT_FOUND)
    @Response.error(HttpStatus.CONFLICT)
    @Response.empty()
    @Delete('/:connectionId')
    async deleteConnection(
        @Param.path('connectionId', { type: 'string', format: 'uuid' })
        connectionId: string
    ): Promise<void> {
        await this.connectionService.deleteConnection(connectionId);
    }
}