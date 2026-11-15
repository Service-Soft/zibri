/**
 * A login of the user, as `GET /logins` lists it: where they are logged in.
 */
export type UserLogin = {
    /**
     * The id, which ends it.
     */
    id: string,
    /**
     * The name of the strategy it is held by, like 'cookie'.
     */
    strategy: string,
    /**
     * Whether it is the login of this browser.
     */
    current: boolean,
    /**
     * When the user logged in, as an ISO string.
     */
    authenticatedAt?: string,
    /**
     * When it was last used, as an ISO string.
     */
    lastUsedAt?: string,
    /**
     * When it ends unless it is refreshed, as an ISO string.
     */
    expiresAt: string,
    /**
     * The User-Agent of the browser it was last used from.
     */
    userAgent?: string,
    /**
     * The address it was last used from.
     */
    ipAddress?: string
};