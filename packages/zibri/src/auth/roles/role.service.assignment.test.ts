import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { definePermissions, definePlatformPermissions } from './define-permissions.function';
import { type RoleServiceInterface } from './role-service.interface';
import { ZIBRI_PERMISSIONS, ZIBRI_PLATFORM_PERMISSIONS } from './zibri-permissions.model';
import { TestTimeouts } from '../../__testing__/constants';
import { JwtUser } from '../../__testing__/mocks/entities/jwt-user.entity';
import { TestMembership } from '../../__testing__/mocks/entities/test-membership.entity';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { DefaultTestServerMembershipRepository } from '../../__testing__/test-server/membership-repository';
import { defaultTestServerProviders, rolesAndPermissionsProviders, TestServerRole } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { Repository } from '../../data-source/repository/repository';
import { Transaction } from '../../data-source/transaction/transaction.model';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { type TenantServiceInterface } from '../../tenancy/tenant-service.interface';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { CurrentUser } from '../decorators/current-user.decorator';

// eslint-disable-next-line typescript/typedef
const Permissions = definePermissions([...ZIBRI_PERMISSIONS, 'invoices.read', 'audit.read'] as const);

// eslint-disable-next-line typescript/typedef
const PlatformPermissions = definePlatformPermissions([...ZIBRI_PLATFORM_PERMISSIONS, 'reports.read', 'tenants.manage'] as const);

const roles: TestServerRole[] = [
    { name: 'reporter', level: 'platform', permissions: [PlatformPermissions.REPORTS_READ], description: undefined },
    { name: 'tenant-manager', level: 'platform', permissions: [PlatformPermissions.TENANTS_MANAGE], description: undefined },
    { name: 'accountant', level: 'tenant', permissions: [Permissions.INVOICES_READ], description: undefined },
    { name: 'auditor', level: 'tenant', permissions: [Permissions.AUDIT_READ], description: undefined }
];

let server: StartedTestServer | undefined;

/**
 * The role service of the running application.
 * @returns The service.
 */
function roleService(): RoleServiceInterface {
    return inject(ZIBRI_DI_TOKENS.ROLE_SERVICE);
}

/**
 * Creates a user holding no role.
 * @returns The user.
 */
async function createUser(): Promise<JwtUser> {
    return await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser)).create({ email: `${UUIDUtilities.generate()}@assign.test`, roles: [] });
}

/**
 * A caller who may hand out any role, at both levels.
 * @returns The caller.
 */
async function createAdministrator(): Promise<CurrentUser> {
    const user: JwtUser = await createUser();
    return {
        id: user.id,
        email: user.email,
        deactivatedAt: user.deactivatedAt,
        permissions: [Permissions.AUTH_ASSIGN_ROLE_WITH_ANY_PERMISSION],
        platformPermissions: [PlatformPermissions.AUTH_ASSIGN_PLATFORM_ROLE_WITH_ANY_PERMISSION]
    };
}

describe('RoleService - giving one user roles at once', () => {
    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories })],
            providers: [
                ...defaultTestServerProviders,
                ...rolesAndPermissionsProviders(
                    { permissions: Object.values(Permissions), platformPermissions: Object.values(PlatformPermissions) },
                    roles
                )
            ]
        });
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    it('keeps both of two platform roles given at the same time', async () => {
        const administrator: CurrentUser = await createAdministrator();
        const user: JwtUser = await createUser();

        // each reads the roles held and writes them back changed, so without anything between them
        // both read none, and the later write took the earlier one's role away
        await Promise.all([
            roleService().assignRole(administrator, user.id, 'reporter', undefined),
            roleService().assignRole(administrator, user.id, 'tenant-manager', undefined)
        ]);

        const stored: JwtUser = await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser)).findById(user.id);
        expect(new Set(stored.roles)).toEqual(new Set(['reporter', 'tenant-manager']));
    });

    it('keeps both of two tenant roles given at the same time', async () => {
        const administrator: CurrentUser = await createAdministrator();
        const user: JwtUser = await createUser();
        const tenantId: string = UUIDUtilities.generate();
        const tenants: TenantServiceInterface = inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);

        const membership: TestMembership = await tenants.runAs(tenantId, async () => {
            await inject(DefaultTestServerMembershipRepository).create({ tenantId, userId: user.id, roles: [] });
            await Promise.all([
                roleService().assignRole(administrator, user.id, 'accountant', undefined),
                roleService().assignRole(administrator, user.id, 'auditor', undefined)
            ]);
            return await inject(DefaultTestServerMembershipRepository).findOne({ where: { userId: user.id } });
        });

        expect(new Set(membership.roles)).toEqual(new Set(['accountant', 'auditor']));
    });

    it('gives one user several roles in one transaction', async () => {
        const administrator: CurrentUser = await createAdministrator();
        const user: JwtUser = await createUser();
        const users: Repository<JwtUser> = inject(repositoryTokenFor(JwtUser));

        // the second waits for nothing: the transaction already holds what the first took
        const transaction: Transaction = await users.dataSource.startTransaction();
        await roleService().assignRole(administrator, user.id, 'reporter', transaction);
        await roleService().assignRole(administrator, user.id, 'tenant-manager', transaction);
        await transaction.commit();

        expect(new Set((await users.findById(user.id)).roles)).toEqual(new Set(['reporter', 'tenant-manager']));
    });
});