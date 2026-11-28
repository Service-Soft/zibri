import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { TestTimeouts } from '../../__testing__/constants';
import { JwtUser } from '../../__testing__/mocks/entities/jwt-user.entity';
import { MemberRoles } from '../../__testing__/mocks/entities/member-roles.enum';
import { Roles } from '../../__testing__/mocks/entities/roles.enum';
import { TestTenant } from '../../__testing__/mocks/entities/test-tenant.entity';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { DefaultTestServerMembershipRepository } from '../../__testing__/test-server/membership-repository';
import { defaultTestServerProviders, rolesAndPermissionsProviders, TestServerRole } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { AuditEntry } from '../../audit/audit-entry.model';
import { type AuthServiceInterface } from '../../auth/auth-service.interface';
import { definePermissions, DefinedPermissions } from '../../auth/roles/define-permissions.function';
import { type Permission } from '../../auth/roles/permission.type';
import { ApiKeyAuthStrategy } from '../../auth/strategies/api-key/api-key.auth-strategy';
import { ApiKey } from '../../auth/strategies/api-key/api-key.model';
import { CreatedApiKey } from '../../auth/strategies/api-key/created-api-key.model';
import { JwtAuthStrategy } from '../../auth/strategies/jwt/jwt.auth-strategy';
import { type UserServiceInterface } from '../../auth/user/user-service.interface';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { BaseTenantEntity } from '../../entity/base-tenant-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { AuditAction, AuditOutcome, AuditReason } from '../../logging/audit-event.model';
import { RateLimitStoreFailurePolicy } from '../../rate-limiting/limiter/rate-limiter-config.model';
import { Controller } from '../../routing/decorators/controller.decorator';
import { type TenantServiceInterface } from '../../tenancy/tenant-service.interface';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { ApprovalRequestController } from '../approval/approval-request.controller';
import { ZibriApprovalPlugin } from '../approval/approval.plugin';
import { type ApprovalAction } from '../approval/models/approval-action.model';
import { ApprovalDecision } from '../approval/models/approval-decision.model';
import { ApprovalRequestStatus } from '../approval/models/approval-request-status.enum';
import { ApprovalRequest } from '../approval/models/approval-request.model';
import { ZibriApprovalPermissions } from '../approval/models/zibri-approval-permissions.model';
import { provideApprovalAction } from '../approval/provide-approval-action.function';
import { McpController } from './mcp.controller';
import { ZibriMcpPlugin } from './mcp.plugin';
import { type McpReadTool } from './models/mcp-read-tool.model';
import { MCP_PROTOCOL_REVISIONS } from './models/mcp-protocol-revisions.model';
import { type McpWriteTool } from './models/mcp-write-tool.model';
import { provideMcpTool } from './provide-mcp-tool.function';

@Entity()
class McpTask extends BaseTenantEntity() {
    @Property.string()
    title!: string;

    @Property.string()
    status!: string;
}

class FindTasksInput {
    @Property.string({ enum: { open: 'open', done: 'done' } })
    status!: string;
}

class TaskSummary {
    @Property.string({ format: 'uuid' })
    id!: string;

    @Property.string()
    title!: string;
}

class FoundTasks {
    @Property.array({ items: { type: 'object', cls: () => TaskSummary } })
    tasks!: TaskSummary[];
}

class CloseTaskInput {
    @Property.string({ format: 'uuid' })
    taskId!: string;
}

@Controller('/mcp', { versions: 'all' })
class AppMcpController extends McpController {}

@Controller('/approval-requests', { versions: 'all' })
class AppApprovalRequestController extends ApprovalRequestController {}

// eslint-disable-next-line typescript/typedef
const TASK_PERMISSIONS = ['tasks.read', 'tasks.close', 'tasks.propose'] as const;

const TaskPermissions: DefinedPermissions<typeof TASK_PERMISSIONS> = definePermissions(TASK_PERMISSIONS);

