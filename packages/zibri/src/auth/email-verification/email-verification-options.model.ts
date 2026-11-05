import { EmailChangedEmailTemplate } from './email-changed-email-template.model';
import { EmailVerificationEmailTemplate } from './email-verification-email-template.model';

/**
 * How the email addresses of users are verified, as `ZIBRI_DI_TOKENS.EMAIL_VERIFICATION_OPTIONS` takes
 * it. Providing it turns verification on.
 */
export type EmailVerificationOptions = {
    /**
     * Where a link to verify an address points, followed by its token, such as
     * `https://app.example.com/verify-email`.
     */
    confirmEmailUrl: string,
    /**
     * The email a link to verify an address is sent in.
     */
    verificationEmail: EmailVerificationEmailTemplate,
    /**
     * The email the previous address of a user is told of a change in.
     */
    emailChangedEmail: EmailChangedEmailTemplate,
    /**
     * Whether a password login waits until the user's address is verified. A login refused for it
     * mails the user a link to verify it.
     */
    requiredForLogin: boolean,
    /**
     * How long a link works. A day by default.
     */
    linkExpiresInMs?: number
};