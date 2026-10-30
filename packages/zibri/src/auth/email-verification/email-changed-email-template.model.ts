import { TsxEmailComponent } from '../../tsx/tsx-email-component.model';
import { UserAccount } from '../models/user-account.model';

/**
 * Properties of the email the previous address of a user is told of a change in.
 */
export type EmailChangedEmailTemplateProps = {
    /**
     * The address the user changed from, which the mail is sent to.
     */
    previousEmail: string,
    /**
     * The address the user changed to.
     */
    newEmail: string,
    /**
     * The user, with their new address.
     */
    user: UserAccount
};

/**
 * Definition for the email the previous address of a user is told of a change in.
 */
export type EmailChangedEmailTemplate = TsxEmailComponent<EmailChangedEmailTemplateProps>;