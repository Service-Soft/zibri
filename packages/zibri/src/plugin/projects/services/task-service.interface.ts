import { type PaginationResult } from '../../../data-source/models/pagination-result.model';
import { type NewTaskComment } from '../models/new-task-comment.model';
import { type NewTask } from '../models/new-task.model';
import { type TaskChange } from '../models/task-change.model';
import { type TaskCommentPage } from '../models/task-comment-page.model';
import { type TaskComment } from '../models/task-comment.model';
import { type TaskFilter } from '../models/task-filter.model';
import { type TaskMove } from '../models/task-move.model';
import { type Task } from '../models/task.model';

/**
 * Interface for the service of the tasks of the projects of the active tenant and their comments. Every method acts as
 * the caller of the request, on the projects they see, and checks the role it needs: a viewer reads, a commenter also
 * comments, and an editor also writes the tasks. Nothing of an archived project is written.
 */
export interface TaskServiceInterface {
    /**
     * Finds a page of the tasks of the projects the caller sees, the soonest due first.
     * @param page - The page, counting from 1.
     * @param limit - How many tasks a page holds.
     * @param filter - Which tasks.
     * @returns The page.
     */
    findTasks: (page: number, limit: number, filter: TaskFilter) => Promise<PaginationResult<Task>>,
    /**
     * Finds a task, with its change sets and their changes.
     * @param taskId - The id of the task.
     * @returns The task.
     */
    findTask: (taskId: string) => Promise<Task>,
    /**
     * Creates a task in a column of a project.
     * @param projectId - The id of the project.
     * @param task - The task.
     * @returns The task.
     */
    createTask: (projectId: string, task: NewTask) => Promise<Task>,
    /**
     * Changes a task.
     * @param taskId - The id of the task.
     * @param change - What changes.
     * @returns The task.
     */
    updateTask: (taskId: string, change: TaskChange) => Promise<Task>,
    /**
     * Moves a task into a column of its project, after a task of that column or first. Writes the task alone, unless
     * the positions of the column ran out of precision, which spreads them out again.
     * @param taskId - The id of the task.
     * @param move - Where to.
     * @returns The task.
     */
    moveTask: (taskId: string, move: TaskMove) => Promise<Task>,
    /**
     * Deletes a task with its comments. The tasks that are a part of it are a part of nothing from then on.
     * @param taskId - The id of the task.
     */
    deleteTask: (taskId: string) => Promise<void>,
    /**
     * Finds a page of the comments on a task, the oldest first, with their authors.
     * @param taskId - The id of the task.
     * @param page - The page, counting from 1.
     * @param limit - How many comments a page holds.
     * @returns The page.
     */
    findComments: (taskId: string, page: number, limit: number) => Promise<TaskCommentPage>,
    /**
     * Writes a comment on a task, as the caller.
     * @param taskId - The id of the task.
     * @param comment - The comment.
     * @returns The comment.
     */
    createComment: (taskId: string, comment: NewTaskComment) => Promise<TaskComment>,
    /**
     * Changes the text of a comment of the caller's own.
     * @param commentId - The id of the comment.
     * @param comment - The new text.
     * @returns The comment.
     */
    updateComment: (commentId: string, comment: NewTaskComment) => Promise<TaskComment>,
    /**
     * Deletes a comment: one of the caller's own, or any as an editor.
     * @param commentId - The id of the comment.
     */
    deleteComment: (commentId: string) => Promise<void>
}