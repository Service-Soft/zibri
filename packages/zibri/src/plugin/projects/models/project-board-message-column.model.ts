import { type ProjectColumn } from './project-column.model';

/**
 * A column as a `ProjectBoardMessage` carries it, without its relations.
 */
export type ProjectBoardMessageColumn = Omit<ProjectColumn, 'project' | 'tasks'>;