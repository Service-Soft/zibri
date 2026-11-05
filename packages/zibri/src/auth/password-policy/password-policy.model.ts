/**
 * What a password has to be, checked whenever one is written to a property declared `password: true`.
 *
 * Lengths count characters, so an emoji is one.
 */
export type PasswordPolicy = {
    /**
     * The fewest characters a password has.
     */
    minLength: number,
    /**
     * The most characters a password has, at most 1024. 128 by default.
     */
    maxLength?: number,
    /**
     * Refuses a password the lengths let through, by throwing: one without a digit, one on a list of
     * breached passwords. What it throws is what the write fails with.
     */
    validatePassword?: (password: string) => void | Promise<void>,
    /**
     * What a login does with a password the policy refuses, such as one set before it asked for more:
     * `'keep'` logs the user in with it until they change it, `'requireChange'` has them choose a new
     * one before the login starts.
     */
    outdatedPasswords: 'keep' | 'requireChange'
};