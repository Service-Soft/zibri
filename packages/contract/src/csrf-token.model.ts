/**
 * What `GET /csrf-token` answers.
 */
export type CsrfToken = {
    /**
     * The csrf token of the cookie login of this browser.
     */
    csrfToken: string
};