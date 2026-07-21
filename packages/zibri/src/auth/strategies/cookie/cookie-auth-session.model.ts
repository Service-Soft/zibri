import { BaseEntity } from '../../../entity/base-entity.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { OmitClass } from '../../../entity/omit-class.model';

/**
 * A cookie auth session.
 */
@Entity({ allowOrphan: true })
export class CookieAuthSession extends BaseEntity {
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
export class CookieAuthSessionCreateData extends OmitClass(CookieAuthSession, ['id']) {}