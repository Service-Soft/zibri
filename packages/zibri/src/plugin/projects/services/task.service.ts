import { type PaginationResult } from '../../../data-source/models/pagination-result.model';
import { type Where } from '../../../data-source/models/where/where-filter.model';
import { Repository } from '../../../data-source/repository/repository';
import { resolveEntityScopeContext } from '../../../data-source/scopes/resolve-entity-scope-context.function';
import { type Transaction } from '../../../data-source/transaction/transaction.model';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { Inject } from '../../../di/decorators/inject.decorator';
import { Injectable } from '../../../di/decorators/injectable.decorator';
import { inject } from '../../../di/inject.function';
import { BadRequestError } from '../../../error-handling/errors/bad-request.error';
import { ForbiddenError } from '../../../error-handling/errors/forbidden.error';
import { InternalError } from '../../../error-handling/internal-error.model';
import { $ts } from '../../../localization/translate.function';
import { FilterUtilities } from '../../../routing/filter/filter.utilities';
import { type NewTaskComment } from '../models/new-task-comment.model';
import { type NewTask } from '../models/new-task.model';
import { type PositionPlacement } from '../models/position-placement.model';
import { type ProjectAccess } from '../models/project-access.model';
import { ProjectColumn } from '../models/project-column.model';
import { type ProjectRole } from '../models/project-role.model';
import { type ProjectUser } from '../models/project-user.model';
import { ZIBRI_PROJECTS_LIMITS } from '../models/projects-limits.model';
import { type ProjectsPluginOptions } from '../models/projects-plugin-options.model';
import { type TaskChange } from '../models/task-change.model';
import { type TaskCommentPage } from '../models/task-comment-page.model';
import { TaskComment } from '../models/task-comment.model';
import { type TaskFilter } from '../models/task-filter.model';
import { TaskLabel } from '../models/task-label.model';
import { type TaskMove } from '../models/task-move.model';
import { Task } from '../models/task.model';
import { ProjectEventUtilities } from '../project-event.utilities';
import { ProjectPositionUtilities } from '../project-position.utilities';
import { ZIBRI_PROJECTS_PLUGIN_DI_TOKENS } from '../projects.tokens';
import { RecurrenceUtilities } from '../recurrence.utilities';
import { type ProjectAccessServiceInterface } from './project-access-service.interface';
import { type ProjectBoardUpdateServiceInterface } from './project-board-update-service.interface';
import { type TaskServiceInterface } from './task-service.interface';

/**
 * Default implementation of the task service.
 */
@Injectable({ register: 'onUse' })
export class TaskService implements TaskServiceInterface {
    // read when used rather than injected, for the reason the bank plugin reads its repositories so
    private get taskRepository(): Repository<Task> {
        return inject(repositoryTokenFor(Task));
    }

    private get columnRepository(): Repository<ProjectColumn> {
        return inject(repositoryTokenFor(ProjectColumn));
    }

    private get labelRepository(): Repository<TaskLabel> {
        return inject(repositoryTokenFor(TaskLabel));
    }

    private get commentRepository(): Repository<TaskComment> {
        return inject(repositoryTokenFor(TaskComment));
    }

    private get accessService(): ProjectAccessServiceInterface {
        return inject(ZIBRI_PROJECTS_PLUGIN_DI_TOKENS.PROJECT_ACCESS_SERVICE);
    }

    private get boardUpdateService(): ProjectBoardUpdateServiceInterface {
        return inject(ZIBRI_PROJECTS_PLUGIN_DI_TOKENS.PROJECT_BOARD_UPDATE_SERVICE);
    }

