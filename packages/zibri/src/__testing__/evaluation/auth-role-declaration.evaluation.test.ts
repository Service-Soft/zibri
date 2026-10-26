import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource, inMemoryStoreFor } from 'zibri-testing';

import { Auth } from '../../auth/decorators/auth.decorator';
import { definePermissions, definePlatformPermissions } from '../../auth/roles/define-permissions.function';
import { PermissionDeclaration } from '../../auth/roles/permission-declaration.model';
import { ApiKeyAuthStrategy } from '../../auth/strategies/api-key/api-key.auth-strategy';
import { ApiKey } from '../../auth/strategies/api-key/api-key.model';
import { JwtAuthStrategy } from '../../auth/strategies/jwt/jwt.auth-strategy';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { DiProvider } from '../../di/models/di-provider.model';
import { Property } from '../../entity/decorators/property.decorator';
import { HttpMethod } from '../../http/http-method.enum';
import { Body } from '../../routing/decorators/body.decorator';
import { Controller } from '../../routing/decorators/controller.decorator';
import { Get } from '../../routing/decorators/get.decorator';
import { Param } from '../../routing/decorators/param.decorator';
import { Patch } from '../../routing/decorators/patch.decorator';
import { type RouterInterface } from '../../routing/router.interface';
import { type TenantServiceInterface } from '../../tenancy/tenant-service.interface';
import { Newable } from '../../types/newable.type';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { TestTimeouts } from '../constants';
import { JwtUser } from '../mocks/entities/jwt-user.entity';
import { MemberRoles } from '../mocks/entities/member-roles.enum';
import { Roles } from '../mocks/entities/roles.enum';
import { TestRole } from '../mocks/entities/test-role.entity';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../test-server/create-test-data-source.function';
import { DefaultTestServerMembershipRepository } from '../test-server/membership-repository';
import { defaultTestServerProviders, rolesAndPermissionsProviders, TestServerRole } from '../test-server/providers';
import { DefaultTestServerRoleRepository } from '../test-server/role-repository';
import { StartedTestServer, startTestServer } from '../test-server/start-test-server.function';

/**
 * Executable form of evaluation/03-auth-and-security.md A5.
 *
 * A role was a string nothing declared: a route named one, an enum handed to the user entity listed
 * some, and nothing said the two agreed. A misspelled role booted and locked everyone out of its
 * route, and a role written to a user was checked against nothing at all outside a request body.
 * Permissions are declared in code and roles are rows carrying them, and everything naming or holding
 * either is checked against them - routes and the declaration at boot, roles, users and memberships
 * when they are written and once more when the application starts.
 */

// eslint-disable-next-line typescript/typedef
const Permissions = definePermissions(['invoices.read', 'invoices.export'] as const);

// export is carried by no role, which is allowed
const declared: PermissionDeclaration = { permissions: Object.values(Permissions), platformPermissions: [] };

const roles: TestServerRole[] = [
    { name: Roles.USER, level: 'platform', permissions: [], description: undefined },
    { name: Roles.ADMIN, level: 'platform', permissions: [], description: undefined },
    { name: MemberRoles.USER, level: 'tenant', permissions: [Permissions.INVOICES_READ], description: undefined },
    { name: MemberRoles.ADMIN, level: 'tenant', permissions: [Permissions.INVOICES_READ], description: undefined }
];

/**
 * The roles without one of them.
 * @param name - The role to leave out.
 * @returns The roles.
 */
function without(name: Roles | MemberRoles): TestServerRole[] {
    return roles.filter(role => role.name !== name);
}

class RolesBody {
    @Property.array({ items: { type: 'string', enum: Roles } })
    roles!: Roles[];
}

// orphans allowed here and below, since only some of the applications this file starts serve them
@Controller('/checks', { allowOrphan: true })
class ChecksController {
    @Auth.hasPermission(Permissions.INVOICES_READ)
    @Get('/members')
    members(): { ok: boolean } {
        return { ok: true };
    }

    @Auth.hasPermission(Permissions.INVOICES_EXPORT)
    @Get('/export')
    export(): { ok: boolean } {
        return { ok: true };
    }
}

