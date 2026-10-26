import { QueueEmailData } from '../../../email/models/create-email-data.model';
import { OmitClass } from '../../../entity/omit-class.model';
import { Route } from '../../../routing/controller-route-configuration.model';
import { OmitStrict } from '../../../types/omit-strict.type';
import { MailingListTemplateData } from '../models/mailing-list-base-email-template.model';
import { MailingListSubscriber } from '../models/mailing-list-subscriber.model';

/**
 * The data required to queue a new mailing list email.
 */
export type MailingListQueueEmailData<T> = OmitStrict<
    QueueEmailData,
    'bcc' | 'cc' | 'recipients' | 'userId' | 'priority' | 'html' | 'listUnsubscribeUrl'
> & {
    /**
     * The title used in the template. Defaults to the subject.
     */
    title?: string,
    /**
     * The template. Can be a template string, html or anything else, like a TSX component function.
     */
    template: T,
    /**
     * A function that compiles the given template.
     */
    compile: (template: T, data: MailingListTemplateData) => string | Promise<string>
};

/**
 * The required data to create a new mailing list subscriber, in the active tenant.
 */
export class MailingListSubscriberCreateData extends OmitClass(MailingListSubscriber, ['id', 'tenantId', 'secret']) {}

/**
 * Interface for a mailing list service.
 */
export interface MailingListServiceInterface {
    /**
     * The base route for everything regarding mailing lists.
     */
    readonly mailingListBaseRoute: Route,
    /**
     * Queues a new email for the mailing list with the provided id.
     */
    queueEmailForList: <T>(listId: string, data: MailingListQueueEmailData<T>) => Promise<void>,
    /**
     * Requests for a new subscriber to be added to the mailing list with the provided id.
     * This should initialize a two step process required by the GDPR.
     *
     * Every address confirms, whether it is subscribed to other lists or not. An address already on
     * the list is sent nothing.
     */
    requestSubscription: <T>(
        listId: string,
        subscriber: MailingListSubscriberCreateData,
        emailData: OmitStrict<MailingListQueueEmailData<T>, 'template' | 'compile'>
    ) => Promise<void>,
    /**
     * Confirms that a new subscriber is added to the mailing list, with the token of the link the
     * request mailed out.
     *
     * A token confirms once, until it expires. Followed again, it answers with the subscriber while
     * they are still on the list, and writes nothing.
     * @throws An UnauthorizedError when the token is unknown, belongs to another list or has expired,
     * or was spent and its address is no longer on the list.
     */
    confirmSubscription: (listId: string, confirmationTokenValue: string) => Promise<MailingListSubscriber>,
    /**
     * Removes a subscriber with the given id from the mailing list with the provided id. A subscriber
     * that was on no other list is deleted.
     */
    unsubscribeFromList: (listId: string, subscriberId: string) => Promise<void>,
    /**
     * Puts a subscriber with the given id on exactly the mailing lists with the given ids. A
     * subscriber put on none is deleted.
     */
    updateSubscriptions: (subscriberId: string, mailingListIds: string[]) => Promise<void>,
    /**
     * Deletes the mailing list with the given id, and the subscribers it was the last list of.
     */
    deleteList: (listId: string) => Promise<void>,
    /**
     * Resolves the subscribe confirmation link for the list with the given id and the
     * confirmationToken. Every link names the active tenant, through `TenantService.resolveTenantUrl`.
     */
    resolveSubscribeConfirmationLink: (listId: string, confirmationToken: string) => Promise<string>,
    /**
     * Resolves the unsubscribe link for the list with the given id and the given subscriber. It
     * carries the subscriber's id and secret.
     */
    resolveUnsubscribeLink: (listId: string, subscriber: MailingListSubscriber) => Promise<string>,
    /**
     * Resolves the link to the manage preferences page for the given subscriber. It carries the
     * subscriber's id and secret.
     */
    resolveManagePreferencesLink: (subscriber: MailingListSubscriber) => Promise<string>,
    /**
     * Finds the subscriber a link was resolved for, along with the lists they are on.
     * @throws An UnauthorizedError when the secret is not the one of the subscriber with the given
     * id, or no subscriber has that id.
     */
    resolveSubscriberOfLink: (subscriberId: string, secret: string) => Promise<MailingListSubscriber>
}