import { Repository } from '../../../data-source/repository/repository';
import { type Transaction } from '../../../data-source/transaction/transaction.model';
import { UniqueConstraintViolationError } from '../../../data-source/unique-constraint-violation.error';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { Inject } from '../../../di/decorators/inject.decorator';
import { Injectable } from '../../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { BadRequestError } from '../../../error-handling/errors/bad-request.error';
import { $ts } from '../../../localization/translate.function';
import { Ms } from '../../../utilities/ms';
import { type NewRecurringTask } from '../models/new-recurring-task.model';
import { type NonWorkingDayRule } from '../models/non-working-day-rule.model';
import { type PositionPlacement } from '../models/position-placement.model';
import { type ProjectAccess } from '../models/project-access.model';
import { ProjectColumn } from '../models/project-column.model';
import { type ProjectRole } from '../models/project-role.model';
import { Project } from '../models/project.model';
import { ZIBRI_PROJECTS_LIMITS } from '../models/projects-limits.model';
import { type ProjectsPluginOptions } from '../models/projects-plugin-options.model';
import { type RecurringTaskChange } from '../models/recurring-task-change.model';
import { RecurringTaskOccurrence } from '../models/recurring-task-occurrence.model';
import { RecurringTask } from '../models/recurring-task.model';
import { TaskLabel } from '../models/task-label.model';
import { Task } from '../models/task.model';
import { type WorkingCalendar } from '../models/working-calendar.model';
import { ProjectEventUtilities } from '../project-event.utilities';
import { ProjectPositionUtilities } from '../project-position.utilities';
import { ZIBRI_PROJECTS_PLUGIN_DI_TOKENS } from '../projects.tokens';
import { RecurrenceUtilities } from '../recurrence.utilities';
import { type ProjectAccessServiceInterface } from './project-access-service.interface';
import { type ProjectBoardUpdateServiceInterface } from './project-board-update-service.interface';
import { type RecurringTaskServiceInterface } from './recurring-task-service.interface';
import { type WorkingCalendarServiceInterface } from './working-calendar-service.interface';

/**
 * How many days before its due date an occurrence of a recurring task that names no lead time is created.
 */
const DEFAULT_LEAD_TIME_IN_DAYS: number = 14;

/**
 * How many days after its due date a missed occurrence is still created, such as after the application was down.
 */
const CATCH_UP_DAYS: number = 31;

/**
 * How many days a due date on a day that is not a working day is moved at most, which the days resolved around the
 * lead time leave room for.
 */
const SHIFT_MARGIN_DAYS: number = 31;

/**
 * An occurrence of a recurring task that is due: the day of the recurrence, and the day it is due on.
 */
type DueOccurrence = {
    /**
     * The day of the recurrence.
     */
    occurrenceOn: Date,
    /**
     * The day it is due on, moved off a day that is not a working day.
     */
    dueOn: Date
};

/**
 * Default implementation of the recurring task service.
 */
@Injectable({ register: 'onUse' })
export class RecurringTaskService implements RecurringTaskServiceInterface {
    // read when used rather than injected, for the reason the bank plugin reads its repositories so
    private get recurringTaskRepository(): Repository<RecurringTask> {
        return inject(repositoryTokenFor(RecurringTask));
    }

    private get occurrenceRepository(): Repository<RecurringTaskOccurrence> {
        return inject(repositoryTokenFor(RecurringTaskOccurrence));
    }

    private get projectRepository(): Repository<Project> {
        return inject(repositoryTokenFor(Project));
    }

    private get columnRepository(): Repository<ProjectColumn> {
        return inject(repositoryTokenFor(ProjectColumn));
    }

    private get labelRepository(): Repository<TaskLabel> {
        return inject(repositoryTokenFor(TaskLabel));
    }

    private get taskRepository(): Repository<Task> {
        return inject(repositoryTokenFor(Task));
    }

    private get accessService(): ProjectAccessServiceInterface {
        return inject(ZIBRI_PROJECTS_PLUGIN_DI_TOKENS.PROJECT_ACCESS_SERVICE);
    }

    private get calendarService(): WorkingCalendarServiceInterface {
        return inject(ZIBRI_PROJECTS_PLUGIN_DI_TOKENS.WORKING_CALENDAR_SERVICE);
    }

    private get boardUpdateService(): ProjectBoardUpdateServiceInterface {
        return inject(ZIBRI_PROJECTS_PLUGIN_DI_TOKENS.PROJECT_BOARD_UPDATE_SERVICE);
    }

