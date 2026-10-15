import { TsxEmailComponent } from '../../../tsx/tsx-email-component.model';
import { BaseUser } from '../../models/base-user.model';

/**
 * Properties of a password reset email.
 */
type PasswordResetEmailTemplateProps<Role extends string, UserType extends BaseUser<Role>> = {
    /**
     * The link the user follows to set a new password.
     */
    confirmPasswordResetLink: string,
    /**
     * The user whose password is reset.
     */
    user: UserType
};

/**
 * Definition for a password reset email template.
 */
export type PasswordResetEmailTemplate<
    Role extends string, UserType extends BaseUser<Role>
> = TsxEmailComponent<PasswordResetEmailTemplateProps<Role, UserType>>;