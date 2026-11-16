/**
 * What connecting a provider to the account of the user answers: where to send the browser.
 */
export type FederatedLinkIdentityStart = {
    /**
     * The url at the provider, which is good once and for a short time.
     */
    url: string
};