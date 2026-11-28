import { type ProjectCallerAccessModel } from './project-caller-access.model';
import { type ProjectColumnModel } from './project-column.model';
import { type ProjectUserModel } from './project-user.model';
import { type ProjectModel } from './project.model';
import { type TaskLabelModel } from './task-label.model';
import { type TaskModel } from './task.model';

/**
 * The board of a project, as `GET /projects/:projectId/board` answers it: the project, its columns, labels and
 * tasks, the users the tasks are assigned to, and what the caller may do on the project.
 */
export type ProjectBoardModel = {
    /**
     * The project.
     */
    project: ProjectModel,
    /**
     * The columns of its board, in their order.
     */
    columns: ProjectColumnModel[],
    /**
     * The labels of the project, by name.
     */
    labels: TaskLabelModel[],
    /**
     * Its tasks, by column and position.
     */
    tasks: TaskModel[],
    /**
     * The users the tasks are assigned to.
     */
    users: ProjectUserModel[],
    /**
     * What the caller may do on the project, as it was when the board was read.
     */
    access: ProjectCallerAccessModel
};