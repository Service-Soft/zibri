import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { JwtUser } from '../../__testing__/mocks/entities/jwt-user.entity';
import { Roles } from '../../__testing__/mocks/entities/roles.enum';
import { DefaultTestServerMembershipRepository } from '../../__testing__/test-server/membership-repository';
import { defaultTestServerProviders, rolesAndPermissionsProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { waitUntil } from '../../__testing__/wait-until.function';
import { type AuthServiceInterface } from '../../auth/auth-service.interface';
import { type Permission } from '../../auth/roles/permission.type';
import { type PlatformPermission } from '../../auth/roles/platform-permission.type';
import { ApiKeyAuthStrategy } from '../../auth/strategies/api-key/api-key.auth-strategy';
import { CreatedApiKey } from '../../auth/strategies/api-key/created-api-key.model';
import { DataSourceInterface } from '../../data-source/data-sources/data-source.interface';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { defineProvider } from '../../di/models/di-provider.model';
import { type Event } from '../../event/event.model';
import { type TenantServiceInterface } from '../../tenancy/tenant-service.interface';
import { Newable } from '../../types/newable.type';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { RecurringTask } from './models/recurring-task.model';
import { type TaskEventData } from './models/task-event-data.model';
import { Task } from './models/task.model';
import { Permissions, PlatformPermissions, projectsOptions, projectsTestRoles, TenantRoles, TestProjectsController } from './projects.cases';
import { ZibriProjectsPlugin } from './projects.plugin';
import { ZIBRI_PROJECTS_PLUGIN_DI_TOKENS } from './projects.tokens';
import { type HolidayCalendarInterface } from './services/holiday-calendar.interface';

/**
 * The cases every data source answers the same way about recurring tasks: their routes, the occurrences a run creates
 * within their lead time, once, kept to the working calendar of their project, and the calendars themselves. A file
 * per data source runs them against data sources of its own, which declare the test server's entities and
 * `projectsTestEntities` without `TestInvitation`.
 */

/**
 * The holidays the application of the cases knows: the calendar `test-holidays`, whose one holiday is Friday the
 * 30th of July 2027.
 */
const holidayCalendar: HolidayCalendarInterface = {
    findHolidays: async (calendarId, from, until) => {
        if (calendarId !== 'test-holidays') {
            return await Promise.resolve(undefined);
        }
        const holiday: Date = new Date('2027-07-30T00:00:00.000Z');
        return await Promise.resolve(holiday >= from && holiday <= until ? [holiday] : []);
    }
};

/**
 * Who calls the routes: a user, and the headers of their requests.
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

type RowWithId = {
    id: string
};

type CalendarRow = {
    projectId: string | null,
    own: { workingWeekdays?: number[] | null, holidayCalendarId?: string | null, nonWorkingDay?: string | null },
    effective: { workingWeekdays: number[], holidayCalendarId: string | null, nonWorkingDay: string }
};

/**
 * Describes recurring tasks and working calendars on the given data sources.
 * @param dataSourceName - The name of the data sources, for the suite.
 * @param dataSources - The data sources.
 * @param startTimeoutInMs - How long starting the server may take.
 * @param shutdownTimeoutInMs - How long shutting it down may take.
 */
export function describeRecurringTasks(
    dataSourceName: string,
    dataSources: Newable<DataSourceInterface>[],
    startTimeoutInMs: number,
    shutdownTimeoutInMs: number
): void {
    describe(`recurring tasks, on ${dataSourceName}`, () => {
        let server: StartedTestServer | undefined;
        let baseUrl: string;
        const tenantId: string = UUIDUtilities.generate();
        const otherTenantId: string = UUIDUtilities.generate();
        const created: TaskEventData[] = [];
        let manager: Caller;
        let member: Caller;

        beforeAll(async () => {
            server = await startTestServer({
                dataSources,
                authStrategies: [ApiKeyAuthStrategy],
                controllers: [TestProjectsController],
                plugins: [new ZibriProjectsPlugin()],
                providers: [
                    ...defaultTestServerProviders,
                    ...rolesAndPermissionsProviders(
                        { permissions: Object.values(Permissions), platformPermissions: Object.values(PlatformPermissions) },
                        projectsTestRoles
                    ),
                    defineProvider({
                        token: ZIBRI_PROJECTS_PLUGIN_DI_TOKENS.OPTIONS_INPUT,
                        useValue: { ...projectsOptions, eventNames: { taskCreated: 'projects-test.task-created' } }
                    }),
                    defineProvider({ token: ZIBRI_PROJECTS_PLUGIN_DI_TOKENS.HOLIDAY_CALENDAR, useValue: holidayCalendar })
                ]
            });
            baseUrl = await server.start();
            await inject(ZIBRI_DI_TOKENS.EVENT_SERVICE).subscribe('projects-test.task-created', async (event: Event<TaskEventData>) => {
                created.push(event.data);
                await Promise.resolve();
            }, { subscriberId: 'recurring-tasks-cases' });
            manager = await createCaller([TenantRoles.MANAGER]);
            member = await createCaller([TenantRoles.MEMBER]);
        }, startTimeoutInMs);

        afterAll(async () => {
            await server?.shutdown();
        }, shutdownTimeoutInMs);

        function tenants(): TenantServiceInterface {
            return inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);
        }

        async function createCaller(tenantRoles: string[], tenant: string = tenantId): Promise<Caller> {
            const user: JwtUser = await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser))
                .create({ email: `${UUIDUtilities.generate().slice(0, 8)}@recurring.test`, roles: [Roles.USER] });
            await tenants().runAs(tenant, async () => await inject(DefaultTestServerMembershipRepository).create({ tenantId: tenant, userId: user.id, roles: tenantRoles }));
            const authService: AuthServiceInterface = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
            const permissions: (Permission | PlatformPermission)[] = await authService.resolveUserPermissions(user, undefined);
            const key: CreatedApiKey = await authService.createApiKey(
                user.id,
                { name: 'cases', permissions, expiresAt: undefined, tenantId: undefined, clientAuthentication: undefined, requireDpop: false },
                undefined
            );
            return { user, headers: { 'x-api-key': key.key, 'x-tenant-id': tenant } };
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

        async function create<T extends RowWithId>(caller: Caller, path: string, body: object): Promise<T> {
            const res: Answer<T> = await call<T>(caller, 'POST', path, body);
            expect(res.status).toBe(200);
            return res.body;
        }

        /**
         * Creates a project with a board of a done column first, then two open ones.
         * @param name - The name of the project.
         * @param parentId - The project to create it below.
         * @param caller - Who creates it, the manager unless given.
         * @returns The project, and the first open column.
         */
        async function createBoard(name: string, parentId?: string, caller: Caller = manager): Promise<{ projectId: string, openColumnId: string }> {
            const project: RowWithId = await create(caller, '/', { name, parentId: parentId ?? null });
            await create(caller, `/${project.id}/columns`, { name: 'Done', isDone: true });
            const open: RowWithId = await create(caller, `/${project.id}/columns`, { name: 'To do' });
            await create(caller, `/${project.id}/columns`, { name: 'Doing' });
            return { projectId: project.id, openColumnId: open.id };
        }

        async function createRule(projectId: string, body: object, caller: Caller = member): Promise<RecurringTask> {
            return await create<RecurringTask>(caller, `/${projectId}/recurring-tasks`, { timezone: 'Europe/Berlin', ...body });
        }

        async function run(now: string, tenant: string = tenantId): Promise<Task[]> {
            return await tenants().runAs(tenant, async () => await inject(ZIBRI_PROJECTS_PLUGIN_DI_TOKENS.RECURRING_TASK_SERVICE)
                .createDueOccurrences(new Date(now)));
        }

        async function occurrencesOf(recurringTaskId: string, tenant: string = tenantId): Promise<Task[]> {
            return await tenants().runAs(tenant, async () => await inject<Repository<Task>>(repositoryTokenFor(Task))
                .findAll({ where: { recurringTaskId }, order: { dueOn: 'ASC' }, unscoped: true, limit: 'all' }));
        }

        describe('the routes', () => {
            it('create, read, change and delete a recurring task as an editor, and keep the tasks it created', async () => {
                const { projectId } = await createBoard('Filings');
                const reader: Caller = await createCaller([TenantRoles.READER]);
                const body: object = {
                    title: 'Annual return',
                    recurrence: { every: 1, unit: 'year', month: 7, dayOfMonth: 31 },
                    startsOn: '2027-01-01',
                    timezone: 'Europe/Berlin'
                };

                expect((await call(reader, 'POST', `/${projectId}/recurring-tasks`, body)).status).toBe(403);
                const rule: RecurringTask = await createRule(projectId, body);
                expect(rule.leadTimeInDays).toBe(14);
                expect((await call<RecurringTask[]>(reader, 'GET', `/${projectId}/recurring-tasks`)).body.map(r => r.id)).toEqual([rule.id]);
                expect((await call(reader, 'PATCH', `/recurring-tasks/${rule.id}`, { title: 'Mine' })).status).toBe(403);
                expect((await call<RecurringTask>(member, 'PATCH', `/recurring-tasks/${rule.id}`, { leadTimeInDays: 30 })).body.leadTimeInDays).toBe(30);
                const [task] = await run('2027-07-10T12:00:00.000Z');

                expect((await call(member, 'DELETE', `/recurring-tasks/${rule.id}`)).status).toBe(204);
                expect((await call(member, 'GET', `/recurring-tasks/${rule.id}`)).status).toBe(404);
                expect((await call<{ recurringTaskId: string | null }>(member, 'GET', `/tasks/${task?.id}`)).body.recurringTaskId).toBeNull();
            });

            it('refuses a recurrence whose parts do not go together', async () => {
                const { projectId } = await createBoard('Refused');
                const refused: { recurrence: object, startsOn: string }[] = [
                    { recurrence: { every: 1, unit: 'day', weekdays: [1] }, startsOn: '2027-01-01' },
                    { recurrence: { every: 1, unit: 'week', dayOfMonth: 3 }, startsOn: '2027-01-01' },
                    { recurrence: { every: 1, unit: 'month', month: 3 }, startsOn: '2027-01-01' },
                    { recurrence: { every: 1, unit: 'day', until: '2026-12-31' }, startsOn: '2027-01-01' },
                    { recurrence: { every: 0, unit: 'day' }, startsOn: '2027-01-01' },
                    { recurrence: { every: 1, unit: 'day' }, startsOn: '2027-01-01T10:00:00.000Z' }
                ];
                for (const body of refused) {
                    expect((await call(member, 'POST', `/${projectId}/recurring-tasks`, { title: 'Refused', timezone: 'Europe/Berlin', ...body })).status).toBe(400);
                }
            });
        });

        describe('a run', () => {
            it('creates an occurrence once its due date lies within its lead time, once, and the next one anyway', async () => {
                const { projectId } = await createBoard('Tax office');
                const rule: RecurringTask = await createRule(projectId, {
                    title: 'File the annual return',
                    recurrence: { every: 1, unit: 'year', month: 7, dayOfMonth: 31 },
                    startsOn: '2027-01-01',
                    leadTimeInDays: 30
                });

                expect(await run('2027-06-30T10:00:00.000Z')).toEqual([]);
                expect((await run('2027-07-01T10:00:00.000Z')).map(t => t.title)).toEqual(['File the annual return']);
                expect(await run('2027-07-01T10:00:00.000Z')).toEqual([]);
                expect(await run('2027-07-20T10:00:00.000Z')).toEqual([]);

                // the one of 2027 is still open, and the one of 2028 is created all the same
                await run('2028-07-02T10:00:00.000Z');
                const occurrences: Task[] = await occurrencesOf(rule.id);
                expect(occurrences.map(t => t.dueOn?.toISOString())).toEqual(['2027-07-31T00:00:00.000Z', '2028-07-31T00:00:00.000Z']);
                await waitUntil(async () => await Promise.resolve(occurrences.every(t => created.some(e => e.taskId === t.id))));
            });

            it('creates each occurrence once when two runs go at the same moment', async () => {
                const { projectId } = await createBoard('Payroll');
                const rule: RecurringTask = await createRule(projectId, {
                    title: 'Run the payroll',
                    recurrence: { every: 1, unit: 'month', dayOfMonth: -1 },
                    startsOn: '2027-01-01',
                    leadTimeInDays: 40
                });

                await Promise.all([run('2027-03-01T10:00:00.000Z'), run('2027-03-01T10:00:00.000Z'), run('2027-03-01T10:00:00.000Z')]);

                // the end of January a month back, which a run catches up, and those of February and March ahead
                expect((await occurrencesOf(rule.id)).map(t => t.dueOn?.toISOString())).toEqual([
                    '2027-01-31T00:00:00.000Z',
                    '2027-02-28T00:00:00.000Z',
                    '2027-03-31T00:00:00.000Z'
                ]);
            });

            it('creates the occurrence in the first open column as a copy of the template, with a history of its own', async () => {
                const { projectId, openColumnId } = await createBoard('Office');
                const guest: Caller = await createCaller([TenantRoles.GUEST]);
                await call(manager, 'PUT', `/${projectId}/shares/${guest.user.id}`, { role: 'viewer' });
                const kept: RowWithId = await create(member, `/${projectId}/labels`, { name: 'Routine', color: 'blue-500' });
                const dropped: RowWithId = await create(member, `/${projectId}/labels`, { name: 'Old', color: 'grey-500' });
                const rule: RecurringTask = await createRule(projectId, {
                    title: 'Water the plants',
                    description: 'All of them, **twice**.',
                    recurrence: { every: 2, unit: 'week', weekdays: [1] },
                    startsOn: '2027-03-15',
                    assigneeIds: [member.user.id, guest.user.id],
                    labelIds: [kept.id, dropped.id],
                    leadTimeInDays: 0
                });
                await call(member, 'DELETE', `/labels/${dropped.id}`);
                await call(manager, 'DELETE', `/${projectId}/shares/${guest.user.id}`);

                const [task] = await run('2027-03-15T06:00:00.000Z');

                expect(task).toMatchObject({
                    columnId: openColumnId,
                    title: 'Water the plants',
                    description: 'All of them, **twice**.',
                    assigneeIds: [member.user.id],
                    labelIds: [kept.id],
                    dueOn: new Date('2027-03-15T00:00:00.000Z'),
                    doneAt: null,
                    recurringTaskId: rule.id
                });
                const history: Answer<{ changeSets: { createdBy?: string | null }[] }> = await call(member, 'GET', `/tasks/${task?.id}`);
                expect(history.body.changeSets.map(c => c.createdBy ?? null)).toEqual([null]);
                expect((await call(member, 'POST', `/tasks/${task?.id}/comments`, { text: 'Done for this week' })).status).toBe(200);
            });

            it('moves a due date off a weekend and a holiday of the calendar, or keeps it', async () => {
                // Saturday the 31st of July 2027, after the holiday on Friday the 30th
                const recurrence: object = { every: 1, unit: 'year', month: 7, dayOfMonth: 31 };
                const { projectId } = await createBoard('Shifts');
                await call(manager, 'PATCH', `/${projectId}/calendar`, { holidayCalendarId: 'test-holidays', nonWorkingDay: 'previous' });
                const previous: RecurringTask = await createRule(projectId, { title: 'Previous', recurrence, startsOn: '2027-01-01' });
                const next: RecurringTask = await createRule(projectId, { title: 'Next', recurrence, startsOn: '2027-01-01', nonWorkingDay: 'next' });
                const kept: RecurringTask = await createRule(projectId, { title: 'Kept', recurrence, startsOn: '2027-01-01', nonWorkingDay: 'keep' });

                await run('2027-07-31T10:00:00.000Z');

                const dueOn: (rule: RecurringTask) => Promise<string | undefined> = async rule => (await occurrencesOf(rule.id))[0]?.dueOn?.toISOString();
                expect(await dueOn(previous)).toBe('2027-07-29T00:00:00.000Z');
                expect(await dueOn(next)).toBe('2027-08-02T00:00:00.000Z');
                expect(await dueOn(kept)).toBe('2027-07-31T00:00:00.000Z');
            });

            it('creates nothing for a paused recurring task, nor one of an archived project, and in its own tenant alone', async () => {
                const recurrence: object = { every: 1, unit: 'day' };
                const paused: { projectId: string } = await createBoard('Paused');
                const archived: { projectId: string } = await createBoard('Archived');
                const pausedRule: RecurringTask = await createRule(paused.projectId, { title: 'Paused', recurrence, startsOn: '2027-09-01', leadTimeInDays: 0 });
                const archivedRule: RecurringTask = await createRule(archived.projectId, { title: 'Archived', recurrence, startsOn: '2027-09-01', leadTimeInDays: 0 });
                await call(member, 'PATCH', `/recurring-tasks/${pausedRule.id}`, { paused: true });
                await call(manager, 'POST', `/${archived.projectId}/archive`);
                const elsewhere: Caller = await createCaller([TenantRoles.MANAGER], otherTenantId);
                const theirs: { projectId: string } = await createBoard('Theirs', undefined, elsewhere);
                const theirRule: RecurringTask = await createRule(theirs.projectId, { title: 'Theirs', recurrence, startsOn: '2027-09-01', leadTimeInDays: 0 }, elsewhere);

                await run('2027-09-02T10:00:00.000Z');

                expect(await occurrencesOf(pausedRule.id)).toEqual([]);
                expect(await occurrencesOf(archivedRule.id)).toEqual([]);
                expect(await occurrencesOf(theirRule.id, otherTenantId)).toEqual([]);
                expect((await call(manager, 'GET', `/recurring-tasks/${theirRule.id}`)).status).toBe(404);
                await run('2027-09-02T10:00:00.000Z', otherTenantId);
                expect((await occurrencesOf(theirRule.id, otherTenantId)).map(t => t.dueOn?.toISOString())).toEqual(['2027-09-01T00:00:00.000Z', '2027-09-02T00:00:00.000Z']);
            });
        });

        describe('the working calendar', () => {
            it('takes each value from the nearest project above that sets it, then the tenant, then Monday to Friday', async () => {
                const customer: { projectId: string } = await createBoard('Customer AG');
                const website: { projectId: string } = await createBoard('Website', customer.projectId);
                const defaults: Answer<CalendarRow> = await call(manager, 'GET', '/calendar');
                expect(defaults.body.effective).toEqual({ workingWeekdays: [1, 2, 3, 4, 5], holidayCalendarId: null, nonWorkingDay: 'keep', calendarSync: null });

                expect((await call(manager, 'PATCH', '/calendar', { nonWorkingDay: 'next' })).status).toBe(200);
                expect((await call(manager, 'PATCH', `/${customer.projectId}/calendar`, { holidayCalendarId: 'test-holidays', workingWeekdays: [1, 2, 3, 4, 5, 6] })).status)
                    .toBe(200);
                expect((await call(manager, 'PATCH', `/${website.projectId}/calendar`, { workingWeekdays: [2, 1] })).status).toBe(200);

                const calendar: CalendarRow = (await call<CalendarRow>(member, 'GET', `/${website.projectId}/calendar`)).body;
                expect(calendar).toEqual({
                    projectId: website.projectId,
                    own: { workingWeekdays: [1, 2], holidayCalendarId: null, nonWorkingDay: null, calendarSync: null },
                    effective: { workingWeekdays: [1, 2], holidayCalendarId: 'test-holidays', nonWorkingDay: 'next', calendarSync: null }
                });
                expect((await call(manager, 'PATCH', `/${website.projectId}/calendar`, { workingWeekdays: null })).status).toBe(200);
                expect((await call<CalendarRow>(member, 'GET', `/${website.projectId}/calendar`)).body.effective.workingWeekdays).toEqual([1, 2, 3, 4, 5, 6]);
                expect((await call(manager, 'PATCH', '/calendar', { nonWorkingDay: null })).status).toBe(200);
            });

            it('is changed with projects.manage alone, to a holiday calendar the application knows and a working weekday', async () => {
                const { projectId } = await createBoard('Calendar rules');

                expect((await call(member, 'PATCH', `/${projectId}/calendar`, { nonWorkingDay: 'next' })).status).toBe(403);
                expect((await call(member, 'PATCH', '/calendar', { nonWorkingDay: 'next' })).status).toBe(403);
                expect((await call(manager, 'PATCH', `/${projectId}/calendar`, { holidayCalendarId: 'unknown' })).status).toBe(400);
                expect((await call(manager, 'PATCH', `/${projectId}/calendar`, { workingWeekdays: [] })).status).toBe(400);
                expect((await call(manager, 'PATCH', `/${projectId}/calendar`, { workingWeekdays: [7] })).status).toBe(400);
            });

            it('refuses a calendar to write the due dates into, which the application of the cases does not sync', async () => {
                const { projectId } = await createBoard('Calendar sync off');
                const calendarSync: object = { target: { connectionId: UUIDUtilities.generate(), calendarPath: 'calendars/ada/projects' } };

                expect((await call(manager, 'PATCH', `/${projectId}/calendar`, { calendarSync })).status).toBe(400);
                expect((await call(manager, 'PATCH', '/calendar', { calendarSync })).status).toBe(400);
                expect((await call(manager, 'PATCH', `/${projectId}/calendar`, { calendarSync: { target: null } })).status).toBe(200);
            });
        });
    });
}
