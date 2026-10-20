import { randomBytes } from 'node:crypto';

import { MailingList } from './mailing-list.model.ts';
import { BaseEntity } from '../../../entity/base-entity.model.ts';
import { Entity } from '../../../entity/decorators/entity.decorator.ts';
import { Property } from '../../../entity/decorators/property.decorator.ts';

/**
 * Defines a subscriber to a single or multiple mailing lists.
 */
@Entity({ allowOrphan: true })
export class MailingListSubscriber extends BaseEntity {
    /**
     * The tenant whose mailing lists the subscriber is subscribed to.
     */
    @Property.string({ format: 'uuid' })
    tenantId!: string;

    /**
     * The optional name of the subscriber.
     */
    @Property.string({ required: false })
    name?: string | null;

    /**
     * The email of the subscriber.
     */
    @Property.string({ format: 'email' })
    email!: string;

    /**
     * What the links in the subscriber's emails carry along with their id, to unsubscribe and to
     * manage their preferences with. Generated when the subscriber is created, and stored encrypted.
     *
     * The id alone opens nothing: it is in every response that names the subscriber, and never
     * changes. Writing a new secret ends every link sent before.
     */
    @Property.string({ encryption: true, default: () => randomBytes(32).toString('hex') })
    secret!: string;

    /**
     * The mailing lists that the subscriber is subscribed to.
     */
    @Property.manyToMany({ target: () => MailingList, inverseSide: 'subscribers', joinTable: false })
    mailingLists!: MailingList[];
}