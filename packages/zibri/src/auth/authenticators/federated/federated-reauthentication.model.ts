/**
 * What a provider's answer is taken as when the user logged in there longer ago than
 * `maxAuthenticationAgeInMs` allows, and the provider could not be told so beforehand: the login
 * starts again, asking the provider to have the user log in again.
 */
export type FederatedReauthentication = {
    /**
     * Always true.
     */
    reauthenticate: true
};