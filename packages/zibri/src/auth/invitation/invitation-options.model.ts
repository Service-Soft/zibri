import { InvitationEmailTemplate } from './invitation-email-template.model';

/**
 * How invitations are sent, as `ZIBRI_DI_TOKENS.INVITATION_OPTIONS` takes it. Required once the application lists an
 * invitation repository.
 */
export type InvitationOptions = {
    /**
     * Where the link of an invitation points, followed by its token, such as `https://app.example.com/invitation`.
     * The tenant of an invitation to one is put in by `resolveTenantUrl` of the `TenantService`.
     */
    acceptInvitationUrl: string,
    /**
     * The email an invitation is sent in.
     */
    invitationEmail: InvitationEmailTemplate,
    /**
     * How long the link of an invitation works. The invitation itself lasts until it is answered, revoked or its
     * own `expiresAt` has passed.
     */
    tokenExpiresInMs: number,
    /**
     * What following a link that stopped working does: `'renew'` mails a new link to the invited address, once
     * for each link, `'refuse'` refuses it, and the invitation waits to be sent again.
     */
    onExpiredToken: 'renew' | 'refuse'
};