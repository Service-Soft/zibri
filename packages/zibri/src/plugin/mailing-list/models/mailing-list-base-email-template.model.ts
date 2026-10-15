import { MailingListSubscriber } from './mailing-list-subscriber.model';
import { MailingList } from './mailing-list.model';
import { TsxEmailComponent } from '../../../tsx/tsx-email-component.model';

/**
 * Data about the mailing list that this email belongs to.
 */
export type MailingListTemplateData = {
    /**
     * The subscriber if the email belongs to a mailing list.
     */
    subscriber: MailingListSubscriber,
    /**
     * The mailing list that the email belongs to, if any.
     */
    list: MailingList,
    /**
     * The link the subscriber leaves the list with.
     */
    unsubscribeLink: string,
    /**
     * The link to the page the subscriber manages their preferences on.
     */
    managePreferencesLink: string
};

/**
 * Properties of a mailing list base email.
 */
type MailingListBaseEmailTemplateProps = MailingListTemplateData & {
    /**
     * The title of the email.
     */
    title: string,
    /**
     * The html content.
     */
    html: string
};

/**
 * Definition for a mailing list base email template.
 */
export type MailingListBaseEmailTemplate = TsxEmailComponent<MailingListBaseEmailTemplateProps>;