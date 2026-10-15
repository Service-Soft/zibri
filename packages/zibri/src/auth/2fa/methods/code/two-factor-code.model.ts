import { BaseEntity } from '../../../../entity/base-entity.model';
import { Entity } from '../../../../entity/decorators/entity.decorator';
import { Property } from '../../../../entity/decorators/property.decorator';
import { OmitClass } from '../../../../entity/omit-class.model';

/**
 * A code that was sent to a user, until it is entered or expires.
 *
 * One at a time for each pair of credentials: sending a new code replaces the old one.
 */
@Entity({ tenant: 'shared', allowOrphan: true })
export class TwoFactorCode extends BaseEntity {
    /**
     * The credentials the code was sent for.
     */
    @Property.string({ format: 'uuid' })
    credentialsId!: string;

    /**
     * The code.
     */
    // encrypted rather than hashed: a code has so few possible values that whoever reads a hash of
    // it can try them all within the minutes it is valid
    @Property.string({ encryption: true })
    value!: string;

    /**
     * When the code stops being accepted.
     */
    @Property.date()
    expirationDate!: Date;
}

/**
 * The data to create a code.
 */
export class TwoFactorCodeCreateData extends OmitClass(TwoFactorCode, ['id']) {}