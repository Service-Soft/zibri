import { BaseEntity } from '../../../entity/base-entity.model.ts';
import { Entity } from '../../../entity/decorators/entity.decorator.ts';
import { Property } from '../../../entity/decorators/property.decorator.ts';
import { OmitClass } from '../../../entity/omit-class.model.ts';
import type { HashString } from '../../hash/hash.utilities.ts';
import { Sha256HashStrategy } from '../../hash/strategies/sha256.hash-strategy.ts';

/**
 * A cookie auth refresh session.
 */
@Entity({ tenant: 'shared', allowOrphan: true })
export class CookieAuthRefreshSession extends BaseEntity {
    /**
     * The token the refresh session cookie carries, which the csrf token of the session is derived
     * from.
     *
     * Stored hashed, and findable because the strategy is deterministic: the token is random enough
     * that there is nothing to guess, and it arrives on its own. A database read yields nothing that
     * can be presented back to the api.
     */
    @Property.string({ unique: true, hash: { strategy: Sha256HashStrategy } })
    token!: HashString;
    /**
     * The id of the user that this session belong to.
     */
    @Property.string({ format: 'uuid' })
    userId!: string;
    /**
     * The expiration date of the session.
     */
    @Property.date()
    expirationDate!: Date;
    /**
     * Whether or not this session has been blacklisted.
     *
     * Is used for automatic reuse detection.
     */
    @Property.boolean()
    blacklisted!: boolean;
    /**
     * The id of the "family" this token belongs to.
     * All tokens that belong to the same "ancestor" are considered to be in a family.
     *
     * Is used for automatic reuse detection.
     */
    @Property.string({ format: 'uuid' })
    familyId!: string;
    /**
     * When the user logged in. Every refresh session of one family carries the same value.
     */
    @Property.date()
    authenticatedAt!: Date;
    /**
     * The name of the provider the login was started at. Null for a login started some other way.
     * Every refresh session of one family carries the same value, like the three below.
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
}

/**
 * Data for creating a new cookie auth refresh session.
 */
export class CookieAuthRefreshSessionCreateData extends OmitClass(CookieAuthRefreshSession, ['id', 'token']) {
    /**
     * The token as the cookie carries it, before the hook hashes it.
     */
    @Property.string({ unique: true, hash: { strategy: Sha256HashStrategy } })
    token!: string;
}