import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { TOTP } from 'otpauth';
import { type ApprovalRequestDetailsModel, type ApprovalRequestModel, type ErrorResponseBody, type PaginationResult } from 'zibri-contract';
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
import { waitUntil } from '../../__testing__/wait-until.function';
import { OtpTwoFactorMethod } from '../../auth/2fa/methods/otp/otp.two-factor-method';
import { type TwoFactorServiceInterface } from '../../auth/2fa/two-factor-service.interface';
import { type AuthServiceInterface } from '../../auth/auth-service.interface';
import { definePermissions, DefinedPermissions } from '../../auth/roles/define-permissions.function';
import { type Permission } from '../../auth/roles/permission.type';
import { ApiKeyAuthStrategy } from '../../auth/strategies/api-key/api-key.auth-strategy';
import { ApiKey } from '../../auth/strategies/api-key/api-key.model';
import { CreatedApiKey } from '../../auth/strategies/api-key/created-api-key.model';
import { JwtAuthStrategy } from '../../auth/strategies/jwt/jwt.auth-strategy';
import { type ChainVerification } from '../../data-source/chain/chain-verification.model';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { defineProvider } from '../../di/models/di-provider.model';
import { BaseTenantEntity } from '../../entity/base-tenant-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { ConflictError } from '../../error-handling/errors/conflict.error';
import { $ts } from '../../localization/translate.function';
import { Controller } from '../../routing/decorators/controller.decorator';
import { type TenantServiceInterface } from '../../tenancy/tenant-service.interface';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { ApprovalRequestController } from './approval-request.controller';
import { ZibriApprovalPlugin } from './approval.plugin';
import { ZIBRI_APPROVAL_PLUGIN_DI_TOKENS } from './approval.tokens';
import { type ApprovalAction } from './models/approval-action.model';
import { ApprovalActorKind } from './models/approval-actor-kind.enum';
import { ApprovalDecision } from './models/approval-decision.model';
import { type ApprovalRequestDetails } from './models/approval-request-details.model';
import { type ApprovalRequestEventData } from './models/approval-request-event-data.model';
import { ApprovalRequestStatus } from './models/approval-request-status.enum';
import { ApprovalRequest } from './models/approval-request.model';
import { ZibriApprovalPermissions } from './models/zibri-approval-permissions.model';
import { provideApprovalAction } from './provide-approval-action.function';

declare module '../../event/event-service.interface' {

    interface ZibriEventMap {
        'approval-request.created': ApprovalRequestEventData,
        'approval-request.decided': ApprovalRequestEventData
    }
}

@Entity()
class ApprovalTask extends BaseTenantEntity() {
    @Property.string()
    title!: string;

    @Property.string()
    status!: string;

    @Property.string({ required: false })
    label?: string | null;
}

class TaskInput {
    @Property.string({ format: 'uuid' })
    taskId!: string;
}

class LabelTaskInput extends TaskInput {
    @Property.string()
    label!: string;
}

@Controller('/approval-requests', { versions: 'all' })
class AppApprovalRequestController extends ApprovalRequestController {}

// eslint-disable-next-line typescript/typedef
const TASK_PERMISSIONS = ['tasks.close', 'tasks.propose'] as const;

const TaskPermissions: DefinedPermissions<typeof TASK_PERMISSIONS> = definePermissions(TASK_PERMISSIONS);

const PERMISSIONS: Permission[] = [...Object.values(ZibriApprovalPermissions), ...Object.values(TaskPermissions)];

const roles: TestServerRole[] = [
    { name: Roles.USER, level: 'platform', permissions: [], description: undefined },
    { name: MemberRoles.USER, level: 'tenant', permissions: [TaskPermissions.TASKS_PROPOSE], description: undefined },
    { name: MemberRoles.ADMIN, level: 'tenant', permissions: PERMISSIONS, description: undefined }
];

/**
 * How often the actions ran, by name.
 */
