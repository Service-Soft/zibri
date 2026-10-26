import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { type AuthServiceInterface } from '../../auth/auth-service.interface';
import { Auth } from '../../auth/decorators/auth.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { definePermissions, definePlatformPermissions } from '../../auth/roles/define-permissions.function';
import type { Permission } from '../../auth/roles/permission.type';
import type { PlatformPermission } from '../../auth/roles/platform-permission.type';
import type { RoleLevel } from '../../auth/roles/role-level.type';
import { type RoleServiceInterface } from '../../auth/roles/role-service.interface';
import { ZIBRI_PERMISSIONS, ZIBRI_PLATFORM_PERMISSIONS } from '../../auth/roles/zibri-permissions.model';
import { ApiKeyAuthStrategy } from '../../auth/strategies/api-key/api-key.auth-strategy';
import { ApiKey } from '../../auth/strategies/api-key/api-key.model';
import { CreatedApiKey } from '../../auth/strategies/api-key/created-api-key.model';
import { JwtAuthStrategy } from '../../auth/strategies/jwt/jwt.auth-strategy';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { Property } from '../../entity/decorators/property.decorator';
import { BadRequestError } from '../../error-handling/errors/bad-request.error';
import { Response } from '../../open-api/decorators/response.decorator';
import { Body } from '../../routing/decorators/body.decorator';
import { Controller } from '../../routing/decorators/controller.decorator';
import { Delete } from '../../routing/decorators/delete.decorator';
import { Get } from '../../routing/decorators/get.decorator';
import { Param } from '../../routing/decorators/param.decorator';
import { Patch } from '../../routing/decorators/patch.decorator';
import { Post } from '../../routing/decorators/post.decorator';
import { type TenantServiceInterface } from '../../tenancy/tenant-service.interface';
import { Newable } from '../../types/newable.type';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { TestTimeouts } from '../constants';
import { JwtUser } from '../mocks/entities/jwt-user.entity';
import { TestRole } from '../mocks/entities/test-role.entity';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../test-server/create-test-data-source.function';
import { DefaultTestServerMembershipRepository } from '../test-server/membership-repository';
import { defaultTestServerProviders, rolesAndPermissionsProviders, TestServerRole } from '../test-server/providers';
import { DefaultTestServerRoleRepository } from '../test-server/role-repository';
import { StartedTestServer, startTestServer } from '../test-server/start-test-server.function';

/**
 * Executable form of evaluation/03-auth-and-security.md A8.
 *
 * Every role was declared in code, so an administrator who needed a role between two existing ones
 * needed a deployment. Roles are rows now, which the application seeds and its administrators
 * change at runtime; permissions stay in code, since the code checks them, each at the one level a
 * role carrying it is held at. Defining a role and handing one out are guarded by permissions as fine
 * grained as the operation, the role's level and whether the caller may hand out more than they hold
 * themselves.
 */

// eslint-disable-next-line typescript/typedef
const Permissions = definePermissions([...ZIBRI_PERMISSIONS, 'invoices.read', 'invoices.export', 'audit.read'] as const);

// eslint-disable-next-line typescript/typedef
const PlatformPermissions = definePlatformPermissions([...ZIBRI_PLATFORM_PERMISSIONS, 'reports.read'] as const);

/**
 * Every permission, as the enum a request's body is checked against.
 */
const ALL_PERMISSIONS: Readonly<Record<string, Permission | PlatformPermission>> = { ...Permissions, ...PlatformPermissions };

