/**
 * What completes the enrollment of codes by email or text message, and of recovery codes.
 */
export type CodeRegistrationConfirmData = {
    /**
     * The code that was sent, or one of the recovery codes, which shows the user saved them.
     */
    code: string
};