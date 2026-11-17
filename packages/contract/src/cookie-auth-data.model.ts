/**
 * What a login, a refresh and a change of the tenant with the cookie strategy answer. The cookies themselves are
 * httpOnly, so scripts never see them.
 */
export type CookieAuthData<Role extends string = string> = {
    /**
     * The id of the user.
     */
    userId: string,
    /**
     * The roles of the user.
     */
    roles: Role[],
    /**
     * The token every request that changes something sends, so another site can't send it.
     */
    csrfToken: string,
    /**
     * When the session runs out, as an ISO string. The next request renews it.
     */
    sessionExpirationDate: string,
    /**
     * When the login ends unless it is used, as an ISO string.
     */
    refreshSessionExpirationDate: string
};