import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { RecordingEmailTransport } from 'zibri-testing';

import { compileTsxTemplate } from '../../__testing__/compile-tsx-template.function';
import { JwtUser } from '../../__testing__/mocks/entities/jwt-user.entity';
import { Roles } from '../../__testing__/mocks/entities/roles.enum';
import { TestInvitation } from '../../__testing__/mocks/entities/test-invitation.entity';
import { DefaultTestServerMembershipRepository } from '../../__testing__/test-server/membership-repository';
import { defaultTestServerProviders, rolesAndPermissionsProviders, TestServerRole } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { waitUntil } from '../../__testing__/wait-until.function';
import { OtpTwoFactorMethod } from '../../auth/2fa/methods/otp/otp.two-factor-method';
import { type AuthServiceInterface } from '../../auth/auth-service.interface';
import { AuthController } from '../../auth/auth-controller/auth-controller.model';
import { LoginLinkEmailTemplate } from '../../auth/authenticators/login-link/login-link-email-template.model';
import { LoginLinkToken } from '../../auth/authenticators/login-link/login-link-token.model';
import { LoginLinkAuthenticator } from '../../auth/authenticators/login-link/login-link.authenticator';
import { PasswordAuthenticator } from '../../auth/authenticators/password/password.authenticator';
import { InvitationEmailTemplate } from '../../auth/invitation/invitation-email-template.model';
import { definePermissions, definePlatformPermissions } from '../../auth/roles/define-permissions.function';
import { type Permission } from '../../auth/roles/permission.type';
import { type PlatformPermission } from '../../auth/roles/platform-permission.type';
import { ZIBRI_PERMISSIONS, ZIBRI_PLATFORM_PERMISSIONS } from '../../auth/roles/zibri-permissions.model';
import { ApiKeyAuthStrategy } from '../../auth/strategies/api-key/api-key.auth-strategy';
import { ApiKey } from '../../auth/strategies/api-key/api-key.model';
import { CreatedApiKey } from '../../auth/strategies/api-key/created-api-key.model';
import { JwtAuthStrategy } from '../../auth/strategies/jwt/jwt.auth-strategy';
import { DataSourceInterface } from '../../data-source/data-sources/data-source.interface';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { defineProvider } from '../../di/models/di-provider.model';
import { EmailConfigInput } from '../../email/models/email-config.model';
import { BaseEntity } from '../../entity/base-entity.model';
import { type Event } from '../../event/event.model';
import { Controller } from '../../routing/decorators/controller.decorator';
import { RowShare } from '../../sharing/row-share.model';
import { type TenantServiceInterface } from '../../tenancy/tenant-service.interface';
import { Newable } from '../../types/newable.type';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { ZIBRI_WEB_DAV_PERMISSIONS } from '../../web-dav/zibri-web-dav-permissions.model';
import { ProjectCalendarDefaults } from './models/project-calendar-defaults.model';
import { ProjectColumn } from './models/project-column.model';
import { Project } from './models/project.model';
import { type ProjectsPluginOptionsInput } from './models/projects-plugin-options-input.model';
import { RecurringTaskOccurrence } from './models/recurring-task-occurrence.model';
import { RecurringTask } from './models/recurring-task.model';
import { TaskComment } from './models/task-comment.model';
import { TaskLabel } from './models/task-label.model';
import { Task } from './models/task.model';
import { type TaskEventData } from './models/task-event-data.model';
import { ZIBRI_PROJECTS_PERMISSIONS, ZIBRI_PROJECTS_PLATFORM_PERMISSIONS } from './models/zibri-projects-permissions.model';
import { ProjectsController } from './projects.controller';
import { ZibriProjectsPlugin } from './projects.plugin';
import { ZIBRI_PROJECTS_PLUGIN_DI_TOKENS } from './projects.tokens';

/**
 * The cases every data source answers the same way about the projects plugin: projects, their boards and tasks
 * through the routes, archiving, and sharing a project with a guest, who sees exactly what is shared with them. A
 * file per data source runs them against data sources of its own.
 */

declare module '../../event/event-service.interface' {
    interface ZibriEventMap {
        'projects-test.task-created': TaskEventData,
        'projects-test.task-moved': TaskEventData,
        'projects-test.task-due-date-changed': TaskEventData,
        'projects-test.task-done': TaskEventData
    }
}

/**
 * The events the cases have the plugin emit.
 */
type TaskEventType = 'projects-test.task-created' | 'projects-test.task-moved' | 'projects-test.task-due-date-changed' | 'projects-test.task-done';

// eslint-disable-next-line typescript/typedef
export const Permissions = definePermissions([...ZIBRI_PERMISSIONS, ...ZIBRI_PROJECTS_PERMISSIONS, ...ZIBRI_WEB_DAV_PERMISSIONS] as const);

// eslint-disable-next-line typescript/typedef
export const PlatformPermissions = definePlatformPermissions([...ZIBRI_PLATFORM_PERMISSIONS, ...ZIBRI_PROJECTS_PLATFORM_PERMISSIONS] as const);

/**
 * The tenant roles of the cases.
 */
export const TenantRoles = {
    GUEST: 'project-guest',
    READER: 'project-reader',
    MEMBER: 'project-member',
    MANAGER: 'project-manager'
} as const;

export const projectsTestRoles: TestServerRole[] = [
    { name: Roles.USER, level: 'platform', permissions: [], description: undefined },
    { name: Roles.ADMIN, level: 'platform', permissions: [PlatformPermissions.PROJECTS_READ_ALL], description: undefined },
    // a guest's role carries no permission: they see what is shared with them alone
    { name: TenantRoles.GUEST, level: 'tenant', permissions: [], description: undefined },
    { name: TenantRoles.READER, level: 'tenant', permissions: [Permissions.PROJECTS_READ], description: undefined },
    { name: TenantRoles.MEMBER, level: 'tenant', permissions: [Permissions.PROJECTS_READ, Permissions.PROJECTS_WRITE], description: undefined },
    {
        name: TenantRoles.MANAGER,
        level: 'tenant',
        permissions: [
            Permissions.PROJECTS_READ,
            Permissions.PROJECTS_WRITE,
            Permissions.PROJECTS_MANAGE,
            Permissions.AUTH_ASSIGN_ROLE_WITH_OWN_PERMISSIONS,
            // who sets the calendar of a project picks one of the connections, and adds one where there is none
            Permissions.WEB_DAV_CONNECTIONS_READ,
            Permissions.WEB_DAV_CONNECTIONS_MANAGE
        ],
        description: undefined
    }
];

