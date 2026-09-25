import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { EmailServiceInterface } from '../../email/email-service.interface';
import { EmailPriority } from '../../email/models/email-priority.enum';
import { Email } from '../../email/models/email.model';
import { GlobalRegistry } from '../../global/global-registry';
import { TsxUtilities } from '../../tsx/tsx.utilities';
import { OmitStrict } from '../../types/omit-strict.type';
import { Ms } from '../../utilities/ms';
import { LogLevel } from '../log-level.enum';
import { Log } from '../log.model';
import { BaseLoggerTransportConfig, LogEmailTemplate, LoggerTransportSend } from './logger-transport.model';

/**
 * The input for creating a email logger transport.
 */
export type EmailLoggerTransportConfigInput = OmitStrict<BaseLoggerTransportConfig, 'register' | 'name'>
    & Partial<{ [K in keyof Email]: (logs: Log[]) => Email[K] }>
    & {
        // eslint-disable-next-line jsdoc/require-jsdoc
        recipients: (logs: Log[]) => string[],
        // eslint-disable-next-line jsdoc/require-jsdoc
        emailTemplate: LogEmailTemplate,
        /**
         * How many entries one email carries at most.
         *
         * A digest of ten thousand rendered entries is a different denial of service from ten
         * thousand emails, not an absence of one. What does not fit is counted rather than hidden -
         * the subject says how many there were.
         * Defaults to 20.
         */
        maxEntriesPerEmail?: number,
        /**
         * The shortest gap between two emails from this transport, in milliseconds.
         *
         * Without it the volume is bounded by how fast the application can fail, because a drain
         * happens as often as there is anything to drain. With it the volume is bounded by time,
         * which is the only bound an incident cannot outrun. Entries that arrive inside the gap are
         * counted and reported by the next email rather than dropped silently.
         * Defaults to one minute.
         */
        minIntervalMs?: number
    };

/**
 * The configuration of a email logger transport.
 */
export type EmailLoggerTransportConfig = EmailLoggerTransportConfigInput & Pick<BaseLoggerTransportConfig, 'register' | 'name'>;

const subjectLabelForLogLevel: Record<LogLevel, string> = {
    [LogLevel.DEBUG]: 'Debug Log',
    [LogLevel.INFO]: 'Info Log',
    [LogLevel.WARN]: 'Warning',
    [LogLevel.ERROR]: 'Error',
    [LogLevel.CRITICAL]: 'Critical Error'
};

/**
 * Builds the send function for one email transport.
 *
 * A factory rather than a plain function, because throttling has to remember when this transport
 * last sent and how much it has swallowed since. That state belongs to one transport - two of them
 * reporting to different mailboxes have nothing to do with each other, and a module level variable
 * would have made them share a budget.
 * @returns The send function, with its own throttle state.
 */
export function createLogToEmail(): LoggerTransportSend<EmailLoggerTransportConfig> {
    let lastSentAt: number | undefined = undefined;
    let suppressed: number = 0;

    return async (logs: Log[], config: EmailLoggerTransportConfig) => {
        const minIntervalMs: number = config.minIntervalMs ?? Ms.MINUTE;
        const now: number = Date.now();

        if (lastSentAt != undefined && now - lastSentAt < minIntervalMs) {
            suppressed += logs.length;
            return;
        }

        // claimed before the send rather than after it, so a slow mail queue during a storm does not
        // let the next batch through on a stale timestamp
        lastSentAt = now;
        const suppressedSinceLast: number = suppressed;
        suppressed = 0;

        const emailService: EmailServiceInterface = inject(ZIBRI_DI_TOKENS.EMAIL_SERVICE);
        const included: Log[] = logs.slice(0, config.maxEntriesPerEmail ?? 20);
        const subject: string = (config.subject ?? (() => defaultSubject(logs, suppressedSinceLast)))(logs);
        const html: string = TsxUtilities.renderEmail(config.emailTemplate, { logs: included });

        await emailService.queue({
            recipients: config.recipients(logs),
            subject,
            priority: config.priority?.(logs) ?? EmailPriority.HIGH,
            html,
            ...config.attachments ? { attachments: config.attachments(logs) } : {},
            ...config.cc ? { cc: config.cc(logs) } : {},
            ...config.bcc ? { bcc: config.bcc(logs) } : {},
            ...config.persist ? { persist: config.persist(logs) } : {},
            ...config.sender ? { sender: config.sender(logs) } : {},
            ...config.userId ? { userId: config.userId(logs) } : {}
        });
    };
}

/**
 * Names the batch, so the subject line is worth reading during an incident.
 *
 * The most severe level in it decides the label - a batch holding one critical among fifty warnings
 * is a critical - and the counts are what turn "Error in checkout" into something an operator can
 * tell a spike from a single failure by.
 * @param logs - Everything the batch held, including what did not fit in the email.
 * @param suppressedSinceLast - How many entries were swallowed by the interval since the last email.
 * @returns The subject line.
 */
function defaultSubject(logs: Log[], suppressedSinceLast: number): string {
    // the batch is never empty - the logger skips a transport whose level admits none of it
    const highest: LogLevel = logs.reduce((worst, l) => l.level > worst ? l.level : worst, logs[0]?.level ?? LogLevel.DEBUG);
    const label: string = `${subjectLabelForLogLevel[highest]} in ${GlobalRegistry.getAppData('name')}`;

    const notes: string[] = [];
    if (logs.length > 1) {
        notes.push(`${logs.length} entries`);
    }
    // named rather than left out, because a gap in the record otherwise reads as a gap in the
    // incident - the operator has to be told that something happened between the two emails
    if (suppressedSinceLast) {
        notes.push(`${suppressedSinceLast} suppressed`);
    }

    return notes.length ? `${label} (${notes.join(', ')})` : label;
}