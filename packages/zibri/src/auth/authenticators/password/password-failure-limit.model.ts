/**
 * Whether an account is locked after too many wrong passwords in a row, and for how long.
 *
 * `false` locks nothing.
 */
export type PasswordFailureLimit = false | {
    /**
     * How many wrong passwords in a row lock the account. Between 1 and 100.
     */
    maxFailures: number,
    /**
     * How long the lock lasts, in milliseconds. Until it has passed, the right password is refused
     * like a wrong one.
     */
    lockForMs: number
};