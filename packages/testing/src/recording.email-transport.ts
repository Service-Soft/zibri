import { Email, EmailSendResult, EmailTransportInterface } from 'zibri';

/**
 * A mail transport that delivers nothing and writes down what it was handed.
 *
 * For a test that needs to read what the application mailed: a code, a link. Register it under
 * `ZIBRI_DI_TOKENS.EMAIL_TRANSPORT`, give `EMAIL_CONFIG` a `maxEmailsPerHour` above 0, and run
 * `sendQueuedEmails` of the email service to have the queue handed to it.
 */
export class RecordingEmailTransport implements EmailTransportInterface {
    /**
     * What this transport is called wherever a transport is named.
     */
    readonly name: string = 'RecordingEmailTransport';

    /**
     * The mails handed over, in the order they were handed over.
     */
    readonly sends: Email[] = [];

    /**
     * Records the mail and accepts every recipient.
     * @param email - The mail to deliver.
     * @returns That no recipient was refused.
     */
    // eslint-disable-next-line typescript/require-await
    async send(email: Email): Promise<EmailSendResult> {
        this.sends.push(email);
        return { rejectedRecipients: [] };
    }
}