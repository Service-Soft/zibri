import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { type AuthServiceInterface } from './auth-service.interface';
import { Auth } from './decorators/auth.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { type RouteAuthConfiguration } from './models/route-auth-configuration.model';
import { definePermissions, definePlatformPermissions } from './roles/define-permissions.function';
import { type Permission } from './roles/permission.type';
import { type PlatformPermission } from './roles/platform-permission.type';
import { TestTimeouts } from '../__testing__/constants';
import { ApiKeyAuthStrategy } from './strategies/api-key/api-key.auth-strategy';
import { ApiKey } from './strategies/api-key/api-key.model';
import { CreatedApiKey } from './strategies/api-key/created-api-key.model';
import { JwtAuthStrategy } from './strategies/jwt/jwt.auth-strategy';
import { JwtUser } from '../__testing__/mocks/entities/jwt-user.entity';
import { MemberRoles } from '../__testing__/mocks/entities/member-roles.enum';
import { Roles } from '../__testing__/mocks/entities/roles.enum';
import { TestMembership } from '../__testing__/mocks/entities/test-membership.entity';
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
import { InternalError } from '../error-handling/internal-error.model';
import { type LoggerInterface } from '../logging/logger.interface';
import { Controller } from '../routing/decorators/controller.decorator';
import { Get } from '../routing/decorators/get.decorator';
import type { CurrentMembership } from '../tenancy/membership/current-membership.model';
import { type TenantServiceInterface } from '../tenancy/tenant-service.interface';
import { Newable } from '../types/newable.type';
import { UUIDUtilities } from '../utilities/uuid.utilities';

// a role an administrator creates at runtime can be named by no code, and a credential limited below
// its user's roles can only be described by what it may do, so what a request is handed is what its
// caller may do, never which roles they hold

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
 * A note, which its author reads, and a member allowed to read every note reads as well: told apart
 * by the permissions of the current user.
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
 * The same as a note, told apart by asking for the permission the way a route does.
 */
@Entity({
    tenant: 'shared',
    scope: {
        restrictedTo: scopeFor<Memo>(async context => {
            if (await context.hasPermission(Permissions.NOTES_READ_ALL)) {
                return undefined;
            }
            return context.currentUser == undefined ? denyAll : { authorId: context.currentUser.id };
        })
    }
})
class Memo extends BaseEntity {
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

/**
 * What the application's own code asks of the request it handles.
 */
type CodeChecks = {
    undeclaredPermission: boolean,
    undeclaredPlatformPermission: boolean
};

/**
 * The request being handled.
 * @returns Its context.
 * @throws An InternalError when called outside of a request.
 */
function currentRequest(): HttpRequestContext | WebsocketRequestContext {
    const request: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
    if (request == undefined) {
        throw new InternalError('A route is handled inside a request.');
    }
    return request;
}

@Controller('/caller')
class CallerController {
    @Auth.isLoggedIn()
    @Get('/')
    async resolveCaller(
        @CurrentUser()
        user: CurrentUser<JwtUser>
    ): Promise<Caller> {
        const authService: AuthServiceInterface = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
        const membership: CurrentMembership<TestMembership> = await authService
            .resolveCurrentMembership<string, TestMembership>(currentRequest(), authService.strategies, true);
        return { user, membership };
    }

    @Auth.hasPermission(Permissions.NOTES_READ)
    @Get('/notes')
    async findNotes(): Promise<string[]> {
        return (await inject<Repository<Note>>(repositoryTokenFor(Note)).findAll()).map(note => note.text).sort();
    }

    @Auth.isLoggedIn()
    @Get('/memos')
    async findMemos(): Promise<string[]> {
        return (await inject<Repository<Memo>>(repositoryTokenFor(Memo)).findAll()).map(memo => memo.text).sort();
    }

