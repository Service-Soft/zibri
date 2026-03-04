import { OmitStrict } from '../../types/omit-strict.type';

/**
 * Configuration for emails.
 */
export type EmailConfig = {
    /**
     * The maximum amount of emails that should be sent per hour.
     * Is used by the default email service to create and use a RateLimiter.
     */
    maxEmailsPerHour: number,
    /**
     * The default sender to use when no sender was provided.
     */
    defaultSender: string,
    /**
     * The host of the email server.
     */
    host: string,
    /**
     * The port of the email server.
     * Eg. 465.
     */
    port: number,
    /**
     * Whether or not to use a pool of connections instead of reconnecting to the mail server every time a new email should be sent.
     * Defaults to true.
     */
    pool: boolean,
    /**
     * Auth data for the email server.
     */
    auth: {
        /**
         * The username of the account which should sent the emails.
         */
        user: string,
        /**
         * The password of the account which should sent the emails.
         */
        pass: string
    }
};

/**
 * The configuration for sending emails.
 */
export type EmailConfigInput = OmitStrict<EmailConfig, 'pool'> & Pick<Partial<EmailConfig>, 'pool'>;