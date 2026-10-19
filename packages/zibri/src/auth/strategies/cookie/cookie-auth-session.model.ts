import { BaseEntity } from '../../../entity/base-entity.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { OmitClass } from '../../../entity/omit-class.model';
import type { HashString } from '../../hash/hash.utilities';
import { Sha256HashStrategy } from '../../hash/strategies/sha256.hash-strategy';

/**
 * A cookie auth session.
 */
@Entity({ tenant: 'shared', allowOrphan: true })
export class CookieAuthSession extends BaseEntity {
    /**
     * The token the session cookie carries.
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
     * The id of the "family" this token belongs to.
     * All tokens that belong to the same "ancestor" are considered to be in a family.
     *
     * Is used for automatic reuse detection.
     */
    @Property.string({ format: 'uuid' })
    familyId!: string;
}

/**
 * Data for creating a new cookie auth session.
 */
export class CookieAuthSessionCreateData extends OmitClass(CookieAuthSession, ['id', 'token']) {
    /**
     * The token as the cookie carries it, before the hook hashes it.
     */
    @Property.string({ unique: true, hash: { strategy: Sha256HashStrategy } })
    token!: string;
}