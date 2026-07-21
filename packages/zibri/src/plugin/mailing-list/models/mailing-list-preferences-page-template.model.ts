import { MailingListSubscriber } from './mailing-list-subscriber.model';
import { MailingList } from './mailing-list.model';
import { PreactComponent } from '../../../preact/preact-component.model';

/**
 * Properties of a mailing list preferences page component.
 */
type MailingListPreferencesPageTemplateProps = {
    /**
     * The subscriber to render the page for.
     */
    subscriber: MailingListSubscriber,
    /**
     * All mailing lists that can be managed.
     */
    mailingLists: MailingList[],
    /**
     * The api url to update/patch the preferences.
     */
    managePreferencesApiUrl: string
};

/**
 * Definition for a mailing list preferences page template.
 */
export type MailingListPreferencesPageTemplate = PreactComponent<MailingListPreferencesPageTemplateProps>;