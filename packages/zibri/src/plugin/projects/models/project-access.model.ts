import { type ProjectRole } from './project-role.model';
import { type Project } from './project.model';

/**
 * What the caller of a request may do on a project, as `resolveAccess` of the project access service answers it.
 */
export type ProjectAccess = {
    /**
     * The project, which the caller sees.
     */
    project: Project,
    /**
     * Their role on it: the highest of the role their permissions give, `viewer` with `projects.read` and `editor`
     * with `projects.write` beside it, and the roles it and the projects above it are shared with them in.
     */
    role: ProjectRole,
    /**
     * Whether they see every project of the tenant, which is what shows them the email addresses of other users.
     */
    fullAccess: boolean
};