const runs: Map<string, number> = new Map();

function tasks(): Repository<ApprovalTask> {
    return inject(repositoryTokenFor(ApprovalTask));
}

function countRun(name: string): void {
    runs.set(name, (runs.get(name) ?? 0) + 1);
}

const closeTask: ApprovalAction<TaskInput, { closed: string }> = {
    name: 'tasks.close',
    input: TaskInput,
    permission: TaskPermissions.TASKS_CLOSE,
    proposePermission: TaskPermissions.TASKS_PROPOSE,
    async describe(input) {
        const task: ApprovalTask = await tasks().findById(input.taskId);
        return { summary: `Close the task "${task.title}"`, rows: [{ entity: ApprovalTask, stored: task, values: { status: 'done' } }] };
    },
    async run(input, context) {
        countRun('tasks.close');
        // slow enough for two approvals at once to overlap
        await new Promise(resolve => setTimeout(resolve, 50));
        await tasks().updateById(input.taskId, { status: 'done' }, { transaction: context.transaction });
        return { closed: input.taskId };
    }
};

const deleteTask: ApprovalAction<TaskInput> = {
    name: 'tasks.delete',
    input: TaskInput,
    permission: TaskPermissions.TASKS_CLOSE,
    proposePermission: TaskPermissions.TASKS_PROPOSE,
    require2fa: true,
    async describe(input) {
        const task: ApprovalTask = await tasks().findById(input.taskId);
        return { summary: `Delete the task "${task.title}"`, rows: [{ entity: ApprovalTask, stored: task, values: null }] };
    },
    async run(input, context) {
        countRun('tasks.delete');
        await tasks().deleteById(input.taskId, { transaction: context.transaction });
    }
};

const labelTask: ApprovalAction<LabelTaskInput> = {
    name: 'tasks.label',
    input: LabelTaskInput,
    permission: TaskPermissions.TASKS_CLOSE,
    proposePermission: TaskPermissions.TASKS_PROPOSE,
    policies: [{ name: 'automatic-labels', approves: input => input.label === 'automatic' }],
    async describe(input) {
        const task: ApprovalTask = await tasks().findById(input.taskId);
        return { summary: `Label the task "${task.title}"`, rows: [{ entity: ApprovalTask, stored: task, values: { label: input.label } }] };
    },
    async run(input, context) {
        countRun('tasks.label');
        await tasks().updateById(input.taskId, { label: input.label }, { transaction: context.transaction });
    }
};

const lockTask: ApprovalAction<TaskInput> = {
    name: 'tasks.lock',
    input: TaskInput,
    permission: TaskPermissions.TASKS_CLOSE,
    proposePermission: TaskPermissions.TASKS_PROPOSE,
    async describe(input) {
        const task: ApprovalTask = await tasks().findById(input.taskId);
        return { summary: `Lock the task "${task.title}"` };
    },
    async run(input, context) {
        await tasks().updateById(input.taskId, { status: 'locked' }, { transaction: context.transaction });
        throw new ConflictError($ts`The task is locked by its project.`);
    }
};

const archiveTask: ApprovalAction<TaskInput> = {
    name: 'tasks.archive',
    input: TaskInput,
    permission: TaskPermissions.TASKS_CLOSE,
    proposePermission: TaskPermissions.TASKS_PROPOSE,
    expiresInMs: 20,
    async describe(input) {
        const task: ApprovalTask = await tasks().findById(input.taskId);
        return { summary: `Archive the task "${task.title}"` };
    },
    async run(input, context) {
        countRun('tasks.archive');
        await tasks().updateById(input.taskId, { status: 'archived' }, { transaction: context.transaction });
    }
};

/**
 * A member of a tenant, with an api key carrying the permissions of their role.
 */
type Member = {
    /**
     * The id of the user.
     */
    userId: string,
    /**
     * The tenant they are a member of.
     */
    tenantId: string,
    /**
     * The api key they send.
     */
    key: string
};

