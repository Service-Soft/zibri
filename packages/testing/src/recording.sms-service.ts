import { SendSmsData, SmsServiceInterface } from 'zibri';

/**
 * A sms sender that delivers nothing and writes down what it was handed.
 *
 * For a test that needs to read what the application sent: a code. Register it under
 * `ZIBRI_DI_TOKENS.SMS_SERVICE`.
 */
export class RecordingSmsService implements SmsServiceInterface {
    /**
     * The messages handed over, in the order they were handed over.
     */
    readonly sent: SendSmsData[] = [];

    /**
     * Records the message.
     * @param data - The message to send.
     */
    // eslint-disable-next-line typescript/require-await
    async send(data: SendSmsData): Promise<void> {
        this.sent.push(data);
    }
}