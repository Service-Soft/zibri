import { BaseEntity } from '../../../entity/base-entity.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { OmitClass } from '../../../entity/omit-class.model';
import type { HashString } from '../../hash/hash.utilities';
import { Sha256HashStrategy } from '../../hash/strategies/sha256.hash-strategy';

/**
 * The jwt refresh token that gets stored in the data source.
 */
@Entity({ allowOrphan: true })
export class JwtRefreshToken extends BaseEntity {
    /**
     * The id of the user that this token belongs to.
     */
    @Property.string({ format: 'uuid' })
    userId!: string;

    /**
     * The actual token value.
     *
     * Stored hashed, and findable because the strategy is deterministic - the token arrives on its
     * own, with nothing else in the request to find the row by. A database read therefore yields no
     * usable session, which matters most here: a refresh token is a live login for as long as it
     * lasts.
     */
    @Property.string({ unique: true, hash: { strategy: Sha256HashStrategy } })
    value!: HashString;

    /**
     * Whether or not this refresh token has been blacklisted.
     *
     * Is used for automatic reuse detection.
     */
    @Property.boolean()
    blacklisted!: boolean;

    /**
     * The expiration date of the token.
     */
    @Property.date()
    expirationDate!: Date;

    /**
     * The id of the "family" this token belongs to.
     * All tokens that belong to the same "ancestor" are considered to be in a family.
     *
     * Is used for automatic reuse detection.
     */
    @Property.string({ format: 'uuid' })
    familyId!: string;
}

/**
 * Data for creating a new jwt refresh token.
 */
export class JwtRefreshTokenCreateDto extends OmitClass(JwtRefreshToken, ['id', 'value']) {
    /**
     * The signed token as it is handed to the caller, before the hook hashes it.
     */
    @Property.string({ unique: true, hash: { strategy: Sha256HashStrategy } })
    value!: string;
}