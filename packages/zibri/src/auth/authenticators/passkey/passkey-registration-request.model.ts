import { Property } from '../../../entity/decorators/property.decorator';

/**
 * What requesting a registration with a passkey takes.
 */
export class PasskeyRegistrationRequest {
    /**
     * The name the device lists the account under, such as the email the user registers with.
     */
    @Property.string({ minLength: 1, maxLength: 256 })
    name!: string;
}
