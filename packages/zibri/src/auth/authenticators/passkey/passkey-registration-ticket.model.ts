import { BaseEntity } from '../../../entity/base-entity.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { OmitClass } from '../../../entity/omit-class.model';
import type { HashString } from '../../hash/hash.utilities';
import { Sha256HashStrategy } from '../../hash/strategies/sha256.hash-strategy';

/**
 * A passkey created for a user who does not exist yet, until the application has created them.
 *
 * Spent once, by the login it ends in.
 */
@Entity({ tenant: 'shared', allowOrphan: true })
export class PasskeyRegistrationTicket extends BaseEntity {
    /**
     * The ticket.
     */
    @Property.string({ hash: { strategy: Sha256HashStrategy } })
    value!: HashString;

    /**
     * The user the passkey was added to, once it was.
     */
    @Property.string({ format: 'uuid', required: false })
    userId?: string;

    /**
     * The name the device lists the account under.
     */
    @Property.string()
    userName!: string;

    /**
     * The id the device knows the passkey by, base64url encoded.
     */
    @Property.string()
    credentialId!: string;

    /**
     * The public key, COSE encoded and then base64url encoded.
     */
    @Property.string()
    publicKey!: string;

    /**
     * How many signatures the device reported having made with it.
     */
    @Property.number()
    counter!: number;

    /**
     * How the browser can reach the device.
     */
    @Property.array({ items: { type: 'string' } })
    transports!: string[];

    /**
     * The model of the device.
     */
    @Property.string()
    aaguid!: string;

    /**
     * The account the device created the passkey for, base64url encoded.
     */
    @Property.string()
    userHandle!: string;

    /**
     * Whether the passkey is synced to other devices of the user.
     */
    @Property.boolean()
    synced!: boolean;

    /**
     * When the user created the passkey, which the login the ticket ends in counts from.
     */
    @Property.date()
    authenticatedAt!: Date;

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
 * The data to create a registration ticket.
 */
export class PasskeyRegistrationTicketCreateData extends OmitClass(PasskeyRegistrationTicket, ['id', 'value']) {
    /**
     * The ticket, before the hook hashes it.
     */
    @Property.string({ hash: { strategy: Sha256HashStrategy } })
    value!: string;
}