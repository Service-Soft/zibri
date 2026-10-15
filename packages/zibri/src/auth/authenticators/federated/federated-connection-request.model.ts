import { Property } from '../../../entity/decorators/property.decorator';

/**
 * What connecting a provider to a user is for, and where the browser goes once it is connected.
 */
export class FederatedConnectionRequest {
    /**
     * Where the browser goes once the provider is connected. Has to be under one of the allowed
     * redirects.
     */
    @Property.string()
    redirectTo!: string;

    /**
     * Whether a sign-in with the identity logs in as the user. An identity connected for access to a
     * provider's apis only is no way into the account.
     */
    @Property.boolean()
    signIn!: boolean;

    /**
     * The scopes of the provider's apis to keep tokens for. Each has to be one the authenticator allows.
     * None by default.
     */
    @Property.array({ items: { type: 'string' }, required: false })
    scopes?: string[];
}