import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { type AuthServiceInterface } from '../../auth/auth-service.interface';
import { Auth } from '../../auth/decorators/auth.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { type RouteAuthConfiguration } from '../../auth/models/route-auth-configuration.model';
import { definePermissions, definePlatformPermissions } from '../../auth/roles/define-permissions.function';
import { type Permission } from '../../auth/roles/permission.type';
import { type PlatformPermission } from '../../auth/roles/platform-permission.type';
import { ApiKeyAuthStrategy } from '../../auth/strategies/api-key/api-key.auth-strategy';
import { ApiKey } from '../../auth/strategies/api-key/api-key.model';
import { CreatedApiKey } from '../../auth/strategies/api-key/created-api-key.model';
import { JwtAuthStrategy } from '../../auth/strategies/jwt/jwt.auth-strategy';
import { type HttpRequestContext } from '../../context/request/http-request.context';
import { type WebsocketRequestContext } from '../../context/request/websocket-request.context';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { denyAll, scopeFor } from '../../entity/models/entity-scope.model';
import { InternalError } from '../../error-handling/internal-error.model';
import { Controller } from '../../routing/decorators/controller.decorator';
import { Get } from '../../routing/decorators/get.decorator';
import type { CurrentMembership } from '../../tenancy/membership/current-membership.model';
import { type TenantServiceInterface } from '../../tenancy/tenant-service.interface';
import { Newable } from '../../types/newable.type';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { TestTimeouts } from '../constants';
import { JwtUser } from '../mocks/entities/jwt-user.entity';
import { MemberRoles } from '../mocks/entities/member-roles.enum';
import { Roles } from '../mocks/entities/roles.enum';
import { TestMembership } from '../mocks/entities/test-membership.entity';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../test-server/create-test-data-source.function';
import { DefaultTestServerMembershipRepository } from '../test-server/membership-repository';
import { defaultTestServerProviders, rolesAndPermissionsProviders, TestServerRole } from '../test-server/providers';
import { StartedTestServer, startTestServer } from '../test-server/start-test-server.function';

/**
 * Executable form of evaluation/03-auth-and-security.md A10.
 *
 * Code named roles in two ways besides assigning them: `@Auth.hasRole` and `@Auth.hasPlatformRole`
 * checked them, and the user and membership a handler or a scope got carried them, for checks of its
 * own. A role a later release lets an administrator create at runtime can be named by neither, and a
 * credential limited below its user's roles has to be described by what it may do. Code checks
 * permissions only now, and what a request is handed says what it may do instead of which roles it
 * holds.
 */

// eslint-disable-next-line typescript/typedef
const Permissions = definePermissions(['notes.read', 'notes.read-all'] as const);

// eslint-disable-next-line typescript/typedef
const PlatformPermissions = definePlatformPermissions(['tenants.create'] as const);

const roles: TestServerRole[] = [
    { name: Roles.USER, level: 'platform', permissions: [], description: undefined },
    { name: Roles.ADMIN, level: 'platform', permissions: [PlatformPermissions.TENANTS_CREATE], description: undefined },
    { name: MemberRoles.USER, level: 'tenant', permissions: [Permissions.NOTES_READ], description: undefined },
    { name: MemberRoles.ADMIN, level: 'tenant', permissions: [Permissions.NOTES_READ, Permissions.NOTES_READ_ALL], description: undefined }
];

/**
 * A note, which its author reads, and a member allowed to read every note reads as well.
 */
@Entity({
    tenant: 'shared',
    scope: {
        restrictedTo: scopeFor<Note>(context => {
            if (context.currentUser == undefined) {
                return denyAll;
            }
            return context.currentUser.permissions.includes(Permissions.NOTES_READ_ALL) ? undefined : { authorId: context.currentUser.id };
        })
    }
})
class Note extends BaseEntity {
    @Property.string({ format: 'uuid' })
    authorId!: string;

    @Property.string()
    text!: string;
}

/**
 * What a request is handed about its caller.
 */
type Caller = {
    user: CurrentUser<JwtUser>,
    membership: CurrentMembership<TestMembership>
};

@Controller('/caller', { allowOrphan: true })
class CallerController {
    @Auth.isLoggedIn()
    @Get('/')
    async resolveCaller(
        @CurrentUser()
        user: CurrentUser<JwtUser>
    ): Promise<Caller> {
        const authService: AuthServiceInterface = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
        const request: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
        if (request == undefined) {
            throw new InternalError('A route is handled inside a request.');
        }
        const membership: CurrentMembership<TestMembership> = await authService
            .getCurrentMembership<string, TestMembership>(request, authService.strategies, true);
        return { user, membership };
    }

    @Auth.hasPermission(Permissions.NOTES_READ)
    @Get('/notes')
    async findNotes(): Promise<string[]> {
        return (await notes().findAll()).map(note => note.text).sort();
    }
}

let server: StartedTestServer | undefined;
let baseUrl: string;

/**
 * Starts an application keeping its data in memory, with the declaration of this suite.
 * @param controllers - The controllers it serves.
 * @returns The server, started.
 */
