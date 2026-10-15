/**
 * Whose recent login a route guarded by \@Auth.require2fa accepts in place of a second factor.
 *
 * `true` accepts it from every user. `'onlyAsFallback'` accepts it only from a user who has no
 * confirmed registration of any second factor the route allows.
 */
export type Require2faReauthAllow = true | 'onlyAsFallback';

/**
 * Accepting a recent login in place of a second factor, together with how recent it has to be.
 */
export type Require2faReauthOptions = {
    /**
     * Whose recent login is accepted.
     */
    allow: Require2faReauthAllow,
    /**
     * How long ago the login may have been, in milliseconds.
     * Defaults to `ZIBRI_DI_TOKENS.REQUIRE_2FA_REAUTH_WINDOW_IN_MS`.
     */
    windowInMs?: number
};

/**
 * Whether a route guarded by \@Auth.require2fa accepts a recent login in place of a second factor.
 *
 * `false` accepts a second factor only. `true` and `'onlyAsFallback'` are shorthands for
 * `{ allow: true }` and `{ allow: 'onlyAsFallback' }`.
 */
export type Require2faReauth = false | Require2faReauthAllow | Require2faReauthOptions;