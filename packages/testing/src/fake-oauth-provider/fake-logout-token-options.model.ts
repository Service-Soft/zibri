/**
 * What a logout token of a fake provider names.
 */
export type FakeLogoutTokenOptions = {
    /**
     * The `sub` claim: the user whose logins end. Left out when the token names the session alone.
     */
    subject?: string,
    /**
     * The `sid` claim: the session whose logins end. Left out when the token names the user alone.
     */
    sessionId?: string,
    /**
     * Claims put in on top of the ones every logout token carries, or in their place, to see that the
     * application refuses a token that is wrong.
     */
    claims?: Record<string, unknown>
};