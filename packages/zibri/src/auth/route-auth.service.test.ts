import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { type AuthServiceInterface } from './auth-service.interface';
import { AuthorizationServerController } from './authorization-server/authorization-server-controller.model';
import { Auth } from './decorators/auth.decorator';
import { definePermissions, definePlatformPermissions } from './roles/define-permissions.function';
import { PermissionDeclaration } from './roles/permission-declaration.model';
import { type Permission } from './roles/permission.type';
import { type PlatformPermission } from './roles/platform-permission.type';
import { BaseScimProvisioner } from './scim/base-scim-provisioner';
import { ScimController } from './scim/scim-controller.model';
import { ScimGroupMember } from './scim/scim-group-member.model';
import { ScimGroup } from './scim/scim-group.model';
import { ScimUserValue } from './scim/scim-user-value.model';
import { ScimUser } from './scim/scim-user.model';
import { TestTimeouts } from '../__testing__/constants';
import { ApiKeyAuthStrategy } from './strategies/api-key/api-key.auth-strategy';
import { ApiKey } from './strategies/api-key/api-key.model';
import { CreatedApiKey } from './strategies/api-key/created-api-key.model';
import { ClientAccessTokenAuthStrategy } from './strategies/client-access-token/client-access-token.auth-strategy';
import { JwtAuthStrategy } from './strategies/jwt/jwt.auth-strategy';
import { JwtUser } from '../__testing__/mocks/entities/jwt-user.entity';
import { MemberRoles } from '../__testing__/mocks/entities/member-roles.enum';
import { Roles } from '../__testing__/mocks/entities/roles.enum';
import { TestMembership } from '../__testing__/mocks/entities/test-membership.entity';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { DefaultTestServerMembershipRepository } from '../__testing__/test-server/membership-repository';
import { defaultTestServerProviders, rolesAndPermissionsProviders, TestServerRole } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { Repository } from '../data-source/repository/repository';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { defineProvider, DiProvider } from '../di/models/di-provider.model';
import { InternalError } from '../error-handling/internal-error.model';
import { HttpMethod } from '../http/http-method.enum';
import { Log } from '../logging/log.model';
import { type LoggerInterface } from '../logging/logger.interface';
import { Controller } from '../routing/decorators/controller.decorator';
import { Get } from '../routing/decorators/get.decorator';
import { type RouterInterface } from '../routing/router.interface';
import { type TenantServiceInterface } from '../tenancy/tenant-service.interface';
import { Newable } from '../types/newable.type';
import { UUIDUtilities } from '../utilities/uuid.utilities';

// eslint-disable-next-line typescript/typedef
const Permissions = definePermissions(['invoices.read', 'invoices.export', 'invoices.archive'] as const);

// eslint-disable-next-line typescript/typedef
const PlatformPermissions = definePlatformPermissions(['tenants.manage', 'tokens.introspect'] as const);

const declared: PermissionDeclaration = {
    permissions: Object.values(Permissions),
    platformPermissions: Object.values(PlatformPermissions)
};

// archive is carried by no role, which is allowed
const roles: TestServerRole[] = [
    { name: MemberRoles.USER, level: 'tenant', permissions: [Permissions.INVOICES_READ], description: undefined },
    { name: MemberRoles.ADMIN, level: 'tenant', permissions: [Permissions.INVOICES_READ, Permissions.INVOICES_EXPORT], description: undefined },
    { name: Roles.USER, level: 'platform', permissions: [], description: undefined },
    { name: Roles.ADMIN, level: 'platform', permissions: [PlatformPermissions.TENANTS_MANAGE], description: undefined }
];

// orphans allowed here and below, since only some of the applications this file starts serve them
@Controller('/invoices', { allowOrphan: true })
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

    @Auth.hasPermission(Permissions.INVOICES_ARCHIVE)
    @Get('/archive')
    archive(): { ok: boolean } {
        return { ok: true };
    }
}

@Auth.hasPlatformPermission(PlatformPermissions.TENANTS_MANAGE)
@Controller('/tenants', { allowOrphan: true })
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

@Controller('/misspelled', { allowOrphan: true })
class MisspelledController {
    // @ts-expect-error - a plain string is no permission, which is what keeps a typo from compiling
    @Auth.hasPermission('invoices.exports')
    @Get('/')
    list(): { ok: boolean } {
        return { ok: true };
    }
}

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

/**
 * Provisions nobody: the applications it is declared in are refused before anything is provisioned.
 */
