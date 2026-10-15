/**
 * A text message to send.
 */
export type SendSmsData = {
    /**
     * The phone number to send to, in international format, eg. `+4915112345678`.
     */
    to: string,
    /**
     * The text of the message.
     */
    message: string
};