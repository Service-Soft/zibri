/**
 * An access or refresh token of a jwt login.
 */
export type Jwt = {
    /**
     * The token itself.
     */
    value: string,
    /**
     * When it stops working, as an ISO string.
     */
    expirationDate: string
};