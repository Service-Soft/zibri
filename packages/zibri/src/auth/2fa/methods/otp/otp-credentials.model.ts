import { BaseEntity } from '../../../../entity/base-entity.model';
import { Entity } from '../../../../entity/decorators/entity.decorator';
import { Property } from '../../../../entity/decorators/property.decorator';
import { OmitClass } from '../../../../entity/omit-class.model';

/**
 * Credentials for a one time password.
 */
@Entity({ tenant: 'shared', allowOrphan: true })
export class OtpCredentials extends BaseEntity {
    /**
     * The user id that these credentials belong to.
     */
    @Property.string({ format: 'uuid' })
    userId!: string;
    /**
     * The secret to use for generating the OTP.
     *
     * Encrypted rather than hashed, because it has to be read back: validating a code means
     * recomputing it from the seed. That is also what makes a leak of it permanent - the seed is the
     * second factor, and anyone holding it reproduces every future code until the user re-enrolls.
     */
    @Property.string({ encryption: true })
    secret!: string;
    /**
     * Whether or not these credentials have already been used successfully.
     */
    @Property.boolean({ default: false })
    confirmed!: boolean;
}

/**
 * The data to create new otp credentials.
 */
export class OtpCredentialsCreateData extends OmitClass(OtpCredentials, ['id', 'confirmed']) {}