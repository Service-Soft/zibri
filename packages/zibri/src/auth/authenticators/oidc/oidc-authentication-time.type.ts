/**
 * How an OpenID Connect provider says when the user signed in there, which is the login time of a
 * sign-in through it.
 *
 * `auth_time`: the provider is asked with `max_age`, and puts the time into the ID token as `auth_time`.
 * A sign-in older than `maxAuthenticationAgeInMs` allows has the provider ask the user to sign in again.
 *
 * `none`: the provider does not say. A sign-in through it never counts as a recent login.
 */
export type OidcAuthenticationTime = 'auth_time' | 'none';