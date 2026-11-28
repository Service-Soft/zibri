import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { TestTimeouts } from '../../__testing__/constants';
import { JwtTestAuthController } from '../../__testing__/mocks/controllers/jwt-test-auth.controller';
import { JwtUser } from '../../__testing__/mocks/entities/jwt-user.entity';
import { TestTenant } from '../../__testing__/mocks/entities/test-tenant.entity';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { DefaultTestServerMembershipRepository } from '../../__testing__/test-server/membership-repository';
import { defaultTestServerProviders, rolesAndPermissionsProviders, TestServerRole } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { BaseTenantEntity } from '../../entity/base-tenant-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { McpController } from '../../plugin/mcp/mcp.controller';
import { ZibriMcpPlugin } from '../../plugin/mcp/mcp.plugin';
import { type McpReadTool } from '../../plugin/mcp/models/mcp-read-tool.model';
import { provideMcpTool } from '../../plugin/mcp/provide-mcp-tool.function';
import { ServiceAccountMcpToolController } from '../../plugin/mcp/service-account-mcp-tool.controller';
import { RateLimitStoreFailurePolicy } from '../../rate-limiting/limiter/rate-limiter-config.model';
import { Controller } from '../../routing/decorators/controller.decorator';
import { type TenantServiceInterface } from '../../tenancy/tenant-service.interface';
import { Newable } from '../../types/newable.type';
import { JsonUtilities } from '../../utilities/json.utilities';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { OtpTwoFactorMethod } from '../2fa/methods/otp/otp.two-factor-method';
import { PasswordCredentials } from '../authenticators/password/password-credentials.model';
import { type BaseUser } from '../models/base-user.model';
import { definePermissions, DefinedPermissions } from '../roles/define-permissions.function';
import { type Permission } from '../roles/permission.type';
import { type PlatformPermission } from '../roles/platform-permission.type';
import { ZibriPermissions, ZibriPlatformPermissions } from '../roles/zibri-permissions.model';
import { ApiKeyAuthStrategy } from '../strategies/api-key/api-key.auth-strategy';
import { ApiKey } from '../strategies/api-key/api-key.model';
import { JwtAuthStrategy } from '../strategies/jwt/jwt.auth-strategy';
import { type CreatedServiceAccountApiKey } from './created-service-account-api-key.model';
import { ServiceAccountController } from './service-account.controller';
import { type ServiceAccount } from './service-account.model';
import { ZibriServiceAccountPlatformPermissions } from './zibri-service-account-permissions.model';

@Entity()
class AccountTask extends BaseTenantEntity() {
    @Property.string()
    title!: string;
}

class FindTasksInput {
    @Property.string({ required: false })
    title?: string;
}

class FoundTasks {
    @Property.array({ items: { type: 'string' } })
    titles!: string[];
}

@Controller('/service-accounts', { versions: 'all' })
class AppServiceAccountController extends ServiceAccountController {
    protected readonly userEntity: Newable<BaseUser<string>> = JwtUser;
}

@Controller('/service-account-tools', { versions: 'all' })
class AppServiceAccountMcpToolController extends ServiceAccountMcpToolController {}

@Controller('/mcp', { versions: 'all' })
class AppMcpController extends McpController {}

// eslint-disable-next-line typescript/typedef
const TASK_PERMISSIONS = ['tasks.read', 'tasks.export'] as const;

const TaskPermissions: DefinedPermissions<typeof TASK_PERMISSIONS> = definePermissions(TASK_PERMISSIONS);

const PERMISSIONS: Permission[] = [...Object.values(ZibriPermissions), ...Object.values(TaskPermissions)];

const PLATFORM_PERMISSIONS: PlatformPermission[] = [...Object.values(ZibriPlatformPermissions), ...Object.values(ZibriServiceAccountPlatformPermissions)];

/**
 * The roles of the suite: an administrator of the platform, somebody who reads the service accounts only, somebody
 * who manages them and hands out no role, and the roles of a team.
 */
enum AccountRoles {
    ADMIN = 'admin',
    READER = 'reader',
    MANAGER = 'manager',
    NOBODY = 'nobody',
    OWNER = 'owner',
    MEMBER = 'member',
    EXPORTER = 'exporter'
}

