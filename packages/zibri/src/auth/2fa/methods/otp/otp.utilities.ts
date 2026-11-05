import type { TOTP } from 'otpauth';

import { optionalPeer } from '../../../../utilities/optional-peer.function';

/**
 * How long one code is shown for, in seconds, unless `ZIBRI_DI_TOKENS.OTP_PERIOD_IN_SECONDS` says.
 *
 * Passed explicitly rather than left to the library's default, because the counter derived below has
 * to be measured in the same steps the codes are generated in. A default that changed underneath
 * would not fail, it would silently number the steps differently.
 */
export const OTP_PERIOD_IN_SECONDS: number = 30;

// Listed rather than left as a number because only whole steps exist: a code either belongs to a
// step or it does not, so a window of 45 seconds is not a narrower 60 - it is 30 wearing a number
// that says otherwise. Every value here is one the validation can actually carry out.
// Stopping at 90 seconds is deliberate. Each step either side is another code an observer could
// still spend, and RFC 6238 asks for at most one - a deployment needing more than three steps of
// skew has a clock problem rather than a configuration problem.
/**
 * How far either side of now a code may be accepted from, in milliseconds.
 *
 * These are the multiples of the default OTP period of 30 seconds, which is what authenticator apps
 * generate. With another period, the window is a whole number of it, which the method checks while
 * the application starts.
 */
export type OtpValidationWindowInMs = 0 | 30_000 | 60_000 | 90_000;

/**
 * Provides functionality around handling time based one time passwords.
 */
export abstract class OtpUtilities {
    /**
     * Validates the given token with a TOTP created with the given secret.
     *
     * Returns which step matched rather than just whether one did. A code is only one time if the
     * step it belongs to can be recorded as spent, and the step is the thing to record - the same
     * six digits are shown for the whole of it, so the digits alone cannot say which use they were.
     * @param secret - The secret to create the TOTP for.
     * @param token - The token to validate.
     * @param windowInMs - How far either side of now to accept from, for clocks that disagree. A whole
     * number of periods.
     * @param periodInSeconds - How long one code is shown for.
     * @param digits - How many digits a code has.
     * @returns The step the token belongs to, or undefined when it belongs to none of them.
     */
    static validate(
        secret: string,
        token: string,
        windowInMs: OtpValidationWindowInMs,
        periodInSeconds: number,
        digits: number
    ): number | undefined {
        const totp: TOTP = new (optionalPeer<typeof import('otpauth')>('otpauth', 'Two factor authentication with an otp').TOTP)(
            { secret, period: periodInSeconds, digits }
        );
        // exact, because the window is a whole number of periods, which the method checks at start
        const window: number = windowInMs / (periodInSeconds * 1000);
        const delta: number | null = totp.validate({ token, window });
        return delta == undefined ? undefined : Math.floor(Date.now() / (periodInSeconds * 1000)) + delta;
    }

    /**
     * Creates a qr code url.
     * @param secret - The secret to generate the qr code url for.
     * @param periodInSeconds - How long one code is shown for, which the url tells the app.
     * @param digits - How many digits a code has, which the url tells the app.
     * @param issuer - What the app lists the account under, such as the name of the application.
     * @param label - Which account of the issuer it is, such as the email of the user.
     * @returns The url for the qr.
     */
    static createQrCodeUrl(secret: string, periodInSeconds: number, digits: number, issuer: string, label: string): string {
        const totp: TOTP = new (optionalPeer<typeof import('otpauth')>('otpauth', 'Two factor authentication with an otp').TOTP)(
            { secret, period: periodInSeconds, digits, issuer, label }
        );
        return totp.toString();
    }
}