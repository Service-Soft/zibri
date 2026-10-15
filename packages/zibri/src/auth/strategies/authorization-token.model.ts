/**
 * An access token a request sends in its authorization header.
 */
export type AuthorizationToken = {
    /**
     * The scheme it is sent with: `DPoP` for a token bound to a DPoP key, `Bearer` for any other.
     */
    scheme: 'Bearer' | 'DPoP',
    /**
     * The token.
     */
    value: string
};