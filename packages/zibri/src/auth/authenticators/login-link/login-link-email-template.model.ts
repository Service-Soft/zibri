import { TsxEmailComponent } from '../../../tsx/tsx-email-component.model';
import { BaseUser } from '../../models/base-user.model';

/**
 * Properties of the email a link to log in with is sent in.
 */
export type LoginLinkEmailTemplateProps = {
    /**
     * The link the user follows to log in.
     */
    loginLink: string,
    /**
     * The user the link logs in.
     */
    user: BaseUser<string>,
    /**
     * When the link stops working.
     */
    expiresAt: Date
};

/**
 * Definition for the email a link to log in with is sent in.
 */
export type LoginLinkEmailTemplate = TsxEmailComponent<LoginLinkEmailTemplateProps>;