import { Property } from '../../entity/decorators/property.decorator';

/**
 * What accepting an invitation is sent with.
 */
export class AcceptInvitationInput {
    /**
     * The token from the link.
     */
    @Property.string()
    token!: string;

    /**
     * The password of the account the invitation creates. Only for an email without an account of its own, which
     * `requiresLogin` of `InvitationTokenValidity` tells apart.
     */
    @Property.string({ required: false })
    password?: string;
}