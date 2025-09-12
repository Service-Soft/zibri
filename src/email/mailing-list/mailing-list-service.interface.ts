import { MailingListSubscriber } from './models';
import { ZibriApplication } from '../../application';
import { OmitClass } from '../../entity';
import { BaseEmailTemplateData } from '../../handlebars';
import { Route } from '../../routing';
import { OmitStrict } from '../../types';
import { QueueEmailData } from '../models';

/**
 * The data required to queue a new mailing list email.
 */
export type MailingListQueueEmailData<T extends Record<string, unknown>> = OmitStrict<
    QueueEmailData,
    'bcc' | 'cc' | 'recipients' | 'userId' | 'priority' | 'html'
> & {
    /**
     * The template string in handlebars format.
     */
    templateString: string,
    /**
     * The data to use inside the template string.
     */
    templateData: T
};

/**
 * The required data to create a new mailing list subscriber.
 */
export class MailingListSubscriberCreateData extends OmitClass(MailingListSubscriber, ['id']) {}

// eslint-disable-next-line jsdoc/require-jsdoc
export type BaseMailingListEmailTemplateData = OmitStrict<BaseEmailTemplateData, 'base'> & {
    /**
     * The base data shared by all mailing list email templates.
     */
    base: OmitStrict<BaseEmailTemplateData['base'], 'mailingListData'>
};

/**
 * Interface for a mailing list service.
 */
export interface MailingListServiceInterface {
    /**
     * The base route for everything regarding mailing lists.
     */
    readonly mailingListBaseRoute: Route,
    /**
     * Attaches the service to the Zibri application.
     */
    attachTo: (app: ZibriApplication) => void,
    /**
     * Queues a new email for the mailing list with the provided id.
     */
    queueEmailForList: <T extends BaseMailingListEmailTemplateData>(listId: string, data: MailingListQueueEmailData<T>) => Promise<void>,
    /**
     * Requests for a new subscriber to the be added to the mailing list with the provided id.
     * This should initialize a two step process required by the GDPR.
     */
    requestSubscribeToList: <T extends BaseMailingListEmailTemplateData>(
        listId: string,
        subscriber: MailingListSubscriberCreateData,
        emailData: MailingListQueueEmailData<T>
    ) => Promise<void>,
    /**
     * Confirms that a new subscriber is added to the mailing list.
     */
    confirmSubscribeToList: (confirmationTokenValue: string) => Promise<void>,
    /**
     * Removes a subscriber with the given id from the mailing list with the provided id.
     */
    unsubscribeFromList: (listId: string, subscriberId: string) => Promise<void>
}