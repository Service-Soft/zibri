import { BaseEntity } from '../../../entity/base-entity.model.ts';
import { Entity } from '../../../entity/decorators/entity.decorator.ts';
import { Property } from '../../../entity/decorators/property.decorator.ts';
import { OmitClass } from '../../../entity/omit-class.model.ts';
import type { HashString } from '../../hash/hash.utilities.ts';
import { Sha256HashStrategy } from '../../hash/strategies/sha256.hash-strategy.ts';

/**
 * The jwt refresh token that gets stored in the data source.
 */
@Entity({ tenant: 'shared', allowOrphan: true })
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

    /**
     * The name of the provider the login was started at. Null for a login started some other way.
     * Every token of one family carries the same value, like the three below.
     */
    @Property.string({ required: false })
    federatedProvider: string | undefined | null;

    /**
     * Identifies the person at that provider, which a logout there finds the login by.
     */
    @Property.string({ required: false })
    federatedSubjectKey: string | undefined | null;

    /**
     * Identifies their session at that provider, which a logout there finds the login by.
     */
    @Property.string({ required: false })
    federatedSessionKey: string | undefined | null;

    /**
     * What ends the session at that provider, once the login ends here.
     */
    @Property.string({ required: false })
    federatedLogout: string | undefined | null;

    /**
     * The RFC 7638 thumbprint of the DPoP key the login is bound to, which a refresh proves it holds.
     * Null for a login started without a proof. Every token of one family carries the same value.
     */
    @Property.string({ required: false })
    dpopKeyThumbprint: string | undefined | null;
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