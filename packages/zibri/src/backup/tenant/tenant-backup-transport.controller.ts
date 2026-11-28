import { type ZibriApplication } from '../../application/application';
import { Auth } from '../../auth/decorators/auth.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { ForbiddenError } from '../../error-handling/errors/forbidden.error';
import { InternalError } from '../../error-handling/internal-error.model';
import { type OnAppInit } from '../../global/on-app-init.interface';
import { HttpStatus } from '../../http/http-status.enum';
import { $ts } from '../../localization/translate.function';
import { Response } from '../../open-api/decorators/response.decorator';
import { Body } from '../../routing/decorators/body.decorator';
import { Delete } from '../../routing/decorators/delete.decorator';
import { Get } from '../../routing/decorators/get.decorator';
import { Param } from '../../routing/decorators/param.decorator';
import { Patch } from '../../routing/decorators/patch.decorator';
import { Post } from '../../routing/decorators/post.decorator';
import { validateEntitiesRegistered } from '../../utilities/validate-entities-registered.function';
import { type BackupServiceInterface } from '../backup-service.interface';
import { NewTenantBackupTransport } from './new-tenant-backup-transport.model';
import { OfferedTenantBackupTransportKind } from './offered-tenant-backup-transport-kind.model';
import { TenantBackupTransportChange } from './tenant-backup-transport-change.model';
import { TenantBackupTransport } from './tenant-backup-transport.model';
import { ZibriBackupTransportPermissions } from './zibri-backup-transport-permissions.model';

/**
 * The methods of the backup service the routes call, which a backup service of an application implements from 4.0 on.
 */
type TenantTransportMethods = Required<Pick<
    BackupServiceInterface,
    'findTenantBackupTransports' | 'createTenantBackupTransport' | 'updateTenantBackupTransport' | 'deleteTenantBackupTransport'
>>;

/**
 * The routes of the transports the tenant of the request keeps its backups on, of every kind
 * `BACKUP_TENANT_TRANSPORT_OPTIONS` lists, below the path of the controller that extends it: listing them and the kinds
 * the tenant may add, adding one once a small object was written to it and deleted, changing one, and deleting one no
 * backup is stored on. A secret is taken, and never answered. Listing is behind `backup-transports.read`, everything
 * else behind `backup-transports.manage`.
 */
// no @Controller of its own, for the reason MailingListController has none: the application's class extending this
// one says where the routes are. Every decorator is on a route rather than the class, which the application's class
// would not inherit
export class TenantBackupTransportController implements OnAppInit {
    // eslint-disable-next-line jsdoc/require-jsdoc
    onAppInit(app: ZibriApplication): void {
        validateEntitiesRegistered(TenantBackupTransportController.name, app, TenantBackupTransport);
        // at boot rather than per request: the methods are optional until 4.0, and a backup service of the
        // application without them would answer every route with a 500
        this.resolveTenantTransportMethods();
    }

    @Auth.hasPermission(ZibriBackupTransportPermissions.BACKUP_TRANSPORTS_READ)
    @Response.array(TenantBackupTransport)
    @Get('/')
    async findTransports(): Promise<TenantBackupTransport[]> {
        return await this.resolveTenantTransportMethods().findTenantBackupTransports(this.resolveTenantId());
    }

    @Auth.hasPermission(ZibriBackupTransportPermissions.BACKUP_TRANSPORTS_READ)
    @Response.array(OfferedTenantBackupTransportKind)
    @Get('/kinds')
    findKinds(): OfferedTenantBackupTransportKind[] {
        return inject(ZIBRI_DI_TOKENS.BACKUP_TENANT_TRANSPORT_OPTIONS).kinds.map(kind => ({ name: kind.name }));
    }

    @Auth.hasPermission(ZibriBackupTransportPermissions.BACKUP_TRANSPORTS_MANAGE)
    @Response.error(HttpStatus.BAD_REQUEST)
    @Response.error(HttpStatus.CONFLICT)
    @Response.object(TenantBackupTransport)
    @Post('/')
    async createTransport(
        @Body(NewTenantBackupTransport)
        transport: NewTenantBackupTransport
    ): Promise<TenantBackupTransport> {
        return await this.resolveTenantTransportMethods().createTenantBackupTransport(this.resolveTenantId(), {
            name: transport.name,
            kind: transport.kind,
            settings: transport.settings,
            secret: transport.secret
        });
    }

    @Auth.hasPermission(ZibriBackupTransportPermissions.BACKUP_TRANSPORTS_MANAGE)
    @Response.error(HttpStatus.BAD_REQUEST)
    @Response.error(HttpStatus.NOT_FOUND)
    @Response.error(HttpStatus.CONFLICT)
    @Response.object(TenantBackupTransport)
    @Patch('/:transportId')
    async updateTransport(
        @Param.path('transportId', { type: 'string', format: 'uuid' })
        transportId: string,
        @Body(TenantBackupTransportChange)
        change: TenantBackupTransportChange
    ): Promise<TenantBackupTransport> {
        return await this.resolveTenantTransportMethods().updateTenantBackupTransport(this.resolveTenantId(), transportId, {
            ...change.name === undefined ? {} : { name: change.name },
            ...change.settings === undefined ? {} : { settings: change.settings },
            ...change.secret === undefined ? {} : { secret: change.secret }
        });
    }

    @Auth.hasPermission(ZibriBackupTransportPermissions.BACKUP_TRANSPORTS_MANAGE)
    @Response.error(HttpStatus.NOT_FOUND)
    @Response.error(HttpStatus.CONFLICT)
    @Response.empty()
    @Delete('/:transportId')
    async deleteTransport(
        @Param.path('transportId', { type: 'string', format: 'uuid' })
        transportId: string
    ): Promise<void> {
        await this.resolveTenantTransportMethods().deleteTenantBackupTransport(this.resolveTenantId(), transportId);
    }

    /**
     * Resolves the methods of the backup service the routes call, bound to it.
     * @returns The methods.
     * @throws {InternalError} When the backup service of the application lacks one of them.
     */
    // read when used rather than injected, for the reason MailingListController reads its repository so
    private resolveTenantTransportMethods(): TenantTransportMethods {
        const service: BackupServiceInterface = inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE);
        const { findTenantBackupTransports, createTenantBackupTransport, updateTenantBackupTransport, deleteTenantBackupTransport } = service;
        if (
            findTenantBackupTransports == undefined
            || createTenantBackupTransport == undefined
            || updateTenantBackupTransport == undefined
            || deleteTenantBackupTransport == undefined
        ) {
            throw new InternalError(
                `${TenantBackupTransportController.name} needs a backup service with findTenantBackupTransports, `
                + 'createTenantBackupTransport, updateTenantBackupTransport and deleteTenantBackupTransport.'
            );
        }
        return {
            findTenantBackupTransports: findTenantBackupTransports.bind(service),
            createTenantBackupTransport: createTenantBackupTransport.bind(service),
            updateTenantBackupTransport: updateTenantBackupTransport.bind(service),
            deleteTenantBackupTransport: deleteTenantBackupTransport.bind(service)
        };
    }

    /**
     * Resolves the tenant of the request, whose transports the routes reach.
     * @returns The id of the tenant.
     * @throws {ForbiddenError} For a request naming no tenant.
     */
    private resolveTenantId(): string {
        // the permissions are of a tenant, which a caller acting in none holds of no tenant
        const tenantId: string | undefined = inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).getActiveTenantId();
        if (tenantId == undefined) {
            throw new ForbiddenError($ts`You do not have permission to access this route.`);
        }
        return tenantId;
    }
}