const roles: TestServerRole[] = [
    { name: AccountRoles.ADMIN, level: 'platform', permissions: ['*'], description: undefined },
    { name: AccountRoles.READER, level: 'platform', permissions: [ZibriServiceAccountPlatformPermissions.SERVICE_ACCOUNTS_READ], description: undefined },
    {
        name: AccountRoles.MANAGER,
        level: 'platform',
        permissions: [ZibriServiceAccountPlatformPermissions.SERVICE_ACCOUNTS_READ, ZibriServiceAccountPlatformPermissions.SERVICE_ACCOUNTS_MANAGE],
        description: undefined
    },
    { name: AccountRoles.NOBODY, level: 'platform', permissions: [], description: undefined },
    { name: AccountRoles.OWNER, level: 'tenant', permissions: ['*'], description: undefined },
    { name: AccountRoles.MEMBER, level: 'tenant', permissions: [TaskPermissions.TASKS_READ], description: undefined },
    { name: AccountRoles.EXPORTER, level: 'tenant', permissions: [TaskPermissions.TASKS_EXPORT], description: undefined }
];

const findTasks: McpReadTool<FindTasksInput, FoundTasks> = {
    kind: 'read',
    name: 'tasks.find',
    title: 'Find tasks',
    description: 'Finds the tasks of the team.',
    input: FindTasksInput,
    output: FoundTasks,
    permission: TaskPermissions.TASKS_READ,
    async read() {
        const tasks: AccountTask[] = await inject<Repository<AccountTask>>(repositoryTokenFor(AccountTask)).findAll();
        return { titles: tasks.map(task => task.title) };
    }
};

const PASSWORD: string = 'correct horse battery staple';

/**
 * Who calls the routes: a person logged in, in a tenant.
 */
type Caller = {
    token: string,
    tenantId: string | undefined
};

let server: StartedTestServer | undefined;
let baseUrl: string = '';

beforeAll(async () => {
    server = await startTestServer({
        dataSources: [
            createInMemoryDataSource({
                entities: [...defaultTestServerEntities, ApiKey, TestTenant, AccountTask],
                repositories: defaultTestServerRepositories
            })
        ],
        authStrategies: [JwtAuthStrategy, ApiKeyAuthStrategy],
        twoFactorMethods: [OtpTwoFactorMethod],
        controllers: [JwtTestAuthController, AppServiceAccountController, AppServiceAccountMcpToolController, AppMcpController],
        plugins: [
            new ZibriMcpPlugin({
                allowedOrigins: [],
                rateLimit: { maxRequests: 1000, windowInMs: 60_000, onStoreFailure: RateLimitStoreFailurePolicy.REJECT },
                instructions: undefined
            })
        ],
        providers: [
            ...defaultTestServerProviders,
            ...rolesAndPermissionsProviders({ permissions: PERMISSIONS, platformPermissions: PLATFORM_PERMISSIONS }, roles),
            provideMcpTool(findTasks)
        ]
    });
    baseUrl = await server.start();
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.inMemory.shutdown);

function users(): Repository<JwtUser> {
    return inject(repositoryTokenFor(JwtUser));
}

async function runInTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    return await inject<TenantServiceInterface>(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(tenantId, fn);
}

async function createTenant(): Promise<string> {
    return (await inject<Repository<TestTenant>>(repositoryTokenFor(TestTenant)).create({ name: 'Acme' })).id;
}

/**
 * Creates a person with a password and logs them in.
 * @param role - Their platform role.
 * @param tenantId - The tenant they act in, as an owner of it, or undefined for none.
 * @returns How they call.
 */
async function logInPerson(role: AccountRoles, tenantId: string | undefined): Promise<Caller> {
    const email: string = `${UUIDUtilities.generate()}@example.com`;
    const person: JwtUser = await users().create({ email, roles: [role] });
    await inject(repositoryTokenFor(PasswordCredentials)).create({ password: PASSWORD, userId: person.id });
    if (tenantId != undefined) {
        await runInTenant(tenantId, async () => await inject(DefaultTestServerMembershipRepository)
            .create({ tenantId, userId: person.id, roles: [AccountRoles.OWNER] }));
    }
    const res: Response = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JsonUtilities.stringify({ email, password: PASSWORD })
    });
    expect(res.status).toBe(200);
    const body: { accessToken: { value: string } } = await res.json() as { accessToken: { value: string } };
    return { token: body.accessToken.value, tenantId };
}

async function call(caller: Caller, method: string, path: string, body?: object): Promise<Response> {
    return await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
            authorization: `Bearer ${caller.token}`,
            ...caller.tenantId == undefined ? {} : { 'x-tenant-id': caller.tenantId },
            ...body == undefined ? {} : { 'content-type': 'application/json' }
        },
        body: body == undefined ? undefined : JsonUtilities.stringify(body)
    });
}

async function createAccount(caller: Caller, name: string, tenantRoles: string[]): Promise<ServiceAccount> {
    const res: Response = await call(caller, 'POST', '/service-accounts', { name, roles: [AccountRoles.NOBODY], tenantRoles });
    expect(res.status).toBe(200);
    return await res.json() as ServiceAccount;
}

