import { type ProjectRole } from './project-role.model';

/**
 * Whom to share a project with by email, as `POST /projects/:projectId/shares` takes it: a member of the tenant at
 * once, anybody else by an invitation into the tenant as a guest.
 */
export type NewProjectShareModel = {
    /**
     * The email address to share it with.
     */
    email: string,
    /**
     * Who is invited, as the person sharing writes their name.
     */
    name: string,
    /**
     * The role to share it in.
     */
    role: ProjectRole,
    /**
     * Whether the account the invitation creates gets no password, and logs in with a link sent by email. False by
     * default.
     */
    withoutPassword?: boolean
};