    constructor(
        @Inject(ZIBRI_PROJECTS_PLUGIN_DI_TOKENS.OPTIONS)
        protected readonly options: ProjectsPluginOptions
    ) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findTasks(page: number, limit: number, filter: TaskFilter): Promise<PaginationResult<Task>> {
        const narrowed: Where<Task> = {
            ...filter.projectId == undefined ? {} : { projectId: filter.projectId },
            ...filter.assigneeId == undefined ? {} : { assigneeIds: { includes: [filter.assigneeId] } },
            // a project below an archived one is archived with it, so its tasks are left out as well
            ...filter.includeArchived === true ? {} : { project: { where: { archivedAt: null } } }
        };
        const like: string | undefined = filter.search == undefined || filter.search === ''
            ? undefined
            : `%${FilterUtilities.escapeLike(filter.search)}%`;
        const where: Where<Task> = like == undefined
            ? narrowed
            : [{ ...narrowed, title: { iLike: like } }, { ...narrowed, description: { iLike: like } }];
        return await this.taskRepository.findAllPaginated(page, limit, { where, order: { dueOn: 'ASC', id: 'ASC' } });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findTask(taskId: string): Promise<Task> {
        return await this.taskRepository.findById(taskId, { relations: { changeSets: { changes: true } } });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async createTask(projectId: string, task: NewTask): Promise<Task> {
        await this.resolveWritable(projectId, 'editor');
        if (task.dueOn != undefined) {
            RecurrenceUtilities.validateDay(task.dueOn, 'dueOn');
        }
        const column: ProjectColumn = await this.resolveColumnOf(projectId, task.columnId);
        const labelIds: string[] = [...new Set(task.labelIds ?? [])];
        const assigneeIds: string[] = [...new Set(task.assigneeIds ?? [])];
        await this.validateLabels(projectId, labelIds);
        this.validateAssigneeCount(assigneeIds);
        await this.accessService.validateAssignees(projectId, assigneeIds);
        const parentTaskId: string | null = task.parentTaskId ?? null;
        if (parentTaskId != undefined) {
            await this.validateParent(projectId, undefined, parentTaskId);
        }
        const created: Task = await ProjectPositionUtilities.withPlacementLease(`column:${column.id}`, async () => {
            const placement: PositionPlacement = await this.resolveTaskPlacement(column.id, undefined, task.afterTaskId);
            return await this.taskRepository.create({
                projectId,
                columnId: column.id,
                title: task.title,
                description: task.description ?? null,
                position: placement.position,
                dueOn: task.dueOn ?? null,
                assigneeIds,
                labelIds,
                doneAt: column.isDone ? new Date() : null,
                parentTaskId
            });
        });
        await this.boardUpdateService.publish({ type: 'task-created', projectId, task: created });
        await ProjectEventUtilities.emit(this.options.eventNames.taskCreated, [created]);
        if (created.dueOn != undefined) {
            await ProjectEventUtilities.emit(this.options.eventNames.taskDueDateChanged, [created]);
        }
        if (created.doneAt != undefined) {
            await ProjectEventUtilities.emit(this.options.eventNames.taskDone, [created]);
        }
        return created;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async updateTask(taskId: string, change: TaskChange): Promise<Task> {
        const task: Task = await this.taskRepository.findById(taskId);
        await this.resolveWritable(task.projectId, 'editor');
        if (change.dueOn != undefined) {
            RecurrenceUtilities.validateDay(change.dueOn, 'dueOn');
        }
        if (change.labelIds != undefined) {
            await this.validateLabels(task.projectId, [...new Set(change.labelIds)]);
        }
        if (change.assigneeIds != undefined) {
            const assigneeIds: string[] = [...new Set(change.assigneeIds)];
            this.validateAssigneeCount(assigneeIds);
            // those assigned before stay assignable, even when they no longer see the project
            await this.accessService.validateAssignees(task.projectId, assigneeIds.filter(id => !task.assigneeIds.includes(id)));
        }
        if (change.parentTaskId != undefined) {
            await this.validateParent(task.projectId, task.id, change.parentTaskId);
        }
        const data: Partial<Pick<Task, 'title' | 'description' | 'dueOn' | 'assigneeIds' | 'labelIds' | 'parentTaskId'>> = {
            ...change.title === undefined ? {} : { title: change.title },
            ...change.description === undefined ? {} : { description: change.description },
            ...change.dueOn === undefined ? {} : { dueOn: change.dueOn },
            ...change.assigneeIds === undefined ? {} : { assigneeIds: [...new Set(change.assigneeIds)] },
            ...change.labelIds === undefined ? {} : { labelIds: [...new Set(change.labelIds)] },
            ...change.parentTaskId === undefined ? {} : { parentTaskId: change.parentTaskId }
        };
        if (!Object.keys(data).length) {
            return task;
        }
        const updated: Task = await this.taskRepository.updateById(taskId, data);
        await this.boardUpdateService.publish({ type: 'task-updated', projectId: updated.projectId, task: updated });
        if (change.dueOn !== undefined && (task.dueOn?.getTime() ?? null) !== (updated.dueOn?.getTime() ?? null)) {
            await ProjectEventUtilities.emit(this.options.eventNames.taskDueDateChanged, [updated]);
        }
        return updated;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async moveTask(taskId: string, move: TaskMove): Promise<Task> {
        const task: Task = await this.taskRepository.findById(taskId);
        await this.resolveWritable(task.projectId, 'editor');
        const column: ProjectColumn = await this.resolveColumnOf(task.projectId, move.columnId);
        const moved: Task = await ProjectPositionUtilities.withPlacementLease(`column:${column.id}`, async () => {
            const placement: PositionPlacement = await this.resolveTaskPlacement(column.id, task.id, move.afterTaskId ?? null);
            // the moment it was done stays while it moves between columns of done tasks
            const doneAt: Date | null = column.isDone ? task.doneAt ?? new Date() : null;
            // the task alone, a column and a position: the tasks around it keep theirs
            return await this.taskRepository.updateById(task.id, { columnId: column.id, position: placement.position, doneAt });
        });
        await this.boardUpdateService.publish({ type: 'task-moved', projectId: moved.projectId, task: moved });
        if (moved.columnId !== task.columnId) {
            await ProjectEventUtilities.emit(this.options.eventNames.taskMoved, [moved]);
        }
        if (task.doneAt == undefined && moved.doneAt != undefined) {
            await ProjectEventUtilities.emit(this.options.eventNames.taskDone, [moved]);
        }
        return moved;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async deleteTask(taskId: string): Promise<void> {
        const task: Task = await this.taskRepository.findById(taskId);
        await this.resolveWritable(task.projectId, 'editor');
        // its comments go along with it, and the tasks that are a part of it stay, a part of nothing
        const freed: Task[] = await this.taskRepository.dataSource.runInTransaction(async (transaction: Transaction) => {
            const res: Task[] = await this.taskRepository.updateAll({ parentTaskId: taskId }, { parentTaskId: null }, { transaction, returnUpdated: true });
            await this.taskRepository.deleteById(taskId, { transaction });
            return res;
        }, { maxAttempts: 3 });
        await this.boardUpdateService.publish({ type: 'task-deleted', projectId: task.projectId, taskId });
        await Promise.all(freed.map(async t => await this.boardUpdateService.publish({ type: 'task-updated', projectId: t.projectId, task: t })));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findComments(taskId: string, page: number, limit: number): Promise<TaskCommentPage> {
        // the task through the scope sharing narrows it by, so one of a project the caller does not see is a 404
        await this.taskRepository.findById(taskId, { select: { id: true } });
        const found: PaginationResult<TaskComment> = await this.commentRepository.findAllPaginated(page, limit, {
            where: { taskId },
            order: { createdAt: 'ASC', id: 'ASC' }
        });
        const users: ProjectUser[] = await this.accessService.resolveUsers(found.items.map(comment => comment.authorId));
        return { items: found.items, totalAmount: found.totalAmount, users };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async createComment(taskId: string, comment: NewTaskComment): Promise<TaskComment> {
        const task: Task = await this.taskRepository.findById(taskId);
        await this.resolveWritable(task.projectId, 'commenter');
        const created: TaskComment = await this.commentRepository.create({
            taskId,
            authorId: await this.resolveCurrentUserId(),
            text: comment.text,
            editedAt: null
        });
        await this.boardUpdateService.publish({ type: 'comment-created', projectId: task.projectId, comment: created });
        return created;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async updateComment(commentId: string, comment: NewTaskComment): Promise<TaskComment> {
        const stored: TaskComment = await this.commentRepository.findById(commentId);
        const task: Task = await this.taskRepository.findById(stored.taskId);
        await this.resolveWritable(task.projectId, 'commenter');
        if (stored.authorId !== await this.resolveCurrentUserId()) {
            throw new ForbiddenError($ts`A comment is changed by its author alone.`);
        }
        const updated: TaskComment = await this.commentRepository.updateById(commentId, { text: comment.text, editedAt: new Date() });
        await this.boardUpdateService.publish({ type: 'comment-updated', projectId: task.projectId, comment: updated });
        return updated;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async deleteComment(commentId: string): Promise<void> {
        const stored: TaskComment = await this.commentRepository.findById(commentId);
        const task: Task = await this.taskRepository.findById(stored.taskId);
        const access: ProjectAccess = await this.resolveWritable(task.projectId, 'commenter');
        // an editor tidies up the comments of others, a commenter their own alone
        if (stored.authorId !== await this.resolveCurrentUserId()) {
            this.accessService.validateRole(access, 'editor');
        }
        await this.commentRepository.deleteById(commentId);
        await this.boardUpdateService.publish({ type: 'comment-deleted', projectId: task.projectId, taskId: task.id, commentId });
    }

    /**
     * Resolves a project whose board the caller writes: one they hold a role on, and that is not archived.
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
     * Resolves the id of the user the request is made by, who writes a comment.
     * @returns The id.
     * @throws When nobody is logged in, which the routes refuse before.
     */
    private async resolveCurrentUserId(): Promise<string> {
        const userId: string | undefined = (await resolveEntityScopeContext(TaskComment)).currentUser?.id;
        if (userId == undefined) {
            throw new InternalError('A comment is written by a user, and nobody is logged in.');
        }
        return userId;
    }

    /**
     * Resolves a column of the board of a project.
     * @param projectId - The id of the project.
     * @param columnId - The id of the column.
     * @returns The column.
     * @throws A BadRequestError for a column of another board, or none.
     */
    private async resolveColumnOf(projectId: string, columnId: string): Promise<ProjectColumn> {
        const column: ProjectColumn | undefined = await this.columnRepository.findById(columnId, { required: false });
        if (column?.projectId !== projectId) {
            throw new BadRequestError($ts`The column "${columnId}" needs to be a column of the board of the task's project.`);
        }
        return column;
    }

    /**
     * Validates that labels are labels of a project.
     * @param projectId - The id of the project.
     * @param labelIds - The ids of the labels, each once.
     * @throws A BadRequestError for too many labels, or one of another project.
     */
    private async validateLabels(projectId: string, labelIds: string[]): Promise<void> {
        if (labelIds.length > ZIBRI_PROJECTS_LIMITS.LABELS_MAX_COUNT) {
            throw new BadRequestError($ts`A task needs to carry at most ${ZIBRI_PROJECTS_LIMITS.LABELS_MAX_COUNT} labels.`);
        }
        if (!labelIds.length) {
            return;
        }
        if (await this.labelRepository.count({ where: { projectId, id: { oneOf: labelIds } } }) !== labelIds.length) {
            throw new BadRequestError($ts`Each label of a task needs to be a label of its project.`);
        }
    }

    /**
     * Validates how many people a task is assigned to.
     * @param assigneeIds - The ids of the users, each once.
     * @throws A BadRequestError for too many.
     */
    private validateAssigneeCount(assigneeIds: string[]): void {
        if (assigneeIds.length > ZIBRI_PROJECTS_LIMITS.ASSIGNEES_MAX_COUNT) {
            throw new BadRequestError($ts`A task needs to be assigned to at most ${ZIBRI_PROJECTS_LIMITS.ASSIGNEES_MAX_COUNT} people.`);
        }
    }

    /**
     * Validates the task a task is a part of: one of the same project, which is not the task itself or a part of it.
     * @param projectId - The id of the project.
     * @param taskId - The id of the task, or undefined for one being created.
     * @param parentTaskId - The id of the task it is to be a part of.
     * @throws A BadRequestError for another one.
     */
    private async validateParent(projectId: string, taskId: string | undefined, parentTaskId: string): Promise<void> {
        const seen: string[] = [];
        // one read per task up the parts, which end at a task that is a part of nothing
        for (let currentId: string | null | undefined = parentTaskId; currentId != undefined && !seen.includes(currentId);) {
            const current: Pick<Task, 'id' | 'projectId' | 'parentTaskId'> | undefined = await this.taskRepository.findById(currentId, {
                select: { id: true, projectId: true, parentTaskId: true },
                required: false
            });
            if (current?.projectId !== projectId || current.id === taskId) {
                throw new BadRequestError($ts`The task a task is a part of needs to be another task of the same project, and not a part of it.`);
            }
            seen.push(current.id);
            currentId = current.parentTaskId;
        }
    }

    /**
     * Resolves where a task goes in a column, and writes the other tasks spread out again when their positions ran
     * out of precision.
     * @param columnId - The column.
     * @param taskId - The task moved, left out of the others, or undefined for a new one.
     * @param afterTaskId - The task to put it after, null for first, undefined for last.
     * @returns Where it goes.
     * @throws A BadRequestError for a task to put it after that is not in the column.
     */
    private async resolveTaskPlacement(columnId: string, taskId: string | undefined, afterTaskId: string | null | undefined): Promise<PositionPlacement> {
        return await ProjectPositionUtilities.resolveTaskPlacement(columnId, taskId, afterTaskId, { transaction: undefined, unscoped: false });
    }
}
