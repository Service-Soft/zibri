import { type Task } from './task.model';

/**
 * A task as a `ProjectBoardMessage` carries it, without its relations and change sets.
 */
export type ProjectBoardMessageTask = Omit<Task, 'project' | 'column' | 'comments' | 'changeSets'>;