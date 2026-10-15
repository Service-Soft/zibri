import { BaseEntity } from '../../../entity/base-entity.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { OmitClass } from '../../../entity/omit-class.model';

/**
 * A cookie auth refresh session.
 */
@Entity({ tenant: 'shared', allowOrphan: true })
export class CookieAuthRefreshSession extends BaseEntity {
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
     * The token to prohibit cross site request forgery.
     */
    @Property.string()
    csrfToken!: string;
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
export class CookieAuthRefreshSessionCreateData extends OmitClass(CookieAuthRefreshSession, ['id']) {}