class UnusedScimProvisioner extends BaseScimProvisioner<JwtUser, TestMembership> {
    async findProvisionedUser(): Promise<JwtUser | undefined> {
        return await Promise.reject(new InternalError('Nothing is provisioned in this suite.'));
    }

    async createProvisionedUser(): Promise<JwtUser> {
        return await Promise.reject(new InternalError('Nothing is provisioned in this suite.'));
    }

    async resolveUpdatedUser(): Promise<void> {
        await Promise.reject(new InternalError('Nothing is provisioned in this suite.'));
    }

    async resolveGroupMembership(): Promise<void> {
        await Promise.reject(new InternalError('Nothing is provisioned in this suite.'));
    }

    async resolveDeletedUser(): Promise<void> {
        await Promise.reject(new InternalError('Nothing is provisioned in this suite.'));
    }
}

@Controller('/scim/v2', { allowOrphan: true })
// @ts-expect-error - a plain string is no permission
class MisspelledScimController extends ScimController(UnusedScimProvisioner, { permission: 'scim.provisions' }) {}

@Controller('/oauth2', { allowOrphan: true })
// @ts-expect-error - a plain string is no permission
class MisspelledAuthorizationServerController extends AuthorizationServerController({ introspectionPermission: 'tokens.introspects', resources: [] }) {}

/**
 * A user who is a member of a tenant, and an api key acting as them there.
 */
type Member = {
    user: JwtUser,
    key: string
};

let server: StartedTestServer | undefined;
let baseUrl: string;

/**
 * Starts an application keeping its data in memory.
 * @param controllers - The controllers it serves.
 * @param providers - What it runs with besides the defaults, the declaration of this file unless given.
 * @returns The server, started.
 */
async function startApp(
    controllers: Newable<unknown>[],
    providers: DiProvider<unknown>[] = rolesAndPermissionsProviders(declared, roles)
): Promise<StartedTestServer> {
    const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
        entities: [...defaultTestServerEntities, ApiKey, ScimUser, ScimUserValue, ScimGroup, ScimGroupMember],
        repositories: defaultTestServerRepositories,
        allowOrphan: true
    });
    return await startTestServer({
        dataSources: [dataSourceClass],
        authStrategies: [JwtAuthStrategy, ApiKeyAuthStrategy, ClientAccessTokenAuthStrategy],
        controllers,
        providers: [...defaultTestServerProviders, ...providers]
    });
}

/**
 * Expects an application to be refused when it starts.
 * @param start - The start.
 * @param refusal - What the refusal says.
 */
async function expectStartRefused(start: Promise<StartedTestServer>, refusal: RegExp): Promise<void> {
    // one that starts after all is shut down again, so the cases after it start on their own
    await expect(start.then(async started => await started.shutdown())).rejects.toThrow(refusal);
}

/**
 * Creates a user who is a member of a new tenant, and an api key acting as them there.
 * @param name - What sets the user's email apart.
 * @param platformRoles - The roles of the user's own.
 * @param memberRoles - The roles they hold in the tenant.
 * @returns The user, and the key, which may use all their roles carry there.
 */
async function createMember(name: string, platformRoles: Roles[], memberRoles: MemberRoles[]): Promise<Member> {
    const user: JwtUser = await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser))
        .create({ email: `${name}@route-auth.test`, roles: platformRoles });
    const tenantId: string = UUIDUtilities.generate();
    await inject<TenantServiceInterface>(ZIBRI_DI_TOKENS.TENANT_SERVICE)
        .runAs(tenantId, async () => await inject(DefaultTestServerMembershipRepository).create({ tenantId, userId: user.id, roles: memberRoles }));
    const authService: AuthServiceInterface = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
    const permissions: (Permission | PlatformPermission)[] = await authService.resolveUserPermissions(user, tenantId);
    const created: CreatedApiKey = await authService.createApiKey(
        user.id,
        { name, permissions, expiresAt: undefined, tenantId, clientAuthentication: undefined, requireDpop: false },
        undefined
    );
    return { user, key: created.key };
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

