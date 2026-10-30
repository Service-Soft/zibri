import { Transaction } from '../../../data-source/transaction/transaction.model';
import { Property } from '../../../entity/decorators/property.decorator';
import { OmitClass } from '../../../entity/omit-class.model';
import { PASSWORD_MAX_LENGTH } from '../../hash/hash.utilities';

/**
 * The data for changing a password.
 */
export class ChangePasswordData {
    /**
     * The password the user has, which they prove they know.
     */
    @Property.string({ maxLength: PASSWORD_MAX_LENGTH })
    currentPassword!: string;

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
 * What changing a password is sent with.
 */
export class ChangePasswordDto extends OmitClass(ChangePasswordData, ['transaction']) {}