@Controller('/accounts', { allowOrphan: true })
class AccountController {
    @Patch('/:id/roles')
    async setRoles(@Param.path('id') id: string, @Body(RolesBody) body: RolesBody): Promise<{ roles: string[] }> {
        const user: JwtUser = await users().updateById(id, { roles: body.roles });
        return { roles: user.roles };
    }
}

@Controller('/undeclared-permission', { allowOrphan: true })
class UndeclaredPermissionController {
    // @ts-expect-error - a plain string is no permission, which is what keeps a typo from compiling
    @Auth.hasPermission('invoices.delete')
    @Get('/')
    list(): { ok: boolean } {
        return { ok: true };
    }
}

let server: StartedTestServer | undefined;
let baseUrl: string;

/**
 * Creates a data source keeping its data in memory, for as long as the class lives.
 * @returns The data source class.
 */
function createDataSource(): Newable<InMemoryDataSource> {
    return createInMemoryDataSource({ entities: [...defaultTestServerEntities, ApiKey], repositories: defaultTestServerRepositories, allowOrphan: true });
}

/**
 * Starts an application keeping its data in memory.
 * @param controllers - The controllers it serves.
 * @param providers - What it runs with besides the defaults.
 * @param dataSourceClass - Where it keeps its data, a fresh store unless given.
 * @returns The server, started.
 */
async function startApp(
    controllers: Newable<unknown>[],
    providers: DiProvider<unknown>[],
    dataSourceClass: Newable<InMemoryDataSource> = createDataSource()
): Promise<StartedTestServer> {
    return await startTestServer({
        dataSources: [dataSourceClass],
        authStrategies: [JwtAuthStrategy, ApiKeyAuthStrategy],
        controllers,
        providers: [...defaultTestServerProviders, ...providers]
    });
}

/**
 * The users of the running application.
 * @returns Their repository.
 */
function users(): Repository<JwtUser> {
    return inject(repositoryTokenFor(JwtUser));
}

/**
 * Creates a membership in a new tenant.
 * @param user - The user.
 * @param memberRoles - The roles they hold there.
 * @returns The id of the tenant.
 */
async function createMembership(user: JwtUser, memberRoles: MemberRoles[]): Promise<string> {
    const tenantId: string = UUIDUtilities.generate();
    await inject<TenantServiceInterface>(ZIBRI_DI_TOKENS.TENANT_SERVICE)
        .runAs(tenantId, async () => await inject(DefaultTestServerMembershipRepository).create({ tenantId, userId: user.id, roles: memberRoles }));
    return tenantId;
}

/**
 * Deletes a role past the repository, as a statement run against the store would.
 * @param dataSourceClass - The data source the roles are kept in.
 * @param name - The role.
 */
async function deleteRolePastTheRepository(dataSourceClass: Newable<InMemoryDataSource>, name: string): Promise<void> {
    const role: TestRole = await inject(DefaultTestServerRoleRepository).findOne({ where: { name } });
    inMemoryStoreFor(dataSourceClass).deleteRow(MetadataUtilities.getEntityMetadata(TestRole)?.tableName ?? '', role.id);
}

