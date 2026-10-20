import { MailingListSubscriber } from './mailing-list-subscriber.model.ts';
import { MailingList } from './mailing-list.model.ts';
import { TsxComponent } from '../../../tsx/tsx-component.model.ts';

/**
 * Properties of a mailing list subscribe success page.
 */
type MailingListSubscribeSuccessPageTemplateProps = {
    /**
     * The mailing list for which the subscription was successful.
     */
    mailingList: MailingList,
    /**
     * The subscriber that confirmed the subscription.
     */
    subscriber: MailingListSubscriber,
    /**
     * The link to the manage preferences page.
     */
    managePreferencesLink: string
};

/**
 * Definition for a mailing list subscribe success page template.
 */
export type MailingListSubscribeSuccessPageTemplate = TsxComponent<MailingListSubscribeSuccessPageTemplateProps>;