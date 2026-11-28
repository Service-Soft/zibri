/**
 * What the routes of the WebDAV connections of Zibri take at most, so that a frontend checks a value before it sends
 * it.
 */
// eslint-disable-next-line typescript/typedef
export const ZIBRI_WEB_DAV_CONNECTION_LIMITS = {
    /**
     * The longest name of a connection.
     */
    NAME_MAX_LENGTH: 200,
    /**
     * The longest url of a connection.
     */
    URL_MAX_LENGTH: 2000,
    /**
     * The longest name of the user logging in.
     */
    USERNAME_MAX_LENGTH: 200,
    /**
     * The longest password of the user logging in.
     */
    PASSWORD_MAX_LENGTH: 1000
} as const;
