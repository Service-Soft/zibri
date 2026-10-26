import { Property } from '../../../entity/decorators/property.decorator';

/**
 * Where to send the browser to link a provider to an account.
 */
export class FederatedLinkIdentityStart {
    /**
     * The url, which is good once and for a short time.
     */
    @Property.string()
    url!: string;
}
