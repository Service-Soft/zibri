import { BaseEntity } from '../../entity/base-entity.model';
import { Property } from '../../entity/decorators/property.decorator';

/**
 * An identity linked to a user, together with the authenticator it signs in through.
 */
export class LinkedIdentity<IdentityType extends Pick<BaseEntity, 'id'> = Pick<BaseEntity, 'id'>> {
    /**
     * The name of the authenticator the identity signs in through, eg. `google`.
     */
    @Property.string()
    authenticator!: string;

    /**
     * The identity, as that authenticator keeps it.
     */
    @Property.unknown()
    identity!: IdentityType;
}