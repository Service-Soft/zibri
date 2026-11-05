import { Property } from '../../../entity/decorators/property.decorator';

/**
 * What an OpenID Connect provider posts to the `logout/back-channel` route: a logout token, as
 * OpenID Connect Back-Channel Logout 1.0 sends it.
 */
export class FederatedLogoutTokenForm {
    /**
     * The logout token, a jwt the provider signed.
     */
    @Property.string()
    logout_token!: string;
}