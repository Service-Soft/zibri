import { type ProjectUserModel } from './project-user.model';
import { type TaskCommentModel } from './task-comment.model';

/**
 * A page of the comments on a task, the oldest first, with their authors, as `GET /projects/tasks/:taskId/comments`
 * answers it.
 */
export type TaskCommentPageModel = {
    /**
     * The comments of the page.
     */
    items: TaskCommentModel[],
    /**
     * How many comments the task has.
     */
    totalAmount: number,
    /**
     * The authors of the comments of the page.
     */
    users: ProjectUserModel[]
};