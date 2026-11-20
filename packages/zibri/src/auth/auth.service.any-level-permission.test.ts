import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { TestTimeouts } from '../__testing__/constants';
import { JwtUser } from '../__testing__/mocks/entities/jwt-user.entity';
import { MemberRoles } from '../__testing__/mocks/entities/member-roles.enum';
import { Roles } from '../__testing__/mocks/entities/roles.enum';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { DefaultTestServerMembershipRepository } from '../__testing__/test-server/membership-repository';
import { defaultTestServerProviders, rolesAndPermissionsProviders, TestServerRole } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { type HttpRequestContext } from '../context/request/http-request.context';
import { type WebsocketRequestContext } from '../context/request/websocket-request.context';
import { Repository } from '../data-source/repository/repository';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { BaseEntity } from '../entity/base-entity.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';
import { denyAll, scopeFor } from '../entity/models/entity-scope.model';
import { InvalidDecoratorCombinationError } from '../error-handling/errors/invalid-decorator-combination.error';
import { InternalError } from '../error-handling/internal-error.model';
import { HttpMethod } from '../http/http-method.enum';
import { AuditAction, AuditOutcome, AuditReason } from '../logging/audit-event.model';
import { Log } from '../logging/log.model';
import { type LoggerInterface } from '../logging/logger.interface';
import { Controller } from '../routing/decorators/controller.decorator';
import { Get } from '../routing/decorators/get.decorator';
import { type RouterInterface } from '../routing/router.interface';
import { type TenantServiceInterface } from '../tenancy/tenant-service.interface';
import { Newable } from '../types/newable.type';
import { UUIDUtilities } from '../utilities/uuid.utilities';
import { type AuthServiceInterface } from './auth-service.interface';
import { Auth } from './decorators/auth.decorator';
import { AnyLevelPermissions } from './models/any-level-permissions.model';
import { definePermissions, definePlatformPermissions } from './roles/define-permissions.function';
import { type Permission } from './roles/permission.type';
import { type PlatformPermission } from './roles/platform-permission.type';
import { type RouteAuthServiceInterface } from './route-auth-service.interface';
import { ApiKeyAuthStrategy } from './strategies/api-key/api-key.auth-strategy';
import { ApiKey } from './strategies/api-key/api-key.model';
import { CreatedApiKey } from './strategies/api-key/created-api-key.model';
import { JwtAuthStrategy } from './strategies/jwt/jwt.auth-strategy';

// the users of an admin app are read by the operators of the application, who hold a permission of their own, and by
// the administrators of a tenant, who hold one in their tenant, through the same routes

// eslint-disable-next-line typescript/typedef
const Permissions = definePermissions(['members.read', 'notes.read'] as const);

// eslint-disable-next-line typescript/typedef
const PlatformPermissions = definePlatformPermissions(['users.read', 'tenants.read'] as const);

const MEMBERS_OR_USERS: AnyLevelPermissions = { permission: Permissions.MEMBERS_READ, platformPermission: PlatformPermissions.USERS_READ };

const roles: TestServerRole[] = [
    { name: Roles.USER, level: 'platform', permissions: [], description: undefined },
    { name: Roles.ADMIN, level: 'platform', permissions: [PlatformPermissions.USERS_READ], description: undefined },
    { name: MemberRoles.USER, level: 'tenant', permissions: [Permissions.NOTES_READ], description: undefined },
    { name: MemberRoles.ADMIN, level: 'tenant', permissions: [Permissions.MEMBERS_READ, Permissions.NOTES_READ], description: undefined }
];

/**
 * A row only a caller holding either permission reads, told apart by asking for them the way a route does.
 */
@Entity({
    tenant: 'shared',
    scope: {
        restrictedTo: scopeFor<MemberReport>(async context => await context.hasAnyLevelPermission(MEMBERS_OR_USERS) ? undefined : denyAll)
    }
})
class MemberReport extends BaseEntity {
    @Property.string()
    text!: string;
}

/**
 * What the application's own code is answered for the request it handles.
 */
type CodeAnswers = {
    service: boolean | undefined,
    scope: boolean
};

