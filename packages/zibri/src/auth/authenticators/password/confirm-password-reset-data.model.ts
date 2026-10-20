import { Transaction } from '../../../data-source/transaction/transaction.model.ts';
import { Property } from '../../../entity/decorators/property.decorator.ts';
import { OmitClass } from '../../../entity/omit-class.model.ts';
import { PASSWORD_MAX_LENGTH } from '../../hash/hash.utilities.ts';

/**
 * The data for confirming a password reset.
 */
export class ConfirmPasswordResetData {
    /**
     * The token from the reset link.
     */
    @Property.string()
    resetToken!: string;

    /**
     * The new password.
     */
    @Property.string({ maxLength: PASSWORD_MAX_LENGTH })
    newPassword!: string;

    /**
     * The transaction that this should run in.
     */
    transaction!: Transaction;
}

/**
 * What confirming a password reset is sent with.
 */
export class ConfirmPasswordResetDto extends OmitClass(ConfirmPasswordResetData, ['transaction']) {}