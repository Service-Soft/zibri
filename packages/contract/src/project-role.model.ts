/**
 * The roles a project is shared in, from the least to the most: a viewer reads the project, its board and its
 * comments, a commenter also comments, and an editor also writes the tasks, columns and labels.
 */
// eslint-disable-next-line typescript/typedef
export const PROJECT_ROLES = ['viewer', 'commenter', 'editor'] as const;

/**
 * One of {@link PROJECT_ROLES}.
 */
export type ProjectRole = typeof PROJECT_ROLES[number];