describe('evaluation/03-auth-and-security A5 - the declaration and the roles are checked when the application starts', () => {
    it('starts an application whose routes name declared permissions, one of them carried by no role', async () => {
        const started: StartedTestServer = await startApp([ChecksController], rolesAndPermissionsProviders(declared, roles));
        await started.shutdown();
    }, TestTimeouts.inMemory.start);

    it('refuses a route naming a permission nobody declared', async () => {
        await expect(startApp([UndeclaredPermissionController], rolesAndPermissionsProviders(declared, roles)))
            .rejects.toThrow(/UndeclaredPermissionController\.list[\S\s]*invoices\.delete[\S\s]*not declared/);
    }, TestTimeouts.inMemory.start);

    it('refuses a route naming a permission in an application that declares none', async () => {
        await expect(startApp([ChecksController], rolesAndPermissionsProviders(undefined, [])))
            .rejects.toThrow(/ChecksController\.\w+[\S\s]*ZIBRI_DI_TOKENS\.PERMISSIONS/);
    }, TestTimeouts.inMemory.start);

    it('refuses a role named twice, also across levels', async () => {
        const twice: TestServerRole[] = [...roles, { name: Roles.ADMIN, level: 'tenant', permissions: [], description: undefined }];

        // a name is unique across both levels, so that it names one role wherever it is held
        await expect(startApp([], rolesAndPermissionsProviders(declared, twice))).rejects.toThrow(/TestRole already holds these values for "name"/);
    }, TestTimeouts.inMemory.start);

    it('refuses a permission declared twice, also across levels', async () => {
        const twice: PermissionDeclaration = { ...declared, permissions: [...declared.permissions, Permissions.INVOICES_READ] };
        const acrossLevels: PermissionDeclaration = { ...declared, platformPermissions: Object.values(definePlatformPermissions(['invoices.read'] as const)) };

        await expect(startApp([], rolesAndPermissionsProviders(twice, roles))).rejects.toThrow(/invoices\.read[\S\s]*declared more than once/);
        await expect(startApp([], rolesAndPermissionsProviders(acrossLevels, roles))).rejects.toThrow(/invoices\.read[\S\s]*declared more than once/);
    }, TestTimeouts.inMemory.start);

    it('refuses a role carrying a permission nobody declared', async () => {
        const carrying: PermissionDeclaration = { ...declared, permissions: [Permissions.INVOICES_EXPORT] };

        await expect(startApp([], rolesAndPermissionsProviders(carrying, roles))).rejects.toThrow(/invoices\.read[\S\s]*not declared/);
    }, TestTimeouts.inMemory.start);
});

describe('evaluation/03-auth-and-security A5 - a role is checked where it is written', () => {
    beforeAll(async () => {
        // ADMIN is no role here, so writing it to a user is writing a role that does not exist
        server = await startApp([AccountController], rolesAndPermissionsProviders(declared, without(Roles.ADMIN)));
        baseUrl = await server.start();
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, 30000);

    it('refuses a user holding a role that does not exist, on every way of writing one', async () => {
        await expect(users().create({ email: 'create@roles.test', roles: [Roles.ADMIN] })).rejects.toThrow(/'ADMIN'[\S\s]*does not exist/);
        await expect(users().createAll([{ email: 'create-all@roles.test', roles: [Roles.ADMIN] }])).rejects.toThrow(/'ADMIN'/);

        const user: JwtUser = await users().create({ email: 'update@roles.test', roles: [Roles.USER] });

        await expect(users().updateById(user.id, { roles: [Roles.ADMIN] })).rejects.toThrow(/'ADMIN'/);
        await expect(users().updateAll({ id: user.id }, { roles: [Roles.USER, Roles.ADMIN] })).rejects.toThrow(/'ADMIN'/);
        await expect(users().upsert(
            { email: user.email },
            { email: user.email, roles: [Roles.USER] },
            { roles: { set: [Roles.ADMIN] } }
        )).rejects.toThrow(/'ADMIN'/);
        expect((await users().findById(user.id)).roles).toEqual([Roles.USER]);
    });

    it('lets a write through that does not touch the roles', async () => {
        const user: JwtUser = await users().create({ email: 'untouched@roles.test', roles: [Roles.USER] });

        const updated: JwtUser = await users().updateById(user.id, { email: 'renamed@roles.test' });

        expect(updated.roles).toEqual([Roles.USER]);
    });

    it('answers a request writing a role that does not exist with 400', async () => {
        const user: JwtUser = await users().create({ email: 'http@roles.test', roles: [Roles.USER] });

        const res: Response = await fetch(`${baseUrl}/accounts/${user.id}/roles`, {
            method: HttpMethod.PATCH,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ roles: [Roles.ADMIN] })
        });

        expect(res.status).toBe(400);
        expect((await users().findById(user.id)).roles).toEqual([Roles.USER]);
    });

    it('refuses renaming a role somebody holds, or moving it to the other level, on every way of writing one', async () => {
        const user: JwtUser = await users().create({ email: 'holder@roles.test', roles: [Roles.USER] });
        const roleRepository: DefaultTestServerRoleRepository = inject(DefaultTestServerRoleRepository);
        const role: TestRole = await roleRepository.findOne({ where: { name: Roles.USER } });

        await expect(roleRepository.updateById(role.id, { name: 'PERSON' })).rejects.toThrow(/'USER'[\S\s]*still held/);
        await expect(roleRepository.updateAll({ name: Roles.USER }, { level: 'tenant' })).rejects.toThrow(/'USER'[\S\s]*still held/);
        expect((await users().findById(user.id)).roles).toEqual([Roles.USER]);
        // what the application keeps about a role besides is no matter to its holders
        await roleRepository.updateById(role.id, { description: 'everybody' });
    });

    it('refuses registering a manual route naming a permission nobody declared', () => {
        const router: RouterInterface = inject(ZIBRI_DI_TOKENS.ROUTER);

        expect(() => router.registerRoute({
            httpMethod: HttpMethod.GET,
            route: '/manual/operators',
            openApi: { useInOpenApi: false },
            // @ts-expect-error - a plain string is no permission
            auth: { hasPlatformPermission: { permission: 'invoices.delete' } },
            handler: () => 'never'
        })).toThrow(/GET \/manual\/operators[\S\s]*invoices\.delete[\S\s]*not declared/);
    });
});

