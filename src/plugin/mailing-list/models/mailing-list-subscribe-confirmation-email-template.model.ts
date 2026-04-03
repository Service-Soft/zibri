import { MailingList } from './mailing-list.model';
import { PreactEmailComponent } from '../../../preact/preact-email-component.model';
import { MailingListSubscriberCreateData } from '../services/mailing-list-service.interface';

/**
 * Properties of a mailing list subscribe confirmation email.
 */
type MailingListSubscribeConfirmationEmailTemplateProps = {
    /**
     * The (to be created) subscriber that needs to confirm.
     */
    subscriber: MailingListSubscriberCreateData,
    /**
     * The link to confirm the email.
     */
    confirmEmailLink: string,
    /**
     * The mailing list for wich this confirmation has been triggered.
     */
    mailingList: MailingList
};

/**
 * Definition for a mailing list subscribe confirmation email template.
 */
export type MailingListSubscribeConfirmationEmailTemplate = PreactEmailComponent<MailingListSubscribeConfirmationEmailTemplateProps>;