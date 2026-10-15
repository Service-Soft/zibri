import { BaseEntity } from '../../../entity/base-entity.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { OmitClass } from '../../../entity/omit-class.model';

/**
 * A passkey of a user: the public half of a key their device holds, which signs them in and is a
 * second factor.
 */
@Entity({ tenant: 'shared', allowOrphan: true })
export class Passkey extends BaseEntity {
    /**
     * The user the passkey belongs to.
     */
    @Property.string({ format: 'uuid' })
    userId!: string;

    /**
     * The id the device knows the passkey by, base64url encoded.
     */
    @Property.string({ unique: true })
    credentialId!: string;

    /**
     * The public key, COSE encoded and then base64url encoded.
     */
    @Property.string()
    publicKey!: string;

    /**
     * How many signatures the device reported having made with it, last time. Always 0 for a device
     * that counts none.
     */
    @Property.number()
    counter!: number;

    /**
     * How the browser can reach the device, such as `internal`, `usb` or `hybrid`.
     */
    @Property.array({ items: { type: 'string' } })
    transports!: string[];

    /**
     * The model of the device, all zeros when it keeps that to itself.
     */
    @Property.string()
    aaguid!: string;

    /**
     * The account the device created the passkey for, base64url encoded. The same for every passkey
     * of a user.
     */
    @Property.string()
    userHandle!: string;

    /**
     * Whether the passkey is synced to other devices of the user, such as by a phone's password manager.
     */
    @Property.boolean()
    synced!: boolean;

    /**
     * When the passkey was created.
     */
    @Property.date()
    createdAt!: Date;

    /**
     * When the passkey was last used.
     */
    @Property.date({ required: false })
    lastUsedAt?: Date;
}

/**
 * The data to create a passkey.
 */
export class PasskeyCreateData extends OmitClass(Passkey, ['id']) {}