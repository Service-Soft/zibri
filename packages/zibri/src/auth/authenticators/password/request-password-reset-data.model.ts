import { Transaction } from '../../../data-source/transaction/transaction.model';
import { QueueEmailData } from '../../../email/models/create-email-data.model';
import { BaseUser } from '../../models/base-user.model';

/**
 * The data for requesting a password reset.
 */
export type RequestPasswordResetData<RoleType extends string, UserType extends BaseUser<RoleType>> = {
    /**
     * The user whose password should be reset.
     */
    user: UserType,
    /**
     * Overrides for the email the reset link is sent in.
     */
    emailData?: Partial<
        QueueEmailData & {
            /**
             * The url the reset link points to, followed by the token.
             */
            confirmPasswordResetUrl: string
        }
    >,
    /**
     * The transaction that this should run in.
     */
    transaction: Transaction
};