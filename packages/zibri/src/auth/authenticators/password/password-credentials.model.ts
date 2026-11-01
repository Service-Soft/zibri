import { BaseEntity } from '../../../entity/base-entity.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { OmitClass } from '../../../entity/omit-class.model';
import { type HashString, PASSWORD_MAX_LENGTH } from '../../hash/hash.utilities';

/**
 * The password of a user, as `PasswordAuthenticator` stores it.
 */
@Entity({ tenant: 'shared', allowOrphan: true })
export class PasswordCredentials extends BaseEntity {
    /**
     * The id of the user the password belongs to.
     */
    @Property.string({ format: 'uuid', unique: true })
    userId!: string;

    /**
     * The hashed password.
     */
    @Property.string({ password: true })
    password!: HashString;

    /**
     * Whether the user chooses a new password before their next login starts, as
     * `AuthService.requirePasswordChange` asks. Setting a password clears it.
     */
    @Property.boolean({ default: false })
    changeRequired!: boolean;
}

/**
 * The credentials a user logs in with.
 */
export class PasswordCredentialsDto {
    /**
     * The email of the user.
     */
    @Property.string({ format: 'email' })
    email!: string;

    /**
     * The password.
     */
    @Property.string({ maxLength: PASSWORD_MAX_LENGTH })
    password!: string;
}

/**
 * The data for storing a password.
 */
export class PasswordCredentialsCreateData extends OmitClass(PasswordCredentials, ['id', 'password', 'changeRequired']) {
    /**
     * The password, which is checked against `ZIBRI_DI_TOKENS.PASSWORD_POLICY` and hashed when it is
     * stored.
     */
    @Property.string({ password: true })
    password!: string;

    /**
     * Whether the user chooses a new password before their next login starts. False by default.
     */
    @Property.boolean({ required: false })
    changeRequired?: boolean;
}