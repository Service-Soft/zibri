import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { type AuthServiceInterface } from '../../auth/auth-service.interface';
import { Auth } from '../../auth/decorators/auth.decorator';
import { definePermissions, definePlatformPermissions } from '../../auth/roles/define-permissions.function';
import { PermissionDeclaration } from '../../auth/roles/permission-declaration.model';
import { type Permission } from '../../auth/roles/permission.type';
import { ApiKeyAuthStrategy } from '../../auth/strategies/api-key/api-key.auth-strategy';
import { ApiKey } from '../../auth/strategies/api-key/api-key.model';
import { CreatedApiKey } from '../../auth/strategies/api-key/created-api-key.model';
import { JwtAuthStrategy } from '../../auth/strategies/jwt/jwt.auth-strategy';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { DiProvider } from '../../di/models/di-provider.model';
import { HttpMethod } from '../../http/http-method.enum';
import { Log } from '../../logging/log.model';
import { type LoggerInterface } from '../../logging/logger.interface';
import { Controller } from '../../routing/decorators/controller.decorator';
import { Get } from '../../routing/decorators/get.decorator';
import { type RouterInterface } from '../../routing/router.interface';
import { type TenantServiceInterface } from '../../tenancy/tenant-service.interface';
import { Newable } from '../../types/newable.type';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { TestTimeouts } from '../constants';
import { JwtUser } from '../mocks/entities/jwt-user.entity';
import { MemberRoles } from '../mocks/entities/member-roles.enum';
import { Roles } from '../mocks/entities/roles.enum';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../test-server/create-test-data-source.function';
import { DefaultTestServerMembershipRepository } from '../test-server/membership-repository';
import { defaultTestServerProviders, rolesAndPermissionsProviders, TestServerRole } from '../test-server/providers';
import { StartedTestServer, startTestServer } from '../test-server/start-test-server.function';

/**
 * Executable form of evaluation/03-auth-and-security.md A2, the half above the row.
 *
 * Authorization was roles only: a route listed the roles it lets in, so what a role may do was spread
 * over every route that names it, and a role standing above another was a list each route had to
 * spell out in full. Permissions are what a route names now, each role carries a set of them, and a
 * role above another is one whose set includes the other's.
 */

// eslint-disable-next-line typescript/typedef
const Permissions = definePermissions(['invoices.read', 'invoices.export'] as const);

// eslint-disable-next-line typescript/typedef
const PlatformPermissions = definePlatformPermissions(['tenants.manage'] as const);

const memberPermissions: Permission[] = [Permissions.INVOICES_READ];

const declared: PermissionDeclaration = {
    permissions: Object.values(Permissions),
    platformPermissions: Object.values(PlatformPermissions)
};

const roles: TestServerRole[] = [
    { name: MemberRoles.USER, level: 'tenant', permissions: memberPermissions, description: undefined },
    // an admin may do everything a user may, and more
    { name: MemberRoles.ADMIN, level: 'tenant', permissions: [...memberPermissions, Permissions.INVOICES_EXPORT], description: undefined },
    { name: Roles.USER, level: 'platform', permissions: [], description: undefined },
    { name: Roles.ADMIN, level: 'platform', permissions: [PlatformPermissions.TENANTS_MANAGE], description: undefined }
];

@Controller('/invoices')
class InvoiceController {
    @Auth.hasPermission(Permissions.INVOICES_READ)
    @Get('/')
    list(): { ok: boolean } {
        return { ok: true };
    }

    @Auth.hasPermission(Permissions.INVOICES_EXPORT)
    @Get('/export')
    export(): { ok: boolean } {
        return { ok: true };
    }
}

// orphans allowed, since only the application refusing them serves them
@Controller('/manage', { allowOrphan: true })
class WrongLevelController {
    // a tenant check naming a permission declared for platform roles, which no membership can hold
    // @ts-expect-error - a platform permission is no tenant permission
    @Auth.hasPermission(PlatformPermissions.TENANTS_MANAGE)
    @Get('/')
    manage(): { ok: boolean } {
        return { ok: true };
    }
}

@Auth.hasPlatformPermission(PlatformPermissions.TENANTS_MANAGE)
@Controller('/tenants')
class TenantController {
    @Get('/')
    list(): { ok: boolean } {
        return { ok: true };
    }

    @Auth.hasPlatformPermission.skip()
    @Auth.isLoggedIn()
    @Get('/own')
    own(): { ok: boolean } {
        return { ok: true };
    }
}

