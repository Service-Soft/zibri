import { type TaskLabel } from './task-label.model';

/**
 * A label as a `ProjectBoardMessage` carries it, without its relation.
 */
export type ProjectBoardMessageLabel = Omit<TaskLabel, 'project'>;