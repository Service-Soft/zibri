import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { JwtUser } from '../../__testing__/mocks/entities/jwt-user.entity';
import { Roles } from '../../__testing__/mocks/entities/roles.enum';
import { TestInvitation } from '../../__testing__/mocks/entities/test-invitation.entity';
import { DefaultTestServerMembershipRepository } from '../../__testing__/test-server/membership-repository';
import { defaultTestServerProviders, rolesAndPermissionsProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { waitUntil } from '../../__testing__/wait-until.function';
import { InProcessWebDavServer } from '../../__testing__/web-dav/in-process-web-dav-server.model';
import { type AuthServiceInterface } from '../../auth/auth-service.interface';
import { type Permission } from '../../auth/roles/permission.type';
import { type PlatformPermission } from '../../auth/roles/platform-permission.type';
import { ApiKeyAuthStrategy } from '../../auth/strategies/api-key/api-key.auth-strategy';
import { CreatedApiKey } from '../../auth/strategies/api-key/created-api-key.model';
import { CalendarEntryLink } from '../../calendar-sync/calendar-entry-link.model';
import { DataSourceInterface } from '../../data-source/data-sources/data-source.interface';
import { Repository } from '../../data-source/repository/repository';
import { type RepositoryTransaction } from '../../data-source/transaction/repository-transaction.type';
import { type Transaction } from '../../data-source/transaction/transaction.model';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { defineProvider } from '../../di/models/di-provider.model';
import { DiVariants } from '../../di/models/di-variant.model';
import { BaseEntity } from '../../entity/base-entity.model';
import { Controller } from '../../routing/decorators/controller.decorator';
import { type TenantServiceInterface } from '../../tenancy/tenant-service.interface';
import { Newable } from '../../types/newable.type';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { type TenantWebDavConnectionUsageCleanerInterface } from '../../web-dav/tenant-web-dav-connection-usage-cleaner.interface';
import { TenantWebDavConnectionController } from '../../web-dav/tenant-web-dav-connection.controller';
import { type TenantWebDavConnectionTest } from '../../web-dav/tenant-web-dav-connection-test.model';
import { TenantWebDavConnection } from '../../web-dav/tenant-web-dav-connection.model';
import { WebDavConnectionKind } from '../../web-dav/web-dav-connection-kind.enum';
import { TaskCalendarSyncRequest } from './models/task-calendar-sync-request.model';
import { Task } from './models/task.model';
import { Permissions, PlatformPermissions, projectsOptions, projectsTestEntities, projectsTestRoles, TenantRoles, TestProjectsController } from './projects.cases';
import { ZibriProjectsPlugin } from './projects.plugin';
import { ZIBRI_PROJECTS_PLUGIN_DI_TOKENS } from './projects.tokens';

/**
 * The cases every data source answers the same way about the calendar sync of the projects plugin: the due dates of
 * tasks written into the calendars of their projects, through the routes, against a CalDAV server in this process.
 * What real servers do with the events is held by the suites of calendar-sync.service. A file per data source runs
 * them against data sources of its own, which declare the test server's entities and
 * `projectsCalendarSyncTestEntities`.
 */

/**
 * The entities the cases need beside those of the test server, for a data source to declare.
 */
export const projectsCalendarSyncTestEntities: Newable<BaseEntity>[] = [
    // without the invitations, which nothing here sends
    ...projectsTestEntities.filter(entity => entity !== TestInvitation),
    TenantWebDavConnection,
    CalendarEntryLink,
    TaskCalendarSyncRequest
];

/**
 * Who calls the routes: the headers of their requests.
 */
type Caller = {
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
 * A row a route answered, by its id.
 */
type RowWithId = {
    /**
     * The id.
     */
    id: string
};

/**
 * A connection as the routes of the WebDAV connections answer it.
 */
type ConnectionRow = {
    /**
     * The id.
     */
    id: string,
    /**
     * The tenant.
     */
    tenantId: string,
    /**
     * The name.
     */
    name: string,
    /**
     * The url.
     */
    url: string,
    /**
     * Who logs in.
     */
    username: string
};

/**
 * What a route refused a request with.
 */
type ErrorBody = {
    /**
     * The first paragraph.
     */
    message: string,
    /**
     * Every paragraph.
     */
    paragraphs: string[]
};

/**
 * The routes of the WebDAV connections of the tenant, below `/web-dav-connections`.
 */
@Controller('/web-dav-connections', { allowOrphan: true })
export class TestWebDavConnectionsController extends TenantWebDavConnectionController {}

/**
 * A usage cleaner that, while armed, deletes the connection itself in the transaction of its deletion, so that the
 * deletion which follows finds no connection and fails.
 */
class ConnectionDeletingUsageCleaner implements TenantWebDavConnectionUsageCleanerInterface {
    /**
     * Whether it deletes the connection.
     */
    armed: boolean = false;

    // eslint-disable-next-line jsdoc/require-jsdoc
    async removeUsages(connection: TenantWebDavConnection, transaction: RepositoryTransaction): Promise<void> {
        if (this.armed) {
            await inject<Repository<TenantWebDavConnection>>(repositoryTokenFor(TenantWebDavConnection)).deleteById(connection.id, { transaction });
        }
    }
}

/**
 * A board of the cases: the project, a column of open tasks and one of done tasks.
 */
type Board = {
    /**
     * The id of the project.
     */
    projectId: string,
    /**
     * The id of the column of open tasks.
     */
    openColumnId: string,
    /**
     * The id of the column of done tasks.
     */
    doneColumnId: string
};

/**
 * A connection whose calendar a project names, with a task whose event is written through it.
 */
type ConnectionWithEvent = {
    /**
     * The connection.
     */
    added: ConnectionRow,
    /**
     * The board of the project.
     */
    board: Board,
    /**
     * The calendar, below the connection.
     */
    calendarPath: string,
    /**
     * The task.
     */
    task: RowWithId
};

/**
 * Describes the calendar sync of the projects plugin on the given data sources.
 * @param dataSourceName - The name of the data sources, for the suite.
 * @param dataSources - The data sources.
 * @param startTimeoutInMs - How long starting the server may take.
 * @param shutdownTimeoutInMs - How long shutting it down may take.
 */
export function describeProjectsCalendarSync(
    dataSourceName: string,
    dataSources: Newable<DataSourceInterface>[],
    startTimeoutInMs: number,
    shutdownTimeoutInMs: number
): void {
    describe(`the calendar sync of the projects plugin, on ${dataSourceName}`, () => {
        const calDav: InProcessWebDavServer = new InProcessWebDavServer('ada', 'Lovelace-app-password');
        const tenantId: string = UUIDUtilities.generate();
        let server: StartedTestServer | undefined;
        let baseUrl: string;
        let manager: Caller;
        let connectionId: string;

        function tenants(): TenantServiceInterface {
            return inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);
        }

        /**
         * The connection to the server, as a tenant adds it.
         * @returns Its kind, url, username and password.
         */
        function tenantConnection(): TenantWebDavConnectionTest {
            return { kind: WebDavConnectionKind.WEB_DAV, ...calDav.connection };
        }

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

        async function create<T extends RowWithId>(path: string, body: object): Promise<T> {
            const res: Answer<T> = await call<T>(manager, 'POST', path, body);
            expect(res.status).toBe(200);
            return res.body;
        }

        async function patch(path: string, body: object): Promise<void> {
            expect((await call(manager, 'PATCH', path, body)).status).toBe(200);
        }

        /**
         * Creates a project with a board of an open column and a done one.
         * @param name - The name of the project.
         * @param parentId - The project to create it below.
         * @returns The board.
         */
        async function createBoard(name: string, parentId?: string): Promise<Board> {
            const project: RowWithId = await create('/', { name, parentId: parentId ?? null });
            const open: RowWithId = await create(`/${project.id}/columns`, { name: 'To do' });
            const done: RowWithId = await create(`/${project.id}/columns`, { name: 'Done', isDone: true });
            return { projectId: project.id, openColumnId: open.id, doneColumnId: done.id };
        }

        /**
         * Creates a calendar of its own on the server.
         * @returns Its path below the connection.
         */
        function createCalendar(): string {
            const path: string = `calendars/ada/${UUIDUtilities.generate()}`;
            calDav.createFolder(path);
            return path;
        }

        /**
         * Runs the requests that are due until none is left, as the cron job does.
         */
        async function settle(): Promise<void> {
            const requests: Repository<TaskCalendarSyncRequest> = inject(repositoryTokenFor(TaskCalendarSyncRequest));
            await waitUntil(async () => {
                await inject(ZIBRI_PROJECTS_PLUGIN_DI_TOKENS.TASK_CALENDAR_SYNC_SERVICE).syncDueRequests();
                return !await requests.exists({ where: { nextAttemptAt: null }, acrossTenants: true });
            }, 10_000);
        }

        /**
         * Finds the event of a task in a calendar.
         * @param calendarPath - The calendar.
         * @param taskId - The task.
         * @returns What the event holds, or undefined for none.
         */
        function findEvent(calendarPath: string, taskId: string): string | undefined {
            return calDav.files.get(`${calendarPath}/task-${taskId}.ics`)?.content.toString()
                .replaceAll('\r\n ', '');
        }

        /**
         * Creates a user of the tenant with a role, and the api key they call the routes with.
         * @param role - The tenant role.
         * @returns Who calls.
         */
        async function createCaller(role: string): Promise<Caller> {
            const user: JwtUser = await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser))
                .create({ email: `${UUIDUtilities.generate().slice(0, 8)}@calendar-sync.test`, roles: [Roles.USER] });
            await tenants().runAs(tenantId, async () => await inject(DefaultTestServerMembershipRepository).create({ tenantId, userId: user.id, roles: [role] }));
            const authService: AuthServiceInterface = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
            const permissions: (Permission | PlatformPermission)[] = await authService.resolveUserPermissions(user, undefined);
            const key: CreatedApiKey = await authService.createApiKey(
                user.id,
                { name: 'cases', permissions, expiresAt: undefined, tenantId: undefined, clientAuthentication: undefined, requireDpop: false },
                undefined
            );
            return { headers: { 'x-api-key': key.key, 'x-tenant-id': tenantId } };
        }

        async function findLinks(taskId: string): Promise<CalendarEntryLink[]> {
            return await tenants().runAs(tenantId, async () => await inject(ZIBRI_DI_TOKENS.CALENDAR_SYNC_SERVICE).findLinks({ type: 'task', id: taskId }));
        }

        beforeAll(async () => {
            await calDav.start();
            server = await startTestServer({
                dataSources,
                authStrategies: [ApiKeyAuthStrategy],
                controllers: [TestProjectsController, TestWebDavConnectionsController],
                plugins: [new ZibriProjectsPlugin()],
                providers: [
                    ...defaultTestServerProviders,
                    ...rolesAndPermissionsProviders(
                        { permissions: Object.values(Permissions), platformPermissions: Object.values(PlatformPermissions) },
                        projectsTestRoles
                    ),
                    defineProvider({
                        token: ZIBRI_PROJECTS_PLUGIN_DI_TOKENS.OPTIONS_INPUT,
                        useValue: {
                            ...projectsOptions,
                            eventNames: {},
                            calendarSync: { taskUrl: task => `https://app.example.com/projects/${task.projectId}/tasks/${task.id}` }
                        }
                    }),
                    // the server of this process, which a tenant's connection reaches only on a private network
                    defineProvider({ token: ZIBRI_DI_TOKENS.WEB_DAV_TENANT_CONNECTION_OPTIONS, useValue: { allowedHosts: ['127.0.0.1'], allowPrivateNetworks: true } }),
                    defineProvider({ token: ConnectionDeletingUsageCleaner, useClass: ConnectionDeletingUsageCleaner, variants: [DiVariants.WEB_DAV_CONNECTION_USAGE_CLEANER] })
                ]
            });
            baseUrl = await server.start();
            manager = await createCaller(TenantRoles.MANAGER);
            // as a tenant configures it: the WebDAV root of its Nextcloud
            const connection: TenantWebDavConnection = await tenants().runAs(
                tenantId,
                async () => await inject<Repository<TenantWebDavConnection>>(repositoryTokenFor(TenantWebDavConnection))
                    .create({ name: 'Nextcloud', ...tenantConnection() })
            );
            connectionId = connection.id;
        }, startTimeoutInMs);

        afterAll(async () => {
            await server?.shutdown();
            await calDav.stop();
        }, shutdownTimeoutInMs);

        it('creates the event of a due date, updates it as the task changes, and removes it once the task is done', async () => {
            const calendarPath: string = createCalendar();
            const board: Board = await createBoard('Website');
            await patch(`/${board.projectId}/calendar`, { calendarSync: { target: { connectionId, calendarPath: `/${calendarPath}/` } } });

            const task: RowWithId = await create(`/${board.projectId}/tasks`, {
                columnId: board.openColumnId,
                title: 'Launch, finally',
                description: 'Check the texts; then go.',
                dueOn: '2026-12-01'
            });
            await settle();

            expect(findEvent(calendarPath, task.id)).toContain('SUMMARY:Launch\\, finally\r\n');
            // a day of its own, which a calendar shows as that day wherever it is read
            expect(findEvent(calendarPath, task.id)).toContain('DTSTART;VALUE=DATE:20261201\r\nDTEND;VALUE=DATE:20261202\r\n');
            expect(findEvent(calendarPath, task.id)).toContain(`URL:https://app.example.com/projects/${board.projectId}/tasks/${task.id}\r\n`);
            expect(findEvent(calendarPath, task.id)).toContain(
                `DESCRIPTION:Check the texts\\; then go.\\n\\nhttps://app.example.com/projects/${board.projectId}/tasks/${task.id}\r\n`
            );
            expect(await findLinks(task.id)).toEqual([expect.objectContaining({ connectionId, calendarPath, href: `${calendarPath}/task-${task.id}.ics` })]);

            await patch(`/tasks/${task.id}`, { title: 'Launch', dueOn: '2026-12-31' });
            await settle();
            expect(findEvent(calendarPath, task.id)).toContain('DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101\r\n');
            expect(findEvent(calendarPath, task.id)).toContain('SUMMARY:Launch\r\n');

            expect((await call(manager, 'POST', `/tasks/${task.id}/move`, { columnId: board.doneColumnId })).status).toBe(200);
            await settle();
            expect(findEvent(calendarPath, task.id)).toBeUndefined();
            expect(await findLinks(task.id)).toEqual([]);

            expect((await call(manager, 'POST', `/tasks/${task.id}/move`, { columnId: board.openColumnId })).status).toBe(200);
            await settle();
            expect(findEvent(calendarPath, task.id)).toContain('SUMMARY:Launch\r\n');
        });

        it('removes the event when the due date is removed, and when the task is deleted', async () => {
            const calendarPath: string = createCalendar();
            const board: Board = await createBoard('Accounting');
            await patch(`/${board.projectId}/calendar`, { calendarSync: { target: { connectionId, calendarPath } } });
            const undated: RowWithId = await create(`/${board.projectId}/tasks`, { columnId: board.openColumnId, title: 'Prepare', dueOn: '2026-12-05' });
            const deleted: RowWithId = await create(`/${board.projectId}/tasks`, { columnId: board.openColumnId, title: 'File', dueOn: '2026-12-06' });
            await settle();
            expect(calDav.findFilePaths(calendarPath)).toEqual([`${calendarPath}/task-${undated.id}.ics`, `${calendarPath}/task-${deleted.id}.ics`].sort());

            await patch(`/tasks/${undated.id}`, { dueOn: null });
            expect((await call(manager, 'DELETE', `/tasks/${deleted.id}`)).status).toBe(204);
            await settle();

            expect(calDav.findFilePaths(calendarPath)).toEqual([]);
            expect([...await findLinks(undated.id), ...await findLinks(deleted.id)]).toEqual([]);
        });

        it('takes the calendar from the project above and from the tenant, and a project of none writes into none', async () => {
            const tenantCalendar: string = createCalendar();
            const customerCalendar: string = createCalendar();
            await patch('/calendar', { calendarSync: { target: { connectionId, calendarPath: tenantCalendar } } });
            try {
                const internal: Board = await createBoard('Internal');
                const customer: Board = await createBoard('Customer AG');
                const website: Board = await createBoard('Website', customer.projectId);
                const secret: Board = await createBoard('Secret', customer.projectId);
                await patch(`/${customer.projectId}/calendar`, { calendarSync: { target: { connectionId, calendarPath: customerCalendar } } });
                await patch(`/${secret.projectId}/calendar`, { calendarSync: { target: null } });

                const inInternal: RowWithId = await create(`/${internal.projectId}/tasks`, { columnId: internal.openColumnId, title: 'Party', dueOn: '2026-12-18' });
                const inWebsite: RowWithId = await create(`/${website.projectId}/tasks`, { columnId: website.openColumnId, title: 'Go live', dueOn: '2026-12-10' });
                const inSecret: RowWithId = await create(`/${secret.projectId}/tasks`, { columnId: secret.openColumnId, title: 'Hush', dueOn: '2026-12-11' });
                await settle();

                expect(calDav.findFilePaths(tenantCalendar)).toEqual([`${tenantCalendar}/task-${inInternal.id}.ics`]);
                expect(calDav.findFilePaths(customerCalendar)).toEqual([`${customerCalendar}/task-${inWebsite.id}.ics`]);
                expect(await findLinks(inSecret.id)).toEqual([]);
                const effective: Answer<{ effective: { calendarSync: object | null }, own: { calendarSync: object | null } }>
                    = await call(manager, 'GET', `/${website.projectId}/calendar`);
                expect(effective.body.own.calendarSync).toBeNull();
                expect(effective.body.effective.calendarSync).toEqual({ connectionId, calendarPath: customerCalendar });
            }
            finally {
                await patch('/calendar', { calendarSync: null });
                await settle();
            }
        });

        it('moves the events of a project whose calendar changes, with those of the projects below that take it', async () => {
            const oldCalendar: string = createCalendar();
            const newCalendar: string = createCalendar();
            const ownCalendar: string = createCalendar();
            const customer: Board = await createBoard('Customer GmbH');
            const website: Board = await createBoard('Website', customer.projectId);
            const own: Board = await createBoard('Own calendar', customer.projectId);
            await patch(`/${customer.projectId}/calendar`, { calendarSync: { target: { connectionId, calendarPath: oldCalendar } } });
            await patch(`/${own.projectId}/calendar`, { calendarSync: { target: { connectionId, calendarPath: ownCalendar } } });
            const inCustomer: RowWithId = await create(`/${customer.projectId}/tasks`, { columnId: customer.openColumnId, title: 'Kickoff', dueOn: '2026-12-01' });
            const inWebsite: RowWithId = await create(`/${website.projectId}/tasks`, { columnId: website.openColumnId, title: 'Go live', dueOn: '2026-12-10' });
            const inOwn: RowWithId = await create(`/${own.projectId}/tasks`, { columnId: own.openColumnId, title: 'Mine', dueOn: '2026-12-12' });
            await settle();
            expect(calDav.findFilePaths(oldCalendar).length).toBe(2);

            await patch(`/${customer.projectId}/calendar`, { calendarSync: { target: { connectionId, calendarPath: newCalendar } } });
            await settle();

            expect(calDav.findFilePaths(oldCalendar)).toEqual([]);
            expect(calDav.findFilePaths(newCalendar)).toEqual([`${newCalendar}/task-${inCustomer.id}.ics`, `${newCalendar}/task-${inWebsite.id}.ics`].sort());
            expect(calDav.findFilePaths(ownCalendar)).toEqual([`${ownCalendar}/task-${inOwn.id}.ics`]);

            // moved below a project of none, its tasks leave the calendar
            const none: Board = await createBoard('No calendar');
            await patch(`/${none.projectId}/calendar`, { calendarSync: { target: null } });
            await patch(`/${website.projectId}`, { parentId: none.projectId });
            await settle();
            expect(calDav.findFilePaths(newCalendar)).toEqual([`${newCalendar}/task-${inCustomer.id}.ics`]);
        });

        it('removes the events of the tasks of a column that becomes one of done tasks', async () => {
            const calendarPath: string = createCalendar();
            const board: Board = await createBoard('Releases');
            await patch(`/${board.projectId}/calendar`, { calendarSync: { target: { connectionId, calendarPath } } });
            await create(`/${board.projectId}/tasks`, { columnId: board.openColumnId, title: 'Release 1', dueOn: '2026-12-01' });
            await create(`/${board.projectId}/tasks`, { columnId: board.openColumnId, title: 'Release 2', dueOn: '2026-12-08' });
            await settle();
            expect(calDav.findFilePaths(calendarPath).length).toBe(2);

            await patch(`/columns/${board.openColumnId}`, { isDone: true });
            await settle();

            expect(calDav.findFilePaths(calendarPath)).toEqual([]);
        });

        it('removes the events of the tasks of a project that is deleted', async () => {
            const calendarPath: string = createCalendar();
            const board: Board = await createBoard('Temporary');
            await patch(`/${board.projectId}/calendar`, { calendarSync: { target: { connectionId, calendarPath } } });
            const task: RowWithId = await create(`/${board.projectId}/tasks`, { columnId: board.openColumnId, title: 'Soon gone', dueOn: '2026-12-01' });
            await settle();
            expect(findEvent(calendarPath, task.id)).toBeDefined();

            expect((await call(manager, 'DELETE', `/${board.projectId}`)).status).toBe(204);
            await settle();

            expect(findEvent(calendarPath, task.id)).toBeUndefined();
            expect(await findLinks(task.id)).toEqual([]);
        });

        it('overwrites an event changed in the calendar when the task changes', async () => {
            const calendarPath: string = createCalendar();
            const board: Board = await createBoard('Overwrite');
            await patch(`/${board.projectId}/calendar`, { calendarSync: { target: { connectionId, calendarPath } } });
            const task: RowWithId = await create(`/${board.projectId}/tasks`, { columnId: board.openColumnId, title: 'Review', dueOn: '2026-12-01' });
            await settle();
            calDav.edit(`${calendarPath}/task-${task.id}.ics`, findEvent(calendarPath, task.id)?.replace('SUMMARY:Review', 'SUMMARY:Moved in the calendar') ?? '');

            await patch(`/tasks/${task.id}`, { description: 'With Ada' });
            await settle();

            expect(findEvent(calendarPath, task.id)).toContain('SUMMARY:Review\r\n');
        });

        it('syncs a task however a repository writes it, and nothing of a write that is rolled back', async () => {
            const calendarPath: string = createCalendar();
            const board: Board = await createBoard('Repository');
            await patch(`/${board.projectId}/calendar`, { calendarSync: { target: { connectionId, calendarPath } } });
            const tasks: Repository<Task> = inject(repositoryTokenFor(Task));
            const row: Omit<Task, 'id' | 'tenantId' | 'changeSets'> = {
                projectId: board.projectId,
                columnId: board.openColumnId,
                title: 'Written by a job',
                description: null,
                position: 1,
                dueOn: new Date('2026-12-03'),
                assigneeIds: [],
                labelIds: [],
                doneAt: null,
                parentTaskId: null,
                recurringTaskId: null
            };

            const written: Task = await tenants().runAs(tenantId, async () => await tasks.create(row, { unscoped: true }));
            const rolledBack: Error | undefined = await tenants().runAs(tenantId, async () => await tasks.dataSource.runInTransaction(async (transaction: Transaction) => {
                await tasks.create({ ...row, title: 'Never written', position: 2 }, { transaction, unscoped: true });
                throw new Error('rolled back');
            }, { maxAttempts: 1 }).then(() => undefined, (error: unknown) => error instanceof Error ? error : undefined));
            await settle();

            expect(rolledBack?.message).toBe('rolled back');
            expect(calDav.findFilePaths(calendarPath)).toEqual([`${calendarPath}/task-${written.id}.ics`]);
        });

        it('retries while the server is down, and writes the change once it is back', async () => {
            const calendarPath: string = createCalendar();
            const board: Board = await createBoard('Outage');
            await patch(`/${board.projectId}/calendar`, { calendarSync: { target: { connectionId, calendarPath } } });
            // the request of the change of the calendar, which would queue one for the task as well
            await settle();
            const requests: Repository<TaskCalendarSyncRequest> = inject(repositoryTokenFor(TaskCalendarSyncRequest));
            calDav.down = true;
            let task: RowWithId;
            try {
                task = await create(`/${board.projectId}/tasks`, { columnId: board.openColumnId, title: 'During the outage', dueOn: '2026-12-04' });
                await waitUntil(async () => {
                    await inject(ZIBRI_PROJECTS_PLUGIN_DI_TOKENS.TASK_CALENDAR_SYNC_SERVICE).syncDueRequests();
                    return await requests.exists({ where: { scopeId: task.id, attempts: 1 }, acrossTenants: true });
                }, 10_000);
            }
            finally {
                calDav.down = false;
            }
            const failed: TaskCalendarSyncRequest[] = await requests.findAll({ where: { scopeId: task.id }, acrossTenants: true });
            expect(failed).toEqual([expect.objectContaining({ attempts: 1, nextAttemptAt: expect.any(Date), error: expect.objectContaining({ name: 'HttpClientError' }) })]);
            expect(findEvent(calendarPath, task.id)).toBeUndefined();

            // as if the minute of the first retry had passed
            await requests.updateAll({ scopeId: task.id }, { nextAttemptAt: new Date(Date.now() - 1000) }, { acrossTenants: true });
            await waitUntil(async () => {
                await inject(ZIBRI_PROJECTS_PLUGIN_DI_TOKENS.TASK_CALENDAR_SYNC_SERVICE).syncDueRequests();
                return !await requests.exists({ where: { scopeId: task.id }, acrossTenants: true });
            }, 10_000);

            expect(findEvent(calendarPath, task.id)).toContain('SUMMARY:During the outage\r\n');
        });

        it('refuses a calendar of a connection the tenant does not have, and a path that is none', async () => {
            const board: Board = await createBoard('Refused');

            expect((await call(manager, 'PATCH', `/${board.projectId}/calendar`, {
                calendarSync: { target: { connectionId: UUIDUtilities.generate(), calendarPath: 'calendars/ada/projects' } }
            })).status).toBe(400);
            expect((await call(manager, 'PATCH', `/${board.projectId}/calendar`, { calendarSync: { target: { connectionId, calendarPath: 'calendars/../files' } } })).status)
                .toBe(400);
            expect((await call(manager, 'PATCH', `/${board.projectId}/calendar`, { calendarSync: { target: { connectionId, calendarPath: '' } } })).status).toBe(400);
        });

        describe('the routes of the WebDAV connections', () => {
            async function callConnections<T>(caller: Caller, method: string, path: string, body?: object): Promise<Answer<T>> {
                const res: Response = await fetch(`${baseUrl}/web-dav-connections${path}`, {
                    method,
                    headers: { ...caller.headers, ...body == undefined ? {} : { 'content-type': 'application/json' } },
                    body: body == undefined ? undefined : JSON.stringify(body)
                });
                const text: string = await res.text();
                // what the route answered, which the case typed
                return { status: res.status, body: (text === '' ? undefined : JSON.parse(text)) as T };
            }

            async function addConnection(name: string): Promise<ConnectionRow> {
                const res: Answer<ConnectionRow> = await callConnections<ConnectionRow>(manager, 'POST', '/', { name, ...tenantConnection() });
                expect(res.status).toBe(200);
                return res.body;
            }

            async function findStoredPassword(id: string): Promise<string> {
                return await tenants().runAs(tenantId, async () => (await inject<Repository<TenantWebDavConnection>>(repositoryTokenFor(TenantWebDavConnection))
                    .findById(id)).password);
            }

            it('adds a connection once a request to its folder succeeds, and never answers its password', async () => {
                const added: ConnectionRow = await addConnection('Office cloud');

                expect(added).toEqual({ id: expect.any(String), tenantId, name: 'Office cloud', kind: WebDavConnectionKind.WEB_DAV, url: calDav.connection.url, username: 'ada' });
                const listed: Answer<ConnectionRow[]> = await callConnections<ConnectionRow[]>(manager, 'GET', '/');
                expect(listed.body.find(connection => connection.id === added.id)).toEqual(added);
                expect(listed.body.every(connection => !('password' in connection))).toBe(true);
                expect(await findStoredPassword(added.id)).toBe('Lovelace-app-password');
            });

            it('refuses a connection whose request fails, saying why, a name taken, and a caller without the permission', async () => {
                const wrongPassword: Answer<ErrorBody> = await callConnections(manager, 'POST', '/', { ...tenantConnection(), name: 'Wrong', password: 'guessed' });
                const nothing: Answer<ErrorBody> = await callConnections(manager, 'POST', '/', { ...tenantConnection(), name: 'Nowhere', url: `${calDav.connection.url}nowhere/` });
                const notAUrl: Answer<ErrorBody> = await callConnections(manager, 'POST', '/', { ...tenantConnection(), name: 'No url', url: 'cloud.example.com' });

                expect(wrongPassword.status).toBe(400);
                expect(wrongPassword.body.message).toBe('The WebDAV server refused the username or the password.');
                expect(nothing.status).toBe(400);
                expect(nothing.body.message).toContain('the server has nothing at');
                expect(notAUrl.status).toBe(400);
                expect((await callConnections(manager, 'POST', '/', { name: 'Nextcloud', ...tenantConnection() })).status).toBe(409);
                const reader: Caller = await createCaller(TenantRoles.READER);
                expect((await callConnections(reader, 'GET', '/')).status).toBe(403);
                expect((await callConnections(reader, 'POST', '/', { name: 'Theirs', ...tenantConnection() })).status).toBe(403);
            });

            it('changes a connection, and a new password only once a request succeeds with it', async () => {
                const added: ConnectionRow = await addConnection('Shared drive');

                // a new name sends nothing to the server, which is down
                calDav.down = true;
                try {
                    expect((await callConnections<ConnectionRow>(manager, 'PATCH', `/${added.id}`, { name: 'Shared files' })).body.name).toBe('Shared files');
                }
                finally {
                    calDav.down = false;
                }
                const refused: Answer<ErrorBody> = await callConnections(manager, 'PATCH', `/${added.id}`, { password: 'guessed' });
                expect(refused.status).toBe(400);
                expect(await findStoredPassword(added.id)).toBe('Lovelace-app-password');
                const changed: Answer<ConnectionRow> = await callConnections<ConnectionRow>(manager, 'PATCH', `/${added.id}`, { password: 'Lovelace-app-password' });
                expect(changed.status).toBe(200);
                expect('password' in changed.body).toBe(false);
            });

            /**
             * Adds a connection whose calendar a project names, with a task whose event is written through it.
             * @param name - The name of the connection and of the project.
             * @returns The connection, the project, the calendar and the task.
             */
            async function addConnectionWithEvent(name: string): Promise<ConnectionWithEvent> {
                const calendarPath: string = createCalendar();
                const added: ConnectionRow = await addConnection(name);
                const board: Board = await createBoard(name);
                await patch(`/${board.projectId}/calendar`, { calendarSync: { target: { connectionId: added.id, calendarPath } } });
                const task: RowWithId = await create(`/${board.projectId}/tasks`, { columnId: board.openColumnId, title: `Launch ${name}`, dueOn: '2027-02-01' });
                await settle();
                expect(await findLinks(task.id)).toHaveLength(1);
                return { added, board, calendarPath, task };
            }

            /**
             * Takes the calendar of a project away while the server is down, as from a server gone for good: the event
             * and its link stay.
             * @param board - The project.
             */
            async function removeCalendarWhileDown(board: Board): Promise<void> {
                calDav.down = true;
                try {
                    await patch(`/${board.projectId}/calendar`, { calendarSync: null });
                }
                finally {
                    calDav.down = false;
                }
            }

            async function isListed(connectionId: string): Promise<boolean> {
                return (await callConnections<ConnectionRow[]>(manager, 'GET', '/')).body.some(connection => connection.id === connectionId);
            }

            it('refuses to delete a connection a calendar names, and deletes nothing', async () => {
                const { added, task } = await addConnectionWithEvent('Intranet');

                const named: Answer<ErrorBody> = await callConnections(manager, 'DELETE', `/${added.id}`);
                expect(named.status).toBe(409);
                expect(named.body.paragraphs.join(' ')).toContain('Intranet');
                expect(await isListed(added.id)).toBe(true);
                expect(await findLinks(task.id)).toHaveLength(1);
                await patch('/calendar', { calendarSync: { target: { connectionId: added.id, calendarPath: createCalendar() } } });
                try {
                    expect((await callConnections<ErrorBody>(manager, 'DELETE', `/${added.id}`)).body.paragraphs.join(' ')).toContain('every project that sets none');
                }
                finally {
                    await patch('/calendar', { calendarSync: null });
                    await settle();
                }
            });

            it('deletes a connection whose events are in a calendar with their links, and leaves the events there', async () => {
                const { added, board, calendarPath, task } = await addConnectionWithEvent('Retired cloud');
                await removeCalendarWhileDown(board);

                expect((await callConnections(manager, 'DELETE', `/${added.id}`)).status).toBe(204);
                expect(await isListed(added.id)).toBe(false);
                expect(await findLinks(task.id)).toEqual([]);
                expect(calDav.findFilePaths(calendarPath)).toEqual([`${calendarPath}/task-${task.id}.ics`]);
            });

            it('keeps the links of a connection whose deletion fails', async () => {
                const { added, board, task } = await addConnectionWithEvent('Flaky cloud');
                await removeCalendarWhileDown(board);
                const failing: ConnectionDeletingUsageCleaner = inject(ConnectionDeletingUsageCleaner);

                failing.armed = true;
                try {
                    expect((await callConnections(manager, 'DELETE', `/${added.id}`)).status).toBe(404);
                }
                finally {
                    failing.armed = false;
                }
                expect(await isListed(added.id)).toBe(true);
                expect(await findLinks(task.id)).toHaveLength(1);
            });
        });
    });
}
