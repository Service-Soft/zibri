import { Transaction } from '../../../data-source/transaction/transaction.model';
import { BaseEntity } from '../../../entity/base-entity.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { OmitClass } from '../../../entity/omit-class.model';
import type { HashString } from '../../hash/hash.utilities';
import { BaseUser } from '../../models/base-user.model';

/**
 * The credentials used by the cookie-auth auth strategy.
 */
@Entity({ allowOrphan: true })
export class CookieAuthCredentials extends BaseEntity implements Pick<BaseUser<string>, 'id' | 'email'> {
    /**
     * The id of the user that this credentials belong to.
     */
    @Property.string({ format: 'uuid' })
    userId!: string;

    /**
     * The email of the user.
     */
    @Property.string({ unique: true, format: 'email' })
    email!: string;

    /**
     * The hashed password.
     */
    @Property.string({ hash: true })
    password!: HashString;
}

/**
 * The data that is used to login a user via the cookie auth auth strategy.
 */
export class CookieAuthCredentialsData extends OmitClass(CookieAuthCredentials, ['id', 'userId', 'password']) {
    /**
     * The password.
     */
    @Property.string()
    password!: string;
    /**
     * The transaction that this should run in.
     */
    transaction!: Transaction;
}

/**
 * The actual credentials sent over http.
 */
export class CookieAuthCredentialsDto extends OmitClass(CookieAuthCredentialsData, ['transaction']) {}

/**
 * The data for creating new cookie auth credentials.
 */
export class CookieAuthCredentialsCreateData extends OmitClass(CookieAuthCredentials, ['id']) {}