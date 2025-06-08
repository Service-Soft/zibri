import { Property } from '../../entity';

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