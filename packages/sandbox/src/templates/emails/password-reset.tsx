import { $ts, MjButton, MjColumn, MjSection, MjText, PasswordResetEmailTemplate } from 'zibri';

import { Roles, User } from '../../models';
import { BaseEmail } from '../email-components/base-email';
import { BaseEmailFooter } from '../email-components/base-email-footer';
import { BaseEmailHeader } from '../email-components/base-email-header';
import { EmailWrapper } from '../email-components/email-wrapper';

export const PasswordResetEmail: PasswordResetEmailTemplate<Roles, User> = ({
    confirmPasswordResetLink,
    user
}) => {
    return (
        <BaseEmail title={$ts`Password Reset`}>
            <EmailWrapper backgroundColor='#1a1a26' borderRadius='5px' boxShadow='0 0 8px 4px rgba(0, 0, 0, 0.15)'>
                <BaseEmailHeader>{$ts`Password Reset`}</BaseEmailHeader>

                <MjSection paddingBottom='0px'>
                    <MjColumn>
                        <MjText paddingBottom='10px'>{$ts`Hello ${user.name},`}</MjText>
                        <MjText>{$ts`A password reset was requested for your account.`}</MjText>
                        <MjText paddingBottom='25px'>{$ts`Click the link down below to proceed.`}</MjText>
                        <MjButton href={confirmPasswordResetLink} cssClass='btn-primary'>
                            {$ts`Reset Password`}
                        </MjButton>
                        <MjText paddingTop='25px'>
                            {$ts`If you did not request to reset your password, you can ignore this mail.`}
                        </MjText>
                    </MjColumn>
                </MjSection>

                <BaseEmailFooter />
            </EmailWrapper>
        </BaseEmail>
    );
};