describe('evaluation/03-auth-and-security A5 - a role is written at its own level', () => {
    it('refuses a user holding a tenant role, and a membership holding a platform role', async () => {
        const crossed: TestServerRole[] = [
            { name: Roles.USER, level: 'platform', permissions: [], description: undefined },
            { name: Roles.ADMIN, level: 'tenant', permissions: [], description: undefined },
            { name: MemberRoles.USER, level: 'platform', permissions: [], description: undefined },
            { name: MemberRoles.ADMIN, level: 'tenant', permissions: [], description: undefined }
        ];
        const started: StartedTestServer = await startApp([], rolesAndPermissionsProviders(declared, crossed));
        try {
            const user: JwtUser = await users().create({ email: 'levels@roles.test', roles: [Roles.USER] });

            await expect(users().updateById(user.id, { roles: [Roles.ADMIN] })).rejects.toThrow(/'ADMIN'[\S\s]*tenant role/);
            await expect(createMembership(user, [MemberRoles.USER])).rejects.toThrow(/MEMBER_USER[\S\s]*platform role/);
            await createMembership(user, [MemberRoles.ADMIN]);
        }
        finally {
            await started.shutdown();
        }
    }, TestTimeouts.inMemory.start);
});

describe('evaluation/03-auth-and-security A5 - a stored role that no longer exists is refused at startup', () => {
    it('refuses to start while a user holds a role that no longer exists', async () => {
        const dataSourceClass: Newable<InMemoryDataSource> = createDataSource();
        const first: StartedTestServer = await startApp([], rolesAndPermissionsProviders(declared, roles), dataSourceClass);
        await users().create({ email: 'stale@roles.test', roles: [Roles.USER, Roles.ADMIN] });
        await deleteRolePastTheRepository(dataSourceClass, Roles.ADMIN);
        await first.shutdown();

        await expect(startApp([], rolesAndPermissionsProviders(declared, without(Roles.ADMIN)), dataSourceClass))
            .rejects.toThrow(/'ADMIN'[\S\s]*no platform role/);
    }, TestTimeouts.inMemory.start);

    it('refuses to start while a membership holds a role that no longer exists', async () => {
        const dataSourceClass: Newable<InMemoryDataSource> = createDataSource();
        const first: StartedTestServer = await startApp([], rolesAndPermissionsProviders(declared, roles), dataSourceClass);
        const user: JwtUser = await users().create({ email: 'stale-member@roles.test', roles: [Roles.USER] });
        await createMembership(user, [MemberRoles.ADMIN]);
        await deleteRolePastTheRepository(dataSourceClass, MemberRoles.ADMIN);
        await first.shutdown();

        await expect(startApp([], rolesAndPermissionsProviders(declared, without(MemberRoles.ADMIN)), dataSourceClass))
            .rejects.toThrow(/MEMBER_ADMIN[\S\s]*no tenant role/);
    }, TestTimeouts.inMemory.start);
});