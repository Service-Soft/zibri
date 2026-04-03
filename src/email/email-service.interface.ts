import { QueueEmailData } from './models/create-email-data.model';

/**
 * Interface for a email service.
 */
export interface EmailServiceInterface {
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