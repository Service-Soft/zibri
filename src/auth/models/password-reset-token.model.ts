import { Entity, OmitClass, Property } from '../../entity';
import { BaseEntity } from '../../entity/base-entity.model';

/**
 * A short lived token used to confirm a password reset.
 */
@Entity()
export class PasswordResetToken extends BaseEntity {
    /**
     * The expiration date of the password reset token.
     */
    @Property.date()
    expirationDate!: Date;

    /**
     * The actual token value.
     */
    @Property.string()
    value!: string;

    /**
     * The id of the user that this password reset token belongs to.
     */
    @Property.string({ format: 'uuid' })
    userId!: string;
}

/**
 * The data to create a new password reset token.
 */
export class PasswordResetTokenCreateData extends OmitClass(PasswordResetToken, ['id']) {}