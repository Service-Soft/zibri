/**
 * Who a project is shared with by an invitation, as `invitationColumns` of the projects plugin options is handed them.
 */
export type ProjectInvitee = {
    /**
     * The email address invited.
     */
    email: string,
    /**
     * Their name, as the person sharing wrote it.
     */
    name: string
};