const PERMISSIONS: Permission[] = [...Object.values(ZibriApprovalPermissions), ...Object.values(TaskPermissions)];

const roles: TestServerRole[] = [
    { name: Roles.USER, level: 'platform', permissions: [], description: undefined },
    { name: MemberRoles.USER, level: 'tenant', permissions: [TaskPermissions.TASKS_READ, TaskPermissions.TASKS_PROPOSE], description: undefined },
    { name: MemberRoles.ADMIN, level: 'tenant', permissions: PERMISSIONS, description: undefined }
];

const ALLOWED_ORIGIN: string = 'https://app.example.com';

function tasks(): Repository<McpTask> {
    return inject(repositoryTokenFor(McpTask));
}

const findTasks: McpReadTool<FindTasksInput, FoundTasks> = {
    kind: 'read',
    name: 'tasks.find',
    title: 'Find tasks',
    description: 'Finds the tasks of the tenant of a status.',
    input: FindTasksInput,
    output: FoundTasks,
    permission: TaskPermissions.TASKS_READ,
    async read(input) {
        const found: McpTask[] = await tasks().findAll({ where: { status: input.status } });
        // the rows themselves, of which the answer keeps what the output model declares
        return { tasks: found };
    }
};

const closeTaskAction: ApprovalAction<CloseTaskInput> = {
    name: 'tasks.close',
    input: CloseTaskInput,
    permission: TaskPermissions.TASKS_CLOSE,
    proposePermission: TaskPermissions.TASKS_PROPOSE,
    async describe(input) {
        const task: McpTask = await tasks().findById(input.taskId);
        return { summary: `Close the task "${task.title}"`, rows: [{ entity: McpTask, stored: task, values: { status: 'done' } }] };
    },
    async run(input, context) {
        await tasks().updateById(input.taskId, { status: 'done' }, { transaction: context.transaction });
    }
};

const closeTask: McpWriteTool<CloseTaskInput> = {
    kind: 'write',
    name: 'tasks.close',
    description: 'Proposes closing a task, which a person approves.',
    action: closeTaskAction
};

/**
 * Who calls: the user and the key they send, in a tenant.
 */
type Caller = {
    userId: string,
    tenantId: string,
    key: string
};

/**
 * What the endpoint answered.
 */
type Answer = {
    status: number,
    // the JSON-RPC response, read as the client reads it
    // eslint-disable-next-line typescript/no-explicit-any
    body: any
};

let server: StartedTestServer | undefined;
let baseUrl: string = '';

