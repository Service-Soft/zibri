/**
 * Who accepts an invitation, and with what.
 */
export type InvitationAcceptance = {
    /**
     * The password of the account the invitation creates, for an email without an account of its own.
     */
    password: string | undefined,
    /**
     * The id of the user the request is logged in as, if any. An email with an account of its own is accepted by
     * that account only.
     */
    loggedInUserId: string | undefined
};