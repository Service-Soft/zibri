import { BaseEntity } from '../../../entity/base-entity.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { OmitClass } from '../../../entity/omit-class.model';

/**
 * A cookie auth refresh session.
 */
@Entity({ allowOrphan: true })
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
}

/**
 * Data for creating a new cookie auth refresh session.
 */
export class CookieAuthRefreshSessionCreateData extends OmitClass(CookieAuthRefreshSession, ['id']) {}