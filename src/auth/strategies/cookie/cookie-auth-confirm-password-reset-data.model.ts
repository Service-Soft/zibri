import { Transaction } from '../../../data-source/transaction/transaction.model';
import { Property } from '../../../entity/decorators/property.decorator';

/**
 * The data used to confirm a password reset.
 */
export class CookieAuthConfirmPasswordResetData {
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
    /**
     * The transaction that this should run in.
     */
    transaction!: Transaction;
}