import { $ts, PasswordResetEmailTemplate } from 'zibri';

import { Roles, User } from '../../models';
import { BaseEmail } from '../email-components/base-email';
import { BaseEmailFooter } from '../email-components/base-email-footer';
import { BaseEmailHeader } from '../email-components/base-email-header';
import { EmailButton } from '../email-components/email-button';
import { EmailColumn } from '../email-components/email-column';
import { EmailSection } from '../email-components/email-section';
import { EmailText } from '../email-components/email-text';
import { EmailWrapper } from '../email-components/email-wrapper';

export const PasswordResetEmail: PasswordResetEmailTemplate<Roles, User> = ({
    confirmPasswordResetLink,
    user
}) => {
    return (
        <BaseEmail title={$ts`Password Reset`}>
            <EmailWrapper backgroundColor='#1a1a26' borderRadius='5px' boxShadow='0 0 8px 4px rgba(0, 0, 0, 0.15)'>
                <BaseEmailHeader>{$ts`Password Reset`}</BaseEmailHeader>

                <EmailSection paddingBottom='0px'>
                    <EmailColumn>
                        <EmailText paddingBottom='10px'>{$ts`Hello ${user.name},`}</EmailText>
                        <EmailText>{$ts`A password reset was requested for your account.`}</EmailText>
                        <EmailText paddingBottom='25px'>{$ts`Click the link down below to proceed.`}</EmailText>
                        <EmailButton href={confirmPasswordResetLink} cssClass='btn-primary'>
                            {$ts`Reset Password`}
                        </EmailButton>
                        <EmailText paddingTop='25px'>
                            {$ts`If you did not request to reset your password, you can ignore this mail.`}
                        </EmailText>
                    </EmailColumn>
                </EmailSection>

                <BaseEmailFooter />
            </EmailWrapper>
        </BaseEmail>
    );
};