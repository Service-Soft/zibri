/**
 * What the enrollment of codes by text message starts with.
 */
export type SmsRegistrationRequestData = {
    /**
     * The phone number the codes go to, in international format, like '+4915112345678'.
     */
    phoneNumber: string
};