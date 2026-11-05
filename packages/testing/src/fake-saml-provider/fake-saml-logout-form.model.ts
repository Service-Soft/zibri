/**
 * A logout message of the HTTP-POST binding: the form a page posts.
 */
export type FakeSamlLogoutForm = {
    /**
     * Where the form is posted.
     */
    url: string,
    /**
     * Its fields: `SAMLRequest` or `SAMLResponse`, base64 encoded and signed inside, and `RelayState`.
     */
    fields: URLSearchParams
};