// orphans allowed, since only the application refusing them serves them
@Controller('/misspelled', { allowOrphan: true })
class MisspelledController {
    // @ts-expect-error - a plain string is no permission, which is what keeps a typo from compiling
    @Auth.hasPermission('invoices.exports')
    @Get('/')
    list(): { ok: boolean } {
        return { ok: true };
    }
}

let server: StartedTestServer | undefined;
let baseUrl: string;

/**
 * Provides a declaration of permissions, and the roles of this suite when there is one.
 * @param declaration - The declaration, or undefined for none.
 * @returns The providers.
 */
function declarationProviders(declaration: PermissionDeclaration | undefined): DiProvider<unknown>[] {
    return rolesAndPermissionsProviders(declaration, declaration == undefined ? [] : roles);
}

/**
 * Starts an application keeping its data in memory.
 * @param controllers - The controllers it serves.
 * @param providers - What it runs with besides the defaults.
 * @returns The server, started.
 */
async function startApp(controllers: Newable<unknown>[], providers: DiProvider<unknown>[]): Promise<StartedTestServer> {
    const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
        entities: [...defaultTestServerEntities, ApiKey],
        repositories: defaultTestServerRepositories,
        allowOrphan: true
    });
    return await startTestServer({
        dataSources: [dataSourceClass],
        authStrategies: [JwtAuthStrategy, ApiKeyAuthStrategy],
        controllers,
        providers: [...defaultTestServerProviders, ...providers]
    });
}

/**
 * A user and the tenant they are a member of.
 */
type Member = {
    user: JwtUser,
    tenantId: string
};

/**
 * Creates a user who is a member of a new tenant.
 * @param name - What sets the user's email apart.
 * @param platformRoles - The roles of the user's own.
 * @param memberRoles - The roles they hold in the tenant.
 * @returns The user and the id of the tenant.
 */
async function createMember(name: string, platformRoles: Roles[], memberRoles: MemberRoles[]): Promise<Member> {
    const user: JwtUser = await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser))
        .create({ email: `${name}@permissions.test`, roles: platformRoles });
    const tenantId: string = UUIDUtilities.generate();
    await inject<TenantServiceInterface>(ZIBRI_DI_TOKENS.TENANT_SERVICE)
        .runAs(tenantId, async () => await inject(DefaultTestServerMembershipRepository).create({ tenantId, userId: user.id, roles: memberRoles }));
    return { user, tenantId };
}

/**
 * Creates an api key bound to the tenant of a member.
 * @param member - The member the key acts as.
 * @param permissions - The permissions the key may use, all their roles carry there unless given.
 * @returns The key.
 */
async function createKey(member: Member, permissions?: Permission[]): Promise<string> {
    const authService: AuthServiceInterface = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
    const created: CreatedApiKey = await authService.createApiKey(
        member.user.id,
        {
            name: 'permissions',
            permissions: permissions ?? await authService.resolveUserPermissions(member.user, member.tenantId),
            expiresAt: undefined,
            tenantId: member.tenantId,
            clientAuthentication: undefined,
            requireDpop: false
        },
        undefined
    );
    return created.key;
}

/**
 * Calls a route with an api key.
 * @param path - The route.
 * @param key - The key to send.
 * @returns The status of the answer.
 */
async function call(path: string, key: string): Promise<number> {
    return (await fetch(`${baseUrl}${path}`, { headers: { 'x-api-key': key } })).status;
}

/**
 * What the audit trail recorded.
 * @returns Whatever each entry carries under `context.metadata.audit`.
 */
async function auditEvents(): Promise<unknown[]> {
    await inject<LoggerInterface>(ZIBRI_DI_TOKENS.LOGGER).flush();
    // across tenants, since a refusal is recorded in the tenant of the request it refused
    return (await inject(repositoryTokenFor(Log)).findAll({ acrossTenants: true })).map(l => l.context.metadata?.['audit']);
}