@Auth.hasAnyLevelPermission(MEMBERS_OR_USERS)
@Controller('/members')
class MemberController {
    @Get('/')
    list(): { ok: boolean } {
        return { ok: true };
    }

    @Auth.hasAnyLevelPermission.skip()
    @Auth.isLoggedIn()
    @Get('/code')
    async answerCode(): Promise<CodeAnswers> {
        const authService: AuthServiceInterface = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
        const request: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
        if (request == undefined) {
            throw new InternalError('A route is handled inside a request.');
        }
        return {
            service: await authService.hasAnyLevelPermission?.(request, authService.strategies, MEMBERS_OR_USERS),
            scope: (await inject<Repository<MemberReport>>(repositoryTokenFor(MemberReport)).findAll()).length > 0
        };
    }
}

// orphans: an application carrying one does not start, so they are resolved the way the router resolves them
@Auth.hasPlatformPermission(PlatformPermissions.TENANTS_READ)
@Controller('/combined', { allowOrphan: true })
class CombinedController {
    @Auth.hasAnyLevelPermission(MEMBERS_OR_USERS)
    @Get('/')
    besideTheController(): void {}

    @Auth.hasPlatformPermission.skip()
    @Auth.hasAnyLevelPermission(MEMBERS_OR_USERS)
    @Get('/skipped')
    skippingTheController(): void {}
}

@Controller('/undeclared', { allowOrphan: true })
class UndeclaredController {
    // @ts-expect-error - a plain string is no permission
    @Auth.hasAnyLevelPermission({ permission: 'members.delete', platformPermission: PlatformPermissions.USERS_READ })
    @Get('/tenant')
    undeclaredTenantPermission(): void {}

    // @ts-expect-error - a tenant permission is no platform permission
    @Auth.hasAnyLevelPermission({ permission: Permissions.MEMBERS_READ, platformPermission: Permissions.NOTES_READ })
    @Get('/platform')
    undeclaredPlatformPermission(): void {}
}

/**
 * A user and an api key acting as them in every tenant they are a member of.
 */
type Caller = {
    user: JwtUser,
    key: string
};

let server: StartedTestServer | undefined;
let baseUrl: string;

/**
 * Creates a user, and a key acting as them in every tenant they are a member of.
 * @param name - What sets the user's email apart.
 * @param platformRoles - The roles of their own.
 * @param memberships - The roles they hold, by tenant.
 * @param keyPermissions - The permissions their key may use, all their roles carry unless given.
 * @returns The user and the key.
 */
async function createCaller(
    name: string,
    platformRoles: Roles[],
    memberships: Record<string, MemberRoles[]>,
    keyPermissions?: (Permission | PlatformPermission)[]
): Promise<Caller> {
    const user: JwtUser = await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser))
        .create({ email: `${name}@any-level.test`, roles: platformRoles });
    for (const [tenantId, memberRoles] of Object.entries(memberships)) {
        await inject<TenantServiceInterface>(ZIBRI_DI_TOKENS.TENANT_SERVICE)
            .runAs(tenantId, async () => await inject(DefaultTestServerMembershipRepository).create({ tenantId, userId: user.id, roles: memberRoles }));
    }
    const authService: AuthServiceInterface = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
    const permissions: (Permission | PlatformPermission)[] = keyPermissions ?? await authService.resolveUserPermissions(user, undefined);
    const created: CreatedApiKey = await authService.createApiKey(
        user.id,
        { name, permissions, expiresAt: undefined, tenantId: undefined, clientAuthentication: undefined, requireDpop: false },
        undefined
    );
    return { user, key: created.key };
}

/**
 * Calls a route with an api key.
 * @param path - The route.
 * @param key - The key to send.
 * @param tenantId - The tenant the request is for, or none.
 * @returns The status of the answer.
 */
async function call(path: string, key: string, tenantId: string | undefined): Promise<number> {
    const headers: Record<string, string> = tenantId == undefined ? { 'x-api-key': key } : { 'x-api-key': key, 'x-tenant-id': tenantId };
    const res: Response = await fetch(`${baseUrl}${path}`, { headers });
    await res.body?.cancel();
    return res.status;
}

