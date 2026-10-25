/**
 * Why a sign-in at a provider failed, as the `error` the error url is called with.
 */
export enum FederatedSignInFailure {
    /**
     * The user did not allow the sign-in at the provider.
     */
    CANCELLED = 'cancelled',
    /**
     * The provider answered with an error.
     */
    PROVIDER_ERROR = 'provider_error',
    /**
     * The sign-in took too long, was used already, or was started in another browser.
     */
    EXPIRED = 'expired',
    /**
     * The provider's answer could not be verified.
     */
    INVALID = 'invalid',
    /**
     * The identity being connected is linked to another user already.
     */
    ALREADY_LINKED = 'already_linked',
    /**
     * The identity is linked to a user for access to the provider's apis only, and does not sign in.
     */
    NOT_FOR_SIGN_IN = 'not_for_sign_in',
    /**
     * The user may not sign in: their account is deactivated or locked, or the application refused
     * the sign-in.
     */
    REFUSED = 'refused'
}