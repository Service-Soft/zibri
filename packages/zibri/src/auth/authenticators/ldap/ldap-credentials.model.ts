import { Property } from '../../../entity/decorators/property.decorator.ts';
import { PASSWORD_MAX_LENGTH } from '../../hash/hash.utilities.ts';

/**
 * The credentials a user signs in at a directory with.
 */
export class LdapCredentials {
    /**
     * The name the user signs in with, such as their account name or their email.
     */
    @Property.string({ minLength: 1, maxLength: 256 })
    username!: string;

    /**
     * The password.
     */
    @Property.string({ minLength: 1, maxLength: PASSWORD_MAX_LENGTH })
    password!: string;
}