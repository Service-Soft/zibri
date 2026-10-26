import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource, inMemoryStoreFor, RoundTripCounter } from 'zibri-testing';

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
import { BaseEntity } from '../../entity/base-entity.model';
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
import { JsonUtilities } from '../../utilities/json.utilities';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { TestTimeouts } from '../constants';
import { JwtUser } from '../mocks/entities/jwt-user.entity';
import { TestMembership } from '../mocks/entities/test-membership.entity';
import { TestRole } from '../mocks/entities/test-role.entity';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../test-server/create-test-data-source.function';
import { DefaultTestServerMembershipRepository } from '../test-server/membership-repository';
import { defaultTestServerProviders, rolesAndPermissionsProviders, TestServerRole } from '../test-server/providers';
import { DefaultTestServerRoleRepository } from '../test-server/role-repository';
import { StartedTestServer, startTestServer } from '../test-server/start-test-server.function';

/**
 * Executable form of evaluation/03-auth-and-security.md A9.
 *
 * Every role was one every tenant shares, so an organization needing a role of its own needed the
 * operator of the whole application. A tenant's administrator defines the roles of their own tenant
 * now: seen, held and assignable in that tenant alone, guarded by tenant permissions checked there,
 * named apart from the roles every tenant shares, and read once per tenant rather than per request.
 */

// eslint-disable-next-line typescript/typedef
const Permissions = definePermissions([...ZIBRI_PERMISSIONS, 'invoices.read', 'invoices.export'] as const);

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
        permissions: [PlatformPermissions.AUTH_CREATE_ROLE_WITH_ANY_PERMISSION, PlatformPermissions.REPORTS_READ],
        description: undefined
    },
    { name: 'user', level: 'platform', permissions: [], description: undefined },
    {
        name: 'tenant-admin',
        level: 'tenant',
        permissions: [
            Permissions.INVOICES_READ,
            Permissions.INVOICES_EXPORT,
            Permissions.AUTH_CREATE_TENANT_ROLE_WITH_ANY_PERMISSION,
            Permissions.AUTH_UPDATE_TENANT_ROLE_WITH_ANY_PERMISSION,
            Permissions.AUTH_DELETE_TENANT_ROLE_WITH_ANY_PERMISSION,
            Permissions.AUTH_ASSIGN_ROLE_WITH_ANY_PERMISSION,
            Permissions.AUTH_UNASSIGN_ROLE_WITH_ANY_PERMISSION
        ],
        description: undefined
    },
    {
        name: 'role-maker',
        level: 'tenant',
        permissions: [Permissions.INVOICES_READ, Permissions.AUTH_CREATE_TENANT_ROLE_WITH_OWN_PERMISSIONS],
        description: undefined
    },
    { name: 'member', level: 'tenant', permissions: [Permissions.INVOICES_READ], description: undefined }
];

/**
 * A role as an administrator defines it: one every tenant shares, or one of the tenant named.
 */
class RoleRequest {
    @Property.string()
    name!: string;

    @Property.string({ enum: { tenant: 'tenant', platform: 'platform' } })
    level!: RoleLevel;

    @Property.array({ items: { type: 'string', enum: ALL_PERMISSIONS } })
    permissions!: (Permission | PlatformPermission)[];

