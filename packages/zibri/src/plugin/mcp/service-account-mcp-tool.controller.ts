import { Auth } from '../../auth/decorators/auth.decorator';
import { type CurrentUser } from '../../auth/decorators/current-user.decorator';
import { type BaseUser } from '../../auth/models/base-user.model';
import { type Permission } from '../../auth/roles/permission.type';
import { type PlatformPermission } from '../../auth/roles/platform-permission.type';
import { type RoleServiceInterface } from '../../auth/roles/role-service.interface';
import { ServiceAccountUtilities } from '../../auth/service-account/service-account.utilities';
import { ZibriServiceAccountPlatformPermissions } from '../../auth/service-account/zibri-service-account-permissions.model';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { type OnAppInit } from '../../global/on-app-init.interface';
import { HttpStatus } from '../../http/http-status.enum';
import { Response } from '../../open-api/decorators/response.decorator';
import { Get } from '../../routing/decorators/get.decorator';
import { Param } from '../../routing/decorators/param.decorator';
import { validateTokensRegistered } from '../../utilities/validate-tokens-registered.function';
import { McpToolUtilities } from './mcp-tool.utilities';
import { ZIBRI_MCP_PLUGIN_DI_TOKENS } from './mcp.tokens';
import { McpToolSummary } from './models/mcp-tool-summary.model';
import { type McpTool } from './models/mcp-tool.model';

/**
 * The route of the MCP tools a service account can use, below the path of the controller that extends it, for the
 * people managing service accounts: `GET /:serviceAccountId` answers the tools whose permission the roles of the
 * account carry in the tenant the request acts in, or in any tenant it is a member of for a request that acts in none.
 * A key of the account narrows them further to the permissions it lists. Behind the platform permission
 * `service-accounts.read`, and needs `ZibriMcpPlugin`.
 */
// no @Controller of its own, for the reason MailingListController has none. A controller of its own rather than a
// route of the ServiceAccountController, which an application without the MCP plugin extends as well
export class ServiceAccountMcpToolController implements OnAppInit {
    // eslint-disable-next-line jsdoc/require-jsdoc
    onAppInit(): void {
        validateTokensRegistered(ServiceAccountMcpToolController.name, { MCP_SERVICE: ZIBRI_MCP_PLUGIN_DI_TOKENS.MCP_SERVICE });
    }

    @Auth.hasPlatformPermission(ZibriServiceAccountPlatformPermissions.SERVICE_ACCOUNTS_READ)
    @Response.error(HttpStatus.NOT_FOUND)
    @Response.array(McpToolSummary)
    @Get('/:serviceAccountId')
    async findTools(
        @Param.path('serviceAccountId', { type: 'string', format: 'uuid' })
        serviceAccountId: string
    ): Promise<McpToolSummary[]> {
        const account: BaseUser<string> = await ServiceAccountUtilities.resolveServiceAccount(serviceAccountId, undefined);
        const permissions: (Permission | PlatformPermission)[] = await inject(ZIBRI_DI_TOKENS.AUTH_SERVICE)
            .resolveUserPermissions(account, inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).getActiveTenantId());
        const roleService: RoleServiceInterface = inject(ZIBRI_DI_TOKENS.ROLE_SERVICE);
        const { roles, ...user } = account;
        // the account as a request of a key listing every permission of its roles would be, through the service
        // answering tools/list, so a service of the application that shows a tool to fewer callers shows it here too
        const caller: CurrentUser = {
            ...user,
            permissions: permissions.filter((permission): permission is Permission => roleService.isPermission(permission)),
            platformPermissions: permissions.filter((permission): permission is PlatformPermission => roleService.isPlatformPermission(permission))
        };
        const tools: McpTool[] = inject(ZIBRI_MCP_PLUGIN_DI_TOKENS.MCP_SERVICE).findTools(caller);
        return tools.map(tool => ({
            name: tool.name,
            title: tool.title,
            description: tool.description,
            kind: tool.kind,
            permission: McpToolUtilities.getPermission(tool)
        }));
    }
}
