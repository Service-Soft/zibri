import { type ProjectRole } from './project-role.model';
import { type ProjectUserModel } from './project-user.model';

/**
 * A project shared with a user, as `GET /projects/:projectId/shares` answers it.
 */
export type ProjectShareModel = {
    /**
     * The id of the share.
     */
    id: string,
    /**
     * The id of the user it is shared with.
     */
    userId: string,
    /**
     * The role it is shared in.
     */
    role: ProjectRole,
    /**
     * The id of the user who shared it, or null.
     */
    sharedBy?: string | null,
    /**
     * When it was shared, or its role last changed.
     */
    sharedAt: string,
    /**
     * The user it is shared with.
     */
    user: ProjectUserModel
};
