import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { OmitClass } from '../../entity/omit-class.model';
import type { HashString } from '../hash/hash.utilities';
import { Sha256HashStrategy } from '../hash/strategies/sha256.hash-strategy';

/**
 * A login whose credentials were accepted and that waits for its second factor.
 *
 * Spent once, by the login it completes.
 */
@Entity({ tenant: 'shared', allowOrphan: true })
export class LoginTicket extends BaseEntity {
    /**
     * The ticket.
     */
    @Property.string({ hash: { strategy: Sha256HashStrategy } })
    value!: HashString;

    /**
     * The user whose credentials were accepted.
     */
    @Property.string({ format: 'uuid' })
    userId!: string;

    /**
     * The account the credentials named, as the trail records it. Null for credentials that name none.
     */
    @Property.string({ required: false })
    subject: string | undefined | null;

    /**
     * When the user proved who they are, which the login counts from.
     */
    @Property.date()
    authenticatedAt!: Date;

    /**
     * The name of the provider the user signed in at. Null for a login started some other way.
     */
    @Property.string({ required: false })
    federatedProvider: string | undefined | null;

    /**
     * Identifies the person at that provider.
     */
    @Property.string({ required: false })
    federatedSubjectKey: string | undefined | null;

    /**
     * Identifies their session at that provider.
     */
    @Property.string({ required: false })
    federatedSessionKey: string | undefined | null;

    /**
     * What ends the session at that provider, once the login ends here.
     */
    @Property.string({ required: false })
    federatedLogout: string | undefined | null;

    /**
     * Whether the ticket has been spent.
     */
    @Property.boolean()
    spent!: boolean;

    /**
     * When the ticket stops being accepted.
     */
    @Property.date()
    expirationDate!: Date;
}

/**
 * The data to create a login ticket.
 */
export class LoginTicketCreateData extends OmitClass(LoginTicket, ['id', 'value']) {
    /**
     * The ticket, before the hook hashes it.
     */
    @Property.string({ hash: { strategy: Sha256HashStrategy } })
    value!: string;
}