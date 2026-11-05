/**
 * How an OpenID Connect provider says when the user logged in there, which is the login time of a
 * login through it.
 *
 * `auth_time`: the provider is asked with `max_age`, and puts the time into the ID token as `auth_time`.
 * A login older than `maxAuthenticationAgeInMs` allows has the provider ask the user to log in again.
 *
 * `none`: the provider does not say. A login through it never counts as a recent login.
 */
export type OidcAuthenticationTime = 'auth_time' | 'none';