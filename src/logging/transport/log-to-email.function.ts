import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { EmailServiceInterface } from '../../email/email-service.interface';
import { EmailPriority } from '../../email/models/email-priority.enum';
import { Email } from '../../email/models/email.model';
import { GlobalRegistry } from '../../global/global-registry';
import { PreactUtilities } from '../../preact/preact.utilities';
import { OmitStrict } from '../../types/omit-strict.type';
import { LogLevel } from '../log-level.enum';
import { Log } from '../log.model';
import { BaseLoggerTransportConfig, LogEmailTemplate, LoggerTransportSend } from './logger-transport.model';

/**
 * The input for creating a email logger transport.
 */
export type EmailLoggerTransportConfigInput = OmitStrict<BaseLoggerTransportConfig, 'register' | 'name'>
    & Partial<{ [K in keyof Email]: (log: Log) => Email[K] }>
    & {
        // eslint-disable-next-line jsdoc/require-jsdoc
        recipients: (log: Log) => string[],
        // eslint-disable-next-line jsdoc/require-jsdoc
        emailTemplate: LogEmailTemplate
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
 * Sends the given log via email based on the given configuration.
 * @param log - The log to send.
 * @param config - The configuration on how and where emails should be sent.
 */
export const logToEmail: LoggerTransportSend<EmailLoggerTransportConfig> = async (
    log: Log,
    config: EmailLoggerTransportConfigInput
) => {
    const emailService: EmailServiceInterface = inject(ZIBRI_DI_TOKENS.EMAIL_SERVICE);
    const subject: string = (config.subject ?? getSubject)(log);
    const html: string = PreactUtilities.renderEmail(config.emailTemplate, { log });

    await emailService.queue({
        recipients: config.recipients(log),
        subject,
        priority: config.priority?.(log) ?? EmailPriority.HIGH,
        attachments: config.attachments?.(log),
        cc: config.cc?.(log),
        bcc: config.bcc?.(log),
        persist: config.persist?.(log),
        sender: config.sender?.(log),
        userId: config.userId?.(log),
        html
    });
};

// eslint-disable-next-line jsdoc/require-jsdoc
function getSubject(log: Log): string {
    return `${subjectLabelForLogLevel[log.level]} in ${GlobalRegistry.getAppData('name')}`;
}