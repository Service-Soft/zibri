import { type CurrentUser } from '../../../auth/decorators/current-user.decorator';
import { type PaginationResult } from '../../../data-source/models/pagination-result.model';
import { type NewProjectColumn } from '../models/new-project-column.model';
import { type NewProjectShare } from '../models/new-project-share.model';
import { type NewProject } from '../models/new-project.model';
import { type NewTaskLabel } from '../models/new-task-label.model';
import { type ProjectBoard } from '../models/project-board.model';
import { type ProjectChange } from '../models/project-change.model';
import { type ProjectColumnChange } from '../models/project-column-change.model';
import { type ProjectColumnMove } from '../models/project-column-move.model';
import { type ProjectColumn } from '../models/project-column.model';
import { type ProjectFilter } from '../models/project-filter.model';
import { type ProjectRole } from '../models/project-role.model';
import { type ProjectShareResult } from '../models/project-share-result.model';
import { type ProjectShare } from '../models/project-share.model';
import { type Project } from '../models/project.model';
import { type TaskLabelChange } from '../models/task-label-change.model';
import { type TaskLabel } from '../models/task-label.model';

/**
 * Interface for the service of the projects of the active tenant, their boards' columns and labels, and their shares.
 * Every method acts as the caller of the request, on the projects they see, and checks the role it needs: an editor
 * writes columns and labels, and the projects themselves are written by those with the permissions of the routes.
 */
export interface ProjectServiceInterface {
    /**
     * Finds a page of the projects the caller sees, by name.
     * @param page - The page, counting from 1.
     * @param limit - How many projects a page holds.
     * @param filter - Which projects.
     * @returns The page.
     */
    findProjects: (page: number, limit: number, filter: ProjectFilter) => Promise<PaginationResult<Project>>,
    /**
     * Creates a project, below a project that is not archived when it names one.
     * @param project - The project.
     * @returns The project.
     */
    createProject: (project: NewProject) => Promise<Project>,
    /**
     * Changes a project that is not archived. A parent that is the project itself or below it is refused.
     * @param projectId - The id of the project.
     * @param change - What changes.
     * @returns The project.
     */
    updateProject: (projectId: string, change: ProjectChange) => Promise<Project>,
    /**
     * Archives a project, and the projects below it that are not archived yet, at the same moment.
     * @param projectId - The id of the project.
     * @returns The project.
     */
    archiveProject: (projectId: string) => Promise<Project>,
    /**
     * Brings back an archived project below no archived project, and the projects below it archived with it.
     * @param projectId - The id of the project.
     * @returns The project.
     */
    unarchiveProject: (projectId: string) => Promise<Project>,
    /**
     * Deletes a project with the projects below it, their boards and comments, and their shares.
     * @param projectId - The id of the project.
     */
    deleteProject: (projectId: string) => Promise<void>,
    /**
     * Resolves the board of a project: its columns, labels and tasks, and the users the tasks are assigned to.
     * @param projectId - The id of the project.
     * @returns The board.
     */
    resolveBoard: (projectId: string) => Promise<ProjectBoard>,
    /**
     * Adds a column to the board of a project.
     * @param projectId - The id of the project.
     * @param column - The column.
     * @returns The column.
     */
    createColumn: (projectId: string, column: NewProjectColumn) => Promise<ProjectColumn>,
    /**
     * Changes a column. A column that becomes one of done tasks marks its tasks done, and one that stops being one
     * marks them no longer done.
     * @param columnId - The id of the column.
     * @param change - What changes.
     * @returns The column.
     */
    updateColumn: (columnId: string, change: ProjectColumnChange) => Promise<ProjectColumn>,
    /**
     * Moves a column on its board.
     * @param columnId - The id of the column.
     * @param move - Where to.
     * @returns The column.
     */
    moveColumn: (columnId: string, move: ProjectColumnMove) => Promise<ProjectColumn>,
    /**
     * Deletes a column that holds no task.
     * @param columnId - The id of the column.
     */
    deleteColumn: (columnId: string) => Promise<void>,
    /**
     * Adds a label to a project.
     * @param projectId - The id of the project.
     * @param label - The label.
     * @returns The label.
     */
    createLabel: (projectId: string, label: NewTaskLabel) => Promise<TaskLabel>,
    /**
     * Changes a label.
     * @param labelId - The id of the label.
     * @param change - What changes.
     * @returns The label.
     */
    updateLabel: (labelId: string, change: TaskLabelChange) => Promise<TaskLabel>,
    /**
     * Deletes a label, and takes it off every task carrying it.
     * @param labelId - The id of the label.
     */
    deleteLabel: (labelId: string) => Promise<void>,
    /**
     * Finds the shares of a project itself, without those of the projects above it.
     * @param projectId - The id of the project.
     * @returns The shares, with the users they are of.
     */
    findShares: (projectId: string) => Promise<ProjectShare[]>,
    /**
     * Shares a project with a member of the tenant, or changes the role it is shared with them in.
     * @param projectId - The id of the project.
     * @param userId - The id of the member.
     * @param role - The role.
     * @returns The share.
     */
    share: (projectId: string, userId: string, role: ProjectRole) => Promise<ProjectShare>,
    /**
     * Shares a project by email: with the member of the tenant the email belongs to, or by an invitation into the
     * tenant with the guest roles of the options, which creates the share once it is accepted.
     * @param caller - Who shares, who needs to be allowed to hand out the guest roles.
     * @param projectId - The id of the project.
     * @param share - Whom to share it with.
     * @returns The share, or the id of the invitation.
     */
    shareByEmail: (caller: CurrentUser, projectId: string, share: NewProjectShare) => Promise<ProjectShareResult>,
    /**
     * Stops sharing a project with a user. They see nothing of it from their next request on, unless a project above
     * it is shared with them.
     * @param projectId - The id of the project.
     * @param userId - The id of the user.
     */
    unshare: (projectId: string, userId: string) => Promise<void>
}