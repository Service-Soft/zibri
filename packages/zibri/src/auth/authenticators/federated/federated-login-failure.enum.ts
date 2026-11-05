/**
 * Why a login at a provider failed, as the `error` the error url is called with.
 */
export enum FederatedLoginFailure {
    /**
     * The user did not allow the login at the provider.
     */
    CANCELLED = 'cancelled',
    /**
     * The provider answered with an error.
     */
    PROVIDER_ERROR = 'provider_error',
    /**
     * The login took too long, was used already, or was started in another browser.
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
     * The identity is linked to a user for access to the provider's apis only, and does not log in.
     */
    NOT_FOR_LOGIN = 'not_for_login',
    /**
     * No user is linked to the identity: the user it was linked to was deleted during the login, or
     * the registration did not link one.
     */
    NOT_LINKED = 'not_linked',
    /**
     * The user may not log in: their account is deactivated or locked, or the application refused
     * the login.
     */
    REFUSED = 'refused',
    /**
     * The login was turned away for any other reason, such as too many attempts or a request the
     * application could not take.
     */
    FAILED = 'failed'
}