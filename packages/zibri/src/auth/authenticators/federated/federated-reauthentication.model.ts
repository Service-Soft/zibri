/**
 * What a provider's answer is taken as when the user signed in there longer ago than
 * `maxAuthenticationAgeInMs` allows, and the provider could not be told so beforehand: the sign-in
 * starts again, asking the provider to have the user sign in again.
 */
export type FederatedReauthentication = {
    /**
     * Always true.
     */
    reauthenticate: true
};