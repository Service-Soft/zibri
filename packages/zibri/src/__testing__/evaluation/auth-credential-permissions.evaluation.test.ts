import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { AuthorizationServerController } from '../../auth/authorization-server/authorization-server-controller.model';
import { Auth } from '../../auth/decorators/auth.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { definePermissions, definePlatformPermissions } from '../../auth/roles/define-permissions.function';
import { type Permission } from '../../auth/roles/permission.type';
import { type PlatformPermission } from '../../auth/roles/platform-permission.type';
import { type ApiKeyCreateData } from '../../auth/strategies/api-key/api-key-create-data.model';
import { ApiKeyAuthStrategy } from '../../auth/strategies/api-key/api-key.auth-strategy';
import { ApiKey } from '../../auth/strategies/api-key/api-key.model';
import { CreatedApiKey } from '../../auth/strategies/api-key/created-api-key.model';
import { ClientAccessTokenAuthStrategy } from '../../auth/strategies/client-access-token/client-access-token.auth-strategy';
import { JwtAuthStrategy } from '../../auth/strategies/jwt/jwt.auth-strategy';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { BadRequestError } from '../../error-handling/errors/bad-request.error';
import { Controller } from '../../routing/decorators/controller.decorator';
import { Get } from '../../routing/decorators/get.decorator';
import { type TenantServiceInterface } from '../../tenancy/tenant-service.interface';
import { Newable } from '../../types/newable.type';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { JwtUser } from '../mocks/entities/jwt-user.entity';
import { MemberRoles } from '../mocks/entities/member-roles.enum';
import { Roles } from '../mocks/entities/roles.enum';
import { TestMembership } from '../mocks/entities/test-membership.entity';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../test-server/create-test-data-source.function';
import { DefaultTestServerMembershipRepository } from '../test-server/membership-repository';
import { defaultTestServerProviders, rolesAndPermissionsProviders, TestServerRole } from '../test-server/providers';
import { TestTimeouts } from '../constants';
import { StartedTestServer, startTestServer } from '../test-server/start-test-server.function';

/**
 * Executable form of evaluation/03-auth-and-security.md A7.
 *
 * An api key was limited to some of its user's roles, and an OAuth2 client's `scope` was a list of
 * roles. With code checking permissions only, a credential is described by what it may do: it lists
 * permissions, a request made with it holds those of them its user's roles carry now, and a scope
 * names permissions.
 */

// eslint-disable-next-line typescript/typedef
const Permissions = definePermissions(['notes.read', 'notes.read-all'] as const);

// eslint-disable-next-line typescript/typedef
const PlatformPermissions = definePlatformPermissions(['tenants.create', 'users.deactivate', 'tokens.introspect'] as const);

const roles: TestServerRole[] = [
    { name: Roles.USER, level: 'platform', permissions: [], description: undefined },
    {
        name: Roles.ADMIN,
        level: 'platform',
        permissions: [PlatformPermissions.TENANTS_CREATE, PlatformPermissions.USERS_DEACTIVATE, PlatformPermissions.TOKENS_INTROSPECT],
        description: undefined
    },
    { name: MemberRoles.USER, level: 'tenant', permissions: [Permissions.NOTES_READ], description: undefined },
    { name: MemberRoles.ADMIN, level: 'tenant', permissions: [Permissions.NOTES_READ, Permissions.NOTES_READ_ALL], description: undefined }
];

/**
 * What a request is handed about what its caller may do.
 */
type Caller = {
    permissions: string[],
    platformPermissions: string[]
};

/**
 * What the token endpoint and introspection answer, as far as the tests read it.
 */
type OAuth2Answer = Record<string, unknown>;

@Controller('/caller', { allowOrphan: true })
class CallerController {
    @Auth.isLoggedIn()
    @Get('/')
    resolveCaller(
        @CurrentUser()
        user: CurrentUser<JwtUser>
    ): Caller {
        return { permissions: user.permissions, platformPermissions: user.platformPermissions };
    }

    @Auth.hasPermission(Permissions.NOTES_READ_ALL)
    @Get('/all-notes')
    findAllNotes(): { ok: boolean } {
        return { ok: true };
    }

    @Auth.hasPlatformPermission(PlatformPermissions.TENANTS_CREATE)
    @Get('/tenants')
    createTenant(): { ok: boolean } {
        return { ok: true };
    }

    @Auth.hasPlatformPermission(PlatformPermissions.USERS_DEACTIVATE)
    @Get('/users')
    deactivateUser(): { ok: boolean } {
        return { ok: true };
    }
}

@Controller('/oauth2', { allowOrphan: true })
class TestAuthorizationServerController extends AuthorizationServerController({ introspectionPermission: PlatformPermissions.TOKENS_INTROSPECT, resources: [] }) {}

