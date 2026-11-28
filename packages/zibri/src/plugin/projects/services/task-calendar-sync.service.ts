import { CalendarEntryLink } from '../../../calendar-sync/calendar-entry-link.model';
import { type CalendarEntrySource } from '../../../calendar-sync/calendar-entry-source.model';
import { type CalendarSyncServiceInterface } from '../../../calendar-sync/calendar-sync-service.interface';
import { type CalendarSyncTarget } from '../../../calendar-sync/calendar-sync-target.model';
import { Repository } from '../../../data-source/repository/repository';
import { type RepositoryTransaction } from '../../../data-source/transaction/repository-transaction.type';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { Inject } from '../../../di/decorators/inject.decorator';
import { Injectable } from '../../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { InternalError } from '../../../error-handling/internal-error.model';
import { type LoggerInterface } from '../../../logging/logger.interface';
import { type QueueDefinition } from '../../../queue/queue-definition.model';
import { QueueUtilities } from '../../../queue/queue.utilities';
import { type QueuedWorkOutcome } from '../../../queue/queued-work-outcome.model';
import { type TenantServiceInterface } from '../../../tenancy/tenant-service.interface';
import { Ms } from '../../../utilities/ms';
import { TenantWebDavConnection } from '../../../web-dav/tenant-web-dav-connection.model';
import { Project } from '../models/project.model';
import { type ProjectsCalendarSyncOptions } from '../models/projects-calendar-sync-options.model';
import { type ProjectsPluginOptions } from '../models/projects-plugin-options.model';
import { type TaskCalendarSyncRequestData } from '../models/task-calendar-sync-request-data.model';
import { TaskCalendarSyncRequest } from '../models/task-calendar-sync-request.model';
import { Task } from '../models/task.model';
import { type WorkingCalendar } from '../models/working-calendar.model';
import { ZIBRI_PROJECTS_PLUGIN_DI_TOKENS } from '../projects.tokens';
import { TaskCalendarSyncCronJob } from '../task-calendar-sync.cron-job';
import { type TaskCalendarSyncServiceInterface } from './task-calendar-sync-service.interface';

/**
 * What the event of a task is synced from, by the kind of row.
 */
const TASK_SOURCE_TYPE: string = 'task';

/**
 * How many attempts a request gets: the first retry after a minute, doubling, so the last one runs some six days after
 * the change, which a server down over a long weekend is back for.
 */
const MAX_ATTEMPTS: number = 14;

/**
 * How many requests one pass reads.
 */
const PASS_SIZE: number = 100;

/**
 * How many ids of projects one read of their tasks names, and how many requests one write queues.
 */
const CHUNK_SIZE: number = 500;

/**
 * Default implementation of the task calendar sync service: the requests are rows of `TaskCalendarSyncRequest`,
 * written in the transaction of the change and run by `TaskCalendarSyncCronJob`, the events written through
 * `ZIBRI_DI_TOKENS.CALENDAR_SYNC_SERVICE`.
 */
@Injectable({ register: 'onUse' })
export class TaskCalendarSyncService implements TaskCalendarSyncServiceInterface {
    // read when used rather than injected: the entities are declared only by an application that syncs
    private get requestRepository(): Repository<TaskCalendarSyncRequest> {
        return inject(repositoryTokenFor(TaskCalendarSyncRequest));
    }

    private get taskRepository(): Repository<Task> {
        return inject(repositoryTokenFor(Task));
    }

    private get projectRepository(): Repository<Project> {
        return inject(repositoryTokenFor(Project));
    }

    private get connectionRepository(): Repository<TenantWebDavConnection> {
        return inject(repositoryTokenFor(TenantWebDavConnection));
    }

    private get linkRepository(): Repository<CalendarEntryLink> {
        return inject(repositoryTokenFor(CalendarEntryLink));
    }

    private get calendarSyncService(): CalendarSyncServiceInterface {
        return inject(ZIBRI_DI_TOKENS.CALENDAR_SYNC_SERVICE);
    }

