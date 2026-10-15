import { BaseEntity } from '../../../../entity/base-entity.model';
import { Entity } from '../../../../entity/decorators/entity.decorator';
import { Property } from '../../../../entity/decorators/property.decorator';
import { OmitClass } from '../../../../entity/omit-class.model';

/**
 * Where a user receives their two factor codes, and whether they have shown they receive them.
 */
@Entity({ tenant: 'shared', allowOrphan: true })
export class TwoFactorCodeCredentials extends BaseEntity {
    /**
     * The user that these credentials belong to.
     */
    @Property.string({ format: 'uuid' })
    userId!: string;

    /**
     * How the codes are sent, as the method names it, eg. `email` or `sms`.
     */
    @Property.string()
    channel!: string;

    /**
     * Where the codes are sent, such as a phone number, for the methods that need the user to say.
     */
    @Property.string({ encryption: true, required: false })
    destination?: string;

    /**
     * Whether the user has entered a code that was sent to this destination.
     */
    @Property.boolean({ default: false })
    confirmed!: boolean;
}

/**
 * The data to create code credentials.
 */
export class TwoFactorCodeCredentialsCreateData extends OmitClass(TwoFactorCodeCredentials, ['id', 'confirmed']) {}