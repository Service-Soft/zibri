import { MailingList } from './mailing-list.model';
import { Entity, Property } from '../../../entity';
import { BaseEntity } from '../../../entity/base-entity.model';

/**
 * Defines a subscriber to a single or multiple mailing lists.
 */
@Entity()
export class MailingListSubscriber extends BaseEntity {
    /**
     * The optional name of the subscriber.
     */
    @Property.string({ required: false })
    name?: string;

    /**
     * The email of the subscriber.
     */
    @Property.string({ format: 'email' })
    email!: string;

    /**
     * The mailing lists that the subscriber is subscribed to.
     */
    @Property.manyToMany({ target: () => MailingList, inverseSide: 'subscribers', joinTable: false })
    mailingLists!: MailingList[];
}