import { Property } from '../../../entity/decorators/property.decorator.ts';

/**
 * Where to send the browser to connect a provider to an account.
 */
export class FederatedConnectionStart {
    /**
     * The url, which is good once and for a short time.
     */
    @Property.string()
    url!: string;
}