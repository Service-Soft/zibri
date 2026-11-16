/**
 * What a password is set to without the one a user has, such as from a support tool or a command.
 */
export type SetPasswordData = {
    /**
     * The new password. The password policy checks it.
     */
    password: string,
    /**
     * Whether the user chooses a password of their own at their next login, which is what a password
     * somebody else knows asks for.
     */
    requireChange: boolean
};