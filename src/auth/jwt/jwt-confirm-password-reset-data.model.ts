import { Property } from '../../entity';

/**
 * The data used to confirm a password reset.
 */
export class JwtConfirmPasswordResetData {
    /**
     * The reset token value.
     */
    @Property.string()
    resetToken!: string;

    /**
     * The new password that should be used from now on.
     */
    @Property.string()
    newPassword!: string;
}