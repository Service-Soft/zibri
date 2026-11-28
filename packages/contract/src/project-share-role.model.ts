import { type ProjectRole } from './project-role.model';

/**
 * The role to share a project with a member of the tenant in, as `PUT /projects/:projectId/shares/:userId` takes it.
 */
export type ProjectShareRoleModel = {
    /**
     * The role.
     */
    role: ProjectRole
};
