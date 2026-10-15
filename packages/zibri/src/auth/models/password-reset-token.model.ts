import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { OmitClass } from '../../entity/omit-class.model';
import type { HashString } from '../hash/hash.utilities';
import { Sha256HashStrategy } from '../hash/strategies/sha256.hash-strategy';

/**
 * A short lived token used to confirm a password reset.
 */
@Entity({ tenant: 'shared', allowOrphan: true })
export class PasswordResetToken extends BaseEntity {
    /**
     * The expiration date of the password reset token.
     */
    @Property.date()
    expirationDate!: Date;

    /**
     * The actual token value.
     *
     * Stored hashed, and findable because the strategy is deterministic - the token arrives on its
     * own, with nothing else in the request to find the row by. A database read therefore yields
     * nothing that can be presented back to the api.
     */
    @Property.string({ hash: { strategy: Sha256HashStrategy } })
    value!: HashString;

    /**
     * The id of the user that this password reset token belongs to.
     */
    @Property.string({ format: 'uuid' })
    userId!: string;
}

/**
 * The data to create a new password reset token.
 */
export class PasswordResetTokenCreateData extends OmitClass(PasswordResetToken, ['id', 'value']) {
    /**
     * The token as it is generated and mailed out, before the hook hashes it.
     */
    @Property.string({ hash: { strategy: Sha256HashStrategy } })
    value!: string;
}