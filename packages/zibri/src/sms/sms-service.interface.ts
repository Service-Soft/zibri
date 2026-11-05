import { SendSmsData } from './send-sms-data.model';

/**
 * What sends a text message.
 *
 * Zibri ships none: every sender needs an account only your deployment has. Implement this on top
 * of your provider and register it under `ZIBRI_DI_TOKENS.SMS_SERVICE`.
 */
export interface SmsServiceInterface {
    /**
     * Sends the message, or throws when the provider did not take it.
     */
    send: (data: SendSmsData) => Promise<void>
}