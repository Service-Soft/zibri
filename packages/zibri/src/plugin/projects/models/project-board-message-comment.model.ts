import { type TaskComment } from './task-comment.model';

/**
 * A comment as a `ProjectBoardMessage` carries it, without its relation.
 */
export type ProjectBoardMessageComment = Omit<TaskComment, 'task'>;