describe('RouteAuthService - a route naming a permission', () => {
    beforeAll(async () => {
        server = await startApp([InvoiceController, TenantController]);
        baseUrl = await server.start();
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
        server = undefined;
    }, TestTimeouts.inMemory.shutdown);

    it('lets a member in through a permission one of their roles carries, and refuses one none of whose roles does, recording why', async () => {
        const admin: Member = await createMember('ada', [Roles.USER], [MemberRoles.ADMIN]);
        const member: Member = await createMember('ben', [Roles.USER], [MemberRoles.USER]);

        // a role above another is one carrying every permission of the one below
        expect(await call('/invoices', admin.key)).toBe(200);
        expect(await call('/invoices', member.key)).toBe(200);
        expect(await call('/invoices/export', admin.key)).toBe(200);
        expect(await call('/invoices/export', member.key)).toBe(403);
        expect(await auditEvents()).toContainEqual(expect.objectContaining({ reason: 'missing-permission', userId: member.user.id }));
    });

    it('lets nobody in through a declared permission no role carries', async () => {
        const admin: Member = await createMember('cid', [Roles.ADMIN], [MemberRoles.ADMIN]);

        expect(await call('/invoices/archive', admin.key)).toBe(403);
    });

    it('lets a route skip the permission its controller names', async () => {
        const member: Member = await createMember('hal', [Roles.USER], [MemberRoles.USER]);

        expect(await call('/tenants', member.key)).toBe(403);
        expect(await call('/tenants/own', member.key)).toBe(200);
    });

    it('checks a permission on a manually registered route too', async () => {
        inject<RouterInterface>(ZIBRI_DI_TOKENS.ROUTER).registerRoute({
            httpMethod: HttpMethod.GET,
            route: '/manual/export',
            openApi: { useInOpenApi: false },
            auth: { hasPermission: { permission: Permissions.INVOICES_EXPORT } },
            handler: () => 'exported'
        });
        const admin: Member = await createMember('ida', [Roles.USER], [MemberRoles.ADMIN]);
        const member: Member = await createMember('jon', [Roles.USER], [MemberRoles.USER]);

        expect(await call('/manual/export', admin.key)).toBe(200);
        expect(await call('/manual/export', member.key)).toBe(403);
    });

    it('refuses to register a manual route naming a permission nobody declared', () => {
        expect(() => inject<RouterInterface>(ZIBRI_DI_TOKENS.ROUTER).registerRoute({
            httpMethod: HttpMethod.GET,
            route: '/manual/misspelled',
            openApi: { useInOpenApi: false },
            // @ts-expect-error - a plain string is no permission
            auth: { hasPlatformPermission: { permission: 'invoices.exports' } },
            handler: () => 'never'
        })).toThrow(/GET \/manual\/misspelled[\S\s]*invoices\.exports[\S\s]*not declared/);
    });
});

// a misspelled permission booted and locked everyone out of what named it, so each place naming one
// is checked when the application starts
describe('RouteAuthService - starting', () => {
    it('refuses a route naming a permission nobody declared', async () => {
        await expectStartRefused(startApp([MisspelledController]), /MisspelledController\.list[\S\s]*invoices\.exports[\S\s]*not declared/);
    }, TestTimeouts.inMemory.start);

    it('refuses a tenant check naming a permission declared only for platform roles', async () => {
        await expectStartRefused(
            startApp([WrongLevelController]),
            /WrongLevelController\.manage[\S\s]*tenants\.manage[\S\s]*not declared as a tenant permission/
        );
    }, TestTimeouts.inMemory.start);

    it('refuses a route naming a permission in an application that declares none', async () => {
        await expectStartRefused(startApp([InvoiceController], rolesAndPermissionsProviders(undefined, [])), /InvoiceController\.\w+[\S\s]*ZIBRI_DI_TOKENS\.PERMISSIONS/);
    }, TestTimeouts.inMemory.start);

    it('refuses a SCIM controller naming a permission that is not declared', async () => {
        await expectStartRefused(startApp([MisspelledScimController]), /MisspelledScimController[\S\s]*scim\.provisions[\S\s]*not declared/);
    }, TestTimeouts.inMemory.start);

    it('refuses an authorization server whose introspection names a permission that is not declared', async () => {
        await expectStartRefused(
            startApp([MisspelledAuthorizationServerController]),
            /introspectionPermission[\S\s]*tokens\.introspects[\S\s]*not declared/
        );
    }, TestTimeouts.inMemory.start);

    it('refuses the OpenAPI routes naming a permission that is not declared', async () => {
        const openApiAuth: DiProvider<unknown> = defineProvider({
            token: ZIBRI_DI_TOKENS.OPEN_API_AUTH,
            // @ts-expect-error - a plain string is no permission
            useValue: { hasPlatformPermission: { permission: 'docs.reads' } }
        });
        await expectStartRefused(startApp([], [...rolesAndPermissionsProviders(declared, roles), openApiAuth]), /'docs\.reads'[\S\s]*not declared/);
    }, TestTimeouts.inMemory.start);
});