/**
 * Calls the route answering what the application's own code is answered.
 * @param key - The key to send.
 * @param tenantId - The tenant the request is for, or none.
 * @returns The answers.
 */
async function callCode(key: string, tenantId: string | undefined): Promise<CodeAnswers> {
    const headers: Record<string, string> = tenantId == undefined ? { 'x-api-key': key } : { 'x-api-key': key, 'x-tenant-id': tenantId };
    const res: Response = await fetch(`${baseUrl}/members/code`, { headers });
    expect(res.status).toBe(200);
    return await res.json() as CodeAnswers;
}

/**
 * What the audit trail recorded, in every tenant: a refusal is recorded in the tenant of its request.
 * @returns Whatever each entry carries under `context.metadata.audit`.
 */
async function auditEvents(): Promise<unknown[]> {
    await inject<LoggerInterface>(ZIBRI_DI_TOKENS.LOGGER).flush();
    return (await inject(repositoryTokenFor(Log)).findAll({ acrossTenants: true })).map(l => l.context.metadata?.['audit']);
}

describe('@Auth.hasAnyLevelPermission', () => {
    const tenantId: string = UUIDUtilities.generate();
    const otherTenantId: string = UUIDUtilities.generate();
    let tenantAdmin: Caller;
    let platformAdmin: Caller;
    let bothAdmin: Caller;
    let neither: Caller;

    beforeAll(async () => {
        const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
            entities: [...defaultTestServerEntities, ApiKey, MemberReport],
            repositories: defaultTestServerRepositories
        });
        server = await startTestServer({
            dataSources: [dataSourceClass],
            authStrategies: [JwtAuthStrategy, ApiKeyAuthStrategy],
            controllers: [MemberController],
            providers: [
                ...defaultTestServerProviders,
                ...rolesAndPermissionsProviders(
                    { permissions: Object.values(Permissions), platformPermissions: Object.values(PlatformPermissions) },
                    roles
                )
            ]
        });
        baseUrl = await server.start();

        inject<RouterInterface>(ZIBRI_DI_TOKENS.ROUTER).registerRoute({
            httpMethod: HttpMethod.GET,
            route: '/manual/members',
            openApi: { useInOpenApi: false },
            auth: { hasAnyLevelPermission: MEMBERS_OR_USERS },
            handler: () => 'members'
        });

        tenantAdmin = await createCaller('tenant-admin', [Roles.USER], { [tenantId]: [MemberRoles.ADMIN], [otherTenantId]: [MemberRoles.USER] });
        platformAdmin = await createCaller('platform-admin', [Roles.ADMIN], { [tenantId]: [MemberRoles.USER] });
        bothAdmin = await createCaller('both-admin', [Roles.ADMIN], { [tenantId]: [MemberRoles.ADMIN] });
        neither = await createCaller('neither', [Roles.USER], { [tenantId]: [MemberRoles.USER] });

        // outside a request, where the scope sees nothing
        await inject<Repository<MemberReport>>(repositoryTokenFor(MemberReport)).create({ text: 'every member' }, { unscoped: true });
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    it('passes with the tenant permission in the tenant of the request alone', async () => {
        expect(await call('/members', tenantAdmin.key, tenantId)).toBe(200);
    });

    it('passes with the platform permission alone, in a tenant and in none', async () => {
        expect(await call('/members', platformAdmin.key, tenantId)).toBe(200);
        expect(await call('/members', platformAdmin.key, undefined)).toBe(200);
    });

    it('passes with both permissions', async () => {
        expect(await call('/members', bothAdmin.key, tenantId)).toBe(200);
    });

    it('refuses a caller holding neither, recorded as a missing permission', async () => {
        expect(await call('/members', neither.key, tenantId)).toBe(403);

        expect(await auditEvents()).toContainEqual({
            action: AuditAction.AUTHORIZATION,
            outcome: AuditOutcome.FAILURE,
            reason: AuditReason.MISSING_PERMISSION,
            userId: neither.user.id
        });
    });

    it('refuses the tenant permission held in another tenant than the one of the request', async () => {
        // an admin of the one tenant, and a plain member of the other
        expect(await call('/members', tenantAdmin.key, otherTenantId)).toBe(403);
    });

    it('refuses the tenant permission of a deactivated membership', async () => {
        const paused: Caller = await createCaller('paused-admin', [Roles.USER], { [tenantId]: [MemberRoles.ADMIN] });
        expect(await call('/members', paused.key, tenantId)).toBe(200);

        await inject<TenantServiceInterface>(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(
            tenantId,
            async () => await inject(DefaultTestServerMembershipRepository).updateDeactivatedAt(paused.user.id, new Date(), undefined)
        );

        expect(await call('/members', paused.key, tenantId)).toBe(403);
    });

    it('refuses the tenant permission in a request naming no tenant, which only the platform permission passes', async () => {
        expect(await call('/members', tenantAdmin.key, undefined)).toBe(403);
    });

    it('holds a key to what it may use, as every check does', async () => {
        const narrowedTenantAdmin: Caller = await createCaller('narrowed-tenant-admin', [Roles.ADMIN], { [tenantId]: [MemberRoles.ADMIN] }, [Permissions.NOTES_READ]);
        const platformOnly: Caller = await createCaller('platform-only', [Roles.ADMIN], { [tenantId]: [MemberRoles.ADMIN] }, [PlatformPermissions.USERS_READ]);

        // its user holds both, and the key may use neither
        expect(await call('/members', narrowedTenantAdmin.key, tenantId)).toBe(403);
        expect(await call('/members', platformOnly.key, undefined)).toBe(200);
    });

    it('checks a manually registered route stating it as data the same way', async () => {
        expect(await call('/manual/members', tenantAdmin.key, tenantId)).toBe(200);
        expect(await call('/manual/members', platformAdmin.key, undefined)).toBe(200);
        expect(await call('/manual/members', neither.key, tenantId)).toBe(403);
        expect(await call('/manual/members', tenantAdmin.key, undefined)).toBe(403);
    });

    it('answers the application\'s own code and a scope as a route is answered, with skip leaving the route open', async () => {
        expect(await callCode(tenantAdmin.key, tenantId)).toEqual({ service: true, scope: true });
        expect(await callCode(platformAdmin.key, undefined)).toEqual({ service: true, scope: true });
        expect(await callCode(tenantAdmin.key, undefined)).toEqual({ service: false, scope: false });
        expect(await callCode(neither.key, tenantId)).toEqual({ service: false, scope: false });
    });

    it('refuses a route asking for it beside a permission of one level, unless the route skips that one', () => {
        const routeAuthService: RouteAuthServiceInterface = inject(ZIBRI_DI_TOKENS.ROUTE_AUTH_SERVICE);

        expect(() => routeAuthService.resolveRouteAuth(CombinedController, 'besideTheController')).toThrow(InvalidDecoratorCombinationError);
        expect(routeAuthService.resolveRouteAuth(CombinedController, 'skippingTheController').metadata).toMatchObject({
            hasPlatformPermission: undefined,
            hasAnyLevelPermission: { permission: Permissions.MEMBERS_READ, platformPermission: PlatformPermissions.USERS_READ }
        });
        expect(() => routeAuthService.validateRouteAuth(
            { hasAnyLevelPermission: MEMBERS_OR_USERS, hasPermission: { permission: Permissions.NOTES_READ } },
            'GET /manual/combined'
        )).toThrow(InvalidDecoratorCombinationError);
    });

    it('refuses a route naming a permission that is not declared at its level', () => {
        const routeAuthService: RouteAuthServiceInterface = inject(ZIBRI_DI_TOKENS.ROUTE_AUTH_SERVICE);

        expect(() => routeAuthService.resolveRouteAuth(UndeclaredController, 'undeclaredTenantPermission'))
            .toThrow(/'members\.delete'[\S\s]*not declared as a tenant permission/);
        expect(() => routeAuthService.resolveRouteAuth(UndeclaredController, 'undeclaredPlatformPermission'))
            .toThrow(/'notes\.read'[\S\s]*not declared as a platform permission/);
    });
});