    constructor(
        @Inject(ZIBRI_PROJECTS_PLUGIN_DI_TOKENS.OPTIONS)
        protected readonly options: ProjectsPluginOptions
    ) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findRecurringTasks(projectId: string): Promise<RecurringTask[]> {
        const access: ProjectAccess = await this.accessService.resolveAccess(projectId);
        return await this.recurringTaskRepository.findAll({
            where: { projectId: access.project.id },
            order: { title: 'ASC', id: 'ASC' },
            limit: 'all'
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findRecurringTask(recurringTaskId: string): Promise<RecurringTask> {
        return await this.recurringTaskRepository.findById(recurringTaskId);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async createRecurringTask(projectId: string, recurringTask: NewRecurringTask): Promise<RecurringTask> {
        await this.resolveWritable(projectId, 'editor');
        RecurrenceUtilities.validateRecurrence(recurringTask.recurrence, recurringTask.startsOn);
        const assigneeIds: string[] = [...new Set(recurringTask.assigneeIds ?? [])];
        const labelIds: string[] = [...new Set(recurringTask.labelIds ?? [])];
        await this.validateTemplate(projectId, assigneeIds, labelIds);
        return await this.recurringTaskRepository.create({
            projectId,
            title: recurringTask.title,
            description: recurringTask.description ?? null,
            assigneeIds,
            labelIds,
            recurrence: recurringTask.recurrence,
            startsOn: recurringTask.startsOn,
            timezone: recurringTask.timezone,
            leadTimeInDays: recurringTask.leadTimeInDays ?? DEFAULT_LEAD_TIME_IN_DAYS,
            nonWorkingDay: recurringTask.nonWorkingDay ?? null,
            pausedAt: null,
            activeFrom: RecurrenceUtilities.resolveDay(new Date(), recurringTask.timezone)
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async updateRecurringTask(recurringTaskId: string, change: RecurringTaskChange): Promise<RecurringTask> {
        const stored: RecurringTask = await this.recurringTaskRepository.findById(recurringTaskId);
        await this.resolveWritable(stored.projectId, 'editor');
        RecurrenceUtilities.validateRecurrence(change.recurrence ?? stored.recurrence, change.startsOn ?? stored.startsOn);
        if (change.assigneeIds != undefined || change.labelIds != undefined) {
            await this.validateTemplate(
                stored.projectId,
                [...new Set(change.assigneeIds ?? [])].filter(id => !stored.assigneeIds.includes(id)),
                [...new Set(change.labelIds ?? [])]
            );
        }
        const now: Date = new Date();
        const today: Date = RecurrenceUtilities.resolveDay(now, change.timezone ?? stored.timezone);
        // what decides the days, changed: the days due before today are not created after the fact, and neither are
        // those due while it was paused
        const restarts: boolean = this.isRestartedBy(change, stored);
        const data: Partial<RecurringTask> = {
            ...change.title === undefined ? {} : { title: change.title },
            ...change.description === undefined ? {} : { description: change.description },
            ...change.assigneeIds === undefined ? {} : { assigneeIds: [...new Set(change.assigneeIds)] },
            ...change.labelIds === undefined ? {} : { labelIds: [...new Set(change.labelIds)] },
            ...change.recurrence === undefined ? {} : { recurrence: change.recurrence },
            ...change.startsOn === undefined ? {} : { startsOn: change.startsOn },
            ...change.timezone === undefined ? {} : { timezone: change.timezone },
            ...change.leadTimeInDays === undefined ? {} : { leadTimeInDays: change.leadTimeInDays },
            ...change.nonWorkingDay === undefined ? {} : { nonWorkingDay: change.nonWorkingDay },
            ...change.paused === true && stored.pausedAt == undefined ? { pausedAt: now } : {},
            ...change.paused === false ? { pausedAt: null } : {},
            ...restarts ? { activeFrom: today } : {}
        };
        return !Object.keys(data).length ? stored : await this.recurringTaskRepository.updateById(recurringTaskId, data);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async deleteRecurringTask(recurringTaskId: string): Promise<void> {
        const stored: RecurringTask = await this.recurringTaskRepository.findById(recurringTaskId);
        await this.resolveWritable(stored.projectId, 'editor');
        // its occurrences go along with it, and the tasks created for them stay
        await this.recurringTaskRepository.dataSource.runInTransaction(async (transaction: Transaction) => {
            await this.taskRepository.updateAll({ recurringTaskId }, { recurringTaskId: null }, { transaction });
            await this.recurringTaskRepository.deleteById(recurringTaskId, { transaction });
        }, { maxAttempts: 3 });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async createDueOccurrences(now: Date): Promise<Task[]> {
        // as the application: nobody is the caller, and what a recurring task creates is what its editor set up
        const recurringTasks: RecurringTask[] = await this.recurringTaskRepository.findAll({
            where: { pausedAt: null },
            unscoped: true,
            limit: 'all'
        });
        const created: Task[] = [];
        // one after the other: each takes the lease on the columns it writes in, which two of one project share
        for (const recurringTask of recurringTasks) {
            // skipped when another run holds it: that run creates what is due, and the unique of each occurrence is
            // what holds when the lease does not
            const tasks: Task[] | undefined = await inject(ZIBRI_DI_TOKENS.LEASE_SERVICE).withLease(
                { key: `zi.projects.recurring-task:${recurringTask.id}`, leaseInMs: Ms.MINUTE },
                async () => await this.createOccurrencesOf(recurringTask, now)
            );
            created.push(...tasks ?? []);
        }
        return created;
    }

    /**
     * Whether a change restarts a recurring task from today: it changes what decides the days, or ends its pause.
     * @param change - The change.
     * @param stored - The recurring task, as it is stored.
     * @returns True when it restarts.
     */
    private isRestartedBy(change: RecurringTaskChange, stored: RecurringTask): boolean {
        return change.recurrence != undefined
            || change.startsOn != undefined
            || change.timezone != undefined
            || (change.paused === false && stored.pausedAt != undefined);
    }

    /**
     * Creates the occurrences of a recurring task that are due and were not created before.
     * @param recurringTask - The recurring task.
     * @param now - The moment its lead time counts from.
     * @returns The tasks created.
     */
    private async createOccurrencesOf(recurringTask: RecurringTask, now: Date): Promise<Task[]> {
        const project: Project | undefined = await this.projectRepository.findById(
            recurringTask.projectId,
            { unscoped: true, required: false }
        );
        if (project == undefined || project.archivedAt != undefined) {
            return [];
        }
        const due: DueOccurrence[] = await this.resolveDueOccurrences(recurringTask, now);
        if (!due.length) {
            return [];
        }
        const created: Pick<RecurringTaskOccurrence, 'id' | 'occurrenceOn'>[] = await this.occurrenceRepository.findAll({
            where: { recurringTaskId: recurringTask.id, occurrenceOn: { oneOf: due.map(d => d.occurrenceOn) } },
            select: { id: true, occurrenceOn: true },
            unscoped: true,
            limit: 'all'
        });
        const missing: DueOccurrence[] = due.filter(d => !created.some(c => c.occurrenceOn.getTime() === d.occurrenceOn.getTime()));
        if (!missing.length) {
            return [];
        }
        const [column] = await this.columnRepository.findAll({
            where: { projectId: project.id, isDone: false },
            order: { position: 'ASC', id: 'ASC' },
            limit: 1,
            unscoped: true
        });
        if (column == undefined) {
            inject(ZIBRI_DI_TOKENS.LOGGER).warn(
                `The recurring task ${recurringTask.id} is due, and its project ${project.id} `
                + 'has no column whose tasks are not done to create it in.'
            );
            return [];
        }
        const tasks: Task[] = [];
        for (const occurrence of missing) {
            const task: Task | undefined = await this.createOccurrence(recurringTask, column, occurrence);
            if (task != undefined) {
                tasks.push(task);
            }
        }
        await Promise.all(tasks.map(
            async task => await this.boardUpdateService.publish({ type: 'task-created', projectId: task.projectId, task })
        ));
        await ProjectEventUtilities.emit(this.options.eventNames.taskCreated, tasks);
        await ProjectEventUtilities.emit(this.options.eventNames.taskDueDateChanged, tasks);
        return tasks;
    }

    /**
     * Resolves the occurrences of a recurring task whose due date lies within its lead time of a moment, those due
     * since it is active and in the last days of catching up.
     * @param recurringTask - The recurring task.
     * @param now - The moment.
     * @returns The occurrences, in their order.
     */
    private async resolveDueOccurrences(recurringTask: RecurringTask, now: Date): Promise<DueOccurrence[]> {
        const today: Date = RecurrenceUtilities.resolveDay(now, recurringTask.timezone);
        const horizon: Date = new Date(today.getTime() + (recurringTask.leadTimeInDays * Ms.DAY));
        const earliest: Date = new Date(Math.max(recurringTask.activeFrom.getTime(), today.getTime() - (CATCH_UP_DAYS * Ms.DAY)));
        const calendar: WorkingCalendar = await this.calendarService.resolveCalendar(recurringTask.projectId);
        const rule: NonWorkingDayRule = recurringTask.nonWorkingDay ?? calendar.nonWorkingDay;
        const isWorkingDay: (day: Date) => boolean = await this.calendarService.resolveIsWorkingDay(
            calendar,
            new Date(earliest.getTime() - (2 * SHIFT_MARGIN_DAYS * Ms.DAY)),
            new Date(horizon.getTime() + (2 * SHIFT_MARGIN_DAYS * Ms.DAY))
        );
        // a day of the recurrence just past the horizon may move before it, to the previous working day
        return RecurrenceUtilities.resolveOccurrences(
            recurringTask.recurrence,
            recurringTask.startsOn,
            new Date(horizon.getTime() + (SHIFT_MARGIN_DAYS * Ms.DAY))
        )
            .map(occurrenceOn => ({ occurrenceOn, dueOn: RecurrenceUtilities.resolveWorkingDay(occurrenceOn, rule, isWorkingDay) }))
            .filter(d => d.dueOn.getTime() <= horizon.getTime() && d.dueOn.getTime() >= earliest.getTime());
    }

    /**
     * Creates an occurrence of a recurring task, as a copy of its template, once.
     * @param recurringTask - The recurring task.
     * @param column - The first column of its project whose tasks are not done.
     * @param occurrence - The occurrence.
     * @returns The task, or undefined when another run created the occurrence first.
     */
    private async createOccurrence(
        recurringTask: RecurringTask,
        column: ProjectColumn,
        occurrence: DueOccurrence
    ): Promise<Task | undefined> {
        // those of the template who see the project as it is created, and the labels the project still has
        const sees: boolean[] = await Promise.all(recurringTask.assigneeIds.map(
            async userId => await this.accessService.resolveSeesProject(userId, recurringTask.projectId)
        ));
        const assigneeIds: string[] = recurringTask.assigneeIds.filter((_, index) => sees[index] === true);
        const labels: Pick<TaskLabel, 'id'>[] = recurringTask.labelIds.length
            ? await this.labelRepository.findAll({
                where: { projectId: recurringTask.projectId, id: { oneOf: recurringTask.labelIds } },
                select: { id: true },
                unscoped: true,
                limit: 'all'
            })
            : [];
        const labelIds: string[] = recurringTask.labelIds.filter(id => labels.some(label => label.id === id));
        try {
            return await ProjectPositionUtilities.withPlacementLease(
                `column:${column.id}`,
                async () => await this.taskRepository.dataSource.runInTransaction(
                    async (transaction: Transaction) => {
                        const placement: PositionPlacement = await ProjectPositionUtilities.resolveTaskPlacement(
                            column.id,
                            undefined,
                            undefined,
                            { transaction, unscoped: true }
                        );
                        const task: Task = await this.taskRepository.create({
                            projectId: recurringTask.projectId,
                            columnId: column.id,
                            title: recurringTask.title,
                            description: recurringTask.description ?? null,
                            position: placement.position,
                            dueOn: occurrence.dueOn,
                            assigneeIds,
                            labelIds,
                            doneAt: null,
                            parentTaskId: null,
                            recurringTaskId: recurringTask.id
                        }, { transaction, unscoped: true });
                        // in the transaction of the task, whose unique refuses the second run creating the same one
                        await this.occurrenceRepository.create(
                            { recurringTaskId: recurringTask.id, occurrenceOn: occurrence.occurrenceOn, taskId: task.id },
                            { transaction, unscoped: true }
                        );
                        return task;
                    },
                    { maxAttempts: 1 }
                )
            );
        }
        catch (error) {
            if (error instanceof UniqueConstraintViolationError) {
                return undefined;
            }
            throw error;
        }
    }

    /**
     * Resolves a project the caller writes the recurring tasks of: one they hold a role on, and that is not archived.
     * @param projectId - The id of the project.
     * @param role - The least role needed.
     * @returns What the caller may do on it.
     */
    private async resolveWritable(projectId: string, role: ProjectRole): Promise<ProjectAccess> {
        const access: ProjectAccess = await this.accessService.resolveAccess(projectId);
        this.accessService.validateRole(access, role);
        this.accessService.validateNotArchived(access.project);
        return access;
    }

    /**
     * Validates the template of a recurring task: users who see the project, and labels of it.
     * @param projectId - The id of the project.
     * @param assigneeIds - The users newly assigned, each once.
     * @param labelIds - The labels, each once.
     * @throws A BadRequestError for too many of either, a user who does not see the project, or a label of another.
     */
    private async validateTemplate(projectId: string, assigneeIds: string[], labelIds: string[]): Promise<void> {
        if (assigneeIds.length > ZIBRI_PROJECTS_LIMITS.ASSIGNEES_MAX_COUNT) {
            throw new BadRequestError($ts`A task needs to be assigned to at most ${ZIBRI_PROJECTS_LIMITS.ASSIGNEES_MAX_COUNT} people.`);
        }
        if (labelIds.length > ZIBRI_PROJECTS_LIMITS.LABELS_MAX_COUNT) {
            throw new BadRequestError($ts`A task needs to carry at most ${ZIBRI_PROJECTS_LIMITS.LABELS_MAX_COUNT} labels.`);
        }
        await this.accessService.validateAssignees(projectId, assigneeIds);
        if (labelIds.length && await this.labelRepository.count({ where: { projectId, id: { oneOf: labelIds } } }) !== labelIds.length) {
            throw new BadRequestError($ts`Each label of a task needs to be a label of its project.`);
        }
    }
}