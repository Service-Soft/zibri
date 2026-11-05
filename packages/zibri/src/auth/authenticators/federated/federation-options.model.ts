/**
 * What every authenticator of the application logging in at a provider shares.
 */
export type FederationOptions = {
    /**
     * Where a login goes on to once it is done, whatever the frontend asks for: only a url under one
     * of these is accepted as `redirectTo`.
     *
     * An entry allows its own origin, and its path and everything below it.
     */
    allowedRedirects: string[],
    /**
     * Where a login goes when no user is linked to the identity, with the one-time `ticket` as a
     * query parameter. The page there creates the user, see `AuthServiceInterface.linkTicketIdentity`.
     */
    registrationUrl: string,
    /**
     * Where a login goes when it fails, with the reason as the `error` query parameter.
     */
    errorUrl: string,
    /**
     * Where the browser goes once a provider has ended its session, after a logout here sent it there.
     * Required by a provider that can be logged out at, such as a SAML identity provider.
     */
    loggedOutUrl?: string,
    /**
     * How long ago a user may have logged in at the provider for that login to still count.
     *
     * An older one makes the provider ask the user to log in again.
     */
    maxAuthenticationAgeInMs: number,
    /**
     * How long a login may take at the provider.
     * @default 600000
     */
    loginAttemptExpiresInMs?: number,
    /**
     * How long the registration of a new user may take after the login at the provider.
     * @default 1800000
     */
    registrationTicketExpiresInMs?: number,
    /**
     * How long the one-time code a login is handed over to the frontend with stays valid.
     * @default 60000
     */
    handoverCodeExpiresInMs?: number,
    /**
     * How long the one-time code that sends the browser on to link a provider stays valid.
     * @default 60000
     */
    linkIdentityCodeExpiresInMs?: number
};