async function createKey(caller: Caller, account: ServiceAccount, permissions: string[]): Promise<CreatedServiceAccountApiKey> {
    const res: Response = await call(caller, 'POST', `/service-accounts/${account.id}/api-keys`, {
        name: 'assistant',
        permissions,
        tenantId: caller.tenantId,
        requireDpop: false
    });
    expect(res.status).toBe(200);
    return await res.json() as CreatedServiceAccountApiKey;
}

async function listTools(key: string): Promise<Response> {
    return await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: {
            'x-api-key': key,
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            'mcp-protocol-version': '2026-07-28',
            'mcp-method': 'tools/list'
        },
        body: JsonUtilities.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/list',
            params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {} } }
        })
    });
}

function uniqueName(prefix: string): string {
    return `${prefix}-${UUIDUtilities.generate().slice(0, 8)}`;
}

describe('the routes of the service accounts', () => {
    it('create a service account with roles in the tenant of the request, and a key for it that calls the MCP server', async () => {
        const tenantId: string = await createTenant();
        const admin: Caller = await logInPerson(AccountRoles.ADMIN, tenantId);
        const name: string = uniqueName('assistant');

        const account: ServiceAccount = await createAccount(admin, name, [AccountRoles.MEMBER]);
        expect(account).toEqual({ id: account.id, name, roles: [AccountRoles.NOBODY], tenantRoles: [AccountRoles.MEMBER], apiKeys: [] });
        expect((await users().findById(account.id)).kind).toBe('service');

        const created: CreatedServiceAccountApiKey = await createKey(admin, account, [TaskPermissions.TASKS_READ]);
        expect(created.key).toEqual(expect.any(String));
        expect(created.apiKey).toEqual(expect.objectContaining({ name: 'assistant', permissions: [TaskPermissions.TASKS_READ], tenantId, requireDpop: false }));

        // listed with its keys, and never with the key itself
        const listed: ServiceAccount[] = await (await call(admin, 'GET', '/service-accounts')).json() as ServiceAccount[];
        const found: ServiceAccount | undefined = listed.find(candidate => candidate.id === account.id);
        expect(found?.apiKeys.map(apiKey => apiKey.id)).toEqual([created.apiKey.id]);
        expect(JsonUtilities.stringify(listed)).not.toContain(created.key);

        const mcp: Response = await listTools(created.key);
        expect(mcp.status).toBe(200);
        expect((await mcp.json() as { result: { tools: { name: string }[] } }).result.tools.map(tool => tool.name)).toEqual(['tasks.find']);

        const tools: Response = await call(admin, 'GET', `/service-account-tools/${account.id}`);
        expect(tools.status).toBe(200);
        expect(await tools.json()).toEqual([{ name: 'tasks.find', title: 'Find tasks', description: 'Finds the tasks of the team.', kind: 'read', permission: 'tasks.read' }]);
    });

    it('change the roles of a service account, in the tenant of the request', async () => {
        const tenantId: string = await createTenant();
        const admin: Caller = await logInPerson(AccountRoles.ADMIN, tenantId);
        const account: ServiceAccount = await createAccount(admin, uniqueName('reports'), [AccountRoles.MEMBER]);

        const res: Response = await call(admin, 'PUT', `/service-accounts/${account.id}/roles`, { roles: [], tenantRoles: [AccountRoles.EXPORTER] });

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual(expect.objectContaining({ roles: [], tenantRoles: [AccountRoles.EXPORTER] }));
        expect((await users().findById(account.id)).roles).toEqual([]);
        // the tools are those of the roles it holds now
        expect(await (await call(admin, 'GET', `/service-account-tools/${account.id}`)).json()).toEqual([]);
    });

    it('refuse a role the caller may not hand out, and a role of the other level', async () => {
        const tenantId: string = await createTenant();
        const manager: Caller = await logInPerson(AccountRoles.MANAGER, tenantId);
        const admin: Caller = await logInPerson(AccountRoles.ADMIN, tenantId);
        const name: string = uniqueName('importer');

        expect((await call(manager, 'POST', '/service-accounts', { name, roles: [], tenantRoles: [] })).status).toBe(200);
        expect((await call(manager, 'POST', '/service-accounts', { name: uniqueName('importer'), roles: [AccountRoles.ADMIN], tenantRoles: [] })).status).toBe(403);
        expect((await call(admin, 'POST', '/service-accounts', { name: uniqueName('importer'), roles: [AccountRoles.MEMBER], tenantRoles: [] })).status).toBe(400);
        expect((await call(admin, 'POST', '/service-accounts', { name: uniqueName('importer'), roles: [], tenantRoles: [AccountRoles.ADMIN] })).status).toBe(400);
        // a request acting in no tenant has no tenant to give roles of
        expect((await call({ ...admin, tenantId: undefined }, 'POST', '/service-accounts', { name: uniqueName('importer'), roles: [], tenantRoles: [AccountRoles.MEMBER] })).status).toBe(400);
        // the second of one name
        expect((await call(admin, 'POST', '/service-accounts', { name, roles: [], tenantRoles: [] })).status).toBe(409);
    });

    it('let a reader list the service accounts and the tools they can use, and nothing else', async () => {
        const tenantId: string = await createTenant();
        const admin: Caller = await logInPerson(AccountRoles.ADMIN, tenantId);
        const reader: Caller = await logInPerson(AccountRoles.READER, tenantId);
        const account: ServiceAccount = await createAccount(admin, uniqueName('auditor'), []);

        expect((await call(reader, 'GET', '/service-accounts')).status).toBe(200);
        expect((await call(reader, 'GET', `/service-account-tools/${account.id}`)).status).toBe(200);
        expect((await call(reader, 'POST', '/service-accounts', { name: uniqueName('auditor'), roles: [], tenantRoles: [] })).status).toBe(403);
        expect((await call(reader, 'DELETE', `/service-accounts/${account.id}`)).status).toBe(403);
    });

    it('refuse a key with a permission that is not declared, or that no role of the account carries', async () => {
        const tenantId: string = await createTenant();
        const admin: Caller = await logInPerson(AccountRoles.ADMIN, tenantId);
        const account: ServiceAccount = await createAccount(admin, uniqueName('exporter'), [AccountRoles.MEMBER]);

        for (const permissions of [['tasks.delete'], [TaskPermissions.TASKS_EXPORT]]) {
            const res: Response = await call(admin, 'POST', `/service-accounts/${account.id}/api-keys`, { name: 'export', permissions, tenantId, requireDpop: false });
            expect(res.status).toBe(400);
        }
    });

    it('revoke a key, which stops working', async () => {
        const tenantId: string = await createTenant();
        const admin: Caller = await logInPerson(AccountRoles.ADMIN, tenantId);
        const account: ServiceAccount = await createAccount(admin, uniqueName('sync'), [AccountRoles.MEMBER]);
        const created: CreatedServiceAccountApiKey = await createKey(admin, account, [TaskPermissions.TASKS_READ]);

        const res: Response = await call(admin, 'DELETE', `/service-accounts/${account.id}/api-keys/${created.apiKey.id}`);

        expect(res.status).toBe(204);
        expect((await listTools(created.key)).status).toBe(401);
        // a key of another account is not one of this one's
        const other: ServiceAccount = await createAccount(admin, uniqueName('sync'), [AccountRoles.MEMBER]);
        const kept: CreatedServiceAccountApiKey = await createKey(admin, other, [TaskPermissions.TASKS_READ]);
        expect((await call(admin, 'DELETE', `/service-accounts/${account.id}/api-keys/${kept.apiKey.id}`)).status).toBe(404);
        expect((await listTools(kept.key)).status).toBe(200);
    });

    it('delete a service account with its keys', async () => {
        const tenantId: string = await createTenant();
        const admin: Caller = await logInPerson(AccountRoles.ADMIN, tenantId);
        const account: ServiceAccount = await createAccount(admin, uniqueName('cleanup'), [AccountRoles.MEMBER]);
        const created: CreatedServiceAccountApiKey = await createKey(admin, account, [TaskPermissions.TASKS_READ]);

        const res: Response = await call(admin, 'DELETE', `/service-accounts/${account.id}`);

        expect(res.status).toBe(204);
        expect(await users().findById(account.id, { required: false })).toBeUndefined();
        expect((await listTools(created.key)).status).toBe(401);
        expect((await call(admin, 'DELETE', `/service-accounts/${account.id}`)).status).toBe(404);
    });

    it('reach no person', async () => {
        const tenantId: string = await createTenant();
        const admin: Caller = await logInPerson(AccountRoles.ADMIN, tenantId);
        const person: JwtUser = await users().create({ email: `${UUIDUtilities.generate()}@example.com`, roles: [AccountRoles.NOBODY] });

        expect((await call(admin, 'POST', `/service-accounts/${person.id}/api-keys`, { name: 'x', permissions: [], requireDpop: false })).status).toBe(404);
        expect((await call(admin, 'PUT', `/service-accounts/${person.id}/roles`, { roles: [AccountRoles.ADMIN], tenantRoles: [] })).status).toBe(404);
        expect((await call(admin, 'GET', `/service-account-tools/${person.id}`)).status).toBe(404);
        expect((await call(admin, 'DELETE', `/service-accounts/${person.id}`)).status).toBe(404);
        expect((await users().findById(person.id)).roles).toEqual([AccountRoles.NOBODY]);
        const listed: ServiceAccount[] = await (await call(admin, 'GET', '/service-accounts')).json() as ServiceAccount[];
        expect(listed.map(account => account.id)).not.toContain(person.id);
    });
});