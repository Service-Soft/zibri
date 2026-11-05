import { Property } from '../../../entity/decorators/property.decorator';

/**
 * The token of a reset link, to check whether the link still works.
 */
export class PasswordResetTokenInput {
    /**
     * The token from the link.
     */
    @Property.string()
    resetToken!: string;
}