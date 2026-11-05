/**
 * What the lock after too many wrong two factor codes refuses.
 *
 * - `secondFactor`: every route asking for a second factor, a recent login in place of one included,
 * until the user presents a recovery code or their second factors are reset.
 * - `account`: login as well. The user's open logins end when the lock is set, and only a reset of their
 * second factors lifts it.
 */
export type TwoFactorLock = 'secondFactor' | 'account';

/**
 * Whether a user's second factor is locked after too many wrong codes in a row, and what the lock
 * refuses.
 *
 * `false` locks nothing: each wrong code only makes the user wait twice as long before the next one is
 * checked.
 */
export type TwoFactorFailureLimit = false | {
    /**
     * How many wrong codes in a row lock the second factor. Between 1 and 100.
     *
     * Each wrong code also doubles the wait before the next one is checked, so a value above 30 is
     * never reached.
     */
    maxFailures: number,
    /**
     * What the lock refuses.
     */
    lock: TwoFactorLock
};