    @Auth.isLoggedIn()
    @Get('/code-checks')
    async check(): Promise<CodeChecks> {
        const authService: AuthServiceInterface = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
        // a plain string is no permission, so the compiler refuses a typo first: these are what code
        // reaching past it gets
        return {
            // @ts-expect-error - a plain string is no permission
            undeclaredPermission: await authService.hasPermission(currentRequest(), authService.strategies, 'notes.delete'),
            // @ts-expect-error - a plain string is no permission
            undeclaredPlatformPermission: await authService.hasPlatformPermission(currentRequest(), authService.strategies, 'tokens.revoke')
        };
    }
}

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
        .create({ email: `${name}@permissions.test`, roles: platformRoles });
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

describe('AuthService - what a request is handed about its caller', () => {
    let admin: Member;
    let member: Member;
    let narrowedAdmin: Member;

    beforeAll(async () => {
        const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
            entities: [...defaultTestServerEntities, ApiKey, Note, Memo],
            repositories: defaultTestServerRepositories
        });
        server = await startTestServer({
            dataSources: [dataSourceClass],
            authStrategies: [JwtAuthStrategy, ApiKeyAuthStrategy],
            controllers: [CallerController],
            providers: [
                ...defaultTestServerProviders,
                ...rolesAndPermissionsProviders(
                    { permissions: Object.values(Permissions), platformPermissions: Object.values(PlatformPermissions) },
                    roles
                )
            ]
        });
        baseUrl = await server.start();

        admin = await createMember('admin', [Roles.ADMIN], [MemberRoles.ADMIN]);
        member = await createMember('member', [Roles.USER], [MemberRoles.USER]);
        // an admin whose key may only use what every member may
        narrowedAdmin = await createMember('narrowed-admin', [Roles.ADMIN], [MemberRoles.ADMIN, MemberRoles.USER], [Permissions.NOTES_READ]);

        const rows: Pick<Note, 'authorId' | 'text'>[] = [
            { authorId: admin.user.id, text: 'by the admin' },
            { authorId: member.user.id, text: 'by the member' },
            { authorId: narrowedAdmin.user.id, text: 'by the narrowed admin' }
        ];
        // outside a request, where the scope sees nothing
        await inject<Repository<Note>>(repositoryTokenFor(Note)).createAll(rows, { unscoped: true });
        await inject<Repository<Memo>>(repositoryTokenFor(Memo)).createAll(rows, { unscoped: true });
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    it('offers no role check, on a route, a manually registered route or from the application\'s code', () => {
        expect(Object.keys(Auth)).not.toContain('hasRole');
        expect(Object.keys(Auth)).not.toContain('hasPlatformRole');
        // @ts-expect-error - a manually registered route names a permission, as a decorated one does
        const auth: RouteAuthConfiguration = { hasRole: { allowedRoles: [MemberRoles.ADMIN] } };
        expect(auth).toBeDefined();
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

    it('hands a handler only what the credential may use, at both levels', async () => {
        const { user }: Caller = await call<Caller>('/caller', narrowedAdmin.key);

        expect(user.permissions).toEqual([Permissions.NOTES_READ]);
        expect(user.platformPermissions).toEqual([]);
    });

    it('hands a scope the same permissions', async () => {
        expect(await call<string[]>('/caller/notes', admin.key)).toEqual(['by the admin', 'by the member', 'by the narrowed admin']);
        expect(await call<string[]>('/caller/notes', narrowedAdmin.key)).toEqual(['by the narrowed admin']);
    });

    it('answers a scope asking for a permission as a route is answered, with what the credential may use', async () => {
        expect(await call<string[]>('/caller/memos', admin.key)).toEqual(['by the admin', 'by the member', 'by the narrowed admin']);
        expect(await call<string[]>('/caller/memos', member.key)).toEqual(['by the member']);
        expect(await call<string[]>('/caller/memos', narrowedAdmin.key)).toEqual(['by the narrowed admin']);
    });

    it('answers a scope asking for a permission no outside a request', async () => {
        expect(await inject<Repository<Memo>>(repositoryTokenFor(Memo)).findAll()).toEqual([]);
    });

    // a misspelled name answered a silent no, so a check that could never pass looked like a refusal
    it('answers code naming a permission that is not declared with no, and warns once', async () => {
        const warn: jest.SpiedFunction<LoggerInterface['warn']> = jest.spyOn(inject<LoggerInterface>(ZIBRI_DI_TOKENS.LOGGER), 'warn');
        try {
            const first: CodeChecks = await call<CodeChecks>('/caller/code-checks', admin.key);
            const second: CodeChecks = await call<CodeChecks>('/caller/code-checks', admin.key);

            expect([first, second]).toEqual([
                { undeclaredPermission: false, undeclaredPlatformPermission: false },
                { undeclaredPermission: false, undeclaredPlatformPermission: false }
            ]);
            const warnings: string[] = warn.mock.calls.map(([message]) => message);
            expect(warnings.filter(message => /notes\.delete[\S\s]*not declared/.test(message))).toHaveLength(1);
            expect(warnings.filter(message => /tokens\.revoke[\S\s]*not declared/.test(message))).toHaveLength(1);
        }
        finally {
            warn.mockRestore();
        }
    });
});