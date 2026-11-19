import { Property } from '../../entity/decorators/property.decorator';

/**
 * What verifying and declining an invitation are sent with: the token of the link that was followed.
 */
export class InvitationTokenInput {
    /**
     * The token from the link.
     */
    @Property.string()
    token!: string;
}