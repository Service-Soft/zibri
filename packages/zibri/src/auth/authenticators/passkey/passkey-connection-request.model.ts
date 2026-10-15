import { Property } from '../../../entity/decorators/property.decorator';

/**
 * What adding a passkey to a user takes. A body the application's own route can take as it is.
 */
export class PasskeyConnectionRequest {
    /**
     * The name the device lists the account under, such as the user's email.
     */
    @Property.string({ minLength: 1, maxLength: 256 })
    name!: string;
}