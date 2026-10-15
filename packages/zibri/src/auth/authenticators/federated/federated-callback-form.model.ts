import { Property } from '../../../entity/decorators/property.decorator';

/**
 * The answer to a sign-in a provider posts to the callback. Whatever else a provider adds is kept
 * next to these.
 */
export class FederatedCallbackForm {
    /**
     * The state the sign-in was started with.
     */
    @Property.string({ required: false })
    state?: string;

    /**
     * The code the provider's tokens are fetched with.
     */
    @Property.string({ required: false })
    code?: string;

    /**
     * Why the provider did not sign the user in, in place of the code.
     */
    @Property.string({ required: false })
    error?: string;
}