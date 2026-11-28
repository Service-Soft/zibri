import { type Project } from './project.model';

/**
 * A project as a `ProjectBoardMessage` carries it, without its relations.
 */
export type ProjectBoardMessageProject = Omit<Project, 'parent' | 'children' | 'columns' | 'tasks' | 'labels' | 'recurringTasks'>;