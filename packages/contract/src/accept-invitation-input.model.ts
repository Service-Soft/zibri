/**
 * What `POST /accept-invitation` takes.
 */
export type AcceptInvitationInput = {
    /**
     * The token from the link.
     */
    token: string,
    /**
     * The password of the account the invitation creates, when `requiresLogin` of the token's validity is false.
     */
    password?: string
};