/**
 * The answer of a route.
 */
type Answer<T> = {
    status: number,
    body: T
};

const events: { type: string, data: ApprovalRequestEventData }[] = [];

let server: StartedTestServer | undefined;
let baseUrl: string = '';

beforeAll(async () => {
    server = await startTestServer({
        dataSources: [
            createInMemoryDataSource({
                entities: [...defaultTestServerEntities, ApiKey, TestTenant, ApprovalRequest, ApprovalDecision, ApprovalTask],
                repositories: defaultTestServerRepositories
            })
        ],
        authStrategies: [JwtAuthStrategy, ApiKeyAuthStrategy],
        twoFactorMethods: [OtpTwoFactorMethod],
        controllers: [AppApprovalRequestController],
        plugins: [new ZibriApprovalPlugin()],
        providers: [
            ...defaultTestServerProviders,
            ...rolesAndPermissionsProviders({ permissions: PERMISSIONS, platformPermissions: [] }, roles),
            defineProvider({
                token: ZIBRI_APPROVAL_PLUGIN_DI_TOKENS.OPTIONS_INPUT,
                useValue: { eventNames: { requestCreated: 'approval-request.created', requestDecided: 'approval-request.decided' } }
            }),
            provideApprovalAction(closeTask),
            provideApprovalAction(deleteTask),
            provideApprovalAction(labelTask),
            provideApprovalAction(lockTask),
            provideApprovalAction(archiveTask)
        ]
    });
    baseUrl = await server.start();
    for (const type of ['approval-request.created', 'approval-request.decided'] as const) {
        await inject(ZIBRI_DI_TOKENS.EVENT_SERVICE).subscribe(
            type,
            event => {
                events.push({ type, data: event.data });
            },
            { subscriberId: `approval-test-${type}` }
        );
    }
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

async function addMember(tenantId: string, role: MemberRoles, permissions?: Permission[]): Promise<Member> {
    const user: JwtUser = await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser))
        .create({ email: `${UUIDUtilities.generate()}@example.com`, roles: [Roles.USER] });
    await runInTenant(tenantId, async () => await inject(DefaultTestServerMembershipRepository).create({ tenantId, userId: user.id, roles: [role] }));
    const authService: AuthServiceInterface = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
    const created: CreatedApiKey = await authService.createApiKey(
        user.id,
        {
            name: 'approvals',
            permissions: permissions ?? await authService.resolveUserPermissions(user, tenantId),
            expiresAt: undefined,
            tenantId: undefined,
            clientAuthentication: undefined,
            requireDpop: false
        },
        undefined
    );
    return { userId: user.id, tenantId, key: created.key };
}

async function createTask(tenantId: string, title: string = 'Write the release notes'): Promise<ApprovalTask> {
    return await runInTenant(tenantId, async () => await tasks().create({ title, status: 'open', tenantId }));
}

async function findTask(tenantId: string, taskId: string): Promise<ApprovalTask | undefined> {
    return await runInTenant(tenantId, async () => await tasks().findById(taskId, { required: false }));
}

async function call<T>(path: string, caller: Member, init: RequestInit = {}, headers: Record<string, string> = {}): Promise<Answer<T>> {
    const res: Response = await fetch(`${baseUrl}/approval-requests${path}`, {
        ...init,
        headers: {
            'x-api-key': caller.key,
            'x-tenant-id': caller.tenantId,
            ...typeof init.body === 'string' ? { 'content-type': 'application/json' } : {},
            ...headers
        }
    });
    const text: string = await res.text();
    return { status: res.status, body: (text === '' ? undefined : JSON.parse(text)) as T };
}

async function propose<T = ApprovalRequestDetailsModel>(caller: Member, action: string, input: object): Promise<Answer<T>> {
    return await call<T>('', caller, { method: 'POST', body: JSON.stringify({ action, input, reason: 'The release is out' }) });
}