const roles: TestServerRole[] = [
    {
        name: 'operator',
        level: 'platform',
        permissions: [
            PlatformPermissions.AUTH_CREATE_ROLE_WITH_ANY_PERMISSION,
            PlatformPermissions.AUTH_CREATE_PLATFORM_ROLE_WITH_ANY_PERMISSION,
            PlatformPermissions.AUTH_UPDATE_ROLE_WITH_ANY_PERMISSION,
            PlatformPermissions.AUTH_DELETE_ROLE_WITH_ANY_PERMISSION,
            PlatformPermissions.REPORTS_READ
        ],
        description: 'defines the roles of every tenant'
    },
    { name: 'role-maker', level: 'platform', permissions: [PlatformPermissions.AUTH_CREATE_ROLE_WITH_OWN_PERMISSIONS], description: undefined },
    { name: 'role-editor', level: 'platform', permissions: [PlatformPermissions.AUTH_UPDATE_ROLE_WITH_OWN_PERMISSIONS], description: undefined },
    { name: 'user', level: 'platform', permissions: [], description: undefined },
    {
        name: 'tenant-admin',
        level: 'tenant',
        permissions: [
            Permissions.INVOICES_READ,
            Permissions.INVOICES_EXPORT,
            Permissions.AUTH_ASSIGN_ROLE_WITH_OWN_PERMISSIONS,
            Permissions.AUTH_UNASSIGN_ROLE_WITH_OWN_PERMISSIONS
        ],
        description: undefined
    },
    { name: 'member', level: 'tenant', permissions: [Permissions.INVOICES_READ], description: undefined },
    { name: 'exporter', level: 'tenant', permissions: [Permissions.INVOICES_READ, Permissions.INVOICES_EXPORT], description: undefined },
    { name: 'auditor', level: 'tenant', permissions: [Permissions.AUDIT_READ], description: undefined }
];

/**
 * A role as an administrator defines it.
 */
class RoleRequest {
    @Property.string()
    name!: string;

    @Property.string({ enum: { tenant: 'tenant', platform: 'platform' } })
    level!: RoleLevel;

    @Property.array({ items: { type: 'string', enum: ALL_PERMISSIONS } })
    permissions!: (Permission | PlatformPermission)[];
}

/**
 * What an administrator changes about a role.
 */
class RolePermissionsRequest {
    @Property.array({ items: { type: 'string', enum: ALL_PERMISSIONS } })
    permissions!: (Permission | PlatformPermission)[];
}

@Controller('/roles', { allowOrphan: true })
class RoleController {
    @Auth.isLoggedIn()
    @Post('/')
    async create(
        @CurrentUser()
        user: CurrentUser<JwtUser>,
        @Body(RoleRequest)
        request: RoleRequest
    ): Promise<TestRole> {
        return await roleService().createRole<TestRole>(user, { ...request, description: undefined }, undefined);
    }

    @Auth.isLoggedIn()
    @Patch('/:name')
    async update(
        @CurrentUser()
        user: CurrentUser<JwtUser>,
        @Param.path('name')
        name: string,
        @Body(RolePermissionsRequest)
        request: RolePermissionsRequest
    ): Promise<TestRole> {
        return await roleService().updateRole<TestRole>(user, name, { permissions: request.permissions }, undefined);
    }

    @Response.empty()
    @Auth.isLoggedIn()
    @Delete('/:name')
    async delete(
        @CurrentUser()
        user: CurrentUser<JwtUser>,
        @Param.path('name')
        name: string
    ): Promise<void> {
        await roleService().deleteRole(user, name, undefined);
    }

    @Response.empty()
    @Auth.isLoggedIn()
    @Post('/:name/holders/:userId')
    async assign(
        @CurrentUser()
        user: CurrentUser<JwtUser>,
        @Param.path('name')
        name: string,
        @Param.path('userId', { type: 'string', format: 'uuid' })
        userId: string
    ): Promise<void> {
        await roleService().assignRole(user, userId, name, undefined);
    }

    @Response.empty()
    @Auth.isLoggedIn()
    @Delete('/:name/holders/:userId')
    async unassign(
        @CurrentUser()
        user: CurrentUser<JwtUser>,
        @Param.path('name')
        name: string,
        @Param.path('userId', { type: 'string', format: 'uuid' })
        userId: string
    ): Promise<void> {
        await roleService().unassignRole(user, userId, name, undefined);
    }
}

