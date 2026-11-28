import { type ZibriApplication } from '../../application/application';
import { RestoreContextUtilities } from '../../backup/restore-context.utilities';
import { type EntityWrite, type EntityWriteObserver, type MadeWrite, type WrittenRows } from '../../data-source/write-observers/entity-write-observer.model';
import { EntityWriteObserverRegistry } from '../../data-source/write-observers/entity-write-observer.registry';
import { Inject } from '../../di/decorators/inject.decorator';
import { Injectable } from '../../di/decorators/injectable.decorator';
import { inject } from '../../di/inject.function';
import { type OnAppInit } from '../../global/on-app-init.interface';
import { ProjectCalendarDefaults } from './models/project-calendar-defaults.model';
import { Project } from './models/project.model';
import { type ProjectsPluginOptions } from './models/projects-plugin-options.model';
import { type TaskCalendarSyncRequestData } from './models/task-calendar-sync-request-data.model';
import { Task } from './models/task.model';
import { ZIBRI_PROJECTS_PLUGIN_DI_TOKENS } from './projects.tokens';
import { TaskCalendarSyncCronJob } from './task-calendar-sync.cron-job';

/**
 * The properties of a task its event is written from, or which decide whether it has one.
 */
const SYNCED_TASK_PROPERTIES: string[] = ['title', 'description', 'dueOn', 'doneAt', 'projectId'];

/**
 * The properties of a project which decide the calendar of its tasks.
 */
const PROJECT_CALENDAR_PROPERTIES: string[] = ['calendarSync', 'parentId'];

/**
 * Queues a request to sync the calendars for every write that changes what an event of a task is: a task created
 * with a due date, changed, done or deleted, the calendar of a project or of the tenant changed, and a project moved
 * below another. In the transaction of the write, however a repository got to it, so that a write rolled back syncs
 * nothing and one committed is synced. Registered for you by `ZibriProjectsPlugin` when it syncs calendars.
 */
@Injectable({ register: 'onUse' })
export class TaskCalendarSyncWriteObserver implements OnAppInit {
    constructor(
        @Inject(ZIBRI_PROJECTS_PLUGIN_DI_TOKENS.OPTIONS)
        private readonly options: ProjectsPluginOptions
    ) {}

    /**
     * Registers the observers of tasks, projects and the calendars of tenants, and the cron job running the requests,
     * when the application syncs calendars.
     * @param app - The application.
     */
    onAppInit(app: ZibriApplication): void {
        if (this.options.calendarSync == undefined) {
            return;
        }
        const registry: EntityWriteObserverRegistry = inject(EntityWriteObserverRegistry);
        registry.register(Task, this.createObserver(
            ['id', 'tenantId', 'dueOn'],
            write => this.isTaskWriteSynced(write),
            // the tasks a removal removes, which are gone after it, and those a write to every row a filter matches
            // writes, which it reads only for an observer following them. A create holds them as they are
            write => write.operation !== 'insert',
            write => this.resolveTaskRequests(write)
        ));
        registry.register(Project, this.createObserver(
            ['id', 'tenantId', 'parentId', 'calendarSync'],
            write => this.writesAny(write, PROJECT_CALENDAR_PROPERTIES),
            // which tell a change from a write of the same calendar
            () => true,
            write => this.resolveProjectRequests(write)
        ));
        registry.register(ProjectCalendarDefaults, this.createObserver(
            ['id', 'tenantId', 'calendarSync'],
            write => this.writesAny(write, ['calendarSync']),
            () => true,
            write => this.resolveTenantRequests(write)
        ));
        if (!app.options.cronJobs.includes(TaskCalendarSyncCronJob)) {
            app.options.cronJobs.push(TaskCalendarSyncCronJob);
        }
    }

    /**
     * Creates an observer queueing the requests of the writes it syncs, in their transactions, and waking the cron job
     * once they are committed.
     * @param properties - The properties of the rows it reads of a write to every row a filter matches, or a removal.
     * @param isSynced - Whether a write may change an event, which is done in a transaction then.
     * @param followsBefore - Whether the requests of a synced write are resolved from the rows as they were.
     * @param resolveRequests - The requests of a write once it is made.
     * @returns The observer.
     */
    private createObserver(
        properties: string[],
        isSynced: (write: EntityWrite) => boolean,
        followsBefore: (write: EntityWrite) => boolean,
        resolveRequests: (write: WrittenRows) => TaskCalendarSyncRequestData[]
    ): EntityWriteObserver {
        return {
            properties,
            followsBefore: write => this.isObserved(write, isSynced) && followsBefore(write),
            requiresTransaction: write => this.isObserved(write, isSynced),
            completeWrite: async (write: MadeWrite) => {
                if (!this.isObserved(write, isSynced)) {
                    return;
                }
                const requests: TaskCalendarSyncRequestData[] = resolveRequests(write);
                if (requests.length) {
                    await inject(ZIBRI_PROJECTS_PLUGIN_DI_TOKENS.TASK_CALENDAR_SYNC_SERVICE).queueRequests(requests, write.transaction);
                }
            },
            handleWritten: async (written: WrittenRows) => {
                if (this.isObserved(written, isSynced) && resolveRequests(written).length) {
                    await inject(ZIBRI_PROJECTS_PLUGIN_DI_TOKENS.TASK_CALENDAR_SYNC_SERVICE).wakeUp();
                }
            }
        };
    }

    /**
     * Whether a write is one the sync follows. A restore of a backup writes the rows back as they were stored, and
     * leaves the calendars as they are.
     * @param write - The write.
     * @param isSynced - Whether its entity syncs it.
     * @returns Whether it is followed.
     */
    private isObserved(write: EntityWrite, isSynced: (write: EntityWrite) => boolean): boolean {
        return !RestoreContextUtilities.isRestoring() && isSynced(write);
    }

