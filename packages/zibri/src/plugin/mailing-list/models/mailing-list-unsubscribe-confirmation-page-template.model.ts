import { MailingListSubscriber } from './mailing-list-subscriber.model';
import { MailingList } from './mailing-list.model';
import { TsxComponent } from '../../../tsx/tsx-component.model';

/**
 * Properties of a mailing list unsubscribe confirmation page component.
 */
type MailingListUnsubscribeConfirmationPageTemplateProps = {
    /**
     * The subscriber that just unsubscribed.
     */
    subscriber: MailingListSubscriber,
    /**
     * The mailing list that was just unsubscribed from.
     */
    mailingList: MailingList,
    /**
     * The link to the manage preferences page.
     */
    managePreferencesLink: string
};

/**
 * Definition for a mailing list unsubscribe confirmation page template.
 */
export type MailingListUnsubscribeConfirmationPageTemplate = TsxComponent<MailingListUnsubscribeConfirmationPageTemplateProps>;