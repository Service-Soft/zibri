import { MailingListBaseEmailTemplate } from 'zibri';

import { BaseEmail } from './base-email';
import { BaseEmailFooter } from './base-email-footer';
import { BaseEmailHeader } from './base-email-header';
import { EmailWrapper } from './email-wrapper';

export const MailingListBaseEmail: MailingListBaseEmailTemplate = ({
    list,
    subscriber,
    html,
    title
}) => {
    return (
        <BaseEmail title={title}>
            <EmailWrapper backgroundColor='#1a1a26' borderRadius='5px' boxShadow='0 0 8px 4px rgba(0, 0, 0, 0.15)'>
                <BaseEmailHeader>{title}</BaseEmailHeader>

                <div dangerouslySetInnerHTML={{ __html: html }} />

                <BaseEmailFooter mailingListData={{ list, subscriber }}/>
            </EmailWrapper>
        </BaseEmail>
    );
};