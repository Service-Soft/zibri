import { Entity, OmitType, Property } from '../../entity';
import { BaseUser } from '../models';

/**
 * The credentials used by the jwt auth strategy.
 */
@Entity()
export class JwtCredentials implements Pick<BaseUser<string>, 'id' | 'email'> {
    // eslint-disable-next-line jsdoc/require-jsdoc
    @Property.string({ primary: true })
    id!: string;

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
     * The password.
     */
    @Property.string()
    password!: string;
}

/**
 * The actual credentials sent over http.
 */
export class JwtCredentialsDto extends OmitType(JwtCredentials, ['id', 'userId']) {}