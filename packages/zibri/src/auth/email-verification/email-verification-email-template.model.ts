import { type EmailVerificationPurpose } from './email-verification-purpose.type';
import { TsxEmailComponent } from '../../tsx/tsx-email-component.model';
import { UserAccount } from '../models/user-account.model';

/**
 * Properties of the email a link to verify an address is sent in.
 */
export type EmailVerificationEmailTemplateProps = {
    /**
     * The link the user follows to verify the address.
     */
    link: string,
    /**
     * The address verified, which the mail is sent to: the user's own, or the one they change to.
     */
    email: string,
    /**
     * Whether the user verifies the address they have, or changes to a new one.
     */
    purpose: EmailVerificationPurpose,
    /**
     * The user.
     */
    user: UserAccount
};

/**
 * Definition for the email a link to verify an address is sent in.
 */
export type EmailVerificationEmailTemplate = TsxEmailComponent<EmailVerificationEmailTemplateProps>;