async function decide<T = ApprovalRequestDetailsModel>(
    caller: Member,
    id: string,
    decision: 'approve' | 'reject',
    headers: Record<string, string> = {}
): Promise<Answer<T>> {
    return await call<T>(`/${id}/${decision}`, caller, { method: 'POST', body: JSON.stringify({ note: 'Looks right' }) }, headers);
}

describe('approval requests', () => {
    it('let a member with only the propose permission create a request that writes nothing', async () => {
        const tenantId: string = await createTenant();
        const member: Member = await addMember(tenantId, MemberRoles.USER);
        const task: ApprovalTask = await createTask(tenantId);

        const proposed: Answer<ApprovalRequestDetailsModel> = await propose(member, 'tasks.close', { taskId: task.id });

        expect(proposed.status).toBe(200);
        expect(proposed.body).toMatchObject({
            request: {
                action: 'tasks.close',
                input: { taskId: task.id },
                reason: 'The release is out',
                summary: 'Close the task "Write the release notes"',
                changes: [{ entity: 'approval_task', id: task.id, changes: [{ key: 'status', previousValue: 'open', newValue: 'done' }] }],
                proposedBy: member.userId,
                proposedByKind: ApprovalActorKind.USER,
                status: ApprovalRequestStatus.PENDING
            },
            decision: null
        });
        expect(proposed.body.request.preconditions).toEqual([{ entity: 'approval_task', id: task.id, hash: expect.any(String) }]);
        expect((await findTask(tenantId, task.id))?.status).toBe('open');
        // the routes of deciding and reading need permissions of their own
        expect((await decide(member, proposed.body.request.id, 'approve')).status).toBe(403);
        expect((await call(`/${proposed.body.request.id}`, member)).status).toBe(403);
    });

    it('refuse to propose an action without its propose permission, and an input that is not one of its model', async () => {
        const tenantId: string = await createTenant();
        const approver: Member = await addMember(tenantId, MemberRoles.ADMIN);
        // a key that carries none of the permissions of its user
        const limited: Member = await addMember(tenantId, MemberRoles.USER, []);
        const task: ApprovalTask = await createTask(tenantId);

        const refused: Answer<ErrorResponseBody> = await propose(limited, 'tasks.close', { taskId: task.id });
        expect(refused.status).toBe(403);
        expect(refused.body.message).toBe('You do not have permission to propose this action.');
        expect((await propose(approver, 'tasks.close', { taskId: 'not-an-id' })).status).toBe(400);
        expect((await propose(approver, 'tasks.unknown', {})).status).toBe(400);
    });

    it('run the action once when approved, as the approver, and record both people', async () => {
        const tenantId: string = await createTenant();
        const proposer: Member = await addMember(tenantId, MemberRoles.USER);
        const approver: Member = await addMember(tenantId, MemberRoles.ADMIN);
        const task: ApprovalTask = await createTask(tenantId);
        const proposed: Answer<ApprovalRequestDetailsModel> = await propose(proposer, 'tasks.close', { taskId: task.id });
        const before: number = runs.get('tasks.close') ?? 0;

        const approved: Answer<ApprovalRequestDetailsModel> = await decide(approver, proposed.body.request.id, 'approve');

        expect(approved.status).toBe(200);
        expect(approved.body).toMatchObject({
            request: { status: ApprovalRequestStatus.APPROVED, proposedBy: proposer.userId },
            decision: {
                requestId: proposed.body.request.id,
                decision: 'APPROVED',
                decidedBy: approver.userId,
                decidedByKind: ApprovalActorKind.USER,
                note: 'Looks right',
                result: { closed: task.id },
                error: null
            }
        });
        expect(runs.get('tasks.close')).toBe(before + 1);
        expect((await findTask(tenantId, task.id))?.status).toBe('done');
        expect((await call<ApprovalRequestDetailsModel>(`/${proposed.body.request.id}`, approver)).body).toEqual(approved.body);
        expect((await decide(approver, proposed.body.request.id, 'approve')).status).toBe(409);
    });

    it('run the action once when two approve at the same moment', async () => {
        const tenantId: string = await createTenant();
        const proposer: Member = await addMember(tenantId, MemberRoles.USER);
        const first: Member = await addMember(tenantId, MemberRoles.ADMIN);
        const second: Member = await addMember(tenantId, MemberRoles.ADMIN);
        const task: ApprovalTask = await createTask(tenantId);
        const proposed: Answer<ApprovalRequestDetailsModel> = await propose(proposer, 'tasks.close', { taskId: task.id });
        const before: number = runs.get('tasks.close') ?? 0;

        const answers: Answer<unknown>[] = await Promise.all([
            decide(first, proposed.body.request.id, 'approve'),
            decide(second, proposed.body.request.id, 'approve')
        ]);

        expect(answers.map(answer => answer.status).sort()).toEqual([200, 409]);
        expect(runs.get('tasks.close')).toBe(before + 1);
    });

    it('never let the proposer approve their own request, whatever they may do', async () => {
        const tenantId: string = await createTenant();
        const admin: Member = await addMember(tenantId, MemberRoles.ADMIN);
        const task: ApprovalTask = await createTask(tenantId);
        const proposed: Answer<ApprovalRequestDetailsModel> = await propose(admin, 'tasks.close', { taskId: task.id });

        const approved: Answer<ErrorResponseBody> = await decide(admin, proposed.body.request.id, 'approve');

        expect(approved.status).toBe(403);
        expect(approved.body.message).toBe('You cannot approve an approval request you proposed.');
        expect((await findTask(tenantId, task.id))?.status).toBe('open');
    });

    it('refuse a request whose row changed since it was proposed, with a message', async () => {
        const tenantId: string = await createTenant();
        const proposer: Member = await addMember(tenantId, MemberRoles.USER);
        const approver: Member = await addMember(tenantId, MemberRoles.ADMIN);
        const task: ApprovalTask = await createTask(tenantId);
        const proposed: Answer<ApprovalRequestDetailsModel> = await propose(proposer, 'tasks.close', { taskId: task.id });
        await runInTenant(tenantId, async () => await tasks().updateById(task.id, { title: 'Write the changelog' }));

        const approved: Answer<ErrorResponseBody> = await decide(approver, proposed.body.request.id, 'approve');

        expect(approved.status).toBe(409);
        expect(approved.body.message).toBe(
            `The row ${task.id} of approval_task changed since the approval request was proposed. Propose the action again.`
        );
        expect((await findTask(tenantId, task.id))?.status).toBe('open');
    });

    it('record the note of a rejection, after which the request cannot be approved', async () => {
        const tenantId: string = await createTenant();
        const proposer: Member = await addMember(tenantId, MemberRoles.USER);
        const approver: Member = await addMember(tenantId, MemberRoles.ADMIN);
        const task: ApprovalTask = await createTask(tenantId);
        const proposed: Answer<ApprovalRequestDetailsModel> = await propose(proposer, 'tasks.close', { taskId: task.id });

        const rejected: Answer<ApprovalRequestDetailsModel> = await decide(approver, proposed.body.request.id, 'reject');

        expect(rejected.body).toMatchObject({
            request: { status: ApprovalRequestStatus.REJECTED },
            decision: { decision: 'REJECTED', decidedBy: approver.userId, note: 'Looks right', result: null }
        });
        expect((await decide(approver, proposed.body.request.id, 'approve')).status).toBe(409);
        expect((await findTask(tenantId, task.id))?.status).toBe('open');
    });

    it('record an action that fails as FAILED, with its error, keeping nothing it wrote', async () => {
        const tenantId: string = await createTenant();
        const proposer: Member = await addMember(tenantId, MemberRoles.USER);
        const approver: Member = await addMember(tenantId, MemberRoles.ADMIN);
        const task: ApprovalTask = await createTask(tenantId);
        const proposed: Answer<ApprovalRequestDetailsModel> = await propose(proposer, 'tasks.lock', { taskId: task.id });

        const approved: Answer<ApprovalRequestDetailsModel> = await decide(approver, proposed.body.request.id, 'approve');

        expect(approved.body).toMatchObject({
            request: { status: ApprovalRequestStatus.FAILED },
            decision: { decision: 'APPROVED', error: 'The task is locked by its project.', result: null }
        });
        expect((await findTask(tenantId, task.id))?.status).toBe('open');
    });

    it('refuse an expired request, and close every expired one', async () => {
        const tenantId: string = await createTenant();
        const proposer: Member = await addMember(tenantId, MemberRoles.USER);
        const approver: Member = await addMember(tenantId, MemberRoles.ADMIN);
        const task: ApprovalTask = await createTask(tenantId);
        const first: Answer<ApprovalRequestDetailsModel> = await propose(proposer, 'tasks.archive', { taskId: task.id });
        const second: Answer<ApprovalRequestDetailsModel> = await propose(proposer, 'tasks.archive', { taskId: task.id });
        await new Promise(resolve => setTimeout(resolve, 50));

        const approved: Answer<ErrorResponseBody> = await decide(approver, first.body.request.id, 'approve');
        expect(approved.status).toBe(409);
        expect(approved.body.message).toContain('The approval request expired at');
        expect((await call<ApprovalRequestDetailsModel>(`/${first.body.request.id}`, approver)).body.request.status).toBe(ApprovalRequestStatus.EXPIRED);
        expect(runs.get('tasks.archive')).toBeUndefined();

        expect(await inject(ZIBRI_APPROVAL_PLUGIN_DI_TOKENS.APPROVAL_REQUEST_SERVICE).closeExpiredRequests()).toBeGreaterThanOrEqual(1);
        expect((await call<ApprovalRequestDetailsModel>(`/${second.body.request.id}`, approver)).body.request.status).toBe(ApprovalRequestStatus.EXPIRED);
        const expired: Answer<PaginationResult<ApprovalRequestModel>> = await call('?page=1&limit=10&status=EXPIRED', approver);
        expect(expired.body.items.map(request => request.id).sort()).toEqual([first.body.request.id, second.body.request.id].sort());
    });

    it('take a second factor of the approver where the action requires one', async () => {
        const tenantId: string = await createTenant();
        const proposer: Member = await addMember(tenantId, MemberRoles.USER);
        const approver: Member = await addMember(tenantId, MemberRoles.ADMIN);
        const task: ApprovalTask = await createTask(tenantId);
        const user: JwtUser = await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser)).findById(approver.userId);
        const twoFactorService: TwoFactorServiceInterface = inject(ZIBRI_DI_TOKENS.TWO_FACTOR_SERVICE);
        const otp: OtpTwoFactorMethod = inject(OtpTwoFactorMethod);
        const secret: string = (await twoFactorService.requestTwoFactorRegistration(user, otp, undefined)).secret;
        // the previous step's code, so the current one is still unspent for the approval
        await twoFactorService.confirmTwoFactorRegistration(user, otp, { token: new TOTP({ secret }).generate({ timestamp: Date.now() - 30_000 }) });
        const proposed: Answer<ApprovalRequestDetailsModel> = await propose(proposer, 'tasks.delete', { taskId: task.id });
        expect(proposed.body.request.changes).toEqual([
            {
                entity: 'approval_task',
                id: task.id,
                changes: [
                    { key: 'status', previousValue: 'open', newValue: null },
                    { key: 'tenantId', previousValue: tenantId, newValue: null },
                    { key: 'title', previousValue: 'Write the release notes', newValue: null }
                ]
            }
        ]);

        expect((await decide(approver, proposed.body.request.id, 'approve')).status).toBe(401);
        expect(await findTask(tenantId, task.id)).toBeDefined();

        const approved: Answer<ApprovalRequestDetailsModel> = await decide(
            approver,
            proposed.body.request.id,
            'approve',
            { [inject(ZIBRI_DI_TOKENS.OTP_HEADER)]: new TOTP({ secret }).generate() }
        );
        expect(approved.body.request.status).toBe(ApprovalRequestStatus.APPROVED);
        expect(await findTask(tenantId, task.id)).toBeUndefined();
    });

    it('let the system propose, and a policy approve on its own, recorded as the one that decided', async () => {
        const tenantId: string = await createTenant();
        const task: ApprovalTask = await createTask(tenantId);

        const automatic: ApprovalRequestDetails = await runInTenant(tenantId, async () => await inject(ZIBRI_APPROVAL_PLUGIN_DI_TOKENS.APPROVAL_REQUEST_SERVICE)
            .propose({ action: 'tasks.label', input: { taskId: task.id, label: 'automatic' }, system: 'labeling' }));
        const manual: ApprovalRequestDetails = await runInTenant(tenantId, async () => await inject(ZIBRI_APPROVAL_PLUGIN_DI_TOKENS.APPROVAL_REQUEST_SERVICE)
            .propose({ action: 'tasks.label', input: { taskId: task.id, label: 'urgent' }, system: 'labeling' }));

        expect(automatic).toMatchObject({
            request: { status: ApprovalRequestStatus.APPROVED, proposedBy: 'labeling', proposedByKind: ApprovalActorKind.SYSTEM },
            decision: { decision: 'APPROVED', decidedBy: 'automatic-labels', decidedByKind: ApprovalActorKind.POLICY }
        });
        expect(manual).toMatchObject({ request: { status: ApprovalRequestStatus.PENDING }, decision: null });
        expect((await findTask(tenantId, task.id))?.label).toBe('automatic');
        expect(runs.get('tasks.label')).toBe(1);
    });

    it('keep the decisions of a tenant as a chain the chain service verifies', async () => {
        const tenantId: string = await createTenant();
        const proposer: Member = await addMember(tenantId, MemberRoles.USER);
        const approver: Member = await addMember(tenantId, MemberRoles.ADMIN);
        for (const title of ['Write the release notes', 'Publish the release']) {
            const task: ApprovalTask = await createTask(tenantId, title);
            const proposed: Answer<ApprovalRequestDetailsModel> = await propose(proposer, 'tasks.close', { taskId: task.id });
            await decide(approver, proposed.body.request.id, title === 'Publish the release' ? 'reject' : 'approve');
        }

        const verification: ChainVerification = await inject(ZIBRI_DI_TOKENS.CHAIN_SERVICE).resolveChainVerification(ApprovalDecision, tenantId);

        expect(verification).toMatchObject({ intact: true, newestSequence: 2 });
    });

    it('emit the events the application named for proposing and deciding', async () => {
        const tenantId: string = await createTenant();
        const proposer: Member = await addMember(tenantId, MemberRoles.USER);
        const approver: Member = await addMember(tenantId, MemberRoles.ADMIN);
        const task: ApprovalTask = await createTask(tenantId);
        const proposed: Answer<ApprovalRequestDetailsModel> = await propose(proposer, 'tasks.close', { taskId: task.id });
        await decide(approver, proposed.body.request.id, 'approve');
        const requestId: string = proposed.body.request.id;

        await waitUntil(() => events.filter(event => event.data.requestId === requestId).length === 2);

        // in the order they were emitted or not, which instance picks one up decides
        expect(events.filter(event => event.data.requestId === requestId)).toEqual(expect.arrayContaining([
            { type: 'approval-request.created', data: { requestId, action: 'tasks.close', status: ApprovalRequestStatus.PENDING } },
            { type: 'approval-request.decided', data: { requestId, action: 'tasks.close', status: ApprovalRequestStatus.APPROVED } }
        ]));
    });
});