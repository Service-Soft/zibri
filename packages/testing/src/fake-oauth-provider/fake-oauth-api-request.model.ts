/**
 * A request to the api of a fake provider: anything but its sign-in, token, revocation and key set
 * endpoints.
 */
export type FakeOAuthApiRequest = {
    /**
     * The http method.
     */
    method: string,
    /**
     * The path, without the query.
     */
    path: string,
    /**
     * The `authorization` header, if any.
     */
    authorization: string | undefined,
    /**
     * The body, as text.
     */
    body: string
};