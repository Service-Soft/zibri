import { type CurrentUser } from '../../../auth/decorators/current-user.decorator';
import { type BaseInvitation } from '../../../auth/invitation/base-invitation.model';
import { type PaginationResult } from '../../../data-source/models/pagination-result.model';
import { type Where } from '../../../data-source/models/where/where-filter.model';
import { Repository } from '../../../data-source/repository/repository';
import { type Transaction } from '../../../data-source/transaction/transaction.model';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { Inject } from '../../../di/decorators/inject.decorator';
import { Injectable } from '../../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { BadRequestError } from '../../../error-handling/errors/bad-request.error';
import { ConflictError } from '../../../error-handling/errors/conflict.error';
import { InternalError } from '../../../error-handling/internal-error.model';
import { $ts } from '../../../localization/translate.function';
import { FilterUtilities } from '../../../routing/filter/filter.utilities';
import { type RowShare } from '../../../sharing/row-share.model';
import { type ShareByEmailResult } from '../../../sharing/share-by-email.model';
import { type ShareServiceInterface } from '../../../sharing/share-service.interface';
import { type NewProjectColumn } from '../models/new-project-column.model';
import { type NewProjectShare } from '../models/new-project-share.model';
import { type NewProject } from '../models/new-project.model';
import { type NewTaskLabel } from '../models/new-task-label.model';
import { type PositionedRow, type PositionPlacement } from '../models/position-placement.model';
import { type ProjectAccess } from '../models/project-access.model';
import { type ProjectBoard } from '../models/project-board.model';
import { type ProjectChange } from '../models/project-change.model';
import { type ProjectColumnChange } from '../models/project-column-change.model';
import { type ProjectColumnMove } from '../models/project-column-move.model';
import { ProjectColumn } from '../models/project-column.model';
import { type ProjectFilter } from '../models/project-filter.model';
import { PROJECT_ROLES, type ProjectRole } from '../models/project-role.model';
import { type ProjectShareResult } from '../models/project-share-result.model';
import { type ProjectShare } from '../models/project-share.model';
import { type ProjectUser } from '../models/project-user.model';
import { Project } from '../models/project.model';
import { type ProjectsPluginOptions } from '../models/projects-plugin-options.model';
import { type TaskLabelChange } from '../models/task-label-change.model';
import { TaskLabel } from '../models/task-label.model';
import { Task } from '../models/task.model';
import { ProjectEventUtilities } from '../project-event.utilities';
import { ProjectPositionUtilities } from '../project-position.utilities';
import { ZIBRI_PROJECTS_PLUGIN_DI_TOKENS } from '../projects.tokens';
import { type ProjectAccessServiceInterface } from './project-access-service.interface';
import { type ProjectBoardUpdateServiceInterface } from './project-board-update-service.interface';
import { type ProjectServiceInterface } from './project-service.interface';

/**
 * Default implementation of the project service.
 */
@Injectable({ register: 'onUse' })
export class ProjectService implements ProjectServiceInterface {
    // read when used rather than injected, for the reason the bank plugin reads its repositories so
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

    private get boardUpdateService(): ProjectBoardUpdateServiceInterface {
        return inject(ZIBRI_PROJECTS_PLUGIN_DI_TOKENS.PROJECT_BOARD_UPDATE_SERVICE);
    }

    private get shareService(): ShareServiceInterface {
        return inject(ZIBRI_DI_TOKENS.SHARE_SERVICE);
    }