let server: StartedTestServer | undefined;
let baseUrl: string;

/**
 * Starts an application keeping its data in memory, with the declaration of this suite and an
 * authorization server.
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
        authStrategies: [JwtAuthStrategy, ApiKeyAuthStrategy, ClientAccessTokenAuthStrategy],
        controllers: [CallerController, TestAuthorizationServerController],
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
 * A user who is a member of a tenant of their own.
 */
type Member = {
    user: JwtUser,
    membership: TestMembership,
    tenantId: string
};

/**
 * Creates a user who is a member of a new tenant.
 * @param name - What sets the user's email apart.
 * @param roles - The roles of their own.
 * @param memberRoles - The roles they hold in the tenant.
 * @returns The user and their membership.
 */
async function createMember(name: string, roles: Roles[], memberRoles: MemberRoles[]): Promise<Member> {
    const user: JwtUser = await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser))
        .create({ email: `${name}@credential-permissions.test`, roles });
    const tenantId: string = UUIDUtilities.generate();
    const membership: TestMembership = await tenants().runAs(
        tenantId,
        async () => await inject(DefaultTestServerMembershipRepository).create({ tenantId, userId: user.id, roles: memberRoles })
    );
    return { user, membership, tenantId };
}

/**
 * Creates an api key bound to the tenant of a member, which is a secret.
 * @param member - The member the key acts as.
 * @param permissions - The permissions the key lists.
 * @returns The key.
 */
async function createKey(member: Member, permissions: (Permission | PlatformPermission)[]): Promise<CreatedApiKey> {
    return await inject(ZIBRI_DI_TOKENS.AUTH_SERVICE).createApiKey(
        member.user.id,
        { name: 'service', permissions, expiresAt: undefined, tenantId: member.tenantId, clientAuthentication: undefined, requireDpop: false },
        undefined
    );
}

/**
 * The tenant service of the running application.
 * @returns The service.
 */
function tenants(): TenantServiceInterface {
    return inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);
}

/**
 * Calls a route with an api key or a bearer token.
 * @param path - The route.
 * @param headers - The credential to send.
 * @returns The answer.
 */
async function call(path: string, headers: Record<string, string>): Promise<Response> {
    return await fetch(`${baseUrl}${path}`, { headers });
}

/**
 * Reads what a credential may do, as a handler is handed it.
 * @param headers - The credential to send.
 * @returns What the handler is handed.
 */
async function resolveCaller(headers: Record<string, string>): Promise<unknown> {
    const res: Response = await call('/caller', headers);
    expect(res.status).toBe(200);
    return await res.json();
}

/**
 * Posts a form to a route of the authorization server, as the client of a key.
 * @param path - The route below /oauth2.
 * @param key - The client's api key.
 * @param fields - The fields of the form.
 * @returns The answer and its body.
 */
async function post(path: string, key: CreatedApiKey, fields: [string, string][]): Promise<[Response, OAuth2Answer]> {
    const credentials: string = Buffer.from(`${key.apiKey.id}:${key.key}`).toString('base64');
    const res: Response = await fetch(`${baseUrl}/oauth2${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${credentials}` },
        body: new URLSearchParams(fields).toString()
    });
    const json: unknown = await res.json();
    if (typeof json !== 'object' || json == undefined) {
        throw new Error(`The answer is no object: ${String(json)}`);
    }
    return [res, Object.fromEntries(Object.entries(json))];
}

/**
 * Splits a scope into what it names, sorted.
 * @param scope - The scope.
 * @returns What it names.
 */
function namesOf(scope: unknown): string[] {
    return String(scope)
        .split(' ')
        .filter(name => name !== '')
        .sort();
}

