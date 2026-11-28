/**
 * Another user as a caller who sees only what is shared with them reads them: by name, never by email address.
 */
export type SharedUserModel = {
    /**
     * The id of the user.
     */
    id: string,
    /**
     * The name the application shows for them.
     */
    name: string
};
