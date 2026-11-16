import { type EmailVerificationPurpose } from './email-verification-purpose.type';

/**
 * What a stored link is for: its purpose, or, for one of the two links of a change that waits for
 * the other, that it was followed.
 */
export type EmailVerificationTokenPurpose = EmailVerificationPurpose | 'change-confirmed' | 'change-approval-confirmed';