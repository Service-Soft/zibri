import { PasskeyCeremony } from './passkey-ceremony.enum';
import { BaseEntity } from '../../../entity/base-entity.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { OmitClass } from '../../../entity/omit-class.model';
import type { HashString } from '../../hash/hash.utilities';
import { Sha256HashStrategy } from '../../hash/strategies/sha256.hash-strategy';

/**
 * A challenge a device was given to sign, and what for.
 *
 * Answered once, for the ceremony it was issued for, and only for a short time.
 */
@Entity({ tenant: 'shared', allowOrphan: true })
export class PasskeyChallenge extends BaseEntity {
    /**
     * The challenge.
     */
    @Property.string({ hash: { strategy: Sha256HashStrategy } })
    value!: HashString;

    /**
     * What the challenge was issued for.
     */
    @Property.string({ enum: PasskeyCeremony })
    ceremony!: PasskeyCeremony;

    /**
     * The user the challenge was issued for, when it was issued to one.
     */
    @Property.string({ format: 'uuid', required: false })
    userId?: string;

    /**
     * The account the passkey is created for, base64url encoded, when one is created.
     */
    @Property.string({ required: false })
    userHandle?: string;

    /**
     * The name the device lists the account under, when a passkey is created.
     */
    @Property.string({ required: false })
    userName?: string;

    /**
     * Whether the challenge has been answered.
     */
    @Property.boolean()
    spent!: boolean;

    /**
     * When the challenge stops being accepted.
     */
    @Property.date()
    expirationDate!: Date;
}

/**
 * The data to create a challenge.
 */
export class PasskeyChallengeCreateData extends OmitClass(PasskeyChallenge, ['id', 'value']) {
    /**
     * The challenge, before the hook hashes it.
     */
    @Property.string({ hash: { strategy: Sha256HashStrategy } })
    value!: string;
}