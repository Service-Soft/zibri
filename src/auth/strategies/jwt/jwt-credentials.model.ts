import { BaseEntity } from '../../../entity/base-entity.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { OmitClass } from '../../../entity/omit-class.model';
import { BaseUser } from '../../models/base-user.model';

/**
 * The credentials used by the jwt auth strategy.
 */
@Entity()
export class JwtCredentials extends BaseEntity implements Pick<BaseUser<string>, 'id' | 'email'> {
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
export class JwtCredentialsDto extends OmitClass(JwtCredentials, ['id', 'userId']) {}

/**
 * The data for creating new jwt credentials.
 */
export class JwtCredentialsCreateData extends OmitClass(JwtCredentials, ['id']) {}