beforeAll(async () => {
    server = await startTestServer({
        dataSources: [
            createInMemoryDataSource({
                entities: [...defaultTestServerEntities, ApiKey, TestTenant, ApprovalRequest, ApprovalDecision, McpTask],
                repositories: defaultTestServerRepositories
            })
        ],
        authStrategies: [JwtAuthStrategy, ApiKeyAuthStrategy],
        controllers: [AppMcpController, AppApprovalRequestController],
        plugins: [
            new ZibriApprovalPlugin(),
            new ZibriMcpPlugin({
                allowedOrigins: [ALLOWED_ORIGIN],
                rateLimit: { maxRequests: 1000, windowInMs: 60_000, onStoreFailure: RateLimitStoreFailurePolicy.REJECT },
                instructions: 'Find the open tasks first.'
            })
        ],
        providers: [
            ...defaultTestServerProviders,
            ...rolesAndPermissionsProviders({ permissions: PERMISSIONS, platformPermissions: [] }, roles),
            provideApprovalAction(closeTaskAction),
            provideMcpTool(findTasks),
            provideMcpTool(closeTask)
        ]
    });
    baseUrl = await server.start();
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.inMemory.shutdown);

async function createTenant(): Promise<string> {
    return (await inject<Repository<TestTenant>>(repositoryTokenFor(TestTenant)).create({ name: 'Acme' })).id;
}

async function runInTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    return await inject<TenantServiceInterface>(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(tenantId, fn);
}

/**
 * Gives a user a membership in a tenant, and a key.
 * @param user - The user.
 * @param tenantId - The tenant.
 * @param role - Their role there.
 * @param permissions - What the key may use, all their role carries by default.
 * @returns The caller.
 */
async function addMember(user: JwtUser, tenantId: string, role: MemberRoles, permissions?: Permission[]): Promise<Caller> {
    await runInTenant(tenantId, async () => await inject(DefaultTestServerMembershipRepository).create({ tenantId, userId: user.id, roles: [role] }));
    const authService: AuthServiceInterface = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
    const created: CreatedApiKey = await authService.createApiKey(
        user.id,
        {
            name: 'assistant',
            permissions: permissions ?? await authService.resolveUserPermissions(user, tenantId),
            expiresAt: undefined,
            tenantId,
            clientAuthentication: undefined,
            requireDpop: false
        },
        undefined
    );
    return { userId: user.id, tenantId, key: created.key };
}

async function addAssistant(tenantId: string, permissions?: Permission[]): Promise<Caller> {
    const userService: UserServiceInterface = inject(ZIBRI_DI_TOKENS.USER_SERVICE);
    if (userService.createServiceAccount == undefined) {
        throw new Error('The user service of the test server creates service accounts.');
    }
    const assistant: JwtUser = await userService.createServiceAccount(JwtUser, { name: `assistant-${UUIDUtilities.generate()}`, roles: [Roles.USER] }, undefined);
    return await addMember(assistant, tenantId, MemberRoles.USER, permissions);
}

async function addPerson(tenantId: string, role: MemberRoles): Promise<Caller> {
    const person: JwtUser = await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser))
        .create({ email: `${UUIDUtilities.generate()}@example.com`, roles: [Roles.USER] });
    return await addMember(person, tenantId, role);
}

async function createTask(tenantId: string, title: string, status: string = 'open'): Promise<McpTask> {
    return await runInTenant(tenantId, async () => await tasks().create({ title, status, tenantId }));
}

async function post(caller: Caller, message: object, headers: Record<string, string>): Promise<Answer> {
    const res: Response = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: {
            'x-api-key': caller.key,
            'content-type': 'application/json',
            'accept': 'application/json, text/event-stream',
            ...headers
        },
        body: JSON.stringify(message)
    });
    const text: string = await res.text();
    return { status: res.status, body: text === '' ? undefined : JSON.parse(text) };
}

/**
 * A client of a revision that names itself on every request.
 * @param caller - Who calls.
 * @param revision - The revision.
 * @returns A function sending a request of a method, with the headers the revision asks for.
 */
function statelessClient(caller: Caller, revision: string): (method: string, params?: Record<string, unknown>, headers?: Record<string, string>) => Promise<Answer> {
    return async (method, params = {}, headers = {}) => await post(
        caller,
        {
            jsonrpc: '2.0',
            id: UUIDUtilities.generate(),
            method,
            params: {
                ...params,
                _meta: {
                    'io.modelcontextprotocol/protocolVersion': revision,
                    'io.modelcontextprotocol/clientInfo': { name: 'test-client', version: '1.0.0' },
                    'io.modelcontextprotocol/clientCapabilities': {}
                }
            }
        },
        {
            'mcp-protocol-version': revision,
            'mcp-method': method,
            ...typeof params['name'] === 'string' ? { 'mcp-name': params['name'] } : {},
            ...headers
        }
    );
}

/**
 * A client of a revision that starts with `initialize`, once it has.
 * @param caller - Who calls.
 * @param revision - The revision negotiated.
 * @returns A function sending a request of a method.
 */
function handshakeClient(caller: Caller, revision: string): (method: string, params?: Record<string, unknown>) => Promise<Answer> {
    return async (method, params = {}) => await post(
        caller,
        { jsonrpc: '2.0', id: UUIDUtilities.generate(), method, params },
        { 'mcp-protocol-version': revision }
    );
}

