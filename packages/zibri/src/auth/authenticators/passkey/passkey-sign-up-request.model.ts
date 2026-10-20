import { Property } from '../../../entity/decorators/property.decorator.ts';

/**
 * What starting a sign-up with a passkey takes.
 */
export class PasskeySignUpRequest {
    /**
     * The name the device lists the account under, such as the email the user signs up with.
     */
    @Property.string({ minLength: 1, maxLength: 256 })
    name!: string;
}