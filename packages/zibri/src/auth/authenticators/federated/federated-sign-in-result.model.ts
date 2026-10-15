/**
 * How a sign-in at a provider continues once the provider has answered.
 */
export type FederatedSignInResult = {
    /**
     * A user is linked to the identity, and the code hands their login over.
     */
    type: 'handover',
    /**
     * The one-time code.
     */
    code: string,
    /**
     * Where the sign-in goes now.
     */
    redirectTo: string,
    /**
     * The name of the auth strategy the sign-in was started to log in with on this redirect. Undefined
     * when the code goes on to the frontend.
     */
    strategy: string | undefined
} | {
    /**
     * No user is linked to the identity, and the ticket continues the sign-in at the registration.
     */
    type: 'registration',
    /**
     * The one-time ticket.
     */
    ticket: string
} | {
    /**
     * The user signed in at the provider longer ago than allowed, and the browser goes back there to
     * sign in again.
     */
    type: 'reauthentication',
    /**
     * The url at the provider.
     */
    url: string
} | {
    /**
     * The identity is linked to the user who connected the provider.
     */
    type: 'connected',
    /**
     * The user the identity is linked to.
     */
    userId: string,
    /**
     * Where the browser goes now.
     */
    redirectTo: string
};