    /**
     * Whether a write of tasks may change an event: a task created with a due date, a removal, and a write of what an
     * event is written from.
     * @param write - The write.
     * @returns Whether it may.
     */
    private isTaskWriteSynced(write: EntityWrite): boolean {
        switch (write.operation) {
            case 'insert': {
                return write.data.some(data => Reflect.get(data, 'dueOn') != undefined);
            }
            case 'remove': {
                return true;
            }
            case 'save':
            case 'updateEach':
            case 'updateAll':
            case 'upsert': {
                return this.writesAny(write, SYNCED_TASK_PROPERTIES);
            }
        }
    }

    /**
     * Whether a write writes any of some properties.
     * @param write - The write.
     * @param properties - The properties.
     * @returns Whether it does. A removal writes none.
     */
    private writesAny(write: EntityWrite, properties: string[]): boolean {
        return write.operation !== 'remove' && write.data.some(data => properties.some(property => property in data));
    }

    /**
     * Resolves the requests of a write of tasks: one for each task with a due date, or one that had one.
     * @param write - The write, once it is made.
     * @returns The requests.
     */
    private resolveTaskRequests(write: WrittenRows): TaskCalendarSyncRequestData[] {
        if (write.operation === 'remove') {
            return write.before.flatMap(row => Reflect.get(row, 'dueOn') == undefined ? [] : this.toRequest(row, 'task'));
        }
        // a due date written may be one removed, from a task with an event
        const writesDueOn: boolean = write.operation !== 'insert' && write.data.some(data => 'dueOn' in data);
        return write.after.flatMap(row => writesDueOn || Reflect.get(row, 'dueOn') != undefined ? this.toRequest(row, 'task') : []);
    }

    /**
     * Resolves the requests of a write of projects: one for each project whose calendar, or whose place, changed.
     * @param write - The write, once it is made.
     * @returns The requests.
     */
    private resolveProjectRequests(write: WrittenRows): TaskCalendarSyncRequestData[] {
        return write.after.flatMap(row => {
            const before: object | undefined = write.before.find(candidate => Reflect.get(candidate, 'id') === Reflect.get(row, 'id'));
            // a project created has no tasks yet
            if (before == undefined) {
                return [];
            }
            const changed: boolean = Reflect.get(before, 'parentId') !== Reflect.get(row, 'parentId')
                || !this.isSameSetting(Reflect.get(before, 'calendarSync'), Reflect.get(row, 'calendarSync'));
            return changed ? this.toRequest(row, 'project') : [];
        });
    }

    /**
     * Resolves the requests of a write of the calendars of tenants: one for each tenant whose calendar changed.
     * @param write - The write, once it is made.
     * @returns The requests.
     */
    private resolveTenantRequests(write: WrittenRows): TaskCalendarSyncRequestData[] {
        return write.after.flatMap(row => {
            const before: object | undefined = write.before.find(candidate => Reflect.get(candidate, 'id') === Reflect.get(row, 'id'));
            // the tenant has nothing above it, so a calendar of none and no calendar set are the same
            const changed: boolean = !this.isSameTarget(this.findTarget(before), this.findTarget(row));
            return changed ? this.toRequest(row, 'tenant') : [];
        });
    }

    /**
     * Whether two settings of the calendar of a project are the same: both from above, or both the same calendar or
     * none.
     * @param a - The one.
     * @param b - The other.
     * @returns Whether they are.
     */
    private isSameSetting(a: unknown, b: unknown): boolean {
        return a == undefined || b == undefined
            ? a == undefined && b == undefined
            : typeof a === 'object'
                && typeof b === 'object'
                && this.isSameTarget(this.findTarget({ calendarSync: a }), this.findTarget({ calendarSync: b }));
    }

    /**
     * Whether two calendars are the same, compared by their values: the stores keep the properties of an object in an
     * order of their own.
     * @param a - The one, or undefined for none.
     * @param b - The other, or undefined for none.
     * @returns Whether they are.
     */
    private isSameTarget(a: object | undefined, b: object | undefined): boolean {
        return a == undefined || b == undefined
            ? a == undefined && b == undefined
            : Reflect.get(a, 'connectionId') === Reflect.get(b, 'connectionId')
                && Reflect.get(a, 'calendarPath') === Reflect.get(b, 'calendarPath');
    }

    /**
     * Finds the calendar a row sets.
     * @param row - The row of a project or of the calendar of a tenant.
     * @returns The calendar, or undefined for none or none set.
     */
    private findTarget(row: object | undefined): object | undefined {
        const calendarSync: unknown = row == undefined ? undefined : Reflect.get(row, 'calendarSync');
        const target: unknown = calendarSync != undefined && typeof calendarSync === 'object'
            ? Reflect.get(calendarSync, 'target')
            : undefined;
        return target != undefined && typeof target === 'object' ? target : undefined;
    }

    /**
     * Gets the request of a row.
     * @param row - The row of a task, a project or the calendar of a tenant.
     * @param scope - What the request is about.
     * @returns The request, or none for a row without its tenant or id.
     */
    private toRequest(row: object, scope: TaskCalendarSyncRequestData['scope']): TaskCalendarSyncRequestData[] {
        const tenantId: unknown = Reflect.get(row, 'tenantId');
        const id: unknown = Reflect.get(row, 'id');
        if (typeof tenantId !== 'string' || typeof id !== 'string') {
            return [];
        }
        return [{ tenantId, scope, scopeId: scope === 'tenant' ? null : id }];
    }
}