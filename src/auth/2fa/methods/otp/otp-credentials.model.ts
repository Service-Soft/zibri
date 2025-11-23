import { BaseEntity, Entity, OmitClass, Property } from '../../../../entity';

/**
 * Credentials for a one time password.
 */
@Entity()
export class OtpCredentials extends BaseEntity {
    /**
     * The user id that these credentials belong to.
     */
    @Property.string({ format: 'uuid' })
    userId!: string;
    /**
     * The secret to use for generating the OTP.
     */
    @Property.string()
    secret!: string;
    /**
     * Whether or not these credentials have already been used successfully.
     */
    @Property.boolean({ default: false })
    confirmed!: boolean;
    /**
     * The two factor url that is needed to display a qr code.
     */
    @Property.string({ required: false })
    qrCodeUrl: string | undefined;
}

/**
 * The data to create new otp credentials.
 */
export class OtpCredentialsCreateData extends OmitClass(OtpCredentials, ['id', 'confirmed']) {}