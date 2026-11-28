import { Property } from '../../../entity/decorators/property.decorator';
import { ProjectUser } from './project-user.model';
import { TaskComment } from './task-comment.model';

/**
 * A page of the comments on a task, the oldest first, with their authors, as `GET /tasks/:taskId/comments` of the
 * `ProjectsController` and `findComments` of the task service answer it.
 */
export class TaskCommentPage {
    /**
     * The comments of the page.
     */
    @Property.array({ items: { type: 'object', cls: () => TaskComment } })
    items!: TaskComment[];

    /**
     * How many comments the task has.
     */
    @Property.number({ format: 'integer' })
    totalAmount!: number;

    /**
     * The authors of the comments of the page.
     */
    @Property.array({ items: { type: 'object', cls: () => ProjectUser } })
    users!: ProjectUser[];
}