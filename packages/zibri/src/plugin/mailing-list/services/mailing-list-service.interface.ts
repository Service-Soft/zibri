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
    'bcc' | 'cc' | 'recipients' | 'userId' | 'priority' | 'html'
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
export class MailingListSubscriberCreateData extends OmitClass(MailingListSubscriber, ['id', 'tenantId']) {}

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
     * Requests for a new subscriber to the be added to the mailing list with the provided id.
     * This should initialize a two step process required by the GDPR.
     */
    requestSubscribeToList: <T>(
        listId: string,
        subscriber: MailingListSubscriberCreateData,
        emailData: OmitStrict<MailingListQueueEmailData<T>, 'template' | 'compile'>
    ) => Promise<void>,
    /**
     * Confirms that a new subscriber is added to the mailing list.
     */
    confirmSubscribeToList: (confirmationTokenValue: string) => Promise<MailingListSubscriber>,
    /**
     * Removes a subscriber with the given id from the mailing list with the provided id.
     */
    unsubscribeFromList: (listId: string, subscriberId: string) => Promise<void>,
    /**
     * Resolves the subscribe confirmation link for the list with the given id and the
     * confirmationToken. Every link names the active tenant, through `TenantService.resolveTenantUrl`.
     */
    resolveSubscribeConfirmationLink: (listId: string, confirmationToken: string) => Promise<string>,
    /**
     * Resolves the unsubscribe link for the list with the given id and the subscriber with the given id.
     */
    resolveUnsubscribeLink: (listId: string, subscriberId: string) => Promise<string>,
    /**
     * Resolves the link to the manage preferences page for the subscriber with the given id.
     */
    resolveManagePreferencesLink: (subscriberId: string) => Promise<string>
}