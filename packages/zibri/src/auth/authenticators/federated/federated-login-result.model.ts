/**
 * How a login at a provider continues once the provider has answered.
 */
export type FederatedLoginResult = {
    /**
     * A user is linked to the identity, and the code hands their login over.
     */
    type: 'handover',
    /**
     * The one-time code.
     */
    code: string,
    /**
     * Where the login goes now.
     */
    redirectTo: string,
    /**
     * The name of the auth strategy the login was started to log in with on this redirect. Undefined
     * when the code goes on to the frontend.
     */
    strategy: string | undefined
} | {
    /**
     * No user is linked to the identity, and the ticket continues the login at the registration.
     */
    type: 'registration',
    /**
     * The one-time ticket.
     */
    ticket: string
} | {
    /**
     * The user logged in at the provider longer ago than allowed, and the browser goes back there to
     * log in again.
     */
    type: 'reauthentication',
    /**
     * The url at the provider.
     */
    url: string
} | {
    /**
     * The identity is linked to the user who requested the link.
     */
    type: 'linked',
    /**
     * The user the identity is linked to.
     */
    userId: string,
    /**
     * Where the browser goes now.
     */
    redirectTo: string
};