    @Property.string({ format: 'uuid', required: false })
    tenantId?: string;
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
    @Get('/')
    async list(): Promise<string[]> {
        return (await roleService().findRoles<TestRole>()).map(role => role.name);
    }

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
 * Where the application of the first suite records every call to its store.
 */
const roundTrips: RoundTripCounter = new RoundTripCounter();

/**
 * Makes a data source keeping its rows in memory.
 * @param counter - Where every call to the store is recorded, if anywhere.
 * @returns The data source class.
 */
function createDataSource(counter?: RoundTripCounter): Newable<InMemoryDataSource> {
    return createInMemoryDataSource({ entities: [...defaultTestServerEntities, ApiKey], repositories: defaultTestServerRepositories, allowOrphan: true, roundTrips: counter });
}

/**
 * Starts an application seeded with the shared roles of this suite.
 * @param dataSourceClass - Where its rows are kept.
 * @returns The server, started.
 */
async function startApp(dataSourceClass: Newable<InMemoryDataSource>): Promise<StartedTestServer> {
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
 * Runs work in a tenant.
 * @param tenantId - The tenant.
 * @param work - The work.
 * @returns What the work answers.
 */
async function inTenant<T>(tenantId: string, work: () => Promise<T>): Promise<T> {
    return await inject<TenantServiceInterface>(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(tenantId, work);
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
        .create({ email: `${name}-${UUIDUtilities.generate()}@tenant-roles.test`, roles: platformRoles });
    await inTenant(tenantId, async () => await inject(DefaultTestServerMembershipRepository).create({ tenantId, userId: user.id, roles: memberRoles }));
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
            name: 'tenant-roles',
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
 * Calls the api as a caller, in their tenant.
 * @param method - The http method.
 * @param path - The route.
 * @param caller - Who calls.
 * @param body - What is sent, if anything.
 * @returns The answer.
 */
async function request(method: string, path: string, caller: Caller, body?: object): Promise<globalThis.Response> {
    return await fetch(`${baseUrl}${path}`, {
        method,
        headers: { 'x-api-key': await keyOf(caller), ...body == undefined ? {} : { 'content-type': 'application/json' } },
        ...body == undefined ? {} : { body: JSON.stringify(body) }
    });
}

/**
 * Calls the api as a caller, in their tenant.
 * @param method - The http method.
 * @param path - The route.
 * @param caller - Who calls.
 * @param body - What is sent, if anything.
 * @returns The status of the answer.
 */
async function call(method: string, path: string, caller: Caller, body?: object): Promise<number> {
    return (await request(method, path, caller, body)).status;
}

/**
 * Creates a role of a caller's own tenant, as its administrator.
 * @param admin - The administrator.
 * @param name - The name of the role.
 * @param permissions - What it carries.
 * @returns The status of the answer.
 */
async function createOwnRole(admin: Caller, name: string, permissions: Permission[]): Promise<number> {
    return await call('POST', '/roles', admin, { name, level: 'tenant', permissions, tenantId: admin.tenantId });
}

describe('evaluation/03-auth-and-security A9 - a tenant defines roles of its own', () => {
    beforeAll(async () => {
        server = await startApp(createDataSource(roundTrips));
        baseUrl = await server.start();
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
        server = undefined;
    });

    it('lets a tenant administrator create a role of their own tenant, and its holders in', async () => {
        const admin: Caller = await createCaller('admin', ['user'], ['tenant-admin']);
        const member: Caller = await createCaller('member', ['user'], ['member'], admin.tenantId);
        expect(await call('GET', '/invoices/export', member)).toBe(403);

        expect(await createOwnRole(admin, 'reviewer', [Permissions.INVOICES_EXPORT])).toBe(200);
        expect(await call('POST', `/roles/reviewer/holders/${member.user.id}`, admin)).toBe(204);

        expect(await call('GET', '/invoices/export', member)).toBe(200);
    });

    it('keeps a tenant\'s own role inside its tenant', async () => {
        const admin: Caller = await createCaller('admin', ['user'], ['tenant-admin']);
        const otherAdmin: Caller = await createCaller('other-admin', ['user'], ['tenant-admin']);
        const otherMember: Caller = await createCaller('other-member', ['user'], [], otherAdmin.tenantId);
        expect(await createOwnRole(admin, 'secluded', [])).toBe(200);

        expect(await (await request('GET', '/roles', admin)).json()).toContain('secluded');
        const seenByOther: unknown = await (await request('GET', '/roles', otherAdmin)).json();
        expect(seenByOther).toContain('member');
        expect(seenByOther).not.toContain('secluded');
        expect(await roleService().findRole('secluded')).toBeUndefined();

        expect(await call('POST', `/roles/secluded/holders/${otherMember.user.id}`, otherAdmin)).toBe(404);
        // however the membership is written
        await expect(createCaller('foreign', ['user'], ['secluded'], otherAdmin.tenantId)).rejects.toThrow(BadRequestError);
    });

    it('lets two tenants each have a role of one name, each carrying what its own tenant gave it', async () => {
        const first: Caller = await createCaller('first-admin', ['user'], ['tenant-admin']);
        const second: Caller = await createCaller('second-admin', ['user'], ['tenant-admin']);
        expect(await createOwnRole(first, 'scribe', [Permissions.INVOICES_EXPORT])).toBe(200);
        expect(await createOwnRole(second, 'scribe', [])).toBe(200);

        const firstScribe: Caller = await createCaller('first-scribe', ['user'], ['scribe'], first.tenantId);
        const secondScribe: Caller = await createCaller('second-scribe', ['user'], ['scribe'], second.tenantId);

        expect(await call('GET', '/invoices/export', firstScribe)).toBe(200);
        expect(await call('GET', '/invoices/export', secondScribe)).toBe(403);
    });

    it('refuses a name a shared role has, and a shared name a tenant has taken', async () => {
        const admin: Caller = await createCaller('admin', ['user'], ['tenant-admin']);
        const operator: Caller = await createCaller('operator', ['operator'], []);

        expect(await createOwnRole(admin, 'member', [])).toBe(400);

        expect(await createOwnRole(admin, 'bespoke', [])).toBe(200);
        expect(await call('POST', '/roles', operator, { name: 'bespoke', level: 'tenant', permissions: [] })).toBe(400);
        // a repository's create data takes what is stored, so the store's check is what stops this one
        await expect(inject(DefaultTestServerRoleRepository).create({ name: 'bespoke', level: 'tenant', permissions: [], description: undefined }))
            .rejects.toThrow(BadRequestError);
    });

    it('guards the roles of a tenant by tenant permissions, held in that tenant', async () => {
        const maker: Caller = await createCaller('maker', ['user'], ['role-maker']);
        const member: Caller = await createCaller('member', ['user'], ['member'], maker.tenantId);
        // allowed to define the roles every tenant shares, and holding nothing in this tenant
        const operator: Caller = await createCaller('operator', ['operator'], [], maker.tenantId);

        expect(await createOwnRole(maker, 'reader', [Permissions.INVOICES_READ])).toBe(200);
        expect(await createOwnRole(maker, 'widened', [Permissions.INVOICES_EXPORT])).toBe(403);
        expect(await createOwnRole(member, 'mine', [])).toBe(403);
        expect(await createOwnRole(operator, 'operated', [])).toBe(403);
    });

    it('refuses a role of another tenant than the one a request acts in', async () => {
        const admin: Caller = await createCaller('admin', ['user'], ['tenant-admin']);
        const other: Caller = await createCaller('other', ['user'], ['tenant-admin']);

        expect(await call('POST', '/roles', admin, { name: 'elsewhere', level: 'tenant', permissions: [], tenantId: other.tenantId })).toBe(403);
    });

    it('refuses a platform role of a tenant, however it is written', async () => {
        const admin: Caller = await createCaller('admin', ['user'], ['tenant-admin']);

        expect(await call('POST', '/roles', admin, { name: 'escalated', level: 'platform', permissions: [], tenantId: admin.tenantId })).toBe(400);
        await expect(inTenant(admin.tenantId, async () => await inject(DefaultTestServerRoleRepository)
            .create({ name: 'escalated', level: 'platform', permissions: [], description: undefined })))
            .rejects.toThrow(BadRequestError);
    });

    it('refuses deleting a tenant\'s own role its members hold, whatever another tenant holds', async () => {
        const first: Caller = await createCaller('first-admin', ['user'], ['tenant-admin']);
        const second: Caller = await createCaller('second-admin', ['user'], ['tenant-admin']);
        expect(await createOwnRole(first, 'keeper', [])).toBe(200);
        expect(await createOwnRole(second, 'keeper', [])).toBe(200);
        const firstHolder: Caller = await createCaller('first-holder', ['user'], ['keeper'], first.tenantId);
        await createCaller('second-holder', ['user'], ['keeper'], second.tenantId);

        expect(await call('DELETE', '/roles/keeper', first)).toBe(400);
        expect(await call('DELETE', `/roles/keeper/holders/${firstHolder.user.id}`, first)).toBe(204);
        expect(await call('DELETE', '/roles/keeper', first)).toBe(204);
        expect(await call('DELETE', '/roles/keeper', second)).toBe(400);
    });

    it('takes a permission from the holders of a tenant\'s own role on the next request', async () => {
        const admin: Caller = await createCaller('admin', ['user'], ['tenant-admin']);
        expect(await createOwnRole(admin, 'exporter', [Permissions.INVOICES_EXPORT])).toBe(200);
        const exporter: Caller = await createCaller('exporter', ['user'], ['exporter'], admin.tenantId);
        expect(await call('GET', '/invoices/export', exporter)).toBe(200);

        expect(await call('PATCH', '/roles/exporter', admin, { permissions: [] })).toBe(200);

        expect(await call('GET', '/invoices/export', exporter)).toBe(403);
    });

    it('takes a permission from the holders of a tenant\'s own role written from outside every tenant', async () => {
        const admin: Caller = await createCaller('admin', ['user'], ['tenant-admin']);
        expect(await createOwnRole(admin, 'shipper', [Permissions.INVOICES_EXPORT])).toBe(200);
        const shipper: Caller = await createCaller('shipper', ['user'], ['shipper'], admin.tenantId);
        const key: string = await keyOf(shipper);
        const exportAs: () => Promise<number> = async () => (await fetch(`${baseUrl}/invoices/export`, { headers: { 'x-api-key': key } })).status;
        expect(await exportAs()).toBe(200);

        // the way an instance applying what another one wrote is told, outside every tenant as well
        const repository: DefaultTestServerRoleRepository = inject(DefaultTestServerRoleRepository);
        const role: TestRole = await repository.findOne({ where: { name: 'shipper', tenantId: admin.tenantId }, acrossTenants: true });
        await repository.updateById(role.id, { permissions: [] }, { acrossTenants: true });

        expect(await exportAs()).toBe(403);
    });

    it('reads the roles of a tenant once, not with every request in it', async () => {
        const admin: Caller = await createCaller('admin', ['user'], ['tenant-admin']);
        expect(await createOwnRole(admin, 'counted', [Permissions.INVOICES_EXPORT])).toBe(200);
        const roleReads: () => number = () => roundTrips.trips.filter(trip => trip.statement.startsWith(`${TestRole.name}.`)).length;

        // the first check in the tenant after the write, which is the one giving the holder the role
        roundTrips.reset();
        const holder: Caller = await createCaller('holder', ['user'], ['counted'], admin.tenantId);
        expect(roleReads()).toBeGreaterThan(0);

        roundTrips.reset();
        expect(await call('GET', '/invoices/export', holder)).toBe(200);
        expect(await call('GET', '/invoices/export', holder)).toBe(200);
        expect(roleReads()).toBe(0);
    });
});

describe('evaluation/03-auth-and-security A9 - the roles of each tenant are checked when the application starts', () => {
    const tableOf: (entityClass: Newable<BaseEntity>) => string = entityClass => MetadataUtilities.getEntityMetadata(entityClass)?.tableName ?? '';

    it('refuses to start while a tenant\'s own role is a platform role', async () => {
        const dataSourceClass: Newable<InMemoryDataSource> = createDataSource();
        const first: StartedTestServer = await startApp(dataSourceClass);
        const tenantId: string = UUIDUtilities.generate();
        const role: TestRole = await inTenant(tenantId, async () => await inject(DefaultTestServerRoleRepository)
            .create({ name: 'promoted', level: 'tenant', permissions: [], description: undefined }));
        // past the repository, which refuses it
        const stored: Record<string, string> = {
            ...inMemoryStoreFor(dataSourceClass).readRow(tableOf(TestRole), role.id),
            level: JsonUtilities.stringify('platform')
        };
        inMemoryStoreFor(dataSourceClass).writeRow(tableOf(TestRole), role.id, stored);
        await first.shutdown();

        await expect(startApp(dataSourceClass)).rejects.toThrow(/'promoted'[\S\s]*platform/);
    }, TestTimeouts.inMemory.start);

    it('refuses to start while a membership holds a role of another tenant', async () => {
        const dataSourceClass: Newable<InMemoryDataSource> = createDataSource();
        const first: StartedTestServer = await startApp(dataSourceClass);
        const owner: string = UUIDUtilities.generate();
        await inTenant(owner, async () => await inject(DefaultTestServerRoleRepository)
            .create({ name: 'borrowed', level: 'tenant', permissions: [], description: undefined }));
        const member: Caller = await createCaller('member', ['user'], ['member']);
        const membership: TestMembership = await inTenant(member.tenantId, async () => await inject(DefaultTestServerMembershipRepository)
            .findOne({ where: { userId: member.user.id } }));
        // past the repository, which refuses it
        const stored: Record<string, string> = {
            ...inMemoryStoreFor(dataSourceClass).readRow(tableOf(TestMembership), membership.id),
            roles: JsonUtilities.stringify(['borrowed'])
        };
        inMemoryStoreFor(dataSourceClass).writeRow(tableOf(TestMembership), membership.id, stored);
        await first.shutdown();

        await expect(startApp(dataSourceClass)).rejects.toThrow(/'borrowed'[\S\s]*no tenant role/);
    }, TestTimeouts.inMemory.start);
});