/**
 * What a challenge was issued for. An answer to it does that and nothing else.
 */
export enum PasskeyCeremony {
    /**
     * Signing in with a passkey.
     */
    SIGN_IN = 'sign-in',
    /**
     * Creating a passkey for a user who does not exist yet.
     */
    SIGN_UP = 'sign-up',
    /**
     * Creating a passkey for a user who exists, and adding it to them.
     */
    CONNECTION = 'connection',
    /**
     * Using a passkey as the second factor of an operation.
     */
    SECOND_FACTOR = 'second-factor'
}