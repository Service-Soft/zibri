import { TOTP } from 'otpauth';

/**
 * Provides functionality around handling time based one time passwords.
 */
export abstract class OtpUtilities {
    /**
     * Validates the given token with a TOTP created with the given secret.
     * @param secret - The secret to create the TOTP for.
     * @param token - The token to validate.
     * @returns True when the token is valid, false otherwise.
     */
    static validate(secret: string, token: string): boolean {
        const totp: TOTP = new TOTP({ secret });
        return totp.validate({ token }) != undefined;
    }

    /**
     * Creates a qr code url.
     * @param secret - The secret to generate the qr code url for.
     * @returns The url for the qr.
     */
    static createQrCodeUrl(secret: string): string {
        const totp: TOTP = new TOTP({ secret });
        return totp.toString();
    }
}