    constructor(
        @Inject(ZIBRI_PROJECTS_PLUGIN_DI_TOKENS.OPTIONS)
        protected readonly options: ProjectsPluginOptions
    ) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findProjects(page: number, limit: number, filter: ProjectFilter): Promise<PaginationResult<Project>> {
        const where: Where<Project> = {
            ...filter.parentId == undefined ? {} : { parentId: filter.parentId },
            ...filter.search == undefined || filter.search === ''
                ? {}
                : { name: { iLike: `%${FilterUtilities.escapeLike(filter.search)}%` } },
            // a project below an archived one is archived with it, so this leaves out what is below as well
            ...filter.includeArchived === true ? {} : { archivedAt: null }
        };
        return await this.projectRepository.findAllPaginated(page, limit, { where, order: { name: 'ASC', id: 'ASC' } });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async createProject(project: NewProject): Promise<Project> {
        const parentId: string | null = project.parentId ?? null;
        if (parentId != undefined) {
            this.accessService.validateNotArchived((await this.accessService.resolveAccess(parentId)).project);
        }
        return await this.projectRepository.create({
            name: project.name,
            description: project.description ?? null,
            parentId,
            archivedAt: null
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async updateProject(projectId: string, change: ProjectChange): Promise<Project> {
        const access: ProjectAccess = await this.resolveWritable(projectId, 'editor');
        if (change.parentId != undefined) {
            // below an archived project it would be archived without having been
            this.accessService.validateNotArchived((await this.accessService.resolveAccess(change.parentId)).project);
        }
        const data: Partial<Pick<Project, 'name' | 'description' | 'parentId'>> = {
            ...change.name === undefined ? {} : { name: change.name },
            ...change.description === undefined ? {} : { description: change.description },
            ...change.parentId === undefined ? {} : { parentId: change.parentId }
        };
        if (!Object.keys(data).length) {
            return access.project;
        }
        // a parent that is the project itself or below it is refused by the sharing of Project with a 400
        const updated: Project = await this.projectRepository.updateById(projectId, data);
        await this.boardUpdateService.publish({ type: 'project-updated', projectId, project: updated });
        return updated;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async archiveProject(projectId: string): Promise<Project> {
        const access: ProjectAccess = await this.accessService.resolveAccess(projectId);
        if (access.project.archivedAt != undefined) {
            return access.project;
        }
        // the projects below are archived at the same moment rather than counted as archived by a walk up on every
        // read: a list leaves them out by their own column, and bringing the project back brings back exactly those
        const ids: string[] = await this.resolveTreeIds(projectId);
        const archived: Project[] = await this.projectRepository.updateAll(
            { id: { oneOf: ids }, archivedAt: null },
            { archivedAt: new Date() },
            { returnUpdated: true }
        );
        await this.publishUpdated(archived);
        return archived.find(p => p.id === projectId) ?? access.project;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async unarchiveProject(projectId: string): Promise<Project> {
        const access: ProjectAccess = await this.accessService.resolveAccess(projectId);
        const archivedAt: Date | null | undefined = access.project.archivedAt;
        if (archivedAt == undefined) {
            return access.project;
        }
        const parentId: string | null | undefined = access.project.parentId;
        const parent: Pick<Project, 'archivedAt'> | undefined = parentId == undefined
            ? undefined
            : await this.projectRepository.findById(parentId, { select: { archivedAt: true }, unscoped: true, required: false });
        if (parent?.archivedAt != undefined) {
            throw new ConflictError($ts`The project is below an archived project. Bring that one back first.`);
        }
        // a project below archived on its own before stays archived: it holds a moment of its own
        const restored: Project[] = await this.projectRepository.updateAll(
            { id: { oneOf: await this.resolveTreeIds(projectId) }, archivedAt },
            { archivedAt: null },
            { returnUpdated: true }
        );
        await this.publishUpdated(restored);
        return restored.find(p => p.id === projectId) ?? access.project;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async deleteProject(projectId: string): Promise<void> {
        await this.accessService.resolveAccess(projectId);
        const ids: string[] = await this.resolveTreeIds(projectId);
        // the projects below, the columns, tasks, labels and comments go along with it, and the shares of each
        await this.projectRepository.deleteById(projectId);
        await Promise.all(ids.map(async id => await this.boardUpdateService.publish({ type: 'project-deleted', projectId: id })));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveBoard(projectId: string): Promise<ProjectBoard> {
        const access: ProjectAccess = await this.accessService.resolveAccess(projectId);
        const [columns, labels, tasks] = await Promise.all([
            this.columnRepository.findAll({ where: { projectId }, order: { position: 'ASC', id: 'ASC' }, limit: 'all' }),
            this.labelRepository.findAll({ where: { projectId }, order: { name: 'ASC', id: 'ASC' }, limit: 'all' }),
            this.taskRepository.findAll({ where: { projectId }, order: { columnId: 'ASC', position: 'ASC', id: 'ASC' }, limit: 'all' })
        ]);
        const users: ProjectUser[] = await this.accessService.resolveUsers(tasks.flatMap(task => task.assigneeIds));
        return { project: access.project, columns, labels, tasks, users, access: { role: access.role, fullAccess: access.fullAccess } };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async createColumn(projectId: string, column: NewProjectColumn): Promise<ProjectColumn> {
        await this.resolveWritable(projectId, 'editor');
        const created: ProjectColumn = await ProjectPositionUtilities.withPlacementLease(`board:${projectId}`, async () => {
            const placement: PositionPlacement = await this.resolveColumnPlacement(projectId, undefined, column.afterColumnId);
            return await this.columnRepository.create({
                projectId,
                name: column.name,
                isDone: column.isDone ?? false,
                position: placement.position
            });
        });
        await this.boardUpdateService.publish({ type: 'column-created', projectId, column: created });
        return created;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async updateColumn(columnId: string, change: ProjectColumnChange): Promise<ProjectColumn> {
        const column: ProjectColumn = await this.columnRepository.findById(columnId);
        await this.resolveWritable(column.projectId, 'editor');
        const data: Partial<Pick<ProjectColumn, 'name' | 'isDone'>> = {
            ...change.name === undefined ? {} : { name: change.name },
            ...change.isDone === undefined ? {} : { isDone: change.isDone }
        };
        if (!Object.keys(data).length) {
            return column;
        }
        const updated: ProjectColumn = await this.columnRepository.updateById(columnId, data);
        await this.boardUpdateService.publish({ type: 'column-updated', projectId: column.projectId, column: updated });
        if (change.isDone != undefined && change.isDone !== column.isDone) {
            await this.updateDoneOfColumn(updated);
        }
        return updated;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async moveColumn(columnId: string, move: ProjectColumnMove): Promise<ProjectColumn> {
        const column: ProjectColumn = await this.columnRepository.findById(columnId);
        await this.resolveWritable(column.projectId, 'editor');
        const moved: ProjectColumn = await ProjectPositionUtilities.withPlacementLease(`board:${column.projectId}`, async () => {
            const placement: PositionPlacement = await this.resolveColumnPlacement(column.projectId, columnId, move.afterColumnId ?? null);
            return await this.columnRepository.updateById(columnId, { position: placement.position });
        });
        await this.boardUpdateService.publish({ type: 'column-updated', projectId: column.projectId, column: moved });
        return moved;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async deleteColumn(columnId: string): Promise<void> {
        const column: ProjectColumn = await this.columnRepository.findById(columnId);
        await this.resolveWritable(column.projectId, 'editor');
        if (await this.taskRepository.exists({ where: { columnId } })) {
            throw new ConflictError($ts`The column holds tasks. Move them to another column before deleting it.`);
        }
        await this.columnRepository.deleteById(columnId);
        await this.boardUpdateService.publish({ type: 'column-deleted', projectId: column.projectId, columnId });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async createLabel(projectId: string, label: NewTaskLabel): Promise<TaskLabel> {
        await this.resolveWritable(projectId, 'editor');
        const created: TaskLabel = await this.labelRepository.create({ projectId, name: label.name, color: label.color });
        await this.boardUpdateService.publish({ type: 'label-created', projectId, label: created });
        return created;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async updateLabel(labelId: string, change: TaskLabelChange): Promise<TaskLabel> {
        const label: TaskLabel = await this.labelRepository.findById(labelId);
        await this.resolveWritable(label.projectId, 'editor');
        const data: Partial<Pick<TaskLabel, 'name' | 'color'>> = {
            ...change.name === undefined ? {} : { name: change.name },
            ...change.color === undefined ? {} : { color: change.color }
        };
        if (!Object.keys(data).length) {
            return label;
        }
        const updated: TaskLabel = await this.labelRepository.updateById(labelId, data);
        await this.boardUpdateService.publish({ type: 'label-updated', projectId: label.projectId, label: updated });
        return updated;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async deleteLabel(labelId: string): Promise<void> {
        const label: TaskLabel = await this.labelRepository.findById(labelId);
        await this.resolveWritable(label.projectId, 'editor');
        const carrying: Task[] = await this.taskRepository.findAll({
            where: { projectId: label.projectId, labelIds: { includes: [labelId] } },
            limit: 'all'
        });
        // each task carries labels of its own, so each is written on its own, in one transaction with the delete
        const updated: Task[] = await this.labelRepository.dataSource.runInTransaction(async (transaction: Transaction) => {
            const res: Task[] = await Promise.all(carrying.map(async task => await this.taskRepository.updateById(
                task.id,
                { labelIds: task.labelIds.filter(id => id !== labelId) },
                { transaction }
            )));
            await this.labelRepository.deleteById(labelId, { transaction });
            return res;
        }, { maxAttempts: 3 });
        await this.boardUpdateService.publish({ type: 'label-deleted', projectId: label.projectId, labelId });
        await Promise.all(updated.map(
            async task => await this.boardUpdateService.publish({ type: 'task-updated', projectId: task.projectId, task })
        ));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findShares(projectId: string): Promise<ProjectShare[]> {
        const access: ProjectAccess = await this.accessService.resolveAccess(projectId);
        return await this.toProjectShares(await this.shareService.findShares(Project, access.project.id));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async share(projectId: string, userId: string, role: ProjectRole): Promise<ProjectShare> {
        const access: ProjectAccess = await this.accessService.resolveAccess(projectId);
        return await this.toProjectShare(await this.shareService.share(Project, access.project.id, userId, role, undefined));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async shareByEmail(caller: CurrentUser, projectId: string, share: NewProjectShare): Promise<ProjectShareResult> {
        const access: ProjectAccess = await this.accessService.resolveAccess(projectId);
        const res: ShareByEmailResult<BaseInvitation> = await this.shareService.shareByEmail<BaseInvitation>(
            caller,
            Project,
            access.project.id,
            share.email,
            share.role,
            {
                ...this.options.invitationColumns({ email: share.email, name: share.name }),
                roles: this.options.guestRoles,
                // a guest gets an account once they agree to, and may say no
                createOn: 'accept',
                declinable: true,
                expiresInMs: this.options.invitationExpiresInMs,
                withoutPassword: share.withoutPassword ?? false
            },
            undefined
        );
        return res.share == undefined
            ? { share: null, invitationId: res.invitation.id }
            : { share: await this.toProjectShare(res.share), invitationId: null };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async unshare(projectId: string, userId: string): Promise<void> {
        const access: ProjectAccess = await this.accessService.resolveAccess(projectId);
        await this.shareService.unshare(Project, access.project.id, userId, undefined);
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
     * Resolves where a column goes on the board of a project, and writes the other columns spread out again when
     * their positions ran out of precision.
     * @param projectId - The project.
     * @param columnId - The column moved, left out of the others, or undefined for a new one.
     * @param afterColumnId - The column to put it after, null for first, undefined for last.
     * @returns Where it goes.
     * @throws A BadRequestError for a column to put it after that is not on the board.
     */
    private async resolveColumnPlacement(
        projectId: string,
        columnId: string | undefined,
        afterColumnId: string | null | undefined
    ): Promise<PositionPlacement> {
        const others: PositionedRow[] = await this.columnRepository.findAll({
            where: columnId == undefined ? { projectId } : { projectId, id: { notOneOf: [columnId] } },
            select: { id: true, position: true },
            order: { position: 'ASC', id: 'ASC' },
            limit: 'all'
        });
        const placement: PositionPlacement | undefined = ProjectPositionUtilities.resolvePlacement(others, afterColumnId);
        if (placement == undefined) {
            throw new BadRequestError($ts`The column to put it after needs to be another column of the same board.`);
        }
        await Promise.all(placement.respread.map(async row => await this.columnRepository.updateById(row.id, { position: row.position })));
        return placement;
    }

    /**
     * Marks the tasks of a column done when its tasks are done, and no longer done when they are not.
     * @param column - The column, as it is now.
     */
    private async updateDoneOfColumn(column: ProjectColumn): Promise<void> {
        const changed: Task[] = await this.taskRepository.updateAll(
            column.isDone ? { columnId: column.id, doneAt: null } : { columnId: column.id, doneAt: { notOneOf: [null] } },
            { doneAt: column.isDone ? new Date() : null },
            { returnUpdated: true }
        );
        await Promise.all(changed.map(
            async task => await this.boardUpdateService.publish({ type: 'task-updated', projectId: task.projectId, task })
        ));
        if (column.isDone) {
            await ProjectEventUtilities.emit(this.options.eventNames.taskDone, changed);
        }
    }

    /**
     * Resolves the ids of a project and of every project below it, one read per level.
     * @param projectId - The id of the project.
     * @returns The ids, the project first.
     */
    private async resolveTreeIds(projectId: string): Promise<string[]> {
        const res: string[] = [projectId];
        // a project is refused as the parent of one below it, so the levels end; a project seen already ends them
        // for rows stored in a circle before that was refused
        for (let level: string[] = [projectId]; level.length;) {
            const below: Pick<Project, 'id'>[] = await this.projectRepository.findAll({
                where: { parentId: { oneOf: level } },
                select: { id: true },
                limit: 'all'
            });
            level = below.map(p => p.id).filter(id => !res.includes(id));
            res.push(...level);
        }
        return res;
    }

    /**
     * Tells the subscribers of the boards of projects that the projects changed.
     * @param projects - The projects, as they are now.
     */
    private async publishUpdated(projects: Project[]): Promise<void> {
        await Promise.all(projects.map(
            async project => await this.boardUpdateService.publish({ type: 'project-updated', projectId: project.id, project })
        ));
    }

    /**
     * Turns a share of a project into the share the routes answer, with its user.
     * @param share - The share.
     * @returns The share.
     */
    private async toProjectShare(share: RowShare): Promise<ProjectShare> {
        const [res] = await this.toProjectShares([share]);
        if (res == undefined) {
            throw new InternalError(`The share ${share.id} was turned into none.`);
        }
        return res;
    }

    /**
     * Turns shares of projects into the shares the routes answer, with their users.
     * @param shares - The shares.
     * @returns The shares, in the same order.
     */
    private async toProjectShares(shares: RowShare[]): Promise<ProjectShare[]> {
        const users: ProjectUser[] = await this.accessService.resolveUsers(shares.map(share => share.userId));
        return shares.map(share => {
            // one of the roles Project declares, which the share service refuses any other than
            const role: ProjectRole | undefined = PROJECT_ROLES.find(r => r === share.role);
            if (role == undefined) {
                throw new InternalError(
                    `The share ${share.id} of a Project is in the role '${share.role}', which Project does not declare.`
                );
            }
            return {
                id: share.id,
                userId: share.userId,
                role,
                sharedBy: share.sharedBy ?? null,
                sharedAt: share.sharedAt,
                user: users.find(user => user.id === share.userId) ?? { id: share.userId, name: share.userId }
            };
        });
    }
}