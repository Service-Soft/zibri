import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { TestTimeouts } from '../../__testing__/constants';
import { JwtUser } from '../../__testing__/mocks/entities/jwt-user.entity';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { DefaultTestServerMembershipRepository } from '../../__testing__/test-server/membership-repository';
import { defaultTestServerProviders, rolesAndPermissionsProviders, TestServerRole } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { type TenantServiceInterface } from '../../tenancy/tenant-service.interface';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { CurrentUser } from '../decorators/current-user.decorator';
import { definePermissions, definePlatformPermissions } from './define-permissions.function';
import { type RoleServiceInterface } from './role-service.interface';
import { ZIBRI_PERMISSIONS, ZIBRI_PLATFORM_PERMISSIONS } from './zibri-permissions.model';

// an operator of the application manages the members of a tenant they are no member of themselves, such as when they
// invite somebody into it

// eslint-disable-next-line typescript/typedef
const Permissions = definePermissions([...ZIBRI_PERMISSIONS, 'invoices.read', 'audit.read'] as const);

// eslint-disable-next-line typescript/typedef
const PlatformPermissions = definePlatformPermissions([...ZIBRI_PLATFORM_PERMISSIONS, 'reports.read'] as const);

const roles: TestServerRole[] = [
    { name: 'reporter', level: 'platform', permissions: [PlatformPermissions.REPORTS_READ], description: undefined },
    { name: 'accountant', level: 'tenant', permissions: [Permissions.INVOICES_READ], description: undefined },
    { name: 'auditor', level: 'tenant', permissions: [Permissions.AUDIT_READ], description: undefined }
];

/**
 * A user who is a member of a tenant.
 */
type Member = {
    user: JwtUser,
    tenantId: string
};

let server: StartedTestServer | undefined;

/**
 * The role service of the running application.
 * @returns The service.
 */
function roleService(): RoleServiceInterface {
    return inject(ZIBRI_DI_TOKENS.ROLE_SERVICE);
}

/**
 * The tenant service of the running application.
 * @returns The service.
 */
function tenantService(): TenantServiceInterface {
    return inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);
}

/**
 * Creates a user holding no role.
 * @returns The user.
 */
async function createUser(): Promise<JwtUser> {
    return await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser)).create({ email: `${UUIDUtilities.generate()}@any-tenant.test`, roles: [] });
}

/**
 * A caller who is no member of any tenant, with the given permissions.
 * @param platformPermissions - What their own roles carry.
 * @param permissions - What their membership in the tenant of the request carries.
 * @returns The caller.
 */
async function createCaller(
    platformPermissions: CurrentUser['platformPermissions'],
    permissions: CurrentUser['permissions'] = []
): Promise<CurrentUser> {
    const user: JwtUser = await createUser();
    return { id: user.id, email: user.email, deactivatedAt: user.deactivatedAt, permissions, platformPermissions };
}

/**
 * Makes a user a member of a new tenant, without roles.
 * @returns The user and the tenant.
 */
async function createMember(): Promise<Member> {
    const user: JwtUser = await createUser();
    const tenantId: string = UUIDUtilities.generate();
    await tenantService().runAs(tenantId, async () => await inject(DefaultTestServerMembershipRepository).create({ tenantId, userId: user.id, roles: [] }));
    return { user, tenantId };
}

/**
 * Reads the roles a member holds in their tenant.
 * @param member - The member.
 * @returns The roles.
 */
async function rolesOf(member: Member): Promise<string[]> {
    return await tenantService().runAs(
        member.tenantId,
        async () => (await inject(DefaultTestServerMembershipRepository).findOne({ where: { userId: member.user.id } })).roles
    );
}

/**
 * Checks roles a caller hands out before anybody holds them.
 * @param caller - Who hands them out.
 * @param given - The roles.
 * @param tenantId - The tenant they are held in, or undefined for platform roles.
 */
async function validateMayAssign(caller: CurrentUser, given: string[], tenantId: string | undefined): Promise<void> {
    const service: RoleServiceInterface = roleService();
    if (service.validateMayAssign == undefined) {
        throw new Error('The RoleService checks roles before anybody holds them.');
    }
    await service.validateMayAssign(caller, given, tenantId, undefined);
}