/**
 * The entities the cases need beside those of the test server, for a data source to declare.
 */
export const projectsTestEntities: Newable<BaseEntity>[] = [
    RowShare,
    Project,
    ProjectColumn,
    Task,
    TaskLabel,
    TaskComment,
    RecurringTask,
    RecurringTaskOccurrence,
    ProjectCalendarDefaults,
    ApiKey,
    LoginLinkToken,
    TestInvitation
];

/**
 * The routes of the plugin, below `/projects`.
 */
@Controller('/projects', { allowOrphan: true })
export class TestProjectsController extends ProjectsController {}

/**
 * The auth routes, answering invitations, with an account without a password logged in by its link.
 */
@Controller('/auth', { allowOrphan: true, versions: 'all' })
class ProjectsTestAuthController extends AuthController({
        strategies: [JwtAuthStrategy],
        authenticators: [PasswordAuthenticator, LoginLinkAuthenticator],
        twoFactorMethods: [OtpTwoFactorMethod],
        invitationRoutes: true
    }) {}

/**
 * The options of the plugin in the cases: users named by the start of their email, and every event emitted.
 */
export const projectsOptions: ProjectsPluginOptionsInput = {
    guestRoles: [TenantRoles.GUEST],
    findUsers: async userIds => {
        const users: JwtUser[] = await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser)).findAll({ where: { id: { oneOf: userIds } }, limit: 'all' });
        return users.map(user => ({ id: user.id, name: user.email.split('@')[0] ?? user.email, email: user.email }));
    },
    invitationExpiresInMs: undefined,
    // what syncing into calendars does is held by projects-calendar-sync.cases.ts
    calendarSync: undefined,
    invitationColumns: invitee => ({ name: invitee.name }),
    eventNames: {
        taskCreated: 'projects-test.task-created',
        taskMoved: 'projects-test.task-moved',
        taskDueDateChanged: 'projects-test.task-due-date-changed',
        taskDone: 'projects-test.task-done'
    }
};

/**
 * Who calls the routes: a user, and the headers of their requests, in the tenant of the suite.
 */
type Caller = {
    /**
     * The user.
     */
    user: JwtUser,
    /**
     * The headers their requests send.
     */
    headers: Record<string, string>
};

/**
 * What a route answered.
 */
type Answer<T> = {
    /**
     * The status.
     */
    status: number,
    /**
     * The body, as it arrives.
     */
    body: T
};

/**
 * The rows of the cases, as the routes answer them.
 */
type ProjectRow = {
    id: string,
    name: string,
    parentId?: string | null,
    archivedAt?: string | null
};

type ColumnRow = {
    id: string,
    name: string,
    position: number,
    isDone: boolean
};

type TaskRow = {
    id: string,
    projectId: string,
    columnId: string,
    title: string,
    position: number,
    dueOn?: string | null,
    assigneeIds: string[],
    labelIds: string[],
    doneAt?: string | null,
    changeSets?: { createdBy?: string | null, changes: { key: string }[] }[]
};

type UserRow = {
    id: string,
    name: string,
    email?: string
};

type AccessRow = {
    role: string,
    fullAccess: boolean
};

type BoardRow = {
    project: ProjectRow,
    columns: ColumnRow[],
    labels: { id: string, name: string, color: string }[],
    tasks: TaskRow[],
    users: UserRow[],
    access: AccessRow
};

type PageRow<T> = {
    items: T[],
    totalAmount: number
};

type CommentPageRow = PageRow<{ id: string, authorId: string, text: string }> & {
    users: UserRow[]
};

/**
 * Describes the projects plugin on the given data sources.
 * @param dataSourceName - The name of the data sources, for the suite.
 * @param dataSources - The data sources, which declare the test server's entities, `projectsTestEntities`, and list
 * its repositories with `TestServerInvitationRepository`.
 * @param startTimeoutInMs - How long starting the server may take.
 * @param shutdownTimeoutInMs - How long shutting it down may take.
 */
