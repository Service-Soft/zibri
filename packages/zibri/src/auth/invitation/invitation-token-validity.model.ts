import { Property } from '../../entity/decorators/property.decorator';

/**
 * Whether the link of an invitation still works, and what accepting it takes.
 */
export class InvitationTokenValidity {
    /**
     * True when its token is known, has not expired, and the invitation has not ended.
     */
    @Property.boolean()
    isValid!: boolean;

    /**
     * True when the link had expired and a new one was mailed to the invited address.
     */
    @Property.boolean()
    renewed!: boolean;

    /**
     * The invited email, for a link that works.
     */
    @Property.string({ format: 'email', required: false })
    email?: string;

    /**
     * The tenant the invitation is to, for a link that works and an invitation to a tenant.
     */
    @Property.string({ format: 'uuid', required: false })
    tenantId?: string;

    /**
     * Whether accepting needs a login as the account of the email, which existed before the invitation. When
     * false, accepting takes the password of the account instead. False for a link that does not work.
     */
    @Property.boolean()
    requiresLogin!: boolean;

    /**
     * Whether the invited person may decline it. False for a link that does not work.
     */
    @Property.boolean()
    declinable!: boolean;
}