@Controller('/invoices', { allowOrphan: true })
class InvoiceController {
    @Auth.hasPermission(Permissions.INVOICES_EXPORT)
    @Get('/export')
    export(): { ok: boolean } {
        return { ok: true };
    }
}

let server: StartedTestServer | undefined;
let baseUrl: string;

/**
 * Starts an application keeping its data in memory, seeded with the roles of this suite.
 * @returns The server, started.
 */
async function startApp(): Promise<StartedTestServer> {
    const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
        entities: [...defaultTestServerEntities, ApiKey],
        repositories: defaultTestServerRepositories,
        allowOrphan: true
    });
    return await startTestServer({
        dataSources: [dataSourceClass],
        authStrategies: [JwtAuthStrategy, ApiKeyAuthStrategy],
        controllers: [RoleController, InvoiceController],
        providers: [
            ...defaultTestServerProviders,
            ...rolesAndPermissionsProviders(
                { permissions: Object.values(Permissions), platformPermissions: Object.values(PlatformPermissions) },
                roles
            )
        ]
    });
}

/**
 * The role service of the running application.
 * @returns The service.
 */
function roleService(): RoleServiceInterface {
    return inject(ZIBRI_DI_TOKENS.ROLE_SERVICE);
}

/**
 * Somebody calling the api, with the tenant they act in.
 */
type Caller = {
    user: JwtUser,
    tenantId: string
};

/**
 * Creates a user who is a member of a tenant.
 * @param name - What sets the user's email apart.
 * @param platformRoles - The roles of their own.
 * @param memberRoles - The roles they hold in the tenant.
 * @param tenantId - The tenant, a new one unless given.
 * @returns The user and the tenant.
 */
async function createCaller(name: string, platformRoles: string[], memberRoles: string[], tenantId: string = UUIDUtilities.generate()): Promise<Caller> {
    const user: JwtUser = await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser))
        .create({ email: `${name}-${UUIDUtilities.generate()}@roles-as-data.test`, roles: platformRoles });
    await inject<TenantServiceInterface>(ZIBRI_DI_TOKENS.TENANT_SERVICE)
        .runAs(tenantId, async () => await inject(DefaultTestServerMembershipRepository).create({ tenantId, userId: user.id, roles: memberRoles }));
    return { user, tenantId };
}

/**
 * Creates an api key of a caller, bound to their tenant and listing everything their roles carry
 * there right now.
 * @param caller - The caller.
 * @returns The key.
 */
async function keyOf(caller: Caller): Promise<string> {
    const authService: AuthServiceInterface = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
    const created: CreatedApiKey = await authService.createApiKey(
        caller.user.id,
        {
            name: 'roles',
            permissions: await authService.resolveUserPermissions(caller.user, caller.tenantId),
            expiresAt: undefined,
            tenantId: caller.tenantId,
            clientAuthentication: undefined,
            requireDpop: false
        },
        undefined
    );
    return created.key;
}

/**
 * Calls the api as a caller.
 * @param method - The http method.
 * @param path - The route.
 * @param caller - Who calls.
 * @param body - What is sent, if anything.
 * @returns The status of the answer.
 */
async function call(method: string, path: string, caller: Caller, body?: object): Promise<number> {
    const res: globalThis.Response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { 'x-api-key': await keyOf(caller), ...body == undefined ? {} : { 'content-type': 'application/json' } },
        ...body == undefined ? {} : { body: JSON.stringify(body) }
    });
    return res.status;
}

