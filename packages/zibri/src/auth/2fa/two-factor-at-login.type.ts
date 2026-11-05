/**
 * Whether a login asks for a second factor once its credentials were accepted.
 *
 * - `never`: a login is complete on its credentials. A second factor is asked for by the routes that
 * say so with `@Auth.require2fa`.
 * - `ifEnrolled`: a user with a confirmed second factor presents it to log in. A user without one logs
 * in on their credentials.
 * - `required`: every user presents a second factor to log in. A user without one enrolls their first
 * before the login completes.
 */
export type TwoFactorAtLogin = 'never' | 'ifEnrolled' | 'required';