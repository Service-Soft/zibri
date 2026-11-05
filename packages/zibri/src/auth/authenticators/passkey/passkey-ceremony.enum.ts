/**
 * What a challenge was issued for. An answer to it does that and nothing else.
 */
export enum PasskeyCeremony {
    /**
     * Logging in with a passkey.
     */
    LOGIN = 'login',
    /**
     * Creating a passkey for a user who does not exist yet.
     */
    REGISTRATION = 'registration',
    /**
     * Creating a passkey for a user who exists, and adding it to them.
     */
    ADDITION = 'addition',
    /**
     * Using a passkey as the second factor of an operation.
     */
    SECOND_FACTOR = 'second-factor'
}