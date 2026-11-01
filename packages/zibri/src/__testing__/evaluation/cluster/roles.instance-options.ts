import { ClusterMark, defaultClusterProviders, StartTestServerOptions } from 'zibri-testing';

import { type AuthServiceInterface } from '../../../auth/auth-service.interface';
import { Auth } from '../../../auth/decorators/auth.decorator';
import { definePermissions, definePlatformPermissions } from '../../../auth/roles/define-permissions.function';
import { ApiKeyAuthStrategy } from '../../../auth/strategies/api-key/api-key.auth-strategy';
import { ApiKey } from '../../../auth/strategies/api-key/api-key.model';
import { CreatedApiKey } from '../../../auth/strategies/api-key/created-api-key.model';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { Response } from '../../../open-api/decorators/response.decorator';
import { Controller } from '../../../routing/decorators/controller.decorator';
import { Get } from '../../../routing/decorators/get.decorator';
import { Param } from '../../../routing/decorators/param.decorator';
import { Post } from '../../../routing/decorators/post.decorator';
import { UUIDUtilities } from '../../../utilities/uuid.utilities';
import { JwtUser } from '../../mocks/entities/jwt-user.entity';
import { TestRole } from '../../mocks/entities/test-role.entity';
import { createTestDataSource, defaultTestServerEntities, defaultTestServerRepositories } from '../../test-server/create-test-data-source.function';
import { DefaultTestServerMembershipRepository } from '../../test-server/membership-repository';
import { rolesAndPermissionsProviders, testServerPasswordPolicyProvider } from '../../test-server/providers';
import { DefaultTestServerRoleRepository } from '../../test-server/role-repository';

/**
 * What every instance of the roles cluster boots with.
 *
 * Every check reads the roles from the memory of its instance, so a role written on one instance has
 * to reach the checks of every other. Like every instance options module this is imported by the
 * parent as well, so nothing at the top level may assume it is running inside an instance.
 */

/**
 * The permission the role of this scenario carries, and the route asks for.
 */
const { REPORTS_READ } = definePlatformPermissions(['reports.read'] as const);

/**
 * The permission the role of a tenant's own carries, and the route of the tenant asks for.
 */
const { INVOICES_EXPORT } = definePermissions(['invoices.export'] as const);

/**
 * The role a write on one instance creates and changes.
 */
const roleName: string = 'reporter';

/**
 * The role of a tenant's own a write on one instance creates and changes.
 */
const tenantRoleName: string = 'exporter';

/**
 * What the tenant scenario hands the parent: a key of a member, and their tenant.
 */
export type ClusterTenantSetup = {
    /**
     * The key of the member holding the tenant's own role.
     */
    key: string,
    /**
     * The tenant.
     */
    tenantId: string
};

/**
 * Writes the role on the instance asked, and asks for what it carries on any.
 */
@Controller('/cluster-roles')
class ClusterRolesController {
    /**
     * Creates the role, a user holding it and a key listing what it carries.
     * @returns The key.
     */
    @Auth.skip()
    @Post('/setup')
    async setup(): Promise<{ key: string }> {
        await inject(DefaultTestServerRoleRepository)
            .create({ name: roleName, level: 'platform', permissions: [REPORTS_READ], description: undefined });
        const user: JwtUser = await inject(repositoryTokenFor(JwtUser))
            .create({ email: `reporter-${UUIDUtilities.generate()}@cluster-roles.test`, roles: [roleName] });
        const authService: AuthServiceInterface = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
        const created: CreatedApiKey = await authService.createApiKey(
            user.id,
            {
                name: 'reports',
                permissions: [REPORTS_READ],
                expiresAt: undefined,
                tenantId: undefined,
                clientAuthentication: undefined,
                requireDpop: false
            },
            undefined
        );
        return { key: created.key };
    }

    /**
     * Takes the permission from the role.
     */
    @Response.empty()
    @Auth.skip()
    @Post('/revoke')
    async revoke(): Promise<void> {
        const roles: DefaultTestServerRoleRepository = inject(DefaultTestServerRoleRepository);
        const role: TestRole = await roles.findOne({ where: { name: roleName } });
        await roles.updateById(role.id, { permissions: [] });
    }

    /**
     * Answers whoever holds a role carrying the permission, as this instance knows the roles.
     * @returns That it answered.
     */
    @Auth.hasPlatformPermission(REPORTS_READ)
    @Get('/reports')
    reports(): { ok: boolean } {
        return { ok: true };
    }

    /**
     * Creates a role of a new tenant's own, a member holding it and a key listing what it carries.
     * @returns The key, and the tenant.
     */
    @Auth.skip()
    @Post('/tenant-setup')
    async tenantSetup(): Promise<ClusterTenantSetup> {
        const tenantId: string = UUIDUtilities.generate();
        const user: JwtUser = await inject(repositoryTokenFor(JwtUser))
            .create({ email: `exporter-${UUIDUtilities.generate()}@cluster-roles.test`, roles: [] });
        await inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(tenantId, async () => {
            await inject(DefaultTestServerRoleRepository)
                .create({ name: tenantRoleName, level: 'tenant', permissions: [INVOICES_EXPORT], description: undefined });
            await inject(DefaultTestServerMembershipRepository).create({ tenantId, userId: user.id, roles: [tenantRoleName] });
        });
        const created: CreatedApiKey = await inject(ZIBRI_DI_TOKENS.AUTH_SERVICE).createApiKey(
            user.id,
            {
                name: 'invoices',
                permissions: [INVOICES_EXPORT],
                expiresAt: undefined,
                tenantId,
                clientAuthentication: undefined,
                requireDpop: false
            },
            undefined
        );
        return { key: created.key, tenantId };
    }

    /**
     * Takes the permission from the role of the tenant's own.
     * @param tenantId - The tenant.
     */
    @Response.empty()
    @Auth.skip()
    @Post('/tenant-revoke/:tenantId')
    async tenantRevoke(@Param.path('tenantId') tenantId: string): Promise<void> {
        await inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(tenantId, async () => {
            const roles: DefaultTestServerRoleRepository = inject(DefaultTestServerRoleRepository);
            const role: TestRole = await roles.findOne({ where: { name: tenantRoleName } });
            await roles.updateById(role.id, { permissions: [] });
        });
    }

    /**
     * Answers a member of a tenant holding a role carrying the permission, as this instance knows the
     * roles of that tenant.
     * @returns That it answered.
     */
    @Auth.hasPermission(INVOICES_EXPORT)
    @Get('/invoices')
    invoices(): { ok: boolean } {
        return { ok: true };
    }
}

const options: StartTestServerOptions = {
    controllers: [ClusterRolesController],
    authStrategies: [ApiKeyAuthStrategy],
    // this repository's own fixtures plus the keys and the mark table, the way every other suite here
    // declares a data source
    dataSources: [
        createTestDataSource({
            entities: [...defaultTestServerEntities, ApiKey, ClusterMark],
            repositories: defaultTestServerRepositories
        })
    ],
    providers: [
        ...defaultClusterProviders,
        testServerPasswordPolicyProvider,
        ...rolesAndPermissionsProviders({ permissions: [INVOICES_EXPORT], platformPermissions: [REPORTS_READ] }, [])
    ]
};

export default options;