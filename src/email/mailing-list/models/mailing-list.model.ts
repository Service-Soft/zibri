import { MailingListSubscriber } from './mailing-list-subscriber.model';
import { BaseEntity, Entity, Property } from '../../../entity';

/**
 * A mailing list like a newsletter that people can easily subscribe and unsubscribe to.
 */
@Entity()
export class MailingList extends BaseEntity {
    /**
     * The name of the mailing list.
     */
    @Property.string({ unique: true })
    name!: string;

    /**
     * The subscribers of the mailing list.
     */
    @Property.manyToMany({ target: () => MailingListSubscriber, inverseSide: 'mailingLists', joinTable: true })
    subscribers!: MailingListSubscriber[];
}