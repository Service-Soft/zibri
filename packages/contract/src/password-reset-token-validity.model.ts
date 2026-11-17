/**
 * What `POST /verify-password-reset-token` answers.
 */
export type PasswordResetTokenValidity = {
    /**
     * Whether the token of the link still works.
     */
    isValid: boolean
};