import { type ProjectRole } from './project-role.model';

/**
 * What the caller of a request may do on a project, as the board and `GET /projects/:projectId` answer it.
 */
export type ProjectCallerAccessModel = {
    /**
     * Their role on it: the highest of the role their permissions give, `viewer` with `projects.read` and `editor`
     * with `projects.write` beside it, and the roles it and the projects above it are shared with them in. An archived
     * project is only read, whatever the role.
     */
    role: ProjectRole,
    /**
     * Whether they see every project of the tenant, through `projects.read`, rather than the projects shared with them
     * and the projects below those.
     */
    fullAccess: boolean
};