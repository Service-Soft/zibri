/**
 * How the browser tells a provider that the logins of a session it logged the user out of ended.
 */
export type FederatedLogoutAnswer = {
    /**
     * By being redirected to the provider.
     */
    binding: 'redirect',
    /**
     * Where the browser goes, the answer in the query.
     */
    url: string
} | {
    /**
     * By posting a form to the provider, from a page that posts it on its own.
     */
    binding: 'post',
    /**
     * Where the form is posted.
     */
    url: string,
    /**
     * The fields of the form.
     */
    fields: Record<string, string>
};