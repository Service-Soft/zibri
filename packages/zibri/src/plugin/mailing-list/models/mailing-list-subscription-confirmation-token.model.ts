import type { HashString } from '../../../auth/hash/hash.utilities';
import { Sha256HashStrategy } from '../../../auth/hash/strategies/sha256.hash-strategy';
import { BaseEntity } from '../../../entity/base-entity.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { OmitClass } from '../../../entity/omit-class.model';

/**
 * A short lived token used to confirm a mailing list subscription.
 *
 * Spent once, by the confirmation it was mailed out for.
 */
@Entity({ allowOrphan: true })
export class MailingListSubscriptionConfirmationToken extends BaseEntity {
    /**
     * The tenant of the mailing list the token confirms a subscription to.
     */
    @Property.string({ format: 'uuid' })
    tenantId!: string;

    /**
     * The expiration date of the confirmation token.
     */
    @Property.date()
    expirationDate!: Date;

    /**
     * The actual token value.
     *
     * Stored hashed, and findable because the strategy is deterministic - the token arrives on its
     * own, with nothing else in the link to find the row by. A database read therefore yields
     * nothing that can be presented back to the api.
     */
    @Property.string({ hash: { strategy: Sha256HashStrategy } })
    value!: HashString;

    /**
     * Whether the token has confirmed its subscription. A spent token subscribes no one again.
     */
    @Property.boolean()
    spent!: boolean;

    /**
     * The email of the new subscriber that this token belongs to.
     */
    @Property.string({ format: 'email' })
    email!: string;

    /**
     * The optional name of the new subscriber that this token belongs to.
     */
    @Property.string({ required: false })
    name?: string | null;

    /**
     * The id of the mailing list that this token belongs to.
     */
    @Property.string({ format: 'uuid' })
    listId!: string;
}

/**
 * The data to create a new mailing list subscription confirmation token, in the active tenant.
 */
export class MailingListSubscriptionConfirmationTokenCreateData extends OmitClass(
    MailingListSubscriptionConfirmationToken,
    ['id', 'tenantId', 'value']
) {
    /**
     * The token as it is generated and mailed out, before the hook hashes it.
     */
    @Property.string({ hash: { strategy: Sha256HashStrategy } })
    value!: string;
}