describe('evaluation/03-auth-and-security A7 - a credential is limited to permissions', () => {
    let admin: Member;

    beforeAll(async () => {
        server = await startApp();
        baseUrl = await server.start();
        admin = await createMember('admin', [Roles.ADMIN], [MemberRoles.ADMIN]);
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
        server = undefined;
    });

    it('lists permissions, not roles', () => {
        const data: ApiKeyCreateData<undefined> = {
            name: 'service',
            permissions: [Permissions.NOTES_READ],
            expiresAt: undefined,
            tenantId: undefined,
            clientAuthentication: undefined,
            requireDpop: false
        };
        // @ts-expect-error - a key is limited by what it may do, not by the roles that carry it
        const withRoles: ApiKeyCreateData<undefined> = { ...data, roles: [MemberRoles.ADMIN] };
        expect(withRoles).toBeDefined();
    });

    it('holds the permissions it lists that its user\'s roles carry, at both levels', async () => {
        const key: CreatedApiKey = await createKey(admin, [Permissions.NOTES_READ, PlatformPermissions.TENANTS_CREATE]);
        const headers: Record<string, string> = { 'x-api-key': key.key };

        expect(await resolveCaller(headers)).toEqual({ permissions: [Permissions.NOTES_READ], platformPermissions: [PlatformPermissions.TENANTS_CREATE] });
        expect((await call('/caller/tenants', headers)).status).toBe(200);
        // carried by the same roles as what it lists, and still not listed
        expect((await call('/caller/all-notes', headers)).status).toBe(403);
        expect((await call('/caller/users', headers)).status).toBe(403);
    });

    it('loses a permission when the role carrying it is taken from its user', async () => {
        const member: Member = await createMember('demoted', [Roles.USER], [MemberRoles.ADMIN]);
        const key: CreatedApiKey = await createKey(member, [Permissions.NOTES_READ, Permissions.NOTES_READ_ALL]);
        const headers: Record<string, string> = { 'x-api-key': key.key };
        expect((await call('/caller/all-notes', headers)).status).toBe(200);

        await tenants().runAs(
            member.tenantId,
            async () => await inject(DefaultTestServerMembershipRepository).updateById(member.membership.id, { roles: [MemberRoles.USER] })
        );

        expect(await resolveCaller(headers)).toEqual({ permissions: [Permissions.NOTES_READ], platformPermissions: [] });
        expect((await call('/caller/all-notes', headers)).status).toBe(403);
    });

    it('refuses a permission that is not declared, as not declared', async () => {
        // @ts-expect-error - a plain string is no permission, so a typo is refused by the compiler first
        const created: Promise<CreatedApiKey> = createKey(admin, ['notes.reed']);
        await expect(created).rejects.toThrow(BadRequestError);
        await expect(created).rejects.toThrow('notes.reed');
        await expect(created).rejects.toThrow('not declared');
    });

    it('refuses a permission its user\'s roles do not carry', async () => {
        const member: Member = await createMember('member', [Roles.USER], [MemberRoles.USER]);
        const created: Promise<CreatedApiKey> = createKey(member, [Permissions.NOTES_READ, Permissions.NOTES_READ_ALL]);
        await expect(created).rejects.toThrow(BadRequestError);
        await expect(created).rejects.toThrow(Permissions.NOTES_READ_ALL);
    });
});

describe('evaluation/03-auth-and-security A7 - an OAuth2 scope names permissions', () => {
    let admin: Member;
    let key: CreatedApiKey;

    beforeAll(async () => {
        server = await startApp();
        baseUrl = await server.start();
        admin = await createMember('admin', [Roles.ADMIN], [MemberRoles.ADMIN]);
        key = await createKey(admin, [Permissions.NOTES_READ, Permissions.NOTES_READ_ALL, PlatformPermissions.TENANTS_CREATE]);
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
        server = undefined;
    });

    it('issues a token for the permissions its key lists, or for those it asks for', async () => {
        const [, all] = await post('/token', key, [['grant_type', 'client_credentials']]);
        expect(namesOf(all['scope'])).toEqual([Permissions.NOTES_READ, Permissions.NOTES_READ_ALL, PlatformPermissions.TENANTS_CREATE]);

        const [, fewer] = await post('/token', key, [['grant_type', 'client_credentials'], ['scope', Permissions.NOTES_READ]]);
        expect(fewer['scope']).toBe(Permissions.NOTES_READ);
        expect(await resolveCaller({ authorization: `Bearer ${String(fewer['access_token'])}` }))
            .toEqual({ permissions: [Permissions.NOTES_READ], platformPermissions: [] });
    });

    it('refuses a scope naming a permission its key does not list', async () => {
        const [res, answer] = await post('/token', key, [['grant_type', 'client_credentials'], ['scope', PlatformPermissions.USERS_DEACTIVATE]]);
        expect(res.status).toBe(400);
        expect(answer).toMatchObject({ error: 'invalid_scope' });
    });

    it('introspects a token as the permissions it holds', async () => {
        const [, issued] = await post('/token', key, [['grant_type', 'client_credentials'], ['scope', PlatformPermissions.TENANTS_CREATE]]);
        const resourceServer: Member = await createMember('resource-server', [Roles.ADMIN], []);
        const resourceServerKey: CreatedApiKey = await inject(ZIBRI_DI_TOKENS.AUTH_SERVICE).createApiKey(
            resourceServer.user.id,
            { name: 'resource server', permissions: [PlatformPermissions.TOKENS_INTROSPECT], expiresAt: undefined, tenantId: undefined, clientAuthentication: undefined, requireDpop: false },
            undefined
        );

        const [res, answer] = await post('/introspect', resourceServerKey, [['token', String(issued['access_token'])]]);
        expect(res.status).toBe(200);
        expect(answer).toMatchObject({ active: true, scope: PlatformPermissions.TENANTS_CREATE });
    });
});