describe('evaluation/03-auth-and-security A8 - permissions are declared in code at a level, roles are rows', () => {
    beforeAll(async () => {
        server = await startApp();
        baseUrl = await server.start();
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
        server = undefined;
    });

    it('declares permissions, not roles, named like an enum and typed by their level', () => {
        expect(Object.keys(ZIBRI_DI_TOKENS)).not.toContain('ROLES_AND_PERMISSIONS');
        expect(Object.keys(ZIBRI_DI_TOKENS)).toContain('PERMISSIONS');
        expect(Permissions.INVOICES_EXPORT).toBe('invoices.export');
        expect(PlatformPermissions.AUTH_ASSIGN_PLATFORM_ROLE_WITH_ANY_PERMISSION).toBe('auth.assign_platform_role.with_any_permission');

        // @ts-expect-error - a permission nobody declared is no key of the object
        expect(Permissions.INVOICES_EXPORTS).toBeUndefined();
        // @ts-expect-error - a plain string is no permission, so a typo cannot reach a check
        const misspelled: Permission = 'invoices.exports';
        // @ts-expect-error - a platform permission is no tenant permission
        const otherLevel: Permission = PlatformPermissions.REPORTS_READ;
        expect([misspelled, otherLevel]).toHaveLength(2);
    });

    it('lets a role created at runtime in, without a deployment', async () => {
        const operator: Caller = await createCaller('operator', ['operator'], []);
        const admin: Caller = await createCaller('admin', ['user'], ['tenant-admin']);
        const member: Caller = await createCaller('member', ['user'], ['member'], admin.tenantId);
        expect(await call('GET', '/invoices/export', member)).toBe(403);

        expect(await call('POST', '/roles', operator, { name: 'accountant', level: 'tenant', permissions: [Permissions.INVOICES_EXPORT] })).toBe(200);
        expect(await call('POST', `/roles/accountant/holders/${member.user.id}`, admin)).toBe(204);

        expect(await call('GET', '/invoices/export', member)).toBe(200);
    });

    it('takes a permission from every holder of a role on the next request', async () => {
        const operator: Caller = await createCaller('operator', ['operator'], []);
        expect(await call('POST', '/roles', operator, { name: 'clerk', level: 'tenant', permissions: [Permissions.INVOICES_EXPORT] })).toBe(200);
        const clerk: Caller = await createCaller('clerk', ['user'], ['clerk']);
        expect(await call('GET', '/invoices/export', clerk)).toBe(200);

        expect(await call('PATCH', '/roles/clerk', operator, { permissions: [] })).toBe(200);

        expect(await call('GET', '/invoices/export', clerk)).toBe(403);
    });

    it('refuses a role carrying a permission that is not declared at its level, however it is written', async () => {
        const operator: Caller = await createCaller('operator', ['operator'], []);

        expect(await call('POST', '/roles', operator, { name: 'typo', level: 'tenant', permissions: ['invoices.exports'] })).toBe(400);
        expect(await call('POST', '/roles', operator, { name: 'mixed', level: 'tenant', permissions: [PlatformPermissions.REPORTS_READ] })).toBe(400);
        // a repository's create data takes what is stored, so the store's check is what stops this one
        await expect(inject(DefaultTestServerRoleRepository).create({ name: 'typo', level: 'tenant', permissions: ['invoices.exports'], description: undefined }))
            .rejects.toThrow(BadRequestError);
    });

    it('refuses giving a user or a membership a role that does not exist, or one of the other level', async () => {
        await expect(inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser)).create({ email: 'nobody@roles-as-data.test', roles: ['nobody'] }))
            .rejects.toThrow(BadRequestError);
        await expect(createCaller('nobody', ['user'], ['nobody'])).rejects.toThrow(BadRequestError);
        await expect(createCaller('wrong-level', ['member'], [])).rejects.toThrow(BadRequestError);
    });

    it('refuses deleting a role somebody holds, and deletes it once nobody does', async () => {
        const operator: Caller = await createCaller('operator', ['operator'], []);
        const admin: Caller = await createCaller('admin', ['user'], ['tenant-admin']);
        const member: Caller = await createCaller('member', ['user'], ['member'], admin.tenantId);
        expect(await call('POST', '/roles', operator, { name: 'temporary', level: 'tenant', permissions: [Permissions.INVOICES_READ] })).toBe(200);
        expect(await call('POST', `/roles/temporary/holders/${member.user.id}`, admin)).toBe(204);

        expect(await call('DELETE', '/roles/temporary', operator)).toBe(400);
        expect(await call('DELETE', `/roles/temporary/holders/${member.user.id}`, admin)).toBe(204);
        expect(await call('DELETE', '/roles/temporary', operator)).toBe(204);

        expect(await roleService().findRole('temporary')).toBeUndefined();
    });

    it('keeps what the application keeps about a role besides', async () => {
        expect(await roleService().findRole<TestRole>('operator')).toMatchObject({ description: 'defines the roles of every tenant' });
    });
});

