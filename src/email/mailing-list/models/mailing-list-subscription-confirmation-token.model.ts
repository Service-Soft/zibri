import { BaseEntity, Entity, OmitClass, Property } from '../../../entity';

/**
 * A short lived token used to confirm a mailing list subscription.
 */
@Entity()
export class MailingListSubscriptionConfirmationToken extends BaseEntity {
    /**
     * The expiration date of the confirmation token.
     */
    @Property.date()
    expirationDate!: Date;

    /**
     * The actual token value.
     */
    @Property.string()
    value!: string;

    /**
     * The email of the new subscriber that this token belongs to.
     */
    @Property.string({ format: 'email' })
    email!: string;

    /**
     * The optional name of the new subscriber that this token belongs to.
     */
    @Property.string({ required: false })
    name?: string;

    /**
     * The id of the mailing list that this token belongs to.
     */
    @Property.string({ format: 'uuid' })
    listId!: string;
}

/**
 * The data to create a new mailing list subscription confirmation token.
 */
export class MailingListSubscriptionConfirmationTokenCreateData extends OmitClass(MailingListSubscriptionConfirmationToken, ['id']) {}