import { Property } from '../../entity/decorators/property.decorator';

/**
 * What confirming an email address is sent with: the token of the link that was followed.
 */
export class EmailVerificationTokenInput {
    /**
     * The token from the link.
     */
    @Property.string()
    token!: string;
}