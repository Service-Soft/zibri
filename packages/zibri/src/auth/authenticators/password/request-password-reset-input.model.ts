import { Property } from '../../../entity/decorators/property.decorator.ts';

/**
 * What asking for a password reset is sent with.
 */
export class RequestPasswordResetInput {
    /**
     * The email of the account whose password is reset.
     */
    @Property.string({ format: 'email' })
    email!: string;
}