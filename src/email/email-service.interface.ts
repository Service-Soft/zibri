import { ZibriApplication } from '../application';
import { QueueEmailData } from './models/create-email-data.model';

/**
 * Interface for a email service.
 */
export interface EmailServiceInterface {
    /**
     * Attaches the service to the Zibri application.
     */
    attachTo: (app: ZibriApplication) => void,
    /**
     * Queues a new email.
     */
    queue: (data: QueueEmailData) => Promise<void>,
    /**
     * Sends some of the queued emails.
     * @returns True when there are still resources available to send new emails, false otherwise.
     */
    sendQueuedEmails: () => Promise<boolean>
}