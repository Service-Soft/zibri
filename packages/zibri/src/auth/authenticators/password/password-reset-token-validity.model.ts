import { Property } from '../../../entity/decorators/property.decorator';

/**
 * Whether a reset link still works.
 */
export class PasswordResetTokenValidity {
    /**
     * True when its token is known, has not expired, and its user still exists.
     */
    @Property.boolean()
    isValid!: boolean;
}