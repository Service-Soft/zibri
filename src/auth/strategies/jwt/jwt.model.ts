import { Property } from '../../../entity/decorators/property.decorator';

/**
 * A Jwt, consisting of the token value and the expiration date.
 */
export class Jwt {
    /**
     * The token value.
     */
    @Property.string()
    value!: string;
    /**
     * The timestamp at which the token is no longer valid.
     */
    @Property.date()
    expirationDate!: Date;
}