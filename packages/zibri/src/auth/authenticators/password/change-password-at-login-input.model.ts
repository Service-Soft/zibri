import { Property } from '../../../entity/decorators/property.decorator';
import { PASSWORD_MAX_LENGTH } from '../../hash/hash.utilities';

/**
 * What a login waiting for a new password is continued with, besides its ticket.
 */
export class ChangePasswordAtLoginInput {
    /**
     * The new password.
     */
    @Property.string({ maxLength: PASSWORD_MAX_LENGTH })
    newPassword!: string;
}