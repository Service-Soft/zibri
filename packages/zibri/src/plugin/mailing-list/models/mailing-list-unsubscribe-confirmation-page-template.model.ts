import { MailingListSubscriber } from './mailing-list-subscriber.model.ts';
import { MailingList } from './mailing-list.model.ts';
import { TsxComponent } from '../../../tsx/tsx-component.model.ts';

/**
 * Properties of a mailing list unsubscribe confirmation page component.
 */
type MailingListUnsubscribeConfirmationPageTemplateProps = {
    /**
     * The subscriber the unsubscribe link was sent to.
     */
    subscriber: MailingListSubscriber,
    /**
     * The mailing list the link leaves.
     */
    mailingList: MailingList,
    /**
     * Whether the subscriber is off the list. False when the link was opened: the page then asks
     * them to confirm, with a form posting to `unsubscribeUrl`.
     */
    unsubscribed: boolean,
    /**
     * The url a POST unsubscribes with, the action of the page's form.
     */
    unsubscribeUrl: string,
    /**
     * The link to the manage preferences page.
     */
    managePreferencesLink: string
};

/**
 * Definition for a mailing list unsubscribe confirmation page template: the page an unsubscribe link
 * opens, asking to confirm, and the page confirming it once it is done.
 */
export type MailingListUnsubscribeConfirmationPageTemplate = TsxComponent<MailingListUnsubscribeConfirmationPageTemplateProps>;