    private get tenantService(): TenantServiceInterface {
        return inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);
    }

    private get logger(): LoggerInterface {
        return inject(ZIBRI_DI_TOKENS.LOGGER);
    }

    constructor(
        @Inject(ZIBRI_PROJECTS_PLUGIN_DI_TOKENS.OPTIONS)
        protected readonly options: ProjectsPluginOptions
    ) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    async queueRequests(requests: TaskCalendarSyncRequestData[], transaction: RepositoryTransaction | undefined): Promise<void> {
        const byTenant: Map<string, TaskCalendarSyncRequestData[]> = new Map();
        for (const request of requests) {
            byTenant.set(request.tenantId, [...byTenant.get(request.tenantId) ?? [], request]);
        }
        // one tenant after the other, as the writes of one transaction run over one connection
        for (const [tenantId, data] of byTenant) {
            await this.tenantService.runAs(tenantId, async () => {
                for (let start: number = 0; start < data.length; start += CHUNK_SIZE) {
                    await this.requestRepository.createAll(data.slice(start, start + CHUNK_SIZE), { transaction });
                }
            });
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async wakeUp(): Promise<void> {
        await inject(ZIBRI_DI_TOKENS.WAKE_UP_SERVICE).wake(this.requestRepository.dataSource, TaskCalendarSyncCronJob.WAKE_UP_TOPIC);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async syncDueRequests(): Promise<boolean> {
        return await QueueUtilities.poll(this.resolveQueue());
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async syncTask(taskId: string): Promise<void> {
        const source: CalendarEntrySource = { type: TASK_SOURCE_TYPE, id: taskId };
        // past what a caller sees: the sync runs for nobody
        const task: Task | undefined = await this.taskRepository.findById(taskId, { required: false, unscoped: true });
        const links: CalendarEntryLink[] = await this.calendarSyncService.findLinks(source);
        const target: CalendarSyncTarget | undefined = task?.dueOn != undefined && task.doneAt == undefined
            ? await this.resolveTarget(task.projectId)
            : undefined;
        // written into the calendar that applies before it is taken out of the others, so that a task moving into
        // another calendar is in one of them throughout
        if (task?.dueOn != undefined && target != undefined) {
            await this.calendarSyncService.syncEntry({
                source,
                summary: task.title,
                description: task.description ?? undefined,
                url: this.calendarSyncOptions.taskUrl(task),
                start: task.dueOn,
                // a due date is a day, which a calendar shows as that day wherever whoever reads it is
                allDay: true
            }, target);
        }
        const stale: CalendarEntryLink[] = links.filter(link => target == undefined
            || link.connectionId !== target.connection.id
            || link.calendarPath !== target.calendarPath);
        for (const link of stale) {
            await this.removeLink(source, link);
        }
    }

    /**
     * The options of the calendar sync, which the requests are queued only with.
     * @returns The options.
     * @throws {InternalError} When the application syncs no calendars, which queues no request.
     */
    private get calendarSyncOptions(): ProjectsCalendarSyncOptions {
        const options: ProjectsCalendarSyncOptions | undefined = this.options.calendarSync;
        if (options == undefined) {
            throw new InternalError('A task is synced into a calendar with the calendarSync of the options of the projects plugin, and there is none.');
        }
        return options;
    }

    /**
     * Resolves the queue of the requests: which are due, how one is run, and what becomes of it after its attempt.
     * @returns The queue.
     */
    private resolveQueue(): QueueDefinition<TaskCalendarSyncRequest> {
        return {
            name: 'project calendar sync',
            wakeUpTopic: TaskCalendarSyncCronJob.WAKE_UP_TOPIC,
            leaseInMs: Ms.MINUTE,
            onCompletion: 'release',
            claimedPer: 'item',
            // a request waits on the server of a calendar most of its time, and one of a tenant queues many more
            maxConcurrentPerInstance: 10,
            firstRetryDelayInMs: Ms.MINUTE,
            findDue: async () => await this.requestRepository.findAll({
                // a request that spent its attempts stays as the record of what failed, until one of the same task
                // succeeds
                where: [
                    { attempts: { lesserThan: MAX_ATTEMPTS }, nextAttemptAt: null },
                    { attempts: { lesserThan: MAX_ATTEMPTS }, nextAttemptAt: { before: new Date() } }
                ],
                order: { createdAt: 'ASC', id: 'ASC' },
                limit: PASS_SIZE,
                // one queue for every tenant, which each request runs in
                acrossTenants: true
            }),
            // claimed per what it is about rather than per row, so that two requests of one task never run at once
            findRunId: request => `${request.scope}:${request.scopeId ?? request.tenantId}`,
            findMaxAttempts: () => MAX_ATTEMPTS,
            run: async request => await this.tenantService.runAs(request.tenantId, async () => await this.runRequest(request)),
            record: async (request, outcome) => await this.recordAttempt(request, outcome)
        };
    }

    /**
     * Runs a request in its tenant, and deletes the requests about the same that it does as well.
     * @param request - The request.
     */
    private async runRequest(request: TaskCalendarSyncRequest): Promise<void> {
        // read before what they are about is, so that each is one of a change this run sees: a request committed
        // after the read stays, for a run of its own
        const same: Pick<TaskCalendarSyncRequest, 'id'>[] = await this.requestRepository.findAll({
            where: { scope: request.scope, scopeId: request.scopeId ?? null },
            select: { id: true },
            limit: 'all'
        });
        switch (request.scope) {
            case 'task': {
                if (request.scopeId == undefined) {
                    throw new InternalError(`The request ${request.id} to sync a task names no task.`);
                }
                await this.syncTask(request.scopeId);
                break;
            }
            case 'project': {
                if (request.scopeId == undefined) {
                    throw new InternalError(`The request ${request.id} to sync a project names no project.`);
                }
                await this.queueTasksOf(request.tenantId, await this.resolveTakingProjectIds([request.scopeId]));
                break;
            }
            case 'tenant': {
                const roots: Pick<Project, 'id' | 'calendarSync'>[] = await this.projectRepository.findAll({
                    where: { parentId: null },
                    select: { id: true, calendarSync: true },
                    unscoped: true,
                    limit: 'all'
                });
                const taking: string[] = roots.filter(project => project.calendarSync == undefined).map(project => project.id);
                await this.queueTasksOf(request.tenantId, await this.resolveTakingProjectIds(taking));
                break;
            }
        }
        const others: string[] = same.map(row => row.id).filter(id => id !== request.id);
        if (others.length) {
            await this.requestRepository.deleteAll({ id: { oneOf: others } });
        }
    }

    /**
     * Records how an attempt at a request ended: deleted once it succeeded, retried later or kept as failed otherwise.
     * @param request - The request.
     * @param outcome - How its attempt ended.
     */
    private async recordAttempt(request: TaskCalendarSyncRequest, outcome: QueuedWorkOutcome): Promise<void> {
        // by a filter rather than by id, which throws for a row another run of the same task deleted meanwhile
        if (outcome.kind === 'succeeded') {
            await this.requestRepository.deleteAll({ id: request.id }, { acrossTenants: true });
            return;
        }
        await this.requestRepository.updateAll(
            { id: request.id },
            { attempts: outcome.attempts, nextAttemptAt: outcome.nextAttemptAt, error: outcome.error },
            { acrossTenants: true }
        );
    }

    /**
     * Resolves the ids of projects and of the projects below them that take their calendar from them, one read per
     * level. A project setting a calendar of its own ends its branch.
     * @param projectIds - The ids of the projects.
     * @returns The ids, the projects first.
     */
    private async resolveTakingProjectIds(projectIds: string[]): Promise<string[]> {
        const res: string[] = [...projectIds];
        for (let level: string[] = projectIds; level.length;) {
            const below: Pick<Project, 'id' | 'calendarSync'>[] = await this.projectRepository.findAll({
                where: { parentId: { oneOf: level } },
                select: { id: true, calendarSync: true },
                unscoped: true,
                limit: 'all'
            });
            // a project seen already ends the levels, for rows stored in a circle before that was refused
            level = below.filter(project => project.calendarSync == undefined && !res.includes(project.id)).map(project => project.id);
            res.push(...level);
        }
        return res;
    }

    /**
     * Queues a request for each task of projects that has a due date and is not done, whose calendar may have
     * changed.
     * @param tenantId - The tenant of the projects.
     * @param projectIds - The ids of the projects.
     */
    private async queueTasksOf(tenantId: string, projectIds: string[]): Promise<void> {
        const requests: TaskCalendarSyncRequestData[] = [];
        for (let start: number = 0; start < projectIds.length; start += CHUNK_SIZE) {
            const tasks: Pick<Task, 'id'>[] = await this.taskRepository.findAll({
                where: { projectId: { oneOf: projectIds.slice(start, start + CHUNK_SIZE) }, dueOn: { notOneOf: [null] }, doneAt: null },
                select: { id: true },
                unscoped: true,
                limit: 'all'
            });
            requests.push(...tasks.map((task): TaskCalendarSyncRequestData => ({ tenantId, scope: 'task', scopeId: task.id })));
        }
        if (!requests.length) {
            return;
        }
        // without a transaction: a run stopped half way leaves its own request, which queues them all again
        await this.queueRequests(requests, undefined);
        await this.wakeUp();
    }

    /**
     * Resolves the calendar that applies to a project, with its connection.
     * @param projectId - The id of the project.
     * @returns The calendar, or undefined for none, or for one whose connection the tenant deleted.
     */
    private async resolveTarget(projectId: string): Promise<CalendarSyncTarget | undefined> {
        const calendar: WorkingCalendar = await inject(ZIBRI_PROJECTS_PLUGIN_DI_TOKENS.WORKING_CALENDAR_SERVICE).resolveCalendar(projectId);
        if (calendar.calendarSync == undefined) {
            return undefined;
        }
        const connection: TenantWebDavConnection | undefined = await this.connectionRepository.findById(calendar.calendarSync.connectionId, { required: false });
        if (connection == undefined) {
            this.logger.warn(`The calendar of project ${projectId} names the WebDAV connection ${calendar.calendarSync.connectionId}, which does not exist, so its tasks are synced into none`);
            return undefined;
        }
        return { connection, calendarPath: calendar.calendarSync.calendarPath };
    }

    /**
     * Removes the event of a task from a calendar it no longer belongs in.
     * @param source - The task.
     * @param link - Its link to the event.
     */
    private async removeLink(source: CalendarEntrySource, link: CalendarEntryLink): Promise<void> {
        const connection: TenantWebDavConnection | undefined = await this.connectionRepository.findById(link.connectionId, { required: false });
        if (connection == undefined) {
            // the tenant deleted the connection, and with it the way to the event
            await this.linkRepository.deleteById(link.id);
            return;
        }
        await this.calendarSyncService.removeEntry(source, { connection, calendarPath: link.calendarPath });
    }
}
