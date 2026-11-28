import { Property } from '../../../entity/decorators/property.decorator';
import { ProjectCallerAccess } from './project-caller-access.model';
import { ProjectColumn } from './project-column.model';
import { ProjectUser } from './project-user.model';
import { Project } from './project.model';
import { TaskLabel } from './task-label.model';
import { Task } from './task.model';

/**
 * The board of a project, as `GET /:projectId/board` of the `ProjectsController` and `resolveBoard` of the project
 * service answer it: the project, its columns, labels and tasks, the users the tasks are assigned to, and what the
 * caller may do on the project.
 */
export class ProjectBoard {
    /**
     * The project.
     */
    @Property.object({ cls: () => Project })
    project!: Project;

    /**
     * The columns of its board, in their order.
     */
    @Property.array({ items: { type: 'object', cls: () => ProjectColumn } })
    columns!: ProjectColumn[];

    /**
     * The labels of the project, by name.
     */
    @Property.array({ items: { type: 'object', cls: () => TaskLabel } })
    labels!: TaskLabel[];

    /**
     * Its tasks, by column and position.
     */
    @Property.array({ items: { type: 'object', cls: () => Task } })
    tasks!: Task[];

    /**
     * The users the tasks are assigned to.
     */
    @Property.array({ items: { type: 'object', cls: () => ProjectUser } })
    users!: ProjectUser[];

    /**
     * What the caller may do on the project, as it was when the board was read.
     */
    @Property.object({ cls: () => ProjectCallerAccess })
    access!: ProjectCallerAccess;
}