/**
 * The longest `User-Agent` a login keeps. Longer than any a browser sends, and short enough that a
 * client cannot make every login it starts store a header of its choosing at full length.
 */
export const LOGIN_USER_AGENT_MAX_LENGTH: number = 512;

/**
 * The client a login was used from: what the request that started or last refreshed it said about
 * itself.
 */
export type LoginDevice = {
    /**
     * The `User-Agent` the client sent, if any, cut to `LOGIN_USER_AGENT_MAX_LENGTH`.
     */
    userAgent: string | undefined,
    /**
     * The address of the client, as the application sees it behind its trusted proxies.
     */
    ipAddress: string | undefined
};