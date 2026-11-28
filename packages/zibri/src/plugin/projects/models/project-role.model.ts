import { type ProjectRole } from 'zibri-contract';

// from zibri-contract, so that a frontend shows and hides what a role allows by the same roles
// eslint-disable-next-line jsdoc/require-jsdoc
export { PROJECT_ROLES, type ProjectRole } from 'zibri-contract';

/**
 * The roles of `PROJECT_ROLES` by themselves, as the `enum` of a property takes them.
 */
export const PROJECT_ROLE_VALUES: Record<ProjectRole, ProjectRole> = { viewer: 'viewer', commenter: 'commenter', editor: 'editor' };