async function callsOf(userId: string): Promise<AuditEntry[]> {
    await inject(ZIBRI_DI_TOKENS.AUDIT_SERVICE).flush();
    return await inject(repositoryTokenFor(AuditEntry)).findAll({ where: { action: AuditAction.MCP_TOOL_CALLED, userId }, acrossTenants: true });
}

describe.each(MCP_PROTOCOL_REVISIONS.stateless)('the MCP endpoint, revision %s', revision => {
    it('lets a client discover the server, list the tools and call one that reads', async () => {
        const tenantId: string = await createTenant();
        const open: McpTask = await createTask(tenantId, 'Write the release notes');
        await createTask(tenantId, 'Plan the launch', 'done');
        const assistant: Caller = await addAssistant(tenantId);
        const send: ReturnType<typeof statelessClient> = statelessClient(assistant, revision);

        const discovered: Answer = await send('server/discover');
        expect(discovered.status).toBe(200);
        expect(discovered.body.result).toMatchObject({
            resultType: 'complete',
            supportedVersions: [...MCP_PROTOCOL_REVISIONS.stateless, ...MCP_PROTOCOL_REVISIONS.handshake],
            capabilities: { tools: {} },
            instructions: 'Find the open tasks first.',
            ttlMs: 0,
            _meta: { 'io.modelcontextprotocol/serverInfo': { name: expect.any(String) } }
        });

        const listed: Answer = await send('tools/list');
        expect(listed.body.result.cacheScope).toBe('private');
        expect(listed.body.result.tools).toMatchObject([
            {
                name: 'tasks.find',
                title: 'Find tasks',
                inputSchema: { type: 'object', properties: { status: { type: 'string', enum: ['open', 'done'] } }, required: ['status'] },
                outputSchema: { type: 'object', properties: { tasks: { type: 'array' } } },
                annotations: { readOnlyHint: true }
            },
            { name: 'tasks.close', inputSchema: { properties: { taskId: { type: 'string', format: 'uuid' } } }, annotations: { readOnlyHint: false } }
        ]);

        const called: Answer = await send('tools/call', { name: 'tasks.find', arguments: { status: 'open' } });
        expect(called.status).toBe(200);
        expect(called.body.result).toMatchObject({ resultType: 'complete', isError: false });
        // the properties of the output model, and none of the rows the tool read beside them
        expect(called.body.result.structuredContent).toEqual({ tasks: [{ id: open.id, title: 'Write the release notes' }] });
        expect(JSON.parse(called.body.result.content[0].text)).toEqual(called.body.result.structuredContent);
        expect(await callsOf(assistant.userId)).toMatchObject([
            { outcome: AuditOutcome.SUCCESS, subject: 'tasks.find', userKind: 'service', tenantId }
        ]);
    });

    it('hides a tool whose permission the key does not carry, and refuses a call of it', async () => {
        const tenantId: string = await createTenant();
        const task: McpTask = await createTask(tenantId, 'Write the release notes');
        // a member who may propose, whose key carries the permission to read only
        const reader: Caller = await addAssistant(tenantId, [TaskPermissions.TASKS_READ]);
        const send: ReturnType<typeof statelessClient> = statelessClient(reader, revision);

        expect((await send('tools/list')).body.result.tools.map((tool: { name: string }) => tool.name)).toEqual(['tasks.find']);
        const refused: Answer = await send('tools/call', { name: 'tasks.close', arguments: { taskId: task.id } });
        const unknown: Answer = await send('tools/call', { name: 'tasks.delete', arguments: {} });

        expect(refused.body.error).toMatchObject({ code: -32_602 });
        expect(unknown.body.error).toMatchObject({ code: -32_602 });
        expect(await runInTenant(tenantId, async () => await inject(repositoryTokenFor(ApprovalRequest)).count({}))).toBe(0);
        expect(await callsOf(reader.userId)).toEqual(expect.arrayContaining([
            expect.objectContaining({ outcome: AuditOutcome.FAILURE, reason: AuditReason.MISSING_PERMISSION, subject: 'tasks.close' }),
            expect.objectContaining({ outcome: AuditOutcome.FAILURE, reason: AuditReason.REFUSED, subject: 'tasks.delete' })
        ]));
    });

    it('answers a write tool with the approval request it proposed, and writes nothing until a person approves it', async () => {
        const tenantId: string = await createTenant();
        const task: McpTask = await createTask(tenantId, 'Write the release notes');
        const assistant: Caller = await addAssistant(tenantId);
        const admin: Caller = await addPerson(tenantId, MemberRoles.ADMIN);

        const called: Answer = await statelessClient(assistant, revision)('tools/call', { name: 'tasks.close', arguments: { taskId: task.id } });

        const approvalRequestId: string = called.body.result.structuredContent.approvalRequestId;
        expect(called.body.result.structuredContent).toEqual({ approvalRequestId: expect.any(String), status: ApprovalRequestStatus.PENDING });
        expect((await runInTenant(tenantId, async () => await tasks().findById(task.id))).status).toBe('open');
        expect(await callsOf(assistant.userId)).toMatchObject([{ outcome: AuditOutcome.SUCCESS, subject: 'tasks.close', approvalRequestId }]);

        const approved: Response = await fetch(`${baseUrl}/approval-requests/${approvalRequestId}/approve`, {
            method: 'POST',
            headers: { 'x-api-key': admin.key, 'content-type': 'application/json' },
            body: JSON.stringify({})
        });
        expect(approved.status).toBe(200);
        expect((await runInTenant(tenantId, async () => await tasks().findById(task.id))).status).toBe('done');
    });

    it('answers arguments that are not of the model as an error of the tool, for the model to correct', async () => {
        const tenantId: string = await createTenant();
        const assistant: Caller = await addAssistant(tenantId);

        const called: Answer = await statelessClient(assistant, revision)('tools/call', { name: 'tasks.find', arguments: { status: 'archived' } });

        expect(called.status).toBe(200);
        expect(called.body.result).toMatchObject({ isError: true, content: [{ type: 'text', text: expect.stringContaining('status') }] });
        expect(await callsOf(assistant.userId)).toMatchObject([{ outcome: AuditOutcome.FAILURE, reason: AuditReason.REFUSED }]);
    });

    it('refuses a foreign origin, and takes an allowed one', async () => {
        const assistant: Caller = await addAssistant(await createTenant());
        const send: ReturnType<typeof statelessClient> = statelessClient(assistant, revision);

        expect((await send('tools/list', {}, { origin: 'https://attacker.example.net' })).status).toBe(403);
        expect((await send('tools/list', {}, { origin: ALLOWED_ORIGIN })).status).toBe(200);
    });

    it('refuses the key of a person', async () => {
        const person: Caller = await addPerson(await createTenant(), MemberRoles.ADMIN);

        expect((await statelessClient(person, revision)('tools/list')).status).toBe(403);
    });

    it('refuses a request whose headers do not match it, and an unknown method', async () => {
        const assistant: Caller = await addAssistant(await createTenant());
        const send: ReturnType<typeof statelessClient> = statelessClient(assistant, revision);

        const mismatched: Answer = await send('tools/list', {}, { 'mcp-method': 'tools/call' });
        const unknown: Answer = await send('resources/list');

        expect(mismatched.status).toBe(400);
        expect(mismatched.body.error.code).toBe(-32_020);
        expect(unknown.status).toBe(404);
        expect(unknown.body.error.code).toBe(-32_601);
    });
});