describe('evaluation/03-auth-and-security A8 - defining and handing out roles is guarded by permissions', () => {
    beforeAll(async () => {
        server = await startApp();
        baseUrl = await server.start();
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
        server = undefined;
    });

    it('creates a role with own permissions only, within what the caller holds at its level', async () => {
        const maker: Caller = await createCaller('maker', ['role-maker'], ['member']);

        expect(await call('POST', '/roles', maker, { name: 'reader', level: 'tenant', permissions: [Permissions.INVOICES_READ] })).toBe(200);
        expect(await call('POST', '/roles', maker, { name: 'widened', level: 'tenant', permissions: [Permissions.INVOICES_EXPORT] })).toBe(403);
        // a platform role is a permission of its own
        expect(await call('POST', '/roles', maker, { name: 'platform-reader', level: 'platform', permissions: [] })).toBe(403);
    });

    it('creates a role carrying any permission for a caller who may', async () => {
        // holding no tenant permission at all
        const operator: Caller = await createCaller('operator', ['operator'], []);

        expect(await call('POST', '/roles', operator, { name: 'anything', level: 'tenant', permissions: [Permissions.AUDIT_READ] })).toBe(200);
    });

    it('updates a role only within what the caller holds, before and after', async () => {
        const editor: Caller = await createCaller('editor', ['role-editor'], ['member']);
        const operator: Caller = await createCaller('operator', ['operator'], []);
        expect(await call('POST', '/roles', operator, { name: 'narrow', level: 'tenant', permissions: [] })).toBe(200);

        expect(await call('PATCH', '/roles/narrow', editor, { permissions: [Permissions.INVOICES_READ] })).toBe(200);
        // widening it past the caller
        expect(await call('PATCH', '/roles/narrow', editor, { permissions: [Permissions.INVOICES_EXPORT] })).toBe(403);
        // narrowing one that is already wider than the caller
        expect(await call('PATCH', '/roles/exporter', editor, { permissions: [Permissions.INVOICES_READ] })).toBe(403);
    });

    it('assigns in a tenant only roles within what the caller holds there, and no platform role', async () => {
        const admin: Caller = await createCaller('admin', ['user'], ['tenant-admin']);
        const member: Caller = await createCaller('member', ['user'], [], admin.tenantId);

        expect(await call('POST', `/roles/member/holders/${member.user.id}`, admin)).toBe(204);
        expect(await call('POST', `/roles/auditor/holders/${member.user.id}`, admin)).toBe(403);
        expect(await call('POST', `/roles/operator/holders/${member.user.id}`, admin)).toBe(403);
    });

    it('refuses every operation to a caller holding none of the permissions', async () => {
        const operator: Caller = await createCaller('operator', ['operator'], []);
        const member: Caller = await createCaller('member', ['user'], ['member']);
        const other: Caller = await createCaller('other', ['user'], [], member.tenantId);
        expect(await call('POST', '/roles', operator, { name: 'untouchable', level: 'tenant', permissions: [] })).toBe(200);

        expect(await call('POST', '/roles', member, { name: 'mine', level: 'tenant', permissions: [] })).toBe(403);
        expect(await call('PATCH', '/roles/untouchable', member, { permissions: [] })).toBe(403);
        expect(await call('DELETE', '/roles/untouchable', member)).toBe(403);
        expect(await call('POST', `/roles/untouchable/holders/${other.user.id}`, member)).toBe(403);
    });
});