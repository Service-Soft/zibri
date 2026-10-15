/**
 * How the codes sent by email or text message look and how long they last.
 */
export type TwoFactorCodeOptions = {
    /**
     * How many digits a code has.
     * @default 6
     */
    digits?: number,
    /**
     * How long a code is accepted after it was sent.
     * @default 600000
     */
    expiresInMs?: number,
    /**
     * How long a user has to wait before another code is sent to them, for each channel.
     * @default 60000
     */
    resendAfterMs?: number
};