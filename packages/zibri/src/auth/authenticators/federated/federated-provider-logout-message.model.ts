/**
 * What a provider sent the browser to the logout route with.
 */
export type FederatedProviderLogoutMessage = {
    /**
     * Sent in the query of a redirect.
     */
    binding: 'redirect',
    /**
     * The query, as it was read.
     */
    query: URLSearchParams,
    /**
     * The query exactly as it was sent, which a signature covers.
     */
    rawQuery: string
} | {
    /**
     * Posted as a form by a page of the provider.
     */
    binding: 'post',
    /**
     * The fields of the form.
     */
    form: URLSearchParams
};