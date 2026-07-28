import { $ts, MailingListSubscribeConfirmationEmailTemplate, MjButton, MjColumn, MjSection, MjText } from 'zibri';

import { BaseEmail } from '../email-components/base-email';
import { BaseEmailFooter } from '../email-components/base-email-footer';
import { BaseEmailHeader } from '../email-components/base-email-header';
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

                <MjSection paddingBottom='0px'>
                    <MjColumn>
                        <MjText paddingBottom='10px'>{greeting},</MjText>
                        <MjText paddingBottom='25px'>
                            {$ts`Please confirm the registration of this email for the mailing list "${mailingList.name}"`}:
                        </MjText>
                        <MjButton href={confirmEmailLink} cssClass='btn-primary'>
                            {$ts`Confirm`}
                        </MjButton>
                        <MjText paddingTop='25px'>
                            {$ts`If you did not try to subscribe to this mailing list, you can ignore this mail.`}
                        </MjText>
                    </MjColumn>
                </MjSection>

                <BaseEmailFooter />
            </EmailWrapper>
        </BaseEmail>
    );
};