describe('RoleService - tenant roles in any tenant', () => {
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

    it('gives and takes a tenant role in a tenant the caller is no member of, with the permission of their own', async () => {
        const operator: CurrentUser = await createCaller([
            PlatformPermissions.AUTH_ASSIGN_ROLE_IN_ANY_TENANT_WITH_ANY_PERMISSION,
            PlatformPermissions.AUTH_UNASSIGN_ROLE_IN_ANY_TENANT_WITH_ANY_PERMISSION
        ]);
        const member: Member = await createMember();

        await tenantService().runAs(member.tenantId, async () => await roleService().assignRole(operator, member.user.id, 'accountant', undefined));
        expect(await rolesOf(member)).toEqual(['accountant']);

        await tenantService().runAs(member.tenantId, async () => await roleService().unassignRole(operator, member.user.id, 'accountant', undefined));
        expect(await rolesOf(member)).toEqual([]);
    });

    it('refuses an operator without it, and one who may only give a role taking it', async () => {
        const member: Member = await createMember();
        const withoutIt: CurrentUser = await createCaller([PlatformPermissions.AUTH_ASSIGN_PLATFORM_ROLE_WITH_ANY_PERMISSION]);
        const givingOnly: CurrentUser = await createCaller([PlatformPermissions.AUTH_ASSIGN_ROLE_IN_ANY_TENANT_WITH_ANY_PERMISSION]);

        await expect(tenantService().runAs(member.tenantId, async () => await roleService().assignRole(withoutIt, member.user.id, 'accountant', undefined)))
            .rejects.toThrow('You do not have permission to manage this role.');
        await tenantService().runAs(member.tenantId, async () => await roleService().assignRole(givingOnly, member.user.id, 'accountant', undefined));
        await expect(tenantService().runAs(member.tenantId, async () => await roleService().unassignRole(givingOnly, member.user.id, 'accountant', undefined)))
            .rejects.toThrow('You do not have permission to manage this role.');
        expect(await rolesOf(member)).toEqual(['accountant']);
    });

    it('checks roles nobody holds yet as giving them is checked, at their level', async () => {
        const tenantId: string = UUIDUtilities.generate();
        const operator: CurrentUser = await createCaller([PlatformPermissions.AUTH_ASSIGN_ROLE_IN_ANY_TENANT_WITH_ANY_PERMISSION]);
        const platformAdministrator: CurrentUser = await createCaller([PlatformPermissions.AUTH_ASSIGN_PLATFORM_ROLE_WITH_ANY_PERMISSION]);

        await expect(validateMayAssign(operator, ['accountant', 'auditor'], tenantId)).resolves.toBeUndefined();
        await expect(validateMayAssign(platformAdministrator, ['reporter'], undefined)).resolves.toBeUndefined();
        await expect(validateMayAssign(operator, ['reporter'], undefined)).rejects.toThrow('You do not have permission to manage this role.');
        await expect(validateMayAssign(platformAdministrator, ['accountant'], undefined)).rejects.toThrow(/is a tenant role/);
        await expect(validateMayAssign(operator, ['reporter'], tenantId)).rejects.toThrow(/is a platform role/);
        await expect(validateMayAssign(operator, ['nobody'], tenantId)).rejects.toThrow(/does not exist/);
    });

    it('lets a member hand out what they hold, in the tenant the request acts in only', async () => {
        const tenantId: string = UUIDUtilities.generate();
        const member: CurrentUser = await createCaller([], [Permissions.AUTH_ASSIGN_ROLE_WITH_OWN_PERMISSIONS, Permissions.INVOICES_READ]);

        await expect(tenantService().runAs(tenantId, async () => await validateMayAssign(member, ['accountant'], tenantId))).resolves.toBeUndefined();
        await expect(tenantService().runAs(tenantId, async () => await validateMayAssign(member, ['auditor'], tenantId)))
            .rejects.toThrow('You do not have permission to manage this role.');
        await expect(tenantService().runAs(tenantId, async () => await validateMayAssign(member, ['accountant'], UUIDUtilities.generate())))
            .rejects.toThrow('You do not have permission to manage this role.');
    });
});