export function describeProjects(
    dataSourceName: string,
    dataSources: Newable<DataSourceInterface>[],
    startTimeoutInMs: number,
    shutdownTimeoutInMs: number
): void {
    describe(`the projects plugin, on ${dataSourceName}`, () => {
        const transport: RecordingEmailTransport = new RecordingEmailTransport();
        let server: StartedTestServer | undefined;
        let baseUrl: string;
        const tenantId: string = UUIDUtilities.generate();
        const otherTenantId: string = UUIDUtilities.generate();
        const events: { type: string, data: TaskEventData }[] = [];
        let manager: Caller;

        beforeAll(async () => {
            server = await startTestServer({
                dataSources,
                authStrategies: [JwtAuthStrategy, ApiKeyAuthStrategy],
                authenticators: [PasswordAuthenticator, LoginLinkAuthenticator],
                twoFactorMethods: [OtpTwoFactorMethod],
                controllers: [TestProjectsController, ProjectsTestAuthController],
                plugins: [new ZibriProjectsPlugin()],
                providers: [
                    ...defaultTestServerProviders,
                    ...rolesAndPermissionsProviders(
                        { permissions: Object.values(Permissions), platformPermissions: Object.values(PlatformPermissions) },
                        projectsTestRoles
                    ),
                    defineProvider({ token: ZIBRI_PROJECTS_PLUGIN_DI_TOKENS.OPTIONS_INPUT, useValue: projectsOptions }),
                    defineProvider({
                        token: ZIBRI_DI_TOKENS.INVITATION_OPTIONS,
                        useValue: {
                            acceptInvitationUrl: 'https://app.example.com/invitation',
                            invitationEmail: compileTsxTemplate<InvitationEmailTemplate>(
                                'export const Email = ({ link, invitation }) => <a href={link}>{invitation.name}</a>;'
                            ),
                            tokenExpiresInMs: 60000,
                            onExpiredToken: 'refuse'
                        }
                    }),
                    defineProvider({
                        token: ZIBRI_DI_TOKENS.LOGIN_LINK_OPTIONS,
                        useValue: {
                            loginLinkUrl: 'https://app.example.com/login-link',
                            loginLinkEmail: compileTsxTemplate<LoginLinkEmailTemplate>('export const Email = ({ loginLink }) => <a href={loginLink}></a>;')
                        }
                    }),
                    defineProvider({
                        token: ZIBRI_DI_TOKENS.EMAIL_CONFIG,
                        useFactory: (): EmailConfigInput => ({ maxEmailsPerHour: 1000, defaultSender: 'Ada', failedRetentionInMs: 'forever' })
                    }),
                    defineProvider({ token: ZIBRI_DI_TOKENS.EMAIL_TRANSPORT, useValue: transport })
                ]
            });
            baseUrl = await server.start();
            const types: TaskEventType[] = [
                'projects-test.task-created',
                'projects-test.task-moved',
                'projects-test.task-due-date-changed',
                'projects-test.task-done'
            ];
            for (const type of types) {
                await inject(ZIBRI_DI_TOKENS.EVENT_SERVICE).subscribe(type, async (event: Event<TaskEventData>) => {
                    events.push({ type, data: event.data });
                    await Promise.resolve();
                }, { subscriberId: `projects-cases-${type}` });
            }
            manager = await createCaller([TenantRoles.MANAGER]);
        }, startTimeoutInMs);

        afterAll(async () => {
            await server?.shutdown();
        }, shutdownTimeoutInMs);

        function tenants(): TenantServiceInterface {
            return inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);
        }

        /**
         * Creates a user with the given tenant roles, and an api key acting as them.
         * @param tenantRoles - The roles they hold in the tenant of the suite.
         * @param platformRoles - The roles of their own.
         * @param tenant - The tenant, the one of the suite unless given.
         * @returns The caller.
         */
        async function createCaller(tenantRoles: string[], platformRoles: Roles[] = [Roles.USER], tenant: string = tenantId): Promise<Caller> {
            const user: JwtUser = await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser))
                .create({ email: `${UUIDUtilities.generate().slice(0, 8)}@projects.test`, roles: platformRoles });
            await tenants().runAs(tenant, async () => await inject(DefaultTestServerMembershipRepository).create({ tenantId: tenant, userId: user.id, roles: tenantRoles }));
            const authService: AuthServiceInterface = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
            const permissions: (Permission | PlatformPermission)[] = await authService.resolveUserPermissions(user, undefined);
            const created: CreatedApiKey = await authService.createApiKey(
                user.id,
                { name: 'cases', permissions, expiresAt: undefined, tenantId: undefined, clientAuthentication: undefined, requireDpop: false },
                undefined
            );
            return { user, headers: { 'x-api-key': created.key, 'x-tenant-id': tenant } };
        }

        /**
         * Calls a route of the plugin as somebody.
         * @param caller - Who calls it.
         * @param method - The http method.
         * @param path - The path below `/projects`.
         * @param body - What it is sent, if anything.
         * @returns What it answered.
         */
        async function call<T>(caller: Caller, method: string, path: string, body?: object): Promise<Answer<T>> {
            const res: Response = await fetch(`${baseUrl}/projects${path}`, {
                method,
                headers: { ...caller.headers, ...body == undefined ? {} : { 'content-type': 'application/json' } },
                body: body == undefined ? undefined : JSON.stringify(body)
            });
            const text: string = await res.text();
            // what the route answered, which the case typed
            return { status: res.status, body: (text === '' ? undefined : JSON.parse(text)) as T };
        }

        async function createProject(caller: Caller, name: string, parentId?: string): Promise<ProjectRow> {
            const res: Answer<ProjectRow> = await call<ProjectRow>(caller, 'POST', '/', { name, parentId: parentId ?? null });
            expect(res.status).toBe(200);
            return res.body;
        }

        async function createColumn(caller: Caller, projectId: string, name: string, isDone: boolean = false): Promise<ColumnRow> {
            const res: Answer<ColumnRow> = await call<ColumnRow>(caller, 'POST', `/${projectId}/columns`, { name, isDone });
            expect(res.status).toBe(200);
            return res.body;
        }

        async function createTask(caller: Caller, projectId: string, columnId: string, title: string, extra: object = {}): Promise<TaskRow> {
            const res: Answer<TaskRow> = await call<TaskRow>(caller, 'POST', `/${projectId}/tasks`, { columnId, title, ...extra });
            expect(res.status).toBe(200);
            return res.body;
        }

        async function share(projectId: string, userId: string, role: string): Promise<void> {
            expect((await call(manager, 'PUT', `/${projectId}/shares/${userId}`, { role })).status).toBe(200);
        }

        function ids(rows: { id: string }[]): string[] {
            return rows.map(row => row.id).sort();
        }

        describe('a member writing projects', () => {
            let member: Caller;

            beforeAll(async () => {
                member = await createCaller([TenantRoles.MEMBER]);
            }, startTimeoutInMs);

            it('creates a project with a board, reads it in order, and changes and deletes what is on it', async () => {
                const project: ProjectRow = await createProject(member, 'Website');
                const done: ColumnRow = await createColumn(member, project.id, 'Done', true);
                const todo: ColumnRow = (await call<ColumnRow>(member, 'POST', `/${project.id}/columns`, { name: 'To do', afterColumnId: null })).body;
                const label: { id: string } = (await call<{ id: string }>(member, 'POST', `/${project.id}/labels`, { name: 'Bug', color: 'red-500' })).body;
                const first: TaskRow = await createTask(member, project.id, todo.id, 'Write the texts', { labelIds: [label.id] });
                const second: TaskRow = await createTask(member, project.id, todo.id, 'Pick the images');
                const top: TaskRow = await createTask(member, project.id, todo.id, 'Agree on the pages', { afterTaskId: null });

                const board: BoardRow = (await call<BoardRow>(member, 'GET', `/${project.id}/board`)).body;
                expect(board.columns.map(c => c.name)).toEqual(['To do', 'Done']);
                expect(board.tasks.map(t => t.title)).toEqual(['Agree on the pages', 'Write the texts', 'Pick the images']);
                expect(board.labels.map(l => l.name)).toEqual(['Bug']);

                expect((await call<TaskRow>(member, 'PATCH', `/tasks/${second.id}`, { title: 'Choose the images' })).body.title).toBe('Choose the images');
                expect((await call(member, 'PATCH', `/labels/${label.id}`, { color: '#ff0000' })).status).toBe(400);
                expect((await call(member, 'DELETE', `/columns/${todo.id}`)).status).toBe(409);
                expect((await call(member, 'DELETE', `/labels/${label.id}`)).status).toBe(204);
                expect((await call<TaskRow>(member, 'GET', `/tasks/${first.id}`)).body.labelIds).toEqual([]);
                expect((await call(member, 'DELETE', `/tasks/${top.id}`)).status).toBe(204);
                expect((await call(member, 'GET', `/tasks/${top.id}`)).status).toBe(404);
                expect((await call(member, 'DELETE', `/columns/${done.id}`)).status).toBe(204);
                expect((await call(member, 'PATCH', `/${project.id}`, { name: 'Website relaunch' })).status).toBe(200);
            });

            it('moves a task into another column by writing that task alone, as a change set of the user who moved it', async () => {
                const project: ProjectRow = await createProject(member, 'Shop');
                const todo: ColumnRow = await createColumn(member, project.id, 'To do');
                const done: ColumnRow = await createColumn(member, project.id, 'Done', true);
                const moving: TaskRow = await createTask(member, project.id, todo.id, 'Connect the payments');
                await createTask(member, project.id, todo.id, 'Write the terms');
                const shipped: TaskRow = await createTask(member, project.id, done.id, 'Set up the domain');
                const before: BoardRow = (await call<BoardRow>(member, 'GET', `/${project.id}/board`)).body;
                const historyBefore: Map<string, number> = new Map(await Promise.all(before.tasks.map(async t => [
                    t.id,
                    (await call<TaskRow>(member, 'GET', `/tasks/${t.id}`)).body.changeSets?.length ?? 0
                ] as const)));

                const moved: Answer<TaskRow> = await call<TaskRow>(member, 'POST', `/tasks/${moving.id}/move`, { columnId: done.id, afterTaskId: null });

                expect(moved.status).toBe(200);
                expect(moved.body.columnId).toBe(done.id);
                expect(moved.body.doneAt).toEqual(expect.any(String));
                const after: BoardRow = (await call<BoardRow>(member, 'GET', `/${project.id}/board`)).body;
                expect(after.tasks.filter(t => t.columnId === done.id).map(t => t.id)).toEqual([moving.id, shipped.id]);
                // the others keep their positions and their history
                for (const task of after.tasks.filter(t => t.id !== moving.id)) {
                    expect(task.position).toBe(before.tasks.find(t => t.id === task.id)?.position);
                    expect((await call<TaskRow>(member, 'GET', `/tasks/${task.id}`)).body.changeSets?.length ?? 0).toBe(historyBefore.get(task.id));
                }
                const history: TaskRow = (await call<TaskRow>(member, 'GET', `/tasks/${moving.id}`)).body;
                expect(history.changeSets?.length).toBe((historyBefore.get(moving.id) ?? 0) + 1);
                expect(history.changeSets?.at(-1)?.createdBy).toBe(member.user.id);
                expect(history.changeSets?.at(-1)?.changes.map(c => c.key).sort()).toEqual(['columnId', 'doneAt']);
                await waitUntil(async () => await Promise.resolve(events.some(e => e.type === 'projects-test.task-done' && e.data.taskId === moving.id)));
                expect(events.filter(e => e.data.taskId === moving.id).map(e => e.type).sort())
                    .toEqual(['projects-test.task-created', 'projects-test.task-done', 'projects-test.task-moved']);
            });

            it('spreads the tasks of a column out again once the gap a task goes into ran out of precision', async () => {
                const project: ProjectRow = await createProject(member, 'Brochure');
                const todo: ColumnRow = await createColumn(member, project.id, 'To do');
                const first: TaskRow = await createTask(member, project.id, todo.id, 'First');
                const second: TaskRow = await createTask(member, project.id, todo.id, 'Second');
                const third: TaskRow = await createTask(member, project.id, todo.id, 'Third');
                // the second right after the first, as close as a double gets: what about 50 tasks put between them
                // one after the other leave
                await tenants().runAs(tenantId, async () => await inject<Repository<Task>>(repositoryTokenFor(Task))
                    .updateById(second.id, { position: first.position + 2 ** -42 }, { unscoped: true }));

                expect((await call(member, 'POST', `/tasks/${third.id}/move`, { columnId: todo.id, afterTaskId: first.id })).status).toBe(200);

                const board: BoardRow = (await call<BoardRow>(member, 'GET', `/${project.id}/board`)).body;
                expect(board.tasks.map(t => [t.title, t.position])).toEqual([['First', 1024], ['Third', 2048], ['Second', 3072]]);
            });

            it('moves tasks at the same moment without two sharing a position', async () => {
                const project: ProjectRow = await createProject(member, 'Newsletter');
                const todo: ColumnRow = await createColumn(member, project.id, 'To do');
                const doing: ColumnRow = await createColumn(member, project.id, 'Doing');
                const tasks: TaskRow[] = await Promise.all(['a', 'b', 'c', 'd'].map(async title => await createTask(member, project.id, todo.id, title)));

                await Promise.all(tasks.map(async task => await call(member, 'POST', `/tasks/${task.id}/move`, { columnId: doing.id, afterTaskId: null })));

                const board: BoardRow = (await call<BoardRow>(member, 'GET', `/${project.id}/board`)).body;
                const positions: number[] = board.tasks.filter(t => t.columnId === doing.id).map(t => t.position);
                expect(positions).toHaveLength(4);
                expect(new Set(positions).size).toBe(4);
            });

            it('marks the tasks of a column done once the column is one of done tasks, and no longer done after', async () => {
                const project: ProjectRow = await createProject(member, 'Mailing');
                const review: ColumnRow = await createColumn(member, project.id, 'Review');
                const task: TaskRow = await createTask(member, project.id, review.id, 'Proofread');

                expect((await call(member, 'PATCH', `/columns/${review.id}`, { isDone: true })).status).toBe(200);
                expect((await call<TaskRow>(member, 'GET', `/tasks/${task.id}`)).body.doneAt).toEqual(expect.any(String));
                await waitUntil(async () => await Promise.resolve(events.some(e => e.type === 'projects-test.task-done' && e.data.taskId === task.id)));

                expect((await call(member, 'PATCH', `/columns/${review.id}`, { isDone: false })).status).toBe(200);
                expect((await call<TaskRow>(member, 'GET', `/tasks/${task.id}`)).body.doneAt).toBeNull();
            });

            it('searches the tasks of the projects it sees, and emits a changed due date', async () => {
                const project: ProjectRow = await createProject(member, 'Fair');
                const todo: ColumnRow = await createColumn(member, project.id, 'To do');
                const task: TaskRow = await createTask(member, project.id, todo.id, 'Book the booth for the fair');
                await call(member, 'PATCH', `/tasks/${task.id}`, { dueOn: '2026-12-01' });

                const found: PageRow<TaskRow> = (await call<PageRow<TaskRow>>(member, 'GET', '/tasks?page=1&limit=10&search=booth')).body;
                expect(found.items.map(t => t.id)).toEqual([task.id]);
                await waitUntil(async () => await Promise.resolve(events.some(e => e.type === 'projects-test.task-due-date-changed' && e.data.taskId === task.id)));
            });

            it('keeps a due date as a day, refuses one with a time, and lists the soonest first', async () => {
                const project: ProjectRow = await createProject(member, 'Deadlines');
                const todo: ColumnRow = await createColumn(member, project.id, 'To do');
                const later: TaskRow = await createTask(member, project.id, todo.id, 'Later', { dueOn: '2027-03-02' });
                const sooner: TaskRow = await createTask(member, project.id, todo.id, 'Sooner', { dueOn: '2027-03-01' });

                expect(later.dueOn).toBe('2027-03-02T00:00:00.000Z');
                expect((await call(member, 'POST', `/${project.id}/tasks`, { columnId: todo.id, title: 'Timed', dueOn: '2027-03-01T09:00:00.000Z' })).status).toBe(400);
                expect((await call(member, 'PATCH', `/tasks/${sooner.id}`, { dueOn: '2027-03-01T23:00:00.000Z' })).status).toBe(400);
                const listed: PageRow<TaskRow> = (await call<PageRow<TaskRow>>(member, 'GET', `/tasks?page=1&limit=10&projectId=${project.id}`)).body;
                expect(listed.items.map(t => t.title)).toEqual(['Sooner', 'Later']);
            });
        });

        describe('permissions and tenants', () => {
            it('refuses writes to a member without projects.write, who reads every project', async () => {
                const reader: Caller = await createCaller([TenantRoles.READER]);
                const project: ProjectRow = await createProject(manager, 'Accounting');
                const todo: ColumnRow = await createColumn(manager, project.id, 'To do');
                const task: TaskRow = await createTask(manager, project.id, todo.id, 'Send the invoices');

                const board: Answer<BoardRow> = await call<BoardRow>(reader, 'GET', `/${project.id}/board`);
                expect(board.status).toBe(200);
                expect(board.body.access).toEqual({ role: 'viewer', fullAccess: true });
                expect((await call<BoardRow>(manager, 'GET', `/${project.id}/board`)).body.access).toEqual({ role: 'editor', fullAccess: true });
                expect((await call(reader, 'POST', '/', { name: 'Mine' })).status).toBe(403);
                expect((await call(reader, 'PATCH', `/${project.id}`, { name: 'Mine' })).status).toBe(403);
                expect((await call(reader, 'POST', `/${project.id}/tasks`, { columnId: todo.id, title: 'More' })).status).toBe(403);
                expect((await call(reader, 'POST', `/tasks/${task.id}/move`, { columnId: todo.id })).status).toBe(403);
                expect((await call(reader, 'POST', `/tasks/${task.id}/comments`, { text: 'Done?' })).status).toBe(403);
                expect((await call(reader, 'POST', `/${project.id}/archive`)).status).toBe(403);
            });

            it('keeps the projects of another tenant out of sight', async () => {
                const elsewhere: Caller = await createCaller([TenantRoles.MANAGER], [Roles.USER], otherTenantId);
                const theirs: ProjectRow = await createProject(elsewhere, 'Their project');

                expect((await call(manager, 'GET', `/${theirs.id}`)).status).toBe(404);
                expect((await call(manager, 'GET', `/${theirs.id}/board`)).status).toBe(404);
                expect(ids((await call<PageRow<ProjectRow>>(manager, 'GET', '/?page=1&limit=100&includeArchived=true')).body.items)).not.toContain(theirs.id);
            });

            it('nests projects to any depth and refuses a parent below the project itself', async () => {
                const internal: ProjectRow = await createProject(manager, 'Internal');
                const marketing: ProjectRow = await createProject(manager, 'Marketing', internal.id);
                const blog: ProjectRow = await createProject(manager, 'SEO blog', marketing.id);

                expect((await call<PageRow<ProjectRow>>(manager, 'GET', `/?page=1&limit=10&parentId=${marketing.id}`)).body.items.map(p => p.id)).toEqual([blog.id]);
                expect((await call(manager, 'PATCH', `/${internal.id}`, { parentId: blog.id })).status).toBe(400);
                expect((await call(manager, 'PATCH', `/${internal.id}`, { parentId: internal.id })).status).toBe(400);
            });

            it('deletes a project with the projects below it, their boards, comments and shares, to a manager alone', async () => {
                const member: Caller = await createCaller([TenantRoles.MEMBER]);
                const guest: Caller = await createCaller([TenantRoles.GUEST]);
                const event: ProjectRow = await createProject(manager, 'Summer party');
                const catering: ProjectRow = await createProject(manager, 'Catering', event.id);
                const todo: ColumnRow = await createColumn(manager, catering.id, 'To do');
                const task: TaskRow = await createTask(manager, catering.id, todo.id, 'Order the food');
                await call(manager, 'POST', `/tasks/${task.id}/comments`, { text: 'Vegetarian too' });
                await call(manager, 'POST', `/${catering.id}/labels`, { name: 'Urgent', color: 'red-500' });
                await share(catering.id, guest.user.id, 'viewer');

                expect((await call(member, 'DELETE', `/${event.id}`)).status).toBe(403);
                expect((await call(manager, 'DELETE', `/${event.id}`)).status).toBe(204);

                expect((await call(manager, 'GET', `/${catering.id}`)).status).toBe(404);
                expect((await call(manager, 'GET', `/tasks/${task.id}`)).status).toBe(404);
                expect((await call<PageRow<ProjectRow>>(guest, 'GET', '/?page=1&limit=10')).body.totalAmount).toBe(0);
            });
        });

        describe('archiving', () => {
            it('leaves an archived project and the projects below it out of lists, refuses writes, and brings them back', async () => {
                const member: Caller = await createCaller([TenantRoles.MEMBER]);
                const customer: ProjectRow = await createProject(manager, 'Customer GmbH');
                const website: ProjectRow = await createProject(manager, 'Website', customer.id);
                const old: ProjectRow = await createProject(manager, 'Old campaign', customer.id);
                expect((await call(manager, 'POST', `/${old.id}/archive`)).status).toBe(200);
                const todo: ColumnRow = await createColumn(member, website.id, 'To do');
                const task: TaskRow = await createTask(member, website.id, todo.id, 'Launch');

                const archived: Answer<ProjectRow> = await call<ProjectRow>(manager, 'POST', `/${customer.id}/archive`);

                expect(archived.body.archivedAt).toEqual(expect.any(String));
                const listed: string[] = ids((await call<PageRow<ProjectRow>>(member, 'GET', '/?page=1&limit=100')).body.items);
                expect(listed).not.toContain(customer.id);
                expect(listed).not.toContain(website.id);
                expect(ids((await call<PageRow<ProjectRow>>(member, 'GET', `/?page=1&limit=100&includeArchived=true&parentId=${customer.id}`)).body.items))
                    .toEqual([website.id, old.id].sort());
                expect((await call<PageRow<TaskRow>>(member, 'GET', `/tasks?page=1&limit=10&projectId=${website.id}`)).body.items).toEqual([]);
                expect((await call(member, 'GET', `/${website.id}/board`)).status).toBe(200);
                expect((await call(member, 'PATCH', `/tasks/${task.id}`, { title: 'Relaunch' })).status).toBe(409);
                expect((await call(member, 'POST', `/${website.id}/tasks`, { columnId: todo.id, title: 'More' })).status).toBe(409);
                expect((await call(member, 'POST', `/tasks/${task.id}/comments`, { text: 'Still open?' })).status).toBe(409);
                expect((await call(manager, 'DELETE', `/${website.id}/archive`)).status).toBe(409);

                expect((await call(manager, 'DELETE', `/${customer.id}/archive`)).status).toBe(200);
                expect((await call(member, 'PATCH', `/tasks/${task.id}`, { title: 'Relaunch' })).status).toBe(200);
                // archived on its own before, it stays so
                expect((await call<ProjectRow>(member, 'GET', `/${old.id}`)).body.archivedAt).toEqual(expect.any(String));
            });
        });

        describe('a guest', () => {
            let guest: Caller;
            let member: Caller;
            let internal: ProjectRow;
            let marketing: ProjectRow;
            let blog: ProjectRow;
            let finance: ProjectRow;
            let marketingTodo: ColumnRow;
            let blogTodo: ColumnRow;
            let marketingTask: TaskRow;
            let financeTask: TaskRow;

            beforeAll(async () => {
                guest = await createCaller([TenantRoles.GUEST]);
                member = await createCaller([TenantRoles.MEMBER]);
                internal = await createProject(manager, 'Internal');
                marketing = await createProject(manager, 'Marketing', internal.id);
                blog = await createProject(manager, 'SEO blog', marketing.id);
                finance = await createProject(manager, 'Finance', internal.id);
                marketingTodo = await createColumn(manager, marketing.id, 'To do');
                blogTodo = await createColumn(manager, blog.id, 'To do');
                const financeTodo: ColumnRow = await createColumn(manager, finance.id, 'To do');
                marketingTask = await createTask(manager, marketing.id, marketingTodo.id, 'Plan the campaign', { assigneeIds: [member.user.id] });
                financeTask = await createTask(manager, finance.id, financeTodo.id, 'File the taxes');
                await call(manager, 'POST', `/tasks/${marketingTask.id}/comments`, { text: 'Next week' });
                await call(manager, 'POST', `/tasks/${financeTask.id}/comments`, { text: 'Due in July' });
                await share(marketing.id, guest.user.id, 'viewer');
                await share(blog.id, guest.user.id, 'editor');
            }, startTimeoutInMs);

            it('reads exactly the projects shared with them and those below, through every route', async () => {
                const listed: PageRow<ProjectRow> = (await call<PageRow<ProjectRow>>(guest, 'GET', '/?page=1&limit=100')).body;
                expect(ids(listed.items)).toEqual([marketing.id, blog.id].sort());
                expect(listed.totalAmount).toBe(2);
                expect((await call<PageRow<ProjectRow>>(guest, 'GET', '/?page=1&limit=100&search=blog')).body.items.map(p => p.id)).toEqual([blog.id]);
                expect((await call(guest, 'GET', `/${internal.id}`)).status).toBe(404);
                expect((await call(guest, 'GET', `/${finance.id}/board`)).status).toBe(404);
                expect((await call(guest, 'GET', `/tasks/${financeTask.id}`)).status).toBe(404);
                expect((await call(guest, 'GET', `/tasks/${financeTask.id}/comments?page=1&limit=10`)).status).toBe(404);

                const tasks: PageRow<TaskRow> = (await call<PageRow<TaskRow>>(guest, 'GET', '/tasks?page=1&limit=100')).body;
                expect(tasks.items.map(t => t.id)).toEqual([marketingTask.id]);
                expect((await call<PageRow<TaskRow>>(guest, 'GET', '/tasks?page=1&limit=100&search=taxes')).body.items).toEqual([]);
                const comments: CommentPageRow = (await call<CommentPageRow>(guest, 'GET', `/tasks/${marketingTask.id}/comments?page=1&limit=10`)).body;
                expect(comments.items.map(c => c.text)).toEqual(['Next week']);
            });

            it('is shown other people by their names alone, where a member is shown their email addresses', async () => {
                const board: BoardRow = (await call<BoardRow>(guest, 'GET', `/${marketing.id}/board`)).body;
                expect(board.users).toEqual([{ id: member.user.id, name: member.user.email.split('@')[0] }]);
                const comments: CommentPageRow = (await call<CommentPageRow>(guest, 'GET', `/tasks/${marketingTask.id}/comments?page=1&limit=10`)).body;
                expect(comments.users).toEqual([{ id: manager.user.id, name: manager.user.email.split('@')[0] }]);
                const people: UserRow[] = (await call<UserRow[]>(guest, 'GET', `/${marketing.id}/users`)).body;
                expect(people.map(p => p.id)).toEqual(expect.arrayContaining([guest.user.id, member.user.id, manager.user.id]));
                expect(people.every(p => p.email == undefined)).toBe(true);

                const shown: BoardRow = (await call<BoardRow>(manager, 'GET', `/${marketing.id}/board`)).body;
                expect(shown.users).toEqual([{ id: member.user.id, name: member.user.email.split('@')[0], email: member.user.email }]);
            });

            it('is answered their role with the board and the project: the one of the share, in the projects below as well, and no full access', async () => {
                const campaign: ProjectRow = await createProject(manager, 'Campaign', marketing.id);
                const post: ProjectRow = await createProject(manager, 'First post', blog.id);

                expect((await call<BoardRow>(guest, 'GET', `/${marketing.id}/board`)).body.access).toEqual({ role: 'viewer', fullAccess: false });
                expect((await call<BoardRow>(guest, 'GET', `/${campaign.id}/board`)).body.access).toEqual({ role: 'viewer', fullAccess: false });
                // a share of a project below gives more there
                expect((await call<BoardRow>(guest, 'GET', `/${blog.id}/board`)).body.access).toEqual({ role: 'editor', fullAccess: false });
                expect((await call<BoardRow>(guest, 'GET', `/${post.id}/board`)).body.access).toEqual({ role: 'editor', fullAccess: false });

                const found: Answer<ProjectRow & { access: AccessRow }> = await call<ProjectRow & { access: AccessRow }>(guest, 'GET', `/${post.id}`);
                expect(found.body).toEqual(expect.objectContaining({ id: post.id, name: 'First post', parentId: blog.id, access: { role: 'editor', fullAccess: false } }));
                expect((await call<ProjectRow & { access: AccessRow }>(member, 'GET', `/${post.id}`)).body.access).toEqual({ role: 'editor', fullAccess: true });
            });

            it('does what their role allows: a viewer reads, an editor of a project below writes there', async () => {
                expect((await call(guest, 'POST', `/tasks/${marketingTask.id}/comments`, { text: 'Looks good' })).status).toBe(403);
                expect((await call(guest, 'POST', `/${marketing.id}/tasks`, { columnId: marketingTodo.id, title: 'More' })).status).toBe(403);
                const written: TaskRow = await createTask(guest, blog.id, blogTodo.id, 'Draft the first post');
                expect((await call(guest, 'POST', `/tasks/${written.id}/comments`, { text: 'Started' })).status).toBe(200);
                expect((await call(guest, 'POST', '/', { name: 'Mine' })).status).toBe(403);
                expect((await call(guest, 'POST', `/${blog.id}/archive`)).status).toBe(403);
                expect((await call(guest, 'PUT', `/${blog.id}/shares/${member.user.id}`, { role: 'viewer' })).status).toBe(403);
            });

            it('comments as a commenter, and does not write tasks', async () => {
                const commenter: Caller = await createCaller([TenantRoles.GUEST]);
                await share(marketing.id, commenter.user.id, 'commenter');

                expect((await call(commenter, 'POST', `/tasks/${marketingTask.id}/comments`, { text: 'Can we start earlier?' })).status).toBe(200);
                expect((await call(commenter, 'PATCH', `/tasks/${marketingTask.id}`, { title: 'Mine' })).status).toBe(403);
                expect((await call(commenter, 'POST', `/tasks/${marketingTask.id}/move`, { columnId: marketingTodo.id })).status).toBe(403);
            });

            it('is assigned a task of a project they see, and nobody is assigned one of a project they do not see', async () => {
                expect((await call(manager, 'PATCH', `/tasks/${marketingTask.id}`, { assigneeIds: [member.user.id, guest.user.id] })).status).toBe(200);

                const refused: Answer<{ message: string }> = await call<{ message: string }>(manager, 'PATCH', `/tasks/${financeTask.id}`, { assigneeIds: [guest.user.id] });
                expect(refused.status).toBe(400);
                expect(refused.body.message).toBe(`The user "${guest.user.id}" does not see the project, and needs to before a task of it is assigned to them.`);
                const stranger: Caller = await createCaller([TenantRoles.MEMBER], [Roles.USER], otherTenantId);
                expect((await call(manager, 'PATCH', `/tasks/${marketingTask.id}`, { assigneeIds: [stranger.user.id] })).status).toBe(400);
            });

            it('loses access with the next request once the share ends, and keeps their membership', async () => {
                const leaving: Caller = await createCaller([TenantRoles.GUEST]);
                await share(blog.id, leaving.user.id, 'viewer');
                expect((await call(leaving, 'GET', `/${blog.id}/board`)).status).toBe(200);

                expect((await call(manager, 'DELETE', `/${blog.id}/shares/${leaving.user.id}`)).status).toBe(204);

                expect((await call(leaving, 'GET', `/${blog.id}/board`)).status).toBe(404);
                expect((await call<PageRow<ProjectRow>>(leaving, 'GET', '/?page=1&limit=10')).body.totalAmount).toBe(0);
                expect((await call<PageRow<TaskRow>>(leaving, 'GET', '/tasks?page=1&limit=10')).body.totalAmount).toBe(0);
            });
        });

        describe('sharing', () => {
            async function readToken(email: string): Promise<string> {
                await inject(ZIBRI_DI_TOKENS.EMAIL_SERVICE).sendQueuedEmails();
                const html: string = transport.sends.filter(sent => sent.recipients.includes(email)).at(-1)?.html ?? '';
                const token: string | undefined = /invitation\/([\da-f]+)/.exec(html)?.[1];
                if (token == undefined) {
                    throw new Error(`No invitation was mailed to ${email}.`);
                }
                return token;
            }

            async function accept(body: object): Promise<Response> {
                return await fetch(`${baseUrl}/auth/accept-invitation`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify(body)
                });
            }

            it('lists the shares of a project with their users, changes a role and ends a share', async () => {
                const project: ProjectRow = await createProject(manager, 'Catalog');
                const guest: Caller = await createCaller([TenantRoles.GUEST]);

                await share(project.id, guest.user.id, 'viewer');
                await share(project.id, guest.user.id, 'editor');

                const shares: Answer<{ userId: string, role: string, user: UserRow }[]> = await call(manager, 'GET', `/${project.id}/shares`);
                expect(shares.body).toEqual([expect.objectContaining({
                    userId: guest.user.id,
                    role: 'editor',
                    user: { id: guest.user.id, name: guest.user.email.split('@')[0], email: guest.user.email }
                })]);
                expect((await call(manager, 'PUT', `/${project.id}/shares/${guest.user.id}`, { role: 'owner' })).status).toBe(400);
                expect((await call(manager, 'DELETE', `/${project.id}/shares/${guest.user.id}`)).status).toBe(204);
                expect((await call<unknown[]>(manager, 'GET', `/${project.id}/shares`)).body).toEqual([]);
            });

            it('shares by email with a member at once, and invites anybody else, who gets the share on accepting', async () => {
                const project: ProjectRow = await createProject(manager, 'Flyer');
                const reader: Caller = await createCaller([TenantRoles.READER]);
                const atOnce: Answer<{ share: { userId: string } | null, invitationId: string | null }> = await call(manager, 'POST', `/${project.id}/shares`, {
                    email: reader.user.email,
                    name: 'Reader',
                    role: 'commenter'
                });
                expect(atOnce.body).toEqual({ share: expect.objectContaining({ userId: reader.user.id }), invitationId: null });

                const email: string = `${UUIDUtilities.generate().slice(0, 8)}@customer.test`;
                const invited: Answer<{ share: null, invitationId: string }> = await call(manager, 'POST', `/${project.id}/shares`, {
                    email,
                    name: 'Grace',
                    role: 'commenter'
                });
                expect(invited.body).toEqual({ share: null, invitationId: expect.any(String) });

                expect((await accept({ token: await readToken(email), password: 'correct horse battery staple' })).status).toBe(204);
                const user: JwtUser = await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser)).findOne({ where: { email } });
                const shares: { userId: string, role: string }[] = (await call<{ userId: string, role: string }[]>(manager, 'GET', `/${project.id}/shares`)).body;
                expect(shares).toEqual(expect.arrayContaining([expect.objectContaining({ userId: user.id, role: 'commenter' })]));
            });
        });

        // the whole of a project with a customer: created, shared with them by email, commented on by them, archived
        it('runs a project from its creation through sharing it with a customer, who comments on a task, to archiving it', async () => {
            const project: ProjectRow = await createProject(manager, 'Customer website');
            const todo: ColumnRow = await createColumn(manager, project.id, 'To do');
            await createColumn(manager, project.id, 'Done', true);
            const task: TaskRow = await createTask(manager, project.id, todo.id, 'Send the texts', { dueOn: '2026-12-15' });
            const email: string = `${UUIDUtilities.generate().slice(0, 8)}@customer.test`;

            const shared: Answer<{ invitationId: string | null }> = await call(manager, 'POST', `/${project.id}/shares`, {
                email,
                name: 'Customer',
                role: 'commenter',
                withoutPassword: true
            });
            expect(shared.body.invitationId).toEqual(expect.any(String));

            await inject(ZIBRI_DI_TOKENS.EMAIL_SERVICE).sendQueuedEmails();
            const html: string = transport.sends.filter(sent => sent.recipients.includes(email)).at(-1)?.html ?? '';
            const token: string | undefined = /invitation\/([\da-f]+)/.exec(html)?.[1];
            const accepted: Response = await fetch(`${baseUrl}/auth/accept-invitation`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ token })
            });
            expect(accepted.status).toBe(200);
            const accessToken: string = (await accepted.json() as { accessToken: { value: string } }).accessToken.value;
            const user: JwtUser = await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser)).findOne({ where: { email } });
            const customer: Caller = { user, headers: { authorization: `Bearer ${accessToken}`, 'x-tenant-id': tenantId } };

            expect(ids((await call<PageRow<ProjectRow>>(customer, 'GET', '/?page=1&limit=100')).body.items)).toEqual([project.id]);
            expect((await call(customer, 'POST', `/tasks/${task.id}/comments`, { text: 'The texts are attached to the mail.' })).status).toBe(200);
            expect((await call(customer, 'PATCH', `/tasks/${task.id}`, { title: 'Mine' })).status).toBe(403);
            const comments: CommentPageRow = (await call<CommentPageRow>(manager, 'GET', `/tasks/${task.id}/comments?page=1&limit=10`)).body;
            expect(comments.items.map(c => c.authorId)).toEqual([user.id]);
            expect(comments.users).toEqual([{ id: user.id, name: email.split('@')[0], email }]);

            expect((await call(manager, 'POST', `/${project.id}/archive`)).status).toBe(200);

            expect((await call<PageRow<ProjectRow>>(customer, 'GET', '/?page=1&limit=100')).body.items).toEqual([]);
            expect((await call(customer, 'GET', `/${project.id}/board`)).status).toBe(200);
            expect((await call(customer, 'POST', `/tasks/${task.id}/comments`, { text: 'One more thing.' })).status).toBe(409);
        });
    });
}
