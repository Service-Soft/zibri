import { inject, ZIBRI_DI_TOKENS } from '../../di';
import { Email, EmailPriority, EmailServiceInterface } from '../../email';
import { GlobalRegistry } from '../../global';
import { renderEmailTemplate } from '../../handlebars';
import { FormatDateFn } from '../../localization';
import { OmitStrict } from '../../types';
import { LogLevel } from '../log-level.enum';
import { Log } from '../log.model';
import { BaseLoggerTransportConfig, LoggerTransportSend } from './logger-transport.model';

/**
 * The input for creating a email logger transport.
 */
export type EmailLoggerTransportConfigInput = OmitStrict<BaseLoggerTransportConfig, 'register' | 'name'>
    & Partial<{ [K in keyof Email]: (log: Log) => Email[K] }>
    // eslint-disable-next-line jsdoc/require-jsdoc
    & { recipients: (log: Log) => string[] };

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

const bgColorForLogLevel: Record<LogLevel, string> = {
    [LogLevel.DEBUG]: '#00b4d8',
    [LogLevel.INFO]: '#00b4d8',
    [LogLevel.WARN]: '#edff4aff',
    [LogLevel.ERROR]: '#ff5959ff',
    [LogLevel.CRITICAL]: '#cc6cffff'
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
    const formatDate: FormatDateFn = inject(ZIBRI_DI_TOKENS.FORMAT_DATE);
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
        html: await renderEmailTemplate(
            'log.hbs',
            {
                base: { title: subject },
                log,
                levelName: subjectLabelForLogLevel[log.level],
                appName: GlobalRegistry.getAppData('name') ?? '',
                boxBgColor: bgColorForLogLevel[log.level],
                createdAtString: formatDate(log.createdAt, true)
            }
        )
    });
};

// eslint-disable-next-line jsdoc/require-jsdoc
function getSubject(log: Log): string {
    return `${subjectLabelForLogLevel[log.level]} in ${GlobalRegistry.getAppData('name')}`;
}