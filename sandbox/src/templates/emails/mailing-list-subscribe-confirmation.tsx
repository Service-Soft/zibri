import { $ts, MailingListSubscribeConfirmationEmailTemplate } from 'zibri';

import { BaseEmail } from '../email-components/base-email';
import { BaseEmailFooter } from '../email-components/base-email-footer';
import { BaseEmailHeader } from '../email-components/base-email-header';
import { EmailButton } from '../email-components/email-button';
import { EmailColumn } from '../email-components/email-column';
import { EmailSection } from '../email-components/email-section';
import { EmailText } from '../email-components/email-text';
import { EmailWrapper } from '../email-components/email-wrapper';

export const MailingListSubscribeConfirmationEmail: MailingListSubscribeConfirmationEmailTemplate = ({
    subscriber,
    mailingList,
    confirmEmailLink
}) => {

    const greeting: string = subscriber.name ? $ts`Hello ${subscriber.name}` : $ts`Hello`;

    return (
        <BaseEmail title={$ts`Confirm Email for mailing list ${mailingList.name}`}>
            <EmailWrapper backgroundColor='#1a1a26' borderRadius='5px' boxShadow='0 0 8px 4px rgba(0, 0, 0, 0.15)'>
                <BaseEmailHeader>{$ts`Confirm Email`}</BaseEmailHeader>

                <EmailSection paddingBottom='0px'>
                    <EmailColumn>
                        <EmailText paddingBottom='10px'>{greeting},</EmailText>
                        <EmailText paddingBottom='25px'>
                            {$ts`Please confirm the registration of this email for the mailing list "${mailingList.name}"`}:
                        </EmailText>
                        <EmailButton href={confirmEmailLink} cssClass='btn-primary'>
                            {$ts`Confirm`}
                        </EmailButton>
                        <EmailText paddingTop='25px'>
                            {$ts`If you did not try to subscribe to this mailing list, you can ignore this mail.`}
                        </EmailText>
                    </EmailColumn>
                </EmailSection>

                <BaseEmailFooter />
            </EmailWrapper>
        </BaseEmail>
    );
};