/**
 * The ways the login route takes, as `GET /login-methods` answers them, so that a frontend offers those.
 */
export type LoginMethods = {
    /**
     * Whether a user logs in with an email and a password.
     */
    password: boolean,
    /**
     * Whether a user logs in with a link sent by email, asked for at `POST /request-login-link`.
     */
    loginLink: boolean
};