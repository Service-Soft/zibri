import { QueueEmailData } from '../../../email/models/create-email-data.model';
import { BaseUser } from '../../models/base-user.model';

/**
 * The data used by the jwt auth strategy to request a password reset.
 */
export type JwtRequestPasswordResetData<RoleType extends string, UserType extends BaseUser<RoleType>> = {
    /**
     * The user which password should be reset.
     */
    user: UserType,
    /**
     * Additional data for the password reset email.
     */
    emailData?: Partial<
        QueueEmailData & {
            /**
             * The url where the password reset confirmation happens.
             */
            confirmPasswordResetUrl: string
        }
    >
};