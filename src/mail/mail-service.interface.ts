import { ZibriApplication } from '../application';
import { QueueMailData } from './models';

export interface MailServiceInterface {
    attachTo: (app: ZibriApplication) => void,
    queue: (data: QueueMailData) => Promise<void>,
    /**
     * Sends some of the queued mails.
     * @returns True when there are still resources available to send new mails, false otherwise.
     */
    sendQueuedMails: () => Promise<boolean>
}