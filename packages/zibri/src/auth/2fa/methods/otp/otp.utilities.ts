import type { TOTP } from 'otpauth';

import { optionalPeer } from '../../../../utilities/optional-peer.function.ts';

/**
 * How long one code is shown for, in seconds.
 *
 * Passed explicitly rather than left to the library's default, because the counter derived below has
 * to be measured in the same steps the codes are generated in. A default that changed underneath
 * would not fail, it would silently number the steps differently.
 */
export const OTP_PERIOD_IN_SECONDS: number = 30;

/**
 * How far either side of now a code may be accepted from, in milliseconds.
 *
 * Listed rather than left as a number because only whole steps exist: a code either belongs to a
 * step or it does not, so a window of 45 seconds is not a narrower 60 - it is 30 wearing a number
 * that says otherwise. Every value here is one the validation can actually carry out.
 *
 * These are the multiples of {@link OTP_PERIOD_IN_SECONDS}, and have to move with it. It is fixed at
 * 30 because that is what authenticator apps generate, so in practice neither moves.
 *
 * Stopping at 90 seconds is deliberate. Each step either side is another code an observer could
 * still spend, and RFC 6238 asks for at most one - a deployment needing more than three steps of
 * skew has a clock problem rather than a configuration problem.
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
     * @param windowInMs - How far either side of now to accept from, for clocks that disagree.
     * @returns The step the token belongs to, or undefined when it belongs to none of them.
     */
    static validate(secret: string, token: string, windowInMs: OtpValidationWindowInMs): number | undefined {
        const totp: TOTP = new (optionalPeer<typeof import('otpauth')>('otpauth', 'Two factor authentication with an otp').TOTP)(
            { secret, period: OTP_PERIOD_IN_SECONDS }
        );
        // exact, because the type only admits multiples of the period. That is the whole reason it
        // is a union rather than a number
        const window: number = windowInMs / (OTP_PERIOD_IN_SECONDS * 1000);
        const delta: number | null = totp.validate({ token, window });
        if (delta == undefined) {
            return undefined;
        }
        return Math.floor(Date.now() / (OTP_PERIOD_IN_SECONDS * 1000)) + delta;
    }

    /**
     * Creates a qr code url.
     * @param secret - The secret to generate the qr code url for.
     * @returns The url for the qr.
     */
    static createQrCodeUrl(secret: string): string {
        const totp: TOTP = new (optionalPeer<typeof import('otpauth')>('otpauth', 'Two factor authentication with an otp').TOTP)(
            { secret, period: OTP_PERIOD_IN_SECONDS }
        );
        return totp.toString();
    }
}