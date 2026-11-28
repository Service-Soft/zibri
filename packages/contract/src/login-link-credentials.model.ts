/**
 * What `POST /login?authenticator=login-link` takes: the token from the link, the last segment of the page it opens.
 */
export type LoginLinkCredentials = {
    /**
     * The token from the link.
     */
    token: string
};
