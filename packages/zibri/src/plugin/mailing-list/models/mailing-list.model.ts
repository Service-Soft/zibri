import { MailingListSubscriber } from './mailing-list-subscriber.model.ts';
import { BaseEntity } from '../../../entity/base-entity.model.ts';
import { Entity } from '../../../entity/decorators/entity.decorator.ts';
import { Property } from '../../../entity/decorators/property.decorator.ts';

/**
 * A mailing list like a newsletter that people can easily subscribe and unsubscribe to.
 */
@Entity({ allowOrphan: true })
export class MailingList extends BaseEntity {
    /**
     * The tenant the mailing list belongs to.
     */
    @Property.string({ format: 'uuid' })
    tenantId!: string;

    /**
     * The name of the mailing list, unique among the lists of its tenant.
     */
    @Property.string({ unique: true })
    name!: string;

    /**
     * The subscribers of the mailing list.
     */
    @Property.manyToMany({ target: () => MailingListSubscriber, inverseSide: 'mailingLists', joinTable: true })
    subscribers!: MailingListSubscriber[];
}