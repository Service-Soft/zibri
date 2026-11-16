/**
 * What the enrollment of an authenticator app answers: what the user scans or types into the app. Neither is stored,
 * so it is shown once.
 */
export type OtpRegistration = {
    /**
     * The otpauth url, to show as a qr code.
     */
    qrCodeUrl: string,
    /**
     * The same secret, to type into the app where scanning is not an option.
     */
    secret: string
};