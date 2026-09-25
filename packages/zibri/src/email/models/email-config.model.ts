import { OmitStrict } from '../../types/omit-strict.type';

/**
 * Configuration for emails.
 *
 * What the mail *subsystem* does, rather than how a mail reaches its provider. How to reach the
 * provider belongs to the transport registered under `ZIBRI_DI_TOKENS.EMAIL_TRANSPORT` - see
 * `SmtpEmailTransportOptions` for the one Zibri ships.
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
     * How long one instance may hold a queued mail while sending it, in milliseconds.
     *
     * Renewed for as long as the send is actually running, so this is not a limit on how slow a send
     * may be - it only decides how long a mail waits before another instance takes it over when the
     * one sending it stops existing.
     * Defaults to one minute.
     */
    sendLeaseInMs: number,
    /**
     * How many mails one pass of the queue sends at most.
     *
     * The knob for how hard the queue is drained: the cron job keeps calling until a pass comes back
     * empty, so this decides how many mails are in flight at once and how many rows one pass reads.
     * Raise it to drain a backlog faster, lower it for a provider that dislikes bursts.
     *
     * Priorities cannot starve each other regardless of what it is set to. Each priority may take at
     * most this many slots less one per priority below it, so a permanent flood of HIGH still leaves
     * a slot for NORMAL and one for LOW every pass.
     * Defaults to 10.
     */
    sendBatchSize: number
};

/**
 * The configuration for sending emails.
 */
export type EmailConfigInput
    = OmitStrict<EmailConfig, 'sendLeaseInMs' | 'sendBatchSize'>
        & Pick<Partial<EmailConfig>, 'sendLeaseInMs' | 'sendBatchSize'>;