describe('evaluation/03-auth-and-security A2 - a route names a permission, and a role carries it', () => {
    beforeAll(async () => {
        server = await startApp([InvoiceController, TenantController], declarationProviders(declared));
        baseUrl = await server.start();
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, 30000);

    it('lets a member in through a permission one of their roles carries in the tenant', async () => {
        const member: Member = await createMember('ada', [Roles.USER], [MemberRoles.ADMIN]);

        expect(await call('/invoices/export', await createKey(member))).toBe(200);
    });

    it('refuses a member none of whose roles carries it, and records why', async () => {
        const member: Member = await createMember('ben', [Roles.USER], [MemberRoles.USER]);

        expect(await call('/invoices/export', await createKey(member))).toBe(403);
        expect(await auditEvents()).toContainEqual(expect.objectContaining({ reason: 'missing-permission', userId: member.user.id }));
    });

    it('lets a role above another in through every permission of the one below', async () => {
        const admin: Member = await createMember('carl', [Roles.USER], [MemberRoles.ADMIN]);
        const member: Member = await createMember('dan', [Roles.USER], [MemberRoles.USER]);

        expect(await call('/invoices', await createKey(admin))).toBe(200);
        expect(await call('/invoices', await createKey(member))).toBe(200);
    });

    it('holds only the permissions a key may use', async () => {
        const member: Member = await createMember('eve', [Roles.USER], [MemberRoles.USER, MemberRoles.ADMIN]);

        expect(await call('/invoices/export', await createKey(member, [Permissions.INVOICES_READ]))).toBe(403);
        expect(await call('/invoices/export', await createKey(member, [Permissions.INVOICES_READ, Permissions.INVOICES_EXPORT]))).toBe(200);
    });

    it('reads a platform permission off the roles of the user\'s own, never off a membership', async () => {
        const operator: Member = await createMember('fay', [Roles.ADMIN], [MemberRoles.USER]);
        // an admin of their tenant, which makes them nobody to the platform
        const tenantAdmin: Member = await createMember('gus', [Roles.USER], [MemberRoles.ADMIN]);

        expect(await call('/tenants', await createKey(operator))).toBe(200);
        expect(await call('/tenants', await createKey(tenantAdmin))).toBe(403);
    });

    it('lets a route skip the permission its controller names', async () => {
        const member: Member = await createMember('hal', [Roles.USER], [MemberRoles.USER]);

        expect(await call('/tenants/own', await createKey(member))).toBe(200);
    });

    it('checks a permission on a manually registered route too', async () => {
        const router: RouterInterface = inject(ZIBRI_DI_TOKENS.ROUTER);
        router.registerRoute({
            httpMethod: HttpMethod.GET,
            route: '/manual/export',
            openApi: { useInOpenApi: false },
            auth: { hasPermission: { permission: Permissions.INVOICES_EXPORT } },
            handler: () => 'exported'
        });
        const admin: Member = await createMember('ida', [Roles.USER], [MemberRoles.ADMIN]);
        const member: Member = await createMember('jon', [Roles.USER], [MemberRoles.USER]);

        expect(await call('/manual/export', await createKey(admin))).toBe(200);
        expect(await call('/manual/export', await createKey(member))).toBe(403);
    });

    it('refuses to register a manual route naming a permission nobody declared', () => {
        const router: RouterInterface = inject(ZIBRI_DI_TOKENS.ROUTER);

        expect(() => router.registerRoute({
            httpMethod: HttpMethod.GET,
            route: '/manual/misspelled',
            openApi: { useInOpenApi: false },
            // @ts-expect-error - a plain string is no permission
            auth: { hasPlatformPermission: { permission: 'invoices.exports' } },
            handler: () => 'never'
        })).toThrow(/GET \/manual\/misspelled[\S\s]*invoices\.exports[\S\s]*not declared/);
    });
});

describe('evaluation/03-auth-and-security A2 - a permission nobody declared is refused at startup', () => {
    it('refuses a route naming a permission nobody declared', async () => {
        await expect(startApp([MisspelledController], declarationProviders(declared)))
            .rejects.toThrow(/MisspelledController\.list[\S\s]*invoices\.exports[\S\s]*not declared/);
    }, TestTimeouts.inMemory.start);

    it('refuses a tenant check naming a permission declared only for platform roles', async () => {
        await expect(startApp([WrongLevelController], declarationProviders(declared)))
            .rejects.toThrow(/WrongLevelController\.manage[\S\s]*tenants\.manage[\S\s]*not declared as a tenant permission/);
    }, TestTimeouts.inMemory.start);

    it('refuses a route naming a permission in an application that declares none', async () => {
        await expect(startApp([InvoiceController], declarationProviders(undefined)))
            .rejects.toThrow(/InvoiceController\.\w+[\S\s]*ZIBRI_DI_TOKENS\.PERMISSIONS/);
    }, TestTimeouts.inMemory.start);
});