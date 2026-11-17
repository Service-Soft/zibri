/**
 * What completes the enrollment of an authenticator app.
 */
export type OtpRegistrationConfirmData = {
    /**
     * The first code the app shows.
     */
    token: string
};