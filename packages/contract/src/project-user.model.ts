/**
 * A user as the routes of the projects plugin show them, such as an assignee or the author of a comment: by name, and
 * by email address only to a caller who sees every project of the tenant. To any other caller it is the
 * `SharedUserModel` it extends.
 */
export type ProjectUserModel = {
    /**
     * The id of the user.
     */
    id: string,
    /**
     * The name the application shows for them.
     */
    name: string,
    /**
     * Their email address, for a caller who sees every project of the tenant alone.
     */
    email?: string
};