async function startApp(controllers: Newable<unknown>[]): Promise<StartedTestServer> {
    const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
        entities: [...defaultTestServerEntities, ApiKey, Note],
        repositories: defaultTestServerRepositories,
        allowOrphan: true
    });
    return await startTestServer({
        dataSources: [dataSourceClass],
        authStrategies: [JwtAuthStrategy, ApiKeyAuthStrategy],
        controllers,
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
 * The notes of the running application.
 * @returns Their repository.
 */
function notes(): Repository<Note> {
    return inject(repositoryTokenFor(Note));
}

/**
 * A user who is a member of a tenant, and an api key acting as them there.
 */
type Member = {
    user: JwtUser,
    key: string
};

/**
 * Creates a user who is a member of a new tenant, and a key bound to it.
 * @param name - What sets the user's email apart.
 * @param platformRoles - The roles of their own.
 * @param memberRoles - The roles they hold in the tenant.
 * @param keyPermissions - The permissions their key may use, all their roles carry there unless given.
 * @returns The user and the key.
 */
async function createMember(
    name: string,
    platformRoles: Roles[],
    memberRoles: MemberRoles[],
    keyPermissions?: (Permission | PlatformPermission)[]
): Promise<Member> {
    const user: JwtUser = await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser))
        .create({ email: `${name}@permissions-only.test`, roles: platformRoles });
    const tenantId: string = UUIDUtilities.generate();
    await inject<TenantServiceInterface>(ZIBRI_DI_TOKENS.TENANT_SERVICE)
        .runAs(tenantId, async () => await inject(DefaultTestServerMembershipRepository).create({ tenantId, userId: user.id, roles: memberRoles }));
    const authService: AuthServiceInterface = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
    const permissions: (Permission | PlatformPermission)[] = keyPermissions ?? await authService.resolveUserPermissions(user, tenantId);
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
 * @returns The body of the answer.
 */
async function call<T>(path: string, key: string): Promise<T> {
    const res: Response = await fetch(`${baseUrl}${path}`, { headers: { 'x-api-key': key } });
    expect(res.status).toBe(200);
    return await res.json() as T;
}

/**
 * Sorts what a caller may do, which is a set in any order.
 * @param permissions - The permissions.
 * @returns The same, sorted.
 */
function sorted(permissions: string[]): string[] {
    return [...permissions].sort();
}

describe('evaluation/03-auth-and-security A10 - code checks permissions, never roles', () => {
    it('declares no role check on a route', () => {
        expect(Object.keys(Auth)).not.toContain('hasRole');
        expect(Object.keys(Auth)).not.toContain('hasPlatformRole');
    });

    it('declares no role check on a manually registered route', () => {
        // @ts-expect-error - a manually registered route names a permission, as a decorated one does
        const auth: RouteAuthConfiguration = { hasRole: { allowedRoles: [MemberRoles.ADMIN] } };
        expect(auth).toBeDefined();
    });
});

describe('evaluation/03-auth-and-security A10 - a request is handed what its caller may do, not their roles', () => {
    let admin: Member;
    let narrowedAdmin: Member;

    beforeAll(async () => {
        server = await startApp([CallerController]);
        baseUrl = await server.start();

        admin = await createMember('admin', [Roles.ADMIN], [MemberRoles.ADMIN]);
        // an admin whose key may only use what every member may
        narrowedAdmin = await createMember('narrowed-admin', [Roles.ADMIN], [MemberRoles.ADMIN, MemberRoles.USER], [Permissions.NOTES_READ]);

        await notes().createAll([
            { authorId: admin.user.id, text: 'by the admin' },
            { authorId: narrowedAdmin.user.id, text: 'by the narrowed admin' }
        // outside a request, where the scope sees nothing
        ], { unscoped: true });
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
        server = undefined;
    });

    it('checks no role from the application\'s code', () => {
        const authService: AuthServiceInterface = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
        expect('hasRole' in authService).toBe(false);
        expect('hasPlatformRole' in authService).toBe(false);
    });

    it('hands a handler the permissions of the caller in the tenant and of their own, without their roles', async () => {
        const { user, membership }: Caller = await call<Caller>('/caller', admin.key);

        expect(user.id).toBe(admin.user.id);
        expect(user).not.toHaveProperty('roles');
        expect(sorted(user.permissions)).toEqual([Permissions.NOTES_READ, Permissions.NOTES_READ_ALL]);
        expect(user.platformPermissions).toEqual([PlatformPermissions.TENANTS_CREATE]);
        expect(membership.userId).toBe(admin.user.id);
        expect(membership).not.toHaveProperty('roles');
    });

    it('hands a handler only what the credential may do', async () => {
        const { user }: Caller = await call<Caller>('/caller', narrowedAdmin.key);

        expect(user.permissions).toEqual([Permissions.NOTES_READ]);
        expect(user.platformPermissions).toEqual([]);
    });

    it('hands a scope the same permissions', async () => {
        expect(await call<string[]>('/caller/notes', admin.key)).toEqual(['by the admin', 'by the narrowed admin']);
        expect(await call<string[]>('/caller/notes', narrowedAdmin.key)).toEqual(['by the narrowed admin']);
    });
});