describe('the MCP endpoint, for every revision', () => {
    it('answers a revision it does not speak with the ones it does', async () => {
        const assistant: Caller = await addAssistant(await createTenant());

        const answer: Answer = await statelessClient(assistant, '1900-01-01')('tools/list');

        expect(answer.status).toBe(400);
        expect(answer.body.error).toMatchObject({
            code: -32_022,
            data: { supported: [...MCP_PROTOCOL_REVISIONS.stateless, ...MCP_PROTOCOL_REVISIONS.handshake], requested: '1900-01-01' }
        });
    });

    it('refuses a request of a stateless revision without the capabilities of its client', async () => {
        const assistant: Caller = await addAssistant(await createTenant());
        const revision: string = MCP_PROTOCOL_REVISIONS.stateless[0] ?? '';

        const answer: Answer = await post(
            assistant,
            { jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': revision } } },
            { 'mcp-protocol-version': revision, 'mcp-method': 'tools/list' }
        );

        expect(answer.status).toBe(400);
        expect(answer.body.error.code).toBe(-32_602);
    });

    it('opens no stream of the server', async () => {
        const assistant: Caller = await addAssistant(await createTenant());

        expect((await fetch(`${baseUrl}/mcp`, { headers: { 'x-api-key': assistant.key, 'accept': 'text/event-stream' } })).status).toBe(405);
    });

    it('answers a message that is no JSON-RPC request', async () => {
        const assistant: Caller = await addAssistant(await createTenant());

        const answer: Answer = await post(assistant, { id: 1, method: 'tools/list' }, {});

        expect(answer.status).toBe(400);
        expect(answer.body.error.code).toBe(-32_600);
    });
});

describe.each(MCP_PROTOCOL_REVISIONS.handshake)('the MCP endpoint, revision %s', revision => {
    it('initializes, lists the tools and calls one that reads, without a session', async () => {
        const tenantId: string = await createTenant();
        const open: McpTask = await createTask(tenantId, 'Write the release notes');
        const assistant: Caller = await addAssistant(tenantId);

        const initialized: Answer = await post(
            assistant,
            { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: revision, capabilities: {}, clientInfo: { name: 'test-client', version: '1.0.0' } } },
            {}
        );
        expect(initialized.body.result).toMatchObject({
            protocolVersion: revision,
            capabilities: { tools: {} },
            serverInfo: { name: expect.any(String), version: expect.any(String) },
            instructions: 'Find the open tasks first.'
        });
        expect(initialized.body.result.resultType).toBeUndefined();
        const notified: Answer = await post(assistant, { jsonrpc: '2.0', method: 'notifications/initialized' }, { 'mcp-protocol-version': revision });
        expect(notified).toEqual({ status: 202, body: undefined });

        const send: ReturnType<typeof handshakeClient> = handshakeClient(assistant, revision);
        expect((await send('ping')).body.result).toEqual({});
        expect((await send('tools/list')).body.result.tools.map((tool: { name: string }) => tool.name)).toEqual(['tasks.find', 'tasks.close']);
        const called: Answer = await send('tools/call', { name: 'tasks.find', arguments: { status: 'open' } });
        expect(called.body.result).toMatchObject({ isError: false, structuredContent: { tasks: [{ id: open.id }] } });
        expect(await callsOf(assistant.userId)).toMatchObject([{ outcome: AuditOutcome.SUCCESS, subject: 'tasks.find' }]);
    });

    it('answers an initialize asking for a revision it does not speak with the latest it does', async () => {
        const assistant: Caller = await addAssistant(await createTenant());

        const initialized: Answer = await post(
            assistant,
            { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test-client', version: '1.0.0' } } },
            {}
        );

        expect(initialized.body.result.protocolVersion).toBe(MCP_PROTOCOL_REVISIONS.handshake[0]);
    });

    it('refuses a request after the handshake that names no revision', async () => {
        const assistant: Caller = await addAssistant(await createTenant());

        const answer: Answer = await post(assistant, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, {});

        expect(answer.status).toBe(400);
        expect(answer.